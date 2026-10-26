// 全局状态(zustand):连接列表、会话标签、对话框。
// 存储约定:
//   - 连接配置(不含任何秘密)→ localStorage,跨启动保留;
//   - 密码与主机密钥指纹 → 系统钥匙串(经 services/credentials.ts 走 Go 绑定);
//   - 前端不再往 localStorage/sessionStorage 写秘密。
import { create } from 'zustand'
import { credentials } from '../services/credentials'
import { api } from '../services/api'
import {
  CONNECTIONS_KEY,
  FILEVIEW_PATH_KEY_PREFIX,
  FILE_BLACKLIST_KEY_PREFIX,
  FT_PATH_KEY_PREFIX,
  PRIVATE_COMMANDS_KEY_PREFIX,
} from '../services/storageKeys'
import { AuthMethod } from '../types'
import type { ConnectionConfig, SessionTab } from '../types'
import { errMsg } from '../types'

const CONNS_KEY = CONNECTIONS_KEY

function loadConnections(): ConnectionConfig[] {
  try {
    const raw = localStorage.getItem(CONNS_KEY)
    if (!raw) return []
    // 旧版本把跳板机存在 proxy 字段(带 user/auth);新版本 proxy 是传输代理,跳板改名 proxyJump
    const parsed = JSON.parse(raw) as (ConnectionConfig & { proxy?: any })[]
    const migrated = parsed.map((c) => {
      if (c.proxy && (c.proxy.user !== undefined || c.proxy.auth !== undefined)) {
        const { proxy, ...rest } = c
        return { ...rest, proxyJump: proxy }
      }
      return c
    })
    return Array.isArray(migrated) ? migrated : []
  } catch {
    return []
  }
}

function persistConnections(conns: ConnectionConfig[]) {
  try {
    localStorage.setItem(CONNS_KEY, JSON.stringify(conns))
  } catch {
    /* 存储满/隐私模式,静默 */
  }
}

export interface ConnectionDialogState {
  open: boolean
  /** new = 新建;edit = 编辑既有连接;connect = 补密码后连接 */
  mode: 'new' | 'edit' | 'connect'
  conn: ConnectionConfig | null
}

export interface HostKeyPrompt {
  tabKey: string
  cfg: ConnectionConfig
  fingerprint: string
  /** 指纹归属:跳板机或目标主机 */
  scope: 'target' | 'proxy'
  /** 指纹所属主机的展示名(host:port) */
  host: string
}

interface AppState {
  connections: ConnectionConfig[]
  sessions: SessionTab[]
  activeKey: string | null
  dialog: ConnectionDialogState
  hostKeyPrompt: HostKeyPrompt | null
  /** 待删除确认的连接(弹窗展示)。 */
  deletePrompt: ConnectionConfig | null

  init(): void
  /** 切换当前活动标签。 */
  setActive(key: string | null): void
  /** 新增空白标签页(浏览器式,服务器卡片墙)。 */
  newTab(): void
  openNewDialog(): void
  openEditDialog(conn: ConnectionConfig): void
  openConnectDialog(conn: ConnectionConfig): void
  closeDialog(): void
  /** 保存连接(去掉秘密)并持久化;返回可连接用的完整配置(含密码)。 */
  saveConnection(cfg: ConnectionConfig): ConnectionConfig
  /** 批量追加连接(导入用):配置需已去秘密并分配好新 ID。 */
  addConnections(cfgs: ConnectionConfig[]): void
  /** 删除连接:移除配置与钥匙串凭据,不影响已打开的会话。 */
  removeConnection(id: string): void
  askDelete(conn: ConnectionConfig): void
  cancelDelete(): void
  confirmDelete(): void
  /** 发起连接:密码认证时从钥匙串取密码,缺密码弹框;*Override 跳过钥匙串。 */
  connect(conn: ConnectionConfig, passwordOverride?: string, proxyPasswordOverride?: string): Promise<void>
  /** 建立会话:tabKey 为空时新建标签,否则在既有标签上推进(主机密钥确认流程)。 */
  establish(cfg: ConnectionConfig, tabKey?: string): Promise<void>
  confirmHostKey(): Promise<void>
  cancelHostKey(): void
  disconnect(key: string): void
  /** 会话退出后用原配置重连(新建标签)。 */
  reconnect(key: string): void
  removeTab(key: string): void
  /** 后端会话结束事件:标记对应标签为已退出。 */
  markExited(sessionId: string, reason: string): void
}

/** 新建一个空白标签页(无会话,展示服务器卡片墙)。 */
function newIdleTab(): SessionTab {
  return { key: `t-${crypto.randomUUID()}`, cfg: null, status: 'idle' }
}

/** 从钥匙串取密码与已信任指纹,填充进连接配置(缺省即首次连接流程)。 */
async function hydrateSecrets(
  conn: ConnectionConfig,
  passwordOverride?: string,
  proxyPasswordOverride?: string,
): Promise<ConnectionConfig> {
  const cfg: ConnectionConfig = { ...conn }
  if (conn.auth === AuthMethod.AuthPassword) {
    cfg.password = passwordOverride ?? (await credentials.getPassword(conn.id))
  }
  const fp = await credentials.getTrustedHostKey(conn.id)
  if (fp) cfg.trustedHostKey = fp

  if (cfg.proxyJump) {
    cfg.proxyJump = { ...cfg.proxyJump }
    if (cfg.proxyJump.auth === AuthMethod.AuthPassword) {
      cfg.proxyJump.password =
        proxyPasswordOverride ?? ((await credentials.getProxyPassword(conn.id)) || undefined)
    }
    const pfp = await credentials.getProxyTrustedHostKey(conn.id)
    if (pfp) cfg.proxyJump.trustedHostKey = pfp
  }
  return cfg
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: loadConnections(),
  sessions: [],
  activeKey: null,
  dialog: { open: false, mode: 'new', conn: null },
  hostKeyPrompt: null,
  deletePrompt: null,

  init() {
    // 打开应用时默认一个空白标签页(浏览器式)
    const idle = newIdleTab()
    set({ sessions: [idle], activeKey: idle.key })

    // 旧版本把指纹存在 localStorage:迁移进钥匙串后从列表剥离
    const legacy = get().connections.filter((c) => c.trustedHostKey)
    if (legacy.length === 0) return
    void Promise.allSettled(
      legacy.map((c) => credentials.setTrustedHostKey(c.id, c.trustedHostKey!)),
    ).finally(() => {
      const cleaned = get().connections.map(({ trustedHostKey: _t, ...rest }) => rest)
      set({ connections: cleaned })
      persistConnections(cleaned)
    })
  },

  setActive(key) {
    set({ activeKey: key })
  },

  newTab() {
    set((state) => {
      const t = newIdleTab()
      return { sessions: [...state.sessions, t], activeKey: t.key }
    })
  },

  openNewDialog() {
    set({ dialog: { open: true, mode: 'new', conn: null } })
  },

  openEditDialog(conn) {
    set({ dialog: { open: true, mode: 'edit', conn } })
  },

  openConnectDialog(conn) {
    set({ dialog: { open: true, mode: 'connect', conn } })
  },

  closeDialog() {
    set({ dialog: { open: false, mode: 'new', conn: null } })
  },

  saveConnection(cfg) {
    // 密码不落前端存储(钥匙串在对话框/连接流程中单独写入)
    const { password: _pwd, ...stored } = cfg
    const conns = get().connections
    const idx = conns.findIndex((c) => c.id === cfg.id)
    const next = idx >= 0 ? [...conns.slice(0, idx), stored, ...conns.slice(idx + 1)] : [...conns, stored]
    set({ connections: next })
    persistConnections(next)
    return stored
  },

  addConnections(cfgs) {
    if (cfgs.length === 0) return
    const next = [...get().connections, ...cfgs]
    set({ connections: next })
    persistConnections(next)
  },

  removeConnection(id) {
    void credentials.deletePassword(id)
    void credentials.deleteTrustedHostKey(id)
    void credentials.deleteProxyPassword(id)
    void credentials.deleteProxyTrustedHostKey(id)
    // 清理文件传输/文件视图记住的路径、传输黑名单与私有命令库
    try {
      localStorage.removeItem(FT_PATH_KEY_PREFIX + id)
      localStorage.removeItem(FILEVIEW_PATH_KEY_PREFIX + id)
      localStorage.removeItem(FILE_BLACKLIST_KEY_PREFIX + id)
      localStorage.removeItem(PRIVATE_COMMANDS_KEY_PREFIX + id)
    } catch {
      /* 忽略 */
    }
    const conns = get().connections.filter((c) => c.id !== id)
    set({ connections: conns })
    persistConnections(conns)
  },

  askDelete(conn) {
    set({ deletePrompt: conn })
  },

  cancelDelete() {
    set({ deletePrompt: null })
  },

  confirmDelete() {
    const p = get().deletePrompt
    if (p) get().removeConnection(p.id)
    set({ deletePrompt: null })
  },

  async connect(conn, passwordOverride, proxyPasswordOverride) {
    // 缺密码(目标机或跳板机)时弹补密码框
    if (!passwordOverride) {
      if (conn.auth === AuthMethod.AuthPassword) {
        const pwd = await credentials.getPassword(conn.id)
        if (!pwd) {
          get().openConnectDialog(conn)
          return
        }
      }
    }
    if (!proxyPasswordOverride) {
      if (conn.proxyJump?.auth === AuthMethod.AuthPassword) {
        const pwd = await credentials.getProxyPassword(conn.id)
        if (!pwd) {
          get().openConnectDialog(conn)
          return
        }
      }
    }
    const cfg = await hydrateSecrets(conn, passwordOverride, proxyPasswordOverride)
    // 活动标签是空白页时在其上建立会话(浏览器式),否则新建标签
    const active = get().sessions.find((t) => t.key === get().activeKey)
    if (active?.status === 'idle') {
      await get().establish(cfg, active.key)
    } else {
      await get().establish(cfg)
    }
  },

  async establish(cfg, tabKey) {
    const key = tabKey ?? `t-${crypto.randomUUID()}`
    const patch = (p: Partial<SessionTab>) =>
      set((state) => ({
        sessions: state.sessions.map((t) => (t.key === key ? { ...t, ...p } : t)),
      }))

    if (!tabKey) {
      set((state) => ({
        sessions: [...state.sessions, { key, cfg, status: 'connecting' as const }],
        activeKey: key,
      }))
    } else {
      // 在既有标签(如空白页)上建立会话:同步 cfg,标签标题即显示备注名称
      patch({ cfg, status: 'connecting' })
    }

    try {
      const res = await api.connect(cfg)
      if (res.needsHostKeyConfirm) {
        const scope: 'target' | 'proxy' = res.hostKeyIsProxy ? 'proxy' : 'target'
        set({
          hostKeyPrompt: {
            tabKey: key,
            cfg,
            fingerprint: res.hostKeyFingerprint,
            scope,
            host: res.hostKeyHost ? `${res.hostKeyHost}:${res.hostKeyPort || 22}` : cfg.host,
          },
        })
        patch({
          status: 'confirming',
          fingerprint: res.hostKeyFingerprint,
          wsPort: res.wsPort,
        })
        return
      }
      patch({
        sessionId: res.sessionId,
        wsPort: res.wsPort,
        status: 'connected',
        fingerprint: res.hostKeyFingerprint,
      })
    } catch (err) {
      patch({ status: 'exited', exitReason: errMsg(err) })
    }
  },

  async confirmHostKey() {
    const p = get().hostKeyPrompt
    if (!p) return
    let cfg: ConnectionConfig
    if (p.scope === 'proxy') {
      cfg = { ...p.cfg, proxyJump: { ...p.cfg.proxyJump!, trustedHostKey: p.fingerprint } }
      void credentials.setProxyTrustedHostKey(cfg.id, p.fingerprint).catch(() => {})
    } else {
      cfg = { ...p.cfg, trustedHostKey: p.fingerprint }
      void credentials.setTrustedHostKey(cfg.id, p.fingerprint).catch(() => {})
    }
    set({ hostKeyPrompt: null })
    await get().establish(cfg, p.tabKey)
  },

  cancelHostKey() {
    const p = get().hostKeyPrompt
    set({ hostKeyPrompt: null })
    if (p) get().removeTab(p.tabKey)
  },

  disconnect(key) {
    const tab = get().sessions.find((t) => t.key === key)
    if (tab?.sessionId) {
      // 后端关闭后 exit 事件会来,但标签已被本地移除,事件自然落空
      api.disconnect(tab.sessionId).catch(() => {})
    }
    get().removeTab(key)
  },

  reconnect(key) {
    const tab = get().sessions.find((t) => t.key === key)
    if (!tab?.cfg) return
    // 旧标签移除,新标签沿用原配置(含已确认的主机密钥指纹与密码)
    get().removeTab(key)
    void get().establish(tab.cfg)
  },

  removeTab(key) {
    set((state) => {
      let sessions = state.sessions.filter((t) => t.key !== key)
      let activeKey = state.activeKey
      if (activeKey === key) {
        activeKey = sessions.length ? sessions[sessions.length - 1].key : null
      }
      // 最后一个标签关闭后自动补一个空白页(浏览器式)
      if (sessions.length === 0) {
        const idle = newIdleTab()
        sessions = [idle]
        activeKey = idle.key
      }
      return { sessions, activeKey }
    })
  },

  markExited(sessionId, reason) {
    set((state) => ({
      sessions: state.sessions.map((t) =>
        t.sessionId === sessionId ? { ...t, status: 'exited', exitReason: reason } : t,
      ),
    }))
  },
}))
