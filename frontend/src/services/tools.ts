// 会话工具封装:进程管理 / 端口状态 / 运行状态 / 服务管理(经 Go 侧在既有会话上执行命令)。
import { ToolService } from '../../bindings/termhub/internal/bridge'
import type { ExecResult } from '../../bindings/termhub/internal/sshsvc/models'
import type { PortInfo, ProcessInfo, ServiceInfo, SystemInfo, TrafficSample } from '../types'

export const tools = {
  async listProcesses(sessionId: string): Promise<ProcessInfo[]> {
    return (await ToolService.ListProcesses(sessionId)) ?? []
  },

  async killProcess(sessionId: string, pid: number, signal: 'TERM' | 'KILL'): Promise<void> {
    await ToolService.KillProcess(sessionId, pid, signal)
  },

  async listPorts(sessionId: string): Promise<PortInfo[]> {
    return (await ToolService.ListPorts(sessionId)) ?? []
  },

  async listSystemInfo(sessionId: string): Promise<SystemInfo> {
    return ToolService.ListSystemInfo(sessionId)
  },

  async listServices(sessionId: string): Promise<ServiceInfo[]> {
    return (await ToolService.ListServices(sessionId)) ?? []
  },

  async controlService(sessionId: string, name: string, action: string): Promise<void> {
    await ToolService.ControlService(sessionId, name, action)
  },

  async getTrafficSnapshot(sessionId: string): Promise<TrafficSample[]> {
    return (await ToolService.GetTrafficSnapshot(sessionId)) ?? []
  },

  /** 另开 exec 通道执行命令并等待结束,返回输出与退出码(命令组"常规命令"步用)。 */
  async runCommand(sessionId: string, command: string, timeoutSecs = 0): Promise<ExecResult> {
    return ToolService.RunCommand(sessionId, command, timeoutSecs)
  },
}
