/**
 * Web Bluetooth registry helpers and the chooser, without the GATT transport (web-bluetooth.ts): the product links,
 * `requestDevice()` options, the structural browser types and `requestBleDevice()`. The app needs these before a
 * product is chosen (the connect page, the chooser inside the click's user gesture), while WebBluetoothTransport is
 * only needed after the choice, so it is loaded with import() (core/loader.ts). web-bluetooth.ts re-exports the
 * public names here.
 */
import { ALL_PRODUCTS, isConnectableProduct, linksOf, type ProductInfo } from '../models'
import { TransportError } from '../transport'
import type { BleScanFilter, BleUuid, WebBluetoothLinkSpec } from '../core/types'

/** Bluetooth Base UUID suffix for 16/32-bit aliases. */
const BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb'

// ------------------------------------------------------------------- structural browser types

/** Copy of `BluetoothCharacteristicProperties` (all optional so partial fakes fit). */
export interface BleCharacteristicProperties {
  broadcast?: boolean
  read?: boolean
  writeWithoutResponse?: boolean
  write?: boolean
  notify?: boolean
  indicate?: boolean
  authenticatedSignedWrites?: boolean
  reliableWrite?: boolean
  writableAuxiliaries?: boolean
}

/** Structural `BluetoothRemoteGATTCharacteristic`. Fires `characteristicvaluechanged`. */
export interface BleCharacteristicLike extends EventTarget {
  readonly uuid: string
  readonly properties?: BleCharacteristicProperties
  readonly value?: DataView | null
  startNotifications(): Promise<unknown>
  stopNotifications?(): Promise<unknown>
  writeValueWithResponse?(value: BufferSource): Promise<void>
  writeValueWithoutResponse?(value: BufferSource): Promise<void>
  /** Deprecated; the browser picks the write type. Fallback only. */
  writeValue?(value: BufferSource): Promise<void>
}

/** Structural `BluetoothRemoteGATTService`. */
export interface BleServiceLike {
  readonly uuid: string
  getCharacteristic(characteristic: string | number): Promise<BleCharacteristicLike>
  getCharacteristics?(characteristic?: string | number): Promise<BleCharacteristicLike[]>
}

/** Structural `BluetoothRemoteGATTServer`. */
export interface BleGattServerLike {
  readonly connected: boolean
  connect(): Promise<BleGattServerLike>
  disconnect(): void
  getPrimaryService(service: string | number): Promise<BleServiceLike>
  getPrimaryServices?(service?: string | number): Promise<BleServiceLike[]>
}

/** Structural `BluetoothDevice`. Fires `gattserverdisconnected` and `advertisementreceived`. */
export interface BleDeviceLike extends EventTarget {
  readonly id: string
  readonly name?: string | null
  readonly gatt?: BleGattServerLike | null
  watchAdvertisements?(options?: { signal?: AbortSignal }): Promise<void>
  readonly watchingAdvertisements?: boolean
  forget?(): Promise<void>
}

/** A scan filter in the shape `requestDevice()` takes: canonical UUID strings, `Uint8Array` prefixes. */
export interface BleRequestFilter {
  services?: string[]
  name?: string
  namePrefix?: string
  serviceData?: { service: string; dataPrefix?: Uint8Array; mask?: Uint8Array }[]
  manufacturerData?: { companyIdentifier: number; dataPrefix?: Uint8Array; mask?: Uint8Array }[]
}

/** `RequestDeviceOptions`. */
export interface BleRequestDeviceOptions {
  filters?: BleRequestFilter[]
  acceptAllDevices?: boolean
  optionalServices?: string[]
  optionalManufacturerData?: number[]
}

/** Structural `navigator.bluetooth`. Fires `availabilitychanged` (event `.value: boolean`). */
export interface BluetoothApiLike extends EventTarget {
  getAvailability?(): Promise<boolean>
  requestDevice(options: BleRequestDeviceOptions): Promise<BleDeviceLike>
  getDevices?(): Promise<BleDeviceLike[]>
}

// ------------------------------------------------------------------------------- UUID helpers

/**
 * Canonical lowercase 128-bit UUID string (what `BluetoothUUID.getService()` returns): a 16/32-bit
 * alias as a number (0xfee7) or a hex string ("FEE7", "0000FEE7"), or a full UUID in any case.
 */
export function canonicalBleUuid(u: BleUuid): string {
  if (typeof u === 'number') {
    if (!Number.isInteger(u) || u < 0 || u > 0xffffffff) throw new RangeError(`not a 16/32-bit UUID alias: ${u}`)
    return u.toString(16).padStart(8, '0') + BASE_UUID_SUFFIX
  }
  const s = u.trim().toLowerCase()
  if (/^(0x)?[0-9a-f]{4}$/.test(s) || /^(0x)?[0-9a-f]{8}$/.test(s)) return s.replace(/^0x/, '').padStart(8, '0') + BASE_UUID_SUFFIX
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s
  throw new RangeError(`not a Bluetooth UUID: ${u}`)
}

export function bleUuidEquals(a: BleUuid, b: BleUuid): boolean {
  return canonicalBleUuid(a) === canonicalBleUuid(b)
}

/** "0xfee7" for Base-UUID aliases, else the full UUID (for logs). */
export function shortBleUuid(u: BleUuid): string {
  const c = canonicalBleUuid(u)
  return c.endsWith(BASE_UUID_SUFFIX) && c.startsWith('0000') ? '0x' + c.slice(4, 8) : c
}

// ------------------------------------------------------------------------- registry helpers

/** A product's Web Bluetooth link, if it has one. */
export function bleLinkOf(p: ProductInfo): WebBluetoothLinkSpec | undefined {
  return linksOf(p).find((l): l is WebBluetoothLinkSpec => l.kind === 'web-bluetooth')
}

/** What the chooser may offer: a registry row and its GATT link (product null for ad-hoc links). */
export interface BleLinkCandidate {
  product: ProductInfo | null
  link: WebBluetoothLinkSpec
}

/**
 * Rows with a Web Bluetooth link. By default only connectable rows (driver past the stub), so the
 * list is empty until the MAX 2 / MELO P1 drivers turn their rows 'experimental'.
 */
export function bleCandidates(
  products: readonly ProductInfo[] = ALL_PRODUCTS,
  o: { includeRecognised?: boolean } = {},
): BleLinkCandidate[] {
  const out: BleLinkCandidate[] = []
  for (const p of products) {
    const link = bleLinkOf(p)
    if (!link) continue
    if (!o.includeRecognised && !isConnectableProduct(p)) continue
    out.push({ product: p, link })
  }
  return out
}

/** Rows with a Web Bluetooth link (see bleCandidates). */
export function bleProducts(products: readonly ProductInfo[] = ALL_PRODUCTS, o: { includeRecognised?: boolean } = {}): ProductInfo[] {
  return bleCandidates(products, o).map((c) => c.product!)
}

function bytesOrUndefined(a: readonly number[] | undefined): Uint8Array | undefined {
  return a ? Uint8Array.from(a) : undefined
}

/** One registry scan filter in `requestDevice()` form. */
export function toBleRequestFilter(f: BleScanFilter): BleRequestFilter {
  const out: BleRequestFilter = {}
  if (f.services?.length) out.services = f.services.map(canonicalBleUuid)
  if (f.name !== undefined) out.name = f.name
  if (f.namePrefix !== undefined) out.namePrefix = f.namePrefix
  if (f.serviceData?.length) {
    out.serviceData = f.serviceData.map((d) => ({
      service: canonicalBleUuid(d.service),
      ...(d.dataPrefix ? { dataPrefix: bytesOrUndefined(d.dataPrefix) } : {}),
      ...(d.mask ? { mask: bytesOrUndefined(d.mask) } : {}),
    }))
  }
  if (f.manufacturerData?.length) {
    out.manufacturerData = f.manufacturerData.map((d) => ({
      companyIdentifier: d.companyIdentifier,
      ...(d.dataPrefix ? { dataPrefix: bytesOrUndefined(d.dataPrefix) } : {}),
      ...(d.mask ? { mask: bytesOrUndefined(d.mask) } : {}),
    }))
  }
  return out
}

function filterKey(f: BleRequestFilter): string {
  return JSON.stringify(f, (_k, v: unknown) => (v instanceof Uint8Array ? Array.from(v) : v))
}

function isEmptyFilter(f: BleRequestFilter): boolean {
  return !f.services?.length && f.name === undefined && f.namePrefix === undefined && !f.serviceData?.length && !f.manufacturerData?.length
}

export interface BleRequestOptionsInit {
  /** "Show all Bluetooth devices" (the chooser lists every advertiser), like anyHidDeviceFilters(). */
  acceptAllDevices?: boolean
  /**
   * false: leave out `serviceData` filter members (browsers without serviceData filters reject
   * them with a TypeError). A filter that had only service data is dropped; when none is left the
   * options fall back to acceptAllDevices. Default true.
   */
  serviceDataFilters?: boolean
  /** More services the page may open (diagnostics). */
  extraServices?: readonly BleUuid[]
}

/**
 * `requestDevice()` options for a set of candidates: their scan filters (deduplicated) and every
 * link's service in `optionalServices` (a service matched only through service data is not
 * accessible otherwise; max2-6701.md §2.2 "Browser path").
 */
export function bleRequestOptions(candidates: readonly BleLinkCandidate[], o: BleRequestOptionsInit = {}): BleRequestDeviceOptions {
  const optionalServices = [...new Set([...candidates.map((c) => c.link.service), ...(o.extraServices ?? [])].map(canonicalBleUuid))]
  if (o.acceptAllDevices) return { acceptAllDevices: true, optionalServices }
  const seen = new Set<string>()
  const filters: BleRequestFilter[] = []
  for (const c of candidates) {
    for (const raw of c.link.filters) {
      const f = toBleRequestFilter(raw)
      if (o.serviceDataFilters === false) delete f.serviceData
      if (isEmptyFilter(f)) continue
      const k = filterKey(f)
      if (seen.has(k)) continue
      seen.add(k)
      filters.push(f)
    }
  }
  if (!filters.length) return { acceptAllDevices: true, optionalServices }
  return { filters, optionalServices }
}

// ----------------------------------------------------------------------- availability

/** `navigator.bluetooth`, or undefined. */
export function bluetoothApi(): BluetoothApiLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  const b = (navigator as Navigator & { bluetooth?: BluetoothApiLike }).bluetooth
  return b ?? undefined
}

export function isWebBluetoothSupported(): boolean {
  return !!bluetoothApi()
}

/** Error text for messages: "Name: message" (plain message for a bare Error). */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message
  return String(e)
}

export function errorName(e: unknown): string {
  return (e as { name?: string } | null)?.name ?? ''
}

// ------------------------------------------------------------------------------- chooser

export interface BleChooserOptions {
  /** `navigator.bluetooth` replacement (tests, polyfills). */
  bluetooth?: BluetoothApiLike
  /** Products to offer (default: every connectable row with a Bluetooth link). */
  products?: readonly ProductInfo[]
  /** Explicit candidates; win over `products`. */
  candidates?: readonly BleLinkCandidate[]
  /** Offer 'recognised' rows too (development; their drivers are stubs). */
  includeRecognised?: boolean
  /** "Show all Bluetooth devices" fallback. */
  acceptAllDevices?: boolean
}

/** The chosen device and the candidates it may be (resolved by GATT service when a transport opens it). */
export interface BleChoice {
  device: BleDeviceLike
  candidates: BleLinkCandidate[]
}

/**
 * Show the chooser and return the chosen device, or null when the user cancels. Must run inside a user gesture:
 * `requestDevice()` is called synchronously, before anything is awaited. WebBluetoothTransport.request() is this
 * plus the transport (`new WebBluetoothTransport(choice.device, choice.candidates)` and `open()`).
 */
export async function requestBleDevice(o: BleChooserOptions = {}): Promise<BleChoice | null> {
  const api = o.bluetooth ?? bluetoothApi()
  if (!api) throw new TransportError('Web Bluetooth is not available in this browser')
  const candidates = o.candidates ? [...o.candidates] : bleCandidates(o.products ?? ALL_PRODUCTS, { includeRecognised: o.includeRecognised })
  if (!candidates.length) throw new TransportError('no product with a Bluetooth link is enabled')
  const options = bleRequestOptions(candidates, { acceptAllDevices: o.acceptAllDevices })
  let device: BleDeviceLike
  try {
    device = await api.requestDevice(options)
  } catch (e) {
    if (isChooserCancel(e)) return null
    // Browsers without serviceData filters reject the whole call with a TypeError: retry once
    // without them (the transient user activation is still valid). A filter that only had
    // service data (MELO P1) then turns into acceptAllDevices.
    const usedServiceData = options.filters?.some((f) => f.serviceData?.length)
    if (errorName(e) !== 'TypeError' || !usedServiceData) throw new TransportError(`requestDevice failed: ${errorText(e)}`, { cause: e })
    try {
      device = await api.requestDevice(bleRequestOptions(candidates, { serviceDataFilters: false }))
    } catch (e2) {
      if (isChooserCancel(e2)) return null
      throw new TransportError(`requestDevice failed: ${errorText(e2)} (after "${errorText(e)}" with serviceData filters)`, { cause: e2 })
    }
  }
  return { device, candidates }
}

/** Chrome: NotFoundError "User cancelled the requestDevice() chooser." (also NotFoundError: "Bluetooth adapter not available."). */
function isChooserCancel(e: unknown): boolean {
  return errorName(e) === 'NotFoundError' && /cancel/i.test((e as Error).message ?? '')
}
