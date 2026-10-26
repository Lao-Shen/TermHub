package sshsvc

import (
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/ssh"
)

// ExecResult 远端命令(exec 通道)执行结果:合并输出 + 退出码(精确判定完成)。
type ExecResult struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

// defaultExecCommandTimeout 命令组"常规命令"步的默认超时(命令可能较慢,如服务重启)。
const defaultExecCommandTimeout = 10 * time.Minute

// ExecCommand 在既有会话的 SSH 连接上另开 exec 通道执行命令,
// 返回合并输出与退出码(非零退出不算错误);超时/通道失败返回错误。
// 与交互终端无关:不通共享 shell 状态,但完成判定精确(命令组"常规命令"步用)。
func (m *Manager) ExecCommand(sessionID, cmd string, timeoutSecs int) (ExecResult, error) {
	ts, err := m.Get(sessionID)
	if err != nil {
		return ExecResult{}, err
	}
	timeout := defaultExecCommandTimeout
	if timeoutSecs > 0 {
		timeout = time.Duration(timeoutSecs) * time.Second
	}
	return ts.runExecChannel(cmd, timeout)
}

// runExecChannel 另开通道执行并等待结束。
func (t *TerminalSession) runExecChannel(cmd string, timeout time.Duration) (ExecResult, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return ExecResult{}, ErrSessionClosed
	}
	client := t.client
	t.mu.Unlock()

	sess, err := client.NewSession()
	if err != nil {
		return ExecResult{}, fmt.Errorf("创建执行通道失败: %w", err)
	}
	defer sess.Close()

	type result struct {
		out string
		err error
	}
	done := make(chan result, 1)
	go func() {
		out, err := sess.CombinedOutput(cmd)
		done <- result{out: string(out), err: err}
	}()

	select {
	case r := <-done:
		if r.err != nil {
			var ee *ssh.ExitError
			if errors.As(r.err, &ee) {
				return ExecResult{Output: r.out, ExitCode: ee.ExitStatus()}, nil
			}
			return ExecResult{}, fmt.Errorf("命令执行失败(%s): %w", cmd, r.err)
		}
		return ExecResult{Output: r.out, ExitCode: 0}, nil
	case <-time.After(timeout):
		_ = sess.Close()
		return ExecResult{}, fmt.Errorf("命令执行超时: %s", cmd)
	}
}
