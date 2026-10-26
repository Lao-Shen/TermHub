package sshsvc

import (
	"net"
	"testing"
	"time"

	"golang.org/x/net/proxy"
)

// TestDialTargetHandshakeTimeout 回归:TCP 建连后对端不再发送任何数据
// (代理/落地节点黑洞、被防火墙静默丢弃)时,SSH 握手必须超时返回错误,
// 而不是永久挂起(前端一直转圈「连接中」)。
// 背景:ssh.ClientConfig.Timeout 只作用于 ssh.Dial 内部的 TCP 拨号,
// 走「手动 TCP + ssh.NewClientConn」时对握手阶段无效。
func TestDialTargetHandshakeTimeout(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	// 接受连接但从不发送 SSH 版本串(模拟黑洞对端)。
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				time.Sleep(3 * time.Second)
				_ = c.Close()
			}(c)
		}
	}()

	old := sshHandshakeTimeout
	sshHandshakeTimeout = 300 * time.Millisecond
	t.Cleanup(func() { sshHandshakeTimeout = old })

	host, portStr, _ := net.SplitHostPort(ln.Addr().String())
	cfg := ConnectionConfig{
		Host:     host,
		Port:     mustPort(portStr),
		User:     "u",
		Auth:     AuthPassword,
		Password: "p",
	}

	start := time.Now()
	_, _, err = dialTarget(cfg, proxy.Direct, nil)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("对端不回应时应握手超时,实际却成功")
	}
	if elapsed > 3*time.Second {
		t.Fatalf("握手超时过久(%v),deadline 未生效", elapsed)
	}
}
