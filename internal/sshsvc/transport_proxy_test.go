package sshsvc

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// bridgeConns 双向桥接两连接,任一侧结束即关闭两侧。
func bridgeConns(a, b net.Conn) {
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(a, b); done <- struct{}{} }()
	go func() { _, _ = io.Copy(b, a); done <- struct{}{} }()
	<-done
	_ = a.Close()
	_ = b.Close()
}

// startSocks5Server 极简 SOCKS5 服务器(无认证,仅 CONNECT)。
func startSocks5Server(t *testing.T) string {
	t.Helper()
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
			go handleSocks5Conn(conn)
		}
	}()
	return ln.Addr().String()
}

func handleSocks5Conn(conn net.Conn) {
	defer conn.Close()
	buf := make([]byte, 262)

	// 握手:VER NMETHODS METHODS → 应答"无认证"
	if _, err := io.ReadFull(conn, buf[:2]); err != nil {
		return
	}
	if _, err := io.ReadFull(conn, buf[:int(buf[1])]); err != nil {
		return
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return
	}

	// 请求:VER CMD RSV ATYP [ADDR] PORT
	if _, err := io.ReadFull(conn, buf[:4]); err != nil {
		return
	}
	if buf[1] != 0x01 { // 仅支持 CONNECT
		_, _ = conn.Write([]byte{0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	var host string
	switch buf[3] {
	case 0x01: // IPv4
		if _, err := io.ReadFull(conn, buf[:4]); err != nil {
			return
		}
		host = net.IP(buf[:4]).String()
	case 0x03: // 域名
		if _, err := io.ReadFull(conn, buf[:1]); err != nil {
			return
		}
		if _, err := io.ReadFull(conn, buf[:int(buf[0])]); err != nil {
			return
		}
		host = string(buf[:int(buf[0])])
	case 0x04: // IPv6
		if _, err := io.ReadFull(conn, buf[:16]); err != nil {
			return
		}
		host = net.IP(buf[:16]).String()
	default:
		return
	}
	if _, err := io.ReadFull(conn, buf[:2]); err != nil {
		return
	}
	port := binary.BigEndian.Uint16(buf[:2])

	target, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(int(port))), 5*time.Second)
	if err != nil {
		_, _ = conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	defer target.Close()
	if _, err := conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}
	bridgeConns(conn, target)
}

// startHTTPConnectServer 极简 HTTP CONNECT 隧道服务器。
func startHTTPConnectServer(t *testing.T) string {
	t.Helper()
	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodConnect {
				http.Error(w, "only CONNECT", http.StatusMethodNotAllowed)
				return
			}
			target, err := net.DialTimeout("tcp", r.Host, 5*time.Second)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			hj, ok := w.(http.Hijacker)
			if !ok {
				http.Error(w, "no hijack support", http.StatusInternalServerError)
				_ = target.Close()
				return
			}
			clientConn, _, err := hj.Hijack()
			if err != nil {
				_ = target.Close()
				return
			}
			if _, err := clientConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
				_ = clientConn.Close()
				_ = target.Close()
				return
			}
			bridgeConns(clientConn, target)
		}),
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败: %v", err)
	}
	t.Cleanup(func() { _ = srv.Close() })
	go func() { _ = srv.Serve(ln) }()
	return ln.Addr().String()
}

func transportProxyCfg(addr, proxyAddr string, ptype ProxyType) ConnectionConfig {
	cfg := testCfg(addr)
	host, port, _ := net.SplitHostPort(proxyAddr)
	cfg.Proxy = &TransportProxy{Type: ptype, Host: host, Port: mustPort(port)}
	return cfg
}

// openViaTransport 消化目标机单级 TOFU 后建立会话(传输代理不产生跳板指纹)。
func openViaTransport(t *testing.T, mgr *Manager, cfg *ConnectionConfig) *TerminalSession {
	t.Helper()
	_, err := mgr.OpenTerminal(*cfg)
	var unknown ErrHostKeyUnknown
	if !errors.As(err, &unknown) {
		t.Fatalf("首次连接应返回指纹待确认,实际: %v", err)
	}
	if unknown.IsProxy {
		t.Fatal("传输代理不应产生跳板指纹确认")
	}
	cfg.TrustedHostKey = unknown.Fingerprint
	ts, err := mgr.OpenTerminal(*cfg)
	if err != nil {
		t.Fatalf("经代理建立会话失败: %v", err)
	}
	return ts
}

// TestTransportProxySocks5 经 SOCKS5 代理连接 + SFTP 走代理。
func TestTransportProxySocks5(t *testing.T) {
	targetAddr, sftpRoot := startTestServer(t, nil)
	proxyAddr := startSocks5Server(t)

	mgr := NewManager()
	cfg := transportProxyCfg(targetAddr, proxyAddr, ProxyTypeSOCKS5)

	ts := openViaTransport(t, mgr, &cfg)
	defer mgr.Close(ts.ID)

	if _, err := ts.Write([]byte("ls\n")); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	fs := NewRemoteFS(mgr)
	if _, err := fs.ListDir(ts.ID, posixRemoteRoot(sftpRoot)); err != nil {
		t.Fatalf("经 SOCKS5 代理列举目录失败: %v", err)
	}
}

// TestTransportProxyHTTP 经 HTTP CONNECT 代理连接。
func TestTransportProxyHTTP(t *testing.T) {
	targetAddr, sftpRoot := startTestServer(t, nil)
	proxyAddr := startHTTPConnectServer(t)

	mgr := NewManager()
	cfg := transportProxyCfg(targetAddr, proxyAddr, ProxyTypeHTTP)

	ts := openViaTransport(t, mgr, &cfg)
	defer mgr.Close(ts.ID)

	if _, err := ts.Write([]byte("ls\n")); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	fs := NewRemoteFS(mgr)
	if _, err := fs.ListDir(ts.ID, posixRemoteRoot(sftpRoot)); err != nil {
		t.Fatalf("经 HTTP 代理列举目录失败: %v", err)
	}
}

// TestTransportProxyWithJump 传输代理 + 跳板机叠加:代理 → 跳板 → 目标。
func TestTransportProxyWithJump(t *testing.T) {
	targetAddr, _ := startTestServer(t, nil)
	jumpAddr := startJumpServer(t)
	proxyAddr := startSocks5Server(t)

	mgr := NewManager()
	cfg := proxyCfg(targetAddr, jumpAddr)
	pHost, pPort, _ := net.SplitHostPort(proxyAddr)
	cfg.Proxy = &TransportProxy{Type: ProxyTypeSOCKS5, Host: pHost, Port: mustPort(pPort)}

	ts := openViaProxy(t, mgr, &cfg) // 两级 TOFU(跳板 → 目标)
	defer mgr.Close(ts.ID)

	if _, err := ts.Write([]byte("ls\n")); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	if err := ts.Resize(30, 120); err != nil {
		t.Fatalf("调整尺寸失败: %v", err)
	}
}

// TestTransportProxyInvalidType 未知代理类型应报错。
func TestTransportProxyInvalidType(t *testing.T) {
	targetAddr, _ := startTestServer(t, nil)
	mgr := NewManager()
	cfg := testCfg(targetAddr)
	cfg.Proxy = &TransportProxy{Type: ProxyType("bogus"), Host: "127.0.0.1", Port: 7897}

	if _, err := mgr.OpenTerminal(cfg); err == nil {
		t.Fatal("未知代理类型应报错")
	}
}
