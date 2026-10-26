// 传输任务悬浮组件(全局,App 根级挂载):
// 任务列表由 transferStore 事件驱动;任务数为 0 时整体隐藏;
// 右下角 Fab 按钮 + 手绘任务数徽标(绝对定位压按钮左上角,
// MUI v9 的 Badge 类名选择器已失效,故不用 Badge)+ 详情面板。
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CloseIcon from '@mui/icons-material/Close'
import SyncIcon from '@mui/icons-material/Sync'
import {

  Box,
  Button,
  Fab,
  IconButton,
  LinearProgress,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTransferStore } from '../store/transferStore'
import { TransferKind, TransferStatus } from '../types'

/** 传输状态 → 描述文字。 */
function statusText(status: TransferStatus): string {
  switch (status) {
    case TransferStatus.TransferRunning:
      return '传输中'
    case TransferStatus.TransferDone:
      return '完成'
    case TransferStatus.TransferCanceled:
      return '已取消'
    default:
      return '失败'
  }
}

/** 任务条目基名(目录带标注)。 */
function taskName(t: { kind: TransferKind; localPath: string; remotePath: string; isDir: boolean }): string {
  const full = t.kind === TransferKind.TransferUpload ? t.localPath : t.remotePath
  const base = full.split(/[\\/]/).filter(Boolean).pop() ?? full
  return t.isDir ? `${base}(目录)` : base
}

/**
 * 传输任务悬浮组件(右下角):
 * 悬浮按钮 + 徽标显示任务数,点击展开任务详情列表;全局可见,不占用内容区。
 */
export function TransferWidget() {
  const tasks = useTransferStore((s) => s.tasks)
  const cancel = useTransferStore((s) => s.cancel)
  const dismiss = useTransferStore((s) => s.dismiss)
  const [open, setOpen] = useState(false)

  if (tasks.length === 0) return null

  const running = tasks.filter((t) => t.status === TransferStatus.TransferRunning).length

  return (
    <Box
      sx={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 1.25,
      }}
    >
      {/* 任务详情面板 */}
      {open && (
        <Box
          sx={{
            width: 400,
            maxHeight: 420,
            overflowY: 'auto',
            p: 2,
            borderRadius: 2,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            传输任务({tasks.length})
            {running > 0 && ` · ${running} 个进行中`}
          </Typography>
          {tasks.map((t) => {
            const isRunning = t.status === TransferStatus.TransferRunning
            const pct = t.size > 0 ? Math.min(100, Math.round((t.transferred / t.size) * 100)) : 0
            return (
              <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                {t.kind === TransferKind.TransferUpload ? (
                  <ArrowForwardIcon sx={{ fontSize: 15, color: 'primary.main', flexShrink: 0 }} />
                ) : (
                  <ArrowBackIcon sx={{ fontSize: 15, color: 'info.main', flexShrink: 0 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="body2" noWrap sx={{ fontSize: 12.5 }}>
                      {taskName(t)}
                    </Typography>
                    <Typography
                      variant="caption"
                      color={t.status === TransferStatus.TransferError ? 'error' : 'text.secondary'}
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      {statusText(t.status)}
                      {isRunning && t.size > 0 && ` ${pct}%`}
                    </Typography>
                  </Box>
                  {isRunning && (
                    <LinearProgress
                      variant={t.size > 0 ? 'determinate' : 'indeterminate'}
                      value={pct}
                      sx={{ mt: 0.5, borderRadius: 1 }}
                    />
                  )}
                  {t.error && (
                    <Typography variant="caption" color="error" noWrap sx={{ display: 'block' }}>
                      {t.error}
                    </Typography>
                  )}
                </Box>
                {isRunning ? (
                  <Button size="small" color="inherit" onClick={() => cancel(t.id)} sx={{ flexShrink: 0 }}>
                    取消
                  </Button>
                ) : (
                  <IconButton size="small" onClick={() => dismiss(t.id)} sx={{ flexShrink: 0 }}>
                    <CloseIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                )}
              </Box>
            )
          })}
        </Box>
      )}

      {/* 悬浮按钮 + 手绘任务数徽标(绝对定位压在按钮左上角,不被遮盖) */}
      <Box sx={{ position: 'relative' }}>
        <Fab
          size="medium"
          onClick={() => setOpen((o) => !o)}
          sx={{
            bgcolor: 'background.paper',
            color: running > 0 ? 'primary.main' : 'text.secondary',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          }}
        >
          {running > 0 ? (
            <SyncIcon sx={{ fontSize: 20, animation: 'termhub-spin 1.4s linear infinite' }} />
          ) : (
            <ArrowForwardIcon sx={{ fontSize: 20 }} />
          )}
        </Fab>
        <Box
          sx={{
            position: 'absolute',
            top: -7,
            left: -7,
            zIndex: 3,
            minWidth: 20,
            height: 20,
            px: 0.6,
            borderRadius: 10,
            bgcolor: running > 0 ? 'primary.main' : '#3b4360',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
            border: '2px solid #10121a',
          }}
        >
          {tasks.length}
        </Box>
      </Box>
    </Box>
  )
}
