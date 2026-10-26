// 通用确认对话框(MUI 样式):全项目替代浏览器 window.confirm 的唯一确认框。
// 覆盖确认/删除确认/进程 kill/服务操作/退出确认等场景复用;
// danger=true 时确认按钮红色。
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  /** 确认按钮文案,默认"确定"。 */
  confirmLabel?: string
  /** 取消按钮文案,默认"取消"。 */
  cancelLabel?: string
  /** 危险操作:确认按钮红色。 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** 通用确认对话框(MUI 样式,替代浏览器 window.confirm)。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8, wordBreak: 'break-all' }}>
          {message}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onCancel} color="inherit">
          {cancelLabel}
        </Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
