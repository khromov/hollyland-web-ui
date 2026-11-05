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
 */
import { BaseTransport, TransportError, type TransportCapabilities, type TransportDeviceInfo } from './transport'
import { HOLLYLAND_VENDOR_ID, EAGLESHERO_VENDOR_ID, PRODUCTS } from './models'
import { PACKET_SIZE } from './codec'

/** Vendor collection holding 63-byte IN/OUT report 0x41 on the A2 (the control channel). */
export const CONTROL_USAGE_PAGE = 0xff82
/** Vendor collection holding report 0x55 (firmware-upload data). */
export const OTA_USAGE_PAGE = 0xff90
export const A2_DECLARED_CONTROL_REPORT_ID = 0x41

/** Default chooser filters: the A2's control collection + every in-scope PID (descriptors of the M2/M2S are unknown). */
export function defaultFilters(): HIDDeviceFilter[] {
  const filters: HIDDeviceFilter[] = [{ vendorId: HOLLYLAND_VENDOR_ID, usagePage: CONTROL_USAGE_PAGE }]
  for (const p of PRODUCTS) {
    if (p.family && p.family !== '6118') filters.push({ vendorId: p.vendorId, productId: p.productId })
  }
  return filters
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

export class WebHidTransport extends BaseTransport {
  readonly kind = 'webhid'
  readonly device: HIDDevice
  readonly framing: WebHidFraming
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
    this.capabilities = { receive: guessReceiveCapability(usesIds) }
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
    return all.filter((d) => d.vendorId === HOLLYLAND_VENDOR_ID || d.vendorId === EAGLESHERO_VENDOR_ID)
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
      if (e.device.vendorId === HOLLYLAND_VENDOR_ID || e.device.vendorId === EAGLESHERO_VENDOR_ID) listener(e.device)
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
    if (packet.length === 0 || packet.length > PACKET_SIZE) throw new TransportError(`packet length ${packet.length} not in 1..64`)
    let reportId: number
    let data: Uint8Array<ArrayBuffer>
    switch (this.framing) {
      case 'raw':
        reportId = packet[0]
        data = new Uint8Array(PACKET_SIZE - 1)
        data.set(packet.subarray(1, PACKET_SIZE))
        break
      case 'report41':
        reportId = A2_DECLARED_CONTROL_REPORT_ID
        data = new Uint8Array(PACKET_SIZE - 1)
        data.set(packet.subarray(0, PACKET_SIZE - 1))
        break
      case 'no-report-id':
        reportId = 0
        data = new Uint8Array(PACKET_SIZE)
        data.set(packet)
        break
    }
    try {
      await this.device.sendReport(reportId, data)
    } catch (e) {
      throw new TransportError(`sendReport(0x${reportId.toString(16)}) failed: ${(e as Error).message}`, { cause: e })
    }
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
