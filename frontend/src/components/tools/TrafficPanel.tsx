// 流量监控工具面板:每网卡实时接收/发送速率 + 最近约 5 分钟趋势曲线。
// 数据链路:后端会话级采样器每 2s 读 /proc/net/dev,经 termhub:traffic:sample
// 事件推送;面板挂载时先 getTrafficSnapshot 补历史,再订阅事件追加;
// 速率经 EMA 平滑消除瞬时尖峰,数值与曲线同源;无流量的网卡不展示。
import { Events } from '@wailsio/runtime'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { Box, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { tools } from '../../services/tools'
import type { TrafficSample } from '../../types'

/** 速率格式化:B/s → KB/s → MB/s → GB/s。 */
function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  const units = ['KB/s', 'MB/s', 'GB/s']
  let v = bytesPerSec
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

/** 曲线窗口:最近 150 个采样(约 5 分钟)。 */
const WINDOW = 150

/** 指数滑动平均(半衰期约 2 个采样 ≈ 4 秒):
 *  视频等突发流量按 2s 瞬时采样呈尖峰+归零,平滑后观感与 nload 一致。 */
function smooth(series: number[]): number[] {
  const out: number[] = []
  let ema = 0
  for (let i = 0; i < series.length; i++) {
    ema = i === 0 ? series[i] : ema * 0.5 + series[i] * 0.5
    out.push(ema)
  }
  return out
}

/** 单网卡流量曲线(SVG 双线:蓝=下载,绿=上传)。 */
function Sparkline({ rx: rxSeries, tx: txSeries }: { rx: number[]; tx: number[] }) {
  const points = useMemo(() => {
    const n = Math.max(rxSeries.length, txSeries.length)
    if (n < 2) return null
    const max = Math.max(1, ...rxSeries, ...txSeries)
    const toPoints = (arr: number[]) =>
      arr.map((v, i) => `${(i / (n - 1)) * 100},${30 - (v / max) * 28}`).join(' ')
    return { rx: toPoints(rxSeries), tx: toPoints(txSeries) }
  }, [rxSeries, txSeries])

  if (!points) return null
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: '100%', height: 44, display: 'block' }}>
      <polyline points={points.rx} fill="none" stroke="#7aa2f7" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <polyline points={points.tx} fill="none" stroke="#9ece6a" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * 流量监控面板:每网卡 实时下载/上传速率 + 最近约 5 分钟趋势曲线。
 * 数据源:后端每会话 2s 采样(会话建立即开始),事件实时推送 + 快照补历史。
 */
export function TrafficPanel({ sessionId }: { sessionId: string }) {
  const [history, setHistory] = useState<TrafficSample[]>([])

  useEffect(() => {
    let alive = true
    // 初始历史(面板挂载前已采样的部分)
    void tools
      .getTrafficSnapshot(sessionId)
      .then((snap) => {
        if (alive) setHistory(snap)
      })
      .catch(() => {})
    // 实时采样事件(按 sessionId 过滤)
    const off = Events.On('termhub:traffic:sample', (ev: any) => {
      const data = ev?.data ?? {}
      if (data.sessionId !== sessionId || !Array.isArray(data.samples)) return
      const batch = data.samples as TrafficSample[]
      setHistory((prev) => {
        const next = [...prev, ...batch]
        // 每网卡最多保留 WINDOW 个点,超量丢最旧
        return next.slice(-WINDOW * Object.keys(groupByIface(next)).length || -WINDOW)
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [sessionId])

  const ifaces = useMemo(() => {
    const grouped = groupByIface(history.slice(-WINDOW * 8))
    // 过滤从未有过流量的网卡,按最近速率降序;数值与曲线均用平滑序列
    return Object.entries(grouped)
      .map(([name, series]) => {
        const windowed = series.slice(-WINDOW)
        const rx = smooth(windowed.map((s) => s.rxRate))
        const tx = smooth(windowed.map((s) => s.txRate))
        const maxRate = Math.max(0, ...windowed.map((s) => Math.max(s.rxRate, s.txRate)))
        return {
          name,
          rx,
          tx,
          maxRate,
        }
      })
      .filter((i) => i.maxRate > 0)
      .sort((a, b) => b.maxRate - a.maxRate)
  }, [history])

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', p: 2 }}>
      {ifaces.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4, lineHeight: 1.8 }}>
          正在采集流量数据…
          <br />
          <Typography component="span" variant="caption" color="text.secondary">
            每 2 秒采样一次,有流量后自动出曲线
          </Typography>
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ifaces.map(({ name, rx, tx }) => (
            <Box
              key={name}
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: '"Cascadia Code", Consolas, monospace', fontWeight: 700, minWidth: 90 }}
                >
                  {name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ArrowDownwardIcon sx={{ fontSize: 14, color: '#7aa2f7' }} />
                  <Typography variant="caption" sx={{ color: '#7aa2f7' }}>
                    接收
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: 12.5, minWidth: 84 }}>
                    {fmtRate(rx[rx.length - 1] ?? 0)}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ArrowUpwardIcon sx={{ fontSize: 14, color: '#9ece6a' }} />
                  <Typography variant="caption" sx={{ color: '#9ece6a' }}>
                    发送
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: 12.5, minWidth: 84 }}>
                    {fmtRate(tx[tx.length - 1] ?? 0)}
                  </Typography>
                </Box>
              </Box>
              <Sparkline rx={rx} tx={tx} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

/** 按网卡分组采样序列(保持时间顺序)。 */
function groupByIface(samples: TrafficSample[]): Record<string, TrafficSample[]> {
  const g: Record<string, TrafficSample[]> = {}
  for (const s of samples) {
    ;(g[s.iface] ??= []).push(s)
  }
  return g
}
