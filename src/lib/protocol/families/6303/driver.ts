/**
 * The LARK M3 FamilyDriver (Phase 2, W6). It is NOT the registered driver yet: the registry keeps `driver` (index.ts),
 * a stub with the real command catalogue and frame classifier, so the M3 stays recognised-only until the UI
 * integration (Phase 3) registers this one (FAMILIES.md §2.2 W9; core/__tests__/registry.test.ts pins the stub).
 *
 *   const d = createM3Driver()
 *   const mic = d.createDevice(new WebHidTransport(hidDevice), d.products[2])     // phone RX 2CH
 *   const { device } = …createMockDevice('m3cam')                                 // once registered
 */
import type { FamilyDriver, MockPreset } from '../../core/types'
import type { ProductInfo } from '../../models'
import { MOMA_6303 } from '../../moma/profiles'
import { momaCommandOfFrame } from '../../moma/spec'
import { M3_COMMANDS } from './commands'
import { M3_ALL_CONTROLS } from './controls'
import { M3_HARDWARE_CHECK } from './hardware-check'
import { M3_RESEARCH, m3ExperimentalProducts } from './products'
import { createM3Device } from './session'
import { M3Simulator } from './sim'

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

export interface M3DriverOptions {
  /** Default: the four M3 rows with support.level 'experimental' (hardware 'untested'). */
  products?: readonly ProductInfo[]
}

export function createM3Driver(o: M3DriverOptions = {}): FamilyDriver {
  const products = o.products ?? m3ExperimentalProducts()
  return {
    code: '6303',
    name: 'LARK M3',
    status: 'experimental',
    products,
    commands: M3_COMMANDS,
    controls: M3_ALL_CONTROLS,
    research: M3_RESEARCH,
    createDevice: (transport, product, opts) => createM3Device(transport, product, opts),
    createSimulator: (product, sim) => new M3Simulator(product, sim),
    commandOfFrame: (f) => momaCommandOfFrame(MOMA_6303, f, M3_COMMANDS),
    mockPresets: M3_MOCK_PRESETS,
    hardwareCheck: M3_HARDWARE_CHECK,
  }
}
