package bridge

import (
	"errors"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"termhub/internal/hostcmd"
)

// EventHostCmdOutput 宿主机命令输出事件:每收到一块 stdout/stderr 推一次。
const EventHostCmdOutput = "termhub:hostcmd:output"

// EventHostCmdDone 宿主机命令结束事件:携带退出码(精确判定执行完成)。
const EventHostCmdDone = "termhub:hostcmd:done"

// HostCmdOutputEvent 输出事件载荷。
type HostCmdOutputEvent struct {
	RunID  string `json:"runId"`
	Stream string `json:"stream"` // stdout | stderr
	Data   string `json:"data"`
}

// HostCmdDoneEvent 结束事件载荷。
type HostCmdDoneEvent struct {
	RunID    string `json:"runId"`
	ExitCode int    `json:"exitCode"`
	// Error 启动/运行异常信息(非零退出码不算错误,走 ExitCode)。
	Error string `json:"error"`
}

func init() {
	application.RegisterEvent[HostCmdOutputEvent](EventHostCmdOutput)
	application.RegisterEvent[HostCmdDoneEvent](EventHostCmdDone)
}

// HostCommandService 宿主机命令绑定:在本地机器执行 shell 命令(命令的"外部"类型)。
// 输出/结束经事件推送;结束事件带退出码,执行是否完成无需猜测。
type HostCommandService struct {
	runner *hostcmd.Runner
	// OnOutput/OnDone 由 main 注入:转成 Wails 事件推前端。
	OnOutput func(runID, stream, data string)
	OnDone   func(runID string, exitCode int, errMsg string)
}

// NewHostCommandService 构造宿主机命令服务。
func NewHostCommandService() *HostCommandService {
	s := &HostCommandService{runner: hostcmd.NewRunner()}
	s.runner.OnOutput = func(runID, stream, data string) {
		if s.OnOutput != nil {
			s.OnOutput(runID, stream, data)
		}
	}
	s.runner.OnDone = func(runID string, exitCode int, errMsg string) {
		if s.OnDone != nil {
			s.OnDone(runID, exitCode, errMsg)
		}
	}
	return s
}

// Start 启动本机命令(command 为 cmd /C(sh -c)执行的文本;cwd 可为空=当前工作目录),
// 立即返回运行 ID,输出与结束经事件推送。
func (s *HostCommandService) Start(command string, cwd string) (string, error) {
	if strings.TrimSpace(command) == "" {
		return "", errors.New("命令为空")
	}
	runID := s.runner.NextID()
	s.runner.Run(runID, command, cwd)
	return runID, nil
}

// Cancel 取消指定运行(结束整棵进程树)。
func (s *HostCommandService) Cancel(runID string) error {
	if !s.runner.Cancel(runID) {
		return errors.New("该运行已结束")
	}
	return nil
}
