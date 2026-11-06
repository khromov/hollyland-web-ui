/**
 * The MELO P1 FamilyDriver (Phase 2, W8): status 'experimental', receivers 1032 / 1033 connectable, hardware
 * 'untested' (destructive and OTA commands refused by the engine, disruptive controls need a per-call confirm).
 *
 * Registered since Phase 3 (W9): index.ts exports MELO_DRIVER as the family's `driver`, and the receiver rows in
 * products.ts carry MELO_EXPERIMENTAL_SUPPORT. runtime.ts is the same driver without the simulator (what the app loads).
 *
 *   const d = createMeloDriver()
 *   const t = await WebBluetoothTransport.request()                 // MELO P1 RX: FFE0 / FFE1 / FFE2
 *   const mic = d.createDevice(t!, d.products[0]) as MeloDevice     // BLE profile picked from the transport
 */
import type { FamilyDriver, MockPreset } from '../../core/types'
import type { ProductInfo } from '../../models'
import { createMeloRuntime } from './runtime'
import { MeloSimulator } from './sim'

export { meloCommandOfFrame } from './runtime'

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

export function createMeloDriver(o: { products?: readonly ProductInfo[] } = {}): FamilyDriver {
  return { ...createMeloRuntime(o), createSimulator: (product, sim) => new MeloSimulator(product, sim), mockPresets: MELO_MOCK_PRESETS }
}

/** The Phase 2 driver instance (tests, Phase 3 integration). */
export const MELO_DRIVER: FamilyDriver = /* @__PURE__ */ createMeloDriver()
