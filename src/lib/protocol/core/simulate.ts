/**
 * Glue between a DeviceSimulator and MockTransport (mock.ts, unchanged): host frames go to
 * `sim.respond`, device pushes from `sim.attach` are injected.
 */
import { MockTransport } from '../mock'
import type { DeviceSimulator } from './types'

export interface SimulatedTransportOptions {
  /** Reply latency (default 0 = next microtask). */
  latencyMs?: number
}

export function simulatedTransport(sim: DeviceSimulator, o: SimulatedTransportOptions = {}): MockTransport {
  const t = new MockTransport({
    info: sim.info,
    respond: (p) => sim.respond(p),
    latencyMs: o.latencyMs ?? 0,
    capabilities: { ...sim.capabilities, link: 'mock' },
  })
  if (sim.attach) {
    let detach: (() => void) | null = null
    const open = t.open.bind(t)
    const close = t.close.bind(t)
    // Pushes flow only while the transport is open, like a real link.
    t.open = async () => {
      await open()
      detach ??= sim.attach!((p) => {
        if (t.isOpen) t.inject(p)
      })
    }
    t.close = async () => {
      detach?.()
      detach = null
      await close()
    }
  }
  return t
}
