package bridge

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ClipboardService 系统剪贴板绑定:终端右键"复制/粘贴"经由系统剪贴板
// (WebView 的 navigator.clipboard 在 WebView2 下有权限限制,统一走 Go 侧)。
type ClipboardService struct{}

// NewClipboardService 构造剪贴板服务。
func NewClipboardService() *ClipboardService {
	return &ClipboardService{}
}

// SetText 写入系统剪贴板,返回是否成功。
func (s *ClipboardService) SetText(text string) bool {
	return application.Get().Clipboard.SetText(text)
}

// GetText 读取系统剪贴板文本;失败返回空串。
func (s *ClipboardService) GetText() (string, bool) {
	return application.Get().Clipboard.Text()
}
