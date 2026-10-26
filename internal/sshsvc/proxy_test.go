package sshsvc

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// startJumpServer 启动一个允许出站 direct-tcpip 的跳板服务器(免认证),
// 收到的转发请求会拨号到载荷中的目标地址并双向桥接。
func startJumpServer(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("生成跳板密钥失败: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("构造签名器失败: %v", err)
	}
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				sconn, chans, reqs, err := ssh.NewServerConn(conn, config)
				if err != nil {
					return
				}
				defer sconn.Close()
				go ssh.DiscardRequests(reqs)
				for newCh := range chans {
					if newCh.ChannelType() != "direct-tcpip" {
						_ = newCh.Reject(ssh.UnknownChannelType, "only direct-tcpip supported")
						continue
					}
					go bridgeDirectTCPIP(newCh)
				}
			}()
		}
	}()
	return ln.Addr().String()
}

// bridgeDirectTCPIP 处理出站转发通道:拨号目标并双向桥接。
func bridgeDirectTCPIP(newCh ssh.NewChannel) {
	var payload struct {
		Raddr string
		Rport uint32
		Laddr string
		Lport uint32
	}
	if err := ssh.Unmarshal(newCh.ExtraData(), &payload); err != nil {
		_ = newCh.Reject(ssh.ConnectionFailed, "bad payload")
		return
	}
	target, err := net.DialTimeout("tcp", net.JoinHostPort(payload.Raddr, fmt.Sprint(payload.Rport)), 5*time.Second)
	if err != nil {
		_ = newCh.Reject(ssh.ConnectionFailed, err.Error())
		return
	}
	ch, reqs, err := newCh.Accept()
	if err != nil {
		_ = target.Close()
		return
	}
	go ssh.DiscardRequests(reqs)

	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(ch, target) // 目标 → 通道
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(target, ch) // 通道 → 目标
		_ = ch.CloseWrite()
		done <- struct{}{}
	}()
	<-done
	_ = ch.Close()
	_ = target.Close()
}

func proxyCfg(addr, jumpAddr string) ConnectionConfig {
	cfg := testCfg(addr)
	jhost, jport, _ := net.SplitHostPort(jumpAddr)
	cfg.ProxyJump = &ProxyJumpConfig{
		Host:     jhost,
		Port:     mustPort(jport),
		User:     "jumper",
		Auth:     AuthPassword,
		Password: "ignored",
	}
	return cfg
}

// TestProxyJumpConnect 经跳板连接:两级 TOFU 确认、会话建立、断开原因。
func TestProxyJumpConnect(t *testing.T) {
	targetAddr, _ := startTestServer(t, nil)
	jumpAddr := startJumpServer(t)

	mgr := NewManager()
	exitCh := make(chan string, 1)
	mgr.OnExit = func(_ string, reason string) { exitCh <- reason }

	cfg := proxyCfg(targetAddr, jumpAddr)

	// 第一步:跳板机指纹待确认(IsProxy)
	_, err := mgr.OpenTerminal(cfg)
	var unknown ErrHostKeyUnknown
	if !errors.As(err, &unknown) {
		t.Fatalf("第一步应返回跳板机指纹待确认,实际: %v", err)
	}
	if !unknown.IsProxy || unknown.Host != cfg.ProxyJump.Host {
		t.Fatalf("指纹归属异常: isProxy=%v host=%q", unknown.IsProxy, unknown.Host)
	}
	cfg.ProxyJump.TrustedHostKey = unknown.Fingerprint

	// 第二步:目标机指纹待确认
	_, err = mgr.OpenTerminal(cfg)
	if !errors.As(err, &unknown) {
		t.Fatalf("第二步应返回目标机指纹待确认,实际: %v", err)
	}
	if unknown.IsProxy {
		t.Fatal("第二步的指纹应属于目标机")
	}
	cfg.TrustedHostKey = unknown.Fingerprint

	// 第三步:建立会话
	ts, err := mgr.OpenTerminal(cfg)
	if err != nil {
		t.Fatalf("经跳板建立会话失败: %v", err)
	}
	if _, err := ts.Write([]byte("ls\n")); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	if err := ts.Resize(30, 120); err != nil {
		t.Fatalf("调整尺寸失败: %v", err)
	}

	mgr.Close(ts.ID)
	select {
	case reason := <-exitCh:
		if reason != "已断开连接" {
			t.Fatalf("退出原因应为主动断开,实际: %q", reason)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("等待退出回调超时")
	}
}

// openViaProxy 消化两级 TOFU(跳板 → 目标)后建立会话。
func openViaProxy(t *testing.T, mgr *Manager, cfg *ConnectionConfig) *TerminalSession {
	t.Helper()
	for i := 0; i < 3; i++ {
		ts, err := mgr.OpenTerminal(*cfg)
		if err == nil {
			return ts
		}
		var unknown ErrHostKeyUnknown
		if !errors.As(err, &unknown) {
			t.Fatalf("连接失败: %v", err)
		}
		if unknown.IsProxy {
			cfg.ProxyJump.TrustedHostKey = unknown.Fingerprint
		} else {
			cfg.TrustedHostKey = unknown.Fingerprint
		}
	}
	t.Fatal("TOFU 轮次超过预期")
	return nil
}

// TestProxyJumpSFTP 经跳板的 SFTP:目录列举与文件上传都跑在隧道上。
func TestProxyJumpSFTP(t *testing.T) {
	targetAddr, sftpRoot := startTestServer(t, nil)
	jumpAddr := startJumpServer(t)

	mgr := NewManager()
	cfg := proxyCfg(targetAddr, jumpAddr)

	ts := openViaProxy(t, mgr, &cfg)
	defer mgr.Close(ts.ID)

	tm, done := newTestTransferManager(t, mgr)

	// SFTP 目录列举走隧道
	fs := NewRemoteFS(mgr)
	if _, err := fs.ListDir(ts.ID, posixRemoteRoot(sftpRoot)); err != nil {
		t.Fatalf("经跳板列举目录失败: %v", err)
	}

	// 单文件上传走隧道
	local := t.TempDir()
	src := local + "\\payload.bin"
	writeFile(t, src, []byte("through the jump host"))

	info, err := tm.Upload(ts.ID, src, posixRemoteRoot(sftpRoot), nil)
	if err != nil {
		t.Fatalf("经跳板发起上传失败: %v", err)
	}
	final := waitDone(t, done, 10*time.Second)
	if final.Status != TransferDone {
		t.Fatalf("经跳板上传未完成: status=%s err=%s", final.Status, final.Error)
	}
	if info.Size != int64(len("through the jump host")) {
		t.Fatalf("上传大小异常: %d", info.Size)
	}
}

// TestProxyJumpWrongFingerprint 跳板机指纹不匹配必须拒绝。
func TestProxyJumpWrongFingerprint(t *testing.T) {
	targetAddr, _ := startTestServer(t, nil)
	jumpAddr := startJumpServer(t)

	mgr := NewManager()
	cfg := proxyCfg(targetAddr, jumpAddr)
	cfg.ProxyJump.TrustedHostKey = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

	_, err := mgr.OpenTerminal(cfg)
	if err == nil {
		t.Fatal("跳板机指纹不一致必须拒绝连接")
	}
	// 指纹不匹配经 HostKeyCallback 拒绝,表现为握手失败
	if errors.As(err, &ErrHostKeyUnknown{}) {
		t.Fatalf("指纹不匹配不应表现为待确认: %v", err)
	}
}
