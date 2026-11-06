/**
 * LARK A1 controls (Phase 2, W5): the official labels and sources, the writes byte for byte against the a1-6108.md
 * §3.6 vectors, the firmware gate (RX >= 1.0.1.3), 2- vs 4-mic, the app's preconditions, the set-ack rule and its iOS
 * divergence, stale / unsolicited replies, blind writes, the check-10 populated sets and the LED hardware-check step.
 */
import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from '../../../codec'
import { checkPopulatedAfterConnect } from '../../../core/conformance'
import { CONTROL, controlKey } from '../../../core/controls'
import { ControlUnavailableError } from '../../../core/errors'
import { simulatedTransport } from '../../../core/simulate'
import type { FamilyDriver, MicDeviceOptions, MicTrafficEntry, SimOptions } from '../../../core/types'
import { DestructiveCommandError, UnsupportedError } from '../../../device'
import { padBytes } from '../../../core/bytes'
import {
  A1_CONTROL, A1_CONTROLS, A1_HARDWARE_CHECK, A1_PRODUCTS, A1Simulator, a1MicSlots, createA1Driver, driver,
} from '..'
import { A1_REQUEST_VECTORS } from './vectors'

const product = A1_PRODUCTS[0]
const d = createA1Driver({ unitIdentityDelayMs: 0 })
const FAST: MicDeviceOptions = { requestTimeoutMs: 40, probeTimeoutMs: 40, heartbeatIntervalMs: null, retries: 0 }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function open(simOptions: SimOptions = {}, opts: MicDeviceOptions = {}, p = product, drv: FamilyDriver = d) {
  const sim = new A1Simulator(simOptions)
  const transport = simulatedTransport(sim)
  const device = drv.createDevice(transport, p, { ...FAST, ...opts }) as ReturnType<typeof d.createDevice> & { idle(): Promise<void> }
  const traffic: MicTrafficEntry[] = []
  device.onTraffic((e) => traffic.push(e))
  await device.connect()
  await device.idle()
  return { sim, transport, device, traffic, notes: () => traffic.filter((t) => t.note === 'note').map((t) => t.summary) }
}

/** Command bytes (offset 4) of the frames sent from index `from`. */
const cmdsFrom = (sent: readonly Uint8Array[], from = 0) => sent.slice(from).map((f) => f[4])
const vector = (n: number) => A1_REQUEST_VECTORS.find((v) => v.n === n)!

describe('A1 controls: labels, kinds, read paths, sources', () => {
  it('lists the controls of the A1 home and settings screens under their official labels', () => {
    expect(A1_CONTROLS.map((c) => [c.id, c.label])).toEqual([
      [CONTROL.MIC_MUTE, 'Mic mute'],
      [CONTROL.NOISE_ENABLED, 'NC'],
      [CONTROL.NOISE_LEVEL, 'NC level'],
      [CONTROL.VOLUME, 'Volume adjustment'],
      [CONTROL.CHANNEL_MODE, 'Channel Mode'],
      [A1_CONTROL.EQ, 'EQ Adjustment'],
      [A1_CONTROL.REVERB_ENABLED, 'Reverb Adjustment'],
      [A1_CONTROL.REVERB_LEVEL, 'Reverb size'],
      [CONTROL.MIC_RECOGNITION, 'Mic Recognition'],
      [CONTROL.AUTO_OFF, 'Schedule power off'],
      [CONTROL.LED, 'Indicator Light Switch'],
      [A1_CONTROL.SIGNAL_MODE, 'Mode setting'],
      [A1_CONTROL.WIRELESS_MODE, 'Wireless settings'],
    ])
    expect(driver.controls).toBe(A1_CONTROLS)
  })

  it('reads every setting from the heartbeat; only the catalogue-only Wireless settings is not a plain write', () => {
    for (const c of A1_CONTROLS) {
      expect(c.source, c.id).toMatch(/^A /)
      expect(c.source, c.id).toMatch(/ R [a-z_]/) // Android string resource of the label
      expect(c.source, c.id).toMatch(/\bI /) // iOS counterpart
      if (c.id === A1_CONTROL.WIRELESS_MODE) {
        expect(c).toMatchObject({ safety: 'destructive', readBack: 'get', kind: 'choice' })
        expect(c.confirmText).toMatch(/re-flashes/)
        continue
      }
      expect(c, c.id).toMatchObject({ safety: 'write', readBack: 'status' })
    }
    const by = (id: string) => A1_CONTROLS.find((c) => c.id === id)!
    expect(by(CONTROL.MIC_MUTE).perUnit).toEqual(['tx1', 'tx2', 'tx3', 'tx4'])
    expect(by(CONTROL.NOISE_LEVEL).options?.map((o) => [o.value, o.label])).toEqual([[1, 'Weak'], [2, 'Medium'], [3, 'Strong']])
    // hldevice_6108.xml order = iOS eqValueForSelectedIndex: (UI 0 → 3, 1 → 1, 2 → 2)
    expect(by(A1_CONTROL.EQ).options?.map((o) => [o.value, o.label])).toEqual([[3, 'Equalization'], [1, 'Low'], [2, 'Bright']])
    expect(by(A1_CONTROL.REVERB_LEVEL).options?.map((o) => o.label)).toEqual(['Small', 'Medium', 'Large'])
    expect(by(CONTROL.VOLUME).range).toEqual({ min: 0, max: 5, step: 1, displayOffset: 1 })
    expect(by(A1_CONTROL.SIGNAL_MODE)).toMatchObject({ group: 'advanced', confidence: 'medium' })
  })
})

describe('A1 writes: frames byte for byte (a1-6108.md §3.6)', () => {
  const cases: { n: number; id: string; value: boolean | number; unit?: 'tx3'; sim?: SimOptions }[] = [
    { n: 7, id: CONTROL.NOISE_LEVEL, value: 3 }, // NC on, Strong
    { n: 8, id: CONTROL.VOLUME, value: 3 },
    { n: 9, id: CONTROL.CHANNEL_MODE, value: 1 },
    { n: 10, id: A1_CONTROL.EQ, value: 2 },
    { n: 11, id: A1_CONTROL.REVERB_LEVEL, value: 1 }, // reverb on, Medium
    { n: 12, id: CONTROL.MIC_MUTE, value: true, unit: 'tx3', sim: { profile: '4mic' } },
    { n: 13, id: CONTROL.LED, value: false },
    { n: 14, id: CONTROL.MIC_RECOGNITION, value: true },
    { n: 15, id: CONTROL.AUTO_OFF, value: false }, // "Never"
    { n: 16, id: A1_CONTROL.SIGNAL_MODE, value: 1 }, // Performance
  ]
  for (const c of cases) {
    it(`#${c.n} ${vector(c.n).name}: set(${c.id}${c.unit ? `, ${c.unit}` : ''}, ${c.value})`, async () => {
      const h = await open(c.sim, { fetchIdentity: true })
      const from = h.transport.sent.length
      const r = await h.device.set(c.id, c.value, { unit: c.unit })
      expect(r).toEqual({ ok: true, confirmed: true, code: 0 })
      expect(toHex(h.transport.sent[from])).toBe(toHex(padBytes(fromHex(vector(c.n).hex), 64)))
      expect(h.device.state.values[controlKey(c.id, c.unit)]).toBe(c.value)
      await h.device.disconnect()
    })
  }

  it('the NC switch carries the current level; choosing a level sends NC on, as the app does', async () => {
    const h = await open()
    const payload = () => [...h.transport.sent.at(-1)!.subarray(7, 9)]
    expect(h.device.state.values).toMatchObject({ [CONTROL.NOISE_ENABLED]: true, [CONTROL.NOISE_LEVEL]: 3 })
    await h.device.set(CONTROL.NOISE_ENABLED, false)
    expect(payload()).toEqual([0, 2]) // [isOpen, noiseType]
    await expect(h.device.set(CONTROL.NOISE_LEVEL, 1)).rejects.toMatchObject({ reason: 'noise-off' })
    await h.device.set(CONTROL.NOISE_ENABLED, true)
    expect(payload()).toEqual([1, 2])
    await h.device.set(CONTROL.NOISE_LEVEL, 2)
    expect(payload()).toEqual([1, 1]) // Medium (shown only for 1031)
    expect(h.sim).toMatchObject({ noiseOn: true, noiseLevel: 1 })
    await h.device.disconnect()
  })

  it('the reverb switch carries the current size; choosing a size sends reverb on', async () => {
    const h = await open()
    const payload = () => [...h.transport.sent.at(-1)!.subarray(7, 9)]
    await h.device.set(A1_CONTROL.REVERB_ENABLED, false)
    expect(payload()).toEqual([0, 1])
    await h.device.refresh('status')
    await expect(h.device.set(A1_CONTROL.REVERB_LEVEL, 2)).rejects.toMatchObject({ reason: 'reverb-off' })
    await h.device.set(A1_CONTROL.REVERB_ENABLED, true)
    await h.device.set(A1_CONTROL.REVERB_LEVEL, 2)
    expect(payload()).toEqual([1, 2])
    expect(h.device.state.values).toMatchObject({ [A1_CONTROL.REVERB_ENABLED]: true, [A1_CONTROL.REVERB_LEVEL]: 2 })
    await h.device.disconnect()
  })

  it('reads every confirmed write back with one heartbeat 150 ms later (as iOS queryCommandForSetCommand:)', async () => {
    const h = await open()
    const from = h.transport.sent.length
    await h.device.set(CONTROL.LED, false)
    expect(cmdsFrom(h.transport.sent, from)).toEqual([0x21])
    await sleep(200)
    expect(cmdsFrom(h.transport.sent, from)).toEqual([0x21, 0x1f])
    expect(h.device.state.values[CONTROL.LED]).toBe(false)
    expect(h.sim.light).toBe(1)
    await h.device.disconnect()
  })
})

describe('A1 availability: firmware gate, 2- vs 4-mic, preconditions', () => {
  it('RX version unknown: every mute key is version-unknown and refused; ignoreFirmwareGates offers them', async () => {
    const h = await open({}, { fetchIdentity: false })
    for (const u of ['tx1', 'tx2', 'tx3', 'tx4']) expect(h.device.state.availability[controlKey(CONTROL.MIC_MUTE, u as 'tx1')]?.reason).toBe('version-unknown')
    // the value is still read from the heartbeat
    expect(h.device.state.values[controlKey(CONTROL.MIC_MUTE, 'tx1')]).toBe(false)
    const from = h.transport.sent.length
    await expect(h.device.set(CONTROL.MIC_MUTE, true, { unit: 'tx1' })).rejects.toMatchObject({ reason: 'version-unknown' })
    expect(h.transport.sent.length).toBe(from)
    // Shown as blocked up front (blindAvailability), not only refused after the click.
    expect(h.device.state.availability[`${CONTROL.MIC_MUTE}:tx1`]).toMatchObject({ ok: false, reason: 'version-unknown' })
    expect(h.device.state.availability[CONTROL.VOLUME]).toEqual({ ok: true })
    await h.device.disconnect()

    const g = await open({}, { fetchIdentity: false, ignoreFirmwareGates: true })
    expect(g.device.state.availability[controlKey(CONTROL.MIC_MUTE, 'tx1')]).toEqual({ ok: true })
    expect(g.device.state.availability[controlKey(CONTROL.MIC_MUTE, 'tx3')]?.reason).toBe('two-mic-mode') // still 2 Mic & 1 RX
    expect(await g.device.set(CONTROL.MIC_MUTE, true, { unit: 'tx1' })).toMatchObject({ ok: true })
    expect(g.sim.mics[0].muted).toBe(true)
    await g.device.disconnect()
  })

  it('RX 1.0.1.2: the mute row is firmware-too-old; values still come from the heartbeat', async () => {
    const h = await open({ rxVersion: '1.0.1.2' }, { fetchIdentity: true })
    expect(h.device.state.availability[CONTROL.MIC_MUTE]).toMatchObject({ ok: false, reason: 'firmware-too-old' })
    expect(h.device.state.availability[controlKey(CONTROL.MIC_MUTE, 'tx2')]).toMatchObject({ ok: false, reason: 'firmware-too-old' })
    await expect(h.device.set(CONTROL.MIC_MUTE, true, { unit: 'tx2' })).rejects.toBeInstanceOf(ControlUnavailableError)
    await h.device.disconnect()
  })

  it('2 Mic & 1 RX: Mic3/Mic4 are two-mic-mode; a mic that is not connected is mic-offline (R mic_offline_tip)', async () => {
    const h = await open({ online: ['rx', 'tx1'] }, { fetchIdentity: true })
    const av = (u: string) => h.device.state.availability[controlKey(CONTROL.MIC_MUTE, u as 'tx1')]
    expect(av('tx1')).toEqual({ ok: true })
    expect(av('tx2')).toMatchObject({ ok: false, reason: 'mic-offline', message: 'Mic not connected, current function not available' })
    expect(av('tx3')?.reason).toBe('two-mic-mode')
    await expect(h.device.set(CONTROL.MIC_MUTE, true, { unit: 'tx2' })).rejects.toMatchObject({ reason: 'mic-offline' })
    await h.device.disconnect()
  })

  it('4 Mic & 1 RX: Mic Recognition needs any mic (not Mic1 and Mic2); none online is mic-disconnected', async () => {
    const h = await open({ profile: '4mic', online: ['rx', 'tx3'] }, { fetchIdentity: true })
    expect(h.device.state.availability[CONTROL.MIC_RECOGNITION]).toEqual({ ok: true })
    expect(await h.device.set(CONTROL.MIC_RECOGNITION, false)).toMatchObject({ ok: true })
    h.sim.mics[2].online = false
    await h.device.refresh('status')
    expect(h.device.state.availability[CONTROL.MIC_RECOGNITION]?.reason).toBe('mic-disconnected')
    // the 2T1R rule applies until the version says 4 Mic & 1 RX (Android's is6108FourMicOneRx default)
    const early = await open({ profile: '4mic', online: ['rx', 'tx3'] }, { fetchIdentity: false })
    expect(early.device.state.availability[CONTROL.MIC_RECOGNITION]?.reason).toBe('both-mics-required')
    await early.device.disconnect()
    await h.device.disconnect()
  })

  it('"every online mic muted" counts online mics only; muting the last one blocks NC (R toast_tx_mute)', async () => {
    // TX4 offline (and unmuted) does not count; TX3 is the last unmuted online mic.
    const h = await open({ profile: '4mic', online: ['rx', 'tx1', 'tx2', 'tx3'], params: { muted: ['tx1', 'tx2'] } }, { fetchIdentity: true })
    expect(h.device.state.availability[CONTROL.NOISE_ENABLED]).toEqual({ ok: true })
    await h.device.set(CONTROL.MIC_MUTE, true, { unit: 'tx3' })
    await h.device.refresh('status')
    expect(h.device.state.availability[CONTROL.NOISE_ENABLED]).toMatchObject({ ok: false, reason: 'all-mics-muted' })
    expect(h.device.state.availability[CONTROL.NOISE_LEVEL]?.reason).toBe('all-mics-muted')
    expect(h.device.state.availability[CONTROL.VOLUME]).toEqual({ ok: true })
    await h.device.disconnect()
  })

  it('availability follows a confirmed write at once, per device (two devices share one driver spec)', async () => {
    const a = await open()
    const b = await open()
    await a.device.set(CONTROL.NOISE_ENABLED, false)
    expect(a.device.state.availability[CONTROL.NOISE_LEVEL]?.reason).toBe('noise-off') // before the 150 ms read-back
    expect(b.device.state.availability[CONTROL.NOISE_LEVEL]).toEqual({ ok: true })
    await b.device.refresh('status')
    expect(b.device.state.availability[CONTROL.NOISE_LEVEL]).toEqual({ ok: true })
    await Promise.all([a.device.disconnect(), b.device.disconnect()])
  })

  it('enforcePreconditions: false sends what the app refuses (the firmware decides)', async () => {
    const h = await open({ params: { muted: ['tx1', 'tx2'] } }, { enforcePreconditions: false })
    expect(h.device.state.availability[CONTROL.NOISE_ENABLED]?.reason).toBe('all-mics-muted')
    expect(await h.device.set(CONTROL.NOISE_ENABLED, false)).toMatchObject({ ok: true })
    expect(h.sim.noiseOn).toBe(false)
    await h.device.disconnect()
  })

  it('follows the heartbeat: a mic coming online lifts mic-disconnected', async () => {
    const h = await open({ online: ['rx'] })
    expect(h.device.state.availability[CONTROL.VOLUME]?.reason).toBe('mic-disconnected')
    expect(h.device.state.availability[CONTROL.LED]).toEqual({ ok: true }) // no check in the app
    expect(h.device.state.availability[CONTROL.AUTO_OFF]).toEqual({ ok: true })
    h.sim.mics[0].online = true
    await h.device.refresh('status')
    expect(h.device.state.availability[CONTROL.VOLUME]).toEqual({ ok: true })
    await h.device.disconnect()
  })
})

describe('A1 2- vs 4-mic display and the catalogue-only mode switch', () => {
  it('Wireless settings value from the RX version (x.1.x.x = 4 Mic & 1 RX); a1MicSlots', async () => {
    const two = await open({}, { fetchIdentity: true })
    expect(two.device.state.values[A1_CONTROL.WIRELESS_MODE]).toBe(2)
    expect(a1MicSlots(two.device.state)).toBe(2)
    await two.device.disconnect()
    const four = await open({ profile: '4mic' }, { fetchIdentity: true })
    expect(four.device.state.values[A1_CONTROL.WIRELESS_MODE]).toBe(4)
    expect(a1MicSlots(four.device.state)).toBe(4)
    await four.device.disconnect()
    // before the version: 4 when the heartbeat reports TX3/TX4 online, else unknown
    const early4 = await open({ profile: '4mic' }, { fetchIdentity: false })
    expect(a1MicSlots(early4.device.state)).toBe(4)
    await early4.device.disconnect()
    const early2 = await open({}, { fetchIdentity: false })
    expect(a1MicSlots(early2.device.state)).toBeUndefined()
    await early2.device.disconnect()
  })

  it('switching mode is hidden and refused on the untested A1, refused by the encoder on a tested row; nothing is sent', async () => {
    const h = await open({}, { fetchIdentity: true, allowDestructive: true })
    expect(h.device.controls.map((c) => c.id)).not.toContain(A1_CONTROL.WIRELESS_MODE)
    const from = h.transport.sent.length
    await expect(h.device.set(A1_CONTROL.WIRELESS_MODE, 4, { confirm: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await h.device.disconnect()
    const tested = { ...product, support: { ...product.support!, hardware: 'tested' as const } }
    const t = await open({}, { allowDestructive: true }, tested)
    expect(t.device.controls.map((c) => c.id)).toContain(A1_CONTROL.WIRELESS_MODE)
    const tFrom = t.transport.sent.length
    await expect(t.device.set(A1_CONTROL.WIRELESS_MODE, 4, { confirm: true })).rejects.toBeInstanceOf(UnsupportedError)
    expect(t.transport.sent.length).toBe(tFrom)
    expect(h.transport.sent.length).toBe(from)
    expect([...h.sim.dangerous, ...t.sim.dangerous]).toEqual([])
    await t.device.disconnect()
  })
})

describe('A1 set ack: Android body[0] == 0, iOS != 0xFF (a1-6108.md §3.2)', () => {
  it('a firmware acking success with 1 (the iOS reading) fails here; a note records it; the heartbeat shows the truth', async () => {
    const h = await open({ params: { ackOk: 1 } })
    const r = await h.device.set(CONTROL.LED, false)
    expect(r).toEqual({ ok: false, confirmed: true, code: 1 })
    expect(h.device.state.values[CONTROL.LED]).toBe(true) // no optimistic value after a failure
    expect(h.notes().some((n) => /SET_LIGHT: ack byte 1 is a failure by Android's rule .* success by iOS's/.test(n))).toBe(true)
    expect(h.traffic.some((t) => /SET_LIGHT failed \(1; iOS reads it as success\)/.test(t.summary))).toBe(true)
    expect(h.sim.light).toBe(1) // the firmware did apply it
    await h.device.refresh('status')
    expect(h.device.state.values[CONTROL.LED]).toBe(false)
    await h.device.disconnect()
  })

  it('0xFF is a failure for both apps (no iOS note)', async () => {
    const h = await open({ params: { ackOk: 0xff } })
    expect(await h.device.set(CONTROL.VOLUME, 1)).toEqual({ ok: false, confirmed: true, code: 0xff })
    expect(h.notes().some((n) => /iOS/.test(n))).toBe(false)
    await h.device.disconnect()
  })

  it('a failed Mode setting reads the fail reason (0x41), as A SignalModeActivity.onResponseSet does', async () => {
    const h = await open({ params: { ackOk: 1 } })
    const from = h.transport.sent.length
    expect(await h.device.set(A1_CONTROL.SIGNAL_MODE, 1)).toMatchObject({ ok: false, code: 1 })
    await h.device.idle()
    expect(cmdsFrom(h.transport.sent, from)).toEqual([0x3f, 0x41])
    expect(h.notes().some((n) => /Mode setting failed, reason 0/.test(n))).toBe(true)
    await h.device.disconnect()
  })
})

describe('A1 stale and unsolicited replies', () => {
  it('a stale reply of another command (simulator fault on any transport) is logged, never applied', async () => {
    let now = 1_000
    const h = await open({}, { now: () => now })
    await h.device.refresh('status') // the simulator's reply register now holds a heartbeat
    const statusAt = h.device.state.lastStatusAt
    h.sim.faults.staleFeatureReply = true
    now += 5_000 // outside the engine's 1 s duplicate window
    expect(await h.device.set(CONTROL.VOLUME, 1)).toMatchObject({ ok: true })
    expect(h.device.state.lastStatusAt).toBe(statusAt) // the stale heartbeat did not count as a status
    expect(h.notes().some((n) => /^ignored GET_HEART_INFO .*late or stale reply/.test(n))).toBe(true)
    expect(h.device.state.values[CONTROL.VOLUME]).toBe(1)
    await h.device.disconnect()
  })
})

describe('A1 blind writes (write-only link)', () => {
  it('absolute setters go out blind with blindWrites; the switches fall back to the app\'s levels; mute stays gated', async () => {
    const h = await open({ dropReplies: true }, { blindWrites: true })
    expect(h.device.state.rx).toBe('unavailable')
    const payload = () => [...h.transport.sent.at(-1)!.subarray(4, 9)]
    expect(await h.device.set(CONTROL.NOISE_ENABLED, true)).toEqual({ ok: true, confirmed: false, code: null })
    expect(payload()).toEqual([0x13, 0, 2, 1, 2]) // NoiseLevelType.STRONG_NOISE before the first heartbeat
    await h.device.set(A1_CONTROL.REVERB_ENABLED, true)
    expect(payload()).toEqual([0x05, 0, 2, 1, 0]) // Reverb.GEAR_ONE
    const from = h.transport.sent.length
    await expect(h.device.set(CONTROL.MIC_MUTE, true, { unit: 'tx1' })).rejects.toMatchObject({ reason: 'version-unknown' })
    expect(h.transport.sent.length).toBe(from)
    expect(h.sim.dangerous).toEqual([])
    await h.device.disconnect()
  })
})

describe('A1 check 10: what connect() populates, per firmware case', () => {
  const READ = [
    CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.CHANNEL_MODE, A1_CONTROL.EQ, A1_CONTROL.REVERB_ENABLED,
    A1_CONTROL.REVERB_LEVEL, CONTROL.MIC_RECOGNITION, CONTROL.AUTO_OFF, CONTROL.LED,
  ]
  const mute = (...u: string[]) => u.map((x) => `${CONTROL.MIC_MUTE}:${x}`)

  it('2 Mic & 1 RX: everything from the probe heartbeat; Mic3/Mic4 offline', async () => {
    const r = await checkPopulatedAfterConnect(driver, product)
    expect(r.populated).toEqual([...mute('tx1', 'tx2'), ...READ, A1_CONTROL.SIGNAL_MODE])
    expect(r.offline).toEqual(mute('tx3', 'tx4'))
    expect([r.missing, r.invalid, r.unavailable, r.excepted]).toEqual([[], [], [], []])
  })

  it('4 Mic & 1 RX: all four mics', async () => {
    const r = await checkPopulatedAfterConnect(driver, product, { run: 'a1-4mic', sim: { profile: '4mic' } })
    expect(r.populated).toEqual([...mute('tx1', 'tx2', 'tx3', 'tx4'), ...READ, A1_CONTROL.SIGNAL_MODE])
    expect(r.offline).toEqual([])
  })

  it('22-byte heartbeat: Mode setting unavailable (no signal-mode byte, 0x40 unanswered)', async () => {
    const r = await checkPopulatedAfterConnect(driver, product, { run: 'a1-4mic-old', sim: { profile: '4mic-old' } })
    expect(r.populated).toEqual([...mute('tx1', 'tx2', 'tx3', 'tx4'), ...READ])
    expect(r.unavailable).toEqual([{ key: A1_CONTROL.SIGNAL_MODE, reason: 'firmware-too-old' }])
    expect(r.missing).toEqual([])
  })

  it('start-up reads are Android\'s (0x1F probe, 0x12 / 0x0D / 0x30 RX identity, 0x46), plus 0x40 only without the signal-mode byte', async () => {
    // The registered driver: mic identity waits 1 s after a mic comes online (A onResHeartInfoV2), so none here.
    for (const [profile, extra] of [['2mic', []], ['4mic-old', [0x40]]] as const) {
      const h = await open({ profile }, { fetchIdentity: true, fetchSettings: true }, product, driver)
      expect(cmdsFrom(h.transport.sent), profile).toEqual([0x1f, 0x12, 0x0d, 0x30, 0x46, ...extra])
      await h.device.disconnect()
    }
  })
})

describe('A1 hardware check: LED 0x21 and back', () => {
  const led = A1_HARDWARE_CHECK.find((s) => s.id === 'led')!

  it('flips the LED, confirms body[11] in the heartbeat, restores it', async () => {
    const h = await open()
    const r = await led.run!(h.device)
    expect(r.ok).toBe(true)
    expect(r.summary).toBe(
      'LED on → off: ack byte 0 (Android success, iOS success; Android and iOS agree); heartbeat body[11] confirmed; restored: yes (ack byte 0)',
    )
    expect(h.sim.light).toBe(0)
    await h.device.disconnect()
  })

  it('tells when the firmware follows the iOS ack reading (ack 1, change applied)', async () => {
    const h = await open({ params: { ackOk: 1 } })
    const r = await led.run!(h.device)
    expect(r.ok).toBe(false)
    expect(r.summary).toMatch(/ack byte 1 \(Android failure, iOS success; the firmware follows the iOS reading\); heartbeat body\[11\] confirmed; restored: yes/)
    expect(h.sim.light).toBe(0)
    await h.device.disconnect()
  })
})
