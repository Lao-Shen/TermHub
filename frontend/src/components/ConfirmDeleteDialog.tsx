// 删除连接确认弹窗(store.deletePrompt 驱动)。
// 卡片墙/旧侧栏的删除入口都会先 askDelete,经此确认后才真正移除;
// 提醒用户已打开的会话不受影响、操作不可恢复。
import DeleteIcon from '@mui/icons-material/Delete'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useAppStore } from '../store/appStore'

/** 删除连接确认弹窗(store.deletePrompt 驱动)。 */
export function ConfirmDeleteDialog() {
  const prompt = useAppStore((s) => s.deletePrompt)
  const confirmDelete = useAppStore((s) => s.confirmDelete)
  const cancelDelete = useAppStore((s) => s.cancelDelete)

  return (
    <Dialog open={!!prompt} onClose={cancelDelete} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <DeleteIcon color="error" />
        删除连接
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
          确定删除连接
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, mx: 0.5 }}>
            {prompt?.name}
          </Box>
          ({prompt?.user}@{prompt?.host})吗?
          <br />
          已打开的会话不受影响,此操作不可恢复。
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={cancelDelete} color="inherit">
          取消
        </Button>
        <Button variant="contained" color="error" onClick={confirmDelete}>
          删除
        </Button>
      </DialogActions>
    </Dialog>
  )
}
