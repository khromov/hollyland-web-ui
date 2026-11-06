/**
 * LARK A1 (family 6108 / A6108): feature-report framing "ProtocolV2".
 * Spec: docs/research/families/a1-6108.md. Owner: W3/W5 (docs/FAMILIES.md §3.7).
 *
 *   codec.ts          `05 03 AA DD cmd len16 payload EF` encoder, reply decoder, request parser, report assembler
 *   commands.ts       A1 command catalogue (safety classes, citations), request builders, value enums, unit bytes
 *   status.ts         heartbeat 0x1F parser (17 / 22 / 23-byte bodies, iOS branching), identity / ack / GET parsers,
 *                     heartbeat → MicState units and values
 *   controls.ts       ControlSpecs (official labels), availability (RX >= 1.0.1.3 mute gate, 2- vs 4-mic, the app's
 *                     preconditions), control writes → requests (Phase 2, W5)
 *   session.ts        ProtocolSpec (probe, 1 s poll, identity, correlation, acks, availability) + createA1Device
 *   sim.ts            simulator (2 / 4-mic firmware, 17 / 22 / 23-byte heartbeats, ack codes, stale-reply fault)
 *   hardware-check.ts first-contact steps (§5.7), the LED write last
 *   driver.ts         createA1Driver() (the registered driver), mock presets, createA1WireDriver() (read-only)
 *   runtime.ts        createA1Runtime() / A1_RUNTIME: the driver without the simulator (what the app loads, core/loader.ts)
 *   ids.ts            control ids and the mic-slot rule the app uses without loading the driver
 *   transports/webhid-feature.ts  WebHidFeatureTransport (SET_REPORT + GET_REPORT on feature report 5)
 *
 * Status: experimental, hardware 'untested' (no A1 has been on the bench). Destructive and OTA ids (the 2↔4-mic
 * wireless switch, firmware update) are catalogued only and refused by the engine; the Wireless settings control is
 * catalogue-only (destructive, hidden, refused by the encoder).
 */
import type { FamilyDriver } from '../../core/types'
import { createA1Driver } from './driver'

export * from './products'
export * from './codec'
export * from './commands'
export * from './status'
export * from './controls'
export * from './session'
export * from './sim'
export * from './hardware-check'
export * from './driver'
export * from './runtime'

export const driver: FamilyDriver = /* @__PURE__ */ createA1Driver()
