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
 * Registered since Phase 3 (W9): `driver` is createM3Driver() on the registry rows (M3_EXPERIMENTAL_SUPPORT in
 * products.ts: 'experimental', hardware 'untested', so destructive and OTA commands stay refused by the engine).
 */
import type { FamilyDriver } from '../../core/types'
import { createM3Driver } from './driver'
import { M3_PRODUCTS } from './products'

export * from './products'
export * from './commands'
export * from './status'
export * from './controls'
export * from './session'
export * from './sim'
export * from './hardware-check'
export * from './driver'

export const driver: FamilyDriver = /* @__PURE__ */ createM3Driver({ products: M3_PRODUCTS })
