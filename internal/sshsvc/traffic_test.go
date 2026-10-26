package sshsvc

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

const netDevFixture = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:    1000     10    0    0    0     0          0         0     1000     10    0    0    0     0       0          0
  eth0: 5000000  30000    0    0    0     0          0         0  2500000  20000    0    0    0     0       0          0
docker0:       0      0    0    0    0     0          0         0        0      0    0    0    0     0       0          0
`

func TestParseNetDev(t *testing.T) {
	devs := parseNetDev(netDevFixture)
	if len(devs) != 3 {
		t.Fatalf("应解析出 3 个网卡,实际 %d", len(devs))
	}
	if devs["eth0"] != [2]int64{5000000, 2500000} {
		t.Fatalf("eth0 解析异常: %v", devs["eth0"])
	}
	if devs["lo"] != [2]int64{1000, 1000} {
		t.Fatalf("lo 解析异常: %v", devs["lo"])
	}
	if devs["docker0"] != [2]int64{0, 0} {
		t.Fatalf("docker0 解析异常: %v", devs["docker0"])
	}
}

// startTrafficServer /proc/net/dev 每次读取返回递增的字节数(模拟持续流量)。
func startTrafficServer(t *testing.T) string {
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

	var calls atomic.Int64
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
								if strings.Contains(cmd, "/proc/net/dev") {
									n := calls.Add(1)
									// 每 tick 增加固定流量:rx +200000, tx +100000
									resp := fmt.Sprintf(
										"Inter-|   Receive                                                |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n  eth0: %d  100    0    0    0     0          0         0   %d   50    0    0    0     0       0          0\n",
										n*200000, n*100000,
									)
									_, _ = ch.Write([]byte(resp))
								}
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
	return ln.Addr().String()
}

// TestTrafficMonitor 端到端:采样器自动启动、速率计算、历史滚动。
func TestTrafficMonitor(t *testing.T) {
	addr := startTrafficServer(t)
	mgr := NewManager()
	mgr.trafficInterval = 100 * time.Millisecond // 测试加速

	// 记录实时回调
	sampleCh := make(chan []TrafficSample, 64)
	mgr.OnTraffic = func(_ string, samples []TrafficSample) { sampleCh <- samples }

	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	// 等待若干次采样;首个采样无前值速率必为 0,后续应出现正速率
	var got, positive int
	deadline := time.After(3 * time.Second)
	for got < 5 {
		select {
		case samples := <-sampleCh:
			got++
			for _, s := range samples {
				if s.Iface == "eth0" && s.RXRate > 0 && s.TXRate > 0 {
					positive++
				}
			}
		case <-deadline:
			t.Fatalf("等待采样超时(收到 %d 次)", got)
		}
	}
	if positive < 3 {
		t.Fatalf("正速率采样不足: %d", positive)
	}

	// 历史快照应包含多次采样
	snap, err := mgr.GetTrafficSnapshot(ts.ID)
	if err != nil {
		t.Fatalf("获取快照失败: %v", err)
	}
	if len(snap) < 3 {
		t.Fatalf("历史采样过少: %d", len(snap))
	}

	// 会话关闭后采样停止
	mgr.Close(ts.ID)
	time.Sleep(200 * time.Millisecond)
	after, _ := mgr.GetTrafficSnapshot(ts.ID)
	if after != nil {
		t.Fatal("会话关闭后快照应不可用")
	}
}
