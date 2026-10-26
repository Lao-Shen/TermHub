// 会话工具面板:进程管理(ProcessPanel)与端口状态(PortPanel)。
// 数据源 tools.listProcesses(ps 解析)/ tools.listPorts(ss 优先,netstat 回退),
// 均在后端既有会话上另开通道执行,不影响交互终端;
// 进程支持搜索(名/PID/用户)与右键 TERM/KILL(确认框),端口列表只读。
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
import type { PortInfo, ProcessInfo } from '../../types'
import { errMsg } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'

/** 进程管理面板:列表 + 搜索 + 右键终止/强制杀死。 */
export function ProcessPanel({ sessionId }: { sessionId: string }) {
  const [list, setList] = useState<ProcessInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; proc: ProcessInfo } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setList(await tools.listProcesses(sessionId))
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (p) =>
        p.command.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        p.user.toLowerCase().includes(q),
    )
  }, [list, query])

  // 待确认的 kill 操作(ConfirmDialog 展示)
  const [pending, setPending] = useState<{ proc: ProcessInfo; signal: 'TERM' | 'KILL' } | null>(null)

  const doKill = async () => {
    const target = pending
    setPending(null)
    if (!target) return
    try {
      await tools.killProcess(sessionId, target.proc.pid, target.signal)
      await load()
    } catch (err) {
      setError(errMsg(err))
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工具栏:搜索 + 刷新 */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          placeholder="搜索进程名 / PID / 用户"
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
                  <TableCell sx={{ py: 0.75, width: 72, whiteSpace: 'nowrap' }}>PID</TableCell>
                  <TableCell sx={{ py: 0.75, width: 64, whiteSpace: 'nowrap' }}>CPU%</TableCell>
                  <TableCell sx={{ py: 0.75, width: 64, whiteSpace: 'nowrap' }}>内存%</TableCell>
                  <TableCell sx={{ py: 0.75, width: 84, whiteSpace: 'nowrap' }}>状态</TableCell>
                  <TableCell sx={{ py: 0.75, width: 96, whiteSpace: 'nowrap' }}>用户</TableCell>
                  <TableCell sx={{ py: 0.75, whiteSpace: 'nowrap' }}>命令</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow
                    key={p.pid}
                    hover
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, proc: p })
                    }}
                    sx={{ '&:last-child td': { border: 0 } }}
                  >
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap' }}>{p.pid}</TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap' }}>{p.cpu.toFixed(1)}</TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap' }}>{p.mem.toFixed(1)}</TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', minWidth: 76 }}>{p.stat}</TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap' }}>{p.user}</TableCell>
                    <TableCell sx={{ py: 0.5, fontSize: 12.5, color: 'text.secondary' }}>
                      <Tooltip
                        title={p.command}
                        slotProps={{
                          tooltip: {
                            sx: { maxWidth: 620, whiteSpace: 'normal', wordBreak: 'break-all' },
                          },
                        }}
                      >
                        <Typography variant="body2" noWrap sx={{ fontSize: 12.5, maxWidth: 420 }}>
                          {p.command}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {loading && <LinearProgress sx={{ position: 'absolute', bottom: 0, left: 0, right: 0 }} />}
      </Box>

      {/* 右键菜单:终止 / 强制杀死 */}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem
          onClick={() => {
            const proc = menu?.proc
            setMenu(null)
            if (proc) setPending({ proc, signal: 'TERM' })
          }}
        >
          终止进程 (SIGTERM)
        </MenuItem>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            const proc = menu?.proc
            setMenu(null)
            if (proc) setPending({ proc, signal: 'KILL' })
          }}
        >
          强制杀死 (SIGKILL)
        </MenuItem>
      </Menu>

      {/* 确认框(MUI,替代 window.confirm) */}
      <ConfirmDialog
        open={!!pending}
        title={pending?.signal === 'KILL' ? '强制杀死进程' : '终止进程'}
        message={
          pending
            ? `${pending.signal === 'KILL' ? '强制杀死' : '终止'}进程 ${pending.proc.pid} (${pending.proc.command})?`
            : ''
        }
        confirmLabel={pending?.signal === 'KILL' ? '强制杀死' : '终止'}
        danger={pending?.signal === 'KILL'}
        onConfirm={() => void doKill()}
        onCancel={() => setPending(null)}
      />
    </Box>
  )
}

/** 端口状态面板:监听端口列表。 */
export function PortPanel({ sessionId }: { sessionId: string }) {
  const [list, setList] = useState<PortInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setList(await tools.listPorts(sessionId))
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
        <Tooltip title="刷新">
          <span>
            <IconButton size="small" onClick={() => void load()} disabled={loading}>
              <RefreshIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
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
                  <TableCell sx={{ py: 0.75, width: 72, whiteSpace: 'nowrap' }}>协议</TableCell>
                  <TableCell sx={{ py: 0.75, whiteSpace: 'nowrap' }}>监听地址</TableCell>
                  <TableCell sx={{ py: 0.75, width: 180, whiteSpace: 'nowrap' }}>进程</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map((p, i) => (
                  <TableRow key={i} hover sx={{ '&:last-child td': { border: 0 } }}>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', minWidth: 64 }}>{p.proto}</TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 12.5 }}>
                      {p.address}
                    </TableCell>
                    <TableCell sx={{ py: 0.5, whiteSpace: 'nowrap', minWidth: 128 }}>
                      {p.pid > 0 ? `${p.process} (${p.pid})` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {loading && <LinearProgress sx={{ position: 'absolute', bottom: 0, left: 0, right: 0 }} />}
      </Box>
    </Box>
  )
}
