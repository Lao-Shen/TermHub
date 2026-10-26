// 双栏文件传输视图(工具栏"文件传输"按钮):左本地、右远端 + 中间上传/下载按钮列。
// 传输任务走全局 TransferWidget(右下角悬浮),不在此渲染进度;
// 关键点:
//   - 路径按服务器记忆(termhub.ftpath.{connId}),initDone 守卫防止面板
//     以默认路径挂载覆盖已保存路径;
//   - 覆盖保护:目标已存在时先 MUI 确认框再执行(上传查远端、下载查本地)。
import DownloadIcon from '@mui/icons-material/Download'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { Box, Button, CircularProgress, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  containsPath,
  isExcludedLocal,
  isExcludedRemote,
  loadBlacklist,
  saveBlacklist,
  togglePath,
  type FileBlacklist,
} from '../../services/fileBlacklist'
import { local, sftp } from '../../services/files'
import { FT_PATH_KEY_PREFIX } from '../../services/storageKeys'
import { useNotificationStore } from '../../store/notificationStore'
import { useTransferStore } from '../../store/transferStore'
import type { FileEntry } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'
import { FileBrowser } from './FileBrowser'

/** 取路径基名(Windows/POSIX 分隔符通用)。 */
function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

// 文件传输路径持久化:按服务器(连接 ID)分别记忆上次浏览位置,跨启动保留。
const FT_PATH_PREFIX = FT_PATH_KEY_PREFIX

function loadSavedPaths(connId?: string): { local: string; remote: string } | null {
  if (!connId) return null
  try {
    const raw = localStorage.getItem(FT_PATH_PREFIX + connId)
    if (!raw) return null
    const p = JSON.parse(raw) as { local?: string; remote?: string }
    if (typeof p.local === 'string' && typeof p.remote === 'string') {
      return { local: p.local, remote: p.remote }
    }
    return null
  } catch {
    return null
  }
}

function savePaths(connId: string | undefined, paths: { local: string; remote: string }) {
  if (!connId) return
  try {
    localStorage.setItem(FT_PATH_PREFIX + connId, JSON.stringify(paths))
  } catch {
    /* 存储满/隐私模式,静默 */
  }
}

/** 会话的双栏文件视图:左本地、右远端(传输任务见全局 TransferWidget)。
 *  connId 用于按服务器持久化两个面板的上次路径。 */
export function TransferView({ sessionId, connId }: { sessionId: string; connId?: string }) {
  const [localPath, setLocalPath] = useState('')
  const [remotePath, setRemotePath] = useState('/')
  const [localSel, setLocalSel] = useState<FileEntry[]>([])
  const [remoteSel, setRemoteSel] = useState<FileEntry[]>([])
  // 传输完成后刷新对应面板
  const [localRefresh, setLocalRefresh] = useState(0)
  const [remoteRefresh, setRemoteRefresh] = useState(0)

  const upload = useTransferStore((s) => s.upload)
  const download = useTransferStore((s) => s.download)
  const notify = useNotificationStore((s) => s.notify)

  // 传输黑名单(按连接持久化):命中的本地/远端路径(含目录整个子树)不参与传输。
  const [blacklist, setBlacklist] = useState<FileBlacklist>(() => loadBlacklist(connId))

  // 路径变化(导航/初始加载)统一经此:同步状态并持久化
  const localRef = useRef('')
  const remoteRef = useRef('/')
  const handleLocalPath = (p: string) => {
    localRef.current = p
    setLocalPath(p)
    savePaths(connId, { local: p, remote: remoteRef.current })
  }
  const handleRemotePath = (p: string) => {
    remoteRef.current = p
    setRemotePath(p)
    savePaths(connId, { local: localRef.current, remote: p })
  }

  /** 更新并持久化黑名单。 */
  const updateBlacklist = (next: FileBlacklist) => {
    setBlacklist(next)
    saveBlacklist(connId, next)
  }

  // 右键菜单:在双栏里对某个文件/目录「加入 / 移出黑名单」(本地、远端各自维护)
  const [ctxMenu, setCtxMenu] = useState<{
    pane: 'local' | 'remote'
    x: number
    y: number
    entry: FileEntry
  } | null>(null)
  const toggleBlacklist = () => {
    const m = ctxMenu
    setCtxMenu(null)
    if (!m) return
    const isLocal = m.pane === 'local'
    const list = isLocal ? blacklist.local : blacklist.remote
    const has = containsPath(list, m.entry.path, isLocal)
    const nextList = togglePath(list, m.entry.path, isLocal)
    updateBlacklist(isLocal ? { ...blacklist, local: nextList } : { ...blacklist, remote: nextList })
    notify(has ? `已移出黑名单:${m.entry.name}` : `已加入黑名单:${m.entry.name}`, 'success')
  }

  // 初始路径:上次浏览位置(按服务器持久化),无记录则本地面板回退主目录。
  // 关键:恢复完成前不挂载面板 —— 否则面板会先用默认值('/'/空)加载一次,
  // 其 onPathChange 会把默认值持久化,覆盖已保存的路径(远端目录大时必现)。
  const [initDone, setInitDone] = useState(false)
  useEffect(() => {
    setBlacklist(loadBlacklist(connId))
    const saved = loadSavedPaths(connId)
    if (saved) {
      localRef.current = saved.local
      remoteRef.current = saved.remote
      setLocalPath(saved.local)
      setRemotePath(saved.remote)
      setInitDone(true)
      return
    }
    void local
      .homeDir()
      .then((h) => {
        localRef.current = h
        setLocalPath(h)
        savePaths(connId, { local: h, remote: '/' })
      })
      .catch(() => setLocalPath(''))
      .finally(() => setInitDone(true))
  }, [connId])

  const listLocal = useCallback((dir: string) => local.listDir(dir), [])
  const listRemote = useCallback((dir: string) => sftp.listDir(sessionId, dir), [sessionId])

  const createRemoteDir = useCallback(
    (dir: string, name: string) => sftp.mkdir(sessionId, dir, name),
    [sessionId],
  )
  const deleteRemote = useCallback((e: FileEntry) => sftp.remove(sessionId, e.path), [sessionId])

  // 覆盖确认:目标已存在时先确认再执行
  const [overwrite, setOverwrite] = useState<{ message: string; run: () => Promise<void> } | null>(null)

  // 发起阶段的忙碌态:点击上传/下载后,等待对端响应(SFTP 首次连接、远端
  // Exists/Stat 等网络往返)期间给按钮加上转圈动画并禁用,避免误以为没反应。
  const [pending, setPending] = useState<{ upload: boolean; download: boolean }>({
    upload: false,
    download: false,
  })
  const runWithBusy = async (kind: 'upload' | 'download', fn: () => Promise<void>) => {
    setPending((p) => ({ ...p, [kind]: true }))
    try {
      await fn()
    } finally {
      setPending((p) => ({ ...p, [kind]: false }))
    }
  }

  /** 多选覆盖提示:单个列名;多个给数量与前 3 项预览。 */
  const conflictMessage = (side: string, names: string[], verb: string): string => {
    if (names.length === 1) return `${side}已存在 ${names[0]},继续将覆盖它,确定${verb}吗?`
    const preview = names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '')
    return `${side}已存在 ${preview} 共 ${names.length} 项,继续将覆盖它们,确定${verb}吗?`
  }

  /** 上传:优先用本地选中项(可多选,文件或目录),无选中则弹系统文件选择框。
   *  黑名单命中的项(含目录子树)不参与传输;远端目标已存在时先确认覆盖。 */
  const doUpload = async () => {
    let files = localSel.map((e) => e.path)
    if (files.length === 0) {
      const picked = await local.chooseFile('选择要上传的文件')
      if (!picked) return
      files = [picked]
    }
    const before = files.length
    files = files.filter((p) => !isExcludedLocal(p, blacklist.local))
    if (before > files.length) notify(`已跳过 ${before - files.length} 个黑名单项`, 'info')
    if (files.length === 0) {
      notify('所选项目都在黑名单中,已全部跳过', 'warning')
      return
    }
    const run = async () => {
      for (const file of files) await upload(sessionId, file, remotePath, blacklist.local)
      setRemoteRefresh((n) => n + 1)
    }
    await runWithBusy('upload', async () => {
      const conflicts: string[] = []
      for (const name of files.map(baseName)) {
        const target = remotePath === '/' ? '/' + name : remotePath + '/' + name
        if (await sftp.exists(sessionId, target).catch(() => false)) conflicts.push(name)
      }
      if (conflicts.length > 0) {
        // 等待用户确认;确认后再以忙碌态执行
        setOverwrite({ message: conflictMessage('远端', conflicts, '上传'), run: () => runWithBusy('upload', run) })
        return
      }
      await run()
    })
  }

  /** 下载:远端选中项(可多选,文件或目录)→ 本地当前目录。
   *  黑名单命中的项(含目录子树)不参与传输;本地已有同名文件时先确认。 */
  const doDownload = async () => {
    if (remoteSel.length === 0) return
    const before = remoteSel.length
    const targets = remoteSel.filter((e) => !isExcludedRemote(e.path, blacklist.remote))
    if (before > targets.length) notify(`已跳过 ${before - targets.length} 个黑名单项`, 'info')
    if (targets.length === 0) {
      notify('所选项目都在黑名单中,已全部跳过', 'warning')
      return
    }
    const sep = localPath.endsWith('\\') || localPath.endsWith('/') || localPath === '' ? '' : '\\'
    const names = targets.map((e) => baseName(e.path))
    const run = async () => {
      for (const entry of targets) await download(sessionId, entry.path, localPath, blacklist.remote)
      setLocalRefresh((n) => n + 1)
    }
    await runWithBusy('download', async () => {
      const conflicts: string[] = []
      for (const name of names) {
        if (await local.exists(localPath + sep + name).catch(() => false)) conflicts.push(name)
      }
      if (conflicts.length > 0) {
        setOverwrite({ message: conflictMessage('本地', conflicts, '下载'), run: () => runWithBusy('download', run) })
        return
      }
      await run()
    })
  }

  // 初始路径恢复中:先出加载态,避免面板用默认路径挂载
  if (!initDone) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', p: 1.5, pb: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 1.5 }}>
        {/* 本地面板 */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            overflow: 'hidden',
          }}
        >
          <FileBrowser
            title="本地"
            initialPath={localPath}
            listDir={listLocal}
            refreshKey={localRefresh}
            multiSelect
            onSelectionChange={setLocalSel}
            onPathChange={handleLocalPath}
            isExcluded={(e) => isExcludedLocal(e.path, blacklist.local)}
            onItemContextMenu={(entry, pos) => setCtxMenu({ pane: 'local', x: pos.x, y: pos.y, entry })}
          />
        </Box>

        {/* 传输操作列 */}
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
          <Tooltip
            title={
              pending.upload
                ? '正在等待服务器响应…'
                : localSel.length > 0
                  ? `上传 ${
                      localSel.length > 1
                        ? `${localSel.length} 项`
                        : `${localSel[0]?.isDir ? '目录 ' : ''}${localSel[0]?.name}`
                    }`
                  : '无选中时弹窗选择文件'
            }
          >
            <span>
              <Button
                variant="contained"
                size="small"
                startIcon={pending.upload ? <CircularProgress size={16} color="inherit" /> : <UploadFileIcon />}
                disabled={pending.upload}
                onClick={() => void doUpload()}
                sx={{ minWidth: 108 }}
              >
                {pending.upload ? '上传中…' : localSel.length > 1 ? `上传 ${localSel.length} 项 →` : '上传 →'}
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              pending.download
                ? '正在等待服务器响应…'
                : remoteSel.length > 0
                  ? `下载 ${
                      remoteSel.length > 1
                        ? `${remoteSel.length} 项`
                        : `${remoteSel[0]?.isDir ? '目录 ' : ''}${remoteSel[0]?.name}`
                    }`
                  : '先在右侧选择文件或目录'
            }
          >
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={pending.download ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
                disabled={remoteSel.length === 0 || pending.download}
                onClick={() => void doDownload()}
                sx={{ minWidth: 108 }}
              >
                {pending.download ? '下载中…' : remoteSel.length > 1 ? `← 下载 ${remoteSel.length} 项` : '← 下载'}
              </Button>
            </span>
          </Tooltip>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', lineHeight: 1.4 }}>
            Ctrl / Shift 点击
            <br />
            可多选
            <br />
            右键加入黑名单
          </Typography>
          {(blacklist.local.length > 0 || blacklist.remote.length > 0) && (
            <Button
              size="small"
              color="inherit"
              sx={{ minWidth: 108, fontSize: 11 }}
              onClick={() => {
                updateBlacklist({ local: [], remote: [] })
                notify('已清空传输黑名单', 'success')
              }}
            >
              清空黑名单({blacklist.local.length + blacklist.remote.length})
            </Button>
          )}
        </Box>

        {/* 远端面板 */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            overflow: 'hidden',
          }}
        >
          <FileBrowser
            title="远端"
            sessionId={sessionId}
            initialPath={remotePath}
            listDir={listRemote}
            onCreateDir={createRemoteDir}
            onDelete={deleteRemote}
            refreshKey={remoteRefresh}
            multiSelect
            onSelectionChange={setRemoteSel}
            onPathChange={handleRemotePath}
            isExcluded={(e) => isExcludedRemote(e.path, blacklist.remote)}
            onItemContextMenu={(entry, pos) => setCtxMenu({ pane: 'remote', x: pos.x, y: pos.y, entry })}
          />
        </Box>
      </Box>

      {/* 右键菜单:加入 / 移出传输黑名单 */}
      <Menu
        open={!!ctxMenu}
        onClose={() => setCtxMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { top: ctxMenu.y, left: ctxMenu.x } : undefined}
        slotProps={{ list: { dense: true } }}
      >
        {ctxMenu && (
          <MenuItem onClick={toggleBlacklist}>
            {containsPath(
              ctxMenu.pane === 'local' ? blacklist.local : blacklist.remote,
              ctxMenu.entry.path,
              ctxMenu.pane === 'local',
            )
              ? '移出黑名单'
              : '加入黑名单'}
          </MenuItem>
        )}
      </Menu>

      {/* 覆盖确认 */}
      <ConfirmDialog
        open={!!overwrite}
        title="覆盖确认"
        message={overwrite?.message ?? ''}
        confirmLabel="覆盖"
        danger
        onConfirm={() => {
          const r = overwrite
          setOverwrite(null)
          if (r) void r.run()
        }}
        onCancel={() => setOverwrite(null)}
      />
    </Box>
  )
}
