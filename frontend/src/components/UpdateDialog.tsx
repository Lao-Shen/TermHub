// 应用内更新弹窗(方案 B):发现新版本 → 版本对比/更新说明 → 下载进度 → 重启应用。
//
// 框架内置更新窗口已由 Go 侧用 updater.WindowNone 关闭(其 UI 为英文通用样式),
// 这里订阅 wails:updater:* 事件自绘一套中文界面,风格与主界面一致:
//   download-started / download-progress / download-complete / verifying /
//   installing / update-ready / error
// 「立即更新」调 UpdateService.StartInstall(),「重启并应用」调 UpdateService.Restart()。
import { useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt'
import * as Update from '../../bindings/termhub/updateservice'
import type { UpdateInfo } from '../../bindings/termhub/models'

// 更新流程阶段(与更新器事件一一对应)
type Stage = 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'

interface UpdateDialogProps {
  open: boolean
  /** 发现的新版本信息(由 App 检查后传入) */
  info: UpdateInfo | null
  onClose: () => void
}

// 字节数格式化(B/KB/MB/GB/TB)
function fmtBytes(n: number): string {
  if (!n || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

// 速率格式化
function fmtRate(n: number): string {
  return n > 0 ? `${fmtBytes(n)}/s` : ''
}

// 各阶段标题
const STAGE_TITLE: Record<Stage, string> = {
  available: '发现新版本',
  downloading: '正在下载更新',
  verifying: '正在校验更新',
  installing: '正在安装更新',
  ready: '更新已就绪',
  error: '更新失败',
}

// 错误阶段的中文名(更新器 error.stage 取值 check/download/verify/install)
const STAGE_LABEL: Record<string, string> = {
  check: '检查',
  download: '下载',
  verify: '校验',
  install: '安装',
}

/** 应用内更新弹窗:确认 → 进度 → 重启,全中文、与主界面同风格。 */
export function UpdateDialog({ open, info, onClose }: UpdateDialogProps) {
  const [stage, setStage] = useState<Stage>('available')
  const [version, setVersion] = useState('')
  const [written, setWritten] = useState(0)
  const [total, setTotal] = useState(0)
  const [rate, setRate] = useState(0)
  const [error, setError] = useState('')

  // 打开时重置到「发现新版本」并拉取当前版本号
  useEffect(() => {
    if (!open) return
    setStage('available')
    setWritten(0)
    setTotal(info?.size ?? 0)
    setRate(0)
    setError('')
    Update.CurrentVersion()
      .then(setVersion)
      .catch(() => {})
  }, [open, info])

  // 订阅更新器阶段事件(仅弹窗打开期间);载荷统一取 ev.data ?? ev
  useEffect(() => {
    if (!open) return
    const pick = (ev: any) => ev?.data ?? ev
    const offs = [
      Events.On('wails:updater:download-started', () => setStage('downloading')),
      Events.On('wails:updater:download-progress', (ev: any) => {
        const p = pick(ev)
        if (!p) return
        setWritten(p.written ?? 0)
        if (p.total) setTotal(p.total)
        setRate(p.rate ?? 0)
      }),
      Events.On('wails:updater:download-complete', () => setStage('verifying')),
      Events.On('wails:updater:verifying', () => setStage('verifying')),
      Events.On('wails:updater:installing', () => setStage('installing')),
      Events.On('wails:updater:update-ready', () => setStage('ready')),
      Events.On('wails:updater:error', (ev: any) => {
        const e = pick(ev)
        const where = e?.stage ? `（${STAGE_LABEL[e.stage] ?? e.stage}阶段）` : ''
        setError(`${where}${e?.message ?? '发生未知错误'}`)
        setStage('error')
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [open])

  const install = async () => {
    setError('')
    setWritten(0)
    setStage('downloading')
    try {
      await Update.StartInstall()
    } catch (e) {
      setError(String(e))
      setStage('error')
    }
  }

  const restart = async () => {
    try {
      await Update.Restart()
    } catch (e) {
      setError(String(e))
      setStage('error')
    }
  }

  // 下载/校验/安装期间不可关闭(下载无法取消,避免用户以为关掉就停了)
  const busy = stage === 'downloading' || stage === 'verifying' || stage === 'installing'
  const pct = total > 0 ? Math.round((written / total) * 100) : 0

  let published = ''
  if (info?.publishedAt) {
    const d = new Date(info.publishedAt)
    if (!Number.isNaN(d.getTime())) published = d.toLocaleString()
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          // 固定尺寸:各阶段内容(说明/进度/提示)多少都不改变窗口大小
          sx: {
            width: 560,
            maxWidth: '92vw',
            height: 460,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <SystemUpdateAltIcon fontSize="small" color="primary" />
        <Box sx={{ flex: 1 }}>{STAGE_TITLE[stage]}</Box>
        <IconButton size="small" onClick={onClose} disabled={busy} aria-label="关闭">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* 版本对比 + 元信息(各阶段恒在,不引起高度变化) */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {version && (
            <Chip size="small" variant="outlined" label={`当前 ${version}`} sx={{ fontFamily: 'monospace' }} />
          )}
          {info && (
            <Chip size="small" color="primary" label={`新版本 ${info.version}`} sx={{ fontFamily: 'monospace' }} />
          )}
          {info && info.size > 0 && (
            <Typography variant="caption" color="text.secondary">
              {fmtBytes(info.size)}
            </Typography>
          )}
          {published && (
            <Typography variant="caption" color="text.secondary">
              发布于 {published}
            </Typography>
          )}
        </Stack>

        {stage === 'available' ? (
          // 更新说明占满剩余高度、内部滚动(不撑大窗口)
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', mt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              更新内容
            </Typography>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontSize: 13,
                lineHeight: 1.7,
                userSelect: 'text',
              }}
            >
              {info?.notes?.trim() || '（本次更新未提供说明）'}
            </Box>
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {busy && (
              <Box sx={{ mt: 3 }}>
                <LinearProgress
                  variant={stage === 'downloading' && total > 0 ? 'determinate' : 'indeterminate'}
                  value={stage === 'downloading' && total > 0 ? pct : undefined}
                  sx={{ borderRadius: 1, height: 8 }}
                />
                <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {stage === 'downloading'
                      ? total > 0
                        ? `${pct}% · ${fmtBytes(written)} / ${fmtBytes(total)}`
                        : `已下载 ${fmtBytes(written)}`
                      : stage === 'verifying'
                        ? '正在校验签名与摘要…'
                        : '正在安装并准备重启…'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtRate(rate)}
                  </Typography>
                </Stack>
              </Box>
            )}

            {stage === 'ready' && (
              <Alert severity="success" sx={{ mt: 3 }}>
                更新已下载并安装完成。点「重启并应用」后应用会关闭并自动重启到新版本。
              </Alert>
            )}

            {stage === 'error' && (
              <Alert severity="error" sx={{ mt: 3, wordBreak: 'break-word' }}>
                {error || '更新失败'}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {stage === 'available' && (
          <>
            <Button color="inherit" onClick={onClose}>
              稍后
            </Button>
            <Button variant="contained" onClick={() => void install()}>
              立即更新
            </Button>
          </>
        )}
        {busy && (
          <Button color="inherit" disabled>
            更新进行中…
          </Button>
        )}
        {stage === 'ready' && (
          <>
            <Button color="inherit" onClick={onClose}>
              稍后
            </Button>
            <Button variant="contained" color="success" onClick={() => void restart()}>
              重启并应用
            </Button>
          </>
        )}
        {stage === 'error' && (
          <>
            <Button color="inherit" onClick={onClose}>
              关闭
            </Button>
            <Button variant="contained" onClick={() => void install()}>
              重试
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
