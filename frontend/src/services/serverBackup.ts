// 服务器数据导出/导入:服务器配置 + 按服务器隔离的附属数据 + 全局命令库/命令组。
//
// 安全边界:密码、主机密钥指纹只存系统钥匙串,导出文件永不包含;
// 私钥认证只导出路径(换机后需自行确认路径有效)。导入采用"去重合并":
// 按 host + port + user 判定重复并跳过,新条目重新分配 ID,不触碰既有凭据。
import { LocalService } from '../../bindings/termhub/internal/bridge'
import { useAppStore } from '../store/appStore'
import { AuthMethod, ProxyType } from '../types'
import type { ConnectionConfig } from '../types'
import {
  loadCommands,
  persistCommands,
  type CommonCommand,
  type CommonCommandType,
} from './commonCommands'
import { loadCommandGroups, persistCommandGroups, type CommandGroup } from './commandGroups'
import { loadBlacklist, saveBlacklist, type FileBlacklist } from './fileBlacklist'
import { addCommandsToPrivate, loadPrivateCommands } from './privateCommands'
import { FILEVIEW_PATH_KEY_PREFIX, FT_PATH_KEY_PREFIX } from './storageKeys'

/** 导出文件标识与版本;导入时校验,避免误选其它 JSON。 */
const BACKUP_KIND = 'termhub.server-backup'
const BACKUP_VERSION = 1
/** 导入文件大小上限:防止误选超大文件卡死界面。 */
const MAX_IMPORT_BYTES = 32 * 1024 * 1024

/** 单台服务器的附属数据(按连接 ID 隔离的 localStorage 内容)。 */
interface ServerExtras {
  privateCommands: CommonCommand[]
  blacklist: FileBlacklist
  transferPaths: { local: string; remote: string } | null
  fileViewPath: string
}

interface ServerEntry {
  config: ConnectionConfig
  extras: ServerExtras
}

interface BackupFile {
  app: 'termhub'
  kind: typeof BACKUP_KIND
  version: number
  exportedAt: string
  servers: ServerEntry[]
  commonCommands: CommonCommand[]
  commandGroups: CommandGroup[]
}

export interface ExportSummary {
  path: string
  servers: number
  commands: number
  groups: number
}

export interface ImportSummary {
  path: string
  /** 新增的服务器数量。 */
  added: number
  /** 因 host + port + user 重复而跳过的数量。 */
  duplicate: number
  /** 配置无效(缺主机/用户/认证方式等)而跳过的数量。 */
  invalid: number
  /** 新增的常用命令数量(公共库 + 私有库)。 */
  commands: number
  /** 新增的命令组数量。 */
  groups: number
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
}

/** 连接去重键:同一主机 + 端口 + 用户视为同一台服务器。 */
function connKey(c: Pick<ConnectionConfig, 'host' | 'port' | 'user'>): string {
  return `${c.host.trim().toLowerCase()}:${c.port || 22}:${c.user.trim()}`
}

/** 去掉秘密字段(密码/指纹),返回可写入备份文件的配置。 */
function stripSecrets(conn: ConnectionConfig): ConnectionConfig {
  const { password: _pwd, trustedHostKey: _fp, ...cfg } = conn
  if (cfg.proxyJump) {
    const { password: _pjPwd, trustedHostKey: _pjFp, ...jump } = cfg.proxyJump
    cfg.proxyJump = jump
  }
  return cfg
}

function readTransferPaths(id: string): { local: string; remote: string } | null {
  try {
    const raw = localStorage.getItem(FT_PATH_KEY_PREFIX + id)
    if (!raw) return null
    const p = JSON.parse(raw) as { local?: unknown; remote?: unknown }
    if (typeof p.local === 'string' && typeof p.remote === 'string') {
      return { local: p.local, remote: p.remote }
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return null
}

function readFileViewPath(id: string): string {
  try {
    return localStorage.getItem(FILEVIEW_PATH_KEY_PREFIX + id) ?? ''
  } catch {
    return ''
  }
}

function collectExtras(id: string): ServerExtras {
  return {
    privateCommands: loadPrivateCommands(id),
    blacklist: loadBlacklist(id),
    transferPaths: readTransferPaths(id),
    fileViewPath: readFileViewPath(id),
  }
}

/** 默认文件名:termhub-backup-YYYYMMDD-HHmm.json。 */
function defaultFilename(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `termhub-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

/** 导出全部服务器数据;用户取消返回 null。 */
export async function exportServerBackup(): Promise<ExportSummary | null> {
  const conns = useAppStore.getState().connections
  const backup: BackupFile = {
    app: 'termhub',
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    servers: conns.map((c) => ({ config: stripSecrets(c), extras: collectExtras(c.id) })),
    commonCommands: loadCommands(),
    commandGroups: loadCommandGroups(),
  }
  const path = await LocalService.SaveTextFile(
    '导出服务器数据',
    defaultFilename(),
    JSON.stringify(backup, null, 2),
  )
  if (!path) return null
  return {
    path,
    servers: backup.servers.length,
    commands: backup.commonCommands.length,
    groups: backup.commandGroups.length,
  }
}

function normalizeCommandType(v: unknown): CommonCommandType {
  return v === 'transfer' || v === 'external' ? v : 'normal'
}

function sanitizeCommands(raw: unknown): CommonCommand[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => {
      const command = str((c as CommonCommand | undefined)?.command).trim()
      if (!command) return null
      return {
        id: Number((c as CommonCommand | undefined)?.id) || 0,
        command,
        description: str((c as CommonCommand | undefined)?.description),
        type: normalizeCommandType((c as CommonCommand | undefined)?.type),
      } satisfies CommonCommand
    })
    .filter((c): c is CommonCommand => c !== null)
}

function sanitizeProxy(raw: unknown): ConnectionConfig['proxy'] {
  const p = raw as { type?: unknown; host?: unknown; port?: unknown } | undefined
  if (!p || (p.type !== ProxyType.ProxyTypeSOCKS5 && p.type !== ProxyType.ProxyTypeHTTP)) {
    return undefined
  }
  const host = str(p.host).trim()
  const port = Number(p.port)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return { type: p.type, host, port }
}

function sanitizeProxyJump(raw: unknown): ConnectionConfig['proxyJump'] {
  const j = raw as
    | { host?: unknown; port?: unknown; user?: unknown; auth?: unknown; keyPath?: unknown }
    | undefined
  if (!j) return undefined
  const host = str(j.host).trim()
  const user = str(j.user).trim()
  const port = Number(j.port) || 22
  if (!host || !user || !Number.isInteger(port) || port < 1 || port > 65535) return undefined
  if (j.auth !== AuthMethod.AuthPassword && j.auth !== AuthMethod.AuthPrivateKey) return undefined
  return {
    host,
    port,
    user,
    auth: j.auth,
    keyPath: j.auth === AuthMethod.AuthPrivateKey ? str(j.keyPath).trim() : undefined,
  }
}

/** 校验并规整导入的单条配置;无效返回 null。密码/指纹一律丢弃。 */
function sanitizeConfig(raw: unknown): ConnectionConfig | null {
  const c = raw as Partial<ConnectionConfig> | undefined
  if (!c || typeof c !== 'object') return null
  const host = str(c.host).trim()
  const user = str(c.user).trim()
  const port = Number(c.port) || 22
  if (!host || !user) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (c.auth !== AuthMethod.AuthPassword && c.auth !== AuthMethod.AuthPrivateKey) return null

  const cfg: ConnectionConfig = {
    id: crypto.randomUUID(),
    name: str(c.name).trim() || `${user}@${host}`,
    host,
    port,
    user,
    auth: c.auth,
  }
  const description = str(c.description).trim()
  if (description) cfg.description = description
  if (c.auth === AuthMethod.AuthPrivateKey) {
    const keyPath = str(c.keyPath).trim()
    if (keyPath) cfg.keyPath = keyPath
  }
  const proxy = sanitizeProxy(c.proxy)
  if (proxy) cfg.proxy = proxy
  const jump = sanitizeProxyJump(c.proxyJump)
  if (jump) cfg.proxyJump = jump
  return cfg
}

function sanitizeExtras(raw: unknown): ServerExtras {
  const e = raw as Partial<ServerExtras> | undefined
  const tp = e?.transferPaths
  return {
    privateCommands: sanitizeCommands(e?.privateCommands),
    blacklist: {
      local: strArray(e?.blacklist?.local),
      remote: strArray(e?.blacklist?.remote),
    },
    transferPaths:
      tp && typeof tp.local === 'string' && typeof tp.remote === 'string'
        ? { local: tp.local, remote: tp.remote }
        : null,
    fileViewPath: str(e?.fileViewPath).startsWith('/') ? str(e?.fileViewPath) : '',
  }
}

/** 把导入的附属数据写入本地存储(关联到新分配的连接 ID)。 */
function applyExtras(id: string, extras: ServerExtras): number {
  let commands = 0
  if (extras.privateCommands.length > 0) {
    commands += addCommandsToPrivate(id, extras.privateCommands)
  }
  if (extras.blacklist.local.length > 0 || extras.blacklist.remote.length > 0) {
    saveBlacklist(id, extras.blacklist)
  }
  if (extras.transferPaths) {
    try {
      localStorage.setItem(FT_PATH_KEY_PREFIX + id, JSON.stringify(extras.transferPaths))
    } catch {
      /* 存储满/隐私模式,静默 */
    }
  }
  if (extras.fileViewPath) {
    try {
      localStorage.setItem(FILEVIEW_PATH_KEY_PREFIX + id, extras.fileViewPath)
    } catch {
      /* 存储满/隐私模式,静默 */
    }
  }
  return commands
}

/** 合并公共常用命令库:按命令文本去重,保留类型与描述。 */
function mergeCommonCommands(raw: unknown): number {
  const incoming = sanitizeCommands(raw)
  if (incoming.length === 0) return 0
  const existing = loadCommands()
  const seen = new Set(existing.map((c) => c.command))
  let nextId = Math.max(0, ...existing.map((c) => Number(c.id) || 0), Date.now())
  const added: CommonCommand[] = []
  for (const it of incoming) {
    if (seen.has(it.command)) continue
    seen.add(it.command)
    nextId += 1
    added.push({ ...it, id: nextId })
  }
  if (added.length > 0) persistCommands([...existing, ...added])
  return added.length
}

/** 合并命令组:按名称去重,新组重新分配 ID。 */
function mergeCommandGroups(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  const existing = loadCommandGroups()
  const names = new Set(existing.map((g) => g.name))
  let nextId = Math.max(0, ...existing.map((g) => Number(g.id) || 0), Date.now())
  const added: CommandGroup[] = []
  for (const item of raw) {
    const g = item as Partial<CommandGroup> | undefined
    const name = str(g?.name).trim()
    if (!name || names.has(name)) continue
    names.add(name)
    nextId += 1
    added.push({
      id: nextId,
      name,
      hosts: [...new Set(strArray(g?.hosts))],
      commands: [...new Set(strArray(g?.commands))],
    })
  }
  if (added.length > 0) persistCommandGroups([...existing, ...added])
  return added.length
}

/** 导入服务器数据(去重合并);用户取消返回 null。 */
export async function importServerBackup(): Promise<ImportSummary | null> {
  const [path, content] = await LocalService.OpenTextFile('导入服务器数据')
  if (!path) return null
  if (content.length > MAX_IMPORT_BYTES) {
    throw new Error('文件过大,不是有效的服务器数据文件')
  }

  let data: Partial<BackupFile>
  try {
    data = JSON.parse(content) as Partial<BackupFile>
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (!data || data.kind !== BACKUP_KIND) {
    throw new Error('不是 TermHub 服务器数据文件')
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new Error(`不支持的数据版本: ${String(data.version)}`)
  }
  if (!Array.isArray(data.servers)) {
    throw new Error('文件缺少服务器列表')
  }

  const existing = new Set(useAppStore.getState().connections.map((c) => connKey(c)))
  const added: ConnectionConfig[] = []
  const pending: { id: string; extras: ServerExtras }[] = []
  let duplicate = 0
  let invalid = 0

  for (const entry of data.servers) {
    const cfg = sanitizeConfig((entry as Partial<ServerEntry> | undefined)?.config)
    if (!cfg) {
      invalid += 1
      continue
    }
    const key = connKey(cfg)
    if (existing.has(key)) {
      duplicate += 1
      continue
    }
    existing.add(key)
    added.push(cfg)
    pending.push({
      id: cfg.id,
      extras: sanitizeExtras((entry as Partial<ServerEntry> | undefined)?.extras),
    })
  }

  // 先写附属数据(键依赖新 ID),再一次性入库触发界面刷新。
  let commands = 0
  for (const { id, extras } of pending) commands += applyExtras(id, extras)
  commands += mergeCommonCommands(data.commonCommands)
  const groups = mergeCommandGroups(data.commandGroups)
  useAppStore.getState().addConnections(added)

  return { path, added: added.length, duplicate, invalid, commands, groups }
}
