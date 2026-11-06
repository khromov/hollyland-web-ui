/**
 * Family 6303: shared conformance suite (docs/FAMILIES.md §5.3).
 *  - the registered `driver` is still a stub (recognised only) but carries the real catalogue and frame classifier
 *  - the Phase 2 driver (createM3Driver, unregistered) runs the full suite against the simulator for every PID, every
 *    mock preset (check 10 runs each preset with simulator options) and the multi-RX / 2T2R profiles, with the
 *    official app's preconditions (§3.8 row 6303)
 */
import { describe, expect, it } from 'vitest'
import { MockTransport } from '../../../mock'
import { describeDriverConformance, type PreconditionCase } from '../../../core/conformance'
import { CONTROL } from '../../../core/controls'
import { DRIVERS, canConnect, driverFor } from '../../../core/registry'
import type { FamilyDriver } from '../../../core/types'
import { encodeMomaRequest, MOMA_6303 } from '../../../moma'
import {
  driver, createM3Driver, M3Cmd, M3Requests, M3_COMMANDS, M3_CONTROL, M3_HARDWARE_CHECK, M3_PRODUCTS, M3Simulator, isM3CameraRx,
} from '..'

describeDriverConformance(driver)

describe('registered M3 driver (Phase 2: still a partial stub)', () => {
  it('is the registry entry, a stub with the real catalogue, classifier and hardware check', () => {
    expect(DRIVERS['6303']).toBe(driver)
    expect(driver.status).toBe('stub')
    expect(driver.commands).toBe(M3_COMMANDS)
    expect(driver.hardwareCheck).toBe(M3_HARDWARE_CHECK)
    expect(driver.commandOfFrame(encodeMomaRequest(MOMA_6303, M3Requests.heartbeat()))).toBe(M3Cmd.HEART_BEAT_GET)
    expect(driver.commandOfFrame(Uint8Array.of(0xde, 0xad))).toBeNull()
    for (const p of M3_PRODUCTS) {
      expect(driverFor(p)).toBe(driver)
      expect(canConnect(p)).toBe(false)
      expect(() => driver.createDevice(new MockTransport(), p)).toThrow(/not supported yet/)
    }
  })
})

const m3 = createM3Driver()
const cam = (id: number) => isM3CameraRx({ productId: id })
const product = (pid: number) => m3.products.find((p) => p.productId === pid)!

/** The app's preconditions (A EquipmentFragment / MoreSetting6303Activity; status.ts m3Availability). */
const PRECONDITIONS: PreconditionCase[] = [
  { name: 'NC needs a TX online (Setup failed. Please connect the tx)', sim: { online: ['rx'] }, control: CONTROL.NOISE_ENABLED, value: false, reason: 'mic-disconnected' },
  { name: 'NC is a global setting: primary RX only', sim: { profile: 'secondary' }, control: CONTROL.NOISE_ENABLED, value: false, reason: 'secondary-rx' },
  { name: 'NC level needs NC on', arrange: (s) => ((s as M3Simulator).ncOn = false), control: CONTROL.NOISE_LEVEL, value: 3, reason: 'noise-off' },
  { name: 'NC level on a secondary RX', sim: { profile: 'secondary' }, control: CONTROL.NOISE_LEVEL, value: 3, reason: 'secondary-rx' },
  { name: 'mute an offline TX', sim: { online: ['rx', 'tx1'] }, control: CONTROL.MIC_MUTE, unit: 'tx2', value: true, reason: 'mic-offline' },
  { name: 'mute on a secondary RX', sim: { profile: 'secondary' }, control: CONTROL.MIC_MUTE, unit: 'tx1', value: true, reason: 'secondary-rx' },
  { name: 'smart mix only in 4TX&4RX', sim: { profile: '2t2r' }, control: M3_CONTROL.SMART_MIX, value: true, reason: 'not-4t4r' },
  { name: '4-track only in 4TX&4RX', sim: { profile: '2t2r' }, control: CONTROL.CHANNEL_MODE, value: 2, reason: 'not-4t4r' },
  { name: 'LED on a secondary RX', sim: { profile: 'secondary' }, control: CONTROL.LED, value: false, reason: 'secondary-rx' },
  { name: 'TX recognition on a secondary RX', sim: { profile: 'secondary' }, control: CONTROL.MIC_RECOGNITION, value: true, reason: 'secondary-rx' },
  { name: 'TX button lock on a secondary RX', sim: { profile: 'secondary' }, control: M3_CONTROL.TX_BUTTON_LOCK, value: true, reason: 'secondary-rx' },
  { name: 'auto power off on a secondary RX', sim: { profile: 'secondary' }, control: CONTROL.AUTO_OFF, value: false, reason: 'secondary-rx' },
]

/**
 * A camera level write sends all three levels (0x1010), so it needs the other two from 0x100E, a GET the suite's fast
 * harness skips (fetchSettings off). Their round trip is tested with the start-up reads on in session.test.ts.
 */
const CAMERA_LEVELS_NEED_0x100E = 'a level write sends all three levels (0x1010) and needs the other two from the 0x100E GET; round trip in session.test.ts'
const SKIP_WRITES = {
  [M3_CONTROL.CAMERA_LEVEL_1]: CAMERA_LEVELS_NEED_0x100E,
  [M3_CONTROL.CAMERA_LEVEL_2]: CAMERA_LEVELS_NEED_0x100E,
  [M3_CONTROL.CAMERA_LEVEL_3]: CAMERA_LEVELS_NEED_0x100E,
}

describeDriverConformance(m3, {
  // 1 = byte by byte; 13 splits inside the item header; 20 = a BLE-sized piece; 63 = one undeclared-size report.
  chunkSizes: [1, 13, 20, 63],
  preconditions: PRECONDITIONS,
  skipWrites: SKIP_WRITES,
  // Every readable control has a start-up read path (heartbeat, 0x6011, 0x100E): no notReadOnConnect exceptions.
})

/** The same driver with the simulator pinned to a topology (every PID, full suite). */
function withProfile(profile: string): FamilyDriver {
  const d = createM3Driver()
  return { ...d, name: `LARK M3 (${profile})`, mockPresets: [], createSimulator: (p, o) => new M3Simulator(p, { ...o, profile: o?.profile ?? profile }) }
}
for (const profile of ['multi-rx', '2t2r', 'refresh']) describeDriverConformance(withProfile(profile), { chunkSizes: [7], skipWrites: SKIP_WRITES })

describe('M3 driver shape', () => {
  it('serves the four PIDs as experimental, untested rows; camera-only and phone-only controls by PID', () => {
    expect(m3.products.map((p) => p.productId)).toEqual([1036, 1037, 1038, 1039])
    for (const p of m3.products) {
      expect(p.support).toMatchObject({ level: 'experimental', hardware: 'untested' })
      const ids = m3.createDevice(new MockTransport(), p).controls.map((c) => c.id)
      expect(ids.includes(CONTROL.VOLUME), `${p.productId} volume`).toBe(!cam(p.productId))
      expect(ids.includes(M3_CONTROL.HOT_SHOE_SYNC), `${p.productId} hot shoe`).toBe(cam(p.productId))
      expect(ids.includes(M3_CONTROL.CAMERA_LEVEL_1), `${p.productId} camera levels`).toBe(cam(p.productId))
    }
  })

  it('offers no destructive or OTA control; restart-causing ones are disruptive with the app\'s dialog text', () => {
    expect(m3.controls.filter((c) => c.safety === 'destructive' || c.safety === 'ota')).toEqual([])
    const disruptive = m3.controls.filter((c) => c.safety === 'disruptive').map((c) => c.id)
    expect(disruptive).toEqual([CONTROL.SPEAKER, M3_CONTROL.BIT_DEPTH])
    for (const c of m3.controls.filter((x) => x.safety === 'disruptive')) expect(c.confirmText).toMatch(/requires a restart/)
    // Channel Mode: per value (4-track), enforced by M3Device.
    expect(m3.controls.find((c) => c.id === CONTROL.CHANNEL_MODE)).toMatchObject({ safety: 'write', confirmText: expect.stringMatching(/4-track/) })
  })

  it('mock presets: phone / camera, 2CH / 4CH, secondary, multi-RX, 2T2R', () => {
    expect(m3.mockPresets.map((m) => `${m.id}:${m.productId}`)).toEqual([
      'm3:1038', 'm3-4ch:1039', 'm3cam:1036', 'm3cam4:1037', 'm3-secondary:1038', 'm3-multi:1036', 'm3-2t2r:1038',
    ])
    expect(product(1039).label).toMatch(/4CH/)
  })
})
