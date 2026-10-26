// 全局通知(右下角弹出):通知类消息统一走这里,由 NotificationCenter 渲染。
import { create } from 'zustand'

export type NoticeSeverity = 'success' | 'error' | 'info' | 'warning'

export interface Notice {
  id: number
  message: string
  severity: NoticeSeverity
}

interface NotificationState {
  items: Notice[]
  /** 弹出一条通知,默认 3.2s 后自动消失(duration<=0 表示不自动消失)。 */
  notify(message: string, severity?: NoticeSeverity, duration?: number): void
  dismiss(id: number): void
}

let nextId = 1

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  notify(message, severity = 'info', duration = 3200) {
    const id = nextId++
    set((s) => ({ items: [...s.items, { id, message, severity }] }))
    if (duration > 0) {
      setTimeout(() => set((s) => ({ items: s.items.filter((n) => n.id !== id) })), duration)
    }
  },
  dismiss(id) {
    set((s) => ({ items: s.items.filter((n) => n.id !== id) }))
  },
}))
