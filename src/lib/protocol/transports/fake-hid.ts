/**
 * WebHID test double (docs/FAMILIES.md §5.4): a `HIDDevice` with configurable collections that
 * records `sendReport` / `sendFeatureReport`, answers `receiveFeatureReport` with or without the
 * report-id byte, and fires `inputreport` events; plus a `navigator.hid` double with
 * requestDevice / getDevices / connect / disconnect.
 *
 *   const dev = new FakeHidDevice({ vendorId: 0x3547, productId: 0x0411, collections: A2_COLLECTIONS })
 *   const hid = new FakeHid([dev]); vi.stubGlobal('navigator', { hid })
 *   dev.onOutput = (r) => dev.emitInput(0xbb, reply.subarray(1))     // answer like the A2
 *
 * Runs in Node (uses the global EventTarget / Event). Never imported by the app at run time.
 */

/** One recorded host → device report. `data` excludes the report-id byte, exactly as passed to WebHID. */
export interface FakeHidReport {
  kind: 'output' | 'feature'
  reportId: number
  data: Uint8Array
}

export interface FakeHidDeviceOptions {
  vendorId: number
  productId: number
  productName?: string
  collections?: HIDCollectionInfo[]
  /** receiveFeatureReport() includes the report id as byte 0 (Chromium usually does; a1-6108.md §2.3). Default true. */
  featureIncludesReportId?: boolean
  /** Reject sendReport() for report ids the descriptor does not declare (Windows-like strictness). Default false. */
  strictReportIds?: boolean
  /** Reject sendReport() whose data length differs from the declared size. Default false. */
  strictSizes?: boolean
}

/** A report declaration of `bytes` data bytes (8-bit items), for building fake collections. */
// The annotation lets bundlers drop the unused collection constants below (no app chunk needs these fakes).
/* @__NO_SIDE_EFFECTS__ */
export function declaredReport(reportId: number, bytes: number): HIDReportInfo {
  return { reportId, items: [{ reportSize: 8, reportCount: bytes, usages: [0xff000001] }] }
}

/** Vendor collection helper. */
/* @__NO_SIDE_EFFECTS__ */
export function vendorCollection(
  usagePage: number,
  o: { input?: HIDReportInfo[]; output?: HIDReportInfo[]; feature?: HIDReportInfo[]; usage?: number } = {},
): HIDCollectionInfo {
  return {
    usagePage, usage: o.usage ?? 1, type: 1, children: [],
    inputReports: o.input ?? [], outputReports: o.output ?? [], featureReports: o.feature ?? [],
  }
}

/**
 * LARK A2 layout (PROTOCOL.md §11.1): control collection 0xFF82 with 63-byte report 0x41 in and
 * out, OTA collection 0xFF90 with report 0x55. The frame magics 0xAA / 0xBB are NOT declared.
 */
export const A2_COLLECTIONS: HIDCollectionInfo[] = [
  vendorCollection(0xff82, { input: [declaredReport(0x41, 63)], output: [declaredReport(0x41, 63)] }),
  vendorCollection(0xff90, { output: [declaredReport(0x55, 63)] }),
]

/** LARK M3 guess (m3-6303.md §2.3): report 8, 63 data bytes in and out. */
export const M3_COLLECTIONS_63: HIDCollectionInfo[] = [vendorCollection(0xff00, { input: [declaredReport(8, 63)], output: [declaredReport(8, 63)] })]
/** LARK M3 guess: report 8, 511 data bytes in and out (high-speed endpoint). */
export const M3_COLLECTIONS_511: HIDCollectionInfo[] = [vendorCollection(0xff00, { input: [declaredReport(8, 511)], output: [declaredReport(8, 511)] })]
/** LARK A1 guess (a1-6108.md §2.1): Feature 5 = 63 data bytes, Feature 6 (OTA) = 159. */
export const A1_COLLECTIONS: HIDCollectionInfo[] = [vendorCollection(0xff00, { feature: [declaredReport(5, 63), declaredReport(6, 159)] })]
/** A device without report ids: 64-byte input and output report 0 (e.g. a guess for MELO P1 USB). */
export const NO_ID_COLLECTIONS_64: HIDCollectionInfo[] = [vendorCollection(0xff00, { input: [declaredReport(0, 64)], output: [declaredReport(0, 64)] })]

function bytesOf(src: BufferSource): Uint8Array {
  if (src instanceof ArrayBuffer) return new Uint8Array(src.slice(0))
  const v = src as ArrayBufferView
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice()
}

function declared(cols: readonly HIDCollectionInfo[] | undefined, kind: 'inputReports' | 'outputReports' | 'featureReports', id: number): HIDReportInfo | undefined {
  for (const c of cols ?? []) {
    const r = (c[kind] ?? []).find((x) => (x.reportId ?? 0) === id)
    if (r) return r
    const inner = declared(c.children, kind, id)
    if (inner) return inner
  }
  return undefined
}

function sizeOf(r: HIDReportInfo): number {
  let bits = 0
  for (const it of r.items ?? []) bits += (it.reportSize ?? 0) * (it.reportCount ?? 0)
  return Math.ceil(bits / 8)
}

/** `inputreport` event shaped like Chrome's HIDInputReportEvent. */
export class FakeHidInputReportEvent extends Event {
  readonly device: HIDDevice
  readonly reportId: number
  readonly data: DataView
  constructor(device: HIDDevice, reportId: number, data: Uint8Array) {
    super('inputreport')
    this.device = device
    this.reportId = reportId
    const copy = data.slice()
    this.data = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  }
}

export class FakeHidConnectionEvent extends Event {
  readonly device: HIDDevice
  constructor(type: 'connect' | 'disconnect', device: HIDDevice) {
    super(type)
    this.device = device
  }
}

/**
 * Structurally a `HIDDevice` (the DOM class cannot be extended in Node). Pass `fake.hid` where
 * a `HIDDevice` is expected.
 */
export class FakeHidDevice extends EventTarget {
  oninputreport: ((this: HIDDevice, ev: HIDInputReportEvent) => unknown) | null = null
  readonly vendorId: number
  readonly productId: number
  readonly productName: string
  readonly collections: HIDCollectionInfo[]
  featureIncludesReportId: boolean
  strictReportIds: boolean
  strictSizes: boolean
  /** Every host → device report, in order. */
  readonly sent: FakeHidReport[] = []
  /** Called for every output report (answer with emitInput). */
  onOutput: ((r: FakeHidReport) => void) | null = null
  /** Called for every feature SET (update `featureReplies`). */
  onFeature: ((r: FakeHidReport) => void) | null = null
  /** What receiveFeatureReport(id) returns next (data bytes without the id). */
  readonly featureReplies = new Map<number, Uint8Array>()
  /** Make the next calls fail (e.g. "NotAllowedError: Failed to write the report"). */
  failNext: { op: 'sendReport' | 'sendFeatureReport' | 'receiveFeatureReport' | 'open'; error: Error } | null = null
  private opened_ = false

  constructor(o: FakeHidDeviceOptions) {
    super()
    this.vendorId = o.vendorId
    this.productId = o.productId
    this.productName = o.productName ?? 'Wireless Microphone (fake)'
    this.collections = o.collections ?? []
    this.featureIncludesReportId = o.featureIncludesReportId ?? true
    this.strictReportIds = o.strictReportIds ?? false
    this.strictSizes = o.strictSizes ?? false
  }

  get opened(): boolean {
    return this.opened_
  }

  /** This fake typed as the DOM `HIDDevice`. */
  get hid(): HIDDevice {
    return this as unknown as HIDDevice
  }

  async open(): Promise<void> {
    this.takeFailure('open')
    this.opened_ = true
  }

  async close(): Promise<void> {
    this.opened_ = false
  }

  async forget(): Promise<void> {
    this.opened_ = false
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    if (!this.opened_) throw new DOMException('The device must be opened first.', 'InvalidStateError')
    this.takeFailure('sendReport')
    const bytes = bytesOf(data)
    this.checkDeclared('outputReports', reportId, bytes.length)
    const r: FakeHidReport = { kind: 'output', reportId, data: bytes }
    this.sent.push(r)
    this.onOutput?.(r)
  }

  async sendFeatureReport(reportId: number, data: BufferSource): Promise<void> {
    if (!this.opened_) throw new DOMException('The device must be opened first.', 'InvalidStateError')
    this.takeFailure('sendFeatureReport')
    const bytes = bytesOf(data)
    this.checkDeclared('featureReports', reportId, bytes.length)
    const r: FakeHidReport = { kind: 'feature', reportId, data: bytes }
    this.sent.push(r)
    this.onFeature?.(r)
  }

  async receiveFeatureReport(reportId: number): Promise<DataView> {
    if (!this.opened_) throw new DOMException('The device must be opened first.', 'InvalidStateError')
    this.takeFailure('receiveFeatureReport')
    const decl = declared(this.collections, 'featureReports', reportId)
    const size = decl ? sizeOf(decl) : (this.featureReplies.get(reportId)?.length ?? 0)
    const body = new Uint8Array(size)
    body.set((this.featureReplies.get(reportId) ?? new Uint8Array(0)).subarray(0, size))
    const out = this.featureIncludesReportId ? Uint8Array.of(reportId, ...body) : body
    return new DataView(out.buffer, out.byteOffset, out.byteLength)
  }

  /** Device → host input report (data excludes the id byte, as Chrome delivers it). */
  emitInput(reportId: number, data: ArrayLike<number>): void {
    const ev = new FakeHidInputReportEvent(this.hid, reportId, Uint8Array.from(data))
    this.oninputreport?.call(this.hid, ev as unknown as HIDInputReportEvent)
    this.dispatchEvent(ev)
  }

  /** Last output report sent, or undefined. */
  get lastOutput(): FakeHidReport | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].kind === 'output') return this.sent[i]
    return undefined
  }

  private takeFailure(op: NonNullable<FakeHidDevice['failNext']>['op']): void {
    if (this.failNext?.op === op) {
      const e = this.failNext.error
      this.failNext = null
      throw e
    }
  }

  private checkDeclared(kind: 'outputReports' | 'featureReports', reportId: number, length: number): void {
    const decl = declared(this.collections, kind, reportId)
    if (!decl) {
      if (this.strictReportIds) throw new DOMException(`Failed to write the report: id ${reportId} is not declared.`, 'NotAllowedError')
      return
    }
    if (this.strictSizes && sizeOf(decl) !== length) {
      throw new DOMException(`Failed to write the report: ${length} bytes for a ${sizeOf(decl)}-byte report.`, 'NotAllowedError')
    }
  }
}

/** `navigator.hid` double (structurally a `HID`; use `fake.hidApi` where the DOM type is expected). */
export class FakeHid extends EventTarget {
  onconnect: ((this: HID, ev: Event) => unknown) | null = null
  ondisconnect: ((this: HID, ev: Event) => unknown) | null = null
  /** Devices plugged in. */
  readonly devices: FakeHidDevice[]
  /** Devices this origin was granted (getDevices()). */
  readonly granted = new Set<FakeHidDevice>()
  /** Filters passed to every requestDevice() call. */
  readonly requests: HIDDeviceFilter[][] = []
  /** What the chooser returns: by default the first plugged device matching the filters (and it is granted). */
  choose: ((filters: HIDDeviceFilter[], devices: readonly FakeHidDevice[]) => FakeHidDevice[]) | null = null

  constructor(devices: FakeHidDevice[] = []) {
    super()
    this.devices = [...devices]
  }

  /** This fake typed as the DOM `HID` (for `navigator.hid`). */
  get hidApi(): HID {
    return this as unknown as HID
  }

  async getDevices(): Promise<HIDDevice[]> {
    return this.devices.filter((d) => this.granted.has(d)).map((d) => d.hid)
  }

  async requestDevice(options?: HIDDeviceRequestOptions): Promise<HIDDevice[]> {
    const filters = options?.filters ?? []
    this.requests.push(filters)
    const picked = this.choose ? this.choose(filters, this.devices) : this.devices.filter((d) => matchesFilters(d.hid, filters)).slice(0, 1)
    for (const d of picked) this.granted.add(d)
    return picked.map((d) => d.hid)
  }

  /** Simulate plugging a device in (fires 'connect' when it is granted). */
  plug(d: FakeHidDevice, grant = false): void {
    if (!this.devices.includes(d)) this.devices.push(d)
    if (grant) this.granted.add(d)
    if (this.granted.has(d)) this.dispatchEvent(new FakeHidConnectionEvent('connect', d.hid))
  }

  /** Simulate an unplug (fires 'disconnect'). */
  unplug(d: FakeHidDevice): void {
    const i = this.devices.indexOf(d)
    if (i >= 0) this.devices.splice(i, 1)
    void d.close()
    this.dispatchEvent(new FakeHidConnectionEvent('disconnect', d.hid))
  }
}

/** WebHID filter semantics: empty list matches everything; each filter's fields must all match. */
export function matchesFilters(d: HIDDevice, filters: readonly HIDDeviceFilter[]): boolean {
  if (filters.length === 0) return true
  return filters.some(
    (f) =>
      (f.vendorId === undefined || f.vendorId === d.vendorId) &&
      (f.productId === undefined || f.productId === d.productId) &&
      (f.usagePage === undefined || (d.collections ?? []).some((c) => c.usagePage === f.usagePage)) &&
      (f.usage === undefined || (d.collections ?? []).some((c) => c.usage === f.usage)),
  )
}
