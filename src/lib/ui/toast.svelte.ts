export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: { label: string; run: () => void }
  /** Auto-dismiss delay in ms; 0 = stays until dismissed. */
  timeout: number
}

let nextId = 1

/**
 * Toasts. Errors and toasts with an action (e.g. "Retry") stay until dismissed, so nobody loses
 * the action to a timer (WCAG 2.2.1). Timed toasts pause while hovered or focused.
 */
class ToastStore {
  items: Toast[] = $state([])
  private timers = new Map<number, { handle: ReturnType<typeof setTimeout> | null; left: number; started: number }>()

  push(kind: ToastKind, message: string, opts: { action?: Toast['action']; timeout?: number } = {}): number {
    const id = nextId++
    const timeout = opts.action ? 0 : (opts.timeout ?? (kind === 'error' ? 0 : 3500))
    const dropped = this.items.slice(0, -2)
    dropped.forEach((t) => this.clearTimer(t.id))
    this.items = [...this.items.slice(-2), { id, kind, message, action: opts.action, timeout }]
    if (timeout > 0) this.startTimer(id, timeout)
    return id
  }

  info = (m: string, o?: { action?: Toast['action']; timeout?: number }) => this.push('info', m, o)
  success = (m: string, o?: { action?: Toast['action']; timeout?: number }) => this.push('success', m, o)
  warning = (m: string, o?: { action?: Toast['action']; timeout?: number }) => this.push('warning', m, o)
  error = (m: string, o?: { action?: Toast['action']; timeout?: number }) => this.push('error', m, o)

  dismiss(id: number) {
    this.clearTimer(id)
    this.items = this.items.filter((t) => t.id !== id)
  }

  /** Stop the auto-dismiss clock (pointer over the toast, or focus inside it). */
  pause(id: number) {
    const t = this.timers.get(id)
    if (!t || !t.handle) return
    clearTimeout(t.handle)
    t.left = Math.max(0, t.left - (Date.now() - t.started))
    t.handle = null
  }

  /** Restart the clock with the time that was left (at least 1.5 s). */
  resume(id: number) {
    const t = this.timers.get(id)
    if (!t || t.handle) return
    this.startTimer(id, Math.max(1500, t.left))
  }

  private startTimer(id: number, ms: number) {
    this.timers.set(id, { handle: setTimeout(() => this.dismiss(id), ms), left: ms, started: Date.now() })
  }

  private clearTimer(id: number) {
    const t = this.timers.get(id)
    if (t?.handle) clearTimeout(t.handle)
    this.timers.delete(id)
  }
}

export const toasts = new ToastStore()
