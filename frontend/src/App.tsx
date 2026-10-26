import { Events } from '@wailsio/runtime'
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import TerminalIcon from '@mui/icons-material/Terminal'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import MemoryIcon from '@mui/icons-material/Memory'
import LanIcon from '@mui/icons-material/Lan'
import MiscellaneousServicesIcon from '@mui/icons-material/MiscellaneousServices'
import SpeedIcon from '@mui/icons-material/Speed'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import BookmarkIcon from '@mui/icons-material/Bookmark'
import SettingsIcon from '@mui/icons-material/Settings'
import { useCallback, useEffect, useState } from 'react'
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ConnectionDialog } from './components/ConnectionDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SettingsDialog } from './components/SettingsDialog'
import { UpdateDialog } from './components/UpdateDialog'
import { TransferView } from './components/files/TransferView'
import { TransferWidget } from './components/TransferWidget'
import { HostKeyDialog } from './components/HostKeyDialog'
import { ConnectingPanel, ExitPanel } from './components/Panels'
import { GroupRunWindow } from './components/GroupRunWindow'
import { NotificationCenter } from './components/NotificationCenter'
import { ServerGrid } from './components/ServerGrid'
import { SessionTabs } from './components/SessionTabs'
import { SplitLayout } from './components/SplitLayout'
import { TerminalView } from './components/terminal/TerminalView'
import { ToolsPanel, type ToolKind } from './components/tools/ToolsPanel'
import { api } from './services/api'
import * as Update from '../bindings/termhub/updateservice'
import type { UpdateInfo } from '../bindings/termhub/models'
import { useAppStore } from './store/appStore'
import { useNotificationStore } from './store/notificationStore'
import { useTransferStore } from './store/transferStore'
import type { TransferInfo } from './types'
import { TransferKind, TransferStatus } from './types'

// 全局视图模式(不与会话绑定):终端为默认;文件传输/进程管理/端口状态
// 作用于当前活动会话,切换会话时保持视图并自动拉取新会话数据。
type ViewMode = 'terminal' | 'files' | 'status' | 'traffic' | 'proc' | 'ports' | 'svc' | 'fileview' | 'commoncmd'

/** 传输任务终态 → 右下角通知文案与级别(完成/失败/已取消)。 */
function transferNotice(t: TransferInfo): { message: string; severity: 'success' | 'error' | 'warning' } | null {
  const upload = t.kind === TransferKind.TransferUpload
  const verb = upload ? '上传' : '下载'
  // 上传取源(本地)名;下载取源(远端)名
  const source = upload ? t.localPath : t.remotePath
  const name = source.split(/[\\/]/).filter(Boolean).pop() ?? source
  const label = `${verb}${t.isDir ? '目录' : ''} ${name}`
  if (t.status === TransferStatus.TransferDone) return { message: `${label} 完成`, severity: 'success' }
  if (t.status === TransferStatus.TransferError) {
    return { message: `${label} 失败${t.error ? `:${t.error}` : ''}`, severity: 'error' }
  }
  if (t.status === TransferStatus.TransferCanceled) return { message: `${label} 已取消`, severity: 'warning' }
  return null
}

function MainArea({
  viewMode,
  toolTabs,
  onCloseTool,
  onActivateTool,
}: {
  viewMode: ViewMode
  toolTabs: ToolKind[]
  onCloseTool: (k: ToolKind) => void
  onActivateTool: (k: ToolKind) => void
}) {
  const sessions = useAppStore((s) => s.sessions)
  const activeKey = useAppStore((s) => s.activeKey)
  const markExited = useAppStore((s) => s.markExited)
  const disconnect = useAppStore((s) => s.disconnect)
  const reconnect = useAppStore((s) => s.reconnect)

  const tab = sessions.find((t) => t.key === activeKey) ?? null

  // 所有已建立会话的终端视图保持挂载,切换标签仅切换显示:
  // xterm 实例与滚动历史不销毁、WS 不断连,输出持续流入隐藏终端。
  // 注意:此树必须无条件渲染(活动标签为空白/退出态时也不能卸载),
  // 否则切走再切回会丢终端历史。
  const liveSessions = sessions.filter((s) => s.sessionId && s.wsPort && s.status !== 'exited')

  return (
    <>
      {liveSessions.map((s) => {
        const isActive = s.key === activeKey
        const split = isActive && isTool(viewMode)
        return (
          <Box
            key={s.sessionId}
            sx={{ display: isActive ? 'block' : 'none', position: 'absolute', inset: 0 }}
          >
            {/* 左列常驻挂载(终端位置稳定,切换视图不重建、历史不丢);
                文件传输视图时整列隐藏,分屏时右面板经 SplitLayout 挂入(可拖拽调宽) */}
            <Box sx={{ height: '100%', display: viewMode === 'files' ? 'none' : 'block' }}>
              <SplitLayout
                left={
                  <TerminalView
                    sessionId={s.sessionId!}
                    wsPort={s.wsPort!}
                    // 始终 flush:终端外边距统一由 SplitLayout 控制,
                    // 分屏与否边距一致(上 10 下 10 左右 14)
                    flush
                    squareRight={split}
                    onExit={(reason) => markExited(s.sessionId!, reason)}
                  />
                }
                right={
                  split && isTool(viewMode) && toolTabs.length > 0 ? (
                    <ToolsPanel
                      key={s.sessionId}
                      sessionId={s.sessionId!}
                      connId={s.cfg?.id}
                      host={s.cfg?.host}
                      tabs={toolTabs}
                      active={viewMode}
                      onClose={onCloseTool}
                      onActivate={onActivateTool}
                    />
                  ) : null
                }
              />
            </Box>

            {/* 文件传输视图(按会话 key 挂载 → 切会话自动刷新;connId 用于按服务器记忆路径) */}
            {isActive && viewMode === 'files' && (
              <TransferView key={s.sessionId} sessionId={s.sessionId!} connId={s.cfg!.id} />
            )}
          </Box>
        )
      })}

      {/* 活动标签的覆盖层(空白页/退出/连接中),会话视图树保持挂载 */}
      {(!tab || tab.status === 'idle') && <ServerGrid />}
      {tab?.status === 'exited' && (
        <ExitPanel tab={tab} onClose={() => disconnect(tab.key)} onReconnect={() => reconnect(tab.key)} />
      )}
      {tab && (tab.status === 'connecting' || tab.status === 'confirming') && (
        <ConnectingPanel tab={tab} />
      )}
    </>
  )
}

function isTool(v: ViewMode): v is ToolKind {
  return v !== 'terminal' && v !== 'files'
}

export default function App() {
  const init = useAppStore((s) => s.init)
  // 全局视图模式:点已激活的工具按钮回到终端
  const [viewMode, setViewMode] = useState<ViewMode>('terminal')
  // 已打开的工具 tabs(可关闭;工具栏选择时重新添加)
  const [toolTabs, setToolTabs] = useState<ToolKind[]>([])
  // 退出前提示(有传输任务时由 Go 侧 ShouldQuit 触发)
  const [quitPrompt, setQuitPrompt] = useState<number | null>(null)
  // 设置弹窗
  const [showSettings, setShowSettings] = useState(false)
  // 更新弹窗(应用内一体更新窗)+ 发现的新版本信息
  const [showUpdate, setShowUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  // 检查更新:有新版则打开更新弹窗(启动静默检查与设置里手动检查共用)
  const openUpdateDialog = useCallback(async () => {
    try {
      const info = await Update.CheckUpdate()
      if (info?.available) {
        setUpdateInfo(info)
        setShowUpdate(true)
        return true
      }
    } catch {
      // 静默检查失败忽略
    }
    return false
  }, [])

  const setTool = (m: ViewMode) => {
    if (isTool(m)) {
      setToolTabs((prev) => (prev.includes(m) ? prev : [...prev, m]))
    }
    setViewMode(m)
  }

  // 关闭工具 tab:仅移除该 tab;若关的是激活工具,切到剩余最后一个工具,
  // 无剩余才收起分屏回终端(不要在 setState 更新器里放副作用)。
  const closeTool = (k: ToolKind) => {
    const next = toolTabs.filter((t) => t !== k)
    setToolTabs(next)
    if (viewMode === k) {
      setViewMode(next.length > 0 ? next[next.length - 1] : 'terminal')
    }
  }

  useEffect(() => {
    init()
    // 传输终态通知的短时聚合:批量(多选/拖拽上传)完成时避免刷屏 ——
    // 500ms 窗口内的成功合并为一条;失败/取消逐条提示(重要,不合并)。
    const buffer: { message: string; severity: 'success' | 'error' | 'warning' }[] = []
    let flushTimer: number | undefined
    const flushNotices = () => {
      flushTimer = undefined
      const batch = buffer.splice(0, buffer.length)
      if (batch.length === 0) return
      const notify = useNotificationStore.getState().notify
      const ok = batch.filter((n) => n.severity === 'success')
      if (ok.length === 1) notify(ok[0].message, 'success')
      else if (ok.length > 1) notify(`已完成 ${ok.length} 个传输任务`, 'success')
      for (const n of batch) {
        if (n.severity !== 'success') notify(n.message, n.severity)
      }
    }
    const queueNotice = (n: { message: string; severity: 'success' | 'error' | 'warning' }) => {
      buffer.push(n)
      if (flushTimer === undefined) flushTimer = window.setTimeout(flushNotices, 500)
    }
    // 会话结束 → 标记标签页
    const offExit = Events.On('termhub:session:exit', (ev: any) => {
      const data = ev?.data ?? {}
      if (data.sessionId) {
        useAppStore.getState().markExited(data.sessionId, data.reason ?? '会话已结束')
      }
    })
    // 传输进度/终态 → 任务条
    const offProgress = Events.On('termhub:transfer:progress', (ev: any) => {
      if (ev?.data?.id) useTransferStore.getState().applyProgress(ev.data)
    })
    const offDone = Events.On('termhub:transfer:done', (ev: any) => {
      const data = ev?.data as TransferInfo | undefined
      if (!data?.id) return
      useTransferStore.getState().applyDone(data)
      // 传输完成 → 右下角通知(成功/失败/已取消)
      const notice = transferNotice(data)
      if (notice) queueNotice(notice)
    })
    // 退出前有传输任务 → 提示确认
    const offQuitPrompt = Events.On('termhub:quit:prompt', (ev: any) => {
      setQuitPrompt(ev?.data?.count ?? 1)
    })
    // 更新检查（启动静默检查触发）→ 打开应用内更新弹窗
    const offUpdate = Events.On('app:update:check', () => {
      void openUpdateDialog()
    })
    return () => {
      offExit()
      offProgress()
      offDone()
      offQuitPrompt()
      offUpdate()
      if (flushTimer !== undefined) window.clearTimeout(flushTimer)
    }
  }, [init, openUpdateDialog])

  // 全局快捷键循环切换会话标签:Ctrl+→ 下一个,Ctrl+← 上一个(首尾循环)。
  // 在 window 捕获阶段拦截并 stopPropagation,避免组合键被终端/浏览器消费。
  useEffect(() => {
    const cycle = (dir: 1 | -1) => {
      const { sessions, activeKey, setActive } = useAppStore.getState()
      if (sessions.length < 2) return
      const idx = sessions.findIndex((t) => t.key === activeKey)
      const next = (idx + dir + sessions.length) % sessions.length
      setActive(sessions[next].key)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      e.stopPropagation()
      cycle(e.key === 'ArrowLeft' ? -1 : 1)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 主区:工具栏行(品牌 + 工具按钮)+ 标签行 + 内容区 */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 工具栏行:品牌左端,视图工具按钮右端 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                background: 'linear-gradient(135deg, #7aa2f7 0%, #bb9af7 100%)',
                color: '#10121a',
              }}
            >
              <TerminalIcon sx={{ fontSize: 15 }} />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700, letterSpacing: 0.3 }}>
              TermHub
            </Typography>
          </Box>

          {/* 视图工具:文件传输 / 进程管理 / 端口状态(全局,切换会话保持并自动刷新) */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            size="small"
            onChange={(_, v) => {
              // 点击已激活的工具按钮时 exclusive 组返回 null(取消选中)→ 回到终端视图
              if (!v) {
                setViewMode('terminal')
                return
              }
              setTool(v as ViewMode)
            }}
            sx={{
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <ToggleButton value="status" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <MonitorHeartIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">运行状态</Typography>
            </ToggleButton>
            <ToggleButton value="traffic" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <SpeedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">流量监控</Typography>
            </ToggleButton>
            <ToggleButton value="files" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <FolderIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">文件传输</Typography>
            </ToggleButton>
            <ToggleButton value="proc" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <MemoryIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">进程管理</Typography>
            </ToggleButton>
            <ToggleButton value="ports" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <LanIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">端口状态</Typography>
            </ToggleButton>
            <ToggleButton value="svc" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <MiscellaneousServicesIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">服务列表</Typography>
            </ToggleButton>
            <ToggleButton value="fileview" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <FolderOpenIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">文件视图</Typography>
            </ToggleButton>
            <ToggleButton value="commoncmd" sx={{ px: 1.5, py: 0.5, border: 0, gap: 0.75 }}>
              <BookmarkIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">常用命令</Typography>
            </ToggleButton>
          </ToggleButtonGroup>
            <IconButton
              size="small"
              title="设置"
              onClick={() => setShowSettings(true)}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* 标签行 */}
        <Box
          sx={{
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <SessionTabs />
        </Box>

        <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <ErrorBoundary>
            <MainArea
              viewMode={viewMode}
              toolTabs={toolTabs}
              onCloseTool={closeTool}
              onActivateTool={(k) => setViewMode(k)}
            />
          </ErrorBoundary>
        </Box>
      </Box>

      <ConnectionDialog />
      <HostKeyDialog />
      <ConfirmDeleteDialog />

      {/* 传输任务悬浮组件(右下角,全局) */}
      <TransferWidget />

      {/* 右下角通知(传输悬浮按钮之上) */}
      <Box
        sx={{
          position: 'fixed',
          right: 20,
          bottom: 88,
          zIndex: 80,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 1.25,
          maxWidth: 'min(460px, 90vw)',
          pointerEvents: 'none',
        }}
      >
        <NotificationCenter />
      </Box>

      {/* 命令组 / 单条命令运行窗口(居中浮窗,结束不自动关闭) */}
      <GroupRunWindow />

      {/* 退出前传输任务提示 */}
      <ConfirmDialog
        open={quitPrompt !== null}
        title="传输任务进行中"
        message={`还有 ${quitPrompt ?? 0} 个传输任务正在进行,退出将中断传输,确定退出吗?`}
        confirmLabel="仍然退出"
        danger
        onConfirm={() => {
          setQuitPrompt(null)
          void api.quitNow()
        }}
        onCancel={() => setQuitPrompt(null)}
      />

      {/* 设置 */}
      <SettingsDialog
        open={showSettings}
        onFound={(info) => {
          setShowSettings(false)
          setUpdateInfo(info)
          setShowUpdate(true)
        }}
        onClose={() => setShowSettings(false)}
      />

      {/* 更新(应用内一体更新窗:说明 → 进度 → 重启) */}
      <UpdateDialog
        open={showUpdate}
        info={updateInfo}
        onClose={() => setShowUpdate(false)}
      />
    </Box>
  )
}
