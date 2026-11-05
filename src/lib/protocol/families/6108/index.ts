/**
 * LARK A1 (family 6108 / A6108): feature-report framing "ProtocolV2".
 * Spec: docs/research/families/a1-6108.md. Owner: W3/W5 (docs/FAMILIES.md §3.7).
 *
 * Phase 1 (W3, this state): the wire layer.
 *   codec.ts          `05 03 AA DD cmd len16 payload EF` encoder, reply decoder, request parser, report assembler
 *   commands.ts       A1 command catalogue (safety classes, citations), request builders, value enums, unit bytes
 *   status.ts         heartbeat 0x1F parser (17 / 22 / 23-byte bodies, iOS branching), identity / ack / GET parsers,
 *                     heartbeat → MicState units and values
 *   session.ts        read-only ProtocolSpec (probe, poll, identity, correlation) + createA1Device
 *   sim.ts            wire-level simulator (2 / 4-mic firmware, stale-reply fault)
 *   hardware-check.ts first-contact steps (§5.7)
 *   wire-driver.ts    createA1WireDriver(): an unregistered, read-only 'experimental' driver for tests and W5
 *   transports/webhid-feature.ts  WebHidFeatureTransport (SET_REPORT + GET_REPORT on feature report 5)
 *
 * The registered `driver` stays a stub (products recognised only, createDevice refuses) but carries the real command
 * catalogue and frame classifier. Phase 2 (W5) replaces it with createA1WireDriver({ controls, encodeSet, … }) and sets
 * the rows' `support.level` to 'experimental' in products.ts; the registry and index.ts pick it up unchanged.
 */
import { stubDriver } from '../../core/stub'
import type { FamilyDriver } from '../../core/types'
import { a1CommandOfFrame } from './codec'
import { A1_COMMANDS } from './commands'
import { A1_HARDWARE_CHECK } from './hardware-check'
import { A1_PRODUCTS, A1_RESEARCH } from './products'

export * from './products'
export * from './codec'
export * from './commands'
export * from './status'
export * from './session'
export * from './sim'
export * from './hardware-check'
export * from './wire-driver'

function partialStub(): FamilyDriver {
  return {
    ...stubDriver({ code: '6108', name: 'LARK A1', products: A1_PRODUCTS, research: A1_RESEARCH, hardwareCheck: A1_HARDWARE_CHECK }),
    // Wire layer available: sendRaw classification and the console can name and gate every A1 frame.
    commands: A1_COMMANDS,
    commandOfFrame: a1CommandOfFrame,
  }
}

export const driver: FamilyDriver = /* @__PURE__ */ partialStub()
