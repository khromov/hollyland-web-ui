/**
 * WebHID transport (Chromium-based browsers). See docs/PROTOCOL.md §2.
 *
 * Mapping ("raw" framing, matches the Android app byte for byte):
 *   wire packet  AA DD cmd dst lenHi lenLo payload… (64 bytes)
 *   WebHID       device.sendReport(0xAA, packet[1..63])   // report id = first wire byte
 *   reply        inputreport { reportId: 0xBB, data: DD cmd src lenHi lenLo payload… }
 *                -> packet = [0xBB, ...data]
 *
 * The A2 descriptor does not declare report ids 0xAA / 0xBB. Writes work everywhere we
 * tested (macOS IOHIDFamily forwards undeclared output ids to the interrupt-OUT pipe), but
 * macOS drops undeclared INPUT report ids before any user-space client sees them (verified on
 * the live A2: the HID driver's InputReportCount grows by 2 per request while no report
 * reaches IOHIDDeviceRegisterInputReportCallback, even with the device seized). Linux/ChromeOS
 * (hidraw) deliver raw reports and are expected to work. Windows is unverified.
 *
 * Generalized for the other families (docs/FAMILIES.md §3.4): `send(frame)` takes one complete
 * frame; the data part is zero padded to the output report size the descriptor declares for that
 * report id (`device.collections[].outputReports[].items`), falling back to the registry link's
 * frame sizes and then to 63 data bytes for undeclared ids, which keeps the A2 bytes
 * (`sendReport(0xAA, 63 B)`) exactly as before. M3: report id 8, 63 or 511 data bytes.
 */
import { BaseTransport, TransportError, type TransportCapabilities, type TransportDeviceInfo } from './transport'
import {
  EAGLESHERO_VENDOR_ID, HOLLYLAND_VENDOR_ID, PRODUCTS, isConnectableProduct, isKnownVendorId, lookupProduct, webHidLinkOf,
  type ProductInfo,
} from './models'
import { PACKET_SIZE } from './codec'
import type { WebHidLinkSpec } from './core/types'

/** Vendor collection holding 63-byte IN/OUT report 0x41 on the A2 (the control channel). */
export const CONTROL_USAGE_PAGE = 0xff82
/** Vendor collection holding report 0x55 (firmware-upload data). */
export const OTA_USAGE_PAGE = 0xff90
export const A2_DECLARED_CONTROL_REPORT_ID = 0x41

/**
 * Default chooser filters: the A2's control collection + every other connectable PID with an
 * interrupt HID link (descriptors of the M2/M2S are unknown). Rows of stub families are
 * 'recognised' and not connectable, so today this is the A2 collection plus the M2/M2S PIDs.
 */
export function defaultFilters(): HIDDeviceFilter[] {
  return [{ vendorId: HOLLYLAND_VENDOR_ID, usagePage: CONTROL_USAGE_PAGE }, ...filtersForProducts(PRODUCTS, { skipFamilies: ['6118'] })]
}

/**
 * `{ vendorId, productId }` filters for the connectable products with an interrupt HID link.
 * WebHID cannot filter on a productId without a vendorId, so rows whose VID is unconfirmed
 * (`vendorIdConfirmed: false`) use the assumed VID; offer `anyHidDeviceFilters()` as a fallback.
 */
export function filtersForProducts(
  products: readonly ProductInfo[],
  o: { skipFamilies?: readonly string[]; includeRecognised?: boolean } = {},
): HIDDeviceFilter[] {
  const out: HIDDeviceFilter[] = []
  for (const p of products) {
    if (p.idKind === 'app') continue
    if (!o.includeRecognised && !isConnectableProduct(p)) continue
    if (o.skipFamilies?.includes(p.familyCode ?? p.family ?? '')) continue
    if (!webHidLinkOf(p)) continue
    out.push({ vendorId: p.vendorId, productId: p.productId })
  }
  return out
}

/** "Show all HID devices": the chooser fallback for products whose vendor id is unconfirmed (FAMILIES.md §3.4). */
export function anyHidDeviceFilters(): HIDDeviceFilter[] {
  return []
}

/** Connectable products whose vendor id the official app never checks (the chooser needs the fallback). */
export function productsNeedingVidFallback(products: readonly ProductInfo[] = PRODUCTS): ProductInfo[] {
  return products.filter((p) => p.idKind !== 'app' && p.vendorIdConfirmed === false && isConnectableProduct(p) && !!webHidLinkOf(p))
}

/**
 * Whether a HID device belongs to us: a Hollyland / EAGLESHERO vendor id, or the PID of a
 * connectable product whose vendor id is unconfirmed.
 */
export function isKnownHidDevice(d: { vendorId: number; productId: number }): boolean {
  if (d.vendorId === HOLLYLAND_VENDOR_ID || d.vendorId === EAGLESHERO_VENDOR_ID) return true
  return productsNeedingVidFallback().some((p) => p.productId === d.productId)
}

/** The registry's interrupt link for a VID/PID (an unconfirmed-VID row matches by PID alone). */
export function hidLinkFor(vendorId: number, productId: number): WebHidLinkSpec | undefined {
  const p = lookupProduct(vendorId, productId) ??
    (isKnownVendorId(vendorId) ? undefined : PRODUCTS.find((x) => x.vendorIdConfirmed === false && x.productId === productId))
  return p ? webHidLinkOf(p) : undefined
}

export type WebHidFraming =
  /** sendReport(packet[0], packet[1..63]); inputreport id 0xBB -> [0xBB, ...data]. Default. */
  | 'raw'
  /** Experimental: sendReport(0x41, packet[0..62]). The live A2 does NOT answer this (§11). */
  | 'report41'
  /** Device without report ids: sendReport(0, packet). */
  | 'no-report-id'

export interface WebHidTransportOptions {
  framing?: WebHidFraming
  /**
   * Report layout of the product (default: the registry row for the device's VID/PID). Used for
   * frame sizes when the descriptor does not declare the report id, and to check that a numbered
   * report id (M3: 8) matches byte 0 of every frame.
   */
  link?: WebHidLinkSpec
}

export function isWebHidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator && !!navigator.hid
}

function platformName(): string {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { userAgentData?: { platform?: string } }) : undefined
  return (nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '').toLowerCase()
}

/** Best guess whether replies can be received, from platform + descriptor (PROTOCOL.md §2.4). */
export function guessReceiveCapability(usesReportIds: boolean): TransportCapabilities['receive'] {
  if (!usesReportIds) return 'unknown'
  const p = platformName()
  if (p.includes('mac')) return 'no'
  return 'unknown'
}

function collectionUsesReportIds(c: HIDCollectionInfo): boolean {
  const reports = [...(c.inputReports ?? []), ...(c.outputReports ?? []), ...(c.featureReports ?? [])]
  return reports.some((r) => (r.reportId ?? 0) !== 0)
}

/** Find the vendor collection used for control traffic. */
export function findControlCollection(device: HIDDevice): HIDCollectionInfo | undefined {
  const cols = device.collections ?? []
  return (
    cols.find((c) => c.usagePage === CONTROL_USAGE_PAGE) ??
    cols.find((c) => (c.usagePage ?? 0) >= 0xff00 && (c.outputReports?.length ?? 0) > 0) ??
    cols.find((c) => (c.outputReports?.length ?? 0) > 0)
  )
}

export function deviceUsesReportIds(device: HIDDevice): boolean {
  return (device.collections ?? []).some(collectionUsesReportIds)
}

/** Byte length of one declared report (sum of reportSize × reportCount over its items, rounded up). */
export function reportByteLength(r: HIDReportInfo): number {
  let bits = 0
  for (const it of r.items ?? []) bits += (it.reportSize ?? 0) * (it.reportCount ?? 0)
  return Math.ceil(bits / 8)
}

function declaredReportSize(device: HIDDevice, kind: 'outputReports' | 'inputReports' | 'featureReports', reportId: number): number | undefined {
  const visit = (cols: readonly HIDCollectionInfo[] | undefined): number | undefined => {
    for (const c of cols ?? []) {
      for (const r of c[kind] ?? []) {
        if ((r.reportId ?? 0) === reportId) {
          const n = reportByteLength(r)
          if (n > 0) return n
        }
      }
      const inner = visit(c.children)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  return visit(device.collections)
}

/** Data bytes (report id excluded) of the declared output report, or undefined when the id is not declared. */
export function outputReportSize(device: HIDDevice, reportId: number): number | undefined {
  return declaredReportSize(device, 'outputReports', reportId)
}

/** Data bytes of the declared input report, or undefined. */
export function inputReportSize(device: HIDDevice, reportId: number): number | undefined {
  return declaredReportSize(device, 'inputReports', reportId)
}

/** Data bytes of the declared feature report, or undefined. */
export function featureReportSize(device: HIDDevice, reportId: number): number | undefined {
  return declaredReportSize(device, 'featureReports', reportId)
}

export class WebHidTransport extends BaseTransport {
  readonly kind = 'webhid'
  readonly device: HIDDevice
  readonly framing: WebHidFraming
  /** The product's interrupt link (registry row or options.link), if known. */
  readonly link: WebHidLinkSpec | undefined
  capabilities: TransportCapabilities
  private readonly onInput = (e: HIDInputReportEvent) => this.handleInput(e)
  private readonly onHidDisconnect = (e: HIDConnectionEvent) => {
    if (e.device === this.device) {
      this.detach()
      this.emitDisconnect(new TransportError('device unplugged'))
    }
  }
  private attached = false

  constructor(device: HIDDevice, options: WebHidTransportOptions = {}) {
    super()
    this.device = device
    const usesIds = deviceUsesReportIds(device)
    this.framing = options.framing ?? (usesIds ? 'raw' : 'no-report-id')
    this.link = options.link ?? hidLinkFor(device.vendorId, device.productId)
    // A numbered report id that the descriptor declares for input (M3: 8) is delivered by every
    // OS; only undeclared ids (the A2's 0xBB) are dropped on macOS (PROTOCOL.md §2.4).
    const declaredReplyId = typeof this.link?.reportId === 'number' && inputReportSize(device, this.link.reportId) !== undefined
    this.capabilities = {
      receive: declaredReplyId ? 'unknown' : guessReceiveCapability(usesIds),
      link: 'interrupt',
      maxWrite: this.maxFrameLength(),
    }
  }

  /** Show the browser chooser (must be called from a user gesture). */
  static async request(filters: HIDDeviceFilter[] = defaultFilters(), options?: WebHidTransportOptions): Promise<WebHidTransport | null> {
    if (!isWebHidSupported()) throw new TransportError('WebHID is not available in this browser')
    const devices = await navigator.hid.requestDevice({ filters })
    const d = pickDevice(devices)
    return d ? new WebHidTransport(d, options) : null
  }

  /** Devices this origin was already granted (for silent auto-reconnect). */
  static async getGrantedDevices(): Promise<HIDDevice[]> {
    if (!isWebHidSupported()) return []
    const all = await navigator.hid.getDevices()
    return all.filter((d) => isKnownHidDevice(d))
  }

  /** First previously granted device, wrapped, or null. */
  static async reconnect(options?: WebHidTransportOptions): Promise<WebHidTransport | null> {
    const d = pickDevice(await WebHidTransport.getGrantedDevices())
    return d ? new WebHidTransport(d, options) : null
  }

  /** Listen for granted devices being plugged in. Returns an unsubscribe function. */
  static onDeviceConnect(listener: (device: HIDDevice) => void): () => void {
    if (!isWebHidSupported()) return () => undefined
    const h = (e: HIDConnectionEvent) => {
      if (isKnownHidDevice(e.device)) listener(e.device)
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
      id: `webhid:${this.device.vendorId.toString(16)}:${this.device.productId.toString(16)}`,
    }
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open()
    if (!this.attached) {
      this.device.addEventListener('inputreport', this.onInput)
      navigator.hid.addEventListener('disconnect', this.onHidDisconnect)
      this.attached = true
    }
    const c = findControlCollection(this.device)
    this.debug(
      `opened ${this.device.productName} ${this.info.id}, framing=${this.framing}, control collection usagePage=` +
        (c?.usagePage !== undefined ? '0x' + c.usagePage.toString(16) : 'none') +
        `, receive=${this.capabilities.receive}`,
    )
  }

  async close(): Promise<void> {
    this.detach()
    if (this.device.opened) await this.device.close()
  }

  async send(packet: Uint8Array): Promise<void> {
    if (!this.device.opened) throw new TransportError('device is not open')
    const max = this.maxFrameLength(packet[0])
    if (packet.length === 0 || packet.length > max) throw new TransportError(`packet length ${packet.length} not in 1..${max}`)
    let reportId: number
    let data: Uint8Array<ArrayBuffer>
    switch (this.framing) {
      case 'raw': {
        reportId = packet[0]
        const want = this.link?.reportId
        if (typeof want === 'number' && reportId !== want) {
          throw new TransportError(`frame starts with 0x${reportId.toString(16)}, but this product uses report id 0x${want.toString(16)}`)
        }
        data = new Uint8Array(this.dataSize(reportId, packet.length - 1))
        data.set(packet.subarray(1))
        break
      }
      case 'report41':
        reportId = A2_DECLARED_CONTROL_REPORT_ID
        data = new Uint8Array(PACKET_SIZE - 1)
        data.set(packet.subarray(0, PACKET_SIZE - 1))
        break
      case 'no-report-id':
        reportId = 0
        data = new Uint8Array(this.dataSize(0, packet.length))
        data.set(packet)
        break
    }
    try {
      await this.device.sendReport(reportId, data)
    } catch (e) {
      throw new TransportError(`sendReport(0x${reportId.toString(16)}) failed: ${(e as Error).message}`, { cause: e })
    }
  }

  /**
   * Data bytes to send for a report id: the declared output size; else the smallest registry frame
   * size that fits (minus the id byte for numbered framing); else today's 63 (64 without ids).
   */
  private dataSize(reportId: number, needed: number): number {
    const declared = outputReportSize(this.device, reportId)
    if (declared !== undefined) return declared
    const idByte = this.framing === 'no-report-id' ? 0 : 1
    const sizes = (this.link?.outSizes ?? []).map((n) => n - idByte).filter((n) => n >= needed).sort((a, b) => a - b)
    return sizes[0] ?? PACKET_SIZE - idByte
  }

  /** Largest frame (report id byte included for numbered framing) this device accepts. */
  private maxFrameLength(firstByte?: number): number {
    if (this.framing === 'report41') return PACKET_SIZE
    const idByte = this.framing === 'no-report-id' ? 0 : 1
    const ids = this.framing === 'no-report-id' ? [0] : firstByte !== undefined ? [firstByte] : this.declaredOutputIds()
    const declared = ids.map((id) => outputReportSize(this.device, id)).filter((n): n is number => n !== undefined)
    if (firstByte !== undefined && declared.length) return declared[0] + idByte
    const fromLink = Math.max(0, ...(this.link?.outSizes ?? []))
    return Math.max(PACKET_SIZE, fromLink, ...declared.map((n) => n + idByte))
  }

  private declaredOutputIds(): number[] {
    const ids: number[] = []
    const visit = (cols: readonly HIDCollectionInfo[] | undefined) => {
      for (const c of cols ?? []) {
        for (const r of c.outputReports ?? []) ids.push(r.reportId ?? 0)
        visit(c.children)
      }
    }
    visit(this.device.collections)
    return ids
  }

  private handleInput(e: HIDInputReportEvent): void {
    const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)
    let packet: Uint8Array
    if (e.reportId === 0) {
      packet = data.slice()
    } else if (e.reportId === A2_DECLARED_CONTROL_REPORT_ID && data[0] === 0xbb && data[1] === 0xdd) {
      packet = data.slice() // firmware wrapped the reply in report 0x41 (not observed)
    } else {
      packet = new Uint8Array(data.length + 1)
      packet[0] = e.reportId
      packet.set(data, 1)
    }
    if (packet[0] !== 0xbb) this.debug(`inputreport id=0x${e.reportId.toString(16)} (${data.length} bytes) is not a control reply`)
    this.emitPacket(packet)
  }

  private detach(): void {
    if (!this.attached) return
    this.device.removeEventListener('inputreport', this.onInput)
    if (isWebHidSupported()) navigator.hid.removeEventListener('disconnect', this.onHidDisconnect)
    this.attached = false
  }
}

/** Prefer a device that exposes the control collection. */
function pickDevice(devices: HIDDevice[]): HIDDevice | undefined {
  return devices.find((d) => (d.collections ?? []).some((c) => c.usagePage === CONTROL_USAGE_PAGE)) ?? devices[0]
}
