/**
 * End to end without hardware: the generic engine (FamilyDevice) + the read-only A1 session + WebHidFeatureTransport
 * + the feature-report fake + the A1 simulator. Covers the session sequence of a1-6108.md §4.1, the iOS heartbeat
 * branching through the whole stack, the stale-reply fault, the write-only case (GET refused) and the safety rules
 * of FAMILIES.md §2.3 for this untested family.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromHex } from '../../../codec'
import { CONTROL } from '../../../core/controls'
import { CommandSafetyError } from '../../../core/errors'
import { simulatedTransport } from '../../../core/simulate'
import type { MicDeviceOptions, MicTrafficEntry } from '../../../core/types'
import { DestructiveCommandError, RxUnavailableError, UnsupportedError } from '../../../device'
import { FakeHid } from '../../../transports/fake-hid'
import { fakeFeatureDeviceFor } from '../../../transports/fake-hid-feature'
import { WebHidFeatureTransport } from '../../../transports/webhid-feature'
import {
  A1_CONTROL, A1_HARDWARE_CHECK, A1Simulator, a1ExperimentalProducts, createA1Device, createA1Spec, describeA1Heartbeat, encodeA1Frame,
  parseA1Heartbeat, type A1Heartbeat,
} from '..'
import { A1_OTA_VECTORS } from './vectors'

const product = a1ExperimentalProducts()[0]
const QUIET: MicDeviceOptions = { heartbeatIntervalMs: null, fetchIdentity: false, fetchSettings: false, retries: 0 }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Engine on the real feature transport over the fake HID device answering with the simulator. */
async function overFeatureLink(sim = new A1Simulator(), opts: MicDeviceOptions = QUIET, spec = createA1Spec({ unitIdentityDelayMs: 0 })) {
  const dev = fakeFeatureDeviceFor(sim)
  vi.stubGlobal('navigator', { hid: new FakeHid([dev]).hidApi, platform: 'MacIntel' })
  const transport = new WebHidFeatureTransport(dev.hid, { staleRetryDelayMs: 0 })
  const device = createA1Device(transport, product, { requestTimeoutMs: 100, probeTimeoutMs: 100, ...opts }, spec)
  const traffic: MicTrafficEntry[] = []
  device.onTraffic((e) => traffic.push(e))
  return { sim, dev, transport, device, traffic }
}

const cmds = (frames: readonly Uint8Array[]) => frames.map((f) => f[4])

describe('A1 session over WebHidFeatureTransport', () => {
  it('connects with the heartbeat, maps the status, then reads identity like Android (0x12, 0x0D, 0x30; mics 0x0D/0x12/0x31; 0x46)', async () => {
    // mic identity 5 ms after the mic came online (Android waits 1 s)
    const spec = createA1Spec({ unitIdentityDelayMs: 5 })
    const h = await overFeatureLink(new A1Simulator(), { ...QUIET, fetchIdentity: true, fetchSettings: true }, spec)
    const s = await h.device.connect()
    expect(s.rx).toBe('available')
    expect(s.family).toBe('6108')
    await h.device.idle()
    await sleep(40)
    await h.device.idle()
    const st = h.device.state
    expect(st.units.tx1).toMatchObject({ online: true, battery: 85, muted: false, version: '1.0.0.7', serial: 'A1TX0000001', mac: '50:C0:F0:11:22:33' })
    expect(st.units.tx2).toMatchObject({ online: true, battery: 60, version: '1.0.0.7' })
    expect(st.units.tx3?.online).toBe(false)
    expect(st.units.rx).toMatchObject({ online: true, version: '1.0.1.3', serial: 'A1RX0000001', mac: '50:C0:F0:10:20:30' })
    expect(st.values).toMatchObject({
      [CONTROL.NOISE_ENABLED]: true, [CONTROL.NOISE_LEVEL]: 3, [CONTROL.VOLUME]: 3, [CONTROL.CHANNEL_MODE]: 1, [CONTROL.LED]: true,
      [CONTROL.AUTO_OFF]: true, [A1_CONTROL.EQ]: 2, [A1_CONTROL.SIGNAL_MODE]: 0, [A1_CONTROL.PERFORMANCE]: false,
    })
    expect((st.raw as A1Heartbeat).layout).toBe('2mic')
    const sent = cmds(h.dev.sent.map((r) => Uint8Array.of(5, ...r.data)))
    expect(sent.slice(0, 5)).toEqual([0x1f, 0x12, 0x0d, 0x30, 0x46])
    expect(sent.slice(5).sort()).toEqual([0x0d, 0x0d, 0x12, 0x12, 0x31, 0x31].sort())
    expect(h.transport.stats.droppedReplies).toBe(0)
    // the traffic log names every frame
    expect(traffic(h).some((t) => /GET_HEART_INFO 17 B \(2mic\): TX1 85%, TX2 60%/.test(t))).toBe(true)
    expect(traffic(h).some((t) => /GET_DEVICE_VERSION rx 1\.0\.1\.3/.test(t))).toBe(true)
    await h.device.disconnect()
  })

  it('reads four mics from 23- and 22-byte heartbeats through the whole stack', async () => {
    for (const profile of ['4mic', '4mic-old'] as const) {
      const h = await overFeatureLink(new A1Simulator({ profile }))
      await h.device.connect()
      const st = h.device.state
      expect((st.raw as A1Heartbeat).layout, profile).toBe(profile)
      expect([st.units.tx3?.online, st.units.tx4?.online], profile).toEqual([true, true])
      expect(st.units.tx3?.battery).toBe(72)
      expect(st.values[A1_CONTROL.SIGNAL_MODE], profile).toBe(profile === '4mic' ? 0 : undefined)
      await h.device.disconnect()
    }
  })

  it('polls the heartbeat in the background with reads only, and follows a mic going offline', async () => {
    const h = await overFeatureLink(new A1Simulator(), { ...QUIET, heartbeatIntervalMs: 10 })
    await h.device.connect()
    const offline: string[] = []
    h.device.on('unit-offline', (u) => offline.push(u))
    h.sim.mics[1].online = false
    await sleep(60)
    expect(offline).toEqual(['tx2'])
    expect(h.device.state.values[CONTROL.VOLUME]).toBe(3)
    const sent = cmds(h.dev.sent.map((r) => Uint8Array.of(5, ...r.data)))
    expect(sent.length).toBeGreaterThan(2)
    expect(new Set(sent)).toEqual(new Set([0x1f]))
    await h.device.disconnect()
  })

  it('stale GET_REPORT replies are retried by the transport and never applied as status', async () => {
    const sim = new A1Simulator()
    const h = await overFeatureLink(sim, { ...QUIET, fetchIdentity: true })
    await h.device.connect()
    await h.device.idle()
    sim.faults.staleFeatureReply = true
    sim.volume = 5
    await h.device.refresh('identity')
    await h.device.refresh('status')
    expect(h.transport.stats.staleGets).toBeGreaterThan(0) // every request first saw the previous reply
    expect(h.device.state.units.rx.version).toBe('1.0.1.3')
    expect(h.device.state.values[CONTROL.VOLUME]).toBe(5)
    // Known limit: a stale heartbeat answering a heartbeat has the same command byte and cannot be detected;
    // the old status is applied once and the next poll catches up (a1-6108.md §8 #4).
    sim.volume = 4
    await h.device.refresh('status')
    expect(h.device.state.values[CONTROL.VOLUME]).toBe(5)
    await h.device.refresh('status')
    expect(h.device.state.values[CONTROL.VOLUME]).toBe(4)
    await h.device.disconnect()
  })

  it('GET_REPORT refused (undeclared feature report): rx unavailable, SET still delivered', async () => {
    const h = await overFeatureLink()
    h.dev.getFailure = new DOMException('Failed to receive the feature report.', 'NotAllowedError')
    const events: string[] = []
    h.device.on('rx-unavailable', () => events.push('rx-unavailable'))
    const s = await h.device.connect()
    expect(s.rx).toBe('unavailable')
    expect(events).toEqual(['rx-unavailable'])
    expect(h.sim.received.length).toBeGreaterThan(0) // the probe's SET reached the device
    await expect(h.device.refresh('status')).rejects.toBeInstanceOf(RxUnavailableError)
    await h.device.disconnect()
  })
})

function traffic(h: { traffic: MicTrafficEntry[] }): string[] {
  return h.traffic.map((t) => t.summary)
}

describe('A1 safety (untested family, FAMILIES.md §2.3)', () => {
  it('never sends OTA or destructive frames, even forced with allowDestructive; disruptive needs force', async () => {
    const sim = new A1Simulator()
    const h = await overFeatureLink(sim, { ...QUIET, allowDestructive: true })
    await h.device.connect()
    expect(h.device.support.hardware).toBe('untested')
    for (const v of A1_OTA_VECTORS) {
      const f = new Uint8Array(160).fill(0xcd)
      f.set(fromHex(v.hex))
      await expect(h.device.sendRaw(f, { force: true }), v.name).rejects.toBeInstanceOf(DestructiveCommandError)
    }
    for (const cmd of [0x2c, 0x2d, 0x3e]) await expect(h.device.sendRaw(encodeA1Frame(cmd), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    for (const cmd of [0x3c, 0x3d]) await expect(h.device.sendRaw(encodeA1Frame(cmd), { force: true })).rejects.toThrow(/destructive .*not tested on hardware/)
    await expect(h.device.sendRaw(encodeA1Frame(0x0c))).rejects.toBeInstanceOf(CommandSafetyError) // reboot: not a read
    await expect(h.device.sendRaw(encodeA1Frame(0x21, [1]))).rejects.toBeInstanceOf(CommandSafetyError) // a write needs force
    await expect(h.device.sendRaw(Uint8Array.of(0x06, 0x03, 0, 0, 0, 0x1a), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(h.device.sendRaw(fromHex('de ad be ef'), { force: true })).rejects.toThrow(/cannot be classified/)
    expect(sim.dangerous).toEqual([])
    expect(h.dev.sent.every((r) => r.reportId === 5)).toBe(true)
    // a catalogued read goes out without force
    await h.device.sendRaw(encodeA1Frame(0x46))
    expect(h.dev.sent.at(-1)?.data[3]).toBe(0x46)
    await h.device.disconnect()
  })

  it('the read-only session offers no controls and refuses set()', async () => {
    const h = await overFeatureLink(new A1Simulator(), QUIET, createA1Spec({ readOnly: true, unitIdentityDelayMs: 0 }))
    await h.device.connect()
    expect(h.device.controls).toEqual([])
    expect(h.device.state.availability).toEqual({})
    await expect(h.device.set(CONTROL.LED, false)).rejects.toBeInstanceOf(UnsupportedError)
    await h.device.disconnect()
  })

  it('sets a control end to end over the feature link (SET_REPORT, ack via GET_REPORT, heartbeat read-back)', async () => {
    const h = await overFeatureLink()
    await h.device.connect()
    expect(h.device.state.values[CONTROL.LED]).toBe(true)
    const r = await h.device.set(CONTROL.LED, false)
    expect(r).toEqual({ ok: true, confirmed: true, code: 0 })
    expect(h.sim.light).toBe(1) // wire 1 = off
    expect(h.dev.sent.at(-1)).toMatchObject({ reportId: 5 })
    expect([...h.dev.sent.at(-1)!.data.subarray(0, 8)]).toEqual([0x03, 0xaa, 0xdd, 0x21, 0x00, 0x01, 0x01, 0xef])
    await sleep(200) // heartbeat read-back 150 ms later
    expect(cmds(h.dev.sent.map((x) => Uint8Array.of(5, ...x.data))).at(-1)).toBe(0x1f)
    expect(h.device.state.values[CONTROL.LED]).toBe(false)
    expect(h.sim.dangerous).toEqual([])
    await h.device.disconnect()
  })

  it('works the same on the in-memory simulated transport', async () => {
    const sim = new A1Simulator({ profile: '4mic' })
    const device = createA1Device(simulatedTransport(sim), product, { ...QUIET, requestTimeoutMs: 40, probeTimeoutMs: 40 })
    await device.connect()
    expect(device.state.units.tx4?.online).toBe(true)
    expect(describeA1Heartbeat(parseA1Heartbeat(Uint8Array.from(sim.heartbeatBody())))).toMatch(/TX4 40%/)
    await device.disconnect()
  })
})

describe('A1 hardware check (FAMILIES.md §5.7)', () => {
  it('runs the read-only steps against a connected device', async () => {
    const h = await overFeatureLink(new A1Simulator({ profile: '4mic' }), { ...QUIET, fetchIdentity: true })
    await h.device.connect()
    const results: Record<string, { ok: boolean; summary: string }> = {}
    for (const step of A1_HARDWARE_CHECK) {
      expect(step.run, step.id).toBeDefined()
      results[step.id] = await step.run!(h.device)
    }
    expect(results['feature-reports']).toMatchObject({ ok: true, summary: 'report 5: 63 B; report 6: 159 B' })
    expect(results.heartbeat).toMatchObject({ ok: true, summary: '23-byte body, layout 4mic' })
    expect(results.version).toMatchObject({ ok: true, summary: 'RX 1.1.1.3 (4 Mic & 1 RX)' })
    expect(results['reply-bytes'].summary).toMatch(/^bytes 0–6: 05 03 bb dd .*; EF after payload: yes$/)
    expect(results['report-id-byte']).toMatchObject({ ok: true })
    expect(results['report-id-byte'].summary).toMatch(/^64 bytes, with the id byte/)
    // the one reversible write, over SET_REPORT / GET_REPORT: LED off and back on
    expect(results.led).toMatchObject({ ok: true })
    expect(results.led.summary).toMatch(/^LED on → off: ack byte 0 .*restored: yes/)
    expect(h.sim.light).toBe(0)
    expect(h.dev.sent.filter((r) => r.data[3] === 0x21).map((r) => r.data[6])).toEqual([1, 0])
    expect(h.sim.dangerous).toEqual([])
    await h.device.disconnect()
  })

  it('reports a non-feature link instead of throwing', async () => {
    const device = createA1Device(simulatedTransport(new A1Simulator()), product, QUIET)
    await device.connect()
    expect(await A1_HARDWARE_CHECK[0].run!(device)).toMatchObject({ ok: false })
    await device.disconnect()
  })
})
