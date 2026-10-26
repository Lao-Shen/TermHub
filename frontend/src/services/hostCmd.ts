// 宿主机命令服务封装:在本地机器执行 shell 命令(命令的"外部"类型)。
// 启动返回 runId;输出/结束经 termhub:hostcmd:output / termhub:hostcmd:done 事件推送,
// done 事件带退出码 —— 执行是否完成精确可靠。
import { HostCommandService } from '../../bindings/termhub/internal/bridge'

export const hostCmd = {
  /** 启动本机命令(command 为 cmd /C 或 sh -c 执行的文本;cwd 为空=当前工作目录),返回 runId。 */
  async start(command: string, cwd = ''): Promise<string> {
    return HostCommandService.Start(command, cwd)
  },

  /** 取消指定运行(结束整棵进程树)。 */
  async cancel(runId: string): Promise<void> {
    await HostCommandService.Cancel(runId)
  },
}
