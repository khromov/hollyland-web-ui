/**
 * Static driver registry (docs/FAMILIES.md §3.2): one FamilyDriver per family code, imported statically
 * from every family folder, so this file and index.ts never change when a family lands. Every driver
 * comes with its simulator and `?mock=` presets: this is the registry of tests, Node scripts and the dev
 * server. The app opens devices through core/loader.ts instead (openMicDevice), which fetches a
 * family's code with import() and carries no simulator; canConnect / unsupportedReason / allProducts /
 * productsOf live there (they need no driver code) and are re-exported here.
 *
 *   const dev = createMicDevice(transport)            // picks the driver by VID/PID
 *   const { device } = createMockDevice('a2')          // dev presets (?mock=a2)
 */
import { UnsupportedError } from '../device-errors'
import { familyCodeOf, resolveProduct, type ProductInfo } from '../models'
import type { MockTransport } from '../mock'
import type { Transport } from '../transport'
import { driver as a1Driver } from '../families/6108'
import { driver as meloDriver } from '../families/6201'
import { driver as m3Driver } from '../families/6303'
import { driver as max2Driver } from '../families/6701'
import { LEGACY_DRIVERS } from '../families/legacy/driver'
import type { FamilyCode } from './ids'
import { unsupportedReason } from './loader'
import { simulatedTransport } from './simulate'
import type { DeviceSimulator, FamilyDriver, MicDevice, MicDeviceOptions, MockPreset, SimOptions } from './types'

export { allProducts, canConnect, productsOf, unsupportedReason } from './loader'

/** Every family driver by code. Legacy codes map to LegacyMicDevice drivers. */
export const DRIVERS: Readonly<Record<FamilyCode, FamilyDriver>> = {
  ...LEGACY_DRIVERS,
  '6108': a1Driver,
  '6201': meloDriver,
  '6303': m3Driver,
  '6701': max2Driver,
}

export function driverForCode(code: FamilyCode): FamilyDriver {
  return DRIVERS[code]
}

/** The driver of a product row (by `familyCode`, else derived from `family` / `code`). */
export function driverFor(product: ProductInfo): FamilyDriver | undefined {
  const code = familyCodeOf(product)
  return code ? DRIVERS[code] : undefined
}

/**
 * The MicDevice for a transport: LegacyMicDevice for the `AA DD` families, the family's
 * FamilyDevice otherwise. Throws UnsupportedError for unknown, stub and recognised-only products.
 * Synchronous twin of core/loader.ts openMicDevice (which the app uses).
 */
export function createMicDevice(transport: Transport, o: MicDeviceOptions = {}): MicDevice {
  const info = transport.info
  const product = o.product ?? resolveProduct(info?.vendorId ?? 0, info?.productId ?? 0)
  const reason = unsupportedReason(product)
  if (reason) throw new UnsupportedError(reason)
  return driverFor(product)!.createDevice(transport, product, o)
}

/** Dev presets of every driver that can simulate (`?mock=<id>`). */
export function mockPresets(): MockPreset[] {
  return Object.values(DRIVERS).flatMap((d) => (d.status === 'stub' ? [] : d.mockPresets))
}

export function findMockPreset(id: string): { preset: MockPreset; driver: FamilyDriver; product: ProductInfo } | undefined {
  for (const d of Object.values(DRIVERS)) {
    if (d.status === 'stub') continue
    const preset = d.mockPresets.find((p) => p.id === id)
    if (!preset) continue
    const product = d.products.find((p) => p.productId === preset.productId)
    if (product) return { preset, driver: d, product }
  }
  return undefined
}

export interface MockDevice {
  device: MicDevice
  simulator: DeviceSimulator
  transport: MockTransport
  preset: MockPreset
}

/** A MicDevice on a simulator, from a preset id (development and tests; no hardware involved). */
export function createMockDevice(id: string, o: MicDeviceOptions & { latencyMs?: number; sim?: SimOptions } = {}): MockDevice {
  const found = findMockPreset(id)
  if (!found) throw new UnsupportedError(`no mock preset "${id}" (available: ${mockPresets().map((p) => p.id).join(', ')})`)
  const { preset, driver, product } = found
  const simulator = driver.createSimulator(product, { ...preset.sim, ...o.sim })
  const transport = simulatedTransport(simulator, { latencyMs: o.latencyMs })
  const { latencyMs: _l, sim: _s, ...deviceOptions } = o
  const device = driver.createDevice(transport, product, deviceOptions)
  return { device, simulator, transport, preset }
}
