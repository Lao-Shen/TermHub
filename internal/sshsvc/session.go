package sshsvc

import (
	"io"
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// SessionInfo 会话快照(经绑定暴露给前端,不暴露内部句柄)。
type SessionInfo struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Host               string `json:"host"`
	Port               int    `json:"port"`
	User               string `json:"user"`
	HostKeyFingerprint string `json:"hostKeyFingerprint"`
}

// TerminalSession 一个已建立的远程交互式终端会话(pty + shell)。
// 内部并发模型:
//   - 一个输出 goroutine 把 stdout+stderr 合并后经 onOutput 回调送出(写序稳定);
//   - 一个等待 goroutine 在会话结束时触发清理与 onExit 回调。
type TerminalSession struct {
	ID                 string
	Config             ConnectionConfig
	HostKeyFingerprint string

	mu     sync.Mutex
	client *ssh.Client
	// jump 跳板机连接(直连会话为 nil):目标隧道依赖它,须与会话同生命周期。
	jump  *ssh.Client
	sess  *ssh.Session
	stdin io.WriteCloser
	// sftp 懒加载的 SFTP 通道(见 sftp.go),随会话一并关闭。
	sftp   *sftp.Client
	closed bool
	// closedByUser 区分用户主动断开与远端/网络断开。
	closedByUser bool
	// failReason 非用户主动断开时的原因(保活失败/远端退出等),
	// 由等待 goroutine 读取后经 onExit 上报。
	failReason string

	// 回调由 Manager 注入,本结构不关心上层如何消费。
	onOutput func(sessionID string, data []byte)
	onExit   func(sessionID string, reason string)
}

// Info 返回会话快照。
func (t *TerminalSession) Info() SessionInfo {
	return SessionInfo{
		ID:                 t.ID,
		Name:               t.Config.Name,
		Host:               t.Config.Host,
		Port:               t.Config.PortOrDefault(),
		User:               t.Config.User,
		HostKeyFingerprint: t.HostKeyFingerprint,
	}
}

// Write 把前端键盘输入写入远端终端。
func (t *TerminalSession) Write(data []byte) (int, error) {
	if t.stdin == nil {
		return 0, io.ErrClosedPipe
	}
	return t.stdin.Write(data)
}

// Resize 调整远端 pty 行列数。
func (t *TerminalSession) Resize(rows, cols int) error {
	if t.sess == nil {
		return nil
	}
	return t.sess.WindowChange(rows, cols)
}

// Close 关闭会话与底层 SSH 连接(幂等)。
// 实际清理与 onExit 由等待 goroutine 统一完成,避免双路径竞态。
func (t *TerminalSession) Close() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	t.closed = true
	if t.sess != nil {
		_ = t.sess.Close()
	}
	// 顺序关键:先关底层连接,让 SFTP 收包 goroutine 随连接 EOF 退出,
	// 再关 sftp 客户端(其 Close 会等待内部 goroutine 结束,反序会死锁);
	// 跳板连接最后关闭(目标隧道建立在其上)。
	if t.client != nil {
		_ = t.client.Close()
	}
	if t.sftp != nil {
		_ = t.sftp.Close()
	}
	if t.jump != nil {
		_ = t.jump.Close()
	}
}

// closeByUser 标记为用户主动断开并关闭。
func (t *TerminalSession) closeByUser() {
	t.mu.Lock()
	t.closedByUser = true
	t.mu.Unlock()
	t.Close()
}

// closeWithReason 记录原因后关闭(保活失败、网络中断等非用户路径)。
func (t *TerminalSession) closeWithReason(reason string) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.failReason = reason
	t.mu.Unlock()
	t.Close()
}

func (t *TerminalSession) wasClosedByUser() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.closedByUser
}

func (t *TerminalSession) finalReason() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.failReason
}

// isClosed 供外部循环(如保活)检查会话是否已关闭。
func (t *TerminalSession) isClosed() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.closed
}

// outputSink 把 io.Copy 的输出流交给 onOutput 回调。
type outputSink struct{ ts *TerminalSession }

func (s outputSink) Write(p []byte) (int, error) {
	if s.ts.onOutput != nil {
		s.ts.onOutput(s.ts.ID, p)
	}
	return len(p), nil
}
