package bridge

import (
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// EventQuitPrompt 退出前提示事件名:有传输任务时,取消本次退出并请前端确认。
const EventQuitPrompt = "termhub:quit:prompt"

// QuitPromptEvent 退出提示载荷。
type QuitPromptEvent struct {
	// Count 正在进行的传输任务数。
	Count int `json:"count"`
}

func init() {
	application.RegisterEvent[QuitPromptEvent](EventQuitPrompt)
}

// QuitGuard 应用退出守卫:
//   - ShouldQuit 挂在 wails Options 上,退出前被询问;
//   - 有传输任务时返回 false 取消退出并经事件提示前端;
//   - 用户确认后前端调用 QuitNow,置允许标志并真正退出。
type QuitGuard struct {
	allow atomic.Bool

	// RunningCount 由 main 注入(传输管理器)。
	RunningCount func() int
	// OnPrompt 由 main 注入:取消退出并向前端发提示事件。
	OnPrompt func(count int)
}

// NewQuitGuard 构造退出守卫。
func NewQuitGuard() *QuitGuard {
	return &QuitGuard{}
}

// ShouldQuit 实现 wails application.Options.ShouldQuit。
func (g *QuitGuard) ShouldQuit() bool {
	if g.allow.Load() {
		return true
	}
	count := 0
	if g.RunningCount != nil {
		count = g.RunningCount()
	}
	if count > 0 {
		if g.OnPrompt != nil {
			g.OnPrompt(count) // 通过回调，通知到前端，当前有正在进行的传输任务
		}
		return false
	}
	return true
}

// QuitNow 用户确认退出:置允许标志并触发应用退出。
func (g *QuitGuard) QuitNow() {
	g.allow.Store(true)
	application.Get().Quit()
}

// Allowed 是否已允许退出(窗口关闭钩子与 ShouldQuit 共用)。
func (g *QuitGuard) Allowed() bool {
	return g.allow.Load()
}
