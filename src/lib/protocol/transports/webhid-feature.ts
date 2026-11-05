/**
 * WebHidFeatureTransport: a request/response link over HID feature reports (LARK A1, docs/FAMILIES.md §3.4,
 * docs/research/families/a1-6108.md §2).
 *
 * The A1 never uses interrupt endpoints for control. Every command is a SET_REPORT(Feature, id 5) control transfer
 * followed at once by a GET_REPORT(Feature, id 5) that returns the reply:
 *  - A usbmic/core/USBHIDService.onEventMainThread(USBDataSendEvent): UsbTransferType.CONTROL for productId 1031,
 *    CommandExecutionConfig(3000L write, 1000L read) for 1031
 *  - A usb/core/HlUsbManagerImpl.executeControlTransfer: controlTransfer(0x21, 9 SET_REPORT, wValue 0x0305, 0, buf, 64)
 *    then, with no delay, controlTransfer(0xA1, 1 GET_REPORT, 0x0305, 0, buf, 64); the reply is dispatched only when
 *    exactly 64 bytes come back; no retry; one command at a time (usb/core/queue/UsbCommandQueue)
 *  - A application/common/manager/UsbHandlerManager: REPORT_ID_NORMAL 0x0305, REPORT_ID_UPGRADE 0x0306 (OTA,
 *    160 bytes). This transport never switches to the OTA report.
 *
 * WebHID mapping:
 *   send(frame)     frame = [reportId, …data] exactly as the family builder produces it (A1: 64 bytes)
 *   SET_REPORT      device.sendFeatureReport(reportId, frame[1..] zero padded to the declared size, else size - 1)
 *   GET_REPORT      device.receiveFeatureReport(reportId) → DataView, with or without the id byte depending on the
 *                   backend (a1-6108.md §2.3); normalised to exactly `size` bytes with the id at byte 0
 *   onPacket        the normalised report, emitted before send() resolves (FAMILIES.md §3.4: synchronous transport)
 *
 * Stale replies: GET_REPORT can return the previous reply if the firmware is slow. The command echoed at offset 4
 * is compared with the request's; on a mismatch the GET is repeated once (configurable) and a reply that still does
 * not match is dropped (a debug note, no packet), so the engine times out instead of applying old data. A GET that
 * fails (e.g. Chrome refusing an undeclared feature report on macOS/Windows) also emits nothing: the engine's probe
 * then decides `rx: 'unavailable'` and writes can still go out blind, because the SET itself succeeded.
 *
 * Nothing here has run against an A1: the feature-report declaration is unverified (a1-6108.md §8 #1).
 */
import { PRODUCTS, lookupProduct, linksOf, isConnectableProduct, isKnownVendorId, type ProductInfo } from '../models'
import { BaseTransport, TransportError, type TransportCapabilities, type TransportDeviceInfo } from '../transport'
import { featureReportSize, isWebHidSupported } from '../webhid'
import type { WebHidFeatureLinkSpec } from '../core/types'

export { FakeFeatureHidDevice, fakeFeatureDeviceFor } from './fake-hid-feature'
export type { FakeFeatureHidDeviceOptions } from './fake-hid-feature'

/** The A1 link (a1-6108.md §2.1), used when neither the options nor the registry give one. */
export const A1_FEATURE_LINK: WebHidFeatureLinkSpec = { kind: 'webhid-feature', reportId: 5, size: 64, otaReportId: 6 }

/** Android's timeouts for PID 1031 (A USBHIDService.onEventMainThread: CommandExecutionConfig(3000L, 1000L)). */
export const FEATURE_WRITE_TIMEOUT_MS = 3000
export const FEATURE_READ_TIMEOUT_MS = 1000

export interface WebHidFeatureTransportOptions {
  /** Report layout (default: the registry row for the device's VID/PID, else A1_FEATURE_LINK). */
  link?: WebHidFeatureLinkSpec
  /** SET_REPORT timeout (default 3000 ms, as Android). */
  writeTimeoutMs?: number
  /** GET_REPORT timeout (default 1000 ms, as Android). */
  readTimeoutMs?: number
  /** Extra GET_REPORTs when the echoed command differs from the request's (default 1, a1-6108.md §2.3). */
  staleRetries?: number
  /** Pause before a repeated GET (default 20 ms; a library choice, the apps do not repeat GETs). */
  staleRetryDelayMs?: number
  /**
   * Whether a reply belongs to the request (default: the bytes at `commandOffset` are equal). Both arguments include
   * the report id at byte 0.
   */
  matchReply?: (request: Uint8Array, reply: Uint8Array) => boolean
  /** Command offset for the default matchReply (A1: 4, A ProtocolV2.getData / parse). */
  commandOffset?: number
}

/** How the last GET_REPORT came back (for the hardware check, FAMILIES.md §5.7 row 6108). */
export interface FeatureReplyLayout {
  /** DataView length as Chrome returned it. */
  byteLength: number
  /** Whether the DataView started with the report id byte. */
  includedReportId: boolean
}

export interface FeatureTransferStats {
  sets: number
  gets: number
  /** GETs whose command did not match the request (stale or empty). */
  staleGets: number
  /** Requests whose reply was dropped after the retries. */
  droppedReplies: number
  /** GETs that failed or timed out. */
  failedGets: number
}

/** The registry's feature link of a VID/PID, if any. */
export function featureLinkFor(vendorId: number, productId: number): WebHidFeatureLinkSpec | undefined {
  const p = lookupProduct(vendorId, productId)
  return p ? featureLinkOf(p) : undefined
}

/** A product row's feature-report link, if any. */
export function featureLinkOf(p: ProductInfo): WebHidFeatureLinkSpec | undefined {
  return linksOf(p).find((l): l is WebHidFeatureLinkSpec => l.kind === 'webhid-feature')
}

/**
 * `{ vendorId, productId }` chooser filters for rows with a feature-report link. By default only connectable rows
 * (their driver is past the stub); `includeRecognised` adds recognised-only rows (hardware checks, diagnostics).
 */
export function featureLinkFilters(products: readonly ProductInfo[] = PRODUCTS, o: { includeRecognised?: boolean } = {}): HIDDeviceFilter[] {
  return products
    .filter((p) => p.idKind !== 'app' && !!featureLinkOf(p) && (o.includeRecognised || isConnectableProduct(p)))
    .map((p) => ({ vendorId: p.vendorId, productId: p.productId }))
}

function isFeatureDevice(d: { vendorId: number; productId: number }): boolean {
  return isKnownVendorId(d.vendorId) && !!featureLinkFor(d.vendorId, d.productId)
}

/** Prefer the HID interface that declares the feature report (an audio device may expose more than one). */
function pickFeatureDevice(devices: readonly HIDDevice[]): HIDDevice | undefined {
  const declares = (d: HIDDevice) => {
    const link = featureLinkFor(d.vendorId, d.productId) ?? A1_FEATURE_LINK
    return featureReportSize(d, link.reportId) !== undefined
  }
  return devices.find(declares) ?? devices[0]
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

class FeatureTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms} ms`)
    this.name = 'FeatureTimeoutError'
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  if (!(ms > 0)) return p
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new FeatureTimeoutError(what, ms)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

const isMagic = (b: Uint8Array, i: number) => (b[i] === 0xbb || b[i] === 0xaa) && b[i + 1] === 0xdd

/**
 * Normalise a receiveFeatureReport() result to exactly `size` bytes with the report id at byte 0
 * (a1-6108.md §2.3: Chromium usually includes the id, but it varies by backend). Decision order: the declared
 * data size (+1 with the id), then where the `BB DD` / `AA DD` magic sits, then whether byte 0 equals the id.
 */
export function normalizeFeatureReport(
  view: DataView,
  reportId: number,
  size: number,
  declaredDataSize?: number,
): { report: Uint8Array; layout: FeatureReplyLayout } {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  let included: boolean
  if (declaredDataSize !== undefined && bytes.length === declaredDataSize + 1 && bytes[0] === reportId) included = true
  else if (declaredDataSize !== undefined && bytes.length === declaredDataSize) included = false
  else if (isMagic(bytes, 2)) included = true
  else if (isMagic(bytes, 1)) included = false
  else included = bytes.length > 0 && bytes[0] === reportId
  const report = new Uint8Array(size)
  if (included) report.set(bytes.subarray(0, size))
  else {
    report[0] = reportId
    report.set(bytes.subarray(0, size - 1), 1)
  }
  return { report, layout: { byteLength: bytes.length, includedReportId: included } }
}

export class WebHidFeatureTransport extends BaseTransport {
  readonly kind = 'webhid-feature'
  readonly device: HIDDevice
  readonly link: WebHidFeatureLinkSpec
  capabilities: TransportCapabilities
  /** Layout of the last GET_REPORT (null before the first). */
  lastReplyLayout: FeatureReplyLayout | null = null
  /** The last normalised GET_REPORT result, matched or not (diagnostics: reply bytes 1–3, a1-6108.md §8 #2). */
  lastReport: Uint8Array | null = null
  readonly stats: FeatureTransferStats = { sets: 0, gets: 0, staleGets: 0, droppedReplies: 0, failedGets: 0 }
  private readonly writeTimeoutMs: number
  private readonly readTimeoutMs: number
  private readonly staleRetries: number
  private readonly staleRetryDelayMs: number
  private readonly matchReply: (request: Uint8Array, reply: Uint8Array) => boolean
  private chain: Promise<void> = Promise.resolve()
  private attached = false
  private readonly onHidDisconnect = (e: HIDConnectionEvent) => {
    if (e.device === this.device) {
      this.detach()
      this.emitDisconnect(new TransportError('device unplugged'))
    }
  }

  constructor(device: HIDDevice, options: WebHidFeatureTransportOptions = {}) {
    super()
    this.device = device
    this.link = options.link ?? featureLinkFor(device.vendorId, device.productId) ?? A1_FEATURE_LINK
    this.writeTimeoutMs = options.writeTimeoutMs ?? FEATURE_WRITE_TIMEOUT_MS
    this.readTimeoutMs = options.readTimeoutMs ?? FEATURE_READ_TIMEOUT_MS
    this.staleRetries = Math.max(0, options.staleRetries ?? 1)
    this.staleRetryDelayMs = options.staleRetryDelayMs ?? 20
    const off = options.commandOffset ?? 4
    this.matchReply = options.matchReply ?? ((req, rep) => rep.length > off && req[off] === rep[off])
    // Feature reports do not pass through the input-report filter that drops the A2's replies on macOS, but whether
    // Chrome can read report 5 depends on the descriptor declaring it (a1-6108.md §2.3): unverified, so 'unknown'.
    this.capabilities = { receive: 'unknown', link: 'feature', maxWrite: this.link.size }
  }

  /** Show the browser chooser (user gesture). Default filters: connectable products with a feature link. */
  static async request(filters: HIDDeviceFilter[] = featureLinkFilters(), options?: WebHidFeatureTransportOptions): Promise<WebHidFeatureTransport | null> {
    if (!isWebHidSupported()) throw new TransportError('WebHID is not available in this browser')
    // An empty list would show every HID device; refuse instead (pass explicit filters to override).
    if (!filters.length) throw new TransportError('no connectable product uses HID feature reports yet')
    const devices = await navigator.hid.requestDevice({ filters })
    const d = pickFeatureDevice(devices)
    return d ? new WebHidFeatureTransport(d, options) : null
  }

  /** Granted devices whose VID/PID has a feature-report link (any support level). */
  static async getGrantedDevices(): Promise<HIDDevice[]> {
    if (!isWebHidSupported()) return []
    return (await navigator.hid.getDevices()).filter(isFeatureDevice)
  }

  /** First granted feature-report device, wrapped, or null. */
  static async reconnect(options?: WebHidFeatureTransportOptions): Promise<WebHidFeatureTransport | null> {
    const d = pickFeatureDevice(await WebHidFeatureTransport.getGrantedDevices())
    return d ? new WebHidFeatureTransport(d, options) : null
  }

  /** Listen for granted feature-report devices being plugged in. Returns an unsubscribe function. */
  static onDeviceConnect(listener: (device: HIDDevice) => void): () => void {
    if (!isWebHidSupported()) return () => undefined
    const h = (e: HIDConnectionEvent) => {
      if (isFeatureDevice(e.device)) listener(e.device)
    }
    navigator.hid.addEventListener('connect', h)
    return () => navigator.hid.removeEventListener('connect', h)
  }

  get isOpen(): boolean {
    return this.device.opened
  }

  get info(): TransportDeviceInfo {
    return {
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      productName: this.device.productName,
      id: `webhid-feature:${this.device.vendorId.toString(16)}:${this.device.productId.toString(16)}`,
    }
  }

  /** Declared data bytes (id excluded) of the command report, or undefined when the descriptor does not declare it. */
  get declaredDataSize(): number | undefined {
    return featureReportSize(this.device, this.link.reportId)
  }

  /** Declared data bytes of every feature report (hardware check: "5 = 63 B? 6 = 159 B?"). */
  declaredFeatureReports(): { reportId: number; bytes: number }[] {
    const out: { reportId: number; bytes: number }[] = []
    const visit = (cols: readonly HIDCollectionInfo[] | undefined) => {
      for (const c of cols ?? []) {
        for (const r of c.featureReports ?? []) {
          const id = r.reportId ?? 0
          const n = featureReportSize(this.device, id)
          if (n !== undefined && !out.some((x) => x.reportId === id)) out.push({ reportId: id, bytes: n })
        }
        visit(c.children)
      }
    }
    visit(this.device.collections)
    return out
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open()
    if (!this.attached && isWebHidSupported()) {
      navigator.hid.addEventListener('disconnect', this.onHidDisconnect)
      this.attached = true
    }
    const declared = this.declaredFeatureReports()
    this.debug(
      `opened ${this.device.productName} ${this.info.id}: feature reports ` +
        (declared.length ? declared.map((r) => `${r.reportId}=${r.bytes} B`).join(', ') : 'none declared') +
        (this.declaredDataSize === undefined ? ` (report ${this.link.reportId} is not declared: Chrome may refuse GET_REPORT)` : ''),
    )
  }

  async close(): Promise<void> {
    this.detach()
    if (this.device.opened) await this.device.close()
  }

  /** SET_REPORT then GET_REPORT, serialised: one exchange at a time, like Android's command queue. */
  send(frame: Uint8Array): Promise<void> {
    const run = this.chain.then(() => this.exchange(frame))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async exchange(frame: Uint8Array): Promise<void> {
    if (!this.device.opened) throw new TransportError('device is not open')
    const id = this.link.reportId
    if (frame.length === 0) throw new TransportError('empty frame')
    if (this.link.otaReportId !== undefined && frame[0] === this.link.otaReportId) {
      throw new TransportError(`refusing report 0x${frame[0].toString(16)}: firmware-update reports are never sent`)
    }
    if (frame[0] !== id) throw new TransportError(`frame starts with 0x${frame[0].toString(16)}, but this link uses feature report ${id}`)
    const dataSize = this.declaredDataSize ?? this.link.size - 1
    if (frame.length - 1 > dataSize) throw new TransportError(`frame of ${frame.length} bytes does not fit feature report ${id} (${dataSize} data bytes)`)
    const data = new Uint8Array(dataSize)
    data.set(frame.subarray(1))
    try {
      this.stats.sets++
      await withTimeout(this.device.sendFeatureReport(id, data), this.writeTimeoutMs, `SET_REPORT(feature ${id})`)
    } catch (e) {
      throw new TransportError(`sendFeatureReport(${id}) failed: ${(e as Error).message}`, { cause: e })
    }
    const attempts = 1 + this.staleRetries
    for (let a = 0; a < attempts; a++) {
      if (a > 0 && this.staleRetryDelayMs > 0) await sleep(this.staleRetryDelayMs)
      let view: DataView
      try {
        this.stats.gets++
        view = await withTimeout(this.device.receiveFeatureReport(id), this.readTimeoutMs, `GET_REPORT(feature ${id})`)
      } catch (e) {
        // No packet: the engine times out (probe → rx 'unavailable'); the SET has gone out.
        this.stats.failedGets++
        this.debug(`receiveFeatureReport(${id}) failed: ${(e as Error).message}`)
        return
      }
      const { report, layout } = normalizeFeatureReport(view, id, this.link.size, this.declaredDataSize)
      this.lastReplyLayout = layout
      this.lastReport = report
      if (this.matchReply(frame, report)) {
        this.emitPacket(report)
        return
      }
      this.stats.staleGets++
      this.debug(`GET_REPORT(${id}) returned command 0x${(report[4] ?? 0).toString(16)} for request 0x${(frame[4] ?? 0).toString(16)} (stale or empty reply)`)
    }
    this.stats.droppedReplies++
    this.debug(`dropping the reply to 0x${(frame[4] ?? 0).toString(16)}: no matching GET_REPORT after ${attempts} attempt(s)`)
  }

  private detach(): void {
    if (!this.attached) return
    if (isWebHidSupported()) navigator.hid.removeEventListener('disconnect', this.onHidDisconnect)
    this.attached = false
  }
}
