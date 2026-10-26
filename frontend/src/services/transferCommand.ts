// 命令"传输"类型的解析与执行。
// 语法:
//   file "<本地文件绝对路径>" <服务端完整文件路径>   （支持改名;父目录自动创建）
//   dir  "<本地文件夹绝对路径>" <服务端文件夹>        （内容对应,保留子目录结构;目录自动创建）
// 规则:路径含空格用双引号包裹;本地必须绝对路径;仅覆盖同名文件(不删除多余);失败即抛错。
import { Events } from '@wailsio/runtime'
import { connIdForSession, loadBlacklist } from './fileBlacklist'
import { sftp } from './files'
import type { TransferInfo } from '../types'

export interface TransferSpec {
  mode: 'file' | 'dir'
  /** 本地绝对路径(文件或目录)。 */
  local: string
  /** 服务端路径(file=完整文件路径;dir=目标文件夹)。 */
  remote: string
}

/** 按空白分词,但尊重双引号(引号内的空格不拆)。 */
function tokenize(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let started = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') {
      quoted = true
      started = true
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (started) {
        out.push(cur)
        cur = ''
        started = false
      }
    } else {
      cur += ch
      started = true
    }
  }
  if (quoted) throw new Error('引号未闭合')
  if (started) out.push(cur)
  return out
}

/** 本地路径是否为绝对路径:Windows 盘符 / UNC,或 POSIX 绝对路径。 */
function isAbsoluteLocal(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')
}

/** 解析传输命令文本,非法时抛错。 */
export function parseTransferCommand(text: string): TransferSpec {
  const tokens = tokenize(text.trim())
  if (tokens.length !== 3) {
    throw new Error(
      '传输命令格式:file "<本地文件绝对路径>" <服务端文件路径> 或 dir "<本地文件夹绝对路径>" <服务端文件夹>',
    )
  }
  const mode = tokens[0].toLowerCase()
  if (mode !== 'file' && mode !== 'dir') throw new Error('传输命令首个词必须是 file 或 dir')
  const local = tokens[1]
  const remote = tokens[2]
  if (!isAbsoluteLocal(local)) throw new Error('本地路径必须是绝对路径')
  if (!remote.startsWith('/')) throw new Error('服务端路径需为以 / 开头的绝对路径')
  return { mode, local, remote }
}

/**
 * 执行一条传输命令:解析 → 发起上传 → 等待该任务 done 事件。
 * 成功 resolve;失败/取消 reject。
 */
export async function runTransferCommand(sessionId: string, text: string): Promise<void> {
  const spec = parseTransferCommand(text)
  // 传输黑名单(本地):源文件/目录命中时后端直接拒绝,步骤以错误终止。
  const exclude = loadBlacklist(connIdForSession(sessionId)).local

  // 先订阅再发起,避免极快任务先完成、事件错过。
  let resolveWait!: () => void
  let rejectWait!: (e: unknown) => void
  const waitPromise = new Promise<void>((resolve, reject) => {
    resolveWait = resolve
    rejectWait = reject
  })
  const finished = new Map<string, { status?: string; error?: string }>()
  let targetId: string | null = null
  let settled = false

  const off = Events.On('termhub:transfer:done', (ev: any) => {
    const d = ev?.data
    if (!d?.id) return
    if (targetId && d.id === targetId) {
      if (settled) return
      settled = true
      off()
      if (d.status === 'error') rejectWait(new Error(d.error || '传输失败'))
      else if (d.status === 'canceled') rejectWait(new Error('传输已取消'))
      else resolveWait()
    } else {
      finished.set(d.id, { status: d.status, error: d.error })
    }
  })

  let info: TransferInfo
  try {
    info =
      spec.mode === 'file'
        ? await sftp.uploadFileTo(sessionId, spec.local, spec.remote, exclude)
        : await sftp.uploadDirContents(sessionId, spec.local, spec.remote, exclude)
  } catch (err) {
    off()
    throw err
  }
  targetId = info.id

  // 可能在发起期间就已完成
  const early = finished.get(info.id)
  if (early) {
    settled = true
    off()
    if (early.status === 'error') throw new Error(early.error || '传输失败')
    if (early.status === 'canceled') throw new Error('传输已取消')
    return
  }

  await waitPromise
}
