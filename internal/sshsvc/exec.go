package sshsvc

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ProcessInfo 远端进程条目(ps 解析结果)。
type ProcessInfo struct {
	PID     int     `json:"pid"`
	PPID    int     `json:"ppid"`
	User    string  `json:"user"`
	CPU     float64 `json:"cpu"`
	Mem     float64 `json:"mem"`
	Stat    string  `json:"stat"`
	Command string  `json:"command"`
}

// PortInfo 远端监听端口条目(ss/netstat 解析结果)。
type PortInfo struct {
	Proto   string `json:"proto"`
	Address string `json:"address"`
	PID     int    `json:"pid"`
	Process string `json:"process"`
}

// execTimeout 单次命令执行的看门狗上限。
const execTimeout = 15 * time.Second

// Exec 在既有会话的 SSH 连接上另开通道执行命令(不动交互终端),
// 返回合并输出;命令超时或失败返回错误。
func (t *TerminalSession) Exec(cmd string) (string, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return "", ErrSessionClosed
	}
	client := t.client
	t.mu.Unlock()

	sess, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("创建执行通道失败: %w", err)
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
			return r.out, fmt.Errorf("命令执行失败(%s): %w", cmd, r.err)
		}
		return r.out, nil
	case <-time.After(execTimeout):
		_ = sess.Close()
		return "", fmt.Errorf("命令执行超时: %s", cmd)
	}
}

// ---- 进程管理 ----

// psCmd 列进程:固定 6 列 + 剩余为完整命令行。
const psCmd = "ps -eo pid=,ppid=,user=,%cpu=,%mem=,stat=,args="

// ListProcesses 列出远端进程。
func (m *Manager) ListProcesses(sessionID string) ([]ProcessInfo, error) {
	ts, err := m.Get(sessionID)
	if err != nil {
		return nil, err
	}
	out, err := ts.Exec(psCmd)
	if err != nil {
		return nil, err
	}
	return parseProcesses(out), nil
}

// KillProcess 向远端进程发信号:signal 取 "TERM"(优雅)或 "KILL"(强制)。
func (m *Manager) KillProcess(sessionID string, pid int, signal string) error {
	if pid < 1 {
		return fmt.Errorf("无效的进程号: %d", pid)
	}
	flag := "-" + signal
	switch signal {
	case "TERM", "KILL":
	default:
		return fmt.Errorf("不支持的信号: %s", signal)
	}
	ts, err := m.Get(sessionID)
	if err != nil {
		return err
	}
	out, err := ts.Exec(fmt.Sprintf("kill %s %d", flag, pid))
	if err != nil {
		if strings.TrimSpace(out) != "" {
			return fmt.Errorf("发送信号失败: %s", strings.TrimSpace(out))
		}
		return err
	}
	return nil
}

// parseProcesses 解析 `ps -eo pid=,ppid=,user=,%cpu=,%mem=,stat=,args=` 输出。
func parseProcesses(out string) []ProcessInfo {
	var list []ProcessInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		pid, _ := strconv.Atoi(fields[0])
		ppid, _ := strconv.Atoi(fields[1])
		cpu, _ := strconv.ParseFloat(fields[3], 64)
		mem, _ := strconv.ParseFloat(fields[4], 64)
		list = append(list, ProcessInfo{
			PID:     pid,
			PPID:    ppid,
			User:    fields[2],
			CPU:     cpu,
			Mem:     mem,
			Stat:    fields[5],
			Command: strings.Join(fields[6:], " "),
		})
	}
	return list
}

// ---- 端口状态 ----

// ListPorts 列出远端监听端口:优先 ss,回退 netstat(老系统)。
func (m *Manager) ListPorts(sessionID string) ([]PortInfo, error) {
	ts, err := m.Get(sessionID)
	if err != nil {
		return nil, err
	}
	out, err := ts.Exec("ss -tlnp 2>/dev/null")
	if err != nil || strings.TrimSpace(out) == "" {
		out, err = ts.Exec("netstat -tlnp 2>/dev/null")
		if err != nil {
			return nil, err
		}
		return parseNetstatPorts(out), nil
	}
	return parseSSPorts(out), nil
}

// parseSSPorts 解析 `ss -tlnp` 输出(仅 LISTEN 行,含 users:(("name",pid=N)) 信息)。
func parseSSPorts(out string) []PortInfo {
	var list []PortInfo
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] != "LISTEN" {
			continue
		}
		// ss -tlnp 只列 tcp 监听,地址字段不带协议前缀
		pi := PortInfo{Proto: "tcp", Address: fields[3]}
		// users:(("sshd",pid=1000,fd=3)) 出现在最后几个字段,合并后整体找 pid/name
		rest := strings.Join(fields[4:], " ")
		if idx := strings.Index(rest, "pid="); idx >= 0 {
			num := rest[idx+4:]
			if end := strings.IndexAny(num, ",)"); end >= 0 {
				pi.PID, _ = strconv.Atoi(num[:end])
			}
		}
		if idx := strings.Index(rest, "(("); idx >= 0 {
			name := rest[idx+2:]
			if q := strings.IndexByte(name, '"'); q >= 0 {
				name = name[q+1:]
				if q2 := strings.IndexByte(name, '"'); q2 >= 0 {
					pi.Process = name[:q2]
				}
			}
		}
		list = append(list, pi)
	}
	return list
}

// parseNetstatPorts 解析 `netstat -tlnp` 输出(老系统回退)。
func parseNetstatPorts(out string) []PortInfo {
	var list []PortInfo
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 || !strings.Contains(fields[0], "tcp") {
			continue
		}
		pi := PortInfo{Proto: fields[0], Address: fields[3]}
		// 最后一列形如 1234/sshd 或 -
		prog := fields[len(fields)-1]
		if prog != "-" {
			if i := strings.IndexByte(prog, '/'); i > 0 {
				pi.PID, _ = strconv.Atoi(prog[:i])
				pi.Process = prog[i+1:]
			}
		}
		list = append(list, pi)
	}
	return list
}

