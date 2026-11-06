/**
 * The MELO P1 FamilyDriver (Phase 2, W8): status 'experimental', receivers 1032 / 1033 connectable, hardware
 * 'untested' (destructive and OTA commands refused by the engine, disruptive controls need a per-call confirm).
 *
 * It is not registered yet: core/registry.ts uses `driver` from index.ts, which stays a stub with this driver's
 * command catalogue and frame classifier, because the registry's shared tests pin the 6201 driver as a stub
 * and the receiver rows as recognised-only (core/__tests__/registry.test.ts, __tests__/webhid.test.ts). Registering
 * it is two lines in this folder (index.ts `driver = createMeloDriver()`, products.ts MELO_SUPPORT level
 * 'experimental') plus those shared test expectations.
 *
 *   const d = createMeloDriver()
 *   const t = await WebBluetoothTransport.request()                 // MELO P1 RX: FFE0 / FFE1 / FFE2
 *   const mic = d.createDevice(t!, d.products[0]) as MeloDevice     // BLE profile picked from the transport
 */
import { UnsupportedError } from '../../device'
import { momaCommandOfFrame } from '../../moma/spec'
import { MOMA_6201_BLE, MOMA_6201_IOS, MOMA_6201_USB } from '../../moma/profiles'
import { displayName, type ProductInfo } from '../../models'
import type { FamilyDriver, MockPreset } from '../../core/types'
import { MELO_COMMANDS } from './commands'
import { MELO_CONTROLS } from './controls'
import { createMeloDevice } from './device'
import { MELO_HARDWARE_CHECK } from './hardware-check'
import { MELO_RESEARCH, MELO_RX_PRODUCT_IDS, meloExperimentalProducts } from './products'
import { MeloSimulator } from './sim'

/** Command id of a MELO P1 request frame in any of the three framings (USB, BLE, iOS), or null. */
export function meloCommandOfFrame(frame: Uint8Array): number | null {
  for (const p of [MOMA_6201_USB, MOMA_6201_BLE, MOMA_6201_IOS]) {
    const c = momaCommandOfFrame(p, frame, MELO_COMMANDS)
    if (c !== null) return c
  }
  return null
}

/**
 * Dev presets (`?mock=<id>` once registered). The default simulator is current firmware (4.0.1.2: V2 structures,
 * per-mic gain) with the whole kit online. The firmware presets sit on each side of the two gates.
 */
export const MELO_MOCK_PRESETS: readonly MockPreset[] = [
  { id: 'melo', label: 'MELO P1 (simulated, firmware 4.0.1.2)', family: '6201', productId: 1032 },
  { id: 'melo-fw3079', label: 'MELO P1 (firmware 3.0.7.9: per-mic gain, V1 structures)', family: '6201', productId: 1032, sim: { rxVersion: '3.0.7.9' } },
  { id: 'melo-fw3070', label: 'MELO P1 (firmware 3.0.7.0: Near / Mid / Far gain)', family: '6201', productId: 1032, sim: { rxVersion: '3.0.7.0' } },
  { id: 'melo-1mic', label: 'MELO P1 (one mic, nothing in the 3.5 mm jack)', family: '6201', productId: 1032, sim: { online: ['rx', 'tx1', 'box'], params: { jack: 'empty' } } },
  { id: 'melo-sub', label: 'MELO P1 second-phone port (simulated)', family: '6201', productId: 1033 },
]

function isReceiver(p: ProductInfo): boolean {
  return MELO_RX_PRODUCT_IDS.includes(p.productId) && p.vendorId !== 0
}

export function createMeloDriver(o: { products?: readonly ProductInfo[] } = {}): FamilyDriver {
  const products = o.products ?? meloExperimentalProducts()
  return {
    code: '6201',
    name: 'MELO P1',
    status: 'experimental',
    products,
    commands: MELO_COMMANDS,
    controls: MELO_CONTROLS,
    research: MELO_RESEARCH,
    createDevice: (transport, product, opts) => {
      if (!isReceiver(product)) throw new UnsupportedError(`${displayName(product)} is recognised but not supported yet: the official app only updates its firmware`)
      return createMeloDevice(transport, product, opts)
    },
    createSimulator: (product, sim) => new MeloSimulator(product, sim),
    commandOfFrame: meloCommandOfFrame,
    mockPresets: MELO_MOCK_PRESETS,
    hardwareCheck: MELO_HARDWARE_CHECK,
  }
}

/** The Phase 2 driver instance (tests, Phase 3 integration). */
export const MELO_DRIVER: FamilyDriver = /* @__PURE__ */ createMeloDriver()
