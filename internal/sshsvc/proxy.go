package sshsvc

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"golang.org/x/net/proxy"
)

// transportDialer 构造传输层拨号器;nil 代理时返回直连。
func transportDialer(p *TransportProxy) (proxy.Dialer, error) {
	if p == nil {
		return proxy.Direct, nil
	}
	switch p.Type {
	case ProxyTypeSOCKS5:
		return proxy.SOCKS5("tcp", p.addr(), nil, proxy.Direct)
	case ProxyTypeHTTP:
		return &httpConnectDialer{addr: p.addr()}, nil
	default:
		return nil, fmt.Errorf("不支持的代理类型: %s", p.Type)
	}
}

func (p TransportProxy) addr() string {
	return net.JoinHostPort(p.Host, fmt.Sprint(p.Port))
}

// dialWithTimeout 经拨号器建立 TCP 连接,带 15s 超时(代理握手可能挂起)。
func dialWithTimeout(d proxy.Dialer, network, addr string) (net.Conn, error) {
	type result struct {
		conn net.Conn
		err  error
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if cd, ok := d.(proxy.ContextDialer); ok {
		return cd.DialContext(ctx, network, addr)
	}

	// 非 ContextDialer 实现:goroutine + 看门狗
	done := make(chan result, 1)
	go func() {
		conn, err := d.Dial(network, addr)
		done <- result{conn, err}
	}()
	select {
	case r := <-done:
		return r.conn, r.err
	case <-ctx.Done():
		return nil, fmt.Errorf("连接 %s 超时(经代理 %v)", addr, ctx.Err())
	}
}

// httpConnectDialer 基于 HTTP CONNECT 的隧道拨号器。
// x/net/proxy 只内置 SOCKS,HTTP 代理按 RFC 7231 自行实现。
type httpConnectDialer struct {
	addr string
}

func (d *httpConnectDialer) Dial(network, target string) (net.Conn, error) {
	return d.DialContext(context.Background(), network, target)
}

// DialContext 实现 proxy.ContextDialer:整个 CONNECT 交换受 ctx 约束。
// 旧实现不走 ContextDialer,只能由上层用 goroutine 看门狗兜底,超时后
// 连接与 goroutine 会泄漏;这里改为可取消并给 CONNECT 响应设截止。
func (d *httpConnectDialer) DialContext(ctx context.Context, network, target string) (net.Conn, error) {
	nd := net.Dialer{Timeout: 10 * time.Second}
	conn, err := nd.DialContext(ctx, network, d.addr)
	if err != nil {
		return nil, fmt.Errorf("连接 HTTP 代理 %s 失败: %w", d.addr, err)
	}
	// 代理接受 TCP 后可能不回包:用 ctx 的截止时间约束 CONNECT 交换。
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	req := fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\nProxy-Connection: Keep-Alive\r\n\r\n", target, target)
	if _, err := conn.Write([]byte(req)); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("向 HTTP 代理发送 CONNECT 失败: %w", err)
	}
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, &http.Request{Method: "CONNECT"})
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("HTTP 代理响应异常: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = conn.Close()
		return nil, fmt.Errorf("HTTP 代理拒绝连接: %s", resp.Status)
	}
	_ = conn.SetDeadline(time.Time{}) // 清除握手截止,SSH 握手由上层另行设限
	// 响应头之后可能已有目标侧数据缓冲在 br 中,包一层不丢字节
	return &bufferedConn{Conn: conn, r: br}, nil
}

// bufferedConn 让 bufio.Reader 的缓冲先于底层连接被消费。
type bufferedConn struct {
	net.Conn
	r *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) {
	return c.r.Read(p)
}
