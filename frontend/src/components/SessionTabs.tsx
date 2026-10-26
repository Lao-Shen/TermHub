// 会话标签条(浏览器式):每个标签带状态色点(连接中脉冲动画)、标题
// (空闲页="新标签页",否则备注名或 user@host)、× 与鼠标中键关闭;
// 右侧常驻 + 号新建标签。关闭走 disconnect(先断后端会话再移除标签)。
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useAppStore } from '../store/appStore'
import type { SessionStatus, SessionTab } from '../types'

const STATUS_COLOR: Record<SessionStatus, string> = {
  idle: '#414868',
  connecting: '#e0af68',
  confirming: '#bb9af7',
  connected: '#9ece6a',
  exited: '#f7768e',
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: '未连接',
  connecting: '连接中',
  confirming: '等待确认主机密钥',
  connected: '已连接',
  exited: '已退出',
}

/** 标签标题:空闲页为"新标签页",否则取服务器名或 user@host。 */
function tabTitle(cfg: SessionTab['cfg']): string {
  if (!cfg) return '新标签页'
  return cfg.name || `${cfg.user}@${cfg.host}`
}

/** 会话标签条:多标签切换、状态指示、关闭,右侧常驻"+"新建(浏览器式)。 */
export function SessionTabs() {
  const sessions = useAppStore((s) => s.sessions)
  const activeKey = useAppStore((s) => s.activeKey)
  const disconnect = useAppStore((s) => s.disconnect)
  const setActive = useAppStore((s) => s.setActive)
  const newTab = useAppStore((s) => s.newTab)

  if (sessions.length === 0) return null

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        '&::-webkit-scrollbar': { height: 0 },
      }}
    >
      {sessions.map((t) => {
        const active = t.key === activeKey
        return (
          <Tooltip
            key={t.key}
            title={t.exitReason ?? `${STATUS_LABEL[t.status]}${t.cfg ? ` · ${t.cfg.user}@${t.cfg.host}` : ''}`}
          >
            <Box
              onClick={() => setActive(t.key)}
              onAuxClick={(e) => {
                // 鼠标中键关闭标签(浏览器式)
                if (e.button === 1) {
                  e.preventDefault()
                  disconnect(t.key)
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.75,
                py: 1,
                minWidth: 0,
                maxWidth: 220,
                cursor: 'pointer',
                borderRight: '1px solid',
                borderColor: 'divider',
                bgcolor: active ? 'background.default' : 'transparent',
                position: 'relative',
                '&::after': active
                  ? { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 2, bgcolor: 'primary.main' }
                  : undefined,
              }}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  bgcolor: STATUS_COLOR[t.status],
                  ...(t.status === 'connecting'
                    ? { animation: 'termhub-pulse 1.2s ease-in-out infinite' }
                    : {}),
                }}
              />
              <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500, flex: 1 }}>
                {tabTitle(t.cfg)}
              </Typography>
              <IconButton
                size="small"
                sx={{ p: 0.25, '&:hover': { bgcolor: 'action.hover' } }}
                onClick={(e) => {
                  e.stopPropagation()
                  disconnect(t.key)
                }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          </Tooltip>
        )
      })}

      {/* 常驻"+"新建标签页(浏览器式) */}
      <Tooltip title="新建标签页">
        <IconButton size="small" onClick={newTab} sx={{ mx: 1, alignSelf: 'center', flexShrink: 0 }}>
          <AddIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
