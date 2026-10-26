// 设置弹窗:通用(自动更新开关) + 服务器数据(导出/导入) + 关于(当前版本 / 检查更新)。
//
// 发现新版本不再内嵌安装按钮,而是经 onFound 回调交给 App 打开 UpdateDialog
// (应用内一体更新窗,全中文);此处只负责「检查」与「已是最新」反馈。
import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Switch,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import * as Update from '../../bindings/termhub/updateservice'
import type { UpdateInfo } from '../../bindings/termhub/models'
import { exportServerBackup, importServerBackup } from '../services/serverBackup'
import { errMsg } from '../types'

interface SettingsDialogProps {
  open: boolean
  /** 手动检查发现新版本时回调(由 App 打开更新弹窗) */
  onFound: (info: UpdateInfo) => void
  onClose: () => void
}

// 设置弹窗:通用（自动更新）+ 服务器数据（导出/导入）+ 关于（版本 / 检查更新）
export function SettingsDialog({ open, onFound, onClose }: SettingsDialogProps) {
  const [version, setVersion] = useState('')
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState('')
  // 服务器数据导出/导入:进行中状态 + 结果提示
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [dataStatus, setDataStatus] = useState('')

  useEffect(() => {
    if (!open) return
    setStatus('')
    setDataStatus('')
    Update.CurrentVersion()
      .then(setVersion)
      .catch(() => {})
    Update.AutoUpdateEnabled()
      .then(setAutoUpdate)
      .catch(() => {})
  }, [open])

  const doCheck = async () => {
    setChecking(true)
    setStatus('')
    try {
      const info = await Update.CheckUpdate()
      if (info?.available) {
        // 交给 App 打开更新弹窗
        onFound(info)
      } else {
        setStatus('已是最新版本')
      }
    } catch (e) {
      setStatus('检查更新失败：' + String(e))
    } finally {
      setChecking(false)
    }
  }

  const toggleAuto = async (v: boolean) => {
    setAutoUpdate(v)
    try {
      await Update.SetAutoUpdateEnabled(v)
    } catch (e) {
      setAutoUpdate(!v)
      setStatus('保存失败：' + String(e))
    }
  }

  const doExport = async () => {
    setBusy('export')
    setDataStatus('')
    try {
      const r = await exportServerBackup()
      if (r) {
        setDataStatus(
          `已导出 ${r.servers} 个服务器（含 ${r.commands} 条常用命令、${r.groups} 个命令组）→ ${r.path}`,
        )
      }
    } catch (e) {
      setDataStatus('导出失败：' + errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const doImport = async () => {
    setBusy('import')
    setDataStatus('')
    try {
      const r = await importServerBackup()
      if (r) {
        const skipped = r.duplicate > 0 ? `，跳过 ${r.duplicate} 条重复` : ''
        const invalid = r.invalid > 0 ? `、${r.invalid} 条无效` : ''
        const commands = r.commands > 0 ? `；新增 ${r.commands} 条常用命令` : ''
        const groups = r.groups > 0 ? `、${r.groups} 个命令组` : ''
        setDataStatus(`已导入 ${r.added} 个服务器${skipped}${invalid}${commands}${groups}`)
      }
    } catch (e) {
      setDataStatus('导入失败：' + errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          // 固定尺寸:不随内容(状态提示等)动态变化,内容超出时内部滚动
          sx: {
            width: 400,
            maxWidth: '92vw',
            height: 460,
            maxHeight: '88vh',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        设置
        <IconButton size="small" onClick={onClose} aria-label="关闭">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ flex: 1, minHeight: 0 }}>
        <Typography variant="overline" color="text.secondary">
          通用
        </Typography>
        <FormControlLabel
          sx={{ display: 'flex', justifyContent: 'space-between', ml: 0, mt: 0.5 }}
          labelPlacement="start"
          control={<Switch checked={autoUpdate} onChange={(e) => void toggleAuto(e.target.checked)} />}
          label={<Typography variant="body2">自动更新（启动时检查）</Typography>}
        />

        <Divider sx={{ my: 2 }} />

        <Typography variant="overline" color="text.secondary">
          服务器数据
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.5, lineHeight: 1.7 }}
        >
          含服务器配置、常用命令、私有命令库、传输黑名单与路径记忆；不含密码与主机密钥指纹。
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            startIcon={busy === 'export' ? undefined : <FileDownloadIcon />}
            disabled={busy !== null}
            onClick={() => void doExport()}
          >
            {busy === 'export' ? <CircularProgress size={14} /> : '导出'}
          </Button>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            startIcon={busy === 'import' ? undefined : <FileUploadIcon />}
            disabled={busy !== null}
            onClick={() => void doImport()}
          >
            {busy === 'import' ? <CircularProgress size={14} /> : '导入'}
          </Button>
        </Box>
        {dataStatus && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1, lineHeight: 1.6, wordBreak: 'break-all' }}
          >
            {dataStatus}
          </Typography>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="overline" color="text.secondary">
          关于
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
          <Typography variant="body2">当前版本</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {version || '—'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5 }}>
          <Typography variant="body2">检查更新</Typography>
          <Button size="small" variant="outlined" onClick={() => void doCheck()} disabled={checking}>
            {checking ? <CircularProgress size={14} /> : '检查更新'}
          </Button>
        </Box>

        {status && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {status}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  )
}
