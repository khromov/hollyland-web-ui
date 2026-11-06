/**
 * The LARK A1 FamilyDriver (Phase 2, W5): the session of session.ts with the controls, firmware gate and
 * preconditions of controls.ts, the simulator of sim.ts and the first-contact checklist of hardware-check.ts.
 * The registered driver (index.ts `driver`) is `createA1Driver()`: runtime.ts (what the app loads) plus the simulator.
 * `support.hardware` stays 'untested', so the engine refuses destructive and OTA commands and hides destructive
 * controls (FAMILIES.md §2.3).
 *
 *   const mic = a1.driver.createDevice(new WebHidFeatureTransport(hidDevice), a1.A1_PRODUCTS[0])
 *
 * `createA1WireDriver()` is the Phase 1 read-only variant (no controls, every set() refused), kept for diagnostics.
 */
import type { FamilyDriver, MockPreset } from '../../core/types'
import type { ProductInfo } from '../../models'
import { A1_PRODUCTS } from './products'
import { createA1Runtime, type A1DriverOptions } from './runtime'
import { A1Simulator } from './sim'

export type { A1DriverOptions } from './runtime'

/**
 * Dev presets (`?mock=<id>`, FAMILIES.md §4.3), one per firmware case the UI must handle. Every one is also a
 * check-10 run of the conformance suite (populated after connect).
 */
export const A1_MOCK_PRESETS: readonly MockPreset[] = [
  { id: 'a1', label: 'LARK A1 (2 Mic & 1 RX, simulated)', family: '6108', productId: 1031 },
  { id: 'a1-4mic', label: 'LARK A1 (4 Mic & 1 RX, simulated)', family: '6108', productId: 1031, sim: { profile: '4mic' } },
  {
    id: 'a1-4mic-old', label: 'LARK A1 (4 Mic & 1 RX, older firmware: 22-byte heartbeat, no Mode setting)', family: '6108', productId: 1031,
    sim: { profile: '4mic-old' },
  },
  { id: 'a1-oldfw', label: 'LARK A1 (RX firmware 1.0.1.2: no per-mic mute)', family: '6108', productId: 1031, sim: { rxVersion: '1.0.1.2' } },
  { id: 'a1-blind', label: 'LARK A1 (GET_REPORT refused: write-only)', family: '6108', productId: 1031, sim: { dropReplies: true } },
]

export function createA1Driver(o: A1DriverOptions = {}): FamilyDriver {
  return { ...createA1Runtime(o), createSimulator: (_product, sim) => new A1Simulator(sim), mockPresets: A1_MOCK_PRESETS }
}

/** Phase 1 read-only driver over the same wire layer: no controls, every set() refused. */
export function createA1WireDriver(o: A1DriverOptions = {}): FamilyDriver {
  return createA1Driver({ ...o, readOnly: true })
}

/** The A1 rows (connectable since Phase 2: `support.level` 'experimental', hardware 'untested'). */
export function a1ExperimentalProducts(): ProductInfo[] {
  return [...A1_PRODUCTS]
}
