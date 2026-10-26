package sshsvc

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"strings"
	"sync"
	"testing"

	"golang.org/x/crypto/ssh"
)

const (
	unitsFixture = `nginx.service  loaded active running   A high performance web server and a reverse proxy server
sshd.service   loaded active running   OpenBSD Secure Shell server
myapp.service  loaded inactive dead     My application daemon
broken.service loaded failed failed    Broken service
other.target   loaded active active    Not a service
`
	filesFixture = `nginx.service enabled
sshd.service enabled
myapp.service disabled
broken.service enabled
`
)

func TestParseServices(t *testing.T) {
	list := parseListUnits(unitsFixture, parseUnitFiles(filesFixture))
	if len(list) != 4 { // other.target 被过滤
		t.Fatalf("应解析出 4 个服务,实际 %d", len(list))
	}
	nginx := list[0]
	if nginx.Name != "nginx.service" || nginx.Active != "active" || nginx.Sub != "running" ||
		nginx.Enabled != "enabled" ||
		nginx.Description != "A high performance web server and a reverse proxy server" {
		t.Fatalf("nginx 解析异常: %+v", nginx)
	}
	if list[2].Enabled != "disabled" || list[2].Active != "inactive" {
		t.Fatalf("myapp 解析异常: %+v", list[2])
	}
	if list[3].Active != "failed" {
		t.Fatalf("broken 解析异常: %+v", list[3])
	}
}

// TestServiceNameValidation 名称/操作白名单。
func TestServiceNameValidation(t *testing.T) {
	valid := []string{"nginx.service", "my-app@1.service", "a:b_c.d"}
	for _, n := range valid {
		if !serviceNameRe.MatchString(n) {
			t.Fatalf("合法名称被拒: %s", n)
		}
	}
	invalid := []string{"", "nginx; rm -rf /", "nginx service", "../etc/passwd", "a$b"}
	for _, n := range invalid {
		if serviceNameRe.MatchString(n) {
			t.Fatalf("非法名称被放行: %q", n)
		}
	}
}

// TestListServicesEndToEnd 经 exec 测试服务器列出服务(运行+自启合并)。
func TestListServicesEndToEnd(t *testing.T) {
	addr, _ := startExecServerFunc(t, map[string]string{
		"list-units":      unitsFixture,
		"list-unit-files": filesFixture,
	})
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	list, err := mgr.ListServices(ts.ID)
	if err != nil {
		t.Fatalf("列出服务失败: %v", err)
	}
	if len(list) != 4 || list[0].Enabled != "enabled" || list[2].Enabled != "disabled" {
		t.Fatalf("服务列表异常: %+v", list)
	}
}

// TestControlService 操作命令与校验。
func TestControlService(t *testing.T) {
	addr, killLog := startExecServerFunc(t, map[string]string{})
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	if err := mgr.ControlService(ts.ID, "nginx.service", "restart"); err != nil {
		t.Fatalf("restart 失败: %v", err)
	}
	if err := mgr.ControlService(ts.ID, "myapp.service", "enable"); err != nil {
		t.Fatalf("enable 失败: %v", err)
	}
	if len(*killLog) != 2 || !strings.Contains((*killLog)[0], "systemctl restart nginx.service") {
		t.Fatalf("控制命令记录异常: %v", *killLog)
	}

	// 非法名称/操作必须在本地被拒,不产生远端命令
	if err := mgr.ControlService(ts.ID, "nginx; rm -rf /", "stop"); err == nil {
		t.Fatal("注入名称应被拒绝")
	}
	if err := mgr.ControlService(ts.ID, "nginx.service", "rm"); err == nil {
		t.Fatal("非法操作应被拒绝")
	}
	if len(*killLog) != 2 {
		t.Fatalf("非法请求不应到达远端: %v", *killLog)
	}
}

// startSudoFallbackServer 普通 systemctl 返回权限错误(exit 1),
// `sudo -n systemctl` 成功 —— 验证权限不足时的 sudo 回退路径。
func startSudoFallbackServer(t *testing.T) (addr string, log *[]string) {
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

	log = &[]string{}
	var mu sync.Mutex

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
							case "pty-req", "shell":
								_ = req.Reply(true, nil)
							case "exec":
								cmd := string(req.Payload[4:])
								_ = req.Reply(true, nil)
								mu.Lock()
								*log = append(*log, cmd)
								mu.Unlock()
								if strings.Contains(cmd, "systemctl") && !strings.Contains(cmd, "sudo -n") {
									_, _ = ch.Write([]byte("Permission denied"))
									_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(&struct{ Status uint32 }{Status: 1}))
								} else {
									_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(&struct{ Status uint32 }{Status: 0}))
								}
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
	return ln.Addr().String(), log
}

// TestControlServiceSudoFallback 普通权限不足 → sudo -n 成功。
func TestControlServiceSudoFallback(t *testing.T) {
	addr, log := startSudoFallbackServer(t)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	if err := mgr.ControlService(ts.ID, "nginx.service", "stop"); err != nil {
		t.Fatalf("sudo 回退后应成功: %v", err)
	}
	if len(*log) != 2 || !strings.HasPrefix((*log)[0], "systemctl stop") || !strings.HasPrefix((*log)[1], "sudo -n systemctl stop") {
		t.Fatalf("应先尝试普通再回退 sudo: %v", *log)
	}
}
