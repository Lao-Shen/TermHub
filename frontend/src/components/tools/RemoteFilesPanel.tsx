import DownloadIcon from '@mui/icons-material/Download'
import DeleteIcon from '@mui/icons-material/Delete'
import BlockIcon from '@mui/icons-material/Block'
import {
  Box,
  Divider,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileBrowser } from '../files/FileBrowser'
import { ConfirmDialog } from '../ConfirmDialog'
import {
  containsPath,
  isExcludedRemote,
  loadBlacklist,
  saveBlacklist,
  togglePath,
  type FileBlacklist,
} from '../../services/fileBlacklist'
import { local, sftp } from '../../services/files'
import { FILEVIEW_PATH_KEY_PREFIX } from '../../services/storageKeys'
import { useNotificationStore } from '../../store/notificationStore'
import { useTransferStore } from '../../store/transferStore'
import type { FileEntry } from '../../types'
import { errMsg } from '../../types'

/** 拖拽上传单文件上限(与后端一致),超出提示走文件传输。 */
const MAX_DRAG_BYTES = 100 * 1024 * 1024

// 文件视图路径记忆:按服务器(连接 ID)持久化当前远端目录,跨启动保留。
// 与双栏文件传输的 termhub.ftpath.* 分开(那是 {local,remote} 结构)。
const PATH_KEY_PREFIX = FILEVIEW_PATH_KEY_PREFIX

function loadSavedPath(connId?: string): string {
  if (!connId) return '/'
  try {
    const p = localStorage.getItem(PATH_KEY_PREFIX + connId)
    return p && p.startsWith('/') ? p : '/'
  } catch {
    return '/'
  }
}

function savePath(connId: string | undefined, path: string) {
  if (!connId) return
  try {
    localStorage.setItem(PATH_KEY_PREFIX + connId, path)
  } catch {
    /* 存储满/隐私模式,静默 */
  }
}

/** File → base64(dataURL 去掉前缀),供绑定上传。 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const i = dataUrl.indexOf(',')
      resolve(i >= 0 ? dataUrl.slice(i + 1) : dataUrl)
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 文件视图(远端资源管理器):
 * 左侧终端 + 本面板;支持从系统拖入文件/目录上传到当前远端目录,
 * 右键远端条目 下载(到系统下载目录)/ 删除。
 */
export function RemoteFilesPanel({ sessionId, connId }: { sessionId: string; connId?: string }) {
  // 初始路径:该服务器上次打开的目录(无记录则根目录)
  const [path, setPath] = useState<string>(() => loadSavedPath(connId))
  const [refresh, setRefresh] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null)
  // 传输黑名单(远端):与双栏文件传输共用同一份按连接持久化的数据
  const [blacklist, setBlacklist] = useState<FileBlacklist>(() => loadBlacklist(connId))
  const notify = useNotificationStore((s) => s.notify)

  const download = useTransferStore((s) => s.download)

  useEffect(() => {
    setBlacklist(loadBlacklist(connId))
  }, [connId])

  /** 更新并持久化黑名单。 */
  const updateBlacklist = (next: FileBlacklist) => {
    setBlacklist(next)
    saveBlacklist(connId, next)
  }
  const toggleBlacklist = (entry: FileEntry) => {
    const has = containsPath(blacklist.remote, entry.path, false)
    updateBlacklist({ ...blacklist, remote: togglePath(blacklist.remote, entry.path, false) })
    notify(has ? `已移出黑名单:${entry.name}` : `已加入黑名单:${entry.name}`, 'success')
  }

  const listRemote = useCallback((dir: string) => sftp.listDir(sessionId, dir), [sessionId])
  const createDir = useCallback((dir: string, name: string) => sftp.mkdir(sessionId, dir, name), [sessionId])
  const removeRemote = useCallback((e: FileEntry) => sftp.remove(sessionId, e.path), [sessionId])

  // 拖入层深度计数:dragenter/dragleave 在进入/离开子元素时成对触发并冒泡,
  // 直接按 leave 置 false 会导致面板内部移动时提示层闪烁。
  const dragDepth = useRef(0)

  // Wails 运行时在 document 级挂了拖放监听,光标不在其注册的拖放目标上时
  // 会把 dropEffect 置为 'none' —— 按规范浏览器会直接取消本次拖放,
  // drop 事件根本不会派发(上传静默无反应)。冒泡阶段 document 监听晚于 React
  // 根容器执行,因此在这里 stopPropagation 阻止事件到达运行时即可。
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current++
    setDragging(true)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  // 拖入文件/目录 → 内容直传(网页拿不到系统路径,读内容经绑定上传)
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    let skipped = 0
    let blocked = 0
    const jobs: Promise<unknown>[] = []
    for (const f of files) {
      if (f.size > MAX_DRAG_BYTES) {
        skipped++
        continue
      }
      // webkitRelativePath 形如 "dir/sub/file.txt"(目录拖入),拆出层级与文件名
      const parts = f.webkitRelativePath ? f.webkitRelativePath.split('/') : [f.name]
      const fileName = parts[parts.length - 1]
      const relDir = parts.slice(0, -1).join('/')
      // 传输黑名单命中(含目录子树)不上传
      const dir = relDir ? `${path.replace(/\/+$/, '')}/${relDir}` : path
      const remotePath = dir === '/' ? `/${fileName}` : `${dir.replace(/\/+$/, '')}/${fileName}`
      if (isExcludedRemote(remotePath, blacklist.remote)) {
        blocked++
        continue
      }
      jobs.push(
        fileToBase64(f).then((b64) => sftp.uploadBytes(sessionId, path, fileName, relDir, b64)),
      )
    }
    if (jobs.length > 0) {
      try {
        await Promise.all(jobs)
        setNotice(
          `已开始上传 ${jobs.length} 个文件` +
            (skipped > 0 ? `,${skipped} 个超大跳过` : '') +
            (blocked > 0 ? `,${blocked} 个黑名单跳过` : ''),
        )
        // 传输走全局任务列表;稍后强制刷新目录
        setTimeout(() => setRefresh((n) => n + 1), 1200)
      } catch (err) {
        setNotice(errMsg(err))
      }
    } else if (blocked > 0) {
      setNotice(`没有可上传的文件(${blocked} 个命中传输黑名单)`)
    } else {
      setNotice('没有可上传的文件(空内容或超过 100MB,大文件请用文件传输工具)')
    }
  }

  const doDownload = async () => {
    const target = menu?.entry
    setMenu(null)
    if (!target) return
    if (isExcludedRemote(target.path, blacklist.remote)) {
      notify('该文件/目录在黑名单中,已跳过', 'warning')
      return
    }
    try {
      const dir = await local.downloadsDir()
      await download(sessionId, target.path, dir, blacklist.remote)
    } catch (err) {
      setNotice(errMsg(err))
    }
  }

  const doDelete = async () => {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    try {
      await removeRemote(target)
      setRefresh((n) => n + 1) // 强制刷新
    } catch (err) {
      setNotice(errMsg(err))
    }
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
    >
      {/* 拖入提示层 */}
      {dragging && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(122, 162, 247, 0.12)',
            border: '2px dashed',
            borderColor: 'primary.main',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        >
          <Typography variant="body1" sx={{ fontWeight: 700, color: 'primary.main' }}>
            松开以上传到 {path}
          </Typography>
        </Box>
      )}

      {/* 提示条(上传结果/错误) */}
      {notice && (
        <Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
          <Typography variant="caption" color="text.secondary">
            {notice}
          </Typography>
        </Box>
      )}

      {/* 远端资源浏览器 */}
      <FileBrowser
        title="远端"
        sessionId={sessionId}
        initialPath={path}
        listDir={listRemote}
        onCreateDir={createDir}
        onDelete={async (e) => setPendingDelete(e)}
        refreshKey={refresh}
        onPathChange={(p) => {
          setPath(p)
          savePath(connId, p)
        }}
        onItemContextMenu={(entry, pos) => setMenu({ x: pos.x, y: pos.y, entry })}
        isExcluded={(e) => isExcludedRemote(e.path, blacklist.remote)}
      />

      {/* 右键菜单:下载 / 加入-移出黑名单 / 删除 */}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem onClick={() => void doDownload()}>
          <DownloadIcon sx={{ fontSize: 16, mr: 1 }} />
          下载到本地
        </MenuItem>
        <MenuItem
          onClick={() => {
            const e = menu?.entry
            setMenu(null)
            if (e) toggleBlacklist(e)
          }}
        >
          <BlockIcon sx={{ fontSize: 16, mr: 1 }} />
          {menu && containsPath(blacklist.remote, menu.entry.path, false) ? '移出黑名单' : '加入黑名单'}
        </MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem sx={{ color: 'error.main' }} onClick={() => { setPendingDelete(menu?.entry ?? null); setMenu(null) }}>
          <DeleteIcon sx={{ fontSize: 16, mr: 1 }} />
          删除
        </MenuItem>
        {(blacklist.remote.length > 0 || blacklist.local.length > 0) && (
          <>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem
              onClick={() => {
                setMenu(null)
                updateBlacklist({ local: [], remote: [] })
                notify('已清空传输黑名单', 'success')
              }}
            >
              清空黑名单({blacklist.remote.length + blacklist.local.length})
            </MenuItem>
          </>
        )}
      </Menu>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="删除确认"
        message={pendingDelete ? `确定删除远端 ${pendingDelete.name}?` : ''}
        confirmLabel="删除"
        danger
        onConfirm={() => void doDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  )
}
