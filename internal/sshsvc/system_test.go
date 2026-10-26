package sshsvc

import (
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"sort"
	"strings"
	"sync"
	"testing"

	"golang.org/x/crypto/ssh"
)

// 系统信息各命令的输出夹具(解析单测 + exec 端到端共用)。
const (
	osReleaseFixture = `PRETTY_NAME="Ubuntu 22.04.3 LTS"
NAME="Ubuntu"
`
	unameFixture    = "Linux 5.15.0-91-generic"
	hostnameFixture = "web-01\n"
	hostnameIFixture = "10.0.0.5 203.0.113.42 172.17.0.1 \n" // 含公网 IP,应被过滤
	nprocFixture    = "8\n"
	loadavgFixture  = "1.23 0.98 0.87 3/912 45678\n"
	uptimeFixture   = "123456.78 987654.32\n"
	freeFixture     = `              total        used        free      shared  buff/cache   available
Mem:          15990        3210        8190         123        4589       12100
Swap:          2047           0        2047
`
	dfFixture = `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        98G   45G   49G  48% /
tmpfs           7.8G  1.2M  7.8G   1% /run
`
	// 两次采样:idle 增 150,total 增 200 → 占用 25%
	cpuStatFixture = `cpu  100 0 0 400 0 0 0 0 0 0
cpu0 100 0 0 400 0 0 0 0 0 0
cpu  150 0 0 550 0 0 0 0 0 0
cpu0 150 0 0 550 0 0 0 0 0 0
`
)

func TestSystemParsers(t *testing.T) {
	if got := extractQuoted(osReleaseFixture); got != "Ubuntu 22.04.3 LTS" {
		t.Fatalf("OS 解析异常: %q", got)
	}
	// 解析器不过滤公网 IP(过滤在 ListSystemInfo 中完成)
	if got := parseHostnameI(hostnameIFixture); len(got) != 3 || got[0] != "10.0.0.5" || got[1] != "203.0.113.42" || got[2] != "172.17.0.1" {
		t.Fatalf("IP 解析异常: %v", got)
	}
	var info SystemInfo
	parseFree(freeFixture, &info)
	if info.MemTotalMB != 15990 || info.MemUsedMB != 3210 {
		t.Fatalf("内存解析异常: %+v", info)
	}
	if info.MemUsage < 20.0 || info.MemUsage > 20.1 { // 3210/15990 ≈ 20.08%
		t.Fatalf("内存占用率异常: %.2f", info.MemUsage)
	}
	if info.SwapTotalMB != 2047 || info.SwapUsedMB != 0 {
		t.Fatalf("swap 解析异常: %+v", info)
	}
	disks := parseDf(dfFixture)
	if len(disks) != 2 || disks[0].Mount != "/" || disks[0].UsePct != 48 || disks[1].Mount != "/run" {
		t.Fatalf("磁盘解析异常: %+v", disks)
	}
	if got := cpuUsageFromSamples(cpuStatFixture); got < 24.9 || got > 25.1 {
		t.Fatalf("CPU 占用率应为 25%%,实际 %.2f", got)
	}
	if cpuUsageFromSamples("") != 0 || cpuUsageFromSamples("cpu  1 0 0 1 0 0 0 0 0 0\n") != 0 {
		t.Fatal("采样不足应返回 0")
	}
}

func TestParsePublicIP(t *testing.T) {
	if got := parsePublicIP("203.0.113.42\n"); got != "203.0.113.42" {
		t.Fatalf("公网 IP 解析异常: %q", got)
	}
	if got := parsePublicIP("<html>error</html>"); got != "" {
		t.Fatalf("脏输出应返回空: %q", got)
	}
	if got := parsePublicIP("   \n"); got != "" {
		t.Fatalf("空输出应返回空: %q", got)
	}
}

// TestListSystemInfoEndToEnd 经 exec 测试服务器采集完整系统信息。
func TestListSystemInfoEndToEnd(t *testing.T) {
	addr, _ := startSystemServer(t)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	info, err := mgr.ListSystemInfo(ts.ID)
	if err != nil {
		t.Fatalf("采集失败: %v", err)
	}
	if info.OS != "Ubuntu 22.04.3 LTS" || info.Kernel != "5.15.0-91-generic" {
		t.Fatalf("系统/内核异常: %+v", info)
	}
	if info.Hostname != "web-01" || len(info.IPs) != 2 || info.IPs[1] != "172.17.0.1" {
		t.Fatalf("主机名/IP 异常: %+v", info)
	}
	if info.PublicIP != "203.0.113.42" {
		t.Fatalf("公网 IP 异常: %q", info.PublicIP)
	}
	if info.CPUCores != 8 || info.Load1 != 1.23 {
		t.Fatalf("核数/负载异常: %+v", info)
	}
	if info.UptimeSecs != 123456 {
		t.Fatalf("运行时长异常: %d", info.UptimeSecs)
	}
	if info.MemTotalMB != 15990 || info.CPUUsage < 24.9 || info.CPUUsage > 25.1 {
		t.Fatalf("内存/CPU 异常: %+v", info)
	}
	if len(info.Disks) != 2 || info.Disks[0].UsePct != 48 {
		t.Fatalf("磁盘异常: %+v", info.Disks)
	}
}

// startSystemServer 对系统信息相关命令返回夹具输出的 exec 测试服务器。
func startSystemServer(t *testing.T) (addr string, _ *[]string) {
	return startExecServerFunc(t, map[string]string{
		"PRETTY_NAME": osReleaseFixture,
		"uname":       unameFixture,
		"hostname -I": hostnameIFixture,
		"hostname":    hostnameFixture,
		"ifconfig.me": "203.0.113.42\n",
		"nproc":       nprocFixture,
		"/proc/loadavg": loadavgFixture,
		"/proc/uptime": uptimeFixture,
		"free":        freeFixture,
		"df":          dfFixture,
		"/proc/stat":  cpuStatFixture,
	})
}

// startExecServerFunc 按"命令关键词 → 输出"构造 exec 测试服务器;kill 命令被记录。
func startExecServerFunc(t *testing.T, responses map[string]string) (string, *[]string) {
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

	log := &[]string{}
	var mu sync.Mutex

	// 命令匹配按 key 长度降序:避免 "hostname" 先于 "hostname -I" 命中
	keys := make([]string, 0, len(responses))
	for k := range responses {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return len(keys[i]) > len(keys[j]) })

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
								for _, key := range keys {
									if strings.Contains(cmd, key) {
										resp = responses[key]
										break
									}
								}
								if strings.HasPrefix(cmd, "kill ") || strings.HasPrefix(cmd, "systemctl ") {
									mu.Lock()
									*log = append(*log, cmd)
									mu.Unlock()
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
	return ln.Addr().String(), log
}
