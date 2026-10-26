// 会话覆盖层面板:连接中/等待确认(ConnectingPanel)与已退出(ExitPanel)。
// 由 App 在活动标签为 connecting/confirming/exited 时渲染,盖在常驻挂载的
// 会话视图树之上(视图树不能卸载,否则切标签会丢终端历史)。
import CloseIcon from '@mui/icons-material/Close'
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined'
import SyncIcon from '@mui/icons-material/Sync'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import type { SessionTab } from '../types'

/** 连接中/等待确认:居中加载态(confirming 显示指纹确认图标)。 */
export function ConnectingPanel({ tab }: { tab: SessionTab }) {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {tab.status === 'confirming' ? (
        <SyncIcon sx={{ fontSize: 40, color: 'secondary.main' }} />
      ) : (
        <CircularProgress size={40} />
      )}
      <Typography variant="body1" color="text.secondary">
        {tab.status === 'confirming'
          ? '等待确认主机密钥…'
          : `正在连接 ${tab.cfg?.user ?? ''}@${tab.cfg?.host ?? ''}…`}
      </Typography>
    </Box>
  )
}

/** 会话退出/连接失败:原因展示 + 重新连接 + 关闭。 */
export function ExitPanel({
  tab,
  onClose,
  onReconnect,
}: {
  tab: SessionTab
  onClose: () => void
  onReconnect: () => void
}) {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        px: 4,
      }}
    >
      <ErrorOutlineOutlinedIcon sx={{ fontSize: 40, color: 'error.main' }} />
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        会话已退出
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 520, textAlign: 'center', lineHeight: 1.8, wordBreak: 'break-all' }}
      >
        {tab.exitReason || '未知原因'}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
        <Button variant="contained" onClick={onReconnect}>
          重新连接
        </Button>
        <Button variant="outlined" startIcon={<CloseIcon />} onClick={onClose}>
          关闭标签
        </Button>
      </Box>
    </Box>
  )
}
