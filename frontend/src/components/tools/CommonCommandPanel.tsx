// 常用命令工具面板:两种模式(顶部切换)。
//   - 命令模式:一条命令 + 一句描述的可复用速查列表(全服务器通用),数据存
//     localStorage(termhub.commoncommands);支持添加/搜索/复制/执行/修改/删除。
//   - 命令组模式:多条命令按顺序组成一个组(可按主机名关联),见 CommandGroupPanel。
// 模式选择记入 localStorage(termhub.commonmode)跨启动保留。
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SearchIcon from '@mui/icons-material/Search'
import TerminalIcon from '@mui/icons-material/Terminal'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { api } from '../../services/api'
import { clipboard } from '../../services/clipboard'
import { addCommandToGroup, createCommandGroup, groupsForHost, loadCommandGroups } from '../../services/commandGroups'
import type { CommandGroup } from '../../services/commandGroups'
import { loadCommands, persistCommands } from '../../services/commonCommands'
import type { CommonCommand, CommonCommandType } from '../../services/commonCommands'
import { addCommandsToPrivate, loadPrivateCommands, persistPrivateCommands } from '../../services/privateCommands'
import { useNotificationStore } from '../../store/notificationStore'
import { useGroupRunStore } from '../../store/groupRunStore'
import { errMsg } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'
import { CommandGroupDialog } from './CommandGroupDialog'
import { CommandGroupPanel } from './CommandGroupPanel'

/** 类型展示元数据(标签 + 颜色)。 */
const TYPE_META: Record<CommonCommandType, { label: string; color: string }> = {
  normal: { label: '常规', color: 'text.secondary' },
  transfer: { label: '传输', color: 'info.main' },
  external: { label: '外部', color: 'warning.main' },
}

/** 面板模式:命令模式 / 命令组模式。 */
type PanelMode = 'command' | 'group'

const MODE_KEY = 'termhub.commonmode'

/** 命令库:公共命令库(全服务器通用) / 私有命令库(仅本连接可见)。 */
type Library = 'public' | 'private'

const LIB_KEY = 'termhub.commonlib'

function loadMode(): PanelMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'group' ? 'group' : 'command'
  } catch {
    return 'command'
  }
}

/** 上次选中的命令库;无 connId(未保存连接)时私有库不可用,回落公共库。 */
function loadLibrary(connId?: string): Library {
  if (!connId) return 'public'
  try {
    return localStorage.getItem(LIB_KEY) === 'private' ? 'private' : 'public'
  } catch {
    return 'public'
  }
}

/** 常用命令面板:命令模式(速查表)与命令组模式(有序命令组)切换。 */
export function CommonCommandPanel({
  sessionId,
  connId,
  host,
}: {
  sessionId: string
  /** 连接库中的机器 id:私有命令库按它隔离。 */
  connId?: string
  host?: string
}) {
  const [mode, setMode] = useState<PanelMode>(loadMode)
  // 当前命令库:命令模式与命令组模式共用(命令组只作用于公共库的勾选)
  const [library, setLibrary] = useState<Library>(() => loadLibrary(connId))
  const [list, setList] = useState<CommonCommand[]>(() =>
    loadLibrary(connId) === 'private' ? loadPrivateCommands(connId) : loadCommands(),
  )
  const [query, setQuery] = useState('')
  const notify = useNotificationStore((s) => s.notify)
  const startRun = useGroupRunStore((s) => s.start)
  const anyRunning = useGroupRunStore((s) => s.run?.status === 'running')

  const changeMode = (_: unknown, next: PanelMode | null) => {
    if (!next) return
    setMode(next)
    setQuery('') // 切换模式时清空搜索,只展示目标模式自身的列表
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      /* 隐私模式,静默 */
    }
  }

  /** 切换命令库(公共 ↔ 私有):重载列表并清空搜索与勾选。 */
  const changeLibrary = (_: unknown, next: Library | null) => {
    if (!next || next === library) return
    if (next === 'private' && !connId) return
    setLibrary(next)
    setQuery('')
    setSelectedIds([])
    setList(next === 'private' ? loadPrivateCommands(connId) : loadCommands())
    try {
      localStorage.setItem(LIB_KEY, next)
    } catch {
      /* 隐私模式,静默 */
    }
  }

  // 添加/编辑共用对话框
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [type, setType] = useState<CommonCommandType>('normal')
  const [command, setCommand] = useState('')
  const [description, setDescription] = useState('')

  // 待删除确认 / 复制反馈
  const [pendingDelete, setPendingDelete] = useState<CommonCommand | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  // 右键菜单(命令操作:新建/加入命令组、复制)
  const [menu, setMenu] = useState<{ x: number; y: number; item: CommonCommand; groups: CommandGroup[] } | null>(null)
  // 多选:selectedIds 的数组顺序 = 勾选顺序
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  // 由选中命令创建命令组(唯一创建入口)
  const [createOpen, setCreateOpen] = useState(false)

  // 过滤后按"描述"升序排序(描述为空排在最前)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? list.filter((c) => c.command.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
      : [...list]
    return base.sort((a, b) => a.description.localeCompare(b.description, 'zh'))
  }, [list, query])

  const update = (next: CommonCommand[]) => {
    setList(next)
    if (library === 'private') persistPrivateCommands(connId, next)
    else persistCommands(next)
  }

  const openAdd = () => {
    setEditingId(null)
    setType('normal')
    setCommand('')
    setDescription('')
    setDialogOpen(true)
  }

  const openEdit = (item: CommonCommand) => {
    setEditingId(item.id)
    setType(item.type)
    setCommand(item.command)
    setDescription(item.description)
    setDialogOpen(true)
  }

  const handleSubmit = () => {
    const text = command.trim()
    if (!text) return
    const desc = description.trim()
    if (editingId !== null) {
      update(list.map((c) => (c.id === editingId ? { ...c, type, command: text, description: desc } : c)))
    } else {
      update([{ id: Date.now(), type, command: text, description: desc }, ...list])
    }
    setDialogOpen(false)
  }

  const doDelete = () => {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    update(list.filter((c) => c.id !== target.id))
    setSelectedIds((prev) => prev.filter((id) => id !== target.id))
  }

  const copy = async (item: CommonCommand) => {
    await clipboard.setText(item.command)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1200)
  }

  /** 执行:常规命令写入左侧终端;外部/传输命令走执行引擎(单条运行)。 */
  const execute = async (item: CommonCommand) => {
    if (item.type === 'normal') {
      try {
        await api.writeInput(sessionId, item.command + '\r')
      } catch (err) {
        notify(errMsg(err), 'error')
      }
      return
    }
    if (anyRunning) {
      notify('已有任务正在执行,请等待完成', 'warning')
      return
    }
    startRun(sessionId, 'single', item.description || item.command, [item.command])
  }

  /** 操作成功提示(右下角通知)。 */
  const showInfo = (msg: string) => notify(msg, 'success')

  /** 右键命令:把该行纳入选中(若尚未选中),并记录位置与可操作的命令组。 */
  const openMenu = (e: ReactMouseEvent, item: CommonCommand) => {
    e.preventDefault()
    setSelectedIds((prev) => (prev.includes(item.id) ? prev : [item.id]))
    setMenu({ x: e.clientX, y: e.clientY, item, groups: groupsForHost(loadCommandGroups(), host) })
  }

  // ---- 多选:selectedIds 的数组顺序即勾选顺序 ----

  /** 勾选:追加到末尾(记住顺序);取消:移除。 */
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  /** 按勾选顺序取出命令文本。 */
  const selectedCommands = (): string[] =>
    selectedIds.map((id) => list.find((c) => c.id === id)?.command ?? '').filter((c) => c !== '')

  /** 批量复制:按勾选顺序以 && 拼接。 */
  const copySelected = async () => {
    const cmds = selectedCommands()
    if (cmds.length === 0) return
    await clipboard.setText(cmds.join(' && '))
    showInfo(`已复制 ${cmds.length} 条（按勾选顺序以 && 拼接）`)
  }

  /** 右键菜单:用勾选命令新建命令组(唯一创建入口)。 */
  const createFromMenu = () => {
    setMenu(null)
    setCreateOpen(true)
  }

  /** 命令库右键:把勾选命令批量加入本机私有库(按命令文本去重;不删除命令库原条目)。 */
  const addSelectedToPrivate = () => {
    setMenu(null)
    const picked = selectedIds
      .map((id) => list.find((c) => c.id === id))
      .filter((c): c is CommonCommand => !!c)
    if (picked.length === 0) return
    const n = addCommandsToPrivate(connId, picked)
    showInfo(`已添加到私有 ${n}/${picked.length} 条（已存在的跳过）`)
  }

  /** 右键菜单:按勾选顺序把所选命令加入指定命令组(已存在不重复)。 */
  const addSelectedToGroup = (g: CommandGroup) => {
    setMenu(null)
    const cmds = selectedCommands()
    if (cmds.length === 0) return
    let n = 0
    for (const cmd of cmds) {
      if (addCommandToGroup(g.id, cmd)) n += 1
    }
    showInfo(`已加入「${g.name}」${n}/${cmds.length} 条（已存在的跳过）`)
  }

  /** 用勾选命令新建命令组(唯一创建入口,命令按勾选顺序)。 */
  const createFromSelection = (draft: { name: string; hosts: string[] }) => {
    const cmds = selectedCommands()
    setCreateOpen(false)
    if (cmds.length === 0) return
    createCommandGroup(draft.name, draft.hosts, cmds)
    setSelectedIds([])
    showInfo(`已创建命令组「${draft.name}」（${cmds.length} 条命令）`)
  }

  // 顶部工具栏(两种模式共用):模式操作按钮 + 搜索框 + 模式切换
  const header = (
    <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center' }}>
      {mode === 'command' && (
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openAdd}>
          添加
        </Button>
      )}
      <TextField
        size="small"
        placeholder={mode === 'command' ? '搜索命令 / 描述' : '搜索命令组'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ flex: 1 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16 }} />
              </InputAdornment>
            ),
          },
          htmlInput: { style: { fontSize: 13 } },
        }}
      />
      <ToggleButtonGroup size="small" exclusive value={mode} onChange={changeMode}>
        <ToggleButton value="command" sx={{ px: 1.5, py: 0.25 }}>
          命令
        </ToggleButton>
        <ToggleButton value="group" sx={{ px: 1.5, py: 0.25 }}>
          命令组
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )

  // 命令组模式:独立面板(命令模式的状态与对话框与它无关)
  if (mode === 'group') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {header}
        <CommandGroupPanel sessionId={sessionId} host={host} query={query} />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {header}

      {/* 列表 */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <TableContainer sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
          <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', '& th, & td': { borderColor: 'divider' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ py: 0.75, px: 0.5, width: 60, whiteSpace: 'nowrap' }}>选择</TableCell>
                <TableCell sx={{ py: 0.75, width: 220, whiteSpace: 'nowrap' }}>描述</TableCell>
                {/* 命令列不设宽度:自动占满剩余空间,长命令不再被截断 */}
                <TableCell sx={{ py: 0.75, whiteSpace: 'nowrap' }}>命令</TableCell>
                <TableCell sx={{ py: 0.75, px: 0.5, width: 116, whiteSpace: 'nowrap' }}>
                  操作
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((item) => (
                <TableRow
                  key={item.id}
                  hover
                  onContextMenu={(e) => openMenu(e, item)}
                  sx={{ '&:last-child td': { border: 0 } }}
                >
                  <TableCell sx={{ py: 0.5, px: 0.5 }}>
                    <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                      <Checkbox
                        size="small"
                        sx={{ p: 0.5 }}
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleSelect(item.id)}
                      />
                      {selectedIds.includes(item.id) && (
                        <Box
                          sx={{
                            minWidth: 16,
                            height: 16,
                            px: 0.25,
                            borderRadius: 8,
                            bgcolor: 'primary.main',
                            color: 'background.default',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                        >
                          {selectedIds.indexOf(item.id) + 1}
                        </Box>
                      )}
                    </Stack>
                  </TableCell>
                  {/* 双击描述 = 执行该命令(含类型分流,与「执行」按钮一致) */}
                  <TableCell sx={{ py: 0.75, minWidth: 0 }} onDoubleClick={() => void execute(item)}>
                    {item.description ? (
                      <Tooltip
                        title={`${item.description}（双击执行）`}
                        slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}
                      >
                        <Typography variant="body2" noWrap sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                          {item.description}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                        —
                      </Typography>
                    )}
                  </TableCell>
                  {/* 双击命令 = 复制到粘贴板(与复制按钮一致) */}
                  <TableCell sx={{ py: 0.75, minWidth: 0 }} onDoubleClick={() => void copy(item)}>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                      {item.type !== 'normal' && (
                        <Box
                          sx={{
                            flexShrink: 0,
                            px: 0.5,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: TYPE_META[item.type].color,
                            color: TYPE_META[item.type].color,
                            fontSize: 10,
                            lineHeight: 1.6,
                          }}
                        >
                          {TYPE_META[item.type].label}
                        </Box>
                      )}
                      <Tooltip
                        title={item.command}
                        slotProps={{ tooltip: { sx: { maxWidth: 620, whiteSpace: 'normal', wordBreak: 'break-all' } } }}
                      >
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{
                            fontFamily: '"Cascadia Code", Consolas, monospace',
                            fontSize: 12.5,
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {item.command}
                        </Typography>
                      </Tooltip>
                      <Tooltip title={copiedId === item.id ? '已复制' : '复制（或双击命令）'}>
                        <IconButton
                          size="small"
                          sx={{ flexShrink: 0 }}
                          onClick={() => void copy(item)}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <ContentCopyIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ py: 0.5, px: 1, whiteSpace: 'nowrap' }}>
                    <Tooltip
                      title={
                        item.type === 'external'
                          ? '执行外部命令（宿主机）'
                          : item.type === 'transfer'
                            ? '执行传输命令'
                            : '执行（发送到左侧终端并回车）'
                      }
                    >
                      <span>
                        <IconButton size="small" color="primary" onClick={() => void execute(item)}>
                          <PlayArrowIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="修改">
                      <IconButton size="small" onClick={() => openEdit(item)}>
                        <EditIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton size="small" color="error" onClick={() => setPendingDelete(item)}>
                        <DeleteIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {list.length === 0 && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            <TerminalIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary">
              {library === 'private'
                ? '本机暂无私有命令,点「添加」新建,或在命令库右键「添加到私有」'
                : '暂无常用命令,点击上方"添加"新建'}
            </Typography>
          </Box>
        )}
        {list.length > 0 && filtered.length === 0 && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              没有匹配的命令
            </Typography>
          </Box>
        )}

        {/* 右下角悬浮:命令库 ↔ 私有命令库 切换(私有库按连接 id 隔离) */}
        <Tooltip title={connId ? '' : '该连接未保存,私有命令库不可用（请先保存连接）'}>
          <Paper
            elevation={4}
            sx={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              zIndex: 3,
              borderRadius: 999,
              px: 0.25,
              py: 0.25,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <ToggleButtonGroup
              size="small"
              exclusive
              value={library}
              onChange={changeLibrary}
              sx={{
                gap: 0.25,
                '& .MuiToggleButton-root': {
                  border: 0,
                  borderRadius: '999px !important',
                  px: 1.5,
                  py: 0.25,
                  fontSize: 12,
                  lineHeight: 1.8,
                  textTransform: 'none',
                },
              }}
            >
              <ToggleButton value="public">命令库</ToggleButton>
              <ToggleButton value="private" disabled={!connId}>
                私有
              </ToggleButton>
            </ToggleButtonGroup>
          </Paper>
        </Tooltip>
      </Box>

      {/* 多选状态条(选中后出现在底部;具体操作见右键菜单) */}
      {selectedIds.length > 0 && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'action.hover',
            display: 'flex',
            gap: 1,
            alignItems: 'center',
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            已选 {selectedIds.length} 项（按勾选顺序）
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {library === 'public'
              ? '右键命令：新建命令组 / 加入命令组 / 复制 / 添加到私有'
              : '右键命令：新建命令组 / 加入命令组 / 复制'}
          </Typography>
          <Button size="small" onClick={() => setSelectedIds([])}>
            清空
          </Button>
        </Box>
      )}

      {/* 右键菜单:命令操作(新建/加入命令组、复制) */}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem onClick={createFromMenu}>新建命令组…</MenuItem>
        <MenuItem onClick={() => void copySelected()}>复制（&& 拼接）</MenuItem>
        {library === 'public' && (
          <MenuItem disabled={!connId} onClick={addSelectedToPrivate}>
            添加到私有
          </MenuItem>
        )}
        <Divider sx={{ my: 0.5 }} />
        <MenuItem disabled sx={{ opacity: 1, fontWeight: 600, fontSize: 12.5, color: 'text.secondary' }}>
          加入命令组
        </MenuItem>
        {menu && menu.groups.length === 0 && <MenuItem disabled>暂无命令组</MenuItem>}
        {menu?.groups.map((g) => (
          <MenuItem key={g.id} onClick={() => addSelectedToGroup(g)}>
            {g.name}
          </MenuItem>
        ))}
      </Menu>

      {/* 由勾选命令创建命令组(唯一创建入口) */}
      {createOpen && (
        <CommandGroupDialog
          mode="create"
          initial={{ name: '', hosts: [], commands: selectedCommands() }}
          onClose={() => setCreateOpen(false)}
          onSubmit={createFromSelection}
        />
      )}

      {/* 添加/编辑对话框 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6">{editingId === null ? '添加常用命令' : '修改常用命令'}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            全服务器通用,保存后可在任意会话中复制使用
          </Typography>
        </DialogTitle>
        <DialogContent dividers sx={{ backgroundColor: 'background.default' }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                类型
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={type}
                onChange={(_, v) => v && setType(v as CommonCommandType)}
              >
                <ToggleButton value="normal" sx={{ px: 1.5, py: 0.25 }}>
                  常规
                </ToggleButton>
                <ToggleButton value="transfer" sx={{ px: 1.5, py: 0.25 }}>
                  传输
                </ToggleButton>
                <ToggleButton value="external" sx={{ px: 1.5, py: 0.25 }}>
                  外部
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <TextField
              fullWidth
              size="small"
              label="命令"
              placeholder="例如:systemctl status nginx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              multiline
              minRows={2}
              maxRows={5}
              autoFocus
              sx={{ '& textarea': { fontFamily: 'monospace' } }}
            />
            <TextField
              fullWidth
              size="small"
              label="描述"
              placeholder="例如:查看 nginx 服务状态(可选)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!command.trim()}>
            {editingId === null ? '添加' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="删除常用命令"
        message={pendingDelete ? `确定删除「${pendingDelete.command}」?此操作不可恢复。` : ''}
        confirmLabel="删除"
        danger
        onConfirm={doDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  )
}
