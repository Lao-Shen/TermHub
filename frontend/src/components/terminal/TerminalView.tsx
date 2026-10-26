import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  Box,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { clipboard } from '../../services/clipboard'
import { TerminalBridge } from '../../services/terminal'

const TERM_FONT = '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace'

export interface TerminalViewProps {
  sessionId: string
  wsPort: number
  /** 会话退出(WS exit 帧)时通知上层。 */
  onExit: (reason: string) => void
  /** 去掉自身外边距(由 SplitLayout 统一控制,分屏与否边距一致)。 */
  flush?: boolean
  /** 分屏时右侧两角改直角,与右侧窗口拼成"中间切开"效果。 */
  squareRight?: boolean
}

/**
 * xterm 终端视图:
 *   - 挂载 xterm + fit + webgl 加速;
 *   - 建立 TerminalBridge(WS),输入/输出/resize 双向绑定;
 *   - 容器尺寸变化 → fit → 同步远端 pty。
 */
export function TerminalView({ sessionId, wsPort, onExit, flush = false, squareRight = false }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // 终端实际挂载的内盒:相对容器留出内部边距(内容不贴终端左缘)
  const innerRef = useRef<HTMLDivElement>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  // 数据通道状态:connecting(首连)/ ready / reconnecting(意外断开,自动重试中)
  const [bridgeState, setBridgeState] = useState<'connecting' | 'ready' | 'reconnecting'>('connecting')
  // 右键菜单
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  // 底部命令输入框内容(本地输入,回车一次性发送;高延迟链路免逐键回显卡顿)
  const [command, setCommand] = useState('')
  const termRef = useRef<Terminal | null>(null)
  const bridgeRef = useRef<TerminalBridge | null>(null)

  const closeMenu = () => setMenuPos(null)

  // 把输入框内容作为一整条命令送入会话:内容原样 + 回车(CR)。
  // 与在终端里逐键输入等效,但键击一次性到达,不产生逐键往返延迟;
  // 发送后清空并保持焦点在输入框(便于连续输入命令),Escape 可回终端。
  const sendCommand = () => {
    const text = command
    if (!text.trim()) return
    bridgeRef.current?.send(text + '\r')
    setCommand('')
  }

  const doCopy = async () => {
    const text = termRef.current?.getSelection() ?? ''
    if (text) await clipboard.setText(text)
    closeMenu()
  }

  const doPaste = async () => {
    const text = await clipboard.getText()
    if (text) bridgeRef.current?.send(text)
    closeMenu()
  }

  useEffect(() => {
    // 终端挂载到内盒:内容相对终端容器左缘留出边距
    const el = innerRef.current
    if (!el) return

    const term = new Terminal({
      fontFamily: TERM_FONT,
      fontSize: 14,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10000,
      theme: {
        background: '#10121a',
        foreground: '#c0caf5',
        cursor: '#7aa2f7',
        cursorAccent: '#10121a',
        selectionBackground: 'rgba(122, 162, 247, 0.35)',
        black: '#414868',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#c0caf5',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      /* WebGL 不可用时回退 Canvas 渲染 */
    }
    term.open(el)
    fit.fit()

    const bridge = new TerminalBridge(sessionId, wsPort, {
      onData: (data) => term.write(data),
      onExit: (reason) => onExitRef.current(reason),
      onSocketClose: () => setBridgeState('reconnecting'),
      onReconnected: () => {
        setBridgeState('ready')
        fit.fit()
        bridge.resize(term.rows, term.cols)
        term.focus()
      },
    })

    // 输入 → WS;窗口变化 → fit + resize。
    // 标签切换后视图保持挂载(display:none),隐藏时容器尺寸为 0,
    // 跳过 fit 与 resize,避免向 pty 发送 0 尺寸;重新可见时由 RO 触发恢复。
    const dataSub = term.onData((d) => bridge.send(d))
    // 选中状态 → 右键"复制"可用性
    const selSub = term.onSelectionChange(() => setHasSelection(!!term.getSelection()))
    let wasHidden = el.clientWidth === 0
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) {
        wasHidden = true
        return
      }
      fit.fit()
      bridge.resize(term.rows, term.cols)
      if (wasHidden) {
        wasHidden = false
        term.focus() // 切回本标签时把键盘焦点还给终端
      }
    })
    ro.observe(el)

    termRef.current = term
    bridgeRef.current = bridge

    bridge
      .connect()
      .then(() => {
        // 连接就绪后再按实际尺寸同步一次(首帧可能先于 fit);隐藏中则等 RO
        setBridgeState('ready')
        if (el.clientWidth > 0 && el.clientHeight > 0) {
          fit.fit()
          bridge.resize(term.rows, term.cols)
          term.focus()
        }
      })
      .catch((err: unknown) => {
        onExitRef.current(err instanceof Error ? err.message : String(err))
      })

    return () => {
      ro.disconnect()
      dataSub.dispose()
      selSub.dispose()
      bridge.close()
      term.dispose()
      termRef.current = null
      bridgeRef.current = null
    }
  }, [sessionId, wsPort])

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        // 分屏时外边距由 SplitLayout 统一控制;独立时与软件左/右缘等距
        p: flush ? 0 : '10px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <Box
        ref={containerRef}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          // 分屏:右侧两角直角(与右窗拼成从中间切开);独立:四角圆角
          borderRadius: squareRight ? '20px 0 0 20px' : 2,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#10121a',
          position: 'relative',
          // 终端内需要文本选择
          '& .xterm': { userSelect: 'text' },
          '& .xterm .xterm-viewport': { '&::-webkit-scrollbar': { width: 6 } },
        }}
      >
        {/* 终端挂载内盒:内部留白,内容不贴终端左缘;底部留出命令输入框的高度 */}
        <Box
          ref={innerRef}
          sx={{ position: 'absolute', top: 8, left: 10, right: 6, bottom: 56 }}
        />
        {/* 意外断线提示条:自动重连中(层级须低于右上角视图切换按钮) */}
        {bridgeState === 'reconnecting' && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 1,
              py: 0.75,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              bgcolor: 'rgba(224, 175, 104, 0.12)',
              borderBottom: '1px solid',
              borderColor: 'warning.main',
              backdropFilter: 'blur(4px)',
            }}
          >
            <CircularProgress size={12} sx={{ color: 'warning.main' }} />
            <Typography variant="caption" sx={{ color: 'warning.main' }}>
              连接中断,正在自动重连…
            </Typography>
          </Box>
        )}

        {/* 底部命令输入框(会话视图内,悬浮在终端底部):本地输入(无逐键回显延迟),
            回车把整条命令一次性发送到会话;连接未就绪时禁用;Escape 焦点还给终端。 */}
        <Box
          onContextMenu={(e) => e.stopPropagation()}
          sx={{
            position: 'absolute',
            left: 10,
            right: 6,
            bottom: 8,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            px: 1.25,
            minHeight: 40,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <TextField
            variant="standard"
            size="small"
            fullWidth
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendCommand()
              } else if (e.key === 'Escape') {
                termRef.current?.focus()
              }
            }}
            placeholder="在此输入命令,回车一次性发送到会话(高延迟服务器推荐)"
            disabled={bridgeState !== 'ready'}
            slotProps={{
              input: { disableUnderline: true },
              htmlInput: { style: { fontSize: 13 } },
            }}
          />
          <Tooltip title="发送到会话 (Enter)">
            <span>
              <IconButton
                size="small"
                disabled={bridgeState !== 'ready' || !command.trim()}
                onClick={sendCommand}
                sx={{ color: 'text.secondary' }}
              >
                <KeyboardReturnIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* 右键菜单:复制(需有选中)/粘贴 */}
      <Menu
        open={!!menuPos}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={menuPos ? { top: menuPos.y, left: menuPos.x } : undefined}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem disabled={!hasSelection} onClick={() => void doCopy()}>
          <ListItemIcon>
            <ContentCopyIcon sx={{ fontSize: 17 }} />
          </ListItemIcon>
          <ListItemText>复制</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => void doPaste()}>
          <ListItemIcon>
            <ContentPasteIcon sx={{ fontSize: 17 }} />
          </ListItemIcon>
          <ListItemText>粘贴</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}
