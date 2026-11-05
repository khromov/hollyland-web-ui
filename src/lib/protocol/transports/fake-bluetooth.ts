/**
 * Web Bluetooth test double (docs/FAMILIES.md §5.4, §5.5): a `navigator.bluetooth` whose chooser
 * applies scan filters to fake advertisements, grants devices for `getDevices()`, and hands out
 * GATT servers whose characteristics record writes and deliver notifications in MTU-sized pieces
 * (MTU 23 / 185 / 512 → 20 / 182 / 509 bytes). A bridge puts any Transport, typically a family
 * simulator, behind a fake peripheral, so a FamilyDriver can run over the whole BLE stack:
 *
 *   const box = fakeMax2Box()                                  // registry link; FEE7 in service data only
 *   const bt = new FakeBluetooth([box]); vi.stubGlobal('navigator', { bluetooth: bt.api })
 *   const t = await WebBluetoothTransport.request({ includeRecognised: true })
 *
 *   const { transport } = bleSimulatedTransport(driver.createSimulator(p), p, { mtu: 23 })
 *   describeDriverConformance(bleBridgedDriver(driver, { mtu: 23 }))   // shared suite over BLE
 *
 * Chrome behaviour copied where the transport depends on it: the requestDevice() TypeErrors and
 * the "User cancelled" NotFoundError; services outside filters + optionalServices give
 * SecurityError (service-data filters do not grant their service); one GATT operation at a time
 * per characteristic ("GATT operation already in progress"); values > 512 B are refused; a write
 * without a matching property is NotSupportedError; `gatt.disconnect()` fires
 * `gattserverdisconnected` and cancels a pending connect(). Writes without response longer than
 * MTU − 3 are truncated by default (what most stacks do) and long writes with response are
 * accepted unless `longWrites` is false.
 *
 * Runs in Node (global EventTarget / Event / DOMException). Never imported by the app at run time.
 */
import { HOLLYLAND_VENDOR_ID, lookupAppProduct, lookupProduct, type ProductInfo } from '../models'
import { simulatedTransport } from '../core/simulate'
import type { BleUuid, DeviceSimulator, FamilyDriver, WebBluetoothLinkSpec } from '../core/types'
import type { Transport } from '../transport'
import {
  BLE_DEFAULT_ATT_MTU, BLE_MAX_ATTRIBUTE_LENGTH, BleFrameJoiner, bleLinkOf, canonicalBleUuid, WebBluetoothTransport,
  type BleCharacteristicProperties, type BleDeviceLike, type BleRequestDeviceOptions, type BleRequestFilter, type BluetoothApiLike,
  type WebBluetoothTransportOptions,
} from './web-bluetooth'

type BytesLike = ArrayLike<number> | ArrayBuffer | ArrayBufferView

function bytesOf(src: BytesLike): Uint8Array {
  if (src instanceof ArrayBuffer) return new Uint8Array(src.slice(0))
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength).slice()
  return Uint8Array.from(src as ArrayLike<number>)
}

const tick = () => Promise.resolve()

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name)
}

// ------------------------------------------------------------------------------ characteristic

/** One recorded host → device write. `delivered` is what reached the peripheral (after truncation). */
export interface FakeBleWrite {
  mode: 'with-response' | 'without-response'
  data: Uint8Array
  delivered: Uint8Array
}

export interface FakeBleCharacteristicInit {
  uuid: BleUuid
  properties: BleCharacteristicProperties
}

export interface FakeBleServiceInit {
  uuid: BleUuid
  characteristics: readonly FakeBleCharacteristicInit[]
}

/** Structurally a `BluetoothRemoteGATTCharacteristic`. Fires `characteristicvaluechanged`. */
export class FakeGattCharacteristic extends EventTarget {
  readonly uuid: string
  readonly properties: BleCharacteristicProperties
  readonly service: FakeGattService
  value: DataView | null = null
  /** startNotifications() succeeded and the link is still up. */
  notifying = false
  /** Every write, in order. */
  readonly writes: FakeBleWrite[] = []
  /** Make the next operation of this kind fail. */
  failNext: { op: 'write' | 'startNotifications'; error: Error } | null = null
  private busy = false
  private readonly writeListeners = new Set<(w: FakeBleWrite) => void>()

  constructor(service: FakeGattService, init: FakeBleCharacteristicInit) {
    super()
    this.service = service
    this.uuid = canonicalBleUuid(init.uuid)
    this.properties = { ...init.properties }
  }

  /** Called for every write the peripheral accepts. Returns an unsubscribe function. */
  onWrite(listener: (w: FakeBleWrite) => void): () => void {
    this.writeListeners.add(listener)
    return () => this.writeListeners.delete(listener)
  }

  async startNotifications(): Promise<FakeGattCharacteristic> {
    await this.begin('startNotifications')
    try {
      if (!this.properties.notify && !this.properties.indicate) throw domError('NotSupportedError', 'GATT operation not permitted.')
      this.notifying = true
      return this
    } finally {
      this.busy = false
    }
  }

  async stopNotifications(): Promise<FakeGattCharacteristic> {
    this.notifying = false
    return this
  }

  writeValueWithResponse(value: BufferSource): Promise<void> {
    return this.write(value, 'with-response')
  }

  writeValueWithoutResponse(value: BufferSource): Promise<void> {
    return this.write(value, 'without-response')
  }

  /** Deprecated Chrome API: with response when the characteristic allows it. */
  writeValue(value: BufferSource): Promise<void> {
    return this.write(value, this.properties.write ? 'with-response' : 'without-response')
  }

  /**
   * Device → host notification of one ATT payload (no splitting). Returns false when nobody is
   * subscribed or the link is down (the notification is lost, as on air).
   */
  emitValue(data: BytesLike): boolean {
    if (!this.notifying || !this.service.device.gatt.connected) return false
    const copy = bytesOf(data)
    this.value = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
    this.dispatchEvent(new Event('characteristicvaluechanged'))
    return true
  }

  private async begin(op: 'write' | 'startNotifications'): Promise<void> {
    this.service.device.gatt.ensureConnected('perform GATT operations')
    if (this.busy && this.service.device.strictGattQueue) throw domError('NetworkError', 'GATT operation already in progress.')
    this.busy = true
    if (this.failNext?.op === op) {
      const e = this.failNext.error
      this.failNext = null
      this.busy = false
      throw e
    }
    await tick()
    if (!this.service.device.gatt.connected) {
      this.busy = false
      throw domError('NetworkError', 'GATT Server is disconnected. Cannot perform GATT operations.')
    }
  }

  private async write(value: BufferSource, mode: FakeBleWrite['mode']): Promise<void> {
    await this.begin('write')
    try {
      const allowed = mode === 'with-response' ? this.properties.write : this.properties.writeWithoutResponse
      if (!allowed) throw domError('NotSupportedError', 'GATT operation not permitted.')
      const data = bytesOf(value)
      if (data.length > BLE_MAX_ATTRIBUTE_LENGTH) throw domError('InvalidModificationError', "Value can't exceed 512 bytes.")
      const device = this.service.device
      const payload = device.mtu - 3
      let delivered = data
      if (data.length > payload) {
        if (mode === 'without-response') {
          if (device.oversizeWithoutResponse === 'reject') throw domError('NotSupportedError', 'GATT operation failed for unknown reason.')
          delivered = data.slice(0, payload)
        } else if (!device.longWrites) {
          throw domError('NotSupportedError', 'GATT operation failed for unknown reason.')
        }
      }
      const w: FakeBleWrite = { mode, data, delivered }
      this.writes.push(w)
      for (const l of [...this.writeListeners]) l(w)
    } finally {
      this.busy = false
    }
  }
}

// ------------------------------------------------------------------------------------- service

/** Structurally a `BluetoothRemoteGATTService`. */
export class FakeGattService {
  readonly uuid: string
  readonly isPrimary = true
  readonly device: FakeBleDevice
  readonly characteristics: FakeGattCharacteristic[]

  constructor(device: FakeBleDevice, init: FakeBleServiceInit) {
    this.device = device
    this.uuid = canonicalBleUuid(init.uuid)
    this.characteristics = init.characteristics.map((c) => new FakeGattCharacteristic(this, c))
  }

  async getCharacteristic(uuid: string | number): Promise<FakeGattCharacteristic> {
    this.device.gatt.ensureConnected('retrieve characteristics')
    const c = canonicalBleUuid(uuid)
    const found = this.characteristics.find((x) => x.uuid === c)
    if (!found) throw domError('NotFoundError', `No Characteristics matching UUID ${c} found in Service with UUID ${this.uuid}.`)
    return found
  }

  async getCharacteristics(uuid?: string | number): Promise<FakeGattCharacteristic[]> {
    this.device.gatt.ensureConnected('retrieve characteristics')
    const list = uuid === undefined ? this.characteristics : this.characteristics.filter((x) => x.uuid === canonicalBleUuid(uuid))
    if (!list.length) throw domError('NotFoundError', `No Characteristics found in service ${this.uuid}.`)
    return [...list]
  }
}

// -------------------------------------------------------------------------------------- server

/** Structurally a `BluetoothRemoteGATTServer`. */
export class FakeGattServer {
  readonly device: FakeBleDevice
  connected = false
  private pendingConnect: ((e: Error) => void) | null = null

  constructor(device: FakeBleDevice) {
    this.device = device
  }

  async connect(): Promise<FakeGattServer> {
    const d = this.device
    d.connectCalls++
    if (this.connected) return this
    if (d.hangConnects > 0) {
      d.hangConnects--
      return new Promise<FakeGattServer>((_resolve, reject) => {
        this.pendingConnect = reject
      })
    }
    if (d.failConnects > 0) {
      d.failConnects--
      throw domError('NetworkError', 'Connection failed for unknown reason.')
    }
    if (!d.inRange) throw domError('NetworkError', 'Connection failed for unknown reason.')
    await tick()
    this.connected = true
    for (const l of [...d.connectListeners]) await l()
    return this
  }

  /** Host disconnect; also used for link loss (FakeBleDevice.dropConnection). Fires gattserverdisconnected. */
  disconnect(): void {
    if (this.pendingConnect) {
      const reject = this.pendingConnect
      this.pendingConnect = null
      reject(domError('AbortError', 'Connection attempt aborted by disconnect().'))
    }
    if (!this.connected) return
    this.connected = false
    for (const s of this.device.services) for (const c of s.characteristics) c.notifying = false
    for (const l of [...this.device.disconnectListeners]) l()
    this.device.dispatchEvent(new Event('gattserverdisconnected'))
  }

  async getPrimaryService(uuid: string | number): Promise<FakeGattService> {
    this.ensureConnected('retrieve services')
    const c = canonicalBleUuid(uuid)
    this.device.ensureAllowed(c)
    const s = this.device.services.find((x) => x.uuid === c)
    if (!s) throw domError('NotFoundError', `No Services matching UUID ${c} found in Device.`)
    return s
  }

  async getPrimaryServices(uuid?: string | number): Promise<FakeGattService[]> {
    this.ensureConnected('retrieve services')
    if (uuid !== undefined) return [await this.getPrimaryService(uuid)]
    const list = this.device.services.filter((s) => this.device.isAllowed(s.uuid))
    if (!list.length) throw domError('NotFoundError', 'No Services found in device.')
    return list
  }

  /** @internal */
  ensureConnected(what: string): void {
    if (!this.connected) throw domError('NetworkError', `GATT Server is disconnected. Cannot ${what}. (Re)connect first with \`device.gatt.connect\`.`)
  }
}

// -------------------------------------------------------------------------------------- device

export interface FakeBleAdvertisementInit {
  /** Service UUIDs in the advertisement's UUID list. */
  services?: readonly BleUuid[]
  /** Service data: [uuid, bytes] pairs. */
  serviceData?: readonly (readonly [BleUuid, readonly number[]])[]
  /** Manufacturer data: [company id, bytes] pairs. */
  manufacturerData?: readonly (readonly [number, readonly number[]])[]
}

export interface FakeBleDeviceOptions {
  id?: string
  /** Advertised name; null = none. */
  name?: string | null
  /** ATT MTU (default 23 → 20-byte payloads). */
  mtu?: number
  services?: readonly FakeBleServiceInit[]
  advertisement?: FakeBleAdvertisementInit
  /** Delay before each notification piece (default 0 = next task). */
  notifyLatencyMs?: number
}

let fakeDeviceSeq = 0

/** Structurally a `BluetoothDevice`. Fires `gattserverdisconnected` and `advertisementreceived`. */
export class FakeBleDevice extends EventTarget {
  readonly id: string
  name: string | null
  readonly gatt: FakeGattServer
  readonly services: FakeGattService[]
  readonly advertisement: {
    services: Set<string>
    serviceData: Map<string, Uint8Array>
    manufacturerData: Map<number, Uint8Array>
  }
  /** ATT MTU: notifications carry at most mtu − 3 bytes; writes without response are truncated beyond it. */
  mtu: number
  /** Advertising and connectable. */
  inRange = true
  /** Accept writes with response longer than mtu − 3 (ATT long write). Default true. */
  longWrites = true
  /** Writes without response longer than mtu − 3: 'truncate' (default) or 'reject'. */
  oversizeWithoutResponse: 'truncate' | 'reject' = 'truncate'
  /** Reject a second GATT operation on a characteristic while one is pending, like Chrome. Default true. */
  strictGattQueue = true
  /** The next N connect() calls fail with NetworkError. */
  failConnects = 0
  /** The next N connect() calls never settle until disconnect() (connect timeout tests). */
  hangConnects = 0
  /** Every connect() call. */
  connectCalls = 0
  /** watchAdvertisements() exists and works (Chrome's persistent permissions backend). Default true. */
  supportsWatchAdvertisements = true
  /** Delay before `advertisementreceived` while watching (default 5 ms). */
  advertisementDelayMs = 5
  notifyLatencyMs: number
  /** Services this origin may open: 'all' for devices not obtained through a chooser. */
  allowedServices: Set<string> | 'all' = 'all'
  forgotten = false
  /** @internal */ readonly connectListeners = new Set<() => void | Promise<void>>()
  /** @internal */ readonly disconnectListeners = new Set<() => void>()
  /** @internal */ owner: FakeBluetooth | null = null
  private watching = false
  private advTimer: ReturnType<typeof setTimeout> | null = null
  private deliveries: Promise<void> = Promise.resolve()

  constructor(o: FakeBleDeviceOptions = {}) {
    super()
    this.id = o.id ?? `fake-ble-${++fakeDeviceSeq}`
    this.name = o.name === undefined ? 'Fake BLE device' : o.name
    this.mtu = o.mtu ?? BLE_DEFAULT_ATT_MTU
    this.notifyLatencyMs = o.notifyLatencyMs ?? 0
    this.gatt = new FakeGattServer(this)
    this.services = (o.services ?? []).map((s) => new FakeGattService(this, s))
    const a = o.advertisement ?? {}
    this.advertisement = {
      services: new Set((a.services ?? []).map(canonicalBleUuid)),
      serviceData: new Map((a.serviceData ?? []).map(([u, b]) => [canonicalBleUuid(u), Uint8Array.from(b)] as const)),
      manufacturerData: new Map((a.manufacturerData ?? []).map(([id, b]) => [id, Uint8Array.from(b)] as const)),
    }
  }

  /** This fake typed as the structural `BluetoothDevice`. */
  get bluetoothDevice(): BleDeviceLike {
    return this
  }

  get watchingAdvertisements(): boolean {
    return this.watching
  }

  /** A characteristic by service and UUID (throws when absent). */
  characteristic(service: BleUuid, uuid: BleUuid): FakeGattCharacteristic {
    const s = this.services.find((x) => x.uuid === canonicalBleUuid(service))
    const c = s?.characteristics.find((x) => x.uuid === canonicalBleUuid(uuid))
    if (!c) throw new Error(`fake device ${this.id} has no characteristic ${uuid} in service ${service}`)
    return c
  }

  /** Called after every successful GATT connect (awaited by connect()). Returns an unsubscribe function. */
  onGattConnect(listener: () => void | Promise<void>): () => void {
    this.connectListeners.add(listener)
    return () => this.connectListeners.delete(listener)
  }

  /** Called on every GATT disconnect, host or link loss. Returns an unsubscribe function. */
  onGattDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  /**
   * Device → host data on a characteristic, split into MTU − 3 pieces, each delivered as its own
   * notification after `notifyLatencyMs`, in order. Resolves when the last piece was dispatched.
   */
  notify(service: BleUuid, uuid: BleUuid, data: BytesLike): Promise<void> {
    const c = this.characteristic(service, uuid)
    const bytes = bytesOf(data)
    const size = Math.max(1, this.mtu - 3)
    for (let i = 0; i < bytes.length; i += size) {
      const piece = bytes.slice(i, i + size)
      this.deliveries = this.deliveries.then(
        () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              c.emitValue(piece)
              resolve()
            }, this.notifyLatencyMs),
          ),
      )
    }
    return this.deliveries
  }

  /** Link loss (out of range, powered off): fires gattserverdisconnected like Chrome. */
  dropConnection(): void {
    this.gatt.disconnect()
  }

  /** Move in or out of range; coming back while watched fires an advertisement. */
  setInRange(inRange: boolean): void {
    this.inRange = inRange
    if (!inRange) this.dropConnection()
    else if (this.watching) this.scheduleAdvertisement()
  }

  async watchAdvertisements(o: { signal?: AbortSignal } = {}): Promise<void> {
    if (!this.supportsWatchAdvertisements) throw domError('NotSupportedError', 'watchAdvertisements() is not supported.')
    if (o.signal?.aborted) throw domError('AbortError', 'The operation was aborted.')
    this.watching = true
    o.signal?.addEventListener('abort', () => {
      this.watching = false
      if (this.advTimer) clearTimeout(this.advTimer)
      this.advTimer = null
    })
    if (this.inRange) this.scheduleAdvertisement()
  }

  async forget(): Promise<void> {
    this.forgotten = true
    this.dropConnection()
    this.owner?.forgetDevice(this)
  }

  /** @internal */
  isAllowed(uuid: string): boolean {
    return this.allowedServices === 'all' || this.allowedServices.has(uuid)
  }

  /** @internal */
  ensureAllowed(uuid: string): void {
    if (!this.isAllowed(uuid)) {
      throw domError(
        'SecurityError',
        "Origin is not allowed to access the service. Tip: Add the service UUID to 'optionalServices' in requestDevice() options.",
      )
    }
  }

  private scheduleAdvertisement(): void {
    if (this.advTimer) return
    this.advTimer = setTimeout(() => {
      this.advTimer = null
      if (!this.watching || !this.inRange) return
      const ev = new Event('advertisementreceived') as Event & { device?: FakeBleDevice; name?: string | null }
      ev.device = this
      ev.name = this.name
      this.dispatchEvent(ev)
    }, this.advertisementDelayMs)
  }
}

// ----------------------------------------------------------------------------------- chooser

function prefixMatches(data: Uint8Array, prefix?: BytesLike, mask?: BytesLike): boolean {
  if (!prefix) return true
  const p = bytesOf(prefix)
  const m = mask ? bytesOf(mask) : null
  if (data.length < p.length) return false
  for (let i = 0; i < p.length; i++) {
    const k = m ? m[i] ?? 0xff : 0xff
    if ((data[i] & k) !== (p[i] & k)) return false
  }
  return true
}

/** Web Bluetooth scan-filter semantics: every member present must match. */
export function bleFilterMatches(f: BleRequestFilter, d: FakeBleDevice): boolean {
  if (f.name !== undefined && d.name !== f.name) return false
  if (f.namePrefix !== undefined && !(d.name ?? '').startsWith(f.namePrefix)) return false
  for (const s of f.services ?? []) if (!d.advertisement.services.has(canonicalBleUuid(s))) return false
  for (const sd of f.serviceData ?? []) {
    const data = d.advertisement.serviceData.get(canonicalBleUuid(sd.service))
    if (!data || !prefixMatches(data, sd.dataPrefix, sd.mask)) return false
  }
  for (const md of f.manufacturerData ?? []) {
    const data = d.advertisement.manufacturerData.get(md.companyIdentifier)
    if (!data || !prefixMatches(data, md.dataPrefix, md.mask)) return false
  }
  return true
}

function isEmptyFilter(f: BleRequestFilter): boolean {
  return !f.services?.length && f.name === undefined && f.namePrefix === undefined && !f.serviceData?.length && !f.manufacturerData?.length
}

/** `navigator.bluetooth` double. */
export class FakeBluetooth extends EventTarget {
  readonly devices: FakeBleDevice[] = []
  /** Devices this origin was granted (getDevices()). */
  readonly granted = new Set<FakeBleDevice>()
  /** Options passed to every requestDevice() call (filters as given). */
  readonly requests: BleRequestDeviceOptions[] = []
  /** getAvailability() result. */
  available = true
  /** getDevices() returns granted devices (Chrome's persistent permissions backend). Default true. */
  persistentPermissions = true
  /** false: behave like a browser without serviceData filters (the member is ignored; an emptied filter is a TypeError). */
  supportsServiceDataFilters = true
  /** What the chooser returns; default: the first in-range device that matches. null = the user cancels. */
  choose: ((options: BleRequestDeviceOptions, matching: readonly FakeBleDevice[]) => FakeBleDevice | null) | null = null

  constructor(devices: readonly FakeBleDevice[] = []) {
    super()
    for (const d of devices) this.add(d)
  }

  /** This fake typed as the structural `navigator.bluetooth`. */
  get api(): BluetoothApiLike {
    return this
  }

  add(d: FakeBleDevice): FakeBleDevice {
    d.owner = this
    if (!this.devices.includes(d)) this.devices.push(d)
    return d
  }

  /** Grant without a chooser (a device from an earlier session). `services`: what the old chooser allowed. */
  grant(d: FakeBleDevice, services: readonly BleUuid[] | 'all' = 'all'): void {
    this.add(d)
    d.forgotten = false
    d.allowedServices = services === 'all' ? 'all' : new Set(services.map(canonicalBleUuid))
    this.granted.add(d)
  }

  forgetDevice(d: FakeBleDevice): void {
    this.granted.delete(d)
    d.allowedServices = new Set()
  }

  async getAvailability(): Promise<boolean> {
    return this.available
  }

  /** Toggle the adapter and fire `availabilitychanged`. */
  setAvailable(available: boolean): void {
    this.available = available
    const ev = new Event('availabilitychanged') as Event & { value?: boolean }
    ev.value = available
    this.dispatchEvent(ev)
  }

  async getDevices(): Promise<BleDeviceLike[]> {
    if (!this.persistentPermissions) return []
    return this.devices.filter((d) => this.granted.has(d))
  }

  async requestDevice(options: BleRequestDeviceOptions): Promise<BleDeviceLike> {
    this.requests.push(options)
    const hasFilters = options?.filters !== undefined
    if (!options || (options.acceptAllDevices && hasFilters) || (!options.acceptAllDevices && !options.filters?.length)) {
      throw new TypeError(
        "Failed to execute 'requestDevice' on 'Bluetooth': Either 'filters' should be present or 'acceptAllDevices' should be true, but not both.",
      )
    }
    const filters = (options.filters ?? []).map((f) => {
      if (this.supportsServiceDataFilters) return f
      const copy = { ...f }
      delete copy.serviceData
      return copy
    })
    if (filters.some(isEmptyFilter)) throw new TypeError("Failed to execute 'requestDevice' on 'Bluetooth': A filter must restrict the devices in some way.")
    if (!this.available) throw domError('NotFoundError', 'Bluetooth adapter not available.')
    const matching = this.devices.filter((d) => d.inRange && (options.acceptAllDevices || filters.some((f) => bleFilterMatches(f, d))))
    const chosen = this.choose ? this.choose(options, matching) : (matching[0] ?? null)
    if (!chosen) throw domError('NotFoundError', 'User cancelled the requestDevice() chooser.')
    // Allowed services: filters' `services` plus optionalServices; service-data filters grant nothing.
    this.grant(chosen, [...filters.flatMap((f) => f.services ?? []), ...(options.optionalServices ?? [])])
    return chosen
  }
}

// ------------------------------------------------------------------------- devices from links

/** A neutral link for drivers whose products have no BLE link (toy driver, USB-only families). */
export const FAKE_BLE_LINK: WebBluetoothLinkSpec = {
  kind: 'web-bluetooth',
  filters: [{ services: [0xfff0] }],
  service: 0xfff0,
  write: 0xfff1,
  notify: 0xfff2,
  writeMode: 'without-response',
  note: 'test-only link (transports/fake-bluetooth.ts)',
}

export interface FakeBleLinkDeviceOptions extends Omit<FakeBleDeviceOptions, 'services' | 'advertisement'> {
  /** Put the link's service in the advertised UUID list (default: as the link's filters imply). */
  advertiseServiceUuid?: boolean
  /** Advertised service data per UUID (default: each serviceData filter's dataPrefix). */
  serviceData?: readonly (readonly [BleUuid, readonly number[]])[]
  /** Property overrides for the write / notify characteristics. */
  writeProperties?: BleCharacteristicProperties
  notifyProperties?: BleCharacteristicProperties
}

/** A peripheral that offers exactly what a registry link expects (service, characteristics, advertisement). */
export function fakeBleDeviceForLink(link: WebBluetoothLinkSpec, o: FakeBleLinkDeviceOptions = {}): FakeBleDevice {
  const withResponse = link.writeMode === 'with-response'
  const writeProps: BleCharacteristicProperties = { write: withResponse, writeWithoutResponse: !withResponse, ...o.writeProperties }
  const notifyProps: BleCharacteristicProperties = { notify: true, ...o.notifyProperties }
  const shared = canonicalBleUuid(link.write) === canonicalBleUuid(link.notify)
  const characteristics: FakeBleCharacteristicInit[] = shared
    ? [{ uuid: link.write, properties: { ...writeProps, ...notifyProps } }]
    : [{ uuid: link.write, properties: writeProps }, { uuid: link.notify, properties: notifyProps }]
  const filterServices = link.filters.flatMap((f) => f.services ?? [])
  const services = o.advertiseServiceUuid === undefined ? filterServices : o.advertiseServiceUuid ? [link.service] : []
  const serviceData = o.serviceData ?? link.filters.flatMap((f) => (f.serviceData ?? []).map((d) => [d.service, [...(d.dataPrefix ?? [])]] as const))
  const { advertiseServiceUuid: _a, serviceData: _s, writeProperties: _w, notifyProperties: _n, ...rest } = o
  return new FakeBleDevice({ ...rest, services: [{ uuid: link.service, characteristics }], advertisement: { services, serviceData } })
}

function registryBleLink(p: ProductInfo | undefined, what: string): WebBluetoothLinkSpec {
  const link = p ? bleLinkOf(p) : undefined
  if (!link) throw new Error(`the registry has no Web Bluetooth link for ${what}`)
  return link
}

/**
 * LARK MAX 2 charging case (app id 101) from its registry link: service 0xFEE7 with one
 * characteristic 0xFEC1 (write without response + notify) (A blemic/operation/BleBoxOption
 * SERVICE_UUID / CHARACTERISTIC_WRITE_UUID / CHARACTERISTIC_NOTIFY_UUID; max2-6701.md §2.2).
 * Advertises 0xFEE7 in service data only, unless `advertiseServiceUuid` (which of the two the real
 * BOX does is open, max2-6701.md §9 #3). The service-data bytes are illustrative: `04 01` + an SN
 * (I +[HLBleDeviceEntity canonicalSNFromBLEServiceData:] @0x1000d319c strips a `04 01` prefix).
 * The advertised name is unknown [?].
 */
export function fakeMax2Box(o: FakeBleLinkDeviceOptions = {}): FakeBleDevice {
  const link = registryBleLink(lookupAppProduct(101), 'the LARK MAX 2 charging case (101)')
  return fakeBleDeviceForLink(link, {
    name: 'LARK MAX 2 BOX (fake)',
    advertiseServiceUuid: false,
    serviceData: [[link.service, [0x04, 0x01, ...Array.from('H2B0001', (c) => c.charCodeAt(0))]]],
    ...o,
  })
}

/**
 * MELO P1 receiver (USB PID 1032) from its registry link: service 0xFFE0, write 0xFFE1 (with
 * response), notify 0xFFE2 (A protocol/core/sound/provider/Protocol6201Provider.providerBluetoothConfig;
 * melo-6201.md §2.2). Service data 0xBBBB = productLine 4 (SOUND), deviceId 2 (C6201_OVERSEA),
 * then an 11-byte ASCII SN (A mic_ble/parser/DeviceParseV2, ble/core/model/ProductDeviceID.SOUND;
 * melo-6201.md §1.2). The advertised name is unknown [?].
 */
export function fakeMeloP1(o: FakeBleLinkDeviceOptions = {}): FakeBleDevice {
  const link = registryBleLink(lookupProduct(HOLLYLAND_VENDOR_ID, 1032), 'the MELO P1 receiver (1032)')
  return fakeBleDeviceForLink(link, {
    name: 'MELO P1 (fake)',
    serviceData: [[0xbbbb, [4, 2, ...Array.from('MP1A2B3C4D5', (c) => c.charCodeAt(0))]]],
    ...o,
  })
}

// ------------------------------------------------------------------------------------- bridge

export interface BlePeripheralBridgeOptions {
  link: WebBluetoothLinkSpec
  /**
   * How to join host writes into frames when the transport splits them (see BleFrameJoiner).
   * Default: every write is one complete frame.
   */
  frameLength?: (buf: Uint8Array) => number | null
}

export interface BlePeripheralBridge {
  /** The transport behind the peripheral (e.g. simulatedTransport(sim): its `sent` lists the frames). */
  readonly inner: Transport
  /** Complete host → device frames handed to `inner`, in order. */
  readonly frames: Uint8Array[]
  detach(): void
}

/**
 * Put a Transport behind a fake peripheral: GATT connect opens it, GATT disconnect closes it,
 * writes on the link's write characteristic (joined into frames) go to `inner.send()`, and every
 * packet `inner` emits is notified on the notify characteristic in MTU − 3 pieces. `inner`
 * unplugging drops the BLE link.
 */
export function bridgeBlePeripheral(device: FakeBleDevice, inner: Transport, o: BlePeripheralBridgeOptions): BlePeripheralBridge {
  const { link } = o
  const write = device.characteristic(link.service, link.write)
  device.characteristic(link.service, link.notify) // fail early when absent
  const joiner = o.frameLength ? new BleFrameJoiner(o.frameLength) : null
  const frames: Uint8Array[] = []
  const unsubs: (() => void)[] = [
    write.onWrite((w) => {
      const out = joiner ? joiner.push(w.delivered) : [w.delivered]
      for (const f of out) {
        frames.push(f)
        inner.send(f).catch(() => undefined)
      }
    }),
    device.onGattConnect(async () => {
      joiner?.reset()
      if (!inner.isOpen) await inner.open()
    }),
    device.onGattDisconnect(() => {
      joiner?.reset()
      if (inner.isOpen) void inner.close()
    }),
    inner.onPacket((p) => {
      if (device.gatt.connected) void device.notify(link.service, link.notify, p)
    }),
    inner.onDisconnect(() => device.dropConnection()),
  ]
  return {
    inner,
    frames,
    detach: () => {
      for (const u of unsubs.splice(0)) u()
    },
  }
}

export interface BleOverTransportOptions extends Omit<BlePeripheralBridgeOptions, 'link'> {
  /** GATT link (default: the product's BLE link, else FAKE_BLE_LINK). */
  link?: WebBluetoothLinkSpec
  /** ATT MTU of the fake link (default 23). */
  mtu?: number
  /** Options for the WebBluetoothTransport (e.g. writeChunkSize, assembler). */
  transport?: WebBluetoothTransportOptions
  /** Extra fake device settings (name, notifyLatencyMs, …). */
  device?: Omit<FakeBleLinkDeviceOptions, 'mtu'>
}

export interface BleOverTransport {
  transport: WebBluetoothTransport
  device: FakeBleDevice
  bluetooth: FakeBluetooth
  bridge: BlePeripheralBridge
}

/** A WebBluetoothTransport whose fake peripheral relays to `inner`. Not opened. */
export function bleOverTransport(inner: Transport, product: ProductInfo | null, o: BleOverTransportOptions = {}): BleOverTransport {
  const link = o.link ?? (product ? bleLinkOf(product) : undefined) ?? FAKE_BLE_LINK
  const device = fakeBleDeviceForLink(link, { name: inner.info?.productName ?? 'Fake BLE device', ...o.device, mtu: o.mtu ?? BLE_DEFAULT_ATT_MTU })
  const bluetooth = new FakeBluetooth([device])
  bluetooth.grant(device)
  const bridge = bridgeBlePeripheral(device, inner, { link, frameLength: o.frameLength })
  const transport = new WebBluetoothTransport(device, { product, link }, { bluetooth: bluetooth.api, ...o.transport })
  return { transport, device, bluetooth, bridge }
}

/** A family simulator behind a fake BLE peripheral (`bridge.inner` is its MockTransport). Not opened. */
export function bleSimulatedTransport(sim: DeviceSimulator, product: ProductInfo | null, o: BleOverTransportOptions = {}): BleOverTransport {
  return bleOverTransport(simulatedTransport(sim), product, o)
}

/**
 * The same driver, but every device it creates talks through WebBluetoothTransport → fake GATT →
 * the transport it was given (the conformance harness's simulator MockTransport, whose `sent`
 * still records complete frames). Lets the shared conformance suite run over the BLE stack:
 * `describeDriverConformance(bleBridgedDriver(driver, { mtu: 23 }), {...})`.
 */
export function bleBridgedDriver(driver: FamilyDriver, o: BleOverTransportOptions = {}): FamilyDriver {
  return {
    ...driver,
    name: `${driver.name} over Web Bluetooth (fake, MTU ${o.mtu ?? BLE_DEFAULT_ATT_MTU})`,
    createDevice: (transport, product, opts) => driver.createDevice(bleOverTransport(transport, product, o).transport, product, opts),
  }
}
