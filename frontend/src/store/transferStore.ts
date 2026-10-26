// 传输任务状态(zustand):由 termhub:transfer:progress / done 事件驱动。
import { create } from 'zustand'
import { sftp } from '../services/files'
import type { TransferInfo } from '../types'
import { errMsg, TransferKind, TransferStatus } from '../types'

interface TransferState {
  /** 按启动顺序排列的任务列表 */
  tasks: TransferInfo[]
  /** 事件 → 状态更新(progress 节流由后端完成,这里直接替换快照) */
  applyProgress(t: TransferInfo): void
  applyDone(t: TransferInfo): void
  /** 发起上传/下载并登记任务;exclude 为黑名单路径(命中项含子树不参与传输) */
  upload(sessionId: string, localPath: string, remoteDir: string, exclude?: string[]): Promise<void>
  download(sessionId: string, remotePath: string, localDir: string, exclude?: string[]): Promise<void>
  cancel(id: string): void
  dismiss(id: string): void
}

function upsert(tasks: TransferInfo[], t: TransferInfo): TransferInfo[] {
  const idx = tasks.findIndex((x) => x.id === t.id)
  if (idx < 0) return [...tasks, t]
  const cur = tasks[idx]
  // 终态不可被 running 快照覆盖:
  //   ① 小文件可能在绑定返回前就跑完,`transfer:done` 先到,随后
  //      `await sftp.upload()` 返回的 running 快照(0 字节)若直接覆盖,
  //      任务会永久卡在 0%(后端已删除该任务,不再有后续事件)。
  //   ② 极少数进度事件与终态乱序时,迟到的 running 快照也不该把已完成打回进行中。
  if (cur.status !== TransferStatus.TransferRunning && t.status === TransferStatus.TransferRunning) {
    return tasks
  }
  const next = [...tasks]
  next[idx] = t
  return next
}

export const useTransferStore = create<TransferState>((set) => ({
  tasks: [],

  applyProgress(t) {
    set((state) => ({ tasks: upsert(state.tasks, t) }))
  },

  applyDone(t) {
    set((state) => ({ tasks: upsert(state.tasks, t) }))
  },

  async upload(sessionId, localPath, remoteDir, exclude = []) {
    try {
      const t = await sftp.upload(sessionId, localPath, remoteDir, exclude)
      set((state) => ({ tasks: upsert(state.tasks, t) }))
    } catch (err) {
      // 发起失败(如本地文件不可读):以瞬时错误任务形式展示
      set((state) => ({
        tasks: upsert(state.tasks, {
          id: `err-${crypto.randomUUID()}`,
          kind: TransferKind.TransferUpload,
          sessionId,
          localPath,
          remotePath: remoteDir,
          isDir: false,
          size: 0,
          transferred: 0,
          status: TransferStatus.TransferError,
          error: errMsg(err),
        }),
      }))
    }
  },

  async download(sessionId, remotePath, localDir, exclude = []) {
    try {
      const t = await sftp.download(sessionId, remotePath, localDir, exclude)
      set((state) => ({ tasks: upsert(state.tasks, t) }))
    } catch (err) {
      set((state) => ({
        tasks: upsert(state.tasks, {
          id: `err-${crypto.randomUUID()}`,
          kind: TransferKind.TransferDownload,
          sessionId,
          localPath: localDir,
          remotePath,
          isDir: false,
          size: 0,
          transferred: 0,
          status: TransferStatus.TransferError,
          error: errMsg(err),
        }),
      }))
    }
  },

  cancel(id) {
    void sftp.cancel(id)
    // 立即本地标记为已取消:后端任务可能已经结束/不存在(不再有后续事件),
    // 避免任务残留在「传输中」无法清除。
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id && t.status === TransferStatus.TransferRunning
          ? { ...t, status: TransferStatus.TransferCanceled }
          : t,
      ),
    }))
  },

  dismiss(id) {
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }))
  },
}))
