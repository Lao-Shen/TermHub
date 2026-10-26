// 系统剪贴板封装(经 Go 侧绑定;WebView 的 navigator.clipboard 权限受限不可靠)。
import { ClipboardService } from '../../bindings/termhub/internal/bridge'

export const clipboard = {
  /** 写入剪贴板,返回是否成功。 */
  async setText(text: string): Promise<boolean> {
    try {
      return await ClipboardService.SetText(text)
    } catch {
      return false
    }
  },

  /** 读取剪贴板文本;失败返回空串。 */
  async getText(): Promise<string> {
    try {
      const [text] = await ClipboardService.GetText() // Go 多返回值 → TS 元组
      return text ?? ''
    } catch {
      return ''
    }
  },
}
