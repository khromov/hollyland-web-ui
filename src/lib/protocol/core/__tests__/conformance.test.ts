/**
 * The shared conformance suite run against the toy driver (proves the engine) and the legacy
 * drivers (proves the LegacyMicDevice adapter). Family folders run it on their own drivers.
 */
import { CONTROL } from '../controls'
import { describeDriverConformance } from '../conformance'
import { LEGACY_DRIVERS } from '../../families/legacy'
import { lookupProduct } from '../../models'
import type { SimulatedReceiver } from '../../mock'
import type { LegacySimulator } from '../../families/legacy'
import { toyDriver, type ToySimulator } from './toy-driver'

describeDriverConformance(toyDriver, {
  gates: [
    { name: 'LED below 1.2.0 is unavailable', sim: { rxVersion: '1.1.9' }, control: CONTROL.LED, expect: 'unavailable' },
    { name: 'LED at 1.2.0 (inclusive) is available', sim: { rxVersion: '1.2.0' }, control: CONTROL.LED, expect: 'ok' },
  ],
  preconditions: [
    { name: 'volume needs a mic online', sim: { online: ['rx'] }, control: CONTROL.VOLUME, value: 1, reason: 'mic-disconnected' },
    {
      name: 'NC level needs NC on', arrange: (s) => ((s as ToySimulator).ncOn = false), control: CONTROL.NOISE_LEVEL, value: 1,
      reason: 'noise-off',
    },
  ],
})

const receiver = (s: unknown): SimulatedReceiver => (s as LegacySimulator).receiver

describeDriverConformance(LEGACY_DRIVERS['6118'], {
  chunkSizes: [], // HID reports never split a legacy frame (PROTOCOL.md §3.4)
  preconditions: [
    {
      name: 'NC level is refused while NC is off', arrange: (s) => (receiver(s).noiseEnabled = false), control: CONTROL.NOISE_LEVEL,
      value: 1, reason: 'noise-off',
    },
    { name: 'volume needs a mic online', sim: { online: ['rx'] }, control: CONTROL.VOLUME, value: 1, reason: 'mic-disconnected' },
  ],
})
describeDriverConformance(LEGACY_DRIVERS['6301'], { chunkSizes: [] })
describeDriverConformance(LEGACY_DRIVERS['6302'], {
  chunkSizes: [],
  gates: [
    // GATE_6302_SPEC: strictly above 2.0.0.9 on both apps (models.ts).
    { name: 'LED at 2.0.0.9 is unavailable', sim: { rxVersion: '2.0.0.9' }, control: CONTROL.LED, expect: 'unavailable' },
    { name: 'LED at 2.0.0.10 is available', sim: { rxVersion: '2.0.0.10' }, control: CONTROL.LED, expect: 'ok' },
  ],
  preconditions: [
    {
      name: 'volume is refused while locked (camera RX)', product: lookupProduct(0x3547, 1030),
      arrange: (s) => (receiver(s).voiceLocked = true), control: CONTROL.VOLUME, value: 1, reason: 'volume-locked',
    },
  ],
})
// 6501 (Phase 1, W1): run with its preconditions in families/legacy/__tests__/6501.test.ts.
