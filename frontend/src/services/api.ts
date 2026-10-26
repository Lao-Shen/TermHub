// 控制面 API:包装 Wails 生成的 TermHubService 绑定。
// 终端数据面不走这里,见 services/terminal.ts。
import { TermHubService } from '../../bindings/termhub/internal/bridge'
import type { ConnectResult } from '../../bindings/termhub/internal/bridge/models'
import type { SessionInfo } from '../../bindings/termhub/internal/sshsvc/models'
import type { ConnectionConfig } from '../../bindings/termhub/internal/sshsvc/models'

export const api = {
  /** 建立 SSH 连接并打开终端会话;首次连接返回指纹待确认。 */
  async connect(cfg: ConnectionConfig): Promise<ConnectResult> {
    return TermHubService.Connect(cfg)
  },

  /** 主动断开指定会话。 */
  async disconnect(sessionId: string): Promise<void> {
    await TermHubService.Disconnect(sessionId)
  },

  /** 当前全部会话快照。 */
  async sessions(): Promise<SessionInfo[]> {
    return (await TermHubService.Sessions()) ?? []
  },

  /** 把文本作为终端输入写入会话(常用命令"执行"用:命令 + "\r"),等效于在终端键入。 */
  async writeInput(sessionId: string, data: string): Promise<void> {
    await TermHubService.WriteInput(sessionId, data)
  },

  /** 用户确认"仍要退出"后触发应用退出。 */
  async quitNow(): Promise<void> {
    await TermHubService.QuitNow()
  },

  /** 设置主窗口置顶(命令组执行期间避免被其它窗口遮挡)。 */
  async setAlwaysOnTop(on: boolean): Promise<void> {
    await TermHubService.SetAlwaysOnTop(on)
  },
}
