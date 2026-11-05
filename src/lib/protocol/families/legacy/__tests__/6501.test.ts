/**
 * 6501 group (Lark C1 PID 1, C1 2nd gen PID 11, M1 2nd gen PID 12, Lark Mini PID 13) on the legacy
 * engine. Vectors and rules: docs/research/families/legacy-6501.md (§3 frames, §4 session, §5
 * catalogue, §6–§7 per-product rules). Nothing here has been run on 6501 hardware; the replies are
 * the research doc's illustrative frames (layouts from the parsers, values invented).
 */
import { describe, expect, it } from 'vitest'
import { decodeFrame, encodeRequest, fromHex, toHex, Target, type RequestFrame } from '../../../codec'
import {
  Cmd, COMMANDS, LARK_C1_VOLUME_WIRE, LEGACY_FAMILIES, Requests, describePayload, isNew6501, parseDeviceInfo, parseHeartbeat,
  parseNoiseSetM2, parseVersionLegacy, volumeStepToWire, volumeWireToStep, CommandError,
} from '../../../commands'
import { HollylandDevice, PreconditionError, ReadOnlyError, UnsupportedError, type HollylandDeviceOptions } from '../../../device'
import { MockTransport, SimulatedReceiver, encodeResponse } from '../../../mock'
import { displayName, lookupProduct, supportOf, type ProductInfo } from '../../../models'
import { CONTROL } from '../../../core/controls'
import { describeDriverConformance } from '../../../core/conformance'
import { createMicDevice, createMockDevice, findMockPreset } from '../../../core/registry'
import {
  LEGACY_DRIVERS, LEGACY_PROFILES, LegacyMicDevice, createProfiledMicDevice, forceProfileOptions, legacyCatalogue, legacyControls, legacyProfile,
  profileFromSearch, profilesFor, type LegacySimulator,
} from '..'

const H = 0x3547
const row = (pid: number): ProductInfo => lookupProduct(H, pid)!
const receiverOf = (s: unknown): SimulatedReceiver => (s as LegacySimulator).receiver

const FAST: HollylandDeviceOptions = {
  requestTimeoutMs: 30, probeTimeoutMs: 40, interFrameDelayMs: 0, heartbeatIntervalMs: null, retries: 0, identityRetryDelayMs: 5,
  fetchIdentity: false, fetchSettings: false,
}

/** A simulated receiver of `pid` (6501 profile follows the PID) and a HollylandDevice on it. */
function setup(pid: number, opts: HollylandDeviceOptions = {}, arrange?: (r: SimulatedReceiver) => void) {
  const product = row(pid)
  const receiver = new SimulatedReceiver({ family: product.family!, camera: product.variant === 'camera', productId: pid })
  arrange?.(receiver)
  const transport = new MockTransport({ info: { vendorId: product.vendorId, productId: pid }, respond: receiver.respond })
  const device = new HollylandDevice(transport, { ...FAST, ...opts })
  return { receiver, transport, device, product }
}

const sentCmds = (t: MockTransport) => t.sent.map((p) => p[2])
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
const used = (f: RequestFrame, xor = false) => {
  const p = encodeRequest(f, { appendXor: xor })
  return toHex(p.subarray(0, 6 + (f.payload?.length ?? 0) + (xor ? 1 : 0)))
}

// ------------------------------------------------------------------------------------ conformance

describeDriverConformance(LEGACY_DRIVERS['6501'], {
  chunkSizes: [], // HID reports never split a legacy frame (PROTOCOL.md §3.4)
  preconditions: [
    ...[11, 12, 13].map((pid) => ({
      name: `${displayName(row(pid))}: NC level refused while NC is off (noise_is_closed_notice)`, product: row(pid),
      arrange: (s: unknown) => (receiverOf(s).noiseEnabled = false), control: CONTROL.NOISE_LEVEL, value: 1, reason: 'noise-off',
    })),
    ...[11, 12, 13].map((pid) => ({
      name: `${displayName(row(pid))}: volume needs a mic online (mic_offline_tip)`, product: row(pid), sim: { online: ['rx' as const] },
      control: CONTROL.VOLUME, value: 1, reason: 'mic-disconnected',
    })),
    {
      name: 'Lark C1: NC level needs a mic online (both apps)', product: row(1), sim: { online: ['rx'] }, control: CONTROL.NOISE_LEVEL, value: 1,
      reason: 'mic-disconnected',
    },
  ],
})

// ------------------------------------------------------------------------------------ registry

describe('6501 registry rows (legacy-6501.md §1)', () => {
  it('PIDs 1/11/12/13 are family 6501, experimental and untested; PID 2 stays recognised only', () => {
    for (const pid of [1, 11, 12, 13]) {
      const p = row(pid)
      expect(p, String(pid)).toMatchObject({ family: '6501', familyCode: '6501', heartbeatIntervalMs: 3000, variant: null, txCount: 2 })
      expect(supportOf(p)).toMatchObject({ level: 'experimental', hardware: 'untested', research: 'docs/research/families/legacy-6501.md' })
      expect(p.capabilities).toMatchObject({
        versionCmd: 0x03, noiseMaxLevel: 2, noiseToggle: false, volumeSteps: 6, channelModes: [], led: false, voiceLock: false,
        autoPowerOff: false, customButtons: false, speakerPassthrough: true, restartRx: true, removePairing: false, factoryReset: false,
      })
      expect(p.capabilities?.firmwareGates).toBeUndefined()
    }
    expect(displayName(row(1))).toBe('Lark C1')
    expect(displayName(row(11))).toBe('Lark C1 (2nd gen)')
    expect(displayName(row(12))).toBe('Lark M1 (2nd gen)')
    expect(displayName(row(13))).toBe('Lark Mini')
    expect(row(2)).toMatchObject({ family: null, capabilities: null, support: { level: 'recognised' } })
  })

  it('capability flags: C1 link-only + wire map + no NC-off / mic check; C1 2nd gen label swap', () => {
    expect(row(1).capabilities).toMatchObject({
      heartbeatSettings: false, volumeWireValues: [5, 4, 3, 0, 1, 2], noiseLevelNeedsNcOn: false, volumeNeedsMic: false,
    })
    for (const pid of [11, 12, 13]) {
      expect(row(pid).capabilities).toMatchObject({ heartbeatSettings: true, noiseLevelNeedsNcOn: true, volumeNeedsMic: true })
      expect(row(pid).capabilities?.volumeWireValues).toBeUndefined()
    }
    expect(row(11).capabilities?.txLabelSwap).toBe(true)
    for (const pid of [1, 12, 13]) expect(row(pid).capabilities?.txLabelSwap).toBeUndefined()
    // The A2 / M2 / M2S rows carry none of the 6501 flags (their behaviour is unchanged).
    for (const pid of [1041, 1042, 7, 8, 1029, 1030]) {
      const c = row(pid).capabilities!
      expect([c.heartbeatSettings, c.txLabelSwap, c.volumeWireValues, c.noiseLevelNeedsNcOn, c.volumeNeedsMic]).toEqual([undefined, undefined, undefined, undefined, undefined])
    }
  })

  it('catalogue: what the group sends, plus documented OTA / notify ids; never the hidden M2 features', () => {
    const cat = legacyCatalogue('6501')
    const ids = Object.keys(cat).map(Number).sort((a, b) => a - b)
    expect(ids).toEqual([
      Cmd.VERSION_LEGACY_GET, Cmd.VOLUME_GET, Cmd.VOLUME_SET, Cmd.NOISE_LEVEL_SET, Cmd.DEVICE_ID_GET, Cmd.OTA_TX_ENTER, Cmd.DEVICE_WARNING,
      Cmd.OTA_RESULT, Cmd.RESTART_RX, Cmd.OTA_RX_ENTER, Cmd.OTA_PACKET_ACK, Cmd.HEARTBEAT, Cmd.NOISE_LEVEL_GET, Cmd.SPEAKER_SET,
      Cmd.SPEAKER_GET, Cmd.SERIAL_GET, Cmd.DEVICE_INFO_GET, Cmd.VOICE_LOCK_GET,
    ].sort((a, b) => a - b))
    for (const c of [Cmd.NOISE_TOGGLE, Cmd.VOICE_LOCK_SET, Cmd.CHANNEL_MODE_SET, Cmd.AUTO_OFF_SET, Cmd.LED_SET, Cmd.BUTTON_CUSTOM_SET, Cmd.VERSION_GET, Cmd.FACTORY_RESET, Cmd.REMOVE_PAIRING]) {
      expect(cat[c], COMMANDS[c].name).toBeUndefined()
    }
    expect(cat[Cmd.OTA_TX_ENTER].safety).toBe('ota')
    expect(cat[Cmd.RESTART_RX].safety).toBe('disruptive')
    expect(Object.values(cat).some((c) => c.safety === 'destructive')).toBe(false)
    expect(LEGACY_FAMILIES).toEqual(['6118', '6301', '6302', '6501'])
    for (const c of Object.values(cat)) expect(c.source).toMatch(/A |I /)
  })

  it('controls per product use the 6501 screen labels and read-back paths', () => {
    const c1 = legacyControls(row(1))
    expect(c1.map((c) => c.id)).toEqual([CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.SPEAKER, CONTROL.RESTART_RX])
    expect(c1.map((c) => c.label)).toEqual(['NC Level', 'Volume', 'Phone Speaker', 'Restart Device'])
    expect(c1.find((c) => c.id === CONTROL.NOISE_LEVEL)).toMatchObject({ options: [{ value: 1, label: 'Weak' }, { value: 2, label: 'Strong' }], readBack: 'get' })
    expect(c1.find((c) => c.id === CONTROL.VOLUME)).toMatchObject({ range: { min: 0, max: 5, displayOffset: 1 }, readBack: 'get', confidence: 'low' })
    const m1 = legacyControls(row(12))
    expect(m1.find((c) => c.id === CONTROL.NOISE_LEVEL)?.readBack).toBe('status')
    expect(m1.find((c) => c.id === CONTROL.VOLUME)).toMatchObject({ readBack: 'status', confidence: 'medium' })
    expect(m1.find((c) => c.id === CONTROL.RESTART_RX)).toMatchObject({ safety: 'disruptive', confirmText: expect.any(String) })
    for (const c of [...c1, ...m1]) expect(c.source).toMatch(/larkc1\/HLDeviceActivity|Pro_set_restart/)
    // The M2 rows keep their labels (unchanged behaviour).
    expect(legacyControls(row(7)).find((c) => c.id === CONTROL.NOISE_LEVEL)?.label).toBe('Noise Cancellation level')
  })
})

// --------------------------------------------------------------------------------- byte vectors

describe('6501 byte vectors (legacy-6501.md §3)', () => {
  it.each([
    ['heartbeat to RX (Pro_get_heart)', Requests.heartbeat(), 'aa dd 10 40 00 00', '27'],
    ['version of TX2 (Pro_get_version, TX2)', Requests.versionFor('6501', Target.TX2), 'aa dd 03 42 00 00', '36'],
    ['NC level Strong (strong_level → Pro_set_noise {2})', Requests.noiseLevelSet(2, '6501'), 'aa dd 06 40 00 01 02', '32'],
    ['Lark C1 volume, button "1" (wire 5)', Requests.volumeSet(volumeStepToWire(0, LARK_C1_VOLUME_WIRE)), 'aa dd 05 40 00 01 05', '36'],
    ['Phone Speaker off (!z ? 1 : 0)', Requests.speakerSet(false), 'aa dd 12 40 00 01 01', '25'],
    ['OTA device id of TX1 (Pro_get_devid)', Requests.deviceId(Target.TX1), 'aa dd 08 41 00 01 01', '3e'],
    ['variant query (iOS only)', Requests.deviceInfo(), 'aa dd 16 40 00 00', '21'],
  ])('%s', (_n, frame, android, xor) => {
    expect(used(frame)).toBe(android)
    // Android pads to 64 bytes with zeros (Protocol.getData allocates byte[64]).
    const padded = encodeRequest(frame)
    expect(padded.length).toBe(64)
    expect(padded.subarray(6 + (frame.payload?.length ?? 0)).every((b) => b === 0)).toBe(true)
    // iOS appends XOR(bytes 0..5+n) (headerWithCommand:payload:andType: @0x10027a484).
    expect(used(frame, true)).toBe(`${android} ${xor}`)
  })

  it('illustrative replies decode with the M2 parsers (layouts from Pro_* receiveData; values invented)', () => {
    const version = decodeFrame(fromHex('bb dd 03 80 00 04 01 00 04 05'))!
    expect(parseVersionLegacy(version.payload)).toBe('1.0.4.5')
    expect(isNew6501('1.0.4.5')).toBe(true) // parts[2] = 4 → TYPEC firmware line (Util.isNew6501)
    expect(isNew6501('1.0.3.9')).toBe(false)
    expect(isNew6501('1.0.4')).toBe(false) // needs >= 4 parts
    const hb = parseHeartbeat('6501', decodeFrame(fromHex('bb dd 10 80 00 06 01 00 5a 00 00 00'))!.payload)
    expect(hb).toMatchObject({ family: '6501', tx: [{ online: true, battery: 90 }, { online: false, battery: 0 }], payloadLength: 6 })
    expect(hb.family !== '6118' && hb.noiseLevel).toBeUndefined() // the minimum Pro_get_heart accepts carries no settings
    expect(parseNoiseSetM2(decodeFrame(fromHex('bb dd 06 80 00 02 01 02'))!.payload)).toEqual({ ok: true, level: 2 })
    expect(parseNoiseSetM2(fromHex('01'))).toEqual({ ok: false, level: undefined }) // a 1-byte reply is a failure
    const info = parseDeviceInfo(decodeFrame(fromHex('bb dd 16 80 00 01 03'))!.payload, '6501')
    expect(info).toMatchObject({ variant: 3, mini: true, cameraRx: false })
    // iOS reads body[0] == 3 only for type 5 (`lark m1 pro` = PIDs 12/13); C1 (1) and C1 2nd gen (11) never become a Mini.
    expect([1, 11, 12, 13].map((pid) => parseDeviceInfo(fromHex('03'), '6501', 1, pid).mini)).toEqual([false, false, true, true])
    // body[0] == 2 means "camera" only for M2 / M2S / A2 (iOS has no camera branch for the 6501 types).
    expect(parseDeviceInfo(fromHex('02 00 00 06 01 01 5b 5c 00'), '6501')).toMatchObject({ cameraRx: false, mini: false })
    expect(describePayload(Cmd.DEVICE_INFO_GET, 'response', fromHex('03'), '6501')).toBe('DEVICE_INFO_GET variant=3 mini=true')
  })

  it('Lark C1 volume map: buttons 1..6 ↔ wire 5,4,3,0,1,2 (DeviceCompat.getVoiceLevels(1))', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => volumeStepToWire(s, LARK_C1_VOLUME_WIRE))).toEqual([5, 4, 3, 0, 1, 2])
    expect([5, 4, 3, 0, 1, 2].map((w) => volumeWireToStep(w, LARK_C1_VOLUME_WIRE))).toEqual([0, 1, 2, 3, 4, 5])
    expect(volumeWireToStep(6, LARK_C1_VOLUME_WIRE)).toBeUndefined()
    expect(volumeStepToWire(3)).toBe(3) // no map: the step is the wire value
    expect(() => volumeStepToWire(6, LARK_C1_VOLUME_WIRE)).toThrow(CommandError)
    // iOS sends 0..2 for every type: the top three Android buttons ("4", "5", "6").
    expect([0, 1, 2].map((w) => volumeWireToStep(w, LARK_C1_VOLUME_WIRE)! + 1)).toEqual([4, 5, 6])
  })
})

// ------------------------------------------------------------------------------ device rules

describe('HollylandDevice: 6501 session (legacy-6501.md §4)', () => {
  it('start-up reads: 0x10 probe, then 0x16, 0x11, 0x04, 0x13, 0x35 (Android getDeviceVersion + iOS 0x16); never 0x19/0x34/0x18/0x36', async () => {
    const { device, transport } = setup(12, { fetchSettings: true })
    await device.connect()
    await settle()
    expect(sentCmds(transport)).toEqual([Cmd.HEARTBEAT, Cmd.DEVICE_INFO_GET, Cmd.NOISE_LEVEL_GET, Cmd.VOLUME_GET, Cmd.SPEAKER_GET, Cmd.VOICE_LOCK_GET])
    expect(device.state.settings).toMatchObject({ noiseLevel: 2, noiseEnabled: true, volume: 3, speakerPassthrough: false, voiceLocked: false, rxMiniByDeviceInfo: false })
    await device.disconnect()
  })

  it('identity uses 0x03 and the UTF-8 serial (Pro_get_version / Pro_get_sn)', async () => {
    const { device, transport } = setup(1, { fetchIdentity: true })
    await device.connect()
    await settle(60)
    expect(device.state.units.rx).toMatchObject({ version: '1.0.4.5', serial: 'SIMC1RX00001' })
    expect(device.state.units.tx1.version).toBe('1.0.4.3')
    expect(sentCmds(transport)).not.toContain(Cmd.VERSION_GET)
    await device.disconnect()
  })

  it('Lark C1: the heartbeat (6 bytes) drives link and battery only; NC and volume come from 0x11 / 0x04', async () => {
    const { device, receiver, transport } = setup(1, { fetchSettings: true })
    await device.connect()
    await settle()
    expect(transport.sent[0][2]).toBe(Cmd.HEARTBEAT)
    expect(device.state.heartbeat).toMatchObject({ family: '6501', payloadLength: 6 })
    expect(device.state.units.tx1).toMatchObject({ online: true, battery: 85 })
    // receiver volume (wire) 3 = button "3" (index 2)
    expect(device.state.settings).toMatchObject({ noiseLevel: 2, noiseEnabled: true, volume: 2, volumeWire: 3 })
    // A long heartbeat carrying other values must not change NC / volume (A `productId != 1`, `productId >= 8`; I type < 3).
    receiver.heartbeatLength = null
    receiver.noiseLevel = 1
    receiver.volume = 0
    await device.refreshStatus()
    expect(device.state.settings).toMatchObject({ noiseLevel: 2, volume: 2 })
    expect(await device.getVolume()).toBe(3) // wire 0 = button "4"
    expect(device.state.settings).toMatchObject({ volume: 3, volumeWire: 0 })
    await device.disconnect()
  })

  it('Lark C1: volume buttons are sent through the wire map, allowed without a mic (isAllowSetVoice)', async () => {
    const { device, receiver, transport } = setup(1, {}, (r) => {
      r.tx[0].online = false
      r.tx[1].online = false
    })
    await device.connect()
    expect(await device.setVolume(0)).toMatchObject({ ok: true, confirmed: true })
    expect(toHex(transport.sent.at(-1)!.subarray(0, 7))).toBe('aa dd 05 40 00 01 05')
    expect(receiver.volume).toBe(5)
    expect(device.state.settings).toMatchObject({ volume: 0, volumeWire: 5 })
    await device.setVolume(5)
    expect(receiver.volume).toBe(2)
    await expect(device.setVolume(6)).rejects.toThrow(CommandError)
    // NC level still needs a mic (both apps).
    await expect(device.setNoiseLevel(1)).rejects.toMatchObject({ name: 'PreconditionError', reason: 'mic-disconnected' })
    await device.disconnect()
  })

  it('Lark C1: NC level is not refused while NC is off (iOS type < 3)', async () => {
    const { device, receiver } = setup(1, { fetchSettings: true })
    receiver.noiseEnabled = false
    await device.connect()
    await settle()
    expect(device.state.settings.noiseEnabled).toBe(false)
    expect(await device.setNoiseLevel(2)).toMatchObject({ ok: true })
    await device.disconnect()
  })

  it('PIDs 11/12/13: heartbeat NC level and volume are applied; lock, channel mode, auto-off, LED, buttons are not', async () => {
    for (const pid of [11, 12, 13]) {
      const { device, receiver } = setup(pid)
      receiver.voiceLocked = true
      receiver.channelMode = 1
      receiver.buttons = [0x21, 0x31]
      receiver.volume = 4
      receiver.noiseLevel = 1
      await device.connect()
      expect(device.state.heartbeat).toMatchObject({ family: '6501', payloadLength: 14 })
      expect(device.state.settings).toEqual({ noiseLevel: 1, noiseEnabled: true, volume: 4 })
      receiver.noiseEnabled = false
      await device.refreshStatus()
      expect(device.state.settings).toMatchObject({ noiseLevel: 0, noiseEnabled: false })
      await expect(device.setNoiseLevel(2)).rejects.toMatchObject({ reason: 'noise-off' })
      await device.disconnect()
    }
  })

  it('PIDs 11/12/13: an out-of-range heartbeat NC byte (>= 4) is ignored (I isHeartbeatNoiseLevelValid: @0x1000bafac)', async () => {
    for (const pid of [11, 12, 13]) {
      const { device, receiver } = setup(pid)
      receiver.noiseEnabled = false
      await device.connect()
      expect(device.state.settings).toMatchObject({ noiseLevel: 0, noiseEnabled: false })
      // The simulator writes noiseLevel into body[6] while NC is on: 0xFF must not read as "NC on, level 255".
      receiver.noiseEnabled = true
      for (const bad of [4, 0x7f, 0xff]) {
        receiver.noiseLevel = bad
        await device.refreshStatus()
        expect(device.state.settings, `body[6] = ${bad}`).toMatchObject({ noiseLevel: 0, noiseEnabled: false })
      }
      await expect(device.setNoiseLevel(2)).rejects.toMatchObject({ reason: 'noise-off' })
      receiver.noiseLevel = 3
      await device.refreshStatus()
      expect(device.state.settings).toMatchObject({ noiseLevel: 3, noiseEnabled: true })
      await device.disconnect()
    }
  })

  it('volume is refused while 0x35 reads locked (onClickBtnGroup checks the hidden lock view)', async () => {
    const { device, receiver, transport } = setup(12, { fetchSettings: true })
    receiver.voiceLocked = true
    await device.connect()
    await settle()
    expect(device.state.settings.voiceLocked).toBe(true)
    const n = transport.sent.length
    await expect(device.setVolume(1)).rejects.toBeInstanceOf(PreconditionError)
    expect(transport.sent.length).toBe(n)
    await device.disconnect()
  })

  it('features the group lacks are refused before anything is sent', async () => {
    const { device, transport } = setup(12)
    await device.connect()
    const n = transport.sent.length
    await expect(device.setNoiseCancellation(false)).rejects.toBeInstanceOf(UnsupportedError)
    await expect(device.setVoiceLock(true)).rejects.toBeInstanceOf(UnsupportedError)
    await expect(device.setChannelMode(1)).rejects.toBeInstanceOf(UnsupportedError)
    await expect(device.setAutoPowerOff(true)).rejects.toBeInstanceOf(UnsupportedError)
    await expect(device.setLed(true)).rejects.toBeInstanceOf(UnsupportedError)
    await expect(device.factoryReset({ confirm: true })).rejects.toThrow()
    expect(transport.sent.length).toBe(n)
    await device.disconnect()
  })

  it('Lark C1 2nd gen: Mic1/Mic2 swapped for display only (wire addressing unchanged)', async () => {
    const { device, receiver, transport } = setup(11, { fetchIdentity: true })
    receiver.tx[1].online = false
    await device.connect()
    await settle(60)
    expect(device.state.units.tx1).toMatchObject({ target: Target.TX1, label: 'Mic2', online: true, battery: 85 })
    expect(device.state.units.tx2).toMatchObject({ target: Target.TX2, label: 'Mic1', online: false })
    // identity of TX1 is still asked at 0x41
    expect(transport.sent.filter((p) => p[2] === Cmd.VERSION_LEGACY_GET).map((p) => p[3])).toContain(0x41)
    const mic = LegacyMicDevice.wrap(device)
    expect(mic.state.units.tx1).toMatchObject({ id: 'tx1', label: 'Mic2' })
    expect(mic.state.units.tx2).toMatchObject({ id: 'tx2', label: 'Mic1' })
    mic.dispose()
    await device.disconnect()
    // no labels on the other products
    const m1 = setup(12)
    expect(m1.device.state.units.tx1.label).toBeUndefined()
  })

  it('Lark Mini: 0x16 body[0] = 3 is recorded (the PID stays authoritative)', async () => {
    const { device } = setup(13, { fetchSettings: true })
    await device.connect()
    await settle()
    expect(device.state.settings).toMatchObject({ rxVariant: 3, rxMiniByDeviceInfo: true, rxCameraByDeviceInfo: false })
    expect(await device.getDeviceInfo()).toMatchObject({ mini: true })
    expect(device.product.name).toBe('Lark Mini')
    await device.disconnect()
  })

  it('Phone Speaker + restart keep the legacy rules (disruptive: allowDestructive + confirm)', async () => {
    const { device, transport } = setup(12)
    await device.connect()
    expect(await device.setSpeakerPassthrough(true)).toMatchObject({ ok: true })
    expect(toHex(transport.sent.at(-1)!.subarray(0, 7))).toBe('aa dd 12 40 00 01 00')
    await expect(device.restartRx({ confirm: true })).rejects.toMatchObject({ name: 'DestructiveCommandError' })
    expect(sentCmds(transport)).not.toContain(Cmd.RESTART_RX)
    await device.disconnect()
  })
})

describe('LegacyMicDevice: 6501 availability and status refresh', () => {
  it('Lark C1: refresh("status") also reads 0x11 / 0x04; no noise-off or mic gate on volume', async () => {
    const { device, receiver, transport } = setup(1, {}, (r) => {
      r.tx[0].online = false
      r.tx[1].online = false
      r.noiseEnabled = false
    })
    const mic = LegacyMicDevice.wrap(device)
    await mic.connect()
    await mic.refresh('status')
    expect(sentCmds(transport).slice(-3)).toEqual([Cmd.HEARTBEAT, Cmd.NOISE_LEVEL_GET, Cmd.VOLUME_GET])
    expect(mic.state.values).toMatchObject({ [CONTROL.NOISE_ENABLED]: false, [CONTROL.VOLUME]: 2 })
    expect(mic.state.availability[CONTROL.VOLUME]).toBeUndefined()
    expect(mic.state.availability[CONTROL.NOISE_LEVEL]).toMatchObject({ reason: 'mic-disconnected' }) // not 'noise-off'
    expect(await mic.set(CONTROL.VOLUME, 4)).toMatchObject({ ok: true })
    expect(receiver.volume).toBe(1)
    mic.dispose()
    await device.disconnect()
  })

  it('M1 (2nd gen): availability mirrors the NC-off and mic preconditions', async () => {
    const { device, receiver } = setup(12)
    const mic = LegacyMicDevice.wrap(device)
    await mic.connect()
    receiver.noiseEnabled = false
    receiver.tx[0].online = false
    receiver.tx[1].online = false
    await mic.refresh('status')
    expect(mic.state.availability[CONTROL.NOISE_LEVEL]).toMatchObject({ ok: false })
    expect(mic.state.availability[CONTROL.VOLUME]).toMatchObject({ ok: false, reason: 'mic-disconnected' })
    expect(mic.controls.map((c) => c.id)).toEqual([CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.SPEAKER, CONTROL.RESTART_RX])
    mic.dispose()
    await device.disconnect()
  })

  it('createMicDevice and the mock presets build working 6501 devices', async () => {
    const m = createMicDevice(new MockTransport({ info: { vendorId: H, productId: 11 } }))
    expect(m).toBeInstanceOf(LegacyMicDevice)
    expect(m.family).toBe('6501')
    for (const [id, pid] of [['c1', 1], ['c1g2', 11], ['m1g2', 12], ['mini', 13]] as const) {
      expect(findMockPreset(id)?.product.productId).toBe(pid)
      const { device, simulator } = createMockDevice(id, { ...FAST, product: undefined })
      const s = await device.connect()
      expect(s.rx).toBe('available')
      expect(s.product.productId).toBe(pid)
      await device.refresh('status')
      expect(device.state.values[CONTROL.VOLUME]).toBe(pid === 1 ? 2 : 3)
      expect(receiverOf(simulator).heartbeatPayload()).toHaveLength(pid === 1 ? 6 : 14)
      await device.disconnect()
    }
  })

  it('hardware check: the read steps and the reversible volume write run against the simulator', async () => {
    const d = LEGACY_DRIVERS['6501']
    expect(d.hardwareCheck.map((s) => s.id)).toEqual(['descriptor', 'heartbeat', 'identity', 'device-info', 'voice-lock-get', 'nc-volume-get', 'reversible-write'])
    const { device, transport, simulator } = createMockDevice('c1', FAST)
    await device.connect()
    for (const step of d.hardwareCheck) {
      if (!step.run) continue
      const r = await step.run(device)
      expect(r.ok, `${step.id}: ${r.summary}`).toBe(true)
    }
    const writes = transport.sent.filter((p) => COMMANDS[p[2]]?.safety !== 'read').map((p) => toHex(p.subarray(0, 7)))
    // button 3 (wire 3) → button 4 (wire 0) → back to wire 3
    expect(writes).toEqual(['aa dd 05 40 00 01 00', 'aa dd 05 40 00 01 03'])
    expect(receiverOf(simulator).volume).toBe(3)
    await device.disconnect()
  })
})

// ------------------------------------------------------------------- developer option: forced profile

/** A real Lark M2 (mobile, PID 7) modelled by the simulator: same wire format as the 6501 group. */
function m2(opts: HollylandDeviceOptions = {}) {
  const receiver = new SimulatedReceiver({ family: '6301' })
  const transport = new MockTransport({ info: { vendorId: H, productId: 7 }, respond: receiver.respond })
  return { receiver, transport, opts: { ...FAST, ...opts } }
}

describe('developer option: force a 6501 profile on a connected legacy receiver', () => {
  it('lists the selectable profiles and parses ?profile=', () => {
    expect(LEGACY_PROFILES.map((p) => [p.id, p.productId, p.label])).toEqual([
      ['c1', 1, 'Lark C1'], ['c1g2', 11, 'Lark C1 (2nd gen)'], ['m1g2', 12, 'Lark M1 (2nd gen)'], ['mini', 13, 'Lark Mini'],
    ])
    expect(legacyProfile('mini')?.support).toMatchObject({ level: 'experimental', hardware: 'untested' })
    expect(profilesFor(row(7)).map((p) => p.id)).toEqual(['c1', 'c1g2', 'm1g2', 'mini'])
    expect(profilesFor(row(12)).map((p) => p.id)).toEqual(['c1', 'c1g2', 'mini'])
    expect(profilesFor(row(1038))).toEqual([]) // LARK M3: another framing
    expect(profileFromSearch('?profile=m1g2')).toEqual({ id: 'm1g2', allowWrites: false })
    expect(profileFromSearch('mock=a2&profile=c1&profileWrites=1')).toEqual({ id: 'c1', allowWrites: true })
    expect(profileFromSearch('?profile=nope')).toBeNull()
    expect(profileFromSearch('')).toBeNull()
    expect(forceProfileOptions(null)).toEqual({})
    expect(forceProfileOptions('c1g2')).toEqual({ forceProfile: { productId: 11, vendorId: H, allowWrites: false } })
    expect(forceProfileOptions(profileFromSearch('?profile=c1&profileWrites=1'))).toEqual({ forceProfile: { productId: 1, vendorId: H, allowWrites: true } })
  })

  it('M2 hardware driven as a Lark M1 (2nd gen): reads work, writes are refused and never sent (read-only by default)', async () => {
    const { receiver, transport, opts } = m2({ fetchIdentity: true, fetchSettings: true, ...forceProfileOptions('m1g2') })
    const device = new HollylandDevice(transport, opts)
    expect(device.product.productId).toBe(12)
    expect(device.actualProduct.productId).toBe(7)
    expect(device.readOnly).toBe(true)
    expect(device.state).toMatchObject({
      readOnly: true,
      forcedProfile: { profile: { productId: 12, name: 'Lark M1 (2nd gen)' }, actual: { productId: 7, name: 'Lark M2' }, readOnly: true },
    })
    const s = await device.connect()
    await settle(60)
    expect(s.rx).toBe('available')
    expect(device.state.units.rx.version).toBe('2.0.0.32')
    expect(device.state.settings).toMatchObject({ noiseLevel: 2, volume: 3, speakerPassthrough: false })
    const before = transport.sent.length
    await expect(device.setVolume(1)).rejects.toBeInstanceOf(ReadOnlyError)
    await expect(device.setNoiseLevel(1)).rejects.toBeInstanceOf(ReadOnlyError)
    await expect(device.setSpeakerPassthrough(true)).rejects.toBeInstanceOf(ReadOnlyError)
    await expect(device.sendRaw(encodeRequest(Requests.volumeSet(1)), { force: true })).rejects.toBeInstanceOf(ReadOnlyError)
    await expect(device.sendRaw(Uint8Array.of(0x55, 1, 2), { force: true })).rejects.toBeInstanceOf(ReadOnlyError)
    expect(transport.sent.length).toBe(before)
    for (const p of transport.sent) expect(COMMANDS[p[2]].safety, COMMANDS[p[2]].name).toBe('read')
    expect(receiver.volume).toBe(3)
    // reads still pass through sendRaw
    await device.sendRaw(encodeRequest(Requests.serial(Target.TX1)))
    await device.disconnect()
  })

  it('the Lark C1 profile on M2 hardware applies the C1 rules (link-only heartbeat, volume wire map)', async () => {
    const { receiver, transport, opts } = m2({ fetchSettings: true, ...forceProfileOptions('c1') })
    const mic = new LegacyMicDevice(transport, opts)
    expect(mic.family).toBe('6501')
    expect(mic.product.productId).toBe(1)
    await mic.connect()
    await settle()
    // 14-byte M2 heartbeat, but the C1 profile ignores its settings; 0x04 wire 3 → button 3 (index 2)
    expect(mic.legacy.state.heartbeat).toMatchObject({ payloadLength: 14 })
    expect(mic.state.values[CONTROL.VOLUME]).toBe(2)
    receiver.volume = 0
    await mic.legacy.refreshStatus()
    expect(mic.state.values[CONTROL.VOLUME]).toBe(2)
    // every write control is unavailable with reason read-only, and refused before anything is sent
    for (const c of mic.controls) expect(mic.state.availability[c.id], c.id).toMatchObject({ ok: false, reason: 'read-only' })
    expect(mic.state.availability[CONTROL.VOLUME]?.message).toMatch(/Lark C1 profile is forced on a Lark M2/)
    const n = transport.sent.length
    await expect(mic.set(CONTROL.VOLUME, 0)).rejects.toBeInstanceOf(ReadOnlyError)
    expect(transport.sent.length).toBe(n)
    await mic.disconnect()
  })

  it('allowWrites lets the profile write (here: the C1 wire map reaches the M2)', async () => {
    const { receiver, transport } = m2()
    const mic = createProfiledMicDevice(transport, 'c1', { ...FAST, allowWrites: true })
    expect(mic.legacy.readOnly).toBe(false)
    expect(mic.legacy.state.forcedProfile?.readOnly).toBe(false)
    await mic.connect()
    expect(await mic.set(CONTROL.VOLUME, 0)).toMatchObject({ ok: true, confirmed: true })
    expect(receiver.volume).toBe(5)
    await mic.disconnect()
    expect(() => createProfiledMicDevice(transport, 'nope')).toThrow(/available: c1, c1g2, m1g2, mini/)
  })

  it('refuses to force a legacy profile on a product with another framing; allows an unknown Hollyland PID', async () => {
    const m3 = new MockTransport({ info: { vendorId: H, productId: 1038 } })
    await expect(new HollylandDevice(m3, { ...FAST, ...forceProfileOptions('c1') }).connect()).rejects.toThrow(/does not speak the legacy AA DD protocol/)
    expect(m3.sent).toHaveLength(0)
    const receiver = new SimulatedReceiver({ family: '6501', productId: 12 })
    const unknown = new MockTransport({ info: { vendorId: H, productId: 0x7777 }, respond: receiver.respond })
    const d = new HollylandDevice(unknown, { ...FAST, ...forceProfileOptions('m1g2') })
    expect((await d.connect()).rx).toBe('available')
    expect(d.state.forcedProfile?.actual.name).toMatch(/Unknown Hollyland device/)
    await d.disconnect()
  })

  it('plain readOnly works without a profile; the default stays read-write (unchanged behaviour)', async () => {
    const ro = setup(1041, { readOnly: true })
    await ro.device.connect()
    await expect(ro.device.setLed(false)).rejects.toBeInstanceOf(ReadOnlyError)
    expect(ro.device.state.forcedProfile).toBeUndefined()
    await ro.device.disconnect()
    const rw = setup(1041)
    expect(rw.device.readOnly).toBe(false)
    expect(rw.device.state.readOnly).toBeUndefined()
    expect(rw.device.forcedProfile).toBeNull()
  })

  it('simulator profiles: 6-byte heartbeat for the C1, 0x16 = 3 for the Mini, M2 layout otherwise', () => {
    const c1 = new SimulatedReceiver({ family: '6501', productId: 1 })
    expect(c1.heartbeatPayload()).toEqual([1, 1, 85, 60, 0, 0])
    const mini = new SimulatedReceiver({ family: '6501', productId: 13 })
    expect(mini.respond(encodeRequest(Requests.deviceInfo()))[0][6]).toBe(3)
    expect(mini.heartbeatPayload()).toHaveLength(14)
    // The A2 / M2 simulators are unchanged.
    expect(new SimulatedReceiver().heartbeatPayload()).toHaveLength(16)
    expect(new SimulatedReceiver({ family: '6301' }).respond(encodeRequest(Requests.deviceInfo()))[0][6]).toBe(0)
    expect([...encodeResponse(Cmd.HEARTBEAT, Target.RX, c1.heartbeatPayload()).subarray(0, 12)]).toEqual([0xbb, 0xdd, 0x10, 0x80, 0, 6, 1, 1, 85, 60, 0, 0])
  })
})
