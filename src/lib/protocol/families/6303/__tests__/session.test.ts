/**
 * LARK M3 session behaviour against the simulator: the official app's start-up reads and their order, multi-RX
 * topology and primary-only settings, camera / phone RX differences, the per-value 4-track confirm and the other
 * restart-causing settings, isRefreshCanto, unsolicited Bluetooth events, 64 / 512-byte framing, safety refusals and
 * the hardware check (FAMILIES.md §3.8 row 6303, §5.7).
 */
import { describe, expect, it } from 'vitest'
import { DestructiveCommandError, UnsupportedError } from '../../../device'
import { CONTROL } from '../../../core/controls'
import { ControlUnavailableError } from '../../../core/errors'
import { simulatedTransport } from '../../../core/simulate'
import type { MicDeviceOptions, SimOptions } from '../../../core/types'
import { decodeMomaFrame, encodeMomaFrame, encodeMomaRequest, MOMA_6303 } from '../../../moma'
import {
  M3Cmd, M3Device, M3Requests, M3Simulator, M3_CONTROL, M3_HARDWARE_CHECK, M3_INFO, createM3Driver, type M3Heartbeat,
} from '..'

const driver = createM3Driver()
const row = (pid: number) => driver.products.find((p) => p.productId === pid)!
const PHONE = 1038
const CAMERA = 1036
const FAST: MicDeviceOptions = { requestTimeoutMs: 40, probeTimeoutMs: 60, retries: 0, interFrameDelayMs: 0, heartbeatIntervalMs: null }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function setup(pid: number, sim: SimOptions = {}, o: MicDeviceOptions = {}) {
  const p = row(pid)
  const simulator = driver.createSimulator(p, sim) as M3Simulator
  const transport = simulatedTransport(simulator)
  const device = driver.createDevice(transport, p, { ...FAST, ...o }) as M3Device
  await device.connect()
  await device.idle()
  const sent = () => simulator.received.map((r) => `${r.cmd.toString(16).padStart(4, '0')}${r.payload.length && r.payload.length <= 4 ? `[${r.payload.join(',')}]` : ''}`)
  return { simulator, transport, device, sent }
}

describe('start-up (A HLDeviceVolTrack6303ViewModel, MoreSetting6303ViewModel, EquipmentViewModel)', () => {
  it('phone RX: heartbeat, RX info, settings, online TX infos, firmware list of the running system', async () => {
    const { device, sent, simulator } = await setup(PHONE)
    expect(sent()).toEqual(['6000', '600a[6]', '6011', '600a[1]', '600a[2]', '6012[0]'])
    const s = device.state
    expect(s.units.rx).toMatchObject({ online: true, kind: 'phone-rx', role: 'primary', battery: undefined, label: 'RX 1', serial: 'M3RX0000001', version: '2.0.1.2', mac: '50:C0:60:00:00:01' })
    expect(s.units.tx1).toMatchObject({ online: true, battery: 80, muted: false, serial: 'M3TX0000001', version: '2.0.0.9' })
    expect(s.units.tx3).toMatchObject({ online: false })
    expect(s.values[M3_CONTROL.BIT_DEPTH]).toBe(0)
    expect(s.values[CONTROL.SPEAKER]).toBe(false)
    expect(device.session.firmware[0]?.map((i) => i.id)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10])
    expect(device.session.lastHeartbeat).toEqual({ source: 1, target: 6, type: 3, length: 30 })
    expect(simulator.received.every((r) => driver.commands[r.cmd]?.safety === 'read')).toBe(true)
    await device.disconnect()
  })

  it('camera RX: also the three volume levels (0x100E) and the hot-shoe accessory (0x600A [10])', async () => {
    const { device, sent } = await setup(CAMERA)
    expect(sent()).toEqual(['6000', '600a[6]', '6011', '100e[0]', '600a[1]', '600a[2]', '600a[10]', '6012[0]'])
    expect(device.state.units.rx).toMatchObject({ kind: 'camera-rx', battery: 76 })
    expect(device.state.values).toMatchObject({ [M3_CONTROL.CAMERA_LEVEL_1]: -4, [M3_CONTROL.CAMERA_LEVEL_2]: 0, [M3_CONTROL.CAMERA_LEVEL_3]: 4, [M3_INFO.CAMERA_GEAR]: 1 })
    expect(device.session.hotShoe).toMatchObject({ deviceId: 10, serial: 'M3HS0000010' })
    await device.disconnect()
  })

  it('without fetchIdentity / fetchSettings only the heartbeat goes out', async () => {
    const { device, sent } = await setup(PHONE, {}, { fetchIdentity: false, fetchSettings: false })
    expect(sent()).toEqual(['6000'])
    await device.disconnect()
  })

  it('a TX that comes online later gets its 0x600A', async () => {
    const { device, simulator, sent } = await setup(PHONE)
    simulator.tx[2].online = true
    await device.refresh('status')
    await sleep(5)
    await device.idle()
    expect(sent().slice(-2)).toEqual(['6000', '600a[3]'])
    expect(device.state.units.tx3).toMatchObject({ online: true, serial: 'M3TX0000003' })
    await device.disconnect()
  })
})

describe('multi-RX topology and the primary RX', () => {
  it('secondary RX: roles and labels; global settings refused before sending; per-RX output settings allowed', async () => {
    const { device, simulator } = await setup(PHONE, { profile: 'secondary' })
    const s = device.state
    expect(s.units.rx).toMatchObject({ role: 'secondary', label: 'RX 2', kind: 'phone-rx' })
    expect(s.units.rx2).toMatchObject({ online: true, role: 'primary', label: 'RX 1', kind: 'camera-rx', battery: 70, serial: 'M3RX0000001' })
    expect(s.values).toMatchObject({ [M3_INFO.RX_NUMBER]: 2, [M3_INFO.PRIMARY_RX_NUMBER]: 1 })
    const before = simulator.received.length
    for (const [id, v] of [[CONTROL.LED, false], [CONTROL.NOISE_ENABLED, false], [M3_CONTROL.SMART_MIX, true], [M3_CONTROL.TX_BUTTON_LOCK, true]] as const) {
      await expect(device.set(id, v), id).rejects.toMatchObject({ reason: 'secondary-rx' })
    }
    await expect(device.set(CONTROL.MIC_MUTE, true, { unit: 'tx1' })).rejects.toMatchObject({ reason: 'secondary-rx' })
    expect(simulator.received.length).toBe(before)
    expect(await device.set(CONTROL.VOLUME, 5)).toMatchObject({ ok: true, confirmed: true })
    expect(await device.set(CONTROL.CHANNEL_MODE, 0)).toMatchObject({ ok: true })
    expect(simulator.volume).toBe(5)
    await device.disconnect()
  })

  it('a secondary RX refuses global settings itself too (simulator, preconditions off)', async () => {
    const { device } = await setup(PHONE, { profile: 'secondary' }, { enforcePreconditions: false })
    expect(await device.set(CONTROL.LED, false)).toMatchObject({ ok: false, code: 1 })
    await device.disconnect()
  })

  it('three RXs, this one primary; another RX becomes the primary', async () => {
    const { device, simulator } = await setup(CAMERA, { profile: 'multi-rx' })
    expect(['rx', 'rx2', 'rx3', 'rx4'].map((u) => device.state.units[u as 'rx']?.online)).toEqual([true, true, true, false])
    expect(device.state.units.rx2).toMatchObject({ role: 'secondary', serial: 'M3RX0000002' })
    simulator.mainRx = 2
    await device.refresh('status')
    expect(device.state.units.rx.role).toBe('secondary')
    expect(device.state.units.rx3!.role).toBe('primary')
    expect(device.state.availability[CONTROL.LED]).toMatchObject({ ok: false, reason: 'secondary-rx' })
    await device.disconnect()
  })
})

describe('Channel Mode: 4-track restarts the receiver (per-value confirm, M3Device)', () => {
  it('Mono ↔ Stereo is a plain write; entering or leaving 4-track needs { confirm: true }', async () => {
    const { device, simulator } = await setup(PHONE)
    expect(device.state.values[CONTROL.CHANNEL_MODE]).toBe(1)
    expect(device.channelModeNeedsConfirm(0)).toBe(false)
    expect(device.channelModeNeedsConfirm(2)).toBe(true)
    expect(await device.set(CONTROL.CHANNEL_MODE, 0)).toMatchObject({ ok: true })
    const before = simulator.received.length
    await expect(device.set(CONTROL.CHANNEL_MODE, 2)).rejects.toBeInstanceOf(DestructiveCommandError)
    expect(simulator.received.length).toBe(before)
    expect(await device.set(CONTROL.CHANNEL_MODE, 2, { confirm: true })).toMatchObject({ ok: true })
    expect(simulator.channelMode).toBe(2)
    expect(simulator.restarts).toEqual([M3Cmd.SET_SOUND_MODE])
    await expect(device.set(CONTROL.CHANNEL_MODE, 1)).rejects.toThrow(/to or from 4-track/)
    expect(await device.set(CONTROL.CHANNEL_MODE, 1, { confirm: true })).toMatchObject({ ok: true })
    // The selected mode again sends nothing (A EquipmentFragment.initSoundMode).
    const n = simulator.received.length
    expect(await device.set(CONTROL.CHANNEL_MODE, 1)).toMatchObject({ ok: true })
    expect(simulator.received.length).toBe(n)
    await device.disconnect()
  })

  it('4-track is refused in 2TX&2RX even with confirm; so is smart mix', async () => {
    const { device } = await setup(PHONE, { profile: '2t2r' })
    expect(device.state.values[M3_INFO.SYSTEM]).toBe(1)
    await expect(device.set(CONTROL.CHANNEL_MODE, 2, { confirm: true })).rejects.toMatchObject({ reason: 'not-4t4r' })
    await expect(device.set(M3_CONTROL.SMART_MIX, true)).rejects.toBeInstanceOf(ControlUnavailableError)
    await device.disconnect()
  })
})

describe('More Settings: restart-causing settings are disruptive', () => {
  it('bit depth and playback without unplugging need confirm, are read back with 0x6011', async () => {
    const { device, simulator } = await setup(PHONE)
    simulator.sampling = 1 // set to 32bit float by the iOS app
    await device.refresh('settings')
    expect(device.state.values[M3_CONTROL.BIT_DEPTH]).toBe(1)
    await expect(device.set(M3_CONTROL.BIT_DEPTH, 0)).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.set(CONTROL.SPEAKER, true)).rejects.toThrow(/requires a restart/)
    expect(simulator.restarts).toEqual([])
    expect(await device.set(M3_CONTROL.BIT_DEPTH, 0, { confirm: true })).toMatchObject({ ok: true, confirmed: true })
    expect(await device.set(CONTROL.SPEAKER, true, { confirm: true })).toMatchObject({ ok: true })
    expect(simulator.restarts).toEqual([M3Cmd.SET_SAMPLING, M3Cmd.SET_SOUND_OUT])
    simulator.sampling = 1 // the device changed it back: the read-back shows the truth
    await device.refresh('settings')
    expect(device.state.values[M3_CONTROL.BIT_DEPTH]).toBe(1)
    expect(device.state.values[CONTROL.SPEAKER]).toBe(true)
    await device.disconnect()
  })

  it('bit depth: 32bit float is refused (A initView$lambda$8 only_support_apple); 24bit when already 24bit sends nothing', async () => {
    const { device, simulator } = await setup(PHONE)
    expect(device.state.values[M3_CONTROL.BIT_DEPTH]).toBe(0)
    const n = simulator.requests.length
    await expect(device.set(M3_CONTROL.BIT_DEPTH, 1)).rejects.toMatchObject({ reason: 'apple-only' })
    await expect(device.set(M3_CONTROL.BIT_DEPTH, 1, { confirm: true })).rejects.toMatchObject({ reason: 'apple-only' })
    // A initView$lambda$7: `if (rxSample == SAMPLE_24_BIT) return`.
    expect(await device.set(M3_CONTROL.BIT_DEPTH, 0, { confirm: true })).toMatchObject({ ok: true })
    expect(simulator.requests.length).toBe(n)
    expect(simulator.restarts).toEqual([])
    await device.disconnect()
  })

  it('TX button lock and auto power off are status-backed (heartbeat bytes 26 / 27)', async () => {
    const { device, simulator } = await setup(PHONE)
    expect(await device.set(M3_CONTROL.TX_BUTTON_LOCK, true)).toMatchObject({ ok: true })
    expect(await device.set(CONTROL.AUTO_OFF, false)).toMatchObject({ ok: true })
    expect([simulator.keyLock, simulator.autoExit]).toEqual([true, false])
    await device.refresh('status')
    expect((device.state.raw as M3Heartbeat).micLockSwitch).toBe(1)
    expect(device.state.values[CONTROL.AUTO_OFF]).toBe(false)
    await device.disconnect()
  })
})

describe('home-page writes', () => {
  it('mute sends [txId, mute] and reads it back with 0x1000; NC sends level and switch together', async () => {
    const { device, simulator, sent } = await setup(PHONE)
    expect(await device.set(CONTROL.MIC_MUTE, true, { unit: 'tx2' })).toMatchObject({ ok: true })
    await sleep(200)
    expect(sent().slice(-2)).toEqual(['1001[2,1]', '1000[2]'])
    expect(device.state.values['mic.mute:tx2']).toBe(true)
    expect(simulator.tx[1].muted).toBe(true)
    expect(await device.set(CONTROL.NOISE_LEVEL, 3)).toMatchObject({ ok: true })
    expect(await device.set(CONTROL.NOISE_ENABLED, false)).toMatchObject({ ok: true })
    expect(sent().slice(-2)).toEqual(['1003[0,2,1]', '1003[0,2,0]'])
    // NC off hides the level row at once (availability recomputed after the optimistic value).
    await expect(device.set(CONTROL.NOISE_LEVEL, 1)).rejects.toMatchObject({ reason: 'noise-off' })
    await device.disconnect()
  })

  it('the indicator light is inverted on the wire; TX recognition and smart mix are plain switches', async () => {
    const { device, sent } = await setup(PHONE)
    await device.set(CONTROL.LED, false)
    await device.set(CONTROL.MIC_RECOGNITION, true)
    await device.set(M3_CONTROL.SMART_MIX, true)
    expect(sent().slice(-3)).toEqual(['6009[1]', '600c[1]', '100b[0,1]'])
    await device.refresh('status')
    expect(device.state.values).toMatchObject({ [CONTROL.LED]: false, [CONTROL.MIC_RECOGNITION]: true, [M3_CONTROL.SMART_MIX]: true })
    await device.disconnect()
  })

  it('camera RX: levels keep their order, go out together (0x1010, wire dB + 10) and are read back', async () => {
    const { device, simulator, sent } = await setup(CAMERA)
    expect(await device.set(M3_CONTROL.CAMERA_LEVEL_2, 8)).toMatchObject({ ok: true })
    expect(simulator.gains).toEqual([6, 18, 18])
    expect(device.state.values).toMatchObject({ [M3_CONTROL.CAMERA_LEVEL_1]: -4, [M3_CONTROL.CAMERA_LEVEL_2]: 8, [M3_CONTROL.CAMERA_LEVEL_3]: 8 })
    await sleep(200)
    expect(sent().slice(-2)).toEqual(['1010[0,6,18,18]', '100e[0]'])
    expect(await device.set(M3_CONTROL.HOT_SHOE_SYNC, false)).toMatchObject({ ok: true })
    expect(simulator.hotShoeSync).toBe(false)
    await expect(device.set(CONTROL.VOLUME, 2)).rejects.toBeInstanceOf(UnsupportedError)
    await device.disconnect()
  })
})

describe('voice-profile refresh flag (heartbeat byte 28, isRefreshCanto)', () => {
  it('is shown, never cleared automatically (a background write), cleared with acknowledgeVoiceProfileRefresh()', async () => {
    const { device, simulator } = await setup(PHONE, { profile: 'refresh' })
    expect(device.state.values[M3_INFO.PROFILES_CHANGED]).toBe(true)
    await device.refresh('status')
    expect(simulator.received.some((r) => r.cmd === M3Cmd.SET_BEL_APP_UPDATE)).toBe(false)
    expect(await device.acknowledgeVoiceProfileRefresh()).toEqual({ ok: true, confirmed: true, code: 0 })
    await device.refresh('status')
    expect(device.state.values[M3_INFO.PROFILES_CHANGED]).toBe(false)
    simulator.markVoiceProfilesChanged()
    await device.refresh('status')
    expect(device.state.values[M3_INFO.PROFILES_CHANGED]).toBe(true)
    await device.disconnect()
  })
})

describe('framing and unsolicited events', () => {
  it('replies are report-8 BB DD packets padded to 64; a 512-byte request is read whole', async () => {
    const p = row(PHONE)
    const sim = driver.createSimulator(p) as M3Simulator
    for (const req of [M3Requests.heartbeat(), M3Requests.deviceInfo(6), M3Requests.firmwareVersions(0)]) {
      const [reply] = sim.respond(encodeMomaRequest(MOMA_6303, req))
      expect(reply.length).toBe(64)
      expect(Array.from(reply.subarray(0, 5))).toEqual([0x08, 0xbb, 0xdd, 0x01, 0x06])
      expect(decodeMomaFrame(reply, { reportId: 8 }).status).toBe('ok')
    }
    // Voice-profile template name (catalogued later extra): 65-byte payload → 512-byte packet (m3-6303.md §3.3).
    const name = [1, ...Array.from('My Voice', (c) => c.charCodeAt(0)), ...new Array<number>(56).fill(0)]
    const long = encodeMomaFrame([{ cmd: M3Cmd.SET_BEL_TEMPLATE_NAME, payload: name }], { reportId: 8, target: 0, control: 0, padTo: [64, 512] })
    expect(long.length).toBe(512)
    sim.respond(long.subarray(0, 64))
    sim.respond(long.subarray(64))
    expect(sim.received.at(-1)).toEqual({ cmd: M3Cmd.SET_BEL_TEMPLATE_NAME, payload: name })
  })

  it('Bluetooth events arrive unsolicited and map to M3_INFO values', async () => {
    const { device, simulator } = await setup(PHONE, { profile: '2t2r' })
    const pushes: unknown[] = []
    device.on('push', (m) => pushes.push(m))
    simulator.pushBluetoothEvent('connect')
    simulator.pushBluetoothEvent('volume', 64)
    await sleep(5)
    expect(device.state.values).toMatchObject({ [M3_INFO.EAR_CONNECTED]: true, [M3_INFO.EAR_VOLUME]: 64 })
    simulator.pushBluetoothEvent('disconnect')
    await sleep(5)
    expect(device.state.values[M3_INFO.EAR_CONNECTED]).toBe(false)
    expect(pushes).toHaveLength(3)
    await device.disconnect()
  })
})

describe('safety on an untested M3', () => {
  it('destructive and OTA frames are refused even forced; catalogued writes need force; uncatalogued ids are refused', async () => {
    const { device, simulator } = await setup(PHONE, {}, { allowDestructive: true })
    const frame = (cmd: number, payload: number[] = []) => encodeMomaRequest(MOMA_6303, { items: [{ cmd, payload }] })
    const before = simulator.received.length
    await expect(device.sendRaw(frame(M3Cmd.RESTORE_FACTORY), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.sendRaw(frame(M3Cmd.CLEAR_PAIR_DEVICE, [1]), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.sendRaw(frame(M3Cmd.OTA_TRAN_START, new Array(12).fill(0)), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.sendRaw(frame(M3Cmd.SET_MIC_LED_OFF, [1]))).rejects.toThrow(/without force/)
    await expect(device.sendRaw(frame(0x7777), { force: true })).rejects.toThrow(/not tested on hardware/)
    await expect(device.sendRaw(frame(M3Cmd.SET_WORK_MODE, [1]), { force: true })).resolves.toBeUndefined() // confirm = force
    expect(simulator.received.slice(before).map((r) => r.cmd)).toEqual([M3Cmd.SET_WORK_MODE])
    await device.sendRaw(frame(M3Cmd.GET_HOME_INFO))
    expect(simulator.received.at(-1)!.cmd).toBe(M3Cmd.GET_HOME_INFO)
    await expect(device.set(CONTROL.FACTORY_RESET, true, { confirm: true })).rejects.toBeInstanceOf(UnsupportedError)
    await device.disconnect()
  })
})

describe('hardware check (FAMILIES.md §5.7 row 6303) against the simulator', () => {
  it('runs every step; the descriptor step needs WebHID, the LED step restores the light', async () => {
    const { device, simulator } = await setup(CAMERA)
    const results: Record<string, { ok: boolean; summary: string }> = {}
    for (const step of M3_HARDWARE_CHECK) if (step.run) results[step.id] = await step.run(device)
    expect(Object.keys(results)).toEqual(['descriptor', 'heartbeat', 'device-info', 'versions', 'short-writes', 'led'])
    expect(results.descriptor).toMatchObject({ ok: false, summary: expect.stringMatching(/WebHID/) })
    expect(results.heartbeat).toMatchObject({ ok: true, summary: expect.stringMatching(/^source 2, target 6, type 3; 30 B, 4T4R/) })
    expect(results['device-info'].summary).toMatch(/sn M3RX0000001 fw 2\.0\.1\.2 .*hot shoe sn M3HS0000010/)
    expect(results.versions.summary).toMatch(/^1: 2\.0\.0\.9, 2: 2\.0\.0\.9, 3: 0\.0\.0\.0/)
    expect(results.led).toMatchObject({ ok: true })
    expect(simulator.ledOff).toBe(false)
    expect(M3_HARDWARE_CHECK.filter((s) => s.kind === 'write-reversible').map((s) => s.id)).toEqual(['led'])
    await device.disconnect()
  })
})
