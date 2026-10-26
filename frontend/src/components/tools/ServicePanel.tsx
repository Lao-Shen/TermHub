// 服务管理工具面板:远端 systemd 服务列表 + 右键操作。
// 数据源 tools.listServices(后端合并 list-units 运行状态与 list-unit-files
// 自启状态);搜索覆盖服务名/描述/状态/自启;
// 右键 start/stop/restart/enable/disable,其中 stop/restart/disable 需确认,
// 权限不足时后端自动 sudo -n 回退并给出配置提示。
import RefreshIcon from '@mui/icons-material/Refresh'
import SearchIcon from '@mui/icons-material/Search'
import {
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { tools } from '../../services/tools'
import type { ServiceInfo } from '../../types'
import { errMsg } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'

/** 运行状态 → 颜色与文案。 */
function activeMeta(active: string, sub: string): { color: string; label: string } {
  switch (active) {
    case 'active':
      return { color: '#9ece6a', label: sub === 'running' ? '运行中' : `active(${sub})` }
    case 'failed':
      return { color: '#f7768e', label: '失败' }
    case 'activating':
      return { color: '#e0af68', label: '启动中' }
    case 'inactive':
      return { color: '#414868', label: '已停止' }
    default:
      return { color: '#828bb8', label: active || '未知' }
  }
}

/** 自启状态 → 颜色与文案。 */
function enabledMeta(enabled: string): { color: string; label: string } {
  switch (enabled) {
    case 'enabled':
      return { color: '#9ece6a', label: '自启' }
    case 'disabled':
      return { color: '#828bb8', label: '手动' }
    case 'static':
      return { color: '#7dcfff', label: '静态' }
    case 'masked':
      return { color: '#f7768e', label: '已屏蔽' }
    default:
      return { color: '#828bb8', label: enabled || '未知' }
  }
}

/** 服务管理面板:列表 + 右键 启动/停止/重启/设自启/取消自启。 */
export function ServicePanel({ sessionId }: { sessionId: string }) {
  const [list, setList] = useState<ServiceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; svc: ServiceInfo } | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        s.active.toLowerCase().includes(q) ||
        (s.enabled ?? '').toLowerCase().includes(q),
    )
  }, [list, query])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setList(await tools.listServices(sessionId))
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  // 待确认操作(停止/重启/取消自启用确认框)
  const [pending, setPending] = useState<{ svc: ServiceInfo; action: string } | null>(null)

  const doAction = async () => {
    const target = pending
    setPending(null)
    if (!target) return
    try {
      await tools.controlService(sessionId, target.svc.name, target.action)
      await load()
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const requestAction = (action: string, needConfirm: boolean) => {
    const svc = menu?.svc
    setMenu(null)
    if (!svc) return
    if (needConfirm) {
      setPending({ svc, action })
      return
    }
    // 无风险操作直接执行
    void (async () => {
      try {
        await tools.controlService(sessionId, svc.name, action)
        await load()
      } catch (err) {
        setError(errMsg(err))
      }
    })()
  }

  const ACTION_LABEL: Record<string, string> = {
    stop: '停止',
    restart: '重启',
    disable: '取消自启',
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工具栏:搜索 + 刷新 */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          placeholder="搜索服务名 / 描述 / 状态"
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
        <Tooltip title="刷新">
          <span>
            <IconButton size="small" onClick={() => void load()} disabled={loading}>
              <RefreshIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 列表 */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 1 }}>
            <CircularProgress size={26} />
          </Box>
        )}
        {error ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="error" sx={{ wordBreak: 'break-all' }}>
              {error}
            </Typography>
          </Box>
        ) : (
          // 绝对定位铺满父盒:行数超出出垂直滚动条(不依赖百分比高度解析)
          <TableContainer sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', '& th, & td': { borderColor: 'divider' } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ py: 0.75, width: '30%', whiteSpace: 'nowrap' }}>服务</TableCell>
                  <TableCell sx={{ py: 0.75, width: 92, whiteSpace: 'nowrap' }}>状态</TableCell>
                  <TableCell sx={{ py: 0.75, width: 76, whiteSpace: 'nowrap' }}>自启</TableCell>
                  <TableCell sx={{ py: 0.75, whiteSpace: 'nowrap' }}>描述</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((s) => {
                  const am = activeMeta(s.active, s.sub)
                  const em = enabledMeta(s.enabled)
                  return (
                    <TableRow
                      key={s.name}
                      hover
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu({ x: e.clientX, y: e.clientY, svc: s })
                      }}
                      sx={{ '&:last-child td': { border: 0 } }}
                    >
                      <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 12.5 }}>
                        {s.name}
                      </TableCell>
                      <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', minWidth: 84 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: am.color, flexShrink: 0 }} />
                          <Typography variant="body2" sx={{ fontSize: 12.5, color: am.color, fontWeight: 600 }}>
                            {am.label}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', minWidth: 64 }}>
                        <Typography variant="body2" sx={{ fontSize: 12.5, color: em.color }}>
                          {em.label}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.5 }}>
                        <Tooltip
                          title={s.description || s.name}
                          slotProps={{ tooltip: { sx: { maxWidth: 520, whiteSpace: 'normal', wordBreak: 'break-all' } } }}
                        >
                          <Typography variant="body2" noWrap sx={{ fontSize: 12.5, color: 'text.secondary', maxWidth: 380 }}>
                            {s.description || '—'}
                          </Typography>
                        </Tooltip>
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

      {/* 右键菜单 */}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem onClick={() => requestAction('start', false)}>启动</MenuItem>
        <MenuItem onClick={() => requestAction('stop', true)}>停止</MenuItem>
        <MenuItem onClick={() => requestAction('restart', true)}>重启</MenuItem>
        <MenuItem onClick={() => requestAction('enable', false)}>设置自启</MenuItem>
        <MenuItem onClick={() => requestAction('disable', true)}>取消自启</MenuItem>
      </Menu>

      {/* 确认框(MUI,替代 window.confirm) */}
      <ConfirmDialog
        open={!!pending}
        title="服务操作确认"
        message={pending ? `确定${ACTION_LABEL[pending.action] ?? ''}服务 ${pending.svc.name}?` : ''}
        confirmLabel={pending ? (ACTION_LABEL[pending.action] ?? '确定') : '确定'}
        danger={pending?.action === 'stop' || pending?.action === 'disable'}
        onConfirm={() => void doAction()}
        onCancel={() => setPending(null)}
      />
    </Box>
  )
}
