// 全局通知中心:右下角弹出通知(统一承载"通知类消息")。
// 自身不定位,由 App 的右下角停靠区摆放到传输悬浮按钮上方,避免重叠。
import { Alert, Box } from '@mui/material'
import { useNotificationStore } from '../store/notificationStore'

export function NotificationCenter() {
  const items = useNotificationStore((s) => s.items)
  const dismiss = useNotificationStore((s) => s.dismiss)

  if (items.length === 0) return null

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 1,
        maxWidth: 420,
        pointerEvents: 'none',
      }}
    >
      {items.map((n) => (
        <Alert
          key={n.id}
          severity={n.severity}
          variant="filled"
          onClose={() => dismiss(n.id)}
          sx={{ pointerEvents: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', wordBreak: 'break-word' }}
        >
          {n.message}
        </Alert>
      ))}
    </Box>
  )
}
