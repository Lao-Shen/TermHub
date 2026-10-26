package sshsvc

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"

	"golang.org/x/crypto/ssh"
)

// 解析器测试夹具(与 exec 测试服务器共用)。
const (
	psFixture = `   1   0 root  0.0  0.1 Ss   /sbin/init
 100   1 root  1.5  2.2 Ssl  /usr/bin/nginx -g daemon
 250 100 www   0.0  0.5 S    nginx: worker process
`

	ssFixture = `State  Recv-Q Send-Q Local Address:Port  Peer Address:Port
LISTEN 0      128    0.0.0.0:22          0.0.0.0:*     users:(("sshd",pid=1200,fd=3))
LISTEN 0      128    [::]:8080           [::]:*        users:(("java",pid=4500,fd=42))
`

	netstatFixture = `Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:3306            0.0.0.0:*               LISTEN      1800/mysqld
tcp6       0      0 :::443                  :::*                    LISTEN      -
`
)

func TestParseProcesses(t *testing.T) {
	list := parseProcesses(psFixture)
	if len(list) != 3 {
		t.Fatalf("应解析出 3 个进程,实际 %d", len(list))
	}
	first := list[0]
	if first.PID != 1 || first.PPID != 0 || first.User != "root" || first.Command != "/sbin/init" {
		t.Fatalf("首行解析异常: %+v", first)
	}
	second := list[1]
	if second.PID != 100 || second.CPU != 1.5 || second.Mem != 2.2 || second.Command != "/usr/bin/nginx -g daemon" {
		t.Fatalf("命令行含空格应完整保留: %+v", second)
	}
	if list[2].User != "www" || list[2].Command != "nginx: worker process" {
		t.Fatalf("第三行解析异常: %+v", list[2])
	}
}

func TestParseSSPorts(t *testing.T) {
	list := parseSSPorts(ssFixture)
	if len(list) != 2 {
		t.Fatalf("应解析出 2 个端口,实际 %d", len(list))
	}
	if list[0].Proto != "tcp" || list[0].Address != "0.0.0.0:22" || list[0].PID != 1200 || list[0].Process != "sshd" {
		t.Fatalf("ss 首行解析异常: %+v", list[0])
	}
	if list[1].Address != "[::]:8080" || list[1].PID != 4500 || list[1].Process != "java" {
		t.Fatalf("ss 第二行解析异常: %+v", list[1])
	}
}

func TestParseNetstatPorts(t *testing.T) {
	list := parseNetstatPorts(netstatFixture)
	if len(list) != 2 {
		t.Fatalf("应解析出 2 个端口,实际 %d", len(list))
	}
	if list[0].Proto != "tcp" || list[0].Address != "0.0.0.0:3306" || list[0].PID != 1800 || list[0].Process != "mysqld" {
		t.Fatalf("netstat 首行解析异常: %+v", list[0])
	}
	if list[1].PID != 0 || list[1].Process != "" {
		t.Fatalf("netstat 无进程行应留空: %+v", list[1])
	}
}

// startExecServer 支持 exec 请求的测试服务器:
// 按命令前缀返回夹具输出,记录收到的 kill 命令。
func startExecServer(t *testing.T, ssOutput string) (addr string, killLog *[]string) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("生成密钥失败: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("构造签名器失败: %v", err)
	}
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)

	commands := &sync.Map{}
	killLog = &[]string{}
	var mu sync.Mutex
	appendKill := func(cmd string) {
		mu.Lock()
		*killLog = append(*killLog, cmd)
		mu.Unlock()
	}
	_ = commands

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
							case "pty-req":
								_ = req.Reply(true, nil)
							case "shell":
								_ = req.Reply(true, nil)
							case "exec":
								cmd := string(req.Payload[4:])
								_ = req.Reply(true, nil)
								resp := ""
								switch {
								case strings.HasPrefix(cmd, "ps "):
									resp = psFixture
								case strings.HasPrefix(cmd, "ss "):
									resp = ssOutput
								case strings.HasPrefix(cmd, "netstat "):
									resp = netstatFixture
								case strings.HasPrefix(cmd, "kill "):
									appendKill(cmd)
								}
								_, _ = ch.Write([]byte(resp))
								_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(&struct{ Status uint32 }{Status: 0}))
								_ = ch.Close()
							default:
								_ = req.Reply(true, nil)
							}
						}
						_ = ch.Close()
					}()
				}
			}()
		}
	}()
	return ln.Addr().String(), killLog
}

// TestExecToolsEndToEnd 进程列表/端口列表/kill 端到端(含 ss→netstat 回退)。
func TestExecToolsEndToEnd(t *testing.T) {
	// 服务器 A:ss 可用
	addrA, killLog := startExecServer(t, ssFixture)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addrA)
	defer mgr.Close(ts.ID)

	procs, err := mgr.ListProcesses(ts.ID)
	if err != nil {
		t.Fatalf("列出进程失败: %v", err)
	}
	if len(procs) != 3 || procs[1].Command != "/usr/bin/nginx -g daemon" {
		t.Fatalf("进程列表异常: %+v", procs)
	}

	ports, err := mgr.ListPorts(ts.ID)
	if err != nil {
		t.Fatalf("列出端口失败: %v", err)
	}
	if len(ports) != 2 || ports[1].Process != "java" {
		t.Fatalf("端口列表异常: %+v", ports)
	}

	if err := mgr.KillProcess(ts.ID, 1234, "TERM"); err != nil {
		t.Fatalf("kill 失败: %v", err)
	}
	if len(*killLog) != 1 || (*killLog)[0] != "kill -TERM 1234" {
		t.Fatalf("kill 命令记录异常: %v", *killLog)
	}

	// 非法参数
	if err := mgr.KillProcess(ts.ID, 0, "TERM"); err == nil {
		t.Fatal("pid=0 应报错")
	}
	if err := mgr.KillProcess(ts.ID, 123, "HUP"); err == nil {
		t.Fatal("不支持的信号应报错")
	}
	if _, err := mgr.Get("不存在的会话"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("不存在会话应报 ErrSessionNotFound: %v", err)
	}
}

// TestExecToolsNetstatFallback ss 不可用时回退 netstat。
func TestExecToolsNetstatFallback(t *testing.T) {
	addr, _ := startExecServer(t, "") // ss 返回空
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	ports, err := mgr.ListPorts(ts.ID)
	if err != nil {
		t.Fatalf("回退路径失败: %v", err)
	}
	if len(ports) != 2 || ports[0].Process != "mysqld" {
		t.Fatalf("netstat 回退解析异常: %+v", ports)
	}
}
