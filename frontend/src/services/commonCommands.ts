// 命令模式(常用命令)数据层:localStorage 持久化。
// 供命令模式面板与命令组「查看」弹窗(按命令文本查描述)共用。
import { COMMON_COMMANDS_KEY } from './storageKeys'

export type CommonCommandType = 'normal' | 'transfer' | 'external'

/** 单条常用命令:命令文本 + 描述 + 类型。 */
export interface CommonCommand {
  id: number
  command: string
  description: string
  /** 类型:normal=常规(远端命令,默认);transfer=文件传输(预留);external=外部(宿主机 shell 命令,预留)。 */
  type: CommonCommandType
}

const STORAGE_KEY = COMMON_COMMANDS_KEY

/** 解析一段命令库 JSON(兼容旧数据:无 type 字段一律视为常规命令)。 */
export function parseCommands(raw: string | null): CommonCommand[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as (Omit<CommonCommand, 'type'> & { type?: string })[]
    if (!Array.isArray(parsed)) return []
    // 旧数据没有 type 字段 → 一律视为常规命令
    const normalize = (t?: string): CommonCommandType => (t === 'transfer' || t === 'external' ? t : 'normal')
    return parsed.map((c) => ({ ...c, type: normalize(c.type) }) as CommonCommand)
  } catch {
    return []
  }
}

export function loadCommands(): CommonCommand[] {
  try {
    return parseCommands(localStorage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

export function persistCommands(list: CommonCommand[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* 存储满/隐私模式,静默 */
  }
}

/** 命令文本 → 描述 映射(命令组「查看」按命令文本查描述用)。 */
export function descriptionByCommand(): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of loadCommands()) map.set(c.command, c.description)
  return map
}

/** 命令文本 → 类型/描述(命令组执行时按命令文本解析步骤类型用)。 */
export interface CommandMeta {
  type: CommonCommandType
  description: string
}

export function commandMetaByCommand(): Map<string, CommandMeta> {
  const map = new Map<string, CommandMeta>()
  for (const c of loadCommands()) map.set(c.command, { type: c.type, description: c.description })
  return map
}
