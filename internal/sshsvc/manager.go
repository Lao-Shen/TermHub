package sshsvc

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/net/proxy"
)

// ErrSessionNotFound 会话不存在。
var ErrSessionNotFound = errors.New("会话不存在")

const (
	// DefaultRows/DefaultCols 新建 pty 的初始尺寸,
	// 前端终端挂载后马上会按实际窗口 resize 一次。
	DefaultRows = 24
	DefaultCols = 80
)

// Manager 管理全部终端会话,是领域层对外的唯一入口。
// OnOutput/OnExit 由桥接层注入,领域层不感知 UI 与网络分发方式。
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*TerminalSession
	// monitors 每会话的流量采样器(随会话创建/销毁)。
	monitors map[string]*trafficMonitor

	// keepAlive 保活心跳间隔;<=0 关闭保活。测试可调小。
	keepAlive time.Duration
	// trafficInterval 流量采样间隔;<=0 关闭采样。测试可调小。
	trafficInterval time.Duration

	// OnOutput 会话输出(来自远端 stdout/stderr 合并流)。
	// 在输出 goroutine 中串行调用;消费方应尽快返回以施加背压。
	OnOutput func(sessionID string, data []byte)
	// OnExit 会话结束(远端退出/用户断开/网络错误),reason 面向用户。
	OnExit func(sessionID string, reason string)
	// OnTraffic 流量采样回调(每采样间隔一次,携带各网卡当前速率)。
	OnTraffic func(sessionID string, samples []TrafficSample)
}

// defaultKeepAlive 默认保活间隔:防止挂机被服务器踢下线。
const defaultKeepAlive = 30 * time.Second

// NewManager 创建会话管理器。
func NewManager() *Manager {
	return &Manager{
		sessions:        make(map[string]*TerminalSession),
		monitors:        make(map[string]*trafficMonitor),
		keepAlive:       defaultKeepAlive,
		trafficInterval: defaultTrafficInterval,
	}
}

// OpenTerminal 按配置建立 SSH 连接并打开交互式 shell。
//
// 首次连接(cfg.TrustedHostKey 为空)时:完成握手获取指纹后主动断开,
// 返回 ErrHostKeyUnknown,由上层请用户确认指纹;
// 确认后以 TrustedHostKey 重试即可直接建立会话。
func (m *Manager) OpenTerminal(cfg ConnectionConfig) (*TerminalSession, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	client, jump, fp, err := dial(cfg)
	if err != nil {
		return nil, err
	}
	_ = jump // 跳板连接随会话持有(见 TerminalSession)
	if cfg.TrustedHostKey == "" {
		// TOFU:断开连接,等用户确认指纹后再来。
		_ = client.Close()
		return nil, ErrHostKeyUnknown{Fingerprint: fp, Host: cfg.Host, Port: cfg.PortOrDefault()}
	}

	sess, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("创建会话失败: %w", err)
	}
	if err := sess.RequestPty("xterm-256color", DefaultRows, DefaultCols, ssh.TerminalModes{
		ssh.ECHO:          1, // 远端回显由终端自身处理
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("申请 pty 失败: %w", err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("打开输入通道失败: %w", err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("打开输出通道失败: %w", err)
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("打开错误通道失败: %w", err)
	}
	if err := sess.Shell(); err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("启动 shell 失败: %w", err)
	}

	ts := &TerminalSession{
		ID:                 newID(),
		Config:             cfg,
		HostKeyFingerprint: fp,
		client:             client,
		jump:               jump,
		sess:               sess,
		stdin:              stdin,
		onOutput:           m.OnOutput,
		onExit:             m.OnExit,
	}

	m.mu.Lock()
	m.sessions[ts.ID] = ts
	m.mu.Unlock()

	// 保活心跳:周期发送 keepalive 请求,无响应视为连接死亡。
	if m.keepAlive > 0 {
		go m.keepAliveLoop(ts)
	}

	// 流量采样:随会话启动,供"流量监控"视图使用(2s 一次,负载可忽略)。
	if m.trafficInterval > 0 {
		m.startTrafficMonitor(ts)
	}

	// 输出 goroutine:合并 stdout/stderr 单路送出,保证写序稳定。
	go func() {
		_, _ = io.Copy(outputSink{ts: ts}, io.MultiReader(stdout, stderr))
	}()

	// 等待 goroutine:会话结束的唯一清理路径。
	go func() {
		err := sess.Wait()
		m.remove(ts.ID)
		ts.Close()

		reason := "会话已结束"
		switch {
		case ts.finalReason() != "":
			reason = ts.finalReason()
		case ts.wasClosedByUser():
			reason = "已断开连接"
		case err != nil:
			var ee *ssh.ExitError
			if errors.As(err, &ee) {
				reason = fmt.Sprintf("远端退出,退出码 %d", ee.ExitStatus())
			} else {
				reason = err.Error()
			}
		}
		if ts.onExit != nil {
			ts.onExit(ts.ID, reason)
		}
	}()

	return ts, nil
}

// Get 按 ID 获取会话。
func (m *Manager) Get(id string) (*TerminalSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ts, ok := m.sessions[id]
	if !ok {
		return nil, ErrSessionNotFound
	}
	return ts, nil
}

// Close 主动断开指定会话;清理与事件由等待 goroutine 完成。
func (m *Manager) Close(id string) error {
	ts, err := m.Get(id)
	if err != nil {
		return err
	}
	ts.closeByUser()
	return nil
}

// Sessions 返回当前全部会话快照(顺序不定)。
func (m *Manager) Sessions() []SessionInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SessionInfo, 0, len(m.sessions))
	for _, ts := range m.sessions {
		out = append(out, ts.Info())
	}
	return out
}

func (m *Manager) remove(id string) {
	m.mu.Lock()
	delete(m.sessions, id)
	m.mu.Unlock()
	// 会话销毁,停止流量采样
	m.stopTrafficMonitor(id)
}

// keepAliveTimeout 单次 keepalive 请求的看门狗超时:服务器不应答即判定死亡。
const keepAliveTimeout = 5 * time.Second

// keepAliveLoop 周期发送 keepalive 心跳;请求失败或超时视为连接死亡,
// 关闭会话(等待 goroutine 统一走 onExit 通知上层)。
func (m *Manager) keepAliveLoop(ts *TerminalSession) {
	ticker := time.NewTicker(m.keepAlive)
	defer ticker.Stop()
	for range ticker.C {
		if ts.isClosed() {
			return
		}
		result := make(chan error, 1) // 缓冲避免超时路径上 goroutine 泄漏
		go func() {
			_, _, err := ts.client.SendRequest("keepalive@openssh.com", true, nil)
			result <- err
		}()
		select {
		case err := <-result:
			if err != nil {
				ts.closeWithReason("连接已断开(保活失败)")
				return
			}
			// 心跳成功,继续下一轮
		case <-time.After(keepAliveTimeout):
			ts.closeWithReason("连接已断开(服务器无响应)")
			return
		}
	}
}

// sshHandshakeTimeout SSH 协议握手(版本交换 + 密钥交换 + 认证)的上限。
// 注意:ssh.ClientConfig.Timeout 只作用于 ssh.Dial 内部的 TCP 拨号,而我们用
// 「手动 TCP(可经代理)+ ssh.NewClientConn」,Timeout 对握手阶段无效 —— 对端
// TCP 建连后不再发数据(代理/落地节点黑洞、被防火墙静默丢弃)时,握手会永久
// 挂起,界面一直显示「连接中」。故必须在连接上显式设截止。
// 变量而非常量:单元测试可缩短以验证超时行为。
var sshHandshakeTimeout = 15 * time.Second

// handshakeErr 包装 SSH 握手错误。经代理时若表现为「读超时」,说明到代理的
// TCP/CONNECT 已经成功,但目标始终没回数据 —— 常见于代理节点无法访问目标
// (尤其 22 端口),或 Clash 规则把该地址判成直连/被拦;给出可操作提示。
func handshakeErr(cfg ConnectionConfig, addr string, err error) error {
	base := fmt.Errorf("与主机 %s 握手失败: %w", addr, err)
	if cfg.Proxy == nil || !isTimeoutErr(err) {
		return base
	}
	return fmt.Errorf(
		"%w；代理 %s:%d 已建立连接但目标无响应:通常是该代理节点无法访问 %s(或服务器端口被拦截),也可能是 Clash 规则未把该地址走代理。可更换节点,或把 Clash 切到全局(Global)模式验证",
		base, cfg.Proxy.Host, cfg.Proxy.Port, addr,
	)
}

// isTimeoutErr 判断错误是否超时。x/crypto/ssh 的 NewClientConn 用字符串拼接
// 包装底层错误(非 %w),errors.As 不一定能取到 net.Error,故兼容文本匹配。
func isTimeoutErr(err error) bool {
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	s := err.Error()
	return strings.Contains(s, "i/o timeout") || strings.Contains(s, "deadline exceeded")
}

// dial 完成 TCP + SSH 握手,返回目标客户端、跳板客户端(无跳板为 nil)与目标指纹。
// 传输层代理(cfg.Proxy,如本地 Clash)作用于本机发出的 TCP 连接:
//
//	直连 → 代理 → 目标机;
//	有跳板 → 代理 → 跳板机 →(跳板网络内)目标机。
func dial(cfg ConnectionConfig) (*ssh.Client, *ssh.Client, string, error) {
	d, err := transportDialer(cfg.Proxy)
	if err != nil {
		return nil, nil, "", err
	}
	if cfg.ProxyJump != nil {
		return dialViaJump(cfg, d)
	}
	client, fp, err := dialTarget(cfg, d, nil)
	return client, nil, fp, err
}

// dialTarget 与目标机握手:rawConn 来自传输拨号器(直连)或跳板转发通道。
// 目标机指纹 TOFU 在此处理。
func dialTarget(cfg ConnectionConfig, d proxy.Dialer, jump *ssh.Client) (*ssh.Client, string, error) {
	auth, err := authMethods(cfg)
	if err != nil {
		return nil, "", err
	}
	var fp string
	cc := &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            auth,
		HostKeyCallback: cfg.hostKeyCallback(&fp),
		Timeout:         15 * time.Second,
	}
	addr := net.JoinHostPort(cfg.Host, fmt.Sprint(cfg.PortOrDefault()))

	var rawConn net.Conn
	if jump != nil {
		rawConn, err = jump.Dial("tcp", addr)
		if err != nil {
			return nil, "", fmt.Errorf("经跳板机转发到 %s 失败(跳板机可能未开启 TCP 转发): %w", addr, err)
		}
	} else {
		rawConn, err = dialWithTimeout(d, "tcp", addr)
		if err != nil {
			return nil, "", fmt.Errorf("连接 %s 失败: %w", addr, err)
		}
	}

	// 握手截止(见 sshHandshakeTimeout):TCP 已建连但对端不回应时避免永久挂起。
	_ = rawConn.SetDeadline(time.Now().Add(sshHandshakeTimeout))
	conn, chans, reqs, err := ssh.NewClientConn(rawConn, addr, cc)
	_ = rawConn.SetDeadline(time.Time{}) // 握手完成,清除截止(否则会掐断后续会话)
	if err != nil {
		_ = rawConn.Close()
		return nil, "", handshakeErr(cfg, addr, err)
	}
	if cfg.TrustedHostKey == "" {
		_ = conn.Close()
		return nil, "", ErrHostKeyUnknown{
			Fingerprint: fp,
			Host:        cfg.Host,
			Port:        cfg.PortOrDefault(),
		}
	}
	return ssh.NewClient(conn, chans, reqs), fp, nil
}

// dialViaJump 经跳板机连接目标(OpenSSH -J 语义):跳板连接经传输拨号器建立,
// 跳板连接必须与目标会话同生命周期(隧道依赖它),由调用方持有并随会话关闭。
func dialViaJump(cfg ConnectionConfig, d proxy.Dialer) (*ssh.Client, *ssh.Client, string, error) {
	jumpCfg := ConnectionConfig{
		Host:           cfg.ProxyJump.Host,
		Port:           cfg.ProxyJump.Port,
		User:           cfg.ProxyJump.User,
		Auth:           cfg.ProxyJump.Auth,
		Password:       cfg.ProxyJump.Password,
		KeyPath:        cfg.ProxyJump.KeyPath,
		TrustedHostKey: cfg.ProxyJump.TrustedHostKey,
	}
	jumpAuth, err := authMethods(jumpCfg)
	if err != nil {
		return nil, nil, "", fmt.Errorf("跳板机配置无效: %w", err)
	}
	var jumpFP string
	jumpCC := &ssh.ClientConfig{
		User:            jumpCfg.User,
		Auth:            jumpAuth,
		HostKeyCallback: jumpCfg.hostKeyCallback(&jumpFP),
		Timeout:         15 * time.Second,
	}
	jumpAddr := net.JoinHostPort(cfg.ProxyJump.Host, fmt.Sprint(cfg.ProxyJump.PortOrDefault()))
	jumpRawConn, err := dialWithTimeout(d, "tcp", jumpAddr)
	if err != nil {
		return nil, nil, "", fmt.Errorf("连接跳板机 %s 失败: %w", jumpAddr, err)
	}
	// 跳板机握手同样设截止。
	_ = jumpRawConn.SetDeadline(time.Now().Add(sshHandshakeTimeout))
	jumpConn, chans, reqs, err := ssh.NewClientConn(jumpRawConn, jumpAddr, jumpCC)
	_ = jumpRawConn.SetDeadline(time.Time{})
	if err != nil {
		_ = jumpRawConn.Close()
		return nil, nil, "", fmt.Errorf("与跳板机 %s 握手失败: %w", jumpAddr, err)
	}
	if cfg.ProxyJump.TrustedHostKey == "" {
		_ = jumpConn.Close()
		return nil, nil, "", ErrHostKeyUnknown{
			Fingerprint: jumpFP,
			Host:        cfg.ProxyJump.Host,
			Port:        cfg.ProxyJump.PortOrDefault(),
			IsProxy:     true,
		}
	}
	jump := ssh.NewClient(jumpConn, chans, reqs)

	client, fp, err := dialTarget(cfg, d, jump)
	if err != nil {
		_ = jump.Close()
		return nil, nil, "", err
	}
	return client, jump, fp, nil
}

// authMethods 按配置组装认证方法。
func authMethods(cfg ConnectionConfig) ([]ssh.AuthMethod, error) {
	switch cfg.Auth {
	case AuthPassword:
		return []ssh.AuthMethod{ssh.Password(cfg.Password)}, nil
	case AuthPrivateKey:
		keyBytes, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("读取私钥文件失败: %w", err)
		}
		signer, err := ssh.ParsePrivateKey(keyBytes)
		if err != nil {
			if errors.Is(err, &ssh.PassphraseMissingError{}) {
				return nil, fmt.Errorf("私钥已加密,暂不支持密码短语,请先用 ssh-keygen 去除密码")
			}
			return nil, fmt.Errorf("解析私钥失败: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	default:
		return nil, fmt.Errorf("未知认证方式: %s", cfg.Auth)
	}
}

// newID 生成 8 字节随机十六进制会话 ID。
func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
