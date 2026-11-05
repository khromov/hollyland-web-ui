import { describe, expect, it } from 'vitest'
import { decodeFrame, Target, toHex } from '../codec'
import { Cmd, CommandError } from '../commands'
import {
  DestructiveCommandError, DisconnectedError, HollylandDevice, PreconditionError, RxUnavailableError, TimeoutError, UnsupportedError,
  type HollylandDeviceOptions, type TrafficEntry,
} from '../device'
import { encodeResponse, MockTransport, SimulatedReceiver, type SimulatorOptions } from '../mock'
import { lookupProduct } from '../models'

const FAST: HollylandDeviceOptions = {
  requestTimeoutMs: 30, probeTimeoutMs: 40, interFrameDelayMs: 0, heartbeatIntervalMs: null, retries: 1, identityRetryDelayMs: 5,
}

function setup(sim: SimulatorOptions = {}, opts: HollylandDeviceOptions = {}, pid = 1041) {
  const receiver = new SimulatedReceiver(sim)
  const transport = new MockTransport({ info: { vendorId: 0x3547, productId: pid }, respond: receiver.respond })
  const device = new HollylandDevice(transport, { ...FAST, ...opts })
  return { receiver, transport, device }
}

const sentCmds = (t: MockTransport) => t.sent.map((p) => p[2])
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('HollylandDevice: connect / reads', () => {
  it('probes with a heartbeat, then fetches identity and GET-only settings', async () => {
    const { device, transport } = setup()
    const s = await device.connect()
    expect(s.rx).toBe('available')
    expect(toHex(transport.sent[0].subarray(0, 6))).toBe('aa dd 10 40 00 00')
    await settle(60)
    const st = device.state
    expect(st.units.tx1).toMatchObject({ online: true, battery: 85, charging: false })
    expect(st.units.tx2).toMatchObject({ online: true, battery: 60, charging: true })
    expect(st.units.rx.version).toBe('1.0.0.015')
    expect(st.units.rx.serial).toBe('SIMRX0000001')
    expect(st.units.tx1.version).toBe('1.0.0.012')
    expect(st.units.tx2.serial).toBe('SIMTX2000002')
    expect(st.settings).toMatchObject({
      noiseLevel: 2, noiseEnabled: true, volume: 3, channelMode: 1, ledOn: true, autoPowerOff: true,
      micRecognition: false, smartBattery: true, speakerPassthrough: false,
    })
    // TX-targeted reads go to 0x41 / 0x42
    const versionTargets = transport.sent.filter((p) => p[2] === Cmd.VERSION_GET).map((p) => p[3])
    expect(versionTargets).toEqual(expect.arrayContaining([0x40, 0x41, 0x42]))
    await device.disconnect()
  })

  it('typed getters decode the replies', async () => {
    const { device, receiver } = setup({}, { fetchIdentity: false, fetchSettings: false })
    await device.connect()
    receiver.noiseEnabled = false
    expect(await device.getNoiseLevel()).toEqual({ enabled: false, level: 0 })
    expect(await device.getFirmwareVersion(Target.TX2)).toBe('1.0.0.012')
    expect(await device.getSerialNumber(Target.TX1)).toBe('SIMTX1000001')
    expect(await device.getDeviceInfo()).toMatchObject({ cameraRx: false })
    expect(await device.getVolume()).toBe(3)
    expect(await device.getBattery()).toEqual({ tx1: 85, tx2: 60, rx: null })
    await device.disconnect()
  })

  it('reports camera-RX battery on the A2S', async () => {
    const { device } = setup({ camera: true }, { fetchIdentity: false, fetchSettings: false }, 1042)
    await device.connect()
    expect(device.product.name).toBe('LARK A2S')
    expect((await device.getBattery()).rx).toBe(77)
    await device.disconnect()
  })

  it('M2S uses 0x03 for versions and decodes its heartbeat', async () => {
    const { device, transport } = setup({ family: '6302' }, { fetchSettings: false }, 1029)
    await device.connect()
    await settle(60)
    expect(device.state.units.rx.version).toBe('2.0.0.32')
    expect(sentCmds(transport)).toContain(Cmd.VERSION_LEGACY_GET)
    expect(sentCmds(transport)).not.toContain(Cmd.VERSION_GET)
    expect(device.state.settings.buttons).toEqual([{ func: 2, keyOp: 1 }, { func: 3, keyOp: 1 }])
    await expect(device.setVoicePreset(true, 1)).rejects.toThrow(UnsupportedError)
    await device.disconnect()
  })

  it('refuses unsupported products', async () => {
    const t = new MockTransport({ info: { vendorId: 0x3547, productId: 1038 } })
    await expect(new HollylandDevice(t, FAST).connect()).rejects.toThrow(UnsupportedError)
  })
})

describe('HollylandDevice: queue / correlation', () => {
  it('serializes requests: never two in flight', async () => {
    let inflight = 0
    let maxInflight = 0
    const receiver = new SimulatedReceiver()
    const transport = new MockTransport({
      respond: (p) => {
        inflight++
        maxInflight = Math.max(maxInflight, inflight)
        const r = receiver.respond(p)
        setTimeout(() => {
          inflight--
          for (const x of r) transport.inject(x)
        }, 3)
      },
    })
    const device = new HollylandDevice(transport, { ...FAST, requestTimeoutMs: 50, fetchIdentity: false, fetchSettings: false })
    await device.connect()
    const results = await Promise.all([device.getVolume(), device.getSpeakerPassthrough(), device.getMicRecognition(), device.getSmartBattery()])
    expect(results).toEqual([3, false, false, true])
    expect(maxInflight).toBe(1)
    await device.disconnect()
  })

  it('retries read-only commands on timeout, never retries toggles', async () => {
    const receiver = new SimulatedReceiver()
    let drop = 1
    const transport = new MockTransport({
      respond: (p) => {
        if (p[2] === Cmd.VOLUME_GET && drop-- > 0) return []
        return receiver.respond(p)
      },
    })
    const device = new HollylandDevice(transport, { ...FAST, fetchIdentity: false, fetchSettings: false })
    await device.connect()
    expect(await device.getVolume()).toBe(3)
    expect(sentCmds(transport).filter((c) => c === Cmd.VOLUME_GET)).toHaveLength(2)

    receiver.noiseEnabled = false
    let toggles = 0
    transport.respond = (p) => {
      if (p[2] === Cmd.NOISE_TOGGLE) {
        toggles++
        return []
      }
      return receiver.respond(p)
    }
    await expect(device.setNoiseCancellation(true)).rejects.toThrow(TimeoutError)
    expect(toggles).toBe(1)
    await device.disconnect()
  })

  it('ignores the duplicate second report the A2 sends per request', async () => {
    const { device } = setup({ duplicateReplies: true }, { fetchIdentity: false, fetchSettings: false })
    const unsolicited: number[] = []
    const notes: (string | undefined)[] = []
    device.on('unsolicited', (f) => unsolicited.push(f.cmd))
    device.onTraffic((e: TrafficEntry) => notes.push(e.note))
    await device.connect()
    await device.getVolume()
    await settle()
    expect(unsolicited).toEqual([])
    expect(notes).toContain('duplicate')
    await device.disconnect()
  })

  it('emits unsolicited frames and applies unsolicited heartbeats', async () => {
    const { device, transport, receiver } = setup({}, { fetchIdentity: false, fetchSettings: false })
    await device.connect()
    const seen: number[] = []
    device.on('unsolicited', (f) => seen.push(f.cmd))
    receiver.volume = 1
    transport.inject(encodeResponse(Cmd.HEARTBEAT, Target.RX, receiver.heartbeatPayload()))
    transport.inject(encodeResponse(0x0a, Target.RX, [7]))
    await settle()
    expect(seen).toEqual([Cmd.HEARTBEAT, 0x0a])
    expect(device.state.settings.volume).toBe(1)
    await device.disconnect()
  })

  it('coalesces queued writes of the same command (slider spam)', async () => {
    const { device, transport } = setup({}, { fetchIdentity: false, fetchSettings: false, interFrameDelayMs: 5 })
    await device.connect()
    await settle(15) // let the post-probe inter-frame pause elapse so the first write goes out at once
    const n0 = transport.sent.length
    const results = await Promise.all([1, 2, 3, 4, 5].map((v) => device.setVolume(v)))
    const volumeWrites = transport.sent.slice(n0).filter((p) => p[2] === Cmd.VOLUME_SET).map((p) => p[6])
    expect(volumeWrites[0]).toBe(1)
    expect(volumeWrites[volumeWrites.length - 1]).toBe(5)
    expect(volumeWrites.length).toBeLessThan(5)
    expect(results.every((r) => r.ok && r.confirmed)).toBe(true)
    expect(device.state.settings.volume).toBe(5)
    await device.disconnect()
  })

  it('polls the heartbeat and reports TX online/offline transitions', async () => {
    const { device, receiver } = setup({}, { heartbeatIntervalMs: 15, fetchIdentity: false, fetchSettings: false })
    receiver.tx[1].online = false
    const events: string[] = []
    device.on('tx-online', (t) => events.push(`on${t}`))
    device.on('tx-offline', (t) => events.push(`off${t}`))
    await device.connect()
    receiver.tx[1].online = true
    await settle(50)
    receiver.tx[0].online = false
    await settle(50)
    expect(events).toEqual(['on1', 'on2', 'off1'])
    await device.disconnect()
  })
})

describe('HollylandDevice: writes', () => {
  it('sends setters with the documented payloads and updates state', async () => {
    const { device, transport, receiver } = setup({}, { fetchIdentity: false, fetchSettings: false })
    await device.connect()
    expect(await device.setNoiseLevel(3)).toEqual({ ok: true, confirmed: true, code: 1 })
    await device.setChannelMode(2)
    await device.setVoicePreset(true, 2)
    await device.setMicRecognition(true) // before LED off: the app hides Mic Recognition while the LED is off
    await device.setLed(false)
    await device.setAutoPowerOff(false)
    await device.setSmartBattery(false)
    const last = transport.sent.slice(-7).map((p) => toHex(p.subarray(0, 8)))
    expect(last).toEqual([
      'aa dd 06 40 00 01 03 00',
      'aa dd 18 40 00 01 02 00',
      'aa dd 3a 40 00 02 01 02',
      'aa dd 3b 40 00 01 01 00',
      'aa dd 39 40 00 01 01 00',
      'aa dd 36 40 00 01 01 00',
      'aa dd 3d 40 00 01 00 00',
    ])
    await expect(device.setMicRecognition(false)).rejects.toThrow(PreconditionError)
    expect(receiver).toMatchObject({ noiseLevel: 3, channelMode: 2, ledOn: false, autoPowerOff: false, micRecognition: true, smartBattery: false })
    expect(device.state.settings).toMatchObject({ noiseLevel: 3, channelMode: 2, voicePreset: { enabled: true, preset: 2 }, ledOn: false })
    await expect(device.setVolume(6)).rejects.toThrow(CommandError)
    await expect(device.setNoiseLevel(0)).rejects.toThrow(CommandError)
    await device.disconnect()
  })

  it('noise on/off uses the toggle only when the state differs', async () => {
    const { device, transport, receiver } = setup({}, { fetchIdentity: false, fetchSettings: false })
    await device.connect()
    receiver.noiseEnabled = true
    await device.setNoiseCancellation(true)
    expect(sentCmds(transport)).not.toContain(Cmd.NOISE_TOGGLE)
    await device.setNoiseCancellation(false)
    const toggles = transport.sent.filter((p) => p[2] === Cmd.NOISE_TOGGLE)
    expect(toggles.map((p) => toHex(p.subarray(0, 7)))).toEqual(['aa dd 19 40 00 01 02'])
    expect(receiver.noiseEnabled).toBe(false)
    await device.disconnect()
  })

  it('reports a failed set ack', async () => {
    const receiver = new SimulatedReceiver()
    const transport = new MockTransport({
      respond: (p) => (p[2] === Cmd.LED_SET ? [encodeResponse(Cmd.LED_SET, Target.RX, [0])] : receiver.respond(p)),
    })
    const device = new HollylandDevice(transport, { ...FAST, fetchIdentity: false, fetchSettings: false })
    await device.connect()
    expect(await device.setLed(false)).toEqual({ ok: false, confirmed: true, code: 0 })
    expect(device.state.settings.ledOn).toBe(true)
    await device.disconnect()
  })

  it('gates destructive commands behind allowDestructive + confirm', async () => {
    const a = setup({}, { fetchIdentity: false, fetchSettings: false })
    await a.device.connect()
    await expect(a.device.factoryReset({ confirm: true })).rejects.toThrow(DestructiveCommandError)
    await expect(a.device.removePairing(1, { confirm: true })).rejects.toThrow(DestructiveCommandError)
    await expect(a.device.restartRx({ confirm: true })).rejects.toThrow(DestructiveCommandError)
    await expect(a.device.setSpeakerPassthrough(true, { restart: true })).rejects.toThrow(DestructiveCommandError)
    expect(sentCmds(a.transport)).not.toContain(Cmd.FACTORY_RESET)
    expect(sentCmds(a.transport)).not.toContain(Cmd.SPEAKER_SET)
    await a.device.disconnect()

    const b = setup({}, { fetchIdentity: false, fetchSettings: false, allowDestructive: true })
    await b.device.connect()
    await expect(b.device.factoryReset({ confirm: false })).rejects.toThrow(DestructiveCommandError)
    expect((await b.device.factoryReset({ confirm: true })).ok).toBe(true)
    expect(toHex(b.transport.sent[b.transport.sent.length - 1].subarray(0, 6))).toBe('aa dd 40 40 00 00')
    await b.device.disconnect()
  })

  it('sendRaw refuses anything that is not a catalogued read', async () => {
    const { device, transport } = setup({}, { fetchIdentity: false, fetchSettings: false })
    await device.connect()
    const n = transport.sent.length
    await expect(device.sendRaw(Uint8Array.from([0xaa, 0xdd, 0x40, 0x40, 0, 0]))).rejects.toThrow(CommandError)
    await expect(device.sendRaw(Uint8Array.from([0x55, 1, 2, 3]))).rejects.toThrow(CommandError)
    await expect(device.sendRaw(Uint8Array.from([0xaa, 0xdd, 0x77, 0x40, 0, 0]))).rejects.toThrow(CommandError)
    expect(transport.sent.length).toBe(n)
    const f = await device.sendRaw(Uint8Array.from([0xaa, 0xdd, 0x13, 0x40, 0, 0]))
    expect(f && decodeFrame(f.raw)?.cmd).toBe(0x13)
    await device.disconnect()
  })
})

describe('HollylandDevice: RX unavailable (macOS / Windows HID filtering)', () => {
  it('detects missing replies, refuses reads and unconfirmed writes', async () => {
    const { device, transport } = setup({ dropReplies: true }, {})
    let flagged = false
    device.on('rx-unavailable', () => (flagged = true))
    const s = await device.connect()
    expect(s.rx).toBe('unavailable')
    expect(flagged).toBe(true)
    await expect(device.getVolume()).rejects.toThrow(RxUnavailableError)
    await expect(device.setVolume(2)).rejects.toThrow(RxUnavailableError)
    expect(sentCmds(transport).every((c) => c === Cmd.HEARTBEAT)).toBe(true)
    await device.disconnect()
  })

  it('blindWrites sends idempotent sets without confirmation but never toggles', async () => {
    const { device, transport, receiver } = setup({ dropReplies: true }, { blindWrites: true })
    await device.connect()
    expect(await device.setVolume(2)).toEqual({ ok: true, confirmed: false, code: null })
    expect(receiver.volume).toBe(2)
    await expect(device.setNoiseCancellation(false)).rejects.toThrow(RxUnavailableError)
    expect(sentCmds(transport)).not.toContain(Cmd.NOISE_TOGGLE)
    await device.disconnect()
  })

  it('switches to available as soon as any reply shows up', async () => {
    const { device, receiver } = setup({ dropReplies: true }, {})
    await device.connect()
    receiver.dropReplies = false
    expect(await device.probe()).toBe('available')
    expect(await device.getVolume()).toBe(3)
    await device.disconnect()
  })
})

describe('HollylandDevice: disconnect', () => {
  it('rejects pending requests and emits disconnect', async () => {
    const receiver = new SimulatedReceiver()
    const transport = new MockTransport({
      respond: (p) => (p[2] === Cmd.HEARTBEAT ? receiver.respond(p) : []),
    })
    const device = new HollylandDevice(transport, { ...FAST, requestTimeoutMs: 500, fetchIdentity: false, fetchSettings: false })
    await device.connect()
    let disconnected = false
    device.on('disconnect', () => (disconnected = true))
    const pending = device.getVolume()
    await settle(5)
    transport.unplug()
    await expect(pending).rejects.toThrow(DisconnectedError)
    expect(disconnected).toBe(true)
    expect(device.state.connected).toBe(false)
    await expect(device.getVolume()).rejects.toThrow(DisconnectedError)
  })
})

describe('models', () => {
  it('resolves the in-scope PIDs', () => {
    expect(lookupProduct(0x3547, 0x0411)?.name).toBe('LARK A2')
    expect(lookupProduct(0x3547, 1042)?.name).toBe('LARK A2S')
    expect(lookupProduct(0x3547, 7)?.family).toBe('6301')
    expect(lookupProduct(0x3547, 1029)?.name).toBe('LARK M2S')
    expect(lookupProduct(0x3547, 1029)?.chinaName).toBe('LARK M2')
    expect(lookupProduct(0x3547, 1036)?.family).toBeNull()
    expect(lookupProduct(0x3547, 0x9999)).toBeUndefined()
    expect(lookupProduct(0x3547, 1041)?.capabilities?.volumeSteps).toBe(6)
    expect(lookupProduct(0x3547, 1042)?.capabilities?.volumeSteps).toBe(3)
  })
})

describe('HollylandDevice: runtime features (PID + RX firmware gates)', () => {
  it('smart battery exists only on the LARK A2 1041 (MoreSetting6118ActivityKt.shouldShowSmartBatteryItem)', async () => {
    const a = setup({ camera: true }, { fetchIdentity: false, fetchSettings: false }, 1042)
    await a.device.connect()
    expect(a.device.features?.smartBattery).toBe(false)
    await expect(a.device.setSmartBattery(true)).rejects.toThrow(UnsupportedError)
    expect(sentCmds(a.transport)).not.toContain(Cmd.SMART_BATTERY_SET)
    await a.device.disconnect()
    expect(lookupProduct(0x3547, 1041)?.capabilities?.smartBattery).toBe(true)
  })

  it('volume lock only on camera receivers (6302: PID 1030; 6301: PID 8/33)', () => {
    expect(lookupProduct(0x3547, 1029)?.capabilities?.voiceLock).toBe(false)
    expect(lookupProduct(0x3547, 1030)?.capabilities?.voiceLock).toBe(true)
    expect(lookupProduct(0x3547, 7)?.capabilities?.voiceLock).toBe(false)
    expect(lookupProduct(0x3547, 8)?.capabilities?.voiceLock).toBe(true)
    expect(lookupProduct(0x4417, 33)?.capabilities?.voiceLock).toBe(true)
  })

  it('gates M2S LED and custom buttons on RX firmware > 2.0.0.9 (version unknown -> unavailable)', async () => {
    const a = setup({ family: '6302' }, { fetchIdentity: false, fetchSettings: false }, 1029)
    await a.device.connect()
    expect(a.device.state.featureGates).toMatchObject({ led: 'version-unknown', customButtons: 'version-unknown' })
    await expect(a.device.setLed(true)).rejects.toThrow(/not known yet/)
    expect(await a.device.getFirmwareVersion()).toBe('2.0.0.32')
    expect(a.device.features).toMatchObject({ led: true, customButtons: true })
    expect((await a.device.setLed(false)).ok).toBe(true)
    await a.device.disconnect()

    const b = setup({ family: '6302' }, { fetchSettings: false }, 1029)
    b.receiver.rxVersion = [2, 0, 0, 9, 0, 0]
    await b.device.connect()
    await settle(40)
    expect(b.device.state.units.rx.version).toBe('2.0.0.9')
    expect(b.device.state.featureGates).toMatchObject({ led: 'firmware-too-old', customButtons: 'firmware-too-old' })
    await expect(b.device.setCustomButton({ index: 1, func: 4, keyOp: 1, tx1Color: 1, tx2Color: 2 })).rejects.toThrow(/too old/)
    await b.device.disconnect()

    const c = setup({ family: '6302' }, { fetchIdentity: false, fetchSettings: false, ignoreFirmwareGates: true }, 1029)
    await c.device.connect()
    expect(c.device.features?.led).toBe(true)
    await c.device.disconnect()
  })

  it('gates the Lark M2 noise toggle and camera lock on RX firmware > 2.0.0.31 (Android) and last part >= 32 (iOS)', async () => {
    const old = setup({ family: '6301' }, { fetchSettings: false }, 8)
    old.receiver.rxVersion = [2, 0, 0, 31, 0, 0]
    await old.device.connect()
    await settle(40)
    expect(old.device.features).toMatchObject({ noiseToggle: false, voiceLock: false })
    await expect(old.device.setVoiceLock(true)).rejects.toThrow(UnsupportedError)
    await old.device.disconnect()

    const neu = setup({ family: '6301' }, { fetchSettings: false }, 8)
    await neu.device.connect()
    await settle(40)
    expect(neu.device.state.units.rx.version).toBe('2.0.0.32')
    expect(neu.device.features).toMatchObject({ noiseToggle: true, voiceLock: true })
    await neu.device.disconnect()
  })
})

describe('HollylandDevice: app preconditions', () => {
  it('refuses home-screen settings with no TX online (resolveMicRequiredBlockReason)', async () => {
    const { device, receiver, transport } = setup({}, { fetchIdentity: false, fetchSettings: false })
    receiver.tx[0].online = false
    receiver.tx[1].online = false
    await device.connect()
    const n = transport.sent.length
    await expect(device.setVolume(2)).rejects.toMatchObject({ name: 'PreconditionError', reason: 'mic-disconnected' })
    await expect(device.setChannelMode(1)).rejects.toThrow(PreconditionError)
    expect(transport.sent.length).toBe(n)
    // settings outside the home screen are not gated (MoreSetting6118ViewModel)
    expect((await device.setAutoPowerOff(true)).ok).toBe(true)
    await device.disconnect()

    const off = setup({}, { fetchIdentity: false, fetchSettings: false, enforcePreconditions: false })
    off.receiver.tx[0].online = false
    off.receiver.tx[1].online = false
    await off.device.connect()
    expect((await off.device.setVolume(2)).ok).toBe(true)
    await off.device.disconnect()
  })

  it('refuses 6118 noise settings while every online TX is muted, and levels while NC is off', async () => {
    const { device, receiver } = setup({}, { fetchIdentity: false, fetchSettings: false })
    receiver.tx[0].muted = true
    receiver.tx[1].online = false
    await device.connect()
    await expect(device.setNoiseLevel(1)).rejects.toMatchObject({ reason: 'all-mics-muted' })
    receiver.tx[0].muted = false
    receiver.noiseEnabled = false
    await device.refreshStatus()
    await expect(device.setNoiseLevel(1)).rejects.toMatchObject({ reason: 'noise-off' })
    await device.disconnect()
  })

  it('M2S: refuses volume while locked, custom buttons unless both TXs are online', async () => {
    const { device, receiver } = setup({ family: '6302' }, { fetchSettings: false }, 1030)
    receiver.voiceLocked = true
    await device.connect()
    await settle(40)
    await expect(device.setVolume(1)).rejects.toMatchObject({ reason: 'volume-locked' })
    receiver.tx[1].online = false
    await device.refreshStatus()
    await expect(device.setButtonColors(1, 2)).rejects.toMatchObject({ reason: 'both-mics-required' })
    await device.disconnect()
  })
})

describe('HollylandDevice: reply decoding per family', () => {
  it('M2S colour-only button write sends 37 [00 00 00 c1 c2]', async () => {
    const { device, transport, receiver } = setup({ family: '6302' }, { fetchSettings: false }, 1029)
    await device.connect()
    await settle(40)
    expect((await device.setButtonColors(2, 1)).ok).toBe(true)
    expect(toHex(transport.sent[transport.sent.length - 1].subarray(0, 11))).toBe('aa dd 37 40 00 05 00 00 00 02 01')
    expect(receiver.buttonColors).toEqual([2, 1])
    expect(receiver.buttons).toEqual([0x21, 0x31]) // slots untouched
    expect(device.state.settings.buttonColors).toEqual({ tx1: 2, tx2: 1 })
    await device.disconnect()
  })

  it('M2 noise-set reply with only a status byte is a failure (Pro_set_noise needs 2 bytes)', async () => {
    const receiver = new SimulatedReceiver({ family: '6302' })
    const transport = new MockTransport({
      info: { vendorId: 0x3547, productId: 1029 },
      respond: (p) => (p[2] === Cmd.NOISE_LEVEL_SET ? [encodeResponse(Cmd.NOISE_LEVEL_SET, Target.RX, [1])] : receiver.respond(p)),
    })
    const device = new HollylandDevice(transport, { ...FAST, fetchIdentity: false, fetchSettings: false })
    await device.connect()
    expect(await device.setNoiseLevel(2)).toEqual({ ok: false, confirmed: true, code: 1 })
    transport.respond = receiver.respond
    expect(await device.setNoiseLevel(2)).toEqual({ ok: true, confirmed: true, code: 1 })
    await device.disconnect()
  })

  it('Lark M2 unlock reply 0 counts as success (iOS reads it as the new state)', async () => {
    const { device, receiver } = setup({ family: '6301' }, { fetchSettings: false }, 8)
    receiver.voiceLockReplyIsState = true
    receiver.voiceLocked = true
    await device.connect()
    await settle(40)
    expect(await device.setVoiceLock(false)).toEqual({ ok: true, confirmed: true, code: 0 })
    expect(device.state.settings.voiceLocked).toBe(false)
    await device.disconnect()
  })

  it('mobile Lark M2 (PID 7) ignores heartbeat volume; M2 heartbeats leave TX mute/charge unknown', async () => {
    const { device, receiver } = setup({ family: '6301' }, { fetchIdentity: false, fetchSettings: false }, 7)
    receiver.volume = 4
    await device.connect()
    expect(device.state.settings.volume).toBeUndefined()
    expect(device.state.units.tx1.muted).toBeUndefined()
    expect(device.state.units.tx2.charging).toBeUndefined()
    expect(await device.getVolume()).toBe(4)
    await device.disconnect()
  })

  it('6118 getNoiseLevel reads the heartbeat, not the ambiguous 0x11', async () => {
    const { device, transport, receiver } = setup({}, { fetchIdentity: false, fetchSettings: false })
    await device.connect()
    receiver.noiseLevel = 3
    expect(await device.getNoiseLevel()).toEqual({ enabled: true, level: 3 })
    expect(sentCmds(transport)).not.toContain(Cmd.NOISE_LEVEL_GET)
    expect(await device.getNoiseLevelRaw()).toMatchObject({ raw: 0x83, enabled: true, level: 3, agree: false })
    await device.disconnect()
  })

  it('noise toggle result comes from the heartbeat after the toggle', async () => {
    const receiver = new SimulatedReceiver()
    const transport = new MockTransport({
      respond: (p) => (p[2] === Cmd.NOISE_TOGGLE ? [encodeResponse(Cmd.NOISE_TOGGLE, Target.RX, [1])] : receiver.respond(p)),
    })
    const device = new HollylandDevice(transport, { ...FAST, fetchIdentity: false, fetchSettings: false })
    await device.connect()
    receiver.noiseEnabled = true
    // the firmware "acks" but nothing changes
    expect(await device.setNoiseCancellation(false)).toEqual({ ok: false, confirmed: true, code: 1 })
    await device.disconnect()
  })
})

describe('HollylandDevice: session details', () => {
  it('re-asks for a version that decodes to all zeros ("0.0.0.000"), separate from the serial budget', async () => {
    const receiver = new SimulatedReceiver()
    let zeros = 2
    const transport = new MockTransport({
      respond: (p) => {
        if (p[2] === Cmd.VERSION_GET && p[3] === 0x40 && zeros-- > 0) return [encodeResponse(Cmd.VERSION_GET, Target.RX, [0, 0, 0, 0, 0, 0])]
        return receiver.respond(p)
      },
    })
    const device = new HollylandDevice(transport, { ...FAST, fetchSettings: false })
    await device.connect()
    await settle(80)
    expect(device.state.units.rx.version).toBe('1.0.0.015')
    const rxVersionReads = transport.sent.filter((p) => p[2] === Cmd.VERSION_GET && p[3] === 0x40).length
    const rxSerialReads = transport.sent.filter((p) => p[2] === Cmd.SERIAL_GET && p[3] === 0x40).length
    expect(rxVersionReads).toBe(3)
    expect(rxSerialReads).toBe(1)
    await device.disconnect()
  })

  it('protect window covers only volume / noise (iOS) and opens at dispatch', async () => {
    let t = 1000
    const { device, receiver } = setup({}, { fetchIdentity: false, fetchSettings: false, now: () => t })
    await device.connect()
    await device.setVolume(1)
    await device.setLed(false)
    receiver.volume = 4 // device-side change within the window is ignored
    receiver.ledOn = true // ... but LED is not protected
    await device.refreshStatus()
    expect(device.state.settings.volume).toBe(1)
    expect(device.state.settings.ledOn).toBe(true)
    t += 1500
    await device.refreshStatus()
    expect(device.state.settings.volume).toBe(4)
    await device.disconnect()
  })

  it('reads smart battery back 150 ms after the write (scheduleSmartBatteryRefresh)', async () => {
    const { device, transport } = setup({}, { fetchIdentity: false, fetchSettings: false })
    await device.connect()
    await device.setSmartBattery(false)
    expect(sentCmds(transport)).not.toContain(Cmd.SMART_BATTERY_GET)
    await settle(200)
    expect(sentCmds(transport)).toContain(Cmd.SMART_BATTERY_GET)
    await device.disconnect()
  })

  it('heartbeat pauses nest (C6118RuntimeSession pauseCount)', async () => {
    const { device } = setup({}, { fetchIdentity: false, fetchSettings: false })
    device.pauseHeartbeat()
    device.pauseHeartbeat()
    device.resumeHeartbeat()
    expect(device.heartbeatPaused).toBe(true)
    device.resumeHeartbeat()
    expect(device.heartbeatPaused).toBe(false)
  })

  it('stores the 0x16 variant on connect without overriding the PID', async () => {
    const { device } = setup({}, { fetchIdentity: false })
    await device.connect()
    await settle(40)
    expect(device.state.settings).toMatchObject({ rxVariant: 0, rxCameraByDeviceInfo: false })
    await device.disconnect()
  })
})
