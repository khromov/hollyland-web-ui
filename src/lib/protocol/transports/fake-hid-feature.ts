/**
 * Feature-report test double for WebHidFeatureTransport (docs/FAMILIES.md §5.4): a FakeHidDevice whose
 * SET_REPORT(feature) frames go to a responder (e.g. a family DeviceSimulator) and whose GET_REPORT returns the
 * device's "current reply register", the way a HID firmware answers GET_REPORT:
 *
 *  - every reply the responder produces is queued; each GET takes the next one into the register and returns it
 *  - with nothing queued, GET returns the register again (the previous reply, i.e. a stale reply) or, before the
 *    first reply, all zeros
 *  - `staleGets: n` makes the next n GETs after a SET return the old register before the new reply is "ready"
 *  - `getFailure` makes every GET reject (Chrome refusing an undeclared feature report); `hang` never settles
 *  - FakeHidDevice's options still apply: featureIncludesReportId, strictSizes, failNext
 *
 *   const sim = a1.driver… / new A1Simulator()
 *   const dev = fakeFeatureDeviceFor(sim)              // VID/PID from sim.info, A1 collections
 *   const t = new WebHidFeatureTransport(dev.hid)
 *
 * Runs in Node. Never used by the app at run time.
 */
import type { DeviceSimulator } from '../core/types'
import { A1_COLLECTIONS, FakeHidDevice, type FakeHidDeviceOptions } from './fake-hid'

export interface FakeFeatureHidDeviceOptions extends Partial<FakeHidDeviceOptions> {
  /** Feature report the responder serves (default 5). */
  reportId?: number
  /** Report size including the id byte (default 64): replies are cut / padded into reports of this size. */
  reportSize?: number
  /** Device side: host frame ([reportId, …data]) in, reply packets out (they are re-cut into reports). */
  respond?: (frame: Uint8Array) => Uint8Array[]
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class FakeFeatureHidDevice extends FakeHidDevice {
  readonly reportId: number
  readonly reportSize: number
  respond: ((frame: Uint8Array) => Uint8Array[]) | null
  /** Replies waiting for a GET (each one full report, id byte included). */
  readonly queue: Uint8Array[] = []
  /** What GET_REPORT returns when nothing new is queued (id byte included), null = all zeros. */
  register: Uint8Array | null = null
  /** The next n GETs return the old register before the queued reply (a slow firmware). */
  staleGets = 0
  /** Every GET rejects with this error while set (persistent, unlike failNext). */
  getFailure: Error | null = null
  /** The next SET or GET never settles. */
  hang: 'set' | 'get' | null = null
  /** Delays in ms before SET / GET settle. */
  setDelayMs = 0
  getDelayMs = 0
  /** Number of GET_REPORT calls. */
  gets = 0

  constructor(o: FakeFeatureHidDeviceOptions = {}) {
    super({
      vendorId: o.vendorId ?? 0x3547,
      productId: o.productId ?? 1031,
      productName: o.productName ?? 'LARK A1 (fake)',
      collections: o.collections ?? A1_COLLECTIONS,
      featureIncludesReportId: o.featureIncludesReportId,
      strictReportIds: o.strictReportIds,
      strictSizes: o.strictSizes,
    })
    this.reportId = o.reportId ?? 5
    this.reportSize = o.reportSize ?? 64
    this.respond = o.respond ?? null
  }

  override async sendFeatureReport(reportId: number, data: BufferSource): Promise<void> {
    if (this.hang === 'set') {
      this.hang = null
      return new Promise<void>(() => undefined)
    }
    if (this.setDelayMs > 0) await sleep(this.setDelayMs)
    await super.sendFeatureReport(reportId, data)
    if (reportId !== this.reportId || !this.respond) return
    const last = this.sent[this.sent.length - 1]
    const frame = new Uint8Array(last.data.length + 1)
    frame[0] = reportId
    frame.set(last.data, 1)
    this.queue.push(...this.toReports(this.respond(frame)))
  }

  override async receiveFeatureReport(reportId: number): Promise<DataView> {
    this.gets++
    if (this.hang === 'get') {
      this.hang = null
      return new Promise<DataView>(() => undefined)
    }
    if (this.getDelayMs > 0) await sleep(this.getDelayMs)
    if (this.opened && this.getFailure) throw this.getFailure
    if (reportId === this.reportId && this.opened && this.failNext?.op !== 'receiveFeatureReport') {
      if (this.staleGets > 0 && this.queue.length) this.staleGets--
      else if (this.queue.length) this.register = this.queue.shift()!
      const reg = this.register ?? new Uint8Array(this.reportSize)
      this.featureReplies.set(reportId, reg.subarray(1))
    }
    return super.receiveFeatureReport(reportId)
  }

  /** Concatenate reply packets (they may be chunks) and cut them into whole reports. */
  private toReports(packets: readonly Uint8Array[]): Uint8Array[] {
    const total = packets.reduce((n, p) => n + p.length, 0)
    const all = new Uint8Array(total)
    let pos = 0
    for (const p of packets) {
      all.set(p, pos)
      pos += p.length
    }
    const out: Uint8Array[] = []
    for (let i = 0; i < all.length; i += this.reportSize) {
      const r = new Uint8Array(this.reportSize)
      r.set(all.subarray(i, i + this.reportSize))
      out.push(r)
    }
    return out
  }
}

/**
 * A FakeFeatureHidDevice answering with a DeviceSimulator (VID/PID from `sim.info`). The simulator's chunk fault is
 * irrelevant here (feature reports are atomic: chunks are re-joined into reports); its dropReplies fault leaves the
 * register unchanged, so GET returns the previous reply, which is what real hardware would do.
 */
export function fakeFeatureDeviceFor(sim: DeviceSimulator, o: FakeFeatureHidDeviceOptions = {}): FakeFeatureHidDevice {
  return new FakeFeatureHidDevice({
    vendorId: sim.info.vendorId,
    productId: sim.info.productId,
    productName: sim.info.productName,
    ...o,
    respond: o.respond ?? ((frame) => sim.respond(frame)),
  })
}
