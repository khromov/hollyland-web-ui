/**
 * LARK MAX 2 session behaviour on both links (max2-6701.md §4, §5, §6): start-up order and targets, BLE pushes and
 * MTU-sized notifications, the iOS heartbeat through the BOX, the BLE NC fan-out, multi-field payloads, the
 * official app's preconditions and the safety classes (FAMILIES.md §2.3).
 */
import { describe, expect, it } from 'vitest'
import { DestructiveCommandError, TimeoutError } from '../../../device'
import { controlKey } from '../../../core/controls'
import { CommandSafetyError, ControlUnavailableError } from '../../../core/errors'
import { simulatedTransport } from '../../../core/simulate'
import type { MicDeviceOptions, SimOptions } from '../../../core/types'
import { encodeMomaRequest } from '../../../moma/spec'
import { MOMA_6701_USB } from '../../../moma/profiles'
import { bleSimulatedTransport } from '../../../transports/fake-bluetooth'
import {
  createMax2Device, createMax2Driver, MAX2_CMD, MAX2_CONTROL, MAX2_HARDWARE_CHECK, max2CommandOfFrame, max2FrameLength, max2GetKey, max2Set,
  MAX2_STATUS_VALUE, Max2Simulator, type Max2Heartbeat, type Max2SpecOptions,
} from '..'
import { MAX2_VECTORS } from './vectors'

const d = createMax2Driver()
const MOBILE = d.products.find((p) => p.productId === 1026)!
const CAMERA = d.products.find((p) => p.productId === 1027)!
const BOX = d.products.find((p) => p.productId === 101)!
const OWS = d.products.find((p) => p.productId === 102)!

const FAST: MicDeviceOptions = { requestTimeoutMs: 60, probeTimeoutMs: 80, retries: 0, interFrameDelayMs: 0, heartbeatIntervalMs: null }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function open(product = MOBILE, sim: SimOptions = {}, opts: MicDeviceOptions = {}, so: Max2SpecOptions = {}) {
  const simulator = new Max2Simulator(product, sim)
  const transport = simulatedTransport(simulator)
  const device = createMax2Device(transport, product, { ...FAST, ...opts }, so)
  await device.connect()
  await device.idle()
  return { simulator, transport, device }
}

/** [cmd key, target] of every frame the host sent. */
const sentFrames = (sim: Max2Simulator) => sim.requests.map((r) => [r.items.map((i) => (i.payload.length ? `${i.cmd.toString(16)}[${Array.from(i.payload).join(',')}]` : i.cmd.toString(16))).join('+'), r.target])

describe('USB RX start-up (A HLBleDeviceActivity getIsSupportFourMic → getFourModeOrVersion → $getDeviceAllInfo$1)', () => {
  it('probe heartbeat, RX version, 4-mic GET (new firmware), unit versions, get-all to 0, Mic Recognition, USB Output', async () => {
    const { simulator, device } = await open()
    expect(sentFrames(simulator)).toEqual([
      ['600b', 1], ['600a[1]', 1], ['6016', 1], ['600a[0]', 1], ['600a[2]', 1], ['600a[3]', 1],
      ['6003+6004+6005+6006+6007+6008+6015+600e', 0], ['6013', 1], ['8044', 1],
    ])
    const s = device.state
    expect(s.rx).toBe('available')
    expect(s.units.rx).toMatchObject({ online: true, version: '3.0.0.52', kind: 'phone-rx' })
    // A HLBleDeviceActivity.updateRxState: no battery for the mobile RX 1026.
    expect(s.units.rx.battery).toBeUndefined()
    expect(s.units.tx1).toMatchObject({ online: true, battery: 80, version: '3.0.0.21', serial: 'H2MTX000000001' })
    expect(s.units.box).toMatchObject({ online: true, battery: 76, version: '1.0.0.8' })
    expect(s.availability[MAX2_CONTROL.FOUR_MIC]).toEqual({ ok: true })
    await device.disconnect()
  })

  it('every start-up frame is a catalogued read; nothing is written unless syncTimeOnConnect', async () => {
    const { transport, simulator, device } = await open()
    for (const f of transport.sent) expect(d.commands[max2CommandOfFrame(f)!]?.safety).toBe('read')
    expect(simulator.systemTime).toBeNull()
    await device.disconnect()
    const t = await open(MOBILE, {}, {}, { syncTimeOnConnect: true, now: () => Date.UTC(2026, 10, 6, 12), tzOffsetMinutes: -60 })
    expect(t.simulator.systemTime!.reduce((a, b) => a * 256 + b, 0)).toBe(Date.UTC(2026, 10, 6, 13))
    await t.device.disconnect()
  })

  it('4 Mic & 1 RX: versions of TX3 / TX4 too, 6-byte gains, mic 3/4 from the 49-byte heartbeat', async () => {
    const { simulator, device } = await open(MOBILE, { profile: '4mic' })
    expect(sentFrames(simulator).map((f) => f[0])).toEqual(expect.arrayContaining(['600a[4]', '600a[5]']))
    expect(device.state.values[MAX2_CONTROL.FOUR_MIC]).toBe(true)
    expect(device.state.units.tx3).toMatchObject({ online: true, battery: 64 })
    await device.set(MAX2_CONTROL.MIC_GAIN, 30, { unit: 'tx3' })
    expect(simulator.requests.at(-1)!.items[0]).toMatchObject({ cmd: MAX2_CMD.VOICE_GAIN, payload: Uint8Array.of(0, 0, 20, 20, 30, 20) })
    // Wireless Monitoring is offered in 2 Mic & 1 RX mode only (A updateFourMicOneRxState).
    expect(device.state.availability[MAX2_CONTROL.WIRELESS]).toMatchObject({ ok: false, reason: 'four-mic-mode' })
    await device.disconnect()
  })

  it('old firmware: short heartbeat, no 4-mic GET, gated controls report firmware-too-old', async () => {
    const { simulator, device } = await open(MOBILE, { rxVersion: '3.0.0.40', params: { heartbeatLength: 33 } })
    expect(sentFrames(simulator).map((f) => f[0])).not.toContain('6016')
    expect((device.state.raw as Max2Heartbeat).length).toBe(33)
    for (const id of [MAX2_CONTROL.FOUR_MIC, MAX2_CONTROL.RX_PAIR, MAX2_CONTROL.WIRELESS, MAX2_CONTROL.OWS_VOLUME]) {
      expect(device.state.availability[id], id).toMatchObject({ ok: false, reason: 'firmware-too-old' })
    }
    await expect(device.set(MAX2_CONTROL.RX_PAIR, true, { confirm: true })).rejects.toBeInstanceOf(ControlUnavailableError)
    await device.disconnect()
  })

  it('camera RX: battery shown, timecode from the heartbeat, no RX pairing / wireless monitoring / OWS controls', async () => {
    const { device } = await open(CAMERA, { params: { tc: true, tcMode: 2 } })
    expect(device.state.units.rx).toMatchObject({ battery: 88, kind: 'camera-rx' })
    expect(device.state.values).toMatchObject({ [MAX2_CONTROL.TC_ENABLED]: true, [MAX2_CONTROL.TC_MODE]: 2, [MAX2_CONTROL.TC_FPS]: 2, [MAX2_CONTROL.TC_TIMING]: 1 })
    expect(device.state.values[MAX2_STATUS_VALUE.TC_TIME]).toEqual([2, 3, 4])
    expect(device.controls.map((c) => c.id)).not.toEqual(expect.arrayContaining([MAX2_CONTROL.RX_PAIR]))
    expect(device.controls.some((c) => c.id === MAX2_CONTROL.WIRELESS || c.id.startsWith('max2.ows'))).toBe(false)
    // TC Mode 3 allows stereo on the camera RX (A initView lambda 13: timeMode != MODE_THREE).
    await expect(device.set(MAX2_CONTROL.CHANNEL_MODE, 1)).resolves.toMatchObject({ ok: true })
    await device.disconnect()
  })

  it('the mobile RX has no timecode page, so its TC rule does not apply: stereo with TC on is allowed (A: !is6701UsbMobile)', async () => {
    const { device, simulator } = await open(MOBILE, { params: { tc: true, tcMode: 0 } })
    expect(device.controls.some((c) => c.group === 'timecode')).toBe(false)
    await device.set(MAX2_CONTROL.CHANNEL_MODE, 1)
    expect(simulator.channel).toBe(1)
    await device.disconnect()
  })

  it('heartbeat earphone fields map to earL / earR units (A updateEarState: 1 L, 2 R, 3 both)', async () => {
    const { device } = await open(MOBILE, { params: { wireless: true, earphones: 1 } })
    expect(device.state.units.earL).toMatchObject({ online: true, battery: 70 })
    expect(device.state.units.earR).toMatchObject({ online: false })
    await device.disconnect()
  })
})

describe('BLE charging case (A blemic/operation/BleBoxOption; FEE7 / FEC1)', () => {
  it('probe 0x600A [0] to the BOX (5), versions to 5, get-all and TC / USB Output GETs to the RX (2); no Mic Recognition', async () => {
    const { simulator, device } = await open(BOX)
    expect(sentFrames(simulator)).toEqual([
      ['600a[0]', 5], ['600a[1]', 5], ['600a[0]', 5], ['600a[2]', 5], ['600a[3]', 5],
      ['6003+6004+6005+6006+6007+6008+6015+600e', 2], ['8044', 2], ['600f', 2], ['6010', 2],
    ])
    expect(device.controls.some((c) => c.id === MAX2_CONTROL.MIC_RECOGNITION || c.id === MAX2_CONTROL.FOUR_MIC)).toBe(false)
    expect(device.state.units.box).toMatchObject({ online: true, battery: 76 })
    await device.disconnect()
  })

  it('replies arrive in MTU − 3 pieces (default MTU 23 → 20 B) and reassemble; the pushes are mapped', async () => {
    const simulator = new Max2Simulator(BOX, { online: ['rx', 'tx1'] })
    const transport = simulatedTransport(simulator)
    const sizes: number[] = []
    transport.onPacket((p) => sizes.push(p.length))
    const device = createMax2Device(transport, BOX, { ...FAST, fetchIdentity: false, fetchSettings: false })
    await device.connect()
    await sleep(5)
    // 0x600A reply: 7 + 5 + 5 + 52 + 5 + 1 = 75 B → 20 + 20 + 20 + 15; then three pushes of 24 B → 20 + 4 each.
    expect(sizes.slice(0, 4)).toEqual([20, 20, 20, 15])
    expect(Math.max(...sizes)).toBe(20)
    expect(simulator.pushCount).toBe(1)
    expect(device.state.units.tx1).toMatchObject({ online: true, battery: 80 })
    expect(device.state.units.tx2?.online).toBe(false)
    expect(device.state.units.rx.battery).toBe(88)
    // A later push (TX1 goes offline) updates the state.
    simulator.mics[0].online = false
    simulator.pushStatus()
    await sleep(5)
    expect(device.state.units.tx1?.online).toBe(false)
    await device.disconnect()
  })

  it('the status poll is 0x600B to target 2 through the BOX every 3 s (iOS); without forwarding the start-up reads still populate', async () => {
    const { simulator, device } = await open(BOX)
    await device.refresh('status')
    expect(sentFrames(simulator).at(-1)).toEqual(['600b', 2])
    expect(device.state.lastStatusAt).not.toBeNull()
    await device.disconnect()
    // Android never polls over BLE; a BOX that does not forward 0x600B leaves the poll unanswered.
    const quiet = await open(BOX, { params: { forwardHeartbeat: false } })
    expect(quiet.device.state.values[MAX2_CONTROL.NOISE_DEPTH]).toBe(10)
    expect(quiet.device.state.values[MAX2_CONTROL.TC_FPS]).toBe(2)
    await expect(quiet.device.refresh('status')).rejects.toBeInstanceOf(TimeoutError)
    await quiet.device.disconnect()
  })

  it('NC goes to the RX, then to every online mic (Android targets 3, 4; iOS online filter)', async () => {
    const { simulator, device } = await open(BOX)
    await device.set(MAX2_CONTROL.NOISE_DEPTH, 15)
    expect(simulator.noiseTargets).toEqual([2, 3, 4])
    expect(simulator.requests.at(-1)!.items[0].payload).toEqual(Uint8Array.of(1, 15))
    await device.disconnect()
    // Offline mics are skipped (iOS updateNoiseView: tx1IsOnline..; Android sends to all); bleNoiseFanOut: false sends to the RX only.
    const one = await open(BOX, { online: ['rx', 'tx1'] })
    await one.device.set(MAX2_CONTROL.NOISE_ENABLED, false)
    expect(one.simulator.noiseTargets).toEqual([2, 3])
    await one.device.disconnect()
    const rxOnly = await open(BOX, {}, {}, { bleNoiseFanOut: false })
    await rxOnly.device.set(MAX2_CONTROL.NOISE_ENABLED, false)
    expect(rxOnly.simulator.noiseTargets).toEqual([2])
    await rxOnly.device.disconnect()
  })

  it('a mic that comes online after start-up is queried: 0x600A [unit] and the NC GET to TX1 (target 3)', async () => {
    const { simulator, device } = await open(BOX, { online: ['rx', 'tx1'] })
    const from = simulator.requests.length
    simulator.mics[1].online = true
    simulator.pushStatus()
    await sleep(10)
    await device.idle()
    expect(sentFrames(simulator).slice(from)).toEqual([['600a[3]', 5], ['6006', 3]])
    await device.disconnect()
  })

  it('safety track is offered through the BOX, refused there while TC is on in Mode 1 / 2', async () => {
    const ok = await open(BOX)
    await ok.device.set(MAX2_CONTROL.CHANNEL_MODE, 2)
    expect(ok.simulator.channel).toBe(2)
    await ok.device.disconnect()
    const tc = await open(BOX, { params: { tc: true, tcMode: 1 } })
    await expect(tc.device.set(MAX2_CONTROL.CHANNEL_MODE, 1)).rejects.toMatchObject({ reason: 'timecode-on' })
    await tc.device.disconnect()
  })

  it('end to end through WebBluetoothTransport and a fake FEE7 / FEC1 peripheral at MTU 23 (20-byte writes)', async () => {
    const sim = new Max2Simulator(BOX)
    const { transport, device: ble, bridge } = bleSimulatedTransport(sim, BOX, { mtu: 23, frameLength: max2FrameLength, transport: { writeChunkSize: 20 } })
    const mic = createMax2Device(transport, BOX, { ...FAST, requestTimeoutMs: 600, probeTimeoutMs: 600 })
    await mic.connect()
    await mic.idle()
    expect(mic.state.values[MAX2_CONTROL.GAIN_DYNAMIC]).toBe(1)
    await mic.set(MAX2_CONTROL.MIC_LOCK, true)
    expect(sim.micLock).toBe(true)
    // Every write went out in ≤ 20-byte pieces and was joined into whole frames again.
    expect(ble.characteristic(0xfee7, 0xfec1).writes.every((w) => w.data.length <= 20)).toBe(true)
    expect(bridge.frames.every((f) => max2FrameLength(f) === f.length)).toBe(true)
    await mic.disconnect()
  })
})

describe('writes: payloads the official app builds', () => {
  it('per-mic gain sends the whole vector as custom gain with level High (A SetVoiceGainIntent(CUSTOM_GAIN, STRONG_GAIN, …))', async () => {
    const { simulator, device } = await open()
    await device.set(MAX2_CONTROL.MIC_GAIN, 14, { unit: 'tx2' })
    expect(simulator.requests.at(-1)!.items[0].payload).toEqual(Uint8Array.of(0, 0, 20, 14))
    expect(device.state.values).toMatchObject({ [MAX2_CONTROL.GAIN_TYPE]: 0, [controlKey(MAX2_CONTROL.MIC_GAIN, 'tx2')]: 14 })
    await device.set(MAX2_CONTROL.GAIN_DYNAMIC, 2)
    expect(simulator.requests.at(-1)!.items[0].payload).toEqual(Uint8Array.of(1, 2, 20, 14))
    await device.disconnect()
  })

  it('two gain changes in a row both reach the device (the second payload carries the first)', async () => {
    const { simulator, device } = await open()
    await Promise.all([device.set(MAX2_CONTROL.MIC_GAIN, 5, { unit: 'tx1' }), device.set(MAX2_CONTROL.MIC_GAIN, 35, { unit: 'tx2' })])
    expect([simulator.mics[0].gain, simulator.mics[1].gain]).toEqual([5, 35])
    await device.disconnect()
  })

  it('NC and gain writes need the current state: refused while it is unknown', async () => {
    const simulator = new Max2Simulator(MOBILE, { dropReplies: true })
    const device = createMax2Device(simulatedTransport(simulator), MOBILE, { ...FAST, blindWrites: true })
    await device.connect()
    expect(device.state.rx).toBe('unavailable')
    await expect(device.set(MAX2_CONTROL.NOISE_ENABLED, true)).rejects.toMatchObject({ reason: 'state-unknown' })
    await expect(device.set(MAX2_CONTROL.MIC_GAIN, 3, { unit: 'tx1' })).rejects.toMatchObject({ reason: 'state-unknown' })
    // A single-field write goes out blind (confirmed false).
    await expect(device.set(MAX2_CONTROL.MIC_LOCK, true)).resolves.toMatchObject({ ok: true, confirmed: false })
    await device.disconnect()
  })

  it('write-only: the refused writes show as blocked up front (blindAvailability), and a blind depth unblocks the NC switch', async () => {
    const simulator = new Max2Simulator(MOBILE, { dropReplies: true })
    const device = createMax2Device(simulatedTransport(simulator), MOBILE, { ...FAST, blindWrites: true })
    await device.connect()
    const a = device.state.availability
    expect(a[MAX2_CONTROL.NOISE_ENABLED]).toMatchObject({ ok: false, reason: 'state-unknown' })
    expect(a[MAX2_CONTROL.GAIN_TYPE]).toMatchObject({ ok: false, reason: 'state-unknown' })
    expect(a[MAX2_CONTROL.GAIN_DYNAMIC]).toMatchObject({ ok: false, reason: 'state-unknown' })
    expect(a[`${MAX2_CONTROL.MIC_GAIN}:tx1`]).toMatchObject({ ok: false, reason: 'state-unknown' })
    expect(a[`${MAX2_CONTROL.MIC_GAIN}:tx3`]).toMatchObject({ ok: false, reason: 'two-mic-mode' })
    // Firmware-gated controls wait for an RX version that can't be read.
    expect(a[MAX2_CONTROL.FOUR_MIC]).toMatchObject({ ok: false, reason: 'version-unknown' })
    expect(a[MAX2_CONTROL.NOISE_DEPTH]).toBeUndefined()
    await device.set(MAX2_CONTROL.NOISE_DEPTH, 10)
    expect(device.state.availability[MAX2_CONTROL.NOISE_ENABLED]).toEqual({ ok: true })
    await expect(device.set(MAX2_CONTROL.NOISE_ENABLED, false)).resolves.toMatchObject({ ok: true, confirmed: false })
    await device.disconnect()
  })

  it('the blind refusals are dropped once replies arrive', async () => {
    const simulator = new Max2Simulator(MOBILE, { dropReplies: true })
    const device = createMax2Device(simulatedTransport(simulator), MOBILE, { ...FAST, blindWrites: true })
    await device.connect()
    expect(device.state.availability[MAX2_CONTROL.GAIN_TYPE]).toMatchObject({ reason: 'state-unknown' })
    simulator.faults.dropReplies = false
    expect(await device.probe()).toBe('available')
    expect(device.state.availability[MAX2_CONTROL.GAIN_TYPE]?.reason).not.toBe('state-unknown')
    await device.disconnect()
  })

  it('USB Output: only 24bit is written, it restarts the RX (needs confirm, iOS), then read back with 0x8044', async () => {
    const { simulator, device } = await open()
    simulator.uacMode = 1
    await device.refresh('settings')
    expect(device.state.values[MAX2_CONTROL.USB_OUTPUT]).toBe(1)
    const n = simulator.requests.length
    await expect(device.set(MAX2_CONTROL.USB_OUTPUT, 0)).rejects.toBeInstanceOf(DestructiveCommandError)
    // 32bit float is refused for what it is, with or without confirm.
    await expect(device.set(MAX2_CONTROL.USB_OUTPUT, 1)).rejects.toMatchObject({ reason: 'apple-only' })
    await expect(device.set(MAX2_CONTROL.USB_OUTPUT, 1, { confirm: true })).rejects.toMatchObject({ reason: 'apple-only' })
    expect(simulator.requests.length).toBe(n)
    expect(device.controls.find((c) => c.id === MAX2_CONTROL.USB_OUTPUT)?.confirmText).toMatch(/restart the device/)
    await device.set(MAX2_CONTROL.USB_OUTPUT, 0, { confirm: true })
    await sleep(170)
    expect(sentFrames(simulator).slice(-2)).toEqual([['8043[0]', 1], ['8044', 1]])
    expect(device.state.values[MAX2_CONTROL.USB_OUTPUT]).toBe(0)
    await device.disconnect()
  })
})

describe('timecode Timing Method (A TimeCodeActivity)', () => {
  it('Count From Zero / Real-time are plain writes; Reset needs confirm (confirmReset) and is hidden in Real-time Timing', async () => {
    const { simulator, device } = await open(CAMERA)
    expect(device.state.values[MAX2_CONTROL.TC_TIMING]).toBe(1)
    const n = simulator.requests.length
    await expect(device.set(MAX2_CONTROL.TC_TIMING, 2, { confirm: true })).rejects.toMatchObject({ reason: 'real-time-timing' })
    expect(simulator.requests.length).toBe(n)
    await device.set(MAX2_CONTROL.TC_TIMING, 0)
    expect(simulator.timing).toBe(0)
    expect(device.timingNeedsConfirm(2)).toBe(true)
    expect(device.timingNeedsConfirm(1)).toBe(false)
    await expect(device.set(MAX2_CONTROL.TC_TIMING, 2)).rejects.toBeInstanceOf(DestructiveCommandError)
    expect(simulator.requests.at(-1)!.items[0].payload).toEqual(Uint8Array.of(0))
    expect(await device.set(MAX2_CONTROL.TC_TIMING, 2, { confirm: true })).toMatchObject({ ok: true, confirmed: true })
    expect(simulator.requests.at(-1)!.items.map((i) => [i.cmd, Array.from(i.payload)])).toEqual([[MAX2_CMD.TIMING_MODE, [2]]])
    expect(device.controls.find((c) => c.id === MAX2_CONTROL.TC_TIMING)?.confirmText).toMatch(/00:00:00:00/)
    await device.disconnect()
  })

  it('before connect the engine refusal keeps its type (not the confirm)', async () => {
    const simulator = new Max2Simulator(CAMERA)
    const device = createMax2Device(simulatedTransport(simulator), CAMERA, FAST)
    await expect(device.set(MAX2_CONTROL.TC_TIMING, 2)).rejects.not.toBeInstanceOf(DestructiveCommandError)
  })
})

describe('NC depth (A HLBleDeviceActivity$initView$1$8: no mic-online check, shown while NC is on)', () => {
  it('the depth can be changed with every mic offline; the switch cannot', async () => {
    const { simulator, device } = await open(MOBILE, { online: ['rx', 'box'] })
    expect(device.state.availability[MAX2_CONTROL.NOISE_ENABLED]).toMatchObject({ ok: false, reason: 'mic-disconnected' })
    expect(device.state.availability[MAX2_CONTROL.NOISE_DEPTH]).toEqual({ ok: true })
    await device.set(MAX2_CONTROL.NOISE_DEPTH, 12)
    expect(simulator.requests.at(-1)!.items[0].payload).toEqual(Uint8Array.of(1, 12))
    await device.disconnect()
  })
})

describe('preconditions of the Wireless Monitoring page (need the RX version first)', () => {
  const withId: MicDeviceOptions = { fetchIdentity: true, fetchSettings: true }

  it('monitoring controls need Wireless Monitoring on and, for play/pause and volume, a connected earphone', async () => {
    const off = await open(MOBILE, {}, withId)
    await expect(off.device.set(MAX2_CONTROL.OWS_VOLUME, 10)).rejects.toMatchObject({ reason: 'wireless-off' })
    await expect(off.device.set(MAX2_CONTROL.OWS_PAIR, true, { confirm: true })).rejects.toMatchObject({ reason: 'wireless-off' })
    await off.device.disconnect()
    const noEar = await open(MOBILE, { params: { wireless: true, earphones: 0 } }, withId)
    await expect(noEar.device.set(MAX2_CONTROL.OWS_MONITOR, true)).rejects.toMatchObject({ reason: 'earphone-disconnected' })
    await noEar.device.disconnect()
  })

  it('with earphones connected: pairing state and volume are read at start-up; volume writes read back with 0x6019', async () => {
    const { simulator, device } = await open(MOBILE, { params: { wireless: true, earphones: 3 } }, withId)
    expect(device.state.values).toMatchObject({ [MAX2_STATUS_VALUE.OWS_PAIRED]: true, [MAX2_CONTROL.OWS_VOLUME]: 20, [MAX2_CONTROL.WIRELESS]: true })
    await device.set(MAX2_CONTROL.OWS_VOLUME, 30)
    await sleep(170)
    expect(simulator.earVolume).toBe(30)
    expect(sentFrames(simulator).slice(-2)).toEqual([['6019[30]', 1], ['6019', 1]])
    await device.set(MAX2_CONTROL.OWS_MONITOR, true)
    expect(simulator.earMonitor).toBe(1)
    await device.disconnect()
  })
})

describe('safety (FAMILIES.md §2.3): untested product', () => {
  it('Phone Speaker, Wireless Monitoring, 4 Mic & 1 RX and RX pairing restart / re-link the RX: refused without confirm', async () => {
    const { simulator, device } = await open(MOBILE, {}, { fetchIdentity: true })
    const before = simulator.requests.length
    for (const [id, v] of [[MAX2_CONTROL.SPEAKER, true], [MAX2_CONTROL.WIRELESS, true], [MAX2_CONTROL.FOUR_MIC, true], [MAX2_CONTROL.RX_PAIR, true]] as const) {
      await expect(device.set(id, v), id).rejects.toBeInstanceOf(DestructiveCommandError)
    }
    expect(simulator.requests.length).toBe(before)
    await device.set(MAX2_CONTROL.SPEAKER, true, { confirm: true })
    await device.set(MAX2_CONTROL.WIRELESS, true, { confirm: true })
    expect(simulator.restarts).toBe(2)
    await device.set(MAX2_CONTROL.RX_PAIR, true, { confirm: true })
    expect(simulator.requests.at(-1)!.items[0]).toMatchObject({ cmd: MAX2_CMD.MOBILE_RX_PAIR, payload: new Uint8Array(0) })
    await device.disconnect()
  })

  it('no destructive or OTA control exists; factory reset, OWS unpair and OTA frames are refused even forced', async () => {
    expect(d.controls.filter((c) => c.safety === 'destructive' || c.safety === 'ota')).toEqual([])
    const { simulator, device } = await open(MOBILE, {}, { allowDestructive: true })
    const before = simulator.requests.length
    const reset = MAX2_VECTORS.find((v) => v.name.startsWith('MAX 2 factory reset'))!.bytes
    const unpair = encodeMomaRequest(MOMA_6701_USB, max2Set(MAX2_CMD.EARPHONE_PAIR, [1]))
    const ota = encodeMomaRequest(MOMA_6701_USB, max2Set(MAX2_CMD.FIRMWARE_TRAN_START, [0, 0, 0, 0]))
    for (const f of [reset, unpair, ota]) {
      await expect(device.sendRaw(f)).rejects.toBeInstanceOf(CommandSafetyError)
      await expect(device.sendRaw(f, { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    }
    expect(simulator.requests.length).toBe(before)
    await device.disconnect()
  })

  it('the console may send a GET of a restart-causing id unforced (a read), but not its SET', async () => {
    const { simulator, device } = await open()
    const get = encodeMomaRequest(MOMA_6701_USB, { items: [{ cmd: MAX2_CMD.RX_OUTSWITCH }] })
    const set = encodeMomaRequest(MOMA_6701_USB, max2Set(MAX2_CMD.RX_OUTSWITCH, [1]))
    expect(max2CommandOfFrame(get)).toBe(max2GetKey(MAX2_CMD.RX_OUTSWITCH))
    await device.sendRaw(get)
    expect(simulator.requests.at(-1)!.items[0].cmd).toBe(MAX2_CMD.RX_OUTSWITCH)
    await expect(device.sendRaw(set)).rejects.toThrow(/without force/)
    expect(simulator.restarts).toBe(0)
    await device.disconnect()
  })

  it('the OWS earphone row (102) has no control link: no device, no simulator', () => {
    expect(OWS.support?.level).toBe('recognised')
    expect(() => d.createSimulator(OWS)).toThrow(/no MAX 2 control link/)
    expect(() => d.createDevice(simulatedTransport(new Max2Simulator(MOBILE)), OWS)).toThrow(/no MAX 2 control link/)
  })
})

describe('hardware check (FAMILIES.md §5.7)', () => {
  it('read steps run against the simulator; the reversible write restores Lock Mic', async () => {
    const { simulator, device } = await open(CAMERA)
    const step = (id: string) => MAX2_HARDWARE_CHECK.find((s) => s.id === id)!.run!(device)
    await expect(step('device-info')).resolves.toMatchObject({ ok: true, summary: expect.stringContaining('RX 3.0.0.52') })
    await expect(step('heartbeat')).resolves.toMatchObject({ ok: true, summary: '49-byte payload' })
    await expect(step('ble-services')).resolves.toMatchObject({ ok: false })
    const r = await step('mic-lock')
    expect(r.ok).toBe(true)
    expect(simulator.micLock).toBe(false)
    expect(simulator.requests.filter((q) => q.items[0].cmd === MAX2_CMD.MIC_LOCK && q.items[0].payload.length)).toHaveLength(2)
    await device.disconnect()
  })
})
