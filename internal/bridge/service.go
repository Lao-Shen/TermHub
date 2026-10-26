package bridge

import (
	"errors"

	"github.com/wailsapp/wails/v3/pkg/application"

	"termhub/internal/sshsvc"
)

// SessionExitEvent 会话结束事件载荷,经 Wails 事件推送给前端。
type SessionExitEvent struct {
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

// EventSessionExit 事件名;前端 Events.On 同名订阅。
const EventSessionExit = "termhub:session:exit"

func init() {
	// 注册事件类型,绑定生成器会为前端生成强类型 API。
	application.RegisterEvent[SessionExitEvent](EventSessionExit)
}

// TermHubService 暴露给前端的 Wails 绑定(控制面):
// 连接建立/断开/会话列表。终端数据面走 WebSocket,不经绑定。
type TermHubService struct {
	hub  *Hub
	mgr  *sshsvc.Manager
	quit *QuitGuard
	// ApplyAlwaysOnTop 由 main 注入:设置主窗口置顶(命令组执行期间避免被其它窗口遮挡)。
	ApplyAlwaysOnTop func(bool)
}

// NewTermHubService 构造绑定服务。
func NewTermHubService(hub *Hub, mgr *sshsvc.Manager, quit *QuitGuard) *TermHubService {
	return &TermHubService{hub: hub, mgr: mgr, quit: quit}
}

// QuitNow 用户确认"仍要退出"后调用:置允许标志并触发应用退出。
func (s *TermHubService) QuitNow() error {
	s.quit.QuitNow()
	return nil
}

// SetAlwaysOnTop 设置主窗口是否置顶(命令组执行期间调用,避免被其它窗口遮挡)。
func (s *TermHubService) SetAlwaysOnTop(on bool) error {
	if s.ApplyAlwaysOnTop != nil {
		s.ApplyAlwaysOnTop(on)
	}
	return nil
}

// ConnectResult Connect 的返回结果。
type ConnectResult struct {
	// SessionID 会话 ID;需要确认主机密钥时为空。
	SessionID string `json:"sessionId"`
	// WSPort 终端 WebSocket 服务端口(全局一致,随结果返回方便前端)。
	WSPort int `json:"wsPort"`
	// HostKeyFingerprint 本次握手观察到的主机密钥指纹。
	HostKeyFingerprint string `json:"hostKeyFingerprint"`
	// NeedsHostKeyConfirm 为 true 表示首次连接,需前端请用户确认指纹后重试。
	NeedsHostKeyConfirm bool `json:"needsHostKeyConfirm"`
	// HostKeyIsProxy 待确认指纹是否属于跳板机(否则属于目标机)。
	HostKeyIsProxy bool `json:"hostKeyIsProxy"`
	// HostKeyHost/HostKeyPort 待确认指纹所属主机,供前端展示。
	HostKeyHost string `json:"hostKeyHost"`
	HostKeyPort int    `json:"hostKeyPort"`
}

// Connect 建立 SSH 连接并打开终端会话。
// 首次连接返回指纹待确认(NeedsHostKeyConfirm);
// 确认后携带 cfg.TrustedHostKey 再次调用即可。
func (s *TermHubService) Connect(cfg sshsvc.ConnectionConfig) (ConnectResult, error) {
	ts, err := s.mgr.OpenTerminal(cfg)
	if err != nil {
		var unknown sshsvc.ErrHostKeyUnknown
		if errors.As(err, &unknown) {
			return ConnectResult{
				WSPort:              s.hub.Port(),
				HostKeyFingerprint:  unknown.Fingerprint,
				NeedsHostKeyConfirm: true,
				HostKeyIsProxy:      unknown.IsProxy,
				HostKeyHost:         unknown.Host,
				HostKeyPort:         unknown.Port,
			}, nil
		}
		return ConnectResult{}, err
	}
	return ConnectResult{
		SessionID:          ts.ID,
		WSPort:             s.hub.Port(),
		HostKeyFingerprint: ts.HostKeyFingerprint,
	}, nil
}

// Disconnect 主动断开指定会话(清理与事件由领域层完成)。
func (s *TermHubService) Disconnect(sessionID string) error {
	return s.mgr.Close(sessionID)
}

// WriteInput 把文本作为终端输入写入指定会话的 stdin,等效于用户在终端键入。
// 供"常用命令"等控制面功能向终端注入命令(通常为 命令 + "\r"),
// 回显与命令输出照常经 WebSocket 数据面返回前端。
func (s *TermHubService) WriteInput(sessionID, data string) error {
	ts, err := s.mgr.Get(sessionID)
	if err != nil {
		return err
	}
	if _, err := ts.Write([]byte(data)); err != nil {
		return err
	}
	return nil
}

// Sessions 返回当前全部会话快照。
func (s *TermHubService) Sessions() []sshsvc.SessionInfo {
	return s.mgr.Sessions()
}
