/**
 * MELO P1 session behaviour against MeloSimulator: start-up reads and their order, firmware gates, the VU level
 * stream, read-modify-write setters (byte-exact), safety classes, iOS framing, batch replies, device pushes, the
 * Web Bluetooth path (target 1, writes with response, 20-byte fallback) and the hardware-check steps.
 */
import { describe, expect, it } from 'vitest'
import { controlKey } from '../../../core/controls'
import { ControlUnavailableError } from '../../../core/errors'
import { simulatedTransport } from '../../../core/simulate'
import type { SimOptions } from '../../../core/types'
import { DestructiveCommandError } from '../../../device'
import type { MockTransport } from '../../../mock'
import { MOMA_6201_USB } from '../../../moma/profiles'
import { encodeMomaRequest, momaBatch, momaRequest } from '../../../moma/spec'
import { toHex } from '../../../codec'
import { bleSimulatedTransport } from '../../../transports/fake-bluetooth'
import {
  MELO_CMD, MELO_CONTROL as C, MELO_DRIVER, MELO_HARDWARE_CHECK, MeloSimulator, createMeloDevice, hasMeloLevels, meloCommandOfFrame, meloNotifyStartRequest,
  type MeloDeviceOptions, type MeloLevels,
} from '..'
import { MELO_DRIVER_VECTORS as V } from './vectors'

const P1032 = MELO_DRIVER.products.find((p) => p.productId === 1032)!
const FAST: MeloDeviceOptions = { requestTimeoutMs: 60, probeTimeoutMs: 80, retries: 0, heartbeatIntervalMs: null, interFrameDelayMs: 0 }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const hex = (b: Uint8Array) => toHex(b).toUpperCase()

function setup(sim: SimOptions = {}, o: MeloDeviceOptions = {}) {
  const simulator = new MeloSimulator(P1032, sim)
  const transport = simulatedTransport(simulator)
  const device = createMeloDevice(transport, P1032, { ...FAST, ...o })
  return { simulator, transport, device }
}

/** Command id (and 0x600A device type) of every frame sent. */
function sentLabels(t: MockTransport): string[] {
  return t.sent.map((f) => {
    const cmd = meloCommandOfFrame(f)!
    return cmd === MELO_CMD.DEVICE_INFO ? `600A[${f[12]}]` : cmd.toString(16).toUpperCase()
  })
}

describe('MELO P1 start-up', () => {
  it('probes, reads the master version, the More Settings / mixer GETs, the gain GET the firmware selects, then the online units', async () => {
    const { transport, device } = setup()
    const s = await device.connect()
    expect(s.rx).toBe('available')
    expect(sentLabels(transport)).toEqual([
      '600B', '600A[0]', '1311', '1303', '1143', '1301', '1305', '130B', '1309', '3004', '1155', '131A',
      '600A[5]', '600A[6]', '600A[1]', '600A[3]', '600A[4]',
    ])
    expect(s.units.rx).toMatchObject({ version: '4.0.1.2', serial: 'MP1RX000001', battery: 80 })
    expect(s.units.tx1).toMatchObject({ online: true, version: '1.0.2.6', battery: 70, muted: false })
    expect(s.units.tx2).toMatchObject({ online: true, charging: true })
    expect(s.units.earL).toMatchObject({ online: true, version: '1.1.0.3' })
    expect(s.units.remote).toMatchObject({ online: true, version: '1.0.0.4' })
    expect(s.units.box).toMatchObject({ online: true, battery: 90 })
    expect(device.structure).toBe('v2')
    // Quiet after connect(): nothing else queued.
    const n = transport.sent.length
    await sleep(20)
    expect(transport.sent.length).toBe(n)
    await device.disconnect()
  })

  it('reads Near / Mid / Far below 3.0.7.9, per-mic gain from 3.0.7.9, neither while the version is unknown', async () => {
    for (const [rxVersion, fetchIdentity, want, not] of [
      ['3.0.7.0', true, '1313', '131A'], ['3.0.7.9', true, '131A', '1313'], ['4.0.1.2', false, null, null],
    ] as const) {
      const { transport, device } = setup({ rxVersion }, { fetchIdentity })
      await device.connect()
      const sent = sentLabels(transport)
      if (want) expect(sent, rxVersion).toContain(want)
      if (not) expect(sent, rxVersion).not.toContain(not)
      if (!want) expect(sent.filter((x) => x === '1313' || x === '131A')).toEqual([])
      await device.disconnect()
    }
    const old = setup({ rxVersion: '3.0.7.0' })
    await old.device.connect()
    expect(old.device.state.values[C.MIC_GAIN_PRESET]).toBe(26)
    expect(old.device.state.availability[controlKey(C.MIC_GAIN, 'tx1')]).toMatchObject({ ok: false, reason: 'firmware-too-old' })
    expect(old.device.structure).toBe('v1')
    await old.device.disconnect()
  })

  it('reads the version of a unit that comes online after connect', async () => {
    const { simulator, device } = setup({ online: ['rx', 'tx1'] })
    await device.connect()
    expect(device.state.units.tx2?.online).toBe(false)
    simulator.setOnline('tx2', true)
    await device.refresh('status')
    await device.idle()
    expect(device.state.units.tx2).toMatchObject({ online: true, version: '1.0.2.6' })
    await device.disconnect()
  })

  it('maps the heartbeat: earphones by connect state, case by its battery, remote by its link', async () => {
    const { device } = setup({ online: ['rx', 'tx1', 'earR'] })
    await device.connect()
    const u = device.state.units
    expect(u.earL?.online).toBe(false)
    expect(u.earR).toMatchObject({ online: true, battery: 62 })
    expect(u.box).toMatchObject({ online: false, battery: undefined })
    expect(u.remote?.online).toBe(false)
    expect(device.state.values).toMatchObject({ [C.MIC_BIT_DEPTH]: 0, [C.OUTPUT_BIT_DEPTH]: 1 })
    await device.disconnect()
  })
})

describe('MELO P1 VU level stream', () => {
  it('0x11E0 + 0x6048 start the push; levels go to onLevels, never to MicState.values; 0x6049 stops it', async () => {
    const { simulator, transport, device } = setup()
    await device.connect()
    expect(hasMeloLevels(device)).toBe(true)
    const got: MeloLevels[] = []
    const off = device.onLevels((l) => got.push(l))
    const values = { ...device.state.values }
    const from = transport.sent.length
    await device.startLevels({ intervalMs: 10 })
    expect(transport.sent.slice(from).map(hex)).toEqual([V.vuSourceUsb.hex, hex(encodeMomaRequest(MOMA_6201_USB, meloNotifyStartRequest([MELO_CMD.VU_ALL_GET], 10)))])
    expect(simulator.subscription).toEqual({ cmds: [MELO_CMD.VU_ALL_GET], intervalMs: 10 })
    expect(device.levelsActive).toBe(true)
    await sleep(80)
    expect(got.length).toBeGreaterThan(2)
    expect(got[0].inputs!.mic1).toBeGreaterThan(-60)
    expect(got[0].outputs!.usb2L).toBe(-96)
    expect(device.levels).toBe(got.at(-1))
    expect(device.state.values).toEqual(values)
    await device.stopLevels()
    expect(simulator.subscription).toBeNull()
    expect(device.levelsActive).toBe(false)
    const n = got.length
    await sleep(40)
    expect(got.length).toBe(n)
    off()
    await device.disconnect()
  })

  it('a reconnect sends the subscription again; disconnect stops the simulator timer', async () => {
    const { simulator, device } = setup()
    await device.connect()
    await device.startLevels({ intervalMs: 15 })
    await device.disconnect()
    expect(simulator.subscription).toBeNull()
    expect(device.levelsActive).toBe(false)
    await device.connect()
    expect(simulator.subscription).toEqual({ cmds: [MELO_CMD.VU_ALL_GET], intervalMs: 15 })
    expect(device.levelsActive).toBe(true)
    await device.stopLevels()
    await device.disconnect()
  })

  it('startLevels needs a connection', async () => {
    const { device } = setup()
    await expect(device.startLevels()).rejects.toThrow(/not connected/)
  })
})

describe('MELO P1 writes', () => {
  it('track faders, gains, noise gate and work mode are byte-exact read-modify-writes', async () => {
    const { simulator, transport, device } = setup({ rxVersion: '4.0.0.0' })
    await device.connect()
    await device.set(C.MIC_VOLUME, 5, { unit: 'tx2' })
    expect(hex(transport.sent.at(-1)!)).toBe(V.streamInMic2.hex)
    expect(simulator.streamIn.vol).toEqual([12, 5, 12, 8, 6])
    expect(device.state.values[controlKey(C.MIC_VOLUME, 'tx2')]).toBe(5)
    // Regression: the next write starts from the acknowledged struct, not the one read at connect (which would
    // put mic 2 back to 10 until the read-back arrived).
    await device.set(C.MIC_MUTE, true, { unit: 'tx1' })
    await device.set(C.MIC_VOLUME, 7, { unit: 'tx1' })
    expect(simulator.streamIn.vol).toEqual([7, 5, 12, 8, 6])
    expect(simulator.streamIn.mute).toEqual([1, 0, 0, 0, 0])
    await device.set(C.NC_ENABLED, false)
    await device.set(C.NC_ENABLED, true)
    expect([simulator.ncOn, simulator.ncLevel]).toEqual([true, 15])
    expect(device.state.units.tx1?.muted).toBe(false) // muted follows the next 0x130B read
    await device.refresh('settings')
    expect(device.state.units.tx1?.muted).toBe(true)

    await device.set(C.MIC_GAIN, 30, { unit: 'tx1' })
    expect(hex(transport.sent.at(-1)!)).toBe(V.txGain.hex)
    expect(simulator.txGains).toEqual([30, 23])

    await device.set(C.NOISE_GATE_ENABLED, true)
    await device.set(C.NOISE_GATE_THRESHOLD, -60)
    expect(hex(transport.sent.at(-1)!)).toBe(V.noiseGateOn60.hex)
    await device.set(C.WORK_MODE, 2)
    expect(hex(transport.sent.at(-1)!)).toBe(V.workMode2.hex)

    await device.set(C.USB_OUT_VOLUME, 31)
    expect(simulator.streamOut).toMatchObject({ uacUpstreamVol: 31, owsVol: 20, conn35OutVol: 20 })
    await device.set(C.LED_BRIGHTNESS, 0, { unit: 'tx1' })
    expect(simulator.leds[1]).toEqual({ on: true, device: 1, brightness: 0 })
    await device.disconnect()
  })

  it('noise gate threshold needs the gate on (A setNoiseGateEvent$lambda$37: R toast_noise_gate_switch_close)', async () => {
    const { simulator, transport, device } = setup({ rxVersion: '4.0.0.0' })
    await device.connect()
    expect(simulator.noiseGate.enable).toBe(false)
    expect(device.state.availability[C.NOISE_GATE_THRESHOLD]).toMatchObject({ ok: false, reason: 'noise-gate-off' })
    const n = transport.sent.length
    await expect(device.set(C.NOISE_GATE_THRESHOLD, -60)).rejects.toMatchObject({ reason: 'noise-gate-off' })
    expect(transport.sent.length).toBe(n)
    await device.set(C.NOISE_GATE_ENABLED, true)
    await device.refresh('settings')
    expect(device.state.availability[C.NOISE_GATE_THRESHOLD]).toEqual({ ok: true })
    await device.disconnect()
  })

  it('LED brightness needs that LED on (A HISeekbarItemView) and keeps the switch as it is (I sendLEDWithType:isOpen:value:)', async () => {
    const { simulator, device } = setup()
    await device.connect()
    expect(simulator.leds[2].on).toBe(false)
    expect(device.state.availability[controlKey(C.LED_BRIGHTNESS, 'tx2')]).toMatchObject({ ok: false, reason: 'led-off' })
    expect(device.state.availability[controlKey(C.LED_BRIGHTNESS, 'tx1')]).toEqual({ ok: true })
    await expect(device.set(C.LED_BRIGHTNESS, 0, { unit: 'tx2' })).rejects.toMatchObject({ reason: 'led-off' })
    await device.disconnect()

    // Preconditions off: the change goes out with the switch still off (iOS), not switch = true.
    const loose = setup({}, { enforcePreconditions: false })
    await loose.device.connect()
    await loose.device.set(C.LED_BRIGHTNESS, 0, { unit: 'tx2' })
    expect(hex(loose.transport.sent.at(-1)!)).toBe(hex(encodeMomaRequest(MOMA_6201_USB, momaRequest(MELO_CMD.LED_SET, [0, 2, 0]))))
    expect(loose.simulator.leds[2]).toEqual({ on: false, device: 2, brightness: 0 })
    await loose.device.disconnect()
  })

  it('every frame of a session fits one 64-byte HID report both ways (the USB link needs no multi-report frames)', async () => {
    const { simulator, transport, device } = setup({ rxVersion: '4.0.0.0' })
    const fromDevice: number[] = [] // replies and pushes
    transport.onPacket((p) => fromDevice.push(p.length))
    await device.connect()
    await device.startLevels({ intervalMs: 5 })
    await device.set(C.NOISE_GATE_ENABLED, true)
    await device.set(C.NOISE_GATE_THRESHOLD, -60)
    await device.set(C.BGM_VOLUME, 2)
    await device.set(C.LED, false, { unit: 'tx1' })
    await sleep(20)
    await device.stopLevels()
    expect(simulator.pushes).toBeGreaterThan(0)
    expect(Math.max(...transport.sent.map((f) => f.length))).toBeLessThanOrEqual(64)
    expect(Math.max(...fromDevice)).toBeLessThanOrEqual(64)
    await device.disconnect()
  })

  it('forgets the structs on disconnect: no read-modify-write from an earlier session', async () => {
    const { device } = setup()
    await device.connect()
    await device.set(C.BGM_VOLUME, 1)
    expect(device.session.streamIn?.vol[3]).toBe(1)
    await device.disconnect()
    expect(device.session.streamIn).toBeNull()
    expect(device.session.leds.size).toBe(0)
  })

  it('refuses a read-modify-write before its struct was read, and sends nothing', async () => {
    const { transport, device } = setup({}, { fetchSettings: false })
    await device.connect()
    const n = transport.sent.length
    const err = await device.set(C.BGM_VOLUME, 3).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ControlUnavailableError)
    expect((err as ControlUnavailableError).reason).toBe('state-unknown')
    await expect(device.set(C.LED, false, { unit: 'rx' })).rejects.toBeInstanceOf(ControlUnavailableError)
    expect(transport.sent.length).toBe(n)
    await device.disconnect()
  })

  it('restart-causing settings need a confirm; bit depth follows the heartbeat; mic bit depth needs a mic online', async () => {
    const { simulator, transport, device } = setup()
    await device.connect()
    await expect(device.set(C.AUTO_SPEAKER, true)).rejects.toBeInstanceOf(DestructiveCommandError)
    await device.set(C.AUTO_SPEAKER, true, { confirm: true })
    expect(hex(transport.sent.at(-1)!)).toBe(V.autoSpeakerOn.hex)
    await device.set(C.MIC_BIT_DEPTH, 1, { confirm: true })
    expect(hex(transport.sent.at(-1)!)).toBe(V.bitDepthMic32.hex)
    expect(simulator.restarts).toBe(2)
    await device.disconnect()

    // A setSampleDepthEvent: only the mic buttons check for an online mic; the sound-card (output) buttons do not.
    const lone = setup({ online: ['rx'] })
    await lone.device.connect()
    const err = await lone.device.set(C.MIC_BIT_DEPTH, 1, { confirm: true }).catch((e: unknown) => e)
    expect((err as ControlUnavailableError).reason).toBe('no-mic-online')
    expect(lone.device.state.availability[C.OUTPUT_BIT_DEPTH]).toEqual({ ok: true })
    expect(await lone.device.set(C.OUTPUT_BIT_DEPTH, 0, { confirm: true })).toMatchObject({ ok: true, confirmed: true })
    expect(lone.simulator.bitDepths).toEqual({ tx1: 0, tx2: 0, rxMaster: 0, rxSlave: 0 })
    await lone.device.disconnect()
  })

  it('0x1304 rxSlave: an output change copies the depth (iOS), a mic change keeps the 0x1305 value read at start-up', async () => {
    const { simulator, transport, device } = setup()
    simulator.bitDepths = { tx1: 0, tx2: 0, rxMaster: 1, rxSlave: 1 }
    await device.connect()
    expect(device.session.bitDepths).toEqual({ tx1: 0, tx2: 0, rxMaster: 1, rxSlave: 1 })
    await device.set(C.MIC_BIT_DEPTH, 1, { confirm: true })
    expect(hex(transport.sent.at(-1)!)).toBe(hex(encodeMomaRequest(MOMA_6201_USB, momaRequest(MELO_CMD.BIT_DEPTH_SET, [1, 1, 1, 1]))))
    await device.set(C.OUTPUT_BIT_DEPTH, 0, { confirm: true })
    expect(simulator.bitDepths).toEqual({ tx1: 1, tx2: 1, rxMaster: 0, rxSlave: 0 })
    await device.disconnect()

    // No 0x1305 read (fetchSettings off): the output depth stands in for the slave byte.
    const bare = setup({}, { fetchSettings: false })
    bare.simulator.bitDepths = { tx1: 0, tx2: 0, rxMaster: 1, rxSlave: 0 }
    await bare.device.connect()
    await bare.device.refresh('status')
    await bare.device.set(C.MIC_BIT_DEPTH, 1, { confirm: true })
    expect(bare.simulator.bitDepths).toEqual({ tx1: 1, tx2: 1, rxMaster: 1, rxSlave: 1 })
    await bare.device.disconnect()
  })

  it('never sends destructive or OTA commands to the untested receiver, even forced', async () => {
    const { simulator, device } = setup({}, { allowDestructive: true })
    await device.connect()
    expect(device.support.hardware).toBe('untested')
    expect(device.controls.some((c) => c.safety === 'destructive' || c.safety === 'ota')).toBe(false)
    const n = simulator.requests.length
    for (const cmd of [MELO_CMD.FACTORY_RESET, MELO_CMD.TX_CLEAR_PAIR, MELO_CMD.SN_SET, 0x4000, 0x4003]) {
      const frame = encodeMomaRequest(MOMA_6201_USB, momaRequest(cmd, [0]))
      await expect(device.sendRaw(frame, { force: true }), cmd.toString(16)).rejects.toBeInstanceOf(DestructiveCommandError)
    }
    // A batch cannot hide one behind a read.
    await expect(device.sendRaw(encodeMomaRequest(MOMA_6201_USB, momaBatch([MELO_CMD.HEARTBEAT, MELO_CMD.FACTORY_RESET])), { force: true })).rejects.toThrow()
    expect(simulator.requests.length).toBe(n)
    await device.disconnect()
  })
})

describe('MELO P1 framing variants', () => {
  it('iOS framing (control 0x00, target 1, no XOR) gets replies without XOR, and both decode', async () => {
    const { simulator, transport, device } = setup({}, { framing: 'ios' })
    await device.connect()
    expect(transport.sent[0]).toEqual(Uint8Array.of(0xaa, 0xdd, 0x06, 0x01, 0x00, 0x00, 0x01, 0x60, 0x0b, 0x01, 0x00, 0x00))
    expect(simulator.requests.every((f) => f.control === 0 && f.target === 1)).toBe(true)
    expect(device.state.units.rx.version).toBe('4.0.1.2')
    expect(device.state.values[C.NC_DEPTH]).toBe(15)
    await device.disconnect()

    // Replies with the other checksum setting than the request decode the same.
    for (const [framing, replyControl] of [['ios', 0x04], ['android', 0x00]] as const) {
      const x = setup({ params: { replyControl } }, { framing })
      await x.device.connect()
      expect(x.device.state.units.rx.version, `${framing} / reply control ${replyControl}`).toBe('4.0.1.2')
      expect(x.device.state.values[C.WORK_MODE]).toBe(1)
      await x.device.disconnect()
    }
  })

  it('a batch of reads is answered in one frame or one frame per item, and both complete', async () => {
    for (const splitBatch of [false, true]) {
      const { simulator, transport, device } = setup({ params: { splitBatch } })
      await device.connect()
      simulator.ncOn = false
      simulator.workMode = 0
      const frame = encodeMomaRequest(MOMA_6201_USB, momaBatch([MELO_CMD.NC_GET, MELO_CMD.WORK_MODE_GET]))
      await device.sendRaw(frame) // catalogued reads: no force needed
      await device.idle()
      expect(hex(transport.sent.at(-1)!)).toBe(hex(frame))
      expect(device.state.values[C.NC_ENABLED], `splitBatch ${splitBatch}`).toBe(false)
      expect(device.state.values[C.WORK_MODE]).toBe(0)
      expect(device.state.availability[C.NC_DEPTH]).toMatchObject({ ok: false, reason: 'noise-off' })
      await device.disconnect()
    }
  })

  it('applies a GET reply the device pushes on its own (output volume changed on the receiver)', async () => {
    const { simulator, device } = setup()
    await device.connect()
    const pushes: unknown[] = []
    device.on('push', (m) => pushes.push(m))
    simulator.streamOut.uacUpstreamVol = 33
    simulator.pushGetReply(MELO_CMD.STREAM_OUT_GET)
    await sleep(5)
    expect(device.state.values[C.USB_OUT_VOLUME]).toBe(33)
    expect(pushes).toHaveLength(1)
    await device.disconnect()
  })
})

describe('MELO P1 over Web Bluetooth (fake GATT, MTU 23)', () => {
  it('uses target 1, writes FFE1 with response, reassembles 20-byte notifications', async () => {
    const sim = new MeloSimulator(P1032)
    const ble = bleSimulatedTransport(sim, P1032, { mtu: 23 })
    const device = createMeloDevice(ble.transport, P1032, FAST)
    expect(device.link).toBe('ble')
    await device.connect()
    expect(device.state.units.rx.version).toBe('4.0.1.2')
    expect(sim.requests.every((f) => f.target === 1 && f.control === 0x04)).toBe(true)
    const writes = ble.device.characteristic(0xffe0, 0xffe1).writes
    expect(writes.every((w) => w.mode === 'with-response')).toBe(true)
    expect(ble.transport.diagnostics().notificationBytes?.max).toBeLessThanOrEqual(20)
    await device.disconnect()
  })

  it('falls back to 20-byte writes when the peripheral rejects a long write, and the receiver joins them', async () => {
    const sim = new MeloSimulator(P1032)
    const ble = bleSimulatedTransport(sim, P1032, { mtu: 23 })
    ble.device.longWrites = false
    const device = createMeloDevice(ble.transport, P1032, FAST)
    await device.connect() // 0x600B is 13 bytes: fits one ATT write
    const r = await device.set(C.MIC_VOLUME, 4, { unit: 'tx1' }) // 28-byte frame
    expect(r).toMatchObject({ ok: true, confirmed: true })
    expect(sim.streamIn.vol[0]).toBe(4)
    expect(ble.transport.writeChunkSize).toBe(20)
    expect(ble.transport.diagnostics().fellBackToMinChunk).toBe(true)
    await device.disconnect()
  })
})

describe('MELO P1 hardware check against the simulator', () => {
  it('read steps and the LED step run and restore the LED', async () => {
    const { simulator, device } = setup()
    await device.connect()
    for (const id of ['device-info', 'heartbeat', 'led']) {
      const step = MELO_HARDWARE_CHECK.find((s) => s.id === id)!
      const r = await step.run!(device)
      expect(r.ok, `${id}: ${r.summary}`).toBe(true)
    }
    expect(simulator.leds[0]).toEqual({ on: true, device: 0, brightness: 2 })
    const ble = MELO_HARDWARE_CHECK.find((s) => s.id === 'ble-advertising')!
    expect((await ble.run!(device)).ok).toBe(false) // not a BLE transport here
    await device.disconnect()
  })
})
