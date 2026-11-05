/** Ring buffer of raw HID frames for the developer console. */

export interface TrafficEntry {
  id: number
  t: number
  dir: 'out' | 'in'
  bytes: Uint8Array
  hex: string
  /** Hex trimmed of trailing zero padding. */
  hexShort: string
  decoded?: string
  status: 'ok' | 'error' | 'timeout'
  heartbeat: boolean
  manual: boolean
}

const MAX = 5000
let nextId = 1

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ')

class TrafficLog {
  entries: TrafficEntry[] = $state([])
  total = $state(0)
  paused = $state(false)

  add(e: { dir: 'out' | 'in'; bytes: Uint8Array; decoded?: string; status?: TrafficEntry['status']; heartbeat?: boolean; manual?: boolean }) {
    this.total++
    if (this.paused) return
    let end = e.bytes.length
    while (end > 6 && e.bytes[end - 1] === 0) end--
    const entry: TrafficEntry = {
      id: nextId++,
      t: Date.now(),
      dir: e.dir,
      bytes: e.bytes,
      hex: toHex(e.bytes),
      hexShort: toHex(e.bytes.subarray(0, end)) + (end < e.bytes.length ? ' …' : ''),
      decoded: e.decoded,
      status: e.status ?? 'ok',
      heartbeat: !!e.heartbeat,
      manual: !!e.manual,
    }
    const next = this.entries.length >= MAX ? this.entries.slice(-MAX + 1) : this.entries.slice()
    next.push(entry)
    this.entries = next
  }

  clear() {
    this.entries = []
    this.total = 0
  }
}

export const traffic = new TrafficLog()
