// 命令组模式:展示命令组(全服务器通用,可按主机名关联)。
// 数据仅存前端 localStorage(见 services/commandGroups.ts),不依赖会话/服务器;
// 创建命令组只能从"命令模式"多选后点「新建命令组」(唯一创建入口),
// 命令成员增删也只通过命令模式的多选完成。本面板只做 展示/复制/修改(名称+关联机器)/删除。
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ChecklistIcon from '@mui/icons-material/Checklist'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import TerminalIcon from '@mui/icons-material/Terminal'
import VisibilityIcon from '@mui/icons-material/Visibility'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { clipboard } from '../../services/clipboard'
import { descriptionByCommand } from '../../services/commonCommands'
import {
  groupsForHost,
  joinGroupCommands,
  loadCommandGroups,
  persistCommandGroups,
} from '../../services/commandGroups'
import type { CommandGroup } from '../../services/commandGroups'
import { ConfirmDialog } from '../ConfirmDialog'
import { CommandGroupDialog } from './CommandGroupDialog'
import { useGroupRunStore } from '../../store/groupRunStore'

/** 命令组模式面板:展示命令组,可复制/修改/删除/执行(创建与成员增删在命令模式)。 */
export function CommandGroupPanel({
  sessionId,
  host,
  query,
}: {
  sessionId: string
  host?: string
  query: string
}) {
  const running = useGroupRunStore((s) => s.run?.status === 'running')
  const startRun = useGroupRunStore((s) => s.start)
  const armRun = useGroupRunStore((s) => s.arm)

  const [groups, setGroups] = useState<CommandGroup[]>(loadCommandGroups)
  const [editing, setEditing] = useState<CommandGroup | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CommandGroup | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [viewing, setViewing] = useState<CommandGroup | null>(null)

  const update = (next: CommandGroup[]) => {
    setGroups(next)
    persistCommandGroups(next)
  }

  // 只显示与当前主机相关、且匹配搜索关键字的组(未指定主机=全部服务器)
  const base = groupsForHost(groups, host)
  const q = query.trim().toLowerCase()
  const visible = q
    ? base.filter((g) => g.name.toLowerCase().includes(q) || g.commands.some((c) => c.toLowerCase().includes(q)))
    : base

  // ---- 修改(名称 + 关联机器)/ 复制 / 删除 ----

  const applyEdit = (id: number, draft: { name: string; hosts: string[] }) => {
    // 命令成员保持不变(增删只在命令模式的多选里做)
    update(groups.map((g) => (g.id === id ? { ...g, name: draft.name, hosts: draft.hosts } : g)))
    setEditing(null)
  }

  const copyGroup = async (g: CommandGroup) => {
    await clipboard.setText(joinGroupCommands(g.commands))
    setCopiedId(g.id)
    setTimeout(() => setCopiedId((cur) => (cur === g.id ? null : cur)), 1200)
  }

  const doDelete = () => {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    update(groups.filter((g) => g.id !== target.id))
  }

  /** 查看弹窗内调整命令(排序/删除)后保存。 */
  const applyView = (commands: string[]) => {
    if (!viewing) return
    update(groups.map((g) => (g.id === viewing.id ? { ...g, commands } : g)))
    setViewing(null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 列表 */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <TableContainer sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
          <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', '& th, & td': { borderColor: 'divider' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ py: 0.75, whiteSpace: 'nowrap' }}>名称</TableCell>
                <TableCell sx={{ py: 0.75, px: 0.5, width: 76, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  命令数量
                </TableCell>
                <TableCell sx={{ py: 0.75, px: 0.5, width: 168, whiteSpace: 'nowrap' }}>
                  操作
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((g) => {
                return (
                  <TableRow key={g.id} hover sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ py: 0.75, minWidth: 0 }}>
                      <Tooltip title={g.name}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                          {g.name}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ py: 0.75, px: 0.5 }}>
                      <Tooltip
                        title={g.commands.length > 0 ? g.commands.join('\n') : '（无命令）'}
                        slotProps={{
                          tooltip: { sx: { whiteSpace: 'pre-line', maxWidth: 620, wordBreak: 'break-all' } },
                        }}
                      >
                        <Typography variant="body2" sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                          {g.commands.length}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ py: 0.5, px: 0.5, whiteSpace: 'nowrap' }}>
                      <Tooltip title="查看（命令列表，可排序/删除）">
                        <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setViewing(g)}>
                          <VisibilityIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip
                        title={
                          running
                            ? '有命令组正在执行'
                            : g.commands.length === 0
                              ? '命令组为空'
                              : '执行该命令组（按顺序）'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            sx={{ p: 0.25 }}
                            disabled={running || g.commands.length === 0}
                            onClick={() => startRun(sessionId, 'group', g.name, g.commands)}
                          >
                            <PlayArrowIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={
                          running
                            ? '有命令组正在执行'
                            : g.commands.length === 0
                              ? '命令组为空'
                              : '按需执行（勾选要执行的命令）'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            sx={{ p: 0.25 }}
                            disabled={running || g.commands.length === 0}
                            onClick={() => armRun(sessionId, g.name, g.commands)}
                          >
                            <ChecklistIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={copiedId === g.id ? '已复制' : '复制（按顺序以 && 拼接）'}>
                        <IconButton size="small" sx={{ p: 0.25 }} onClick={() => void copyGroup(g)}>
                          <ContentCopyIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="修改">
                        <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setEditing(g)}>
                          <EditIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" color="error" sx={{ p: 0.25 }} onClick={() => setPendingDelete(g)}>
                          <DeleteIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {visible.length === 0 && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, px: 2 }}>
            <TerminalIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              {groups.length === 0
                ? '暂无命令组——请在「命令模式」勾选命令后点「新建命令组」'
                : q
                  ? '没有匹配的命令组'
                  : '当前服务器没有关联的命令组'}
            </Typography>
          </Box>
        )}
      </Box>

      {/* 修改对话框(只编辑 名称 + 关联机器) */}
      {editing && (
        <CommandGroupDialog
          mode="edit"
          initial={{ name: editing.name, hosts: editing.hosts, commands: editing.commands }}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => applyEdit(editing.id, draft)}
        />
      )}

      {/* 查看对话框(命令列表:排序/删除) */}
      {viewing && (
        <CommandGroupViewDialog group={viewing} onClose={() => setViewing(null)} onSave={applyView} />
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="删除命令组"
        message={pendingDelete ? `确定删除「${pendingDelete.name}」?此操作不可恢复。` : ''}
        confirmLabel="删除"
        danger
        onConfirm={doDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  )
}

/** 命令组「查看」弹窗:列表展示组内命令,支持上移/下移排序与删除(保存后写回)。 */
function CommandGroupViewDialog({
  group,
  onClose,
  onSave,
}: {
  group: CommandGroup
  onClose: () => void
  onSave: (commands: string[]) => void
}) {
  const [commands, setCommands] = useState<string[]>(group.commands)
  // 命令文本 → 描述(命令模式下维护的描述)
  const descMap = useMemo(() => descriptionByCommand(), [])

  const remove = (index: number) => setCommands((prev) => prev.filter((_, i) => i !== index))

  const move = (index: number, dir: -1 | 1) => {
    setCommands((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6">{group.name} · 命令</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          共 {commands.length} 条，可上移/下移排序、删除；新增请到「命令模式」多选后加入
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ backgroundColor: 'background.default' }}>
        {commands.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            暂无命令——请在「命令模式」勾选命令后加入本组
          </Typography>
        ) : (
          <Stack spacing={1}>
            {commands.map((cmd, index) => (
              <Stack key={`${index}-${cmd}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: 1,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'action.selected',
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {index + 1}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 12.5 }}
                  >
                    {cmd}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {descMap.get(cmd) || '（无描述）'}
                  </Typography>
                </Box>
                <Tooltip title="上移">
                  <span>
                    <IconButton size="small" sx={{ p: 0.25 }} disabled={index === 0} onClick={() => move(index, -1)}>
                      <ArrowUpwardIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="下移">
                  <span>
                    <IconButton
                      size="small"
                      sx={{ p: 0.25 }}
                      disabled={index === commands.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownwardIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="删除">
                  <IconButton size="small" color="error" sx={{ p: 0.25 }} onClick={() => remove(index)}>
                    <DeleteIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="contained" onClick={() => onSave(commands)}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
