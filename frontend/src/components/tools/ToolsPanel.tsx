import BookmarkIcon from '@mui/icons-material/Bookmark'
import CloseIcon from '@mui/icons-material/Close'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import MemoryIcon from '@mui/icons-material/Memory'
import LanIcon from '@mui/icons-material/Lan'
import MiscellaneousServicesIcon from '@mui/icons-material/MiscellaneousServices'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { PortPanel, ProcessPanel } from './ProcessPanel'
import { RemoteFilesPanel } from './RemoteFilesPanel'
import { ServicePanel } from './ServicePanel'
import { SystemPanel } from './SystemPanel'
import { TrafficPanel } from './TrafficPanel'
import { CommonCommandPanel } from './CommonCommandPanel'

export type ToolKind = 'status' | 'traffic' | 'proc' | 'ports' | 'svc' | 'fileview' | 'commoncmd'

/** 工具定义:固定顺序 + 图标/名称。 */
const TOOLS: { kind: ToolKind; icon: JSX.Element; label: string }[] = [
  { kind: 'status', icon: <MonitorHeartIcon sx={{ fontSize: 16 }} />, label: '运行状态' },
  { kind: 'traffic', icon: <ShowChartIcon sx={{ fontSize: 16 }} />, label: '流量监控' },
  { kind: 'proc', icon: <MemoryIcon sx={{ fontSize: 16 }} />, label: '进程管理' },
  { kind: 'ports', icon: <LanIcon sx={{ fontSize: 16 }} />, label: '端口状态' },
  { kind: 'svc', icon: <MiscellaneousServicesIcon sx={{ fontSize: 16 }} />, label: '服务列表' },
  { kind: 'fileview', icon: <FolderOpenIcon sx={{ fontSize: 16 }} />, label: '文件视图' },
  { kind: 'commoncmd', icon: <BookmarkIcon sx={{ fontSize: 16 }} />, label: '常用命令' },
]

const PANELS: Record<ToolKind, (props: { sessionId: string; connId?: string; host?: string }) => JSX.Element> = {
  status: (p) => <SystemPanel {...p} />,
  traffic: (p) => <TrafficPanel {...p} />,
  proc: (p) => <ProcessPanel {...p} />,
  ports: (p) => <PortPanel {...p} />,
  svc: (p) => <ServicePanel {...p} />,
  fileview: (p) => <RemoteFilesPanel {...p} />,
  commoncmd: (p) => <CommonCommandPanel sessionId={p.sessionId} connId={p.connId} host={p.host} />,
}

/**
 * 会话工具面板(受控):
 * tabs 由上层管理(可 × 关闭、鼠标中键关闭,工具栏选择时重新添加),
 * 本组件只负责渲染 tab 条与对应面板;打开中的面板保持挂载,切换显示。
 */
export function ToolsPanel({
  sessionId,
  connId,
  host,
  tabs,
  active,
  onClose,
  onActivate,
}: {
  sessionId: string
  /** 连接配置 ID(文件视图按服务器记忆路径用)。 */
  connId?: string
  /** 服务器主机名(常用命令的"命令组"按主机名关联用)。 */
  host?: string
  tabs: ToolKind[]
  active: ToolKind
  onClose: (k: ToolKind) => void
  onActivate: (k: ToolKind) => void
}) {
  const ordered = TOOLS.filter((t) => tabs.includes(t.kind))

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        // 分屏右窗:左侧两角直角(与终端拼成从中间切开),右侧保持圆角
        borderRadius: '0 20px 20px 0',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      {/* 工具 tabs(可关闭) */}
      <Box sx={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        {ordered.map(({ kind, icon, label }) => {
          const isActive = kind === active
          return (
            <Box
              key={kind}
              onClick={() => onActivate(kind)}
              onAuxClick={(e) => {
                // 鼠标中键仅关闭该 tab,阻止冒泡防止误触上层关闭逻辑
                if (e.button === 1) {
                  e.preventDefault()
                  e.stopPropagation()
                  onClose(kind)
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.5,
                py: 1,
                cursor: 'pointer',
                borderRight: '1px solid',
                borderColor: 'divider',
                bgcolor: isActive ? 'background.default' : 'transparent',
                position: 'relative',
                whiteSpace: 'nowrap',
                '&::after': isActive
                  ? { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 2, bgcolor: 'primary.main' }
                  : undefined,
              }}
            >
              {icon}
              <Typography variant="body2" sx={{ fontWeight: isActive ? 700 : 500 }}>
                {label}
              </Typography>
              <Tooltip title="关闭">
                <IconButton
                  size="small"
                  sx={{ p: 0.25, ml: 0.25, '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(kind)
                  }}
                >
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )
        })}
      </Box>

      {/* 内容区:打开中的面板保持挂载,切换显示 */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {ordered.map(({ kind }) => (
          <Box
            key={kind}
            sx={{ display: kind === active ? 'block' : 'none', position: 'absolute', inset: 0 }}
          >
            {PANELS[kind]({ sessionId, connId, host })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
