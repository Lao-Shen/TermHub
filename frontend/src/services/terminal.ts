// 终端数据面:WebSocket 客户端,与后端 internal/bridge/hub.go 对应。
// 协议:
//   前端 → 后端  二进制 = 键盘输入;文本 JSON = {type:'resize',rows,cols}
//   后端 → 前端  二进制 = 远端输出;文本 JSON = {type:'exit',reason}
//
// 连接建立后若意外断开(session 仍存活)自动重连,指数退避;
// 后端会在重挂时回放缓冲的未消费输出(见 hub.go)。
// UI 无关,可独立测试。

export interface TerminalBridgeCallbacks {
  /** 远端输出(UTF-8 解码后交给 xterm) */
  onData: (data: string) => void
  /** 会话退出(远端退出/断开) */
  onExit: (reason: string) => void
  /** 连接意外断开,进入自动重连(提示条用) */
  onSocketClose: () => void
  /** 自动重连成功(重新 fit/resize 用) */
  onReconnected: () => void
}

const RETRY_BASE_MS = 1000
const RETRY_MAX_MS = 5000

export class TerminalBridge {
  private ws: WebSocket | null = null
  private closedByUs = false
  private disposed = false
  /** 曾成功建立过连接(只有已建立的连接意外断开才自动重连) */
  private connectedOnce = false
  private retryDelay = RETRY_BASE_MS
  private retryTimer: number | undefined

  constructor(
    private readonly sessionId: string,
    private readonly wsPort: number,
    private readonly cb: TerminalBridgeCallbacks,
  ) {}

  /** 建立 WS 连接,成功 resolve,失败 reject。 */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.wsPort}/ws/${this.sessionId}`)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      ws.onopen = () => {
        this.connectedOnce = true
        this.retryDelay = RETRY_BASE_MS
        resolve()
      }
      ws.onerror = () => {
        if (!this.connectedOnce) reject(new Error('终端数据通道连接失败'))
        // 已建立的连接出错会走 onclose,这里不重复处理
      }
      ws.onmessage = (ev) => this.handleMessage(ev)
      ws.onclose = () => {
        if (this.closedByUs || this.disposed) return
        if (this.connectedOnce) {
          this.cb.onSocketClose()
          this.scheduleReconnect()
        }
      }
    })
  }

  private handleMessage(ev: MessageEvent) {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data) as { type?: string; reason?: string }
        if (msg.type === 'exit') this.cb.onExit(msg.reason ?? '会话已结束')
      } catch {
        /* 非 JSON 文本忽略 */
      }
      return
    }
    const bytes = new Uint8Array(ev.data as ArrayBuffer)
    this.cb.onData(new TextDecoder().decode(bytes))
  }

  /** 指数退避重连,直至成功或组件销毁(会话死亡由 exit 事件兜底)。 */
  private scheduleReconnect() {
    if (this.retryTimer !== undefined || this.disposed) return
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined
      if (this.disposed) return
      this.connect()
        .then(() => this.cb.onReconnected())
        .catch(() => this.scheduleReconnect())
    }, this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS)
  }

  /** 发送键盘输入(编码为二进制帧)。 */
  send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(new TextEncoder().encode(data))
    }
  }

  /** 同步 pty 尺寸。 */
  resize(rows: number, cols: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', rows, cols }))
    }
  }

  /** 关闭并停止重连(组件卸载/主动断开)。 */
  close() {
    this.closedByUs = true
    this.disposed = true
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.ws?.close()
    this.ws = null
  }
}
