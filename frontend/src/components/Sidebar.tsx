// 旧版右侧服务器管理栏。UI 改版(浏览器式)后 App 不再引用本组件,
// 连接管理由 ServerGrid(卡片墙)承担;保留文件仅作归档,改动 App 时勿顺手启用。
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import KeyIcon from '@mui/icons-material/Key'
import LockIcon from '@mui/icons-material/Lock'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { Box, Divider, IconButton, List, ListItem, ListItemButton, Tooltip, Typography } from '@mui/material'
import { useAppStore } from '../store/appStore'
import { AuthMethod } from '../types'

/** 右侧服务器管理栏:已保存连接(连接/编辑/删除)+ 新建入口。
 *  服务器也以卡片墙形式展示在空白标签页(见 ServerGrid),点击行为一致。 */
export function Sidebar() {
  const connections = useAppStore((s) => s.connections)
  const connect = useAppStore((s) => s.connect)
  const openNewDialog = useAppStore((s) => s.openNewDialog)
  const openEditDialog = useAppStore((s) => s.openEditDialog)
  const askDelete = useAppStore((s) => s.askDelete)

  return (
    <Box
      sx={{
        width: 232,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      {/* 标题区 */}
      <Box sx={{ px: 2, py: 2.25 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: 0.3 }}>
          服务器
        </Typography>
      </Box>

      <Divider />

      {/* 连接列表 */}
      <List dense disablePadding sx={{ flex: 1, overflowY: 'auto', py: 1 }}>
        {connections.map((c) => (
          <ListItem key={c.id} disablePadding sx={{ px: 1, py: 0.25 }}>
            <ListItemButton
              onClick={() => void connect(c)}
              sx={{
                borderRadius: 1.5,
                gap: 1.25,
                pr: 0.75,
                // 编辑/删除悬停时浮现,保持列表安静
                '& .row-action': { opacity: 0, transition: 'opacity 0.12s' },
                '&:hover .row-action': { opacity: 1 },
              }}
            >
              {c.auth === AuthMethod.AuthPrivateKey ? (
                <KeyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              ) : (
                <LockIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {c.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                  {c.user}@{c.host}:{c.port || 22}
                </Typography>
              </Box>
              <Tooltip title="连接">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); void connect(c) }}>
                  <PlayArrowIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="编辑">
                <IconButton
                  className="row-action"
                  size="small"
                  onClick={(e) => { e.stopPropagation(); openEditDialog(c) }}
                >
                  <EditIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton
                  className="row-action"
                  size="small"
                  color="error"
                  onClick={(e) => { e.stopPropagation(); askDelete(c) }}
                >
                  <DeleteIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            </ListItemButton>
          </ListItem>
        ))}
        {connections.length === 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: 'center', px: 2, py: 4, lineHeight: 1.7 }}
          >
            还没有保存的服务器
            <br />
            点击下方按钮新建一个
          </Typography>
        )}
      </List>

      {/* 新建入口 */}
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <ListItemButton
          onClick={openNewDialog}
          sx={{
            borderRadius: 1.5,
            justifyContent: 'center',
            gap: 1,
            color: 'primary.main',
            fontWeight: 600,
          }}
        >
          <AddIcon sx={{ fontSize: 18 }} />
          新建连接
        </ListItemButton>
      </Box>
    </Box>
  )
}
