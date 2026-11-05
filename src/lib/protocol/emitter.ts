/**
 * Minimal typed event emitter with no dependencies. It works in browsers and in Node.
 *
 *   const e = new Emitter<{ state: [DeviceState]; error: [Error] }>()
 *   const off = e.on('state', (s) => ...)
 *   e.emit('state', s)
 *   off()
 */
/** Event name -> listener argument tuple. Works with interfaces (no index signature needed). */
export type EventMap<E> = { [K in keyof E]: unknown[] }

export type Listener<A extends unknown[]> = (...args: A) => void

export class Emitter<E extends EventMap<E>> {
  private readonly listeners: { [K in keyof E]?: Set<Listener<E[K]>> } = {}

  on<K extends keyof E>(event: K, listener: Listener<E[K]>): () => void {
    let set = this.listeners[event]
    if (!set) {
      set = new Set()
      this.listeners[event] = set
    }
    set.add(listener)
    return () => this.off(event, listener)
  }

  once<K extends keyof E>(event: K, listener: Listener<E[K]>): () => void {
    const off = this.on(event, (...args: E[K]) => {
      off()
      listener(...args)
    })
    return off
  }

  off<K extends keyof E>(event: K, listener: Listener<E[K]>): void {
    this.listeners[event]?.delete(listener)
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    const set = this.listeners[event]
    if (!set) return
    for (const l of [...set]) {
      try {
        l(...args)
      } catch (err) {
        // A failing listener must never break the protocol pipeline.
        console.error(`[hollyland] listener for "${String(event)}" threw`, err)
      }
    }
  }

  listenerCount<K extends keyof E>(event: K): number {
    return this.listeners[event]?.size ?? 0
  }

  removeAll(): void {
    for (const k of Object.keys(this.listeners) as (keyof E)[]) delete this.listeners[k]
  }
}
