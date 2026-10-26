// 通用文件浏览面板:本地磁盘与远端 SFTP 复用同一套 UI。
// 数据获取经 listDir 注入(本地=LocalService,远端=SftpService,由父组件绑定);
// 目录导航/路径输入框(Enter 跳转)/新建目录/删除/刷新/选中/右键回调;
// 双栏传输(TransferView)与文件视图(RemoteFilesPanel)均复用本组件。
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import DeleteIcon from '@mui/icons-material/Delete'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import RefreshIcon from '@mui/icons-material/Refresh'
import {
  Box,
  Checkbox,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { FileEntry } from '../../types'
import { errMsg } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'

/** 列分隔手柄样式:覆盖式透明手柄悬浮在表头单元格右缘(不占布局)。 */
const resizerSx = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 8,
  cursor: 'col-resize',
  zIndex: 2,
} as const

/** 人类可读的字节数。 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

function parentOf(path: string): string {
  // Windows:C:\a\b → C:\a;C:\ → ""(驱动器列表)
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep).filter(Boolean)
  if (parts.length <= 1) return ''
  const parent = parts.slice(0, -1).join(sep)
  if (sep === '\\') return parent + '\\'
  return (path.startsWith('/') ? '/' : '') + parent
}

export interface FileBrowserProps {
  title: string
  /** 远端面板传会话 ID;本地面板不传。 */
  sessionId?: string
  /** 初始路径;为空时由组件决定(本地=主目录,远端=/)。 */
  initialPath?: string
  /** 列出指定目录(本地/远端由调用方绑定)。 */
  listDir: (path: string) => Promise<FileEntry[]>
  /** 远端管理操作(新建目录/删除);本地面板不传。 */
  onCreateDir?: (path: string, name: string) => Promise<void>
  onDelete?: (target: FileEntry) => Promise<void>
  /** 外部刷新计数变化时重新加载当前目录。 */
  refreshKey?: number
  /** 当前选中条目变化(单选语义:多选时为最后点选的一条,无选中为 null)。 */
  onSelect?: (entry: FileEntry | null) => void
  /** 是否启用多选(表头全选 + Ctrl/Cmd 切换 + Shift 区间 + Ctrl+A)。默认单选。 */
  multiSelect?: boolean
  /** 选中集合变化(多选场景;数组顺序 = 点选顺序)。 */
  onSelectionChange?: (entries: FileEntry[]) => void
  /** 目录变化(初始加载与导航后)上报当前路径。 */
  onPathChange?: (path: string) => void
  /** 条目右键(父组件弹菜单),携带光标位置。 */
  onItemContextMenu?: (entry: FileEntry, pos: { x: number; y: number }) => void
  /** 命中传输黑名单的条目(置灰 + 标签提示);不传则不做标记。 */
  isExcluded?: (entry: FileEntry) => boolean
}

/** 通用文件浏览面板:本地磁盘与远端 SFTP 复用同一套 UI。 */
export function FileBrowser({
  title,
  sessionId: _sessionId,
  initialPath,
  listDir,
  onCreateDir,
  onDelete,
  refreshKey,
  onSelect,
  multiSelect = false,
  onSelectionChange,
  onPathChange,
  onItemContextMenu,
  isExcluded,
}: FileBrowserProps) {
  const [path, setPath] = useState<string>(initialPath ?? '')
  const [input, setInput] = useState<string>(initialPath ?? '')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 选中项路径(数组顺序 = 点选顺序;多选时即为勾选顺序)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  // Shift 区间选择的锚点(上次普通/Ctrl 点选的条目)
  const anchorRef = useRef('')
  // 内容区(用于 Ctrl+A 全选:点击行后聚焦,快捷键只作用于聚焦的面板)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const loadedRef = useRef('')

  // 列宽(px)与拖拽状态:仿 Windows 资源管理器,拖动表头分隔线调整左侧列的宽度;
  // 三列均固定宽(表格 tableLayout: fixed),总宽超出容器时出横向滚动条。
  const [colW, setColW] = useState({ name: 240, size: 90, time: 150 })
  const dragRef = useRef<{ col: 'name' | 'size'; startX: number; startW: number } | null>(null)

  const startResize = (col: 'name' | 'size') => (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { col, startX: e.clientX, startW: colW[col] }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // 拖拽移动/释放监听挂在窗口级:鼠标拖出表头区域仍可继续调整
  useEffect(() => {
    const move = (e: globalThis.MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const w = Math.min(900, Math.max(80, d.startW + (e.clientX - d.startX)))
      setColW((prev) => ({ ...prev, [d.col]: w }))
    }
    const up = () => {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // force: 显式刷新(路径未变化也强制重载);普通加载对同路径去重。
  const load = useCallback(
    async (dir: string, force = false) => {
      if (!force && loadedRef.current === dir) return
      setLoading(true)
      setError('')
      try {
        const list = await listDir(dir)
        loadedRef.current = dir
        setEntries(list)
        setPath(dir)
        setInput(dir)
        onPathChange?.(dir)
      } catch (err) {
        setError(errMsg(err))
      } finally {
        setLoading(false)
      }
    },
    [listDir, onPathChange],
  )

  // 首次挂载加载 initialPath(可能由父组件异步解析,如本地主目录);
  // 之后 initialPath 不再变化,由内部导航接管。
  useEffect(() => {
    void load(initialPath ?? path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath])

  useEffect(() => {
    if (refreshKey !== undefined) void load(path, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // 选中集合(含当前目录的有效条目),用于高亮与批量操作
  const selectedEntries = useMemo(() => {
    const byPath = new Map(entries.map((e) => [e.path, e]))
    return selectedPaths.map((p) => byPath.get(p)).filter((e): e is FileEntry => !!e)
  }, [entries, selectedPaths])
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths])
  const allSelected = entries.length > 0 && selectedPaths.length === entries.length

  /** 统一出口:更新选中集合并同时上报单选/多选回调。 */
  const applySelection = (paths: string[]) => {
    setSelectedPaths(paths)
    const byPath = new Map(entries.map((e) => [e.path, e]))
    const list = paths.map((p) => byPath.get(p)).filter((e): e is FileEntry => !!e)
    onSelect?.(list.length > 0 ? list[list.length - 1] : null)
    onSelectionChange?.(list)
  }

  /** 单击选中:普通=单选;多选下 Ctrl/Cmd=切换、Shift=区间。 */
  const select = (e: FileEntry, ev: ReactMouseEvent) => {
    contentRef.current?.focus()
    if (!multiSelect) {
      anchorRef.current = e.path
      applySelection([e.path])
      return
    }
    if (ev.shiftKey && anchorRef.current) {
      const a = entries.findIndex((x) => x.path === anchorRef.current)
      const b = entries.findIndex((x) => x.path === e.path)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        applySelection(entries.slice(lo, hi + 1).map((x) => x.path))
        return
      }
    }
    if (ev.ctrlKey || ev.metaKey) {
      anchorRef.current = e.path
      applySelection(
        selectedSet.has(e.path) ? selectedPaths.filter((p) => p !== e.path) : [...selectedPaths, e.path],
      )
      return
    }
    anchorRef.current = e.path
    applySelection([e.path])
  }

  /** 表头复选框:全选 / 全不选。 */
  const toggleAll = () => {
    anchorRef.current = ''
    applySelection(allSelected ? [] : entries.map((e) => e.path))
  }

  /** 内容区快捷键:Ctrl/Cmd+A 全选。 */
  const onContentKeyDown = (e: ReactKeyboardEvent) => {
    if (!multiSelect) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      e.stopPropagation()
      anchorRef.current = ''
      applySelection(entries.map((x) => x.path))
    }
  }

  const enterDir = (dir: string) => {
    anchorRef.current = ''
    applySelection([])
    void load(dir)
  }

  const goUp = () => {
    if (!path) return
    enterDir(parentOf(path))
  }

  const doMkdir = async () => {
    if (!onCreateDir) return
    const name = window.prompt('新目录名称:')
    if (!name?.trim()) return
    try {
      await onCreateDir(path, name.trim())
      await load(path, true) // 强制刷新
    } catch (err) {
      setError(errMsg(err))
    }
  }

  // 待删除条目(ConfirmDialog 确认;支持多选批量删除)
  const [pendingDelete, setPendingDelete] = useState<FileEntry[]>([])

  const doDelete = async () => {
    const targets = pendingDelete
    setPendingDelete([])
    if (targets.length === 0 || !onDelete) return
    try {
      for (const target of targets) await onDelete(target)
      anchorRef.current = ''
      applySelection([])
      await load(path, true) // 强制刷新
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const deleteMessage =
    pendingDelete.length > 1
      ? `确定删除所选的 ${pendingDelete.length} 项?此操作不可恢复。`
      : pendingDelete[0]
        ? `确定删除 ${pendingDelete[0].name}?`
        : ''

  return (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* 工具栏 */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700, mr: 0.5, whiteSpace: 'nowrap' }}>
          {title}
        </Typography>
        <Tooltip title="上级目录">
          <span>
            <IconButton size="small" onClick={goUp} disabled={!path}>
              <ArrowUpwardIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
        <TextField
          size="small"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(input)
          }}
          sx={{ flex: 1 }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <RefreshIcon
                    sx={{ fontSize: 15, cursor: 'pointer', color: 'text.secondary' }}
                    onClick={() => void load(path, true)}
                  />
                </InputAdornment>
              ),
            },
            htmlInput: { style: { fontSize: 13 } },
          }}
        />
        {onCreateDir && (
          <Tooltip title="新建目录">
            <IconButton size="small" onClick={() => void doMkdir()}>
              <CreateNewFolderIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip
            title={
              selectedEntries.length > 1
                ? `删除所选的 ${selectedEntries.length} 项`
                : selectedEntries[0]
                  ? `删除 ${selectedEntries[0].name}`
                  : '删除所选'
            }
          >
            <span>
              <IconButton
                size="small"
                color="error"
                disabled={selectedEntries.length === 0}
                onClick={() => selectedEntries.length > 0 && setPendingDelete(selectedEntries)}
              >
                <DeleteIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      {/* 删除确认(MUI,替代 window.confirm) */}
      <ConfirmDialog
        open={pendingDelete.length > 0}
        title="删除确认"
        message={deleteMessage}
        confirmLabel="删除"
        danger
        onConfirm={() => void doDelete()}
        onCancel={() => setPendingDelete([])}
      />

      {/* 内容区 */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: 'rgba(16,18,26,0.6)', zIndex: 1 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error ? (
          <Box sx={{ p: 2.5 }}>
            <Typography variant="body2" color="error" sx={{ wordBreak: 'break-all' }}>
              {error}
            </Typography>
          </Box>
        ) : (
          // 滚动容器:绝对定位铺满(不依赖百分比高度在嵌套 flex 链上的解析),
          // 行数超出出垂直滚动条,列宽总宽超出出横向滚动条(Windows 资源管理器行为)
          <TableContainer
            ref={contentRef}
            tabIndex={0}
            onKeyDown={onContentKeyDown}
            sx={{ position: 'absolute', inset: 0, overflow: 'auto', outline: 'none' }}
          >
            <Table size="small" stickyHeader sx={{ width: '100%', tableLayout: 'fixed', '& th, & td': { borderColor: 'divider' } }}>
              <TableHead>
                <TableRow>
                  {/* 分隔手柄悬浮在单元格右缘:拖名称手柄调名称列,拖大小手柄调大小列。
                      注意:th 不要设 position:relative —— 会覆盖 stickyHeader 的 position:sticky,
                      导致该列表头不吸顶(只有没设的表头吸顶,滚动时看着"固定不动");
                      手柄 absolute 直接锚定 sticky 的 th(定位元素即可作包含块)。 */}
                  <TableCell sx={{ width: colW.name, py: 0.75, overflow: 'hidden' }}>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                      {multiSelect && (
                        <Checkbox
                          size="small"
                          sx={{ p: 0.25, ml: -0.5, flexShrink: 0 }}
                          checked={allSelected}
                          indeterminate={selectedPaths.length > 0 && !allSelected}
                          onChange={toggleAll}
                        />
                      )}
                      <Typography variant="inherit" noWrap>名称</Typography>
                    </Stack>
                    <Box onMouseDown={startResize('name')} sx={resizerSx} />
                  </TableCell>
                  <TableCell sx={{ width: colW.size, py: 0.75, whiteSpace: 'nowrap' }}>
                    大小
                    <Box onMouseDown={startResize('size')} sx={resizerSx} />
                  </TableCell>
                  <TableCell sx={{ width: colW.time, py: 0.75, whiteSpace: 'nowrap' }}>
                    修改时间
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((e) => {
                  const excluded = isExcluded?.(e) ?? false
                  return (
                  <TableRow
                    key={e.path}
                    hover
                    selected={selectedSet.has(e.path)}
                    onClick={(ev) => select(e, ev)}
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      onItemContextMenu?.(e, { x: ev.clientX, y: ev.clientY })
                    }}
                    onDoubleClick={() => e.isDir && enterDir(e.path)}
                    sx={{
                      cursor: 'default',
                      opacity: excluded ? 0.45 : undefined,
                      '&:last-child td': { border: 0 },
                      '&.Mui-selected': { bgcolor: 'action.selected' },
                    }}
                  >
                    <TableCell sx={{ py: 0.5, display: 'flex', alignItems: 'center', gap: 1, border: 'none' }}>
                      {e.isDir ? (
                        selectedSet.has(e.path) ? (
                          <FolderOpenIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                        ) : (
                          <FolderIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                        )
                      ) : (
                        <InsertDriveFileIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      )}
                      <Typography variant="body2" noWrap>
                        {e.name}
                      </Typography>
                      {excluded && (
                        <Box
                          component="span"
                          sx={{
                            flexShrink: 0,
                            px: 0.5,
                            borderRadius: 0.5,
                            border: '1px solid',
                            borderColor: 'error.main',
                            color: 'error.main',
                            fontSize: 10,
                            lineHeight: 1.5,
                          }}
                        >
                          黑名单
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', fontSize: 12, color: 'text.secondary' }}>
                      {e.isDir ? '—' : formatBytes(e.size)}
                    </TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', fontSize: 12, color: 'text.secondary' }}>
                      {e.modTime ? e.modTime.slice(0, 16).replace('T', ' ') : ''}
                    </TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {loading && <LinearProgress sx={{ position: 'absolute', bottom: 0, left: 0, right: 0 }} />}
      </Box>
    </Box>
  )
}
