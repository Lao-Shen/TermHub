// 文件传输黑名单(按连接持久化):本地 / 远端各一组绝对路径。
// 在双栏文件传输里右键文件或目录可加入黑名单;发起传输时命中的路径
// (含目录整个子树)会被排除,不参与上传/下载。
// 与路径记忆 termhub.ftpath.{connId} 分开存储;删除连接时一并清理。
import { useAppStore } from '../store/appStore'
import { errMsg } from '../types'
import { FILE_BLACKLIST_KEY_PREFIX } from './storageKeys'

export interface FileBlacklist {
  local: string[]
  remote: string[]
}

const PREFIX = FILE_BLACKLIST_KEY_PREFIX

/** Windows 路径大小写不敏感(与后端 filepath 行为一致)。 */
const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** 本地路径规范化:统一分隔符、去尾部斜杠、Windows 下转小写。 */
function normLocal(p: string): string {
  const c = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return IS_WINDOWS ? c.toLowerCase() : c
}

/** 远端(POSIX)路径规范化。 */
function normRemote(p: string): string {
  return p.trim().replace(/\/+$/, '')
}

function normOf(local: boolean): (p: string) => string {
  return local ? normLocal : normRemote
}

/** 路径是否命中黑名单:等于某项,或位于某个被排除目录之下。 */
function hit(target: string, list: string[], norm: (p: string) => string): boolean {
  for (const e of list) {
    const ex = norm(e)
    if (!ex) continue
    if (target === ex || target.startsWith(ex + '/')) return true
  }
  return false
}

/** 本地路径是否命中黑名单。 */
export function isExcludedLocal(p: string, list: string[]): boolean {
  return hit(normLocal(p), list, normLocal)
}

/** 远端路径是否命中黑名单。 */
export function isExcludedRemote(p: string, list: string[]): boolean {
  return hit(normRemote(p), list, normRemote)
}

/** 黑名单中是否精确包含该路径(右键菜单据此显示「加入/移出」)。 */
export function containsPath(list: string[], p: string, local: boolean): boolean {
  const norm = normOf(local)
  const t = norm(p)
  return list.some((e) => norm(e) === t)
}

/** 加入/移出黑名单(存在则移除,不存在则追加),返回新数组。 */
export function togglePath(list: string[], p: string, local: boolean): string[] {
  const norm = normOf(local)
  const t = norm(p)
  return list.some((e) => norm(e) === t) ? list.filter((e) => norm(e) !== t) : [...list, p]
}

/** 读取某连接的黑名单;无记录返回空。 */
export function loadBlacklist(connId?: string): FileBlacklist {
  if (!connId) return { local: [], remote: [] }
  try {
    const raw = localStorage.getItem(PREFIX + connId)
    if (!raw) return { local: [], remote: [] }
    const p = JSON.parse(raw) as Partial<FileBlacklist>
    return {
      local: Array.isArray(p.local) ? p.local.filter((x) => typeof x === 'string') : [],
      remote: Array.isArray(p.remote) ? p.remote.filter((x) => typeof x === 'string') : [],
    }
  } catch (err) {
    console.warn('读取传输黑名单失败:', errMsg(err))
    return { local: [], remote: [] }
  }
}

/** 持久化黑名单。 */
export function saveBlacklist(connId: string | undefined, list: FileBlacklist) {
  if (!connId) return
  try {
    localStorage.setItem(PREFIX + connId, JSON.stringify(list))
  } catch {
    /* 存储满/隐私模式,静默 */
  }
}

/** 由会话 ID 反查连接 ID(命令传输等只有 sessionId 的场景用于定位黑名单)。 */
export function connIdForSession(sessionId: string): string | undefined {
  return useAppStore.getState().sessions.find((s) => s.sessionId === sessionId)?.cfg?.id
}
