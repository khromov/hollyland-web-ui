/**
 * The LARK M3 FamilyDriver (Phase 2, W6). Registered since Phase 3 (W9): index.ts exports
 * `createM3Driver({ products: M3_PRODUCTS })` as the family's `driver`; runtime.ts is the same driver without the
 * simulator (what the app loads).
 *
 *   const d = createM3Driver()
 *   const mic = d.createDevice(new WebHidTransport(hidDevice), d.products[2])     // phone RX 2CH
 *   const { device } = createMockDevice('m3cam')                                  // core/registry.ts
 */
import type { FamilyDriver, MockPreset } from '../../core/types'
import { createM3Runtime, type M3DriverOptions } from './runtime'
import { M3Simulator } from './sim'

export type { M3DriverOptions } from './runtime'

const ALL_TX = ['rx', 'tx1', 'tx2', 'tx3', 'tx4'] as const

/** `?mock=` presets (unique across drivers). The ones with simulator options get their own conformance check-10 run. */
export const M3_MOCK_PRESETS: readonly MockPreset[] = [
  { id: 'm3', label: 'LARK M3 phone RX (2CH, simulated)', family: '6303', productId: 1038 },
  { id: 'm3-4ch', label: 'LARK M3 phone RX (4CH, four mics, simulated)', family: '6303', productId: 1039, sim: { online: ALL_TX } },
  { id: 'm3cam', label: 'LARK M3 camera RX (2CH, simulated)', family: '6303', productId: 1036 },
  { id: 'm3cam4', label: 'LARK M3 camera RX (4CH, four mics, simulated)', family: '6303', productId: 1037, sim: { online: ALL_TX } },
  { id: 'm3-secondary', label: 'LARK M3 phone RX as a secondary RX (two RXs, simulated)', family: '6303', productId: 1038, sim: { profile: 'secondary' } },
  { id: 'm3-multi', label: 'LARK M3 camera RX, primary of three RXs (simulated)', family: '6303', productId: 1036, sim: { profile: 'multi-rx' } },
  { id: 'm3-2t2r', label: 'LARK M3 phone RX in 2TX&2RX (wireless monitoring, simulated)', family: '6303', productId: 1038, sim: { profile: '2t2r' } },
]

export function createM3Driver(o: M3DriverOptions = {}): FamilyDriver {
  return { ...createM3Runtime(o), createSimulator: (product, sim) => new M3Simulator(product, sim), mockPresets: M3_MOCK_PRESETS }
}
