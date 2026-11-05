/**
 * Transport implementation over node-hid (hidapi), for bench testing from Node.
 *
 * hidapi treats byte 0 of a write as the report id. The wire packet already starts with 0xAA,
 * so `write(packet)` puts exactly the Android bytes on the interrupt-OUT pipe:
 *   macOS : IOHIDDeviceSetReport(output, id=0xAA, buf=packet[0..63]) -> interrupt OUT (64 B)
 *   Linux : write(hidraw, packet)                                      -> interrupt OUT (64 B)
 * Input: macOS IOHIDFamily drops input reports with undeclared ids (0xBB), so replies never
 * arrive there (docs/PROTOCOL.md §2.4); Linux hidraw delivers them unfiltered.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type * as NodeHidTypes from 'node-hid'
import {
  BaseTransport, CONTROL_USAGE_PAGE, EAGLESHERO_VENDOR_ID, HOLLYLAND_VENDOR_ID, PACKET_SIZE, TransportError,
  type TransportCapabilities, type TransportDeviceInfo,
} from '../src/lib/protocol/index.ts'

const require = createRequire(import.meta.url)
const HID = require('node-hid') as typeof NodeHidTypes

export type HidDeviceEntry = NodeHidTypes.Device

/** All HID collections of Hollyland devices (no I/O). */
export function listHollylandHid(): HidDeviceEntry[] {
  return HID.devices().filter((d) => d.vendorId === HOLLYLAND_VENDOR_ID || d.vendorId === EAGLESHERO_VENDOR_ID)
}

/** Pick the control collection (usage page 0xFF82) of the requested / first device. */
export function findControlEntry(opts: { productId?: number; path?: string } = {}): HidDeviceEntry | undefined {
  const all = listHollylandHid().filter((d) => (opts.productId === undefined || d.productId === opts.productId) && (!opts.path || d.path === opts.path))
  return all.find((d) => d.usagePage === CONTROL_USAGE_PAGE) ?? all.find((d) => (d.usagePage ?? 0) >= 0xff00) ?? all[0]
}

export interface NodeHidTransportOptions {
  productId?: number
  path?: string
  /** Open non-exclusively (default true, so the OS media-key path keeps working). */
  nonExclusive?: boolean
}

export class NodeHidTransport extends BaseTransport {
  readonly kind = 'node-hid'
  readonly capabilities: TransportCapabilities
  private dev: NodeHidTypes.HIDAsync | null = null
  private entry: HidDeviceEntry | undefined
  private readonly opts: NodeHidTransportOptions

  constructor(opts: NodeHidTransportOptions = {}) {
    super()
    this.opts = opts
    this.entry = findControlEntry(opts)
    this.capabilities = { receive: process.platform === 'darwin' ? 'no' : process.platform === 'linux' ? 'unknown' : 'unknown' }
  }

  get isOpen(): boolean {
    return this.dev !== null
  }

  get info(): TransportDeviceInfo | null {
    const e = this.entry
    if (!e) return null
    return {
      vendorId: e.vendorId, productId: e.productId, productName: e.product, manufacturer: e.manufacturer,
      serialNumber: e.serialNumber, id: e.path,
    }
  }

  get entryInfo(): HidDeviceEntry | undefined {
    return this.entry
  }

  async open(): Promise<void> {
    if (this.dev) return
    this.entry = findControlEntry(this.opts)
    if (!this.entry?.path) throw new TransportError('no Hollyland HID device found (VID 0x3547)')
    const dev = await HID.HIDAsync.open(this.entry.path, { nonExclusive: this.opts.nonExclusive ?? true })
    dev.on('data', (buf: Buffer) => this.emitPacket(new Uint8Array(buf)))
    dev.on('error', (err: Error) => {
      this.dev = null
      this.emitDisconnect(err)
    })
    this.dev = dev
    this.debug(`opened ${this.entry.path} usagePage=0x${(this.entry.usagePage ?? 0).toString(16)}`)
  }

  async close(): Promise<void> {
    const d = this.dev
    this.dev = null
    if (d) await d.close()
  }

  async send(packet: Uint8Array): Promise<void> {
    if (!this.dev) throw new TransportError('device is not open')
    if (packet.length === 0 || packet.length > PACKET_SIZE) throw new TransportError(`packet length ${packet.length} not in 1..64`)
    if (packet[0] === 0) throw new TransportError('byte 0 = 0 would be stripped by hidapi as "no report id"')
    const n = await this.dev.write(Buffer.from(packet))
    if (n < packet.length) throw new TransportError(`short write: ${n}/${packet.length}`)
  }
}

export interface DarwinHidCounters {
  inputReports: number
  setReports: number
  getReports: number
}

/**
 * macOS only: read the HID driver's DebugState counters from the IORegistry (read-only).
 * InputReportCount counts interrupt-IN reports the driver received from the device, including
 * ones IOHIDFamily later drops because their report id is undeclared. This is how we can see
 * that the A2 answers even though no input report reaches user space.
 */
export function readDarwinHidCounters(vendorId = HOLLYLAND_VENDOR_ID, productId?: number): DarwinHidCounters | null {
  if (process.platform !== 'darwin') return null
  try {
    const out = execFileSync('ioreg', ['-r', '-c', 'IOHIDDevice', '-l', '-w0'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const blocks = out.split(/\n(?=\+-o )/)
    for (const b of blocks) {
      if (!new RegExp(`"VendorID" = ${vendorId}\\b`).test(b)) continue
      if (productId !== undefined && !new RegExp(`"ProductID" = ${productId}\\b`).test(b)) continue
      const m = /"DebugState" = \{([^}]*)\}/.exec(b)
      if (!m || !/InputReportCount/.test(m[1])) continue
      const num = (k: string) => Number(new RegExp(`"${k}"=(\\d+)`).exec(m[1])?.[1] ?? NaN)
      return { inputReports: num('InputReportCount'), setReports: num('SetReportCount'), getReports: num('GetReportCount') }
    }
  } catch {
    /* ignore */
  }
  return null
}
