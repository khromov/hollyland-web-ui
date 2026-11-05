/**
 * WebBluetoothTransport: generic GATT transport for the products whose control link is Bluetooth
 * Low Energy (docs/FAMILIES.md §0 #4, §3.4), configured by a registry `WebBluetoothLinkSpec`:
 *
 *   product                         service  write                      notify  research
 *   LARK MAX 2 charging case (101)  0xFEE7   0xFEC1, without response   0xFEC1  max2-6701.md §2.2
 *   MELO P1 receiver (1032)         0xFFE0   0xFFE1, with response (A)  0xFFE2  melo-6201.md §2.2
 *                                            (iOS: without response)
 *
 *   const t = await WebBluetoothTransport.request()          // user gesture; chooser; GATT connect
 *   if (t) { const mic = createMicDevice(t, { product: t.product ?? undefined }); await mic.connect() }
 *
 * Mapping (Transport contract, transport.ts):
 *  - `send(frame)` writes one complete family frame to the write characteristic, cut into ATT-sized
 *    pieces when it is longer than the write chunk (`writeChunkSize`). Writes are serialized:
 *    Chrome rejects a second GATT operation while one is pending ("GATT operation already in
 *    progress"). Continuation pieces carry no header, as the Android app's split writes
 *    (A com/clj/fastble/BleManager.write → bluetooth/SplitWriter.splitWrite) and the iOS chunked
 *    writes (I -[HLBluetoothManager writeData:targetTic:] block @0x1002ad85c–0x1002adb98,
 *    maximumWriteValueLengthForType:) do.
 *  - every notification on the notify characteristic is emitted through `onPacket` as it came. A
 *    notification may hold part of a frame (MTU 23: 20 bytes); the family assembler reassembles
 *    (moma/ resyncs on `BB DD`), or pass `assembler` to get whole frames here.
 *  - the browser fires `gattserverdisconnected` when the link drops; that becomes `onDisconnect`.
 *    `close()` disconnects without an event (as WebHidTransport.close()).
 *
 * MTU. Browsers cannot request an MTU and do not expose the negotiated one. The Android app asks
 * for 512 and then splits writes at mtu − 3 (A ble/core/connection/DeviceConnector.setMtu →
 * BleManager.setSplitWriteNum(mtu − 3), ble/core/model/BleConnectionConfig default mtuSize 512;
 * A blemic/operation/BleBoxOption$connect$1$onConnectSuccess$3$1.onMtuChanged for the MAX 2 BOX).
 * macOS, Windows and ChromeOS negotiate a larger MTU on their own [?]; Chrome on Android is assumed
 * to stay at 23 [?]. Hence the `writeChunkSize: 'auto'` default (defaultBleWriteChunk): whole
 * frames up to 509 B for writes with response (the OS stack turns values longer than the negotiated
 * MTU − 3 into ATT long writes), up to 182 B for writes without response on desktop (CoreBluetooth's
 * usual MTU 185 − 3 [?]), 20 B on Android. When the first write of a frame fails (a device without
 * long-write support rejects it) the frame is resent in 20-byte pieces and that size sticks
 * (FAMILIES.md §3.4: "try the whole frame first, fall back to 20-byte chunks [?]"). A write
 * without response that is longer than the MTU is not rejected but truncated by most stacks, so no
 * fallback can catch it: that is why Android starts at 20. Whether the MAX 2 BOX and MELO P1
 * firmware join frames split across ATT writes is unverified (FAMILIES.md §6 #4).
 *
 * Long writes are a library choice, not the apps': Android writes with response but only after its
 * MTU 512 request, so its 509-byte pieces fit one ATT write; iOS writes every frame, MELO P1 included,
 * WITHOUT response, cut at maximumWriteValueLengthForType:1 and paced by canSendWriteWithoutResponse
 * (I -[HLBluetoothManager writeData:targetTic:] block @0x1002ad85c, writeValue:…type:1 @0x1002ad9f4 /
 * @0x1002adb30). Neither app ever sends a value longer than the MTU allows, so the whole-frame
 * with-response path for frames above MTU − 3 is untested by either app [?]. The iOS path shows that
 * FFE1 also accepts writes without response (melo-6201.md §2.2).
 *
 * Browser and platform availability (FAMILIES.md §1.2; `webBluetoothPlatformSupport()`):
 *  - Chrome, Edge, Opera on macOS (Chrome 56+), Windows 10 1703+ / 11 (Chrome 70+) and ChromeOS:
 *    on by default. macOS asks once to let the browser use Bluetooth (System Settings › Privacy &
 *    Security › Bluetooth); until then `getAvailability()` reports false [?].
 *  - Chrome for Android 6+ (Chrome 56+): on by default; Chrome needs the Nearby devices permission
 *    (Android 12+) or Location (older Android). Android has no WebHID, so BLE is the phone path.
 *  - Linux: behind chrome://flags/#enable-experimental-web-platform-features (BlueZ) [?].
 *  - iOS / iPadOS: none. Every iOS browser uses WebKit, which has no Web Bluetooth.
 *  - Firefox and Safari (all platforms): none. Brave turns it off by default [?].
 *  - Always: a secure context (https or localhost; GitHub Pages is https), a user gesture for
 *    `requestDevice()`, and `allow="bluetooth"` when embedded in an iframe.
 *  - Silent reconnect (`getDevices()` + `watchAdvertisements()`) needs Chrome's persistent
 *    permissions backend (chrome://flags/#enable-web-bluetooth-new-permissions-backend; on by
 *    default in recent desktop Chrome [?]). Without it every session starts at the chooser.
 *  - Chrome's GATT blocklist is not known to contain 0xFEE7, 0xFEC1 or 0xFFE0–0xFFE2 [?].
 *
 * No pairing or bonding: neither app requests one (A comm/ble/core/handle/DeviceHandleManager only
 * listens to BOND_STATE_CHANGED; melo-6201.md §2.2 "no createBond anywhere").
 *
 * The project has no Web Bluetooth type package, so the browser objects are typed structurally
 * (`BluetoothApiLike`, `BleDeviceLike`, …); the real `navigator.bluetooth` and the test double
 * (transports/fake-bluetooth.ts) both fit.
 */
import { BaseTransport, TransportError, type TransportCapabilities, type TransportDeviceInfo } from '../transport'
import { ALL_PRODUCTS, displayName, isConnectableProduct, linksOf, type ProductInfo } from '../models'
import { chunkBytes } from '../core/bytes'
import type { BleScanFilter, BleUuid, WebBluetoothLinkSpec } from '../core/types'

// ------------------------------------------------------------------------------- constants

/** Default ATT MTU before any exchange (Bluetooth Core spec). */
export const BLE_DEFAULT_ATT_MTU = 23
/** Payload of one ATT write or notification at the default MTU (23 − 3); FastBle's default split (A BleManager.DEFAULT_WRITE_DATA_SPLIT_COUNT = 20). */
export const BLE_MIN_WRITE_CHUNK = 20
/** Chrome refuses characteristic values longer than 512 bytes (GATT maximum attribute length). */
export const BLE_MAX_ATTRIBUTE_LENGTH = 512
/** The Android app's write split after its MTU 512 request: 512 − 3 (A DeviceConnector.setMtu; BleBoxOption…onMtuChanged). */
export const BLE_APP_WRITE_CHUNK = 509
/** Usual CoreBluetooth payload for writes without response (MTU 185 − 3) [?]. */
export const BLE_DESKTOP_WITHOUT_RESPONSE_CHUNK = 182
/** Largest frame `send()` accepts (sanity bound; MELO P1 EQ sets are 211 B, melo-6201.md §2.5). */
export const BLE_MAX_FRAME = 4096

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

// ----------------------------------------------------------------- availability and platform

export type WebBluetoothPlatform = 'macos' | 'windows' | 'linux' | 'chromeos' | 'android' | 'ios' | 'unknown'

/** `navigator.bluetooth`, or undefined. */
export function bluetoothApi(): BluetoothApiLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  const b = (navigator as Navigator & { bluetooth?: BluetoothApiLike }).bluetooth
  return b ?? undefined
}

export function isWebBluetoothSupported(): boolean {
  return !!bluetoothApi()
}

/** Host platform, from User-Agent Client Hints / navigator.platform / the user agent. */
export function webBluetoothPlatform(): WebBluetoothPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const s = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase()
  if (/iphone|ipad|ipod|\bios\b/.test(s)) return 'ios'
  if (s.includes('android')) return 'android'
  if (s.includes('cros') || s.includes('chrome os') || s.includes('chromeos')) return 'chromeos'
  // iPadOS asks for desktop pages with a Macintosh user agent; it has touch points.
  if (s.includes('mac')) return (nav.maxTouchPoints ?? 0) > 1 ? 'ios' : 'macos'
  if (s.includes('win')) return 'windows'
  if (s.includes('linux')) return 'linux'
  return 'unknown'
}

export interface WebBluetoothPlatformSupport {
  platform: WebBluetoothPlatform
  /** `navigator.bluetooth` exists in this browser. */
  api: boolean
  /** https / localhost (Web Bluetooth is exposed only there). */
  secureContext: boolean
  /** What a Chromium browser offers on this platform. */
  expected: 'available' | 'behind-flag' | 'unavailable'
  /** `getDevices()` exists: silent reconnect to a granted device is possible. */
  persistentPermissions: boolean
  /** One-line explanation for the UI. */
  note: string
}

const PLATFORM_NOTES: Record<WebBluetoothPlatform, { expected: WebBluetoothPlatformSupport['expected']; note: string }> = {
  macos: { expected: 'available', note: 'Chrome or Edge on macOS. macOS asks once to let the browser use Bluetooth.' },
  windows: { expected: 'available', note: 'Chrome or Edge on Windows 10 (1703+) or 11.' },
  chromeos: { expected: 'available', note: 'Chrome on ChromeOS.' },
  android: { expected: 'available', note: 'Chrome for Android 6+; allow Nearby devices (Android 12+) or Location for Chrome.' },
  linux: { expected: 'behind-flag', note: 'Chrome on Linux: enable chrome://flags/#enable-experimental-web-platform-features (BlueZ).' },
  ios: { expected: 'unavailable', note: 'No iPhone or iPad browser supports Web Bluetooth (all use WebKit).' },
  unknown: { expected: 'unavailable', note: 'Web Bluetooth needs Chrome or Edge on macOS, Windows, ChromeOS or Android.' },
}

/** Platform expectations plus what this browser actually exposes (FAMILIES.md §1.2, §4.1). */
export function webBluetoothPlatformSupport(): WebBluetoothPlatformSupport {
  const platform = webBluetoothPlatform()
  const api = bluetoothApi()
  const secureContext = typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : true
  const base = PLATFORM_NOTES[platform]
  let note = base.note
  if (!secureContext) note = 'Web Bluetooth needs a secure page (https or localhost).'
  else if (!api && base.expected === 'available') note = 'This browser has no Web Bluetooth (Firefox, Safari; Brave turns it off). Use Chrome or Edge.'
  return { platform, api: !!api, secureContext, expected: base.expected, persistentPermissions: typeof api?.getDevices === 'function', note }
}

export type WebBluetoothAvailability = 'available' | 'unsupported' | 'insecure-context' | 'no-adapter'

/**
 * Whether a chooser can work right now. 'no-adapter' = `getAvailability()` is false: no adapter,
 * Bluetooth blocked by policy, or (macOS) the browser lacks Bluetooth permission [?]. Some
 * platforms report true while the radio is off [?]; the chooser then says so.
 */
export async function webBluetoothAvailability(api: BluetoothApiLike | undefined = bluetoothApi()): Promise<WebBluetoothAvailability> {
  if (typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext) return 'insecure-context'
  if (!api) return 'unsupported'
  if (!api.getAvailability) return 'available'
  try {
    return (await api.getAvailability()) ? 'available' : 'no-adapter'
  } catch {
    return 'no-adapter'
  }
}

/** Adapter plugged / unplugged or Bluetooth toggled (`availabilitychanged`). Returns an unsubscribe function. */
export function onWebBluetoothAvailabilityChange(listener: (available: boolean) => void, api: BluetoothApiLike | undefined = bluetoothApi()): () => void {
  if (!api) return () => undefined
  const h = (e: Event) => listener(!!(e as Event & { value?: boolean }).value)
  api.addEventListener('availabilitychanged', h)
  return () => api.removeEventListener('availabilitychanged', h)
}

/**
 * Bytes per ATT write for `writeChunkSize: 'auto'` (see the header): with response 509 (the
 * Android app's split after its MTU 512 request; in a browser the MTU may be lower, and values above
 * MTU − 3 then become ATT long writes, which neither app uses [?]), without response 182 on desktop
 * (the iOS app's chunk at MTU 185 [?]) and 20 on Android (Chrome there is assumed not to raise the MTU [?]).
 */
export function defaultBleWriteChunk(mode: WebBluetoothLinkSpec['writeMode'], platform: WebBluetoothPlatform = webBluetoothPlatform()): number {
  if (mode === 'with-response') return BLE_APP_WRITE_CHUNK
  return platform === 'android' ? BLE_MIN_WRITE_CHUNK : BLE_DESKTOP_WITHOUT_RESPONSE_CHUNK
}

// --------------------------------------------------------------------------- reassembly hook

/** Optional notification reassembly (the family assembler normally does this above the transport). */
export interface BleNotificationAssembler {
  push(chunk: Uint8Array): Uint8Array[]
  reset(): void
}

/**
 * Generic length-driven reassembler, usable as `assembler` here and by the fake peripheral to join
 * split writes. `frameLength(buf)` returns the total length of the frame at buf[0], `null` when more
 * bytes are needed to tell, or a number < 1 to drop buf[0] as garbage (resync).
 */
export class BleFrameJoiner implements BleNotificationAssembler {
  private buf = new Uint8Array(0)
  /** Bytes dropped while resyncing. */
  dropped = 0
  private readonly frameLength: (buf: Uint8Array) => number | null

  constructor(frameLength: (buf: Uint8Array) => number | null) {
    this.frameLength = frameLength
  }

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    const out: Uint8Array[] = []
    let pos = 0
    while (pos < merged.length) {
      const rest = merged.subarray(pos)
      const n = this.frameLength(rest)
      if (n === null) break
      if (n < 1) {
        pos++
        this.dropped++
        continue
      }
      if (rest.length < n) break
      out.push(rest.slice(0, n))
      pos += n
    }
    this.buf = merged.slice(pos)
    return out
  }

  reset(): void {
    this.buf = new Uint8Array(0)
  }

  /** Bytes waiting for the rest of their frame. */
  get pending(): number {
    return this.buf.length
  }
}

// -------------------------------------------------------------------------------- transport

export interface WebBluetoothTransportOptions {
  /** Override the link's write mode (hardware checks). Default: the link's, adjusted to the characteristic's properties. */
  writeMode?: WebBluetoothLinkSpec['writeMode']
  /** Bytes per ATT write; frames up to this size go in one write. 'auto' (default): defaultBleWriteChunk(). */
  writeChunkSize?: number | 'auto'
  /** When the first write of a frame fails, resend it in 20-byte pieces and keep that size. Default true. */
  fallbackToMinChunk?: boolean
  /** Pause between the pieces of one frame (default 0; FastBle sends the next piece on the previous one's callback). */
  chunkDelayMs?: number
  /** GATT connect attempts (default 3; Chrome's connect() fails now and then with "Connection failed for unknown reason"). */
  connectAttempts?: number
  /** Per-attempt connect timeout (default 10000 ms); a hung attempt is cancelled with gatt.disconnect(). */
  connectTimeoutMs?: number
  /** Back-off before attempt n + 1: n × this (default 250 ms). */
  connectRetryDelayMs?: number
  /** Reassembly hook: notifications go through it and onPacket gets whole frames. Default: pass-through. */
  assembler?: BleNotificationAssembler
  /** `navigator.bluetooth` replacement (tests, polyfills). Used by request() / reconnect(). */
  bluetooth?: BluetoothApiLike
  /** Platform for the 'auto' decisions (default: detected). */
  platform?: WebBluetoothPlatform
}

export interface WebBluetoothRequestOptions extends WebBluetoothTransportOptions {
  /** Products to offer (default: every connectable row with a Bluetooth link). */
  products?: readonly ProductInfo[]
  /** Explicit candidates; win over `products`. */
  candidates?: readonly BleLinkCandidate[]
  /** Offer 'recognised' rows too (development; their drivers are stubs). */
  includeRecognised?: boolean
  /** "Show all Bluetooth devices" fallback. */
  acceptAllDevices?: boolean
  /** Connect GATT and identify the product before returning (default true). */
  open?: boolean
}

export interface WebBluetoothReconnectOptions extends Omit<WebBluetoothRequestOptions, 'acceptAllDevices' | 'open'> {
  /** Only this device (the id a previous transport's `info.id` / `deviceId` carried). */
  deviceId?: string
  /**
   * Wait this long for an advertisement before connecting (default 5000 ms; 0 = connect at once).
   * A granted device that is out of range or asleep would otherwise make connect() hang or fail.
   */
  advertisementTimeoutMs?: number
}

/** Snapshot for the diagnostic report (FAMILIES.md §4.3, §5.7 "notification sizes"). */
export interface WebBluetoothDiagnostics {
  deviceId: string
  name: string | null
  product: string | null
  service: string | null
  write: string | null
  notify: string | null
  linkWriteMode: WebBluetoothLinkSpec['writeMode'] | null
  writeMode: WebBluetoothLinkSpec['writeMode'] | null
  writeProperties: BleCharacteristicProperties | null
  notifyProperties: BleCharacteristicProperties | null
  writeChunkSize: number
  fellBackToMinChunk: boolean
  framesWritten: number
  piecesWritten: number
  notifications: number
  notificationBytes: { min: number; max: number; last: number } | null
  connectAttempts: number
  serviceFoundByCharacteristicSearch: boolean
}

/** Result of `inspectGatt()`: the services this origin may open, with characteristic properties. */
export interface BleGattInventory {
  services: { uuid: string; characteristics: { uuid: string; properties: BleCharacteristicProperties }[] }[]
}

const PROPERTY_KEYS: readonly (keyof BleCharacteristicProperties)[] = [
  'broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate', 'authenticatedSignedWrites', 'reliableWrite', 'writableAuxiliaries',
]

function copyProperties(p: BleCharacteristicProperties | undefined): BleCharacteristicProperties | null {
  if (!p) return null
  const out: BleCharacteristicProperties = {}
  for (const k of PROPERTY_KEYS) if (p[k] !== undefined) out[k] = !!p[k]
  return out
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message
  return String(e)
}

function errorName(e: unknown): string {
  return (e as { name?: string } | null)?.name ?? ''
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** How long close() waits for an in-flight write. */
const CLOSE_DRAIN_MS = 500

/** Resolve when `p` settles or after `ms`, whichever comes first (never rejects). */
function settledWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    p.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      () => {
        clearTimeout(timer)
        resolve()
      },
    )
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void, what: string): Promise<T> {
  if (!(ms > 0) || !Number.isFinite(ms)) return p
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new TransportError(`${what} timed out after ${ms} ms`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Resolve on the first advertisement, false after `ms`; true at once when the browser cannot watch. */
function waitForAdvertisement(device: BleDeviceLike, ms: number): Promise<boolean> {
  if (!device.watchAdvertisements || ms <= 0) return Promise.resolve(true)
  const ac = typeof AbortController === 'function' ? new AbortController() : null
  return new Promise<boolean>((resolve) => {
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      device.removeEventListener('advertisementreceived', onAdv)
      ac?.abort()
      resolve(ok)
    }
    const onAdv = () => done(true)
    device.addEventListener('advertisementreceived', onAdv)
    const timer = setTimeout(() => done(false), ms)
    // Not supported (flag off) or refused: just try to connect.
    device.watchAdvertisements!(ac ? { signal: ac.signal } : undefined).catch(() => done(true))
  })
}

function normaliseCandidates(target: WebBluetoothLinkSpec | BleLinkCandidate | readonly BleLinkCandidate[]): BleLinkCandidate[] {
  if (Array.isArray(target)) return [...(target as readonly BleLinkCandidate[])]
  if ((target as WebBluetoothLinkSpec).kind === 'web-bluetooth') return [{ product: null, link: target as WebBluetoothLinkSpec }]
  return [target as BleLinkCandidate]
}

interface ResolvedLink {
  candidate: BleLinkCandidate
  service: BleServiceLike
  write: BleCharacteristicLike
  notify: BleCharacteristicLike
  bySearch: boolean
}

/**
 * Web Bluetooth GATT transport. One instance per chosen device; `open()` may be called again after
 * a disconnect (it reconnects GATT and resubscribes).
 */
export class WebBluetoothTransport extends BaseTransport {
  readonly kind = 'web-bluetooth'
  readonly device: BleDeviceLike
  /** Products / links this device may be (resolved by GATT service on open()). */
  readonly candidates: readonly BleLinkCandidate[]
  capabilities: TransportCapabilities
  private readonly options: WebBluetoothTransportOptions
  private resolved: ResolvedLink | null = null
  private opened = false
  private closing = false
  private opening: Promise<void> | null = null
  private attachedNotify: BleCharacteristicLike | null = null
  private deviceListening = false
  private gattQueue: Promise<unknown> = Promise.resolve()
  private writeModeInUse: WebBluetoothLinkSpec['writeMode'] | null = null
  private chunkSize: number
  private fellBack = false
  private stats = { framesWritten: 0, piecesWritten: 0, notifications: 0, min: Infinity, max: 0, last: 0, connectAttempts: 0 }

  private readonly onValue = (e: Event) => this.handleValue(e)
  private readonly onGattDisconnected = () => this.handleGattDisconnected()

  constructor(
    device: BleDeviceLike,
    target: WebBluetoothLinkSpec | BleLinkCandidate | readonly BleLinkCandidate[],
    options: WebBluetoothTransportOptions = {},
  ) {
    super()
    this.device = device
    this.candidates = normaliseCandidates(target)
    if (!this.candidates.length) throw new TransportError('WebBluetoothTransport needs at least one GATT link')
    this.options = options
    this.chunkSize = this.initialChunkSize(this.options.writeMode ?? this.candidates[0].link.writeMode)
    this.capabilities = { receive: 'unknown', link: 'gatt', maxWrite: BLE_MAX_FRAME }
  }

  // ------------------------------------------------------------------------ static helpers

  /**
   * Show the chooser (must run inside a user gesture), then connect GATT and identify the product
   * by its service (unless `open: false`). Returns null when the user cancels.
   */
  static async request(o: WebBluetoothRequestOptions = {}): Promise<WebBluetoothTransport | null> {
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
    const t = new WebBluetoothTransport(device, candidates, o)
    if (o.open ?? true) await t.open()
    return t
  }

  /** Devices this origin was granted (empty without persistent permissions). */
  static async getGrantedDevices(api: BluetoothApiLike | undefined = bluetoothApi()): Promise<BleDeviceLike[]> {
    if (!api?.getDevices) return []
    try {
      return await api.getDevices()
    } catch {
      return []
    }
  }

  /**
   * Silent reconnect: the first granted device that advertises (or every one, when the browser
   * cannot watch advertisements) and offers a candidate's service. Returns an open transport or null.
   */
  static async reconnect(o: WebBluetoothReconnectOptions = {}): Promise<WebBluetoothTransport | null> {
    const api = o.bluetooth ?? bluetoothApi()
    const candidates = o.candidates ? [...o.candidates] : bleCandidates(o.products ?? ALL_PRODUCTS, { includeRecognised: o.includeRecognised })
    if (!api || !candidates.length) return null
    const granted = await WebBluetoothTransport.getGrantedDevices(api)
    const devices = o.deviceId ? granted.filter((d) => d.id === o.deviceId || `ble:${d.id}` === o.deviceId) : granted
    for (const d of devices) {
      if (!(await waitForAdvertisement(d, o.advertisementTimeoutMs ?? 5000))) continue
      const t = new WebBluetoothTransport(d, candidates, o)
      try {
        await t.open()
        return t
      } catch {
        // Not in range, or not one of ours: try the next one.
      }
    }
    return null
  }

  // ----------------------------------------------------------------------------- identity

  /** The candidate in use: the resolved one after open(), else the first. */
  get candidate(): BleLinkCandidate {
    return this.resolved?.candidate ?? this.candidates[0]
  }

  /** Registry row of the connected product (null for an ad-hoc link). Known for sure only after open(). */
  get product(): ProductInfo | null {
    return this.candidate.product
  }

  get link(): WebBluetoothLinkSpec {
    return this.candidate.link
  }

  /** Browser-assigned device id (stable per origin with persistent permissions). */
  get deviceId(): string {
    return this.device.id
  }

  get isOpen(): boolean {
    return this.opened && !!this.device.gatt?.connected
  }

  /**
   * vendorId / productId of the registry row: MELO P1 0x3547:1032; MAX 2 BOX 0:101 (an app id,
   * FAMILIES.md §1.4), which `lookupProduct` does not resolve, so pass `{ product: t.product }` to
   * createMicDevice for it.
   */
  get info(): TransportDeviceInfo {
    const p = this.product
    return {
      vendorId: p?.vendorId ?? 0,
      productId: p?.productId ?? 0,
      productName: this.device.name ?? (p ? displayName(p) : undefined),
      id: `ble:${this.device.id}`,
    }
  }

  /** Bytes per ATT write in use (changes once if the 20-byte fallback kicks in). */
  get writeChunkSize(): number {
    return this.chunkSize
  }

  /** Effective write mode (null before open()). */
  get writeMode(): WebBluetoothLinkSpec['writeMode'] | null {
    return this.writeModeInUse
  }

  // ----------------------------------------------------------------------------- lifecycle

  async open(): Promise<void> {
    if (this.isOpen) return
    this.opening ??= this.doOpen().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  async close(): Promise<void> {
    this.closing = true
    this.detach()
    this.opened = false
    this.options.assembler?.reset()
    // Let an in-flight write finish first (bounded): a frame cut between two ATT writes would
    // leave the device's parser mid-frame, and the caller's request then fails with its own
    // disconnect reason instead of a write error.
    await settledWithin(this.gattQueue, CLOSE_DRAIN_MS)
    const server = this.device.gatt
    // Disconnecting drops the notification subscription too; no stopNotifications() round trip.
    if (server?.connected && !this.opened) server.disconnect()
  }

  /** Revoke this origin's permission for the device (Chrome `BluetoothDevice.forget()`), then close. */
  async forget(): Promise<void> {
    await this.close()
    await this.device.forget?.()
  }

  async send(packet: Uint8Array): Promise<void> {
    if (!this.isOpen || !this.resolved) throw new TransportError('Bluetooth device is not connected')
    if (packet.length === 0 || packet.length > BLE_MAX_FRAME) throw new TransportError(`frame length ${packet.length} not in 1..${BLE_MAX_FRAME}`)
    const frame = packet.slice()
    return this.enqueue(() => this.writeFrame(frame))
  }

  /**
   * Services and characteristics this origin may open, with properties, for the diagnostic report
   * and the hardware check ("FEE7 visible", FAMILIES.md §5.7). Serialized with the writes.
   */
  async inspectGatt(): Promise<BleGattInventory> {
    const server = this.device.gatt
    if (!server?.connected) throw new TransportError('Bluetooth device is not connected')
    return this.enqueue(async () => {
      const services = server.getPrimaryServices ? await server.getPrimaryServices() : this.resolved ? [this.resolved.service] : []
      const out: BleGattInventory = { services: [] }
      for (const s of services) {
        const chars = s.getCharacteristics ? await s.getCharacteristics().catch(() => []) : []
        out.services.push({ uuid: s.uuid, characteristics: chars.map((c) => ({ uuid: c.uuid, properties: copyProperties(c.properties) ?? {} })) })
      }
      return out
    })
  }

  diagnostics(): WebBluetoothDiagnostics {
    const r = this.resolved
    const s = this.stats
    return {
      deviceId: this.device.id,
      name: this.device.name ?? null,
      product: this.product ? displayName(this.product) : null,
      service: r ? r.service.uuid : null,
      write: r ? r.write.uuid : null,
      notify: r ? r.notify.uuid : null,
      linkWriteMode: r ? r.candidate.link.writeMode : null,
      writeMode: this.writeModeInUse,
      writeProperties: r ? copyProperties(r.write.properties) : null,
      notifyProperties: r ? copyProperties(r.notify.properties) : null,
      writeChunkSize: this.chunkSize,
      fellBackToMinChunk: this.fellBack,
      framesWritten: s.framesWritten,
      piecesWritten: s.piecesWritten,
      notifications: s.notifications,
      notificationBytes: s.notifications ? { min: s.min, max: s.max, last: s.last } : null,
      connectAttempts: s.connectAttempts,
      serviceFoundByCharacteristicSearch: r?.bySearch ?? false,
    }
  }

  // ------------------------------------------------------------------------------ internals

  private label(): string {
    const p = this.resolved?.candidate.product ?? (this.candidates.length === 1 ? this.candidates[0].product : null)
    return this.device.name || (p ? displayName(p) : `Bluetooth device ${this.device.id}`)
  }

  private initialChunkSize(mode: WebBluetoothLinkSpec['writeMode']): number {
    const o = this.options.writeChunkSize
    if (typeof o === 'number') {
      if (!Number.isInteger(o) || o < 1 || o > BLE_MAX_ATTRIBUTE_LENGTH) throw new RangeError(`writeChunkSize must be 1..${BLE_MAX_ATTRIBUTE_LENGTH}, got ${o}`)
      return o
    }
    return defaultBleWriteChunk(mode, this.options.platform)
  }

  private async doOpen(): Promise<void> {
    const server = this.device.gatt
    if (!server) throw new TransportError(`${this.label()} has no GATT server`)
    this.closing = false
    await this.connectGatt(server)
    this.device.addEventListener('gattserverdisconnected', this.onGattDisconnected)
    this.deviceListening = true
    try {
      const r = await this.resolveLink(server)
      this.resolved = r
      this.writeModeInUse = this.pickWriteMode(r)
      if (typeof this.options.writeChunkSize !== 'number' && !this.fellBack) this.chunkSize = this.initialChunkSize(this.writeModeInUse)
      // Listen before subscribing so the first notification is not lost. "Connected" only after the
      // subscription succeeds, as A BleBoxOption…onMtuChanged → setNotify() does.
      r.notify.addEventListener('characteristicvaluechanged', this.onValue)
      this.attachedNotify = r.notify
      const np = r.notify.properties
      if (np && !np.notify && !np.indicate) this.debug(`notify characteristic ${shortBleUuid(r.notify.uuid)} reports neither notify nor indicate; subscribing anyway`)
      await r.notify.startNotifications()
    } catch (e) {
      this.detach()
      if (server.connected) server.disconnect()
      throw e instanceof TransportError ? e : new TransportError(`${this.label()}: GATT setup failed: ${errorText(e)}`, { cause: e })
    }
    this.options.assembler?.reset()
    this.opened = true
    const r = this.resolved!
    this.debug(
      `opened ${this.label()} (${this.info.id}) as ${r.candidate.product ? displayName(r.candidate.product) : 'ad-hoc link'}: ` +
        `service ${shortBleUuid(r.service.uuid)}, write ${shortBleUuid(r.write.uuid)} (${this.writeModeInUse}), ` +
        `notify ${shortBleUuid(r.notify.uuid)}, write chunk ${this.chunkSize} B`,
    )
  }

  private async connectGatt(server: BleGattServerLike): Promise<void> {
    if (server.connected) return
    const attempts = Math.max(1, this.options.connectAttempts ?? 3)
    const timeoutMs = this.options.connectTimeoutMs ?? 10_000
    let last: unknown
    for (let i = 1; i <= attempts; i++) {
      this.stats.connectAttempts++
      try {
        await withTimeout(server.connect(), timeoutMs, () => server.disconnect(), 'GATT connect')
        if (server.connected) return
        last = new TransportError('GATT connect resolved but the server is not connected')
      } catch (e) {
        last = e
      }
      this.debug(`GATT connect attempt ${i}/${attempts} to ${this.label()} failed: ${errorText(last)}`)
      if (i < attempts) await sleep((this.options.connectRetryDelayMs ?? 250) * i)
    }
    throw new TransportError(`could not connect to ${this.label()} over Bluetooth: ${errorText(last)}`, { cause: last })
  }

  /** First candidate whose service and characteristics exist (identifies MAX 2 BOX vs MELO P1). */
  private async resolveLink(server: BleGattServerLike): Promise<ResolvedLink> {
    const errors: string[] = []
    for (const candidate of this.candidates) {
      const { link } = candidate
      try {
        const { service, bySearch } = await this.findService(server, link)
        const write = await service.getCharacteristic(canonicalBleUuid(link.write))
        const notify = bleUuidEquals(link.notify, link.write) ? write : await service.getCharacteristic(canonicalBleUuid(link.notify))
        return { candidate, service, write, notify, bySearch }
      } catch (e) {
        errors.push(`${candidate.product ? displayName(candidate.product) : shortBleUuid(link.service)}: ${errorText(e)}`)
      }
    }
    throw new TransportError(`${this.label()} offers none of the expected GATT services (${errors.join('; ')})`)
  }

  /**
   * The link's service; failing that, any service this origin may open that holds the write
   * characteristic: A BleBoxOption$connect$1.onConnectSuccess walks every service for FEC1 and
   * adopts whichever service contains it (max2-6701.md §2.2).
   */
  private async findService(server: BleGattServerLike, link: WebBluetoothLinkSpec): Promise<{ service: BleServiceLike; bySearch: boolean }> {
    try {
      return { service: await server.getPrimaryService(canonicalBleUuid(link.service)), bySearch: false }
    } catch (e) {
      if (!server.getPrimaryServices) throw e
      const all = await server.getPrimaryServices().catch(() => [] as BleServiceLike[])
      for (const s of all) {
        const c = await s.getCharacteristic(canonicalBleUuid(link.write)).catch(() => null)
        if (c) {
          this.debug(`service ${shortBleUuid(link.service)} not found; characteristic ${shortBleUuid(link.write)} found in service ${shortBleUuid(s.uuid)}`)
          return { service: s, bySearch: true }
        }
      }
      throw e
    }
  }

  /**
   * The link's write mode unless the characteristic cannot do it. Android does the same implicitly:
   * FastBle never sets a write type (A com/clj/fastble/bluetooth/BleConnector.writeCharacteristic
   * only checks properties & (WRITE_NO_RESPONSE | WRITE)), so the characteristic's default type,
   * derived from its properties, is used.
   */
  private pickWriteMode(r: ResolvedLink): WebBluetoothLinkSpec['writeMode'] {
    const want = this.options.writeMode ?? r.candidate.link.writeMode
    const p = r.write.properties
    if (!p || this.options.writeMode) return want
    if (want === 'without-response' && !p.writeWithoutResponse && p.write) {
      this.debug(`characteristic ${shortBleUuid(r.write.uuid)} has no write-without-response property; writing with response`)
      return 'with-response'
    }
    if (want === 'with-response' && !p.write && p.writeWithoutResponse) {
      this.debug(`characteristic ${shortBleUuid(r.write.uuid)} has no write property; writing without response`)
      return 'without-response'
    }
    if (!p.write && !p.writeWithoutResponse) this.debug(`characteristic ${shortBleUuid(r.write.uuid)} reports no write property`)
    return want
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.gattQueue.then(op, op)
    this.gattQueue = run.catch(() => undefined)
    return run
  }

  private async writeFrame(frame: Uint8Array): Promise<void> {
    const r = this.resolved
    // Frames accepted by send() still go out while close() drains; only a lost link stops them.
    if (!r || !this.device.gatt?.connected) throw new TransportError('Bluetooth device disconnected before the write')
    const size = this.chunkSize
    const pieces = frame.length <= size ? [frame] : chunkBytes(frame, size)
    for (let i = 0; i < pieces.length; i++) {
      try {
        await this.writePiece(r.write, pieces[i])
        this.stats.piecesWritten++
      } catch (e) {
        if (!this.device.gatt?.connected) {
          this.handleGattDisconnected()
          throw new TransportError('Bluetooth device disconnected during a write', { cause: e })
        }
        // Nothing of this frame reached the device yet: resend it in 20-byte pieces (FAMILIES.md §3.4).
        const canFallBack = (this.options.fallbackToMinChunk ?? true) && i === 0 && size > BLE_MIN_WRITE_CHUNK && frame.length > BLE_MIN_WRITE_CHUNK
        if (canFallBack) {
          this.chunkSize = BLE_MIN_WRITE_CHUNK
          this.fellBack = true
          this.debug(`GATT write of ${pieces[0].length} B failed (${errorText(e)}); using ${BLE_MIN_WRITE_CHUNK}-byte pieces from now on`)
          return this.writeFrame(frame)
        }
        throw new TransportError(`GATT write failed: ${errorText(e)}`, { cause: e })
      }
      if (this.options.chunkDelayMs && i < pieces.length - 1) await sleep(this.options.chunkDelayMs)
    }
    this.stats.framesWritten++
  }

  private writePiece(ch: BleCharacteristicLike, piece: Uint8Array): Promise<void> {
    const data = new Uint8Array(piece) // own ArrayBuffer (BufferSource)
    if (this.writeModeInUse === 'without-response' && ch.writeValueWithoutResponse) return ch.writeValueWithoutResponse(data)
    if (this.writeModeInUse === 'with-response' && ch.writeValueWithResponse) return ch.writeValueWithResponse(data)
    if (ch.writeValue) return ch.writeValue(data)
    return Promise.reject(new TransportError(`characteristic ${shortBleUuid(ch.uuid)} cannot be written by this browser`))
  }

  private handleValue(e: Event): void {
    const c = (e.target as BleCharacteristicLike | null) ?? this.attachedNotify
    const v = c?.value
    if (!v) return
    const chunk = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice()
    const s = this.stats
    s.notifications++
    s.last = chunk.length
    s.min = Math.min(s.min, chunk.length)
    s.max = Math.max(s.max, chunk.length)
    // GATT notifications are not filtered by the OS the way undeclared HID input reports are.
    if (this.capabilities.receive !== 'yes') this.capabilities = { ...this.capabilities, receive: 'yes' }
    const a = this.options.assembler
    if (a) {
      for (const f of a.push(chunk)) this.emitPacket(f)
    } else {
      this.emitPacket(chunk)
    }
  }

  private handleGattDisconnected(): void {
    const wasOpen = this.opened
    this.detach()
    this.opened = false
    this.options.assembler?.reset()
    if (this.closing || !wasOpen) return
    this.debug(`${this.label()} disconnected`)
    this.emitDisconnect(new TransportError(`${this.label()} disconnected (out of range, powered off, or Bluetooth turned off)`))
  }

  private detach(): void {
    if (this.attachedNotify) {
      this.attachedNotify.removeEventListener('characteristicvaluechanged', this.onValue)
      this.attachedNotify = null
    }
    if (this.deviceListening) {
      this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnected)
      this.deviceListening = false
    }
  }
}

/** Chrome: NotFoundError "User cancelled the requestDevice() chooser." (also NotFoundError: "Bluetooth adapter not available."). */
function isChooserCancel(e: unknown): boolean {
  return errorName(e) === 'NotFoundError' && /cancel/i.test((e as Error).message ?? '')
}
