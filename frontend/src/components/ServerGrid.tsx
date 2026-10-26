// 空白标签页的服务器列表(浏览器式主页),支持两种视图:
//   - 卡片视图:已保存连接以中心小方块排列,点哪个连哪个;悬停浮现编辑/删除;
//   - 列表视图:表格逐行展示,列含名称/地址/认证/备注,行尾编辑/删除;
// 两种视图末尾都常驻"新建连接"入口。视图选择记入 localStorage 跨启动保留。
// 键盘:挂载后自动聚焦,↑/← 选上一项、↓/→ 选下一项(首尾循环),回车连接选中项
// (选中末尾"新建连接"则打开新建对话框)。
// 只在活动标签为 idle 时由 App 渲染。
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import GridViewIcon from '@mui/icons-material/GridView'
import KeyIcon from '@mui/icons-material/Key'
import LockIcon from '@mui/icons-material/Lock'
import ViewListIcon from '@mui/icons-material/ViewList'
import {
  Box,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useAppStore } from '../store/appStore'
import { AuthMethod } from '../types'
import type { ConnectionConfig } from '../types'

/** 服务器列表展示方式:卡片视图 / 列表视图。 */
type ServerView = 'card' | 'list'

const VIEW_KEY = 'termhub.serverview'

function loadView(): ServerView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'card'
  } catch {
    return 'card'
  }
}

/** 认证方式 + 跳板/代理的简短标注。 */
function authLabel(c: ConnectionConfig): string {
  return (
    (c.auth === AuthMethod.AuthPrivateKey ? '密钥认证' : '密码认证') +
    (c.proxyJump ? ' · 跳板' : '') +
    (c.proxy ? ' · 代理' : '')
  )
}

/** 认证图标(私钥 / 密码)。 */
function AuthIcon({ auth, size = 21 }: { auth: ConnectionConfig['auth']; size?: number }) {
  return auth === AuthMethod.AuthPrivateKey ? (
    <KeyIcon sx={{ fontSize: size }} />
  ) : (
    <LockIcon sx={{ fontSize: size }} />
  )
}

/** 空白标签页的服务器列表:卡片 / 列表两种视图,点选即连接;
 *  编辑/删除随卡片悬停或列表行尾操作(替代已移除的侧栏管理入口)。 */
export function ServerGrid() {
  const connections = useAppStore((s) => s.connections)
  const connect = useAppStore((s) => s.connect)
  const openNewDialog = useAppStore((s) => s.openNewDialog)
  const openEditDialog = useAppStore((s) => s.openEditDialog)
  const askDelete = useAppStore((s) => s.askDelete)

  const [view, setView] = useState<ServerView>(loadView)

  const changeView = (_: unknown, next: ServerView | null) => {
    if (!next) return
    setView(next)
    // 焦点交还容器,保证切换视图后方向键/回车继续生效
    containerRef.current?.focus()
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* 隐私模式,静默 */
    }
  }

  // 键盘导航:选中项下标(0..connections.length-1 为服务器,connections.length 为"新建连接")
  const [selected, setSelected] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const itemCount = connections.length + 1

  // 连接增删后纠正越界选中
  useEffect(() => {
    setSelected((prev) => Math.min(prev, itemCount - 1))
  }, [itemCount])

  // 挂载后聚焦容器,使方向键/回车直接可用(空标签页不会与终端抢焦点)
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  // 选中项滚入视口
  useEffect(() => {
    containerRef.current
      ?.querySelector('[data-nav-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected, view])

  /** 回车:选中已保存服务器则连接,选中末尾"新建连接"则打开新建对话框。 */
  const activate = (index: number) => {
    if (index < connections.length) void connect(connections[index])
    else openNewDialog()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((prev) => (prev + 1) % itemCount)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((prev) => (prev - 1 + itemCount) % itemCount)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(selected)
    }
  }

  // 空列表或卡片视图时内容垂直居中;列表视图从上排布。
  const centered = connections.length === 0 || view === 'card'

  return (
    <Box
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}
    >
      {/* 视图切换(右上角) */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 2, pb: 0 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={changeView}>
          <ToggleButton value="card" sx={{ px: 1 }}>
            <Tooltip title="卡片视图">
              <GridViewIcon sx={{ fontSize: 18 }} />
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="list" sx={{ px: 1 }}>
            <Tooltip title="列表视图">
              <ViewListIcon sx={{ fontSize: 18 }} />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* 内容区:卡片居中 / 列表上对齐,超出滚动 */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: centered ? 'center' : 'flex-start',
          p: 4,
          pt: 3,
        }}
      >
        {connections.length === 0 && (
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              还没有保存的服务器
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
              点击下方{view === 'card' ? '卡片' : '按钮'}新建一个连接
            </Typography>
          </Box>
        )}

        {view === 'card' ? (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2.5,
              justifyContent: 'center',
              maxWidth: 980,
            }}
          >
            {connections.map((c, index) => (
              <Box
                key={c.id}
                data-nav-selected={selected === index}
                onClick={() => void connect(c)}
                sx={{
                  width: 168,
                  py: 2.5,
                  px: 2,
                  borderRadius: 3,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 1.25,
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                  '& .card-action': { opacity: selected === index ? 1 : 0, transition: 'opacity 0.12s' },
                  '&:hover': {
                    borderColor: 'primary.main',
                    transform: 'translateY(-3px)',
                    boxShadow: '0 8px 24px rgba(122, 162, 247, 0.15)',
                    '& .card-action': { opacity: 1 },
                  },
                  // 键盘选中态(与悬停一致的视觉强调)
                  ...(selected === index && {
                    borderColor: 'primary.main',
                    boxShadow: '0 8px 24px rgba(122, 162, 247, 0.15)',
                  }),
                }}
              >
                {/* 悬停浮现:编辑/删除 */}
                <Box
                  className="card-action"
                  sx={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 0.25 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tooltip title="编辑">
                    <IconButton size="small" onClick={() => openEditDialog(c)}>
                      <EditIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="删除">
                    <IconButton size="small" color="error" onClick={() => askDelete(c)}>
                      <DeleteIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box
                  sx={{
                    width: 42,
                    height: 42,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'linear-gradient(135deg, #7aa2f7 0%, #bb9af7 100%)',
                    color: '#10121a',
                  }}
                >
                  <AuthIcon auth={c.auth} />
                </Box>
                <Typography variant="body1" noWrap sx={{ fontWeight: 700, maxWidth: '100%' }}>
                  {c.name}
                </Typography>
                {/* 描述(可选):单行截断,悬浮看全文 */}
                {c.description && (
                  <Tooltip title={c.description} placement="bottom">
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      sx={{ maxWidth: '100%', fontSize: 11, mt: -0.5 }}
                    >
                      {c.description}
                    </Typography>
                  </Tooltip>
                )}
                <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%' }}>
                  {c.user}@{c.host}:{c.port || 22}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
                  {authLabel(c)}
                </Typography>
              </Box>
            ))}

            {/* 新建连接卡片 */}
            <Box
              data-nav-selected={selected === connections.length}
              onClick={openNewDialog}
              sx={{
                width: 168,
                py: 2.5,
                px: 2,
                borderRadius: 3,
                border: '1.5px dashed',
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'action.hover',
                  transform: 'translateY(-3px)',
                },
                ...(selected === connections.length && {
                  borderColor: 'primary.main',
                  bgcolor: 'action.hover',
                }),
              }}
            >
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  border: '1.5px dashed',
                  borderColor: 'text.secondary',
                  color: 'text.secondary',
                }}
              >
                <AddIcon sx={{ fontSize: 21 }} />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                新建连接
              </Typography>
            </Box>
          </Box>
        ) : (
          /* 列表视图 */
          <TableContainer
            sx={{
              width: '100%',
              maxWidth: 980,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              bgcolor: 'background.paper',
            }}
          >
            <Table size="small" sx={{ tableLayout: 'fixed', '& th, & td': { borderColor: 'divider' } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ py: 1, width: '20%', whiteSpace: 'nowrap' }}>名称</TableCell>
                  <TableCell sx={{ py: 1, width: '26%', whiteSpace: 'nowrap' }}>地址</TableCell>
                  <TableCell sx={{ py: 1, width: '14%', whiteSpace: 'nowrap' }}>认证</TableCell>
                  <TableCell sx={{ py: 1, whiteSpace: 'nowrap' }}>备注</TableCell>
                  <TableCell sx={{ py: 1, width: 96, whiteSpace: 'nowrap' }}>
                    操作
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {connections.map((c, index) => (
                  <TableRow
                    key={c.id}
                    data-nav-selected={selected === index}
                    hover
                    onClick={() => void connect(c)}
                    sx={{
                      cursor: 'pointer',
                      ...(selected === index && { backgroundColor: 'action.selected' }),
                    }}
                  >
                    <TableCell sx={{ py: 1, whiteSpace: 'nowrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        <Box
                          sx={{
                            width: 28,
                            height: 28,
                            borderRadius: 1.5,
                            flexShrink: 0,
                            display: 'grid',
                            placeItems: 'center',
                            background: 'linear-gradient(135deg, #7aa2f7 0%, #bb9af7 100%)',
                            color: '#10121a',
                          }}
                        >
                          <AuthIcon auth={c.auth} size={16} />
                        </Box>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
                          {c.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell
                      sx={{
                        py: 1,
                        whiteSpace: 'nowrap',
                        color: 'text.secondary',
                        fontSize: 12.5,
                        fontFamily: '"Cascadia Code", Consolas, monospace',
                      }}
                    >
                      {c.user}@{c.host}:{c.port || 22}
                    </TableCell>
                    <TableCell sx={{ py: 1, whiteSpace: 'nowrap', color: 'text.secondary', fontSize: 12.5 }}>
                      {authLabel(c)}
                    </TableCell>
                    <TableCell sx={{ py: 1, maxWidth: 320 }}>
                      {c.description ? (
                        <Tooltip title={c.description}>
                          <Typography variant="body2" noWrap sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                            {c.description}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="body2" sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell
                      sx={{ py: 0.5, whiteSpace: 'nowrap' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip title="编辑">
                        <IconButton size="small" onClick={() => openEditDialog(c)}>
                          <EditIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" color="error" onClick={() => askDelete(c)}>
                          <DeleteIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}

                {/* 新建连接行 */}
                <TableRow
                  data-nav-selected={selected === connections.length}
                  hover
                  onClick={openNewDialog}
                  sx={{
                    cursor: 'pointer',
                    '&:last-child td': { border: 0 },
                    ...(selected === connections.length && { backgroundColor: 'action.selected' }),
                  }}
                >
                  <TableCell colSpan={5} sx={{ py: 1.25, color: 'text.secondary' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <AddIcon sx={{ fontSize: 18 }} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        新建连接
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  )
}
