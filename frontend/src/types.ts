// 线缆类型以 wails3 生成的绑定为单一来源,这里统一导入再导出;
// 应用层特有类型(SessionTab 等)在本文件维护。

import type { ConnectResult, SessionExitEvent } from '../bindings/termhub/internal/bridge/models'
import type {
  ConnectionConfig,
  DiskInfo,
  FileEntry,
  PortInfo,
  ProcessInfo,
  ServiceInfo,
  SessionInfo,
  SystemInfo,
  TrafficSample,
  TransferInfo,
} from '../bindings/termhub/internal/sshsvc/models'
import { AuthMethod, ProxyType, TransferKind, TransferStatus } from '../bindings/termhub/internal/sshsvc/models'

export { AuthMethod, ProxyType, TransferKind, TransferStatus }
export type {
  ConnectionConfig,
  ConnectResult,
  DiskInfo,
  FileEntry,
  PortInfo,
  ProcessInfo,
  ServiceInfo,
  SessionExitEvent,
  SessionInfo,
  SystemInfo,
  TrafficSample,
  TransferInfo,
}

export type SessionStatus = 'idle' | 'connecting' | 'confirming' | 'connected' | 'exited'

/** 前端会话标签页:idle = 空白新标签页(cfg 为空,展示服务器卡片墙);
 *  连接建立前只有临时 key,建立后才有 sessionId。 */
export interface SessionTab {
  key: string
  sessionId?: string
  wsPort?: number
  cfg: ConnectionConfig | null
  status: SessionStatus
  fingerprint?: string
  exitReason?: string
}

/** 提取错误信息为可读字符串(绑定拒绝/网络异常统一处理)。 */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
