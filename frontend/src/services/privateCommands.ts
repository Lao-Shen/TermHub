// 私有命令库数据层(按连接持久化,localStorage):仅在与该连接(机器)绑定的会话下可见。
// 结构与公共命令库(commonCommands)完全一致,复用其解析逻辑;键按连接 id 隔离,
// 删除连接时随其他连接级 localStorage 一并清理。
import { parseCommands } from './commonCommands'
import type { CommonCommand } from './commonCommands'
import { PRIVATE_COMMANDS_KEY_PREFIX } from './storageKeys'

/** 私有命令库的 localStorage 键前缀(删除连接时按 PREFIX + connId 清理)。 */
export { PRIVATE_COMMANDS_KEY_PREFIX }

/** 读取某机器的私有命令库;无 connId 或无记录返回空。 */
export function loadPrivateCommands(connId?: string): CommonCommand[] {
  if (!connId) return []
  try {
    return parseCommands(localStorage.getItem(PRIVATE_COMMANDS_KEY_PREFIX + connId))
  } catch {
    return []
  }
}

/** 持久化某机器的私有命令库。 */
export function persistPrivateCommands(connId: string | undefined, list: CommonCommand[]): void {
  if (!connId) return
  try {
    localStorage.setItem(PRIVATE_COMMANDS_KEY_PREFIX + connId, JSON.stringify(list))
  } catch {
    /* 存储满/隐私模式,静默 */
  }
}

/** 批量写入私有库(按命令文本去重,已存在则跳过;保留类型与描述)。
 *  仅新增、不改动源命令库;返回新增条数。 */
export function addCommandsToPrivate(connId: string | undefined, items: CommonCommand[]): number {
  if (!connId || items.length === 0) return 0
  const existing = loadPrivateCommands(connId)
  const commands = new Set(existing.map((c) => c.command))
  const ids = new Set(existing.map((c) => c.id))
  const added: CommonCommand[] = []
  items.forEach((it, i) => {
    if (!it.command || commands.has(it.command)) return
    commands.add(it.command)
    // 重新分配 id:同一私有库内唯一,避免与既有条目撞号
    let id = Date.now() + i
    while (ids.has(id)) id += 1
    ids.add(id)
    added.push({ id, command: it.command, description: it.description, type: it.type })
  })
  if (added.length === 0) return 0
  persistPrivateCommands(connId, [...existing, ...added])
  return added.length
}
