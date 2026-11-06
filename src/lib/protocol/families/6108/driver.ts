/**
 * The LARK A1 FamilyDriver (Phase 2, W5): the session of session.ts with the controls, firmware gate and
 * preconditions of controls.ts, the simulator of sim.ts and the first-contact checklist of hardware-check.ts.
 * The registered driver (index.ts `driver`) is `createA1Driver()`; `support.hardware` stays 'untested', so the
 * engine refuses destructive and OTA commands and hides destructive controls (FAMILIES.md §2.3).
 *
 *   const mic = a1.driver.createDevice(new WebHidFeatureTransport(hidDevice), a1.A1_PRODUCTS[0])
 *
 * `createA1WireDriver()` is the Phase 1 read-only variant (no controls, every set() refused), kept for diagnostics.
 */
import type { FamilyDriver, MockPreset } from '../../core/types'
import type { ProductInfo } from '../../models'
import { a1CommandOfFrame } from './codec'
import { A1_COMMANDS } from './commands'
import { A1_CONTROLS } from './controls'
import { A1_HARDWARE_CHECK } from './hardware-check'
import { A1_PRODUCTS, A1_RESEARCH } from './products'
import { createA1Device, createA1Spec, type A1SpecOptions } from './session'
import { A1Simulator } from './sim'

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

export interface A1DriverOptions extends A1SpecOptions {
  products?: readonly ProductInfo[]
}

export function createA1Driver(o: A1DriverOptions = {}): FamilyDriver {
  const products = o.products ?? A1_PRODUCTS
  const spec = createA1Spec(o)
  const controls = o.controls
    ? products.flatMap((p) => o.controls!(p)).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
    : o.readOnly
      ? []
      : A1_CONTROLS
  return {
    code: '6108',
    name: 'LARK A1',
    status: 'experimental',
    products,
    commands: A1_COMMANDS,
    controls,
    research: A1_RESEARCH,
    createDevice: (transport, product, opts) => createA1Device(transport, product, opts, spec),
    createSimulator: (_product, sim) => new A1Simulator(sim),
    commandOfFrame: a1CommandOfFrame,
    mockPresets: A1_MOCK_PRESETS,
    hardwareCheck: A1_HARDWARE_CHECK,
  }
}

/** Phase 1 read-only driver over the same wire layer: no controls, every set() refused. */
export function createA1WireDriver(o: A1DriverOptions = {}): FamilyDriver {
  return createA1Driver({ ...o, readOnly: true })
}

/** The A1 rows (connectable since Phase 2: `support.level` 'experimental', hardware 'untested'). */
export function a1ExperimentalProducts(): ProductInfo[] {
  return [...A1_PRODUCTS]
}
