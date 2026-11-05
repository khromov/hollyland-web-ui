/**
 * LegacyMicDevice: HollylandDevice behind MicDevice (state mapping, set mapping, availability,
 * events, safety on top of HollylandDevice's own rules).
 */
import { describe, expect, it } from 'vitest'
import { encodeOtaDataPacket, encodeRequest, Target } from '../../../codec'
import { Cmd, Requests } from '../../../commands'
import { DestructiveCommandError, HollylandDevice, PreconditionError, type HollylandDeviceOptions } from '../../../device'
import { MockTransport, SimulatedReceiver, type SimulatorOptions } from '../../../mock'
import { lookupProduct, type ProductInfo } from '../../../models'
import { CONTROL } from '../../../core/controls'
import { ControlUnavailableError } from '../../../core/errors'
import type { MicTrafficEntry } from '../../../core/types'
import { LEGACY_DRIVERS, LegacyMicDevice, legacyCatalogue, legacyControls } from '..'

const FAST: HollylandDeviceOptions = {
  requestTimeoutMs: 30, probeTimeoutMs: 40, interFrameDelayMs: 0, heartbeatIntervalMs: null, retries: 0, identityRetryDelayMs: 5,
  fetchIdentity: false, fetchSettings: false,
}

function setup(pid = 1041, sim: SimulatorOptions = {}, opts: HollylandDeviceOptions = {}) {
  const product = lookupProduct(pid === 32 || pid === 33 ? 0x4417 : 0x3547, pid)!
  const receiver = new SimulatedReceiver({ family: product.family!, camera: product.variant === 'camera', ...sim })
  const transport = new MockTransport({ info: { vendorId: product.vendorId, productId: pid }, respond: receiver.respond })
  const mic = new LegacyMicDevice(transport, { ...FAST, ...opts })
  return { receiver, transport, mic, product }
}

const sentCmds = (t: MockTransport) => t.sent.map((p) => p[2])

describe('LegacyMicDevice: state', () => {
  it('maps DeviceState to MicState (units, canonical values, raw heartbeat)', async () => {
    const { mic } = setup()
    expect(mic.family).toBe('6118')
    expect(mic.support).toMatchObject({ level: 'supported', hardware: 'tested' })
    const s = await mic.connect()
    expect(s.rx).toBe('available')
    expect(s.family).toBe('6118')
    expect(s.units.tx1).toEqual({ id: 'tx1', online: true, battery: 85, charging: false, muted: false })
    expect(s.units.tx2).toMatchObject({ id: 'tx2', charging: true })
    expect(s.values).toEqual({
      [CONTROL.NOISE_ENABLED]: true, [CONTROL.NOISE_LEVEL]: 2, [CONTROL.VOLUME]: 3, [CONTROL.CHANNEL_MODE]: 1, [CONTROL.AUTO_OFF]: true,
      [CONTROL.LED]: true, [CONTROL.PRESET_ENABLED]: false, [CONTROL.PRESET_STYLE]: 0,
    })
    expect((s.raw as { family: string }).family).toBe('6118')
    expect(s.lastStatusAt).not.toBeNull()
    // the same object while the wrapped state does not change
    expect(mic.state).toBe(mic.state)
    await mic.disconnect()
  })

  it('a NC level is only a value while NC is on (the RX keeps the level, PROTOCOL.md §11.7)', async () => {
    const { mic, receiver } = setup(1041)
    await mic.connect()
    receiver.noiseEnabled = false
    await mic.refresh('status')
    expect(mic.state.values[CONTROL.NOISE_ENABLED]).toBe(false)
    expect(mic.state.values[CONTROL.NOISE_LEVEL]).toBeUndefined()
    expect(mic.state.availability[CONTROL.NOISE_LEVEL]).toMatchObject({ ok: false, reason: 'noise-off' })
    await mic.disconnect()
  })

  it('reports firmware gates and the apps preconditions as availability', async () => {
    const m2s = setup(1029, {}, { fetchIdentity: false })
    await m2s.mic.connect()
    // LED and custom buttons need RX firmware > 2.0.0.9; the version is not known yet.
    expect(m2s.mic.state.availability[CONTROL.LED]).toMatchObject({ ok: false, reason: 'version-unknown' })
    await expect(m2s.mic.set(CONTROL.LED, false)).rejects.toBeInstanceOf(ControlUnavailableError)
    await m2s.mic.refresh('identity')
    expect(m2s.mic.state.units.rx.version).toBe('2.0.0.32')
    expect(m2s.mic.state.availability[CONTROL.LED]).toBeUndefined()
    await m2s.mic.disconnect()

    const nomic = setup(1041)
    nomic.receiver.tx[0].online = false
    nomic.receiver.tx[1].online = false
    await nomic.mic.connect()
    expect(nomic.mic.state.availability[CONTROL.VOLUME]).toMatchObject({ ok: false, reason: 'mic-disconnected' })
    await expect(nomic.mic.set(CONTROL.VOLUME, 1)).rejects.toBeInstanceOf(PreconditionError)
    await nomic.mic.disconnect()
  })

  it('re-emits events under the MicDevice names', async () => {
    const { mic, receiver } = setup()
    const seen: string[] = []
    mic.on('status', () => seen.push('status'))
    mic.on('unit-offline', (u) => seen.push(`offline:${u}`))
    mic.on('state', (s) => expect(s.family).toBe('6118'))
    const traffic: MicTrafficEntry[] = []
    mic.on('traffic', (e) => traffic.push(e))
    await mic.connect()
    receiver.tx[1].online = false
    await mic.refresh('status')
    expect(seen).toEqual(['status', 'status', 'offline:tx2'])
    const tx = traffic.find((e) => e.direction === 'tx')
    expect(tx?.frame?.cmd).toBe(Cmd.HEARTBEAT)
    expect(traffic.some((e) => e.direction === 'rx' && e.note === 'reply')).toBe(true)
    await mic.disconnect()
  })
})

describe('LegacyMicDevice: set()', () => {
  it('maps canonical controls to the typed setters (same bytes as HollylandDevice)', async () => {
    const { mic, transport, receiver } = setup(1041, {}, { fetchSettings: false })
    await mic.connect()
    expect(await mic.set(CONTROL.VOLUME, 5)).toEqual({ ok: true, confirmed: true, code: 1 })
    expect([...transport.sent.at(-1)!.subarray(0, 7)]).toEqual([...encodeRequest(Requests.volumeSet(5)).subarray(0, 7)])
    await mic.set(CONTROL.NOISE_LEVEL, 3)
    await mic.set(CONTROL.CHANNEL_MODE, 2)
    await mic.set(CONTROL.PRESET_STYLE, 2) // keeps the current on/off (off in the simulator)
    expect(receiver.preset).toEqual({ enabled: false, preset: 2 })
    await mic.set(CONTROL.PRESET_ENABLED, true) // keeps the current style
    await mic.set(CONTROL.LED, false)
    await mic.set(CONTROL.AUTO_OFF, false)
    expect(receiver).toMatchObject({ volume: 5, noiseLevel: 3, channelMode: 2, preset: { enabled: true, preset: 2 }, ledOn: false, autoPowerOff: false })
    await mic.set(CONTROL.NOISE_ENABLED, false)
    expect(receiver.noiseEnabled).toBe(false)
    expect(sentCmds(transport)).toContain(Cmd.NOISE_TOGGLE)
    await mic.disconnect()
  })

  it('validates values against the ControlSpec before anything is sent', async () => {
    const { mic, transport } = setup(1042) // A2S camera: 3 volume steps
    await mic.connect()
    const n = transport.sent.length
    await expect(mic.set(CONTROL.VOLUME, 3)).rejects.toThrow(/outside 0..2/)
    await expect(mic.set(CONTROL.SMART_BATTERY, true)).rejects.toThrow(/not a control/) // 1041 only
    expect(transport.sent.length).toBe(n)
    await mic.disconnect()
  })

  it('destructive actions keep HollylandDevice rules (allowDestructive + confirm) on the tested A2', async () => {
    const off = setup(1041)
    await off.mic.connect()
    await expect(off.mic.set(CONTROL.FACTORY_RESET, true, { confirm: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await off.mic.disconnect()
    const on = setup(1041, {}, { allowDestructive: true })
    await on.mic.connect()
    expect(await on.mic.set(CONTROL.REMOVE_PAIRING, true, { unit: 'tx2', confirm: true })).toMatchObject({ ok: true })
    expect([...on.transport.sent.at(-1)!.subarray(0, 7)]).toEqual([0xaa, 0xdd, Cmd.REMOVE_PAIRING, 0x40, 0, 1, 2])
    await on.mic.disconnect()
  })

  it('an untested product never gets destructive commands, even with allowDestructive (FAMILIES.md §2.3)', async () => {
    const a2: ProductInfo = lookupProduct(0x3547, 1041)!
    const untested: ProductInfo = { ...a2, support: { ...a2.support!, hardware: 'untested' } }
    const receiver = new SimulatedReceiver({ family: '6118' })
    const transport = new MockTransport({ info: { vendorId: 0x3547, productId: 1041 }, respond: receiver.respond })
    const mic = new LegacyMicDevice(transport, { ...FAST, product: untested, allowDestructive: true })
    expect(mic.controls.map((c) => c.id)).not.toContain(CONTROL.FACTORY_RESET)
    expect(mic.controls.map((c) => c.id)).toContain(CONTROL.RESTART_RX) // disruptive, not destructive
    await mic.connect()
    await expect(mic.set(CONTROL.FACTORY_RESET, true, { confirm: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(mic.sendRaw(encodeRequest(Requests.factoryReset()), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(mic.sendRaw(Uint8Array.of(1, 2, 3), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    expect(sentCmds(transport)).not.toContain(Cmd.FACTORY_RESET)
    await mic.disconnect()
  })

  it('sendRaw refuses OTA frames even when forced; reads pass', async () => {
    const { mic, transport } = setup(1041)
    await mic.connect()
    await expect(mic.sendRaw(encodeRequest(Requests.otaRxEnter()), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await mic.sendRaw(encodeRequest(Requests.serial(Target.TX1)))
    expect(sentCmds(transport).at(-1)).toBe(Cmd.SERIAL_GET)
    await mic.disconnect()
  })

  it('sendRaw refuses the raw OTA data packet and notify ids on every product, forced or not (tested A2)', async () => {
    const { mic, transport } = setup(1041)
    await mic.connect()
    const before = transport.sent.length
    // `55` + 63 firmware bytes (codec.ts encodeOtaDataPacket): not an AA DD frame, so decodeFrame returns null.
    await expect(mic.sendRaw(encodeOtaDataPacket(new Uint8Array(100).fill(7), 0), { force: true })).rejects.toThrow(/firmware data packet/)
    await expect(mic.sendRaw(encodeRequest({ cmd: Cmd.OTA_PACKET_ACK, target: Target.RX, payload: [1] }), { force: true }))
      .rejects.toThrow(/sent by the device only/)
    expect(transport.sent.length).toBe(before)
    // Tested product: a forced uncatalogued id still goes out (hardware exploration on the A2); the simulator does not answer it.
    await expect(mic.sendRaw(encodeRequest({ cmd: 0x2a, target: Target.RX, payload: [] }), { force: true })).rejects.toThrow(/no reply/)
    expect(sentCmds(transport).at(-1)).toBe(0x2a)
    await mic.disconnect()
  })

  it('sendRaw on an untested product: forced frames must be catalogued requests of its family (Lark M1 2nd gen)', async () => {
    const { mic, transport } = setup(12)
    expect(mic.support.hardware).toBe('untested')
    await mic.connect()
    const before = transport.sent.length
    // uncatalogued id
    await expect(mic.sendRaw(encodeRequest({ cmd: 0x2a, target: Target.RX, payload: [] }), { force: true })).rejects.toThrow(/not catalogued/)
    // 0x19 NC toggle: catalogued, but not a 6501 command (commands.ts WITH_6501)
    await expect(mic.sendRaw(encodeRequest(Requests.noiseToggle()), { force: true })).rejects.toThrow(/not a 6501 command/)
    expect(transport.sent.length).toBe(before)
    // a 6501 write still goes out when forced
    await mic.sendRaw(encodeRequest(Requests.volumeSet(2)), { force: true })
    expect(sentCmds(transport).at(-1)).toBe(Cmd.VOLUME_SET)
    await mic.disconnect()
  })
})

describe('legacy drivers', () => {
  it('wrap() reuses an existing HollylandDevice; dispose() detaches', async () => {
    const receiver = new SimulatedReceiver()
    const d = new HollylandDevice(new MockTransport({ respond: receiver.respond }), FAST)
    const mic = LegacyMicDevice.wrap(d)
    expect(mic.legacy).toBe(d)
    let states = 0
    mic.on('state', () => states++)
    await d.connect()
    expect(states).toBeGreaterThan(0)
    mic.dispose()
    const n = states
    await d.refreshStatus()
    expect(states).toBe(n)
    await d.disconnect()
  })

  it('catalogues and controls per family', () => {
    expect(legacyCatalogue('6118')[Cmd.VERSION_GET]).toMatchObject({ name: 'VERSION_GET', safety: 'read' })
    expect(legacyCatalogue('6302')[Cmd.VERSION_GET]).toBeUndefined()
    expect(legacyCatalogue('6118')[Cmd.NOISE_TOGGLE]).toMatchObject({ toggle: true })
    // 6501 (Phase 1, W1): details in 6501.test.ts
    expect(legacyCatalogue('6501')[Cmd.HEARTBEAT]).toMatchObject({ safety: 'read' })
    expect(legacyCatalogue('6501')[Cmd.NOISE_TOGGLE]).toBeUndefined()
    expect(legacyControls(lookupProduct(0x3547, 1030)!).map((c) => c.id)).toContain(CONTROL.VOLUME_LOCK)
    expect(legacyControls(lookupProduct(0x3547, 1029)!).map((c) => c.id)).not.toContain(CONTROL.VOLUME_LOCK)
    expect(legacyControls(lookupProduct(0x3547, 2)!)).toEqual([]) // Lark MAX: recognised only
    expect(LEGACY_DRIVERS['6501'].status).toBe('experimental')
    expect(LEGACY_DRIVERS['6118'].commandOfFrame(encodeRequest(Requests.heartbeat()))).toBe(Cmd.HEARTBEAT)
  })
})
