package bridge

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"termhub/internal/sshsvc"
)

// EventTrafficSample 流量采样事件名:每采样间隔推送各网卡当前速率。
const EventTrafficSample = "termhub:traffic:sample"

// TrafficEvent 流量采样事件载荷。
type TrafficEvent struct {
	SessionID string                 `json:"sessionId"`
	Samples   []sshsvc.TrafficSample `json:"samples"`
}

func init() {
	application.RegisterEvent[TrafficEvent](EventTrafficSample)
}

// ToolService 会话工具绑定(控制面):进程管理、端口状态。
// 本质是在既有会话的 SSH 连接上另开通道执行命令并解析成表格数据,
// 不影响交互终端;数据按会话(sessionID)隔离,随会话结束而失效。
type ToolService struct {
	mgr *sshsvc.Manager
}

// NewToolService 构造工具服务。
func NewToolService(mgr *sshsvc.Manager) *ToolService {
	return &ToolService{mgr: mgr}
}

// ListProcesses 列出指定会话所在服务器的进程。
func (s *ToolService) ListProcesses(sessionID string) ([]sshsvc.ProcessInfo, error) {
	return s.mgr.ListProcesses(sessionID)
}

// KillProcess 向进程发信号:TERM(优雅终止)或 KILL(强制杀死)。
func (s *ToolService) KillProcess(sessionID string, pid int, signal string) error {
	return s.mgr.KillProcess(sessionID, pid, signal)
}

// ListPorts 列出指定会话所在服务器的监听端口。
func (s *ToolService) ListPorts(sessionID string) ([]sshsvc.PortInfo, error) {
	return s.mgr.ListPorts(sessionID)
}

// ListSystemInfo 采集指定会话所在服务器的运行状态(系统/IP/CPU/内存/磁盘等)。
func (s *ToolService) ListSystemInfo(sessionID string) (sshsvc.SystemInfo, error) {
	return s.mgr.ListSystemInfo(sessionID)
}

// ListServices 列出服务器上的 systemd 服务(运行状态 + 自启状态)。
func (s *ToolService) ListServices(sessionID string) ([]sshsvc.ServiceInfo, error) {
	return s.mgr.ListServices(sessionID)
}

// ControlService 控制服务:start/stop/restart/enable/disable。
func (s *ToolService) ControlService(sessionID, name, action string) error {
	return s.mgr.ControlService(sessionID, name, action)
}

// GetTrafficSnapshot 返回会话的流量滚动历史(最近约 10 分钟,2s 间隔)。
func (s *ToolService) GetTrafficSnapshot(sessionID string) ([]sshsvc.TrafficSample, error) {
	return s.mgr.GetTrafficSnapshot(sessionID)
}

// RunCommand 在会话上另开 exec 通道执行命令并等待结束,返回输出与退出码(精确)。
// 命令组执行时"常规命令"步用;timeoutSecs<=0 用默认超时(10 分钟)。
func (s *ToolService) RunCommand(sessionID, command string, timeoutSecs int) (sshsvc.ExecResult, error) {
	return s.mgr.ExecCommand(sessionID, command, timeoutSecs)
}
