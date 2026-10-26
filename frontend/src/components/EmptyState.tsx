// 旧版空状态页。UI 改版(浏览器式)后空白标签页改由 ServerGrid(服务器卡片墙)
// 承担,本组件不再被引用,保留作归档。
import AddIcon from '@mui/icons-material/Add'
import TerminalIcon from '@mui/icons-material/Terminal'
import { Box, Button, Typography } from '@mui/material'
import { useAppStore } from '../store/appStore'

/** 无会话时的空状态:引导新建或选择连接。 */
export function EmptyState() {
  const openNewDialog = useAppStore((s) => s.openNewDialog)

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
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: 4,
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(135deg, #7aa2f7 0%, #bb9af7 100%)',
          color: '#10121a',
          mb: 1,
        }}
      >
        <TerminalIcon sx={{ fontSize: 36 }} />
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        打开一个终端会话
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', lineHeight: 1.8 }}>
        从左侧选择一个已保存的连接,
        <br />
        或新建连接并立刻开始使用
      </Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={openNewDialog} sx={{ mt: 1 }}>
        新建连接
      </Button>
    </Box>
  )
}
