/**
 * A read-only LARK A1 FamilyDriver over the Phase 1 wire layer (W3). It is NOT the registered driver: the registry
 * keeps `driver` (index.ts), a stub with the real command catalogue, so the A1 stays recognised-only until the
 * Phase 2 driver (W5) adds controls, gates and preconditions and flips the rows to 'experimental'.
 *
 * Used by the tests (shared conformance suite against the simulator and the fake feature-report device) and as the
 * starting point for W5:
 *
 *   const d = createA1WireDriver()
 *   const mic = d.createDevice(new WebHidFeatureTransport(hidDevice), d.products[0])
 */
import type { FamilyDriver, MockPreset } from '../../core/types'
import type { ProductInfo } from '../../models'
import { a1CommandOfFrame } from './codec'
import { A1_COMMANDS } from './commands'
import { A1_HARDWARE_CHECK } from './hardware-check'
import { A1_PRODUCTS, A1_RESEARCH } from './products'
import { createA1Device, createA1Spec, type A1SpecOptions } from './session'
import { A1Simulator } from './sim'

/** The A1 rows with `support.level` 'experimental' (connectable), hardware still 'untested'. */
export function a1ExperimentalProducts(): ProductInfo[] {
  return A1_PRODUCTS.map((p) => ({ ...p, support: { ...p.support!, level: 'experimental' as const } }))
}

export const A1_MOCK_PRESETS: readonly MockPreset[] = [
  { id: 'a1', label: 'LARK A1 (2 Mic & 1 RX, simulated)', family: '6108', productId: 1031 },
  { id: 'a1-4mic', label: 'LARK A1 (4 Mic & 1 RX, simulated)', family: '6108', productId: 1031, sim: { profile: '4mic' } },
]

export interface A1WireDriverOptions extends A1SpecOptions {
  products?: readonly ProductInfo[]
}

export function createA1WireDriver(o: A1WireDriverOptions = {}): FamilyDriver {
  const products = o.products ?? a1ExperimentalProducts()
  const spec = createA1Spec(o)
  return {
    code: '6108',
    name: 'LARK A1',
    status: 'experimental',
    products,
    commands: A1_COMMANDS,
    controls: o.controls ? products.flatMap((p) => o.controls!(p)).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i) : [],
    research: A1_RESEARCH,
    createDevice: (transport, product, opts) => createA1Device(transport, product, opts, spec),
    createSimulator: (_product, sim) => new A1Simulator(sim),
    commandOfFrame: a1CommandOfFrame,
    mockPresets: A1_MOCK_PRESETS,
    hardwareCheck: A1_HARDWARE_CHECK,
  }
}
