// 运行状态工具面板:远端系统信息总览。
// 数据源 tools.listSystemInfo(后端在既有会话上执行 10 条命令,尽力而为);
// 环形仪表展示 CPU/内存占用(绿黄红语义色),IP 芯片可点击复制,
// 概览格展示系统/内核/核数/运行时长/负载/内存,底部磁盘使用进度条。
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RefreshIcon from '@mui/icons-material/Refresh'
import {
  Box,
  CircularProgress,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { clipboard } from '../../services/clipboard'
import { tools } from '../../services/tools'
import type { SystemInfo } from '../../types'
import { errMsg } from '../../types'

/** 占用率 → 语义色(绿/黄/红)。 */
function usageColor(pct: number): string {
  if (pct >= 85) return '#f7768e'
  if (pct >= 60) return '#e0af68'
  return '#9ece6a'
}

/** 秒数 → 人类可读时长(不足 1 分钟显示秒,否则按天/小时/分取整)。 */
function humanUptime(secs: number): string {
  if (secs < 60) return `${secs} 秒`
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d} 天 ${h} 小时`
  if (h > 0) return `${h} 小时 ${m} 分`
  return `${m} 分`
}

/** 环形占用率仪表:颜色随占用率走 usageColor(绿<60<黄<85<红),中央大字百分比。 */
function Gauge({ label, pct }: { label: string; pct: number }) {
  const color = usageColor(pct)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Box sx={{ position: 'relative', width: 104, height: 104 }}>
        <CircularProgress
          variant="determinate"
          value={Math.min(100, pct)}
          size={104}
          thickness={5}
          sx={{ color, '& .MuiCircularProgress-circle': { strokeLinecap: 'round' } }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 800, color }}>
            {pct.toFixed(1)}
            <Typography component="span" variant="caption" sx={{ color, ml: 0.25 }}>
              %
            </Typography>
          </Typography>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  )
}

/** 运行状态面板:系统信息、IP(可复制)、CPU/内存环形仪表、负载、磁盘。 */
export function SystemPanel({ sessionId }: { sessionId: string }) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedIP, setCopiedIP] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setInfo(await tools.listSystemInfo(sessionId))
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const copyIP = async (ip: string) => {
    await clipboard.setText(ip)
    setCopiedIP(ip)
    setTimeout(() => setCopiedIP((cur) => (cur === ip ? '' : cur)), 1200)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工具栏 */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        {info && (
          <Typography variant="body2" noWrap sx={{ fontWeight: 700, flex: 1 }}>
            {info.hostname || '—'}
            {info.os && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{info.os}</Typography>}
          </Typography>
        )}
        <Tooltip title="刷新">
          <span>
            <IconButton size="small" onClick={() => void load()} disabled={loading}>
              <RefreshIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 内容 */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', p: 2 }}>
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 1 }}>
            <CircularProgress size={26} />
          </Box>
        )}
        {error ? (
          <Typography variant="body2" color="error" sx={{ wordBreak: 'break-all' }}>
            {error}
          </Typography>
        ) : info ? (
          <Stack spacing={2.5}>
            {/* CPU / 内存环形仪表 */}
            <Box sx={{ display: 'flex', justifyContent: 'space-evenly', py: 1 }}>
              <Gauge label="CPU 占用" pct={info.cpuUsage} />
              <Gauge label="内存占用" pct={info.memUsage} />
            </Box>

            {/* IP(可复制) */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                IP 地址
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {/* 公网出口 IP:与内网 IP 同款式,仅前缀"公网"二字 */}
                {info.publicIp && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      pl: 1.25,
                      pr: 0.5,
                      py: 0.5,
                      borderRadius: 1.5,
                      bgcolor: 'background.default',
                      border: '1px solid',
                      borderColor: 'divider',
                      fontFamily: '"Cascadia Code", Consolas, monospace',
                      fontSize: 12.5,
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.25 }}>
                      公网
                    </Typography>
                    {info.publicIp}
                    <Tooltip title={copiedIP === info.publicIp ? '已复制' : '复制'}>
                      <IconButton size="small" onClick={() => void copyIP(info.publicIp!)}>
                        {copiedIP === info.publicIp ? (
                          <CheckIcon sx={{ fontSize: 13, color: 'success.main' }} />
                        ) : (
                          <ContentCopyIcon sx={{ fontSize: 13 }} />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
                {!info.publicIp && (
                  <Typography variant="body2" color="text.secondary">
                    公网 IP 未获取到(服务器可能无外网)
                  </Typography>
                )}
                {(info.ips ?? []).length === 0 && (
                  <Typography variant="body2" color="text.secondary">内网 IP 未获取到</Typography>
                )}
                {(info.ips ?? []).map((ip) => (
                  <Box
                    key={ip}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      pl: 1.25,
                      pr: 0.5,
                      py: 0.5,
                      borderRadius: 1.5,
                      bgcolor: 'background.default',
                      border: '1px solid',
                      borderColor: 'divider',
                      fontFamily: '"Cascadia Code", Consolas, monospace',
                      fontSize: 12.5,
                    }}
                  >
                    {ip}
                    <Tooltip title={copiedIP === ip ? '已复制' : '复制'}>
                      <IconButton size="small" onClick={() => void copyIP(ip)}>
                        {copiedIP === ip ? (
                          <CheckIcon sx={{ fontSize: 13, color: 'success.main' }} />
                        ) : (
                          <ContentCopyIcon sx={{ fontSize: 13 }} />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Box>
            </Box>

            {/* 概览指标 */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 1,
              }}
            >
              <Metric label="系统" value={info.os || '—'} />
              <Metric label="内核" value={info.kernel || '—'} />
              <Metric label="CPU 核数" value={info.cpuCores > 0 ? String(info.cpuCores) : '—'} />
              <Metric label="运行时长" value={info.uptimeSecs > 0 ? humanUptime(info.uptimeSecs) : '—'} />
              <Metric label="负载(1/5/15分)" value={`${info.load1.toFixed(2)} / ${info.load5.toFixed(2)} / ${info.load15.toFixed(2)}`} />
              <Metric
                label="内存"
                value={info.memTotalMb > 0 ? `${info.memUsedMb}MB / ${info.memTotalMb}MB` : '—'}
              />
            </Box>

            {/* 磁盘 */}
            {(info.disks ?? []).length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                  磁盘
                </Typography>
                <Stack spacing={1.25} sx={{ mt: 1 }}>
                  {(info.disks ?? []).map((d) => (
                    <Box key={d.mount}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="body2" noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>
                          {d.mount}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                          {d.used} / {d.size} ({d.usePct.toFixed(0)}%)
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, d.usePct)}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          bgcolor: 'background.default',
                          '& .MuiLinearProgress-bar': { bgcolor: usageColor(d.usePct), borderRadius: 3 },
                        }}
                      />
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        ) : null}
      </Box>
    </Box>
  )
}

/** 概览指标小方块:上方灰色标签 + 下方加粗数值,自适应网格排布。 */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ px: 1.25, py: 1, borderRadius: 1.5, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" noWrap sx={{ fontWeight: 700, mt: 0.25 }}>
        {value}
      </Typography>
    </Box>
  )
}
