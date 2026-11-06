/**
 * Lazy driver registry for the app (docs/FAMILIES.md §3.2). Product rows, links, support data and the chooser
 * filters stay synchronous (models.ts, transports/ble-links.ts, transports/feature-links.ts); a family's driver code
 * is fetched with import() the first time a product of that family is opened. A production build gets one chunk per
 * family (one for the four legacy `AA DD` families), and none of them carries simulator code: FamilyRuntime has none.
 *
 *   const mic = await openMicDevice(transport)          // fetches the family's chunk, then createDevice
 *   loadedDriverFor(mic.product)?.hardwareCheck         // synchronous once loaded
 *
 * core/registry.ts is the static registry (every FamilyDriver with its simulator and `?mock=` presets) for tests,
 * Node scripts and the dev server; its createMicDevice is the synchronous twin of openMicDevice.
 */
import { UnsupportedError } from '../device-errors'
import type { LegacyMicDevice } from '../families/legacy/adapter'
import { ALL_PRODUCTS, displayName, familyCodeOf, isConnectableProduct, resolveProduct, supportOf, type ProductInfo } from '../models'
import type { Transport } from '../transport'
import type { WebBluetoothTransport } from '../transports/web-bluetooth'
import type { WebHidFeatureTransport } from '../transports/webhid-feature'
import { isLegacyFamilyCode, type FamilyCode } from './ids'
import type { FamilyRuntime, MicDevice, MicDeviceOptions } from './types'

/**
 * Each family's driver status, known before its code is fetched (canConnect needs it on the connect page).
 * core/__tests__/registry.test.ts holds it equal to DRIVERS and to the loaded runtimes.
 */
export const DRIVER_STATUS: Readonly<Record<FamilyCode, FamilyRuntime['status']>> = {
  '6118': 'supported',
  '6301': 'supported',
  '6302': 'supported',
  '6501': 'experimental',
  '6108': 'experimental',
  '6201': 'experimental',
  '6303': 'experimental',
  '6701': 'experimental',
}

const legacy = () => import('../families/legacy/runtime')

/** One import() per family; the bundler turns each into its own chunk. */
const LOADERS: Readonly<Record<FamilyCode, () => Promise<FamilyRuntime>>> = {
  '6118': () => legacy().then((m) => m.LEGACY_RUNTIMES['6118']),
  '6301': () => legacy().then((m) => m.LEGACY_RUNTIMES['6301']),
  '6302': () => legacy().then((m) => m.LEGACY_RUNTIMES['6302']),
  '6501': () => legacy().then((m) => m.LEGACY_RUNTIMES['6501']),
  '6108': () => import('../families/6108/runtime').then((m) => m.A1_RUNTIME),
  '6201': () => import('../families/6201/runtime').then((m) => m.MELO_RUNTIME),
  '6303': () => import('../families/6303/runtime').then((m) => m.M3_RUNTIME),
  '6701': () => import('../families/6701/runtime').then((m) => m.MAX2_RUNTIME),
}

const pending = new Map<FamilyCode, Promise<FamilyRuntime>>()
const loaded = new Map<FamilyCode, FamilyRuntime>()

/**
 * The family's driver, fetched once: later calls share the promise. A failed fetch (offline, a stale deploy) is
 * forgotten, so the next call tries again.
 */
export function loadDriver(code: FamilyCode): Promise<FamilyRuntime> {
  let p = pending.get(code)
  if (!p) {
    p = LOADERS[code]().then(
      (d) => {
        loaded.set(code, d)
        return d
      },
      (e: unknown) => {
        pending.delete(code)
        throw e
      },
    )
    pending.set(code, p)
  }
  return p
}

/** The driver of a product row (by `familyCode`, else derived from `family` / `code`), or undefined. */
export async function loadDriverFor(product: ProductInfo): Promise<FamilyRuntime | undefined> {
  const code = familyCodeOf(product)
  return code ? loadDriver(code) : undefined
}

/** The driver of a product row if loadDriver() has fetched it already (synchronous), else undefined. */
export function loadedDriverFor(product: ProductInfo): FamilyRuntime | undefined {
  const code = familyCodeOf(product)
  return code ? loaded.get(code) : undefined
}

/** Whether a session can be opened: connectable row and a driver past the stub. */
export function canConnect(product: ProductInfo): boolean {
  const code = familyCodeOf(product)
  return !!code && DRIVER_STATUS[code] !== 'stub' && isConnectableProduct(product)
}

/** Why `canConnect` is false, for UI copy; null when it is true. */
export function unsupportedReason(product: ProductInfo): string | null {
  if (canConnect(product)) return null
  if (!familyCodeOf(product)) return `${displayName(product)} is not a product this app knows`
  return `${displayName(product)} is recognised but not supported yet (${supportOf(product).research})`
}

/** Every product row (USB and app/BLE). */
export function allProducts(): readonly ProductInfo[] {
  return ALL_PRODUCTS
}

/** Rows of one family. */
export function productsOf(code: FamilyCode): ProductInfo[] {
  return ALL_PRODUCTS.filter((p) => familyCodeOf(p) === code)
}

/**
 * The MicDevice for a transport, once its family's driver is fetched: LegacyMicDevice for the `AA DD` families, the
 * family's FamilyDevice otherwise. Rejects with UnsupportedError for unknown, stub and recognised-only products
 * before fetching anything.
 */
export async function openMicDevice(transport: Transport, o: MicDeviceOptions = {}): Promise<MicDevice> {
  const info = transport.info
  const product = o.product ?? resolveProduct(info?.vendorId ?? 0, info?.productId ?? 0)
  const reason = unsupportedReason(product)
  if (reason) throw new UnsupportedError(reason)
  const driver = await loadDriver(familyCodeOf(product)!)
  return driver.createDevice(transport, product, o)
}

/** Whether a MicDevice is a LegacyMicDevice (HollylandDevice underneath), checked without fetching the legacy driver. */
export function isLegacyMicDevice(d: unknown): d is LegacyMicDevice {
  const m = d as Partial<LegacyMicDevice> | null | undefined
  return !!m && typeof m === 'object' && isLegacyFamilyCode(m.family) && !!m.legacy
}

/** WebBluetoothTransport (LARK MAX 2 charging case, MELO P1), fetched on first use. */
export async function loadWebBluetoothTransport(): Promise<typeof WebBluetoothTransport> {
  return (await import('../transports/web-bluetooth')).WebBluetoothTransport
}

/** WebHidFeatureTransport (LARK A1 feature reports), fetched on first use. */
export async function loadWebHidFeatureTransport(): Promise<typeof WebHidFeatureTransport> {
  return (await import('../transports/webhid-feature')).WebHidFeatureTransport
}
