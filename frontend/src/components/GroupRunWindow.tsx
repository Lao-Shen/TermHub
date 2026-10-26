// 命令组 / 单条命令运行窗口(非模态浮窗,屏幕居中,固定尺寸):
// 标题栏 + 当前步/步列表 + 汇总输出(所有已产生输出的步骤按序拼接,自动滚到底);
// 运行中可「中止」,结束(成功/失败)后不自动关闭,等用户手动「关闭」。
// 「按需执行」:进入 idle 态,每步带勾选框(默认全选),点「执行」按原顺序跑勾选项。
import CloseIcon from '@mui/icons-material/Close'
import StopIcon from '@mui/icons-material/Stop'
import { Box, Button, Checkbox, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { api } from '../services/api'
import { useGroupRunStore } from '../store/groupRunStore'
import type { GroupStepStatus } from '../store/groupRunStore'

const MONO = '"Cascadia Code", Consolas, monospace'

const STATUS_DOT: Record<GroupStepStatus, string> = {
  pending: '#414868',
  running: '#e0af68',
  done: '#9ece6a',
  failed: '#f7768e',
  canceled: '#e0af68',
}

/** 命令组 / 单条命令运行状态浮窗。 */
export function GroupRunWindow() {
  const run = useGroupRunStore((s) => s.run)
  const cancel = useGroupRunStore((s) => s.cancel)
  const dismiss = useGroupRunStore((s) => s.dismiss)
  const toggleStep = useGroupRunStore((s) => s.toggleStep)
  const setAllSelected = useGroupRunStore((s) => s.setAllSelected)
  const runSelected = useGroupRunStore((s) => s.runSelected)

  const outputRef = useRef<HTMLDivElement>(null)
  const stepsRef = useRef<HTMLDivElement>(null)
  // 输出更新时自动滚到底部
  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run])

  // 步骤列表滚动到正在执行的步骤
  useEffect(() => {
    stepsRef.current?.querySelector('[data-running="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [run])

  // 执行期间主窗口置顶(避免被其它窗口遮挡);结束/关闭时恢复
  useEffect(() => {
    if (run?.status === 'running') {
      void api.setAlwaysOnTop(true)
      return () => {
        void api.setAlwaysOnTop(false)
      }
    }
    return undefined
  }, [run?.status])

  if (!run) return null

  const idle = run.status === 'idle'
  const running = run.status === 'running'
  const anySelected = run.steps.some((s) => s.selected)
  const subtitle = idle
    ? '按需执行:勾选要执行的命令,点「执行」按顺序执行'
    : running
      ? `第 ${run.current + 1}/${run.steps.length} 步`
      : run.status === 'success'
        ? '全部完成'
        : run.status === 'canceled'
          ? '已中止'
          : run.error || '执行失败'

  // 汇总所有步骤的输出(带步骤分隔),而不是只显示当前步
  const log = run.steps
    .filter((s) => s.output || s.error)
    .map((s) => {
      const head = `===== 第 ${s.index + 1} 步：${s.command} =====`
      const tail = s.error ? `${s.output ? '\n' : ''}[${s.status === 'canceled' ? '已中止' : '失败'}] ${s.error}` : ''
      return `${head}\n${s.output}${tail}`
    })
    .join('\n\n')

  return (
    <Box
      sx={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 90,
        width: 760,
        maxWidth: '94vw',
        height: '70vh',
        minHeight: 360,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Typography variant="body2" noWrap sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
          {run.kind === 'single' ? '单条命令' : '命令组'} · {run.groupName}
        </Typography>
        {running ? (
          <Button size="small" color="error" startIcon={<StopIcon sx={{ fontSize: 16 }} />} onClick={cancel}>
            中止
          </Button>
        ) : (
          <>
            {idle && (
              <Button size="small" variant="contained" disabled={!anySelected} onClick={runSelected}>
                执行
              </Button>
            )}
            <Button size="small" onClick={dismiss}>
              关闭
            </Button>
          </>
        )}
        <Tooltip title={running ? '运行中,请先中止' : '关闭'}>
          <span>
            <IconButton size="small" disabled={running} onClick={dismiss}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 状态行 */}
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color={run.status === 'failed' ? 'error' : 'text.secondary'}>
          {subtitle}
        </Typography>
      </Box>

      {/* 步骤列表 */}
      <Box
        ref={stepsRef}
        sx={{
          px: 1.5,
          py: 1,
          overflow: 'auto',
          maxHeight: idle ? 'none' : '22vh',
          flex: idle ? 1 : undefined,
          minHeight: idle ? 0 : undefined,
          borderBottom: idle ? 'none' : '1px solid',
          borderColor: 'divider',
        }}
      >
        {idle ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                默认全选;按列表顺序执行
              </Typography>
              <Button size="small" onClick={() => setAllSelected(true)}>
                全选
              </Button>
              <Button size="small" onClick={() => setAllSelected(false)}>
                全不选
              </Button>
            </Box>
            <Stack spacing={0.25}>
              {run.steps.map((s) => (
                <Stack key={s.index} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <Checkbox
                    size="small"
                    sx={{ p: 0.5 }}
                    checked={s.selected}
                    onChange={() => toggleStep(s.index)}
                  />
                  <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, fontFamily: MONO }}>
                    {s.index + 1}. {s.command}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        ) : (
          <Stack spacing={0.5}>
            {run.steps.map((s) => {
              const isRunning = s.status === 'running'
              return (
                <Stack
                  key={s.index}
                  data-running={isRunning}
                  direction="row"
                  spacing={0.75}
                  sx={{
                    alignItems: 'center',
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 1,
                    bgcolor: isRunning ? 'action.selected' : 'transparent',
                    outline: isRunning ? '1px solid' : 'none',
                    outlineColor: 'warning.main',
                  }}
                >
                  {isRunning ? (
                    <CircularProgress size={10} sx={{ color: 'warning.main', flexShrink: 0 }} />
                  ) : (
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: STATUS_DOT[s.status] }} />
                  )}
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: MONO,
                      color: isRunning ? 'text.primary' : 'text.secondary',
                      fontWeight: isRunning ? 700 : 400,
                    }}
                  >
                    {s.index + 1}. {s.command}
                  </Typography>
                  {isRunning && (
                    <Typography variant="caption" sx={{ color: 'warning.main', flexShrink: 0 }}>
                      执行中
                    </Typography>
                  )}
                  {s.error && (
                    <Typography variant="caption" color="error" noWrap sx={{ flexShrink: 0 }}>
                      {s.error}
                    </Typography>
                  )}
                </Stack>
              )
            })}
          </Stack>
        )}
      </Box>

      {/* 汇总输出(所有步骤,自动滚到底;按需执行尚未开始时隐藏) */}
      {!idle && (
        <Box
          ref={outputRef}
          sx={{
            flex: 1,
            minHeight: 0,
            m: 1.5,
            overflow: 'auto',
            p: 1,
            borderRadius: 1,
            bgcolor: '#10121a',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {log ? (
            <Typography
              component="pre"
              variant="caption"
              sx={{ fontFamily: MONO, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0 }}
            >
              {log}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {running ? '执行中…' : '没有输出'}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  )
}
