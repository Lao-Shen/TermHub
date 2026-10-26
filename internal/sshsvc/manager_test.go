package sshsvc

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"github.com/pkg/sftp"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// startTestServer 启动一个内存 SSH 服务器(免认证),处理 pty/shell/window-change/keepalive,
// 并支持 sftp 子系统(根目录 sftpRoot)。
// 返回 host:port;keepalives 通道计数收到的保活请求(传 nil 则不统计)。
func startTestServer(t *testing.T, keepalives *atomic.Int64) (addr, sftpRoot string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("生成服务器密钥失败: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("构造签名器失败: %v", err)
	}
	_ = pub

	root := t.TempDir()
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
			go handleTestConn(t, conn, config, keepalives, root)
		}
	}()
	return ln.Addr().String(), root
}

func handleTestConn(t *testing.T, conn net.Conn, config *ssh.ServerConfig, keepalives *atomic.Int64, sftpRoot string) {
	sconn, chans, reqs, err := ssh.NewServerConn(conn, config)
	if err != nil {
		return // 握手失败(如主机密钥不匹配测试),静默关闭
	}
	defer sconn.Close()
	// 客户端 keepalive 是全局请求(非通道请求),须在此应答
	go func() {
		for req := range reqs {
			if req.Type == "keepalive@openssh.com" && keepalives != nil {
				keepalives.Add(1)
			}
			_ = req.Reply(true, nil)
		}
	}()

	for newCh := range chans {
		if newCh.ChannelType() != "session" {
			_ = newCh.Reject(ssh.UnknownChannelType, "unsupported")
			continue
		}
		ch, requests, err := newCh.Accept()
		if err != nil {
			return
		}
		go func() {
			for req := range requests {
				switch req.Type {
				case "keepalive@openssh.com":
					if keepalives != nil {
						keepalives.Add(1)
					}
					_ = req.Reply(true, nil)
				case "pty-req", "window-change", "env":
					_ = req.Reply(true, nil)
				case "subsystem":
					// SFTP 子系统:标准实现。
					// 注意 pkg/sftp 服务器在 Windows 上把 POSIX 绝对路径解析到
					// 进程当前驱动器根(如 /site → E:\site),不受工作目录约束;
					// 测试通过 "/<盘符>:/..." 形式的路径精确指向 sftpRoot。
					if string(req.Payload[4:]) == "sftp" {
						_ = req.Reply(true, nil)
						go func() {
							server, err := sftp.NewServer(ch)
							if err != nil {
								return
							}
							_ = server.Serve()
						}()
					} else {
						_ = req.Reply(false, nil)
					}
				case "shell":
					_ = req.Reply(true, nil)
					go func() {
						_, _ = io.Copy(io.Discard, ch) // 消费 stdin 直到客户端关闭
						_ = ch.Close()
					}()
				default:
					_ = req.Reply(true, nil)
				}
			}
			_ = ch.Close()
		}()
	}
}

func testCfg(addr string) ConnectionConfig {
	host, port, _ := net.SplitHostPort(addr)
	return ConnectionConfig{
		Name:     "test",
		Host:     host,
		Port:     mustPort(port),
		User:     "tester",
		Auth:     AuthPassword,
		Password: "ignored",
	}
}

func mustPort(s string) int {
	var p int
	fmt.Sscanf(s, "%d", &p)
	return p
}

func TestOpenTerminalLifecycle(t *testing.T) {
	addr, _ := startTestServer(t, nil)
	mgr := NewManager()

	exitCh := make(chan string, 1)
	mgr.OnExit = func(_ string, reason string) { exitCh <- reason }

	cfg := testCfg(addr)

	// 首次连接:TOFU,应返回指纹待确认,且不建立会话
	_, err := mgr.OpenTerminal(cfg)
	var unknown ErrHostKeyUnknown
	if !errors.As(err, &unknown) {
		t.Fatalf("首次连接应返回 ErrHostKeyUnknown,实际: %v", err)
	}
	if !strings.HasPrefix(unknown.Fingerprint, "SHA256:") {
		t.Fatalf("指纹格式异常: %s", unknown.Fingerprint)
	}
	if len(mgr.Sessions()) != 0 {
		t.Fatal("确认前不应建立会话")
	}

	// 携带指纹重试:建立会话
	cfg.TrustedHostKey = unknown.Fingerprint
	ts, err := mgr.OpenTerminal(cfg)
	if err != nil {
		t.Fatalf("建立会话失败: %v", err)
	}
	if len(mgr.Sessions()) != 1 {
		t.Fatalf("会话数异常: %d", len(mgr.Sessions()))
	}

	// 输入/尺寸调整不报错
	if _, err := ts.Write([]byte("ls\n")); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	if err := ts.Resize(30, 120); err != nil {
		t.Fatalf("调整尺寸失败: %v", err)
	}

	// 主动断开 → 等待 goroutine 上报"已断开连接"
	mgr.Close(ts.ID)
	select {
	case reason := <-exitCh:
		if reason != "已断开连接" {
			t.Fatalf("退出原因应为主动断开,实际: %q", reason)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("等待退出回调超时")
	}
	if len(mgr.Sessions()) != 0 {
		t.Fatal("断开后会话应被清理")
	}
}

func TestHostKeyMismatch(t *testing.T) {
	addr, _ := startTestServer(t, nil)
	mgr := NewManager()

	cfg := testCfg(addr)
	cfg.TrustedHostKey = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" // 假指纹

	_, err := mgr.OpenTerminal(cfg)
	if err == nil {
		t.Fatal("指纹不一致必须拒绝连接")
	}
	if !strings.Contains(err.Error(), "主机密钥") {
		t.Fatalf("错误信息应说明主机密钥问题: %v", err)
	}
	if len(mgr.Sessions()) != 0 {
		t.Fatal("拒绝后不应建立会话")
	}
}

func TestKeepAlivePings(t *testing.T) {
	var pings atomic.Int64
	addr, _ := startTestServer(t, &pings)
	mgr := NewManager()
	mgr.keepAlive = 50 * time.Millisecond // 测试加速

	exitCh := make(chan string, 1)
	mgr.OnExit = func(_ string, reason string) { exitCh <- reason }

	cfg := testCfg(addr)
	_, err := mgr.OpenTerminal(cfg)
	var unknown ErrHostKeyUnknown
	if !errors.As(err, &unknown) {
		t.Fatalf("首次连接应返回 ErrHostKeyUnknown,实际: %v", err)
	}
	cfg.TrustedHostKey = unknown.Fingerprint
	ts, err := mgr.OpenTerminal(cfg)
	if err != nil {
		t.Fatalf("建立会话失败: %v", err)
	}

	deadline := time.After(2 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatalf("2 秒内未收到足够的保活心跳(收到 %d 次)", pings.Load())
		case <-time.After(100 * time.Millisecond):
			if pings.Load() >= 2 {
				mgr.Close(ts.ID)
				select {
				case <-exitCh:
				case <-time.After(3 * time.Second):
					t.Fatal("等待退出回调超时")
				}
				return
			}
		}
	}
}

// TestConcurrentSessions 多会话并存互不影响。
func TestConcurrentSessions(t *testing.T) {
	addr, _ := startTestServer(t, nil)
	mgr := NewManager()

	open := func() *TerminalSession {
		cfg := testCfg(addr)
		_, err := mgr.OpenTerminal(cfg)
		var unknown ErrHostKeyUnknown
		if !errors.As(err, &unknown) {
			t.Fatalf("首次连接应返回 ErrHostKeyUnknown,实际: %v", err)
		}
		cfg.TrustedHostKey = unknown.Fingerprint
		ts, err := mgr.OpenTerminal(cfg)
		if err != nil {
			t.Fatalf("建立会话失败: %v", err)
		}
		return ts
	}

	var wg sync.WaitGroup
	ids := make(chan string, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ts := open()
			ids <- ts.ID
			time.Sleep(50 * time.Millisecond)
			_, _ = ts.Write([]byte("pwd\n"))
		}()
	}
	wg.Wait()
	close(ids)

	if len(mgr.Sessions()) != 4 {
		t.Fatalf("应有 4 个并存会话,实际: %d", len(mgr.Sessions()))
	}
	for id := range ids {
		if _, err := mgr.Get(id); err != nil {
			t.Fatalf("会话 %s 查找失败: %v", id, err)
		}
	}
}
