/**
 * LARK M3 (family 6303): Moma framing with report id 8 (moma/ profile MOMA_6303).
 * Spec: docs/research/families/m3-6303.md. Owner: W6 (docs/FAMILIES.md §3.7).
 *
 *   products.ts       registry rows (recognised) and their experimental copies, PID helpers (camera / phone RX)
 *   commands.ts       command catalogue (Android Command6303 + iOS HL6303CommandType, safety classes), payload ids,
 *                     request builders
 *   status.ts         0x6000 heartbeat (30 B) → units / values / availability, 0x600A / 0x6012 / 0x6011 / 0x100E parsers
 *   controls.ts       home page and More Settings ControlSpecs, per PID
 *   session.ts        ProtocolSpec (start-up reads, correlation, writes) and M3Device (per-value 4-track confirm)
 *   sim.ts            simulator: multi-RX topology, primary / secondary, 4T4R / 2T2R, isRefreshCanto, BT events
 *   hardware-check.ts first-contact steps (§5.7)
 *   driver.ts         createM3Driver(): the Phase 2 'experimental' driver, mock presets
 *
 * The registered `driver` stays a stub (products recognised only, createDevice refuses) but carries the real command
 * catalogue, frame classifier and hardware check. Registering the full driver takes two lines in this folder, rows
 * built with M3_EXPERIMENTAL_SUPPORT in products.ts and `export const driver = createM3Driver({ products: M3_PRODUCTS })`
 * here, plus the shared registry test's expectations (core/__tests__/registry.test.ts pins the stub status, the
 * connectable PIDs and the preset list); that belongs with the UI integration (Phase 3).
 */
import { stubDriver } from '../../core/stub'
import type { FamilyDriver } from '../../core/types'
import { MOMA_6303 } from '../../moma/profiles'
import { momaCommandOfFrame } from '../../moma/spec'
import { M3_COMMANDS } from './commands'
import { M3_HARDWARE_CHECK } from './hardware-check'
import { M3_PRODUCTS, M3_RESEARCH } from './products'

export * from './products'
export * from './commands'
export * from './status'
export * from './controls'
export * from './session'
export * from './sim'
export * from './hardware-check'
export * from './driver'

function partialStub(): FamilyDriver {
  return {
    ...stubDriver({ code: '6303', name: 'LARK M3', products: M3_PRODUCTS, research: M3_RESEARCH, hardwareCheck: M3_HARDWARE_CHECK }),
    // Wire layer available: sendRaw classification and the console can name and gate every M3 frame.
    commands: M3_COMMANDS,
    commandOfFrame: (f) => momaCommandOfFrame(MOMA_6303, f, M3_COMMANDS),
  }
}

export const driver: FamilyDriver = /* @__PURE__ */ partialStub()
