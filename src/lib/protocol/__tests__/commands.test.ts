import { describe, expect, it } from 'vitest'
import { encodeRequest, fromHex, toHex, Target } from '../codec'
import {
  ButtonFunction, Cmd, COMMANDS, CommandError, describePayload, isNewerVersionAndroid, isNewerVersionIos, isReadOnlyCommand,
  isVersionMissing, lastVersionComponent, parseButtonColors, parseDeviceInfo, parseFlagIsOne, parseHeartbeat6118, parseHeartbeatM2,
  parseNoiseLevelGet6118, parseNoiseLevelGetM2, parseNoiseSetM2, parseOtaAck, parseOtaResult, parseSerial, parseSetAck,
  parseSpeakerGet, parseVersion6118, parseVersionLegacy, parseVersionLegacy6118, parseVoiceLockSetReply, pickButtonSlot, Requests,
} from '../commands'

const wire = (f: ReturnType<(typeof Requests)[keyof typeof Requests]>) => {
  const p = encodeRequest(f)
  return toHex(p.subarray(0, 6 + (f.payload?.length ?? 0)))
}

describe('request builders -> wire bytes (Android Cmd*6118 encodeLegacyPayload)', () => {
  it.each([
    ['heartbeat', Requests.heartbeat(), 'aa dd 10 40 00 00'],
    ['version RX', Requests.version(), 'aa dd 41 40 00 00'],
    ['version TX2', Requests.version(Target.TX2), 'aa dd 41 42 00 00'],
    ['version for M2S', Requests.versionFor('6302', Target.TX1), 'aa dd 03 41 00 00'],
    ['serial TX1', Requests.serial(Target.TX1), 'aa dd 15 41 00 00'],
    ['device info', Requests.deviceInfo(), 'aa dd 16 40 00 00'],
    ['device id TX2', Requests.deviceId(Target.TX2), 'aa dd 08 42 00 01 02'],
    ['noise get', Requests.noiseLevelGet(), 'aa dd 11 40 00 00'],
    ['volume get', Requests.volumeGet(), 'aa dd 04 40 00 00'],
    ['speaker get', Requests.speakerGet(), 'aa dd 13 40 00 00'],
    ['mic recognition get', Requests.micRecognitionGet(), 'aa dd 3c 40 00 00'],
    ['smart battery get', Requests.smartBatteryGet(), 'aa dd 3e 40 00 00'],
    ['voice lock get', Requests.voiceLockGet(), 'aa dd 35 40 00 00'],
    ['button colors get', Requests.buttonColorsGet(), 'aa dd 38 40 00 00'],
    ['noise level 3', Requests.noiseLevelSet(3), 'aa dd 06 40 00 01 03'],
    ['noise toggle', Requests.noiseToggle(), 'aa dd 19 40 00 01 02'],
    ['volume 5', Requests.volumeSet(5), 'aa dd 05 40 00 01 05'],
    ['channel safety track', Requests.channelModeSet(2), 'aa dd 18 40 00 01 02'],
    ['preset Balance on', Requests.voicePresetSet(true, 2), 'aa dd 3a 40 00 02 01 02'],
    ['preset off', Requests.voicePresetSet(false, 0), 'aa dd 3a 40 00 02 00 00'],
    ['LED on (inverted)', Requests.ledSet(true), 'aa dd 39 40 00 01 00'],
    ['LED off (inverted)', Requests.ledSet(false), 'aa dd 39 40 00 01 01'],
    ['mic recognition on', Requests.micRecognitionSet(true), 'aa dd 3b 40 00 01 01'],
    ['smart battery off', Requests.smartBatterySet(false), 'aa dd 3d 40 00 01 00'],
    ['speaker on (inverted)', Requests.speakerSet(true), 'aa dd 12 40 00 01 00'],
    ['auto power-off enabled', Requests.autoOffSet(true), 'aa dd 36 40 00 01 00'],
    ['auto power-off never', Requests.autoOffSet(false), 'aa dd 36 40 00 01 01'],
    ['voice lock', Requests.voiceLockSet(true), 'aa dd 34 40 00 01 01'],
    ['custom button slot 2', Requests.buttonCustomSet({ index: 2, func: 3, keyOp: 6, tx1Color: 1, tx2Color: 2 }), 'aa dd 37 40 00 05 02 03 06 01 02'],
    ['custom button slot 1, colours not read yet', Requests.buttonCustomSet({ index: 1, func: 4, keyOp: 1, tx1Color: 0, tx2Color: 0 }), 'aa dd 37 40 00 05 01 04 01 00 00'],
    ['button colours only (sendColor)', Requests.buttonColorSet(2, 1), 'aa dd 37 40 00 05 00 00 00 02 01'],
    ['button slot 0 = colours only', Requests.buttonCustomSet({ index: 0, func: 0, keyOp: 0, tx1Color: 1, tx2Color: 2 }), 'aa dd 37 40 00 05 00 00 00 01 02'],
    ['OTA TX enter, Android 1-byte devId', Requests.otaTxEnter(1, [0x11]), 'aa dd 09 41 00 01 11'],
    ['OTA TX enter, iOS devId blob', Requests.otaTxEnter(2, [0x11, 0x22, 0x33]), 'aa dd 09 42 00 03 11 22 33'],
    ['OTA RX enter', Requests.otaRxEnter(), 'aa dd 0d 40 00 00'],
    ['restart RX', Requests.restartRx(), 'aa dd 0c 40 00 00'],
    ['remove pairing TX2', Requests.removePairing(2), 'aa dd 3f 40 00 01 02'],
    ['factory reset', Requests.factoryReset(), 'aa dd 40 40 00 00'],
  ])('%s', (_name, frame, expected) => {
    expect(wire(frame)).toBe(expected)
  })

  it('validates ranges', () => {
    expect(() => Requests.noiseLevelSet(4)).toThrow(CommandError)
    expect(() => Requests.noiseLevelSet(3, '6302')).toThrow(CommandError)
    expect(() => Requests.volumeSet(6)).toThrow(CommandError)
    expect(() => Requests.volumeSet(3, 2)).toThrow(CommandError)
    expect(() => Requests.channelModeSet(2, '6302')).toThrow(CommandError)
    expect(() => Requests.voicePresetSet(true, 3)).toThrow(CommandError)
    expect(() => Requests.removePairing(3 as 1)).toThrow(CommandError)
    // colour-only writes: complementary pairs only, function/key must be 0 (CustomFunctionActivity.sendColor)
    expect(() => Requests.buttonColorSet(1, 1)).toThrow(CommandError)
    expect(() => Requests.buttonColorSet(0, 2)).toThrow(CommandError)
    expect(() => Requests.buttonCustomSet({ index: 0, func: 2, keyOp: 0, tx1Color: 1, tx2Color: 2 })).toThrow(CommandError)
    expect(() => Requests.buttonCustomSet({ index: 3 as 1, func: 2, keyOp: 0, tx1Color: 1, tx2Color: 2 })).toThrow(CommandError)
    expect(() => Requests.otaTxEnter(1, [])).toThrow(CommandError)
  })

  it('picks the custom-button slot like CustomFunctionActivity (same function, else first empty)', () => {
    const slot = (a: number, b: number) => [{ func: a }, { func: b }]
    expect(pickButtonSlot(slot(0, 0), ButtonFunction.TX_IDENTIFY)).toBe(1)
    expect(pickButtonSlot(slot(2, 0), ButtonFunction.TX_IDENTIFY)).toBe(2)
    expect(pickButtonSlot(slot(2, 4), ButtonFunction.TX_IDENTIFY)).toBe(2)
    expect(pickButtonSlot(slot(2, 3), ButtonFunction.TX_IDENTIFY)).toBeNull()
    expect(pickButtonSlot([undefined, undefined], ButtonFunction.TX_MUTE_ALL)).toBe(1)
  })
})

describe('catalog', () => {
  it('marks safety classes', () => {
    expect(isReadOnlyCommand(Cmd.HEARTBEAT)).toBe(true)
    expect(isReadOnlyCommand(Cmd.VERSION_GET)).toBe(true)
    expect(isReadOnlyCommand(Cmd.VOLUME_SET)).toBe(false)
    expect(isReadOnlyCommand(Cmd.FACTORY_RESET)).toBe(false)
    expect(isReadOnlyCommand(0x99)).toBe(false)
    expect(COMMANDS[Cmd.FACTORY_RESET].safety).toBe('destructive')
    expect(COMMANDS[Cmd.REMOVE_PAIRING].safety).toBe('destructive')
    expect(COMMANDS[Cmd.RESTART_RX].safety).toBe('disruptive')
    expect(COMMANDS[Cmd.OTA_RX_ENTER].safety).toBe('ota')
    expect(COMMANDS[Cmd.NOISE_TOGGLE].toggle).toBe(true)
    expect(COMMANDS[Cmd.NOISE_TOGGLE].retrySafe).toBe(false)
  })
  it('every entry is keyed by its id', () => {
    for (const [k, v] of Object.entries(COMMANDS)) expect(Number(k)).toBe(v.id)
  })
})

describe('heartbeat parsers', () => {
  it('6118 (CmdGetHeart6118.decodeLegacyPayload)', () => {
    // body from docs/research/android-protocol.md §7 (illustrative values)
    const hb = parseHeartbeat6118(fromHex('01 01 55 3c 00 00 02 03 00 01 00 00 00 00 03 04 00'))
    expect(hb.tx[0]).toEqual({ online: true, battery: 85, muted: false, charging: true })
    expect(hb.tx[1]).toEqual({ online: true, battery: 60, muted: false, charging: false })
    expect(hb.noiseLevel).toBe(2)
    expect(hb.noiseEnabled).toBe(true)
    expect(hb.volume).toBe(3)
    expect(hb.channelMode).toBe(1)
    expect(hb.autoPowerOff).toBe(true)
    expect(hb.ledOn).toBe(true)
    expect(hb.voicePreset).toEqual({ enabled: true, preset: 1 })
    expect(hb.rxCamera).toEqual({ battery: 0, charging: false })
  })

  it('6118 flags, LED off, auto-off disabled, camera RX', () => {
    const hb = parseHeartbeat6118(fromHex('01 00 64 00 aa bb 00 05 cc 02 01 dd ee 01 04 1b 32 99'))
    expect(hb.tx[0].muted).toBe(true)
    expect(hb.tx[1].muted).toBe(true)
    expect(hb.tx[1].charging).toBe(true)
    expect(hb.tx[0].charging).toBe(false)
    expect(hb.tx[1].online).toBe(false)
    expect(hb.noiseEnabled).toBe(false)
    expect(hb.channelMode).toBe(2)
    expect(hb.autoPowerOff).toBe(false)
    expect(hb.ledOn).toBe(false)
    expect(hb.voicePreset).toEqual({ enabled: false, preset: 2 })
    expect(hb.rxCamera).toEqual({ battery: 50, charging: true })
    expect(hb.unknown).toEqual({ 4: 0xaa, 5: 0xbb, 8: 0xcc, 11: 0xdd, 12: 0xee, 17: 0x99 })
  })

  it('6118 short payload reads missing bytes as 0 but flags them invalid (iOS HLHeartEntity validation)', () => {
    const hb = parseHeartbeat6118(fromHex('01'))
    expect(hb.tx[0].online).toBe(true)
    expect(hb.ledOn).toBe(true)
    expect(hb.payloadLength).toBe(1)
    expect(hb.valid).toMatchObject({ noise: false, volume: false, channelMode: false, led: false, flags: false })
    const live = parseHeartbeat6118(fromHex('01 01 5b 5c 00 00 00 05 00 00 00 00 00 00 04 00')) // live A2, LEN 16
    expect(live.valid).toMatchObject({ noise: true, volume: true, led: true, voicePreset: true, flags: true, rxBattery: false })
    expect(parseHeartbeat6118(fromHex('01 01 5b 5c 00 00 07 05')).valid.noise).toBe(false) // isHeartbeatNoiseLevelValid: < 4
    expect(live.lockByte).toBe(0)
  })

  it('M2/M2S (Pro_get_heart.receiveData)', () => {
    const hb = parseHeartbeatM2(fromHex('01 01 50 46 ff fe 01 04 01 00 01 21 34 01'), '6302')
    expect(hb.tx[0].battery).toBe(80)
    expect(hb.uv).toBe(-1 * 256 + -2)
    expect(hb.noiseLevel).toBe(1)
    expect(hb.volume).toBe(4)
    expect(hb.voiceLocked).toBe(true)
    expect(hb.channelMode).toBe(0)
    expect(hb.autoPowerOff).toBe(false)
    expect(hb.buttons).toEqual([{ func: 2, keyOp: 1 }, { func: 3, keyOp: 4 }])
    expect(hb.ledOn).toBe(false)
  })

  it('M2/M2S never decode body[15] as mute/charge (iOS applies those only when isConnect6118Device)', () => {
    const hb = parseHeartbeatM2(fromHex('01 01 50 46 00 00 01 04 01 00 01 21 34 01 00 0f'), '6301')
    expect(hb.tx[0].muted).toBeUndefined()
    expect(hb.tx[1].charging).toBeUndefined()
    expect(hb.unknown).toEqual({ 14: 0, 15: 0x0f })
  })

  it('M2 short heartbeat leaves later fields undefined', () => {
    const hb = parseHeartbeatM2(fromHex('01 00 50 00 00 00 02'), '6301')
    expect(hb.noiseLevel).toBe(2)
    expect(hb.volume).toBeUndefined()
    expect(hb.ledOn).toBeUndefined()
  })
})

describe('other parsers', () => {
  it('version 0x41: "b0.b1.b2.b3b4b5" (formatSixByteDeviceVersion)', () => {
    expect(parseVersion6118(fromHex('01 02 03 04 05 06'))).toBe('1.2.3.456')
    expect(parseVersion6118(fromHex('01 00 0a 00 01 09 ff'))).toBe('1.0.10.019')
    expect(parseVersion6118(fromHex('01 02 03'))).toBe('')
  })
  it('legacy version 0x03', () => {
    expect(parseVersionLegacy(fromHex('02 00 00 09'))).toBe('2.0.0.9')
    expect(parseVersionLegacy6118(fromHex('02 00 00 09'))).toBe('2.0.0.009')
  })
  it('serial 6118: US-ASCII up to NUL, trimmed (asciiString); >= 0x80 is U+FFFD, not masked', () => {
    expect(parseSerial(fromHex('52 58 53 45 52 49 41 4c 30 30 31 42 00 00 41'))).toBe('RXSERIAL001B')
    expect(parseSerial(fromHex('20 41 42 20'))).toBe('AB')
    expect(parseSerial(fromHex('41 c1 42'))).toBe('A\ufffdB')
  })
  it('serial M2/M2S: whole payload as UTF-8 (Pro_get_sn), NULs removed (iOS), no trim', () => {
    expect(parseSerial(fromHex('41 42 00 43 20'), '6302')).toBe('ABC ')
    expect(parseSerial(fromHex('c3 a9'), '6301')).toBe('\u00e9')
  })
  it('version helpers (isVersionMissing / Util.isNewVersion / NSNumericSearch)', () => {
    expect(['', '0.0.0.0', '0.0.0.000', undefined].map(isVersionMissing)).toEqual([true, true, true, true])
    expect(isVersionMissing('3.0.2.008')).toBe(false)
    expect(parseVersion6118(fromHex('00 00 00 00 00 00'))).toBe('0.0.0.000')
    expect(isNewerVersionAndroid('2.0.0.32', '2.0.0.31')).toBe(true)
    expect(isNewerVersionAndroid('2.0.0.31', '2.0.0.31')).toBe(false)
    expect(isNewerVersionAndroid('2.0.1.0', '2.0.0.31')).toBe(true)
    expect(isNewerVersionAndroid('2.1', '2.0.0.9')).toBe(false) // needs >= 4 parts
    expect(isNewerVersionIos('2.0.0.10', '2.0.0.9')).toBe(true)
    expect(isNewerVersionIos('2.0.0.9', '2.0.0.9')).toBe(false)
    expect(lastVersionComponent('2.0.1.5')).toBe(5)
    expect(lastVersionComponent('2.0.0.32')).toBe(32)
  })
  it('noise get: 6118 decoded both ways (Android bit7 vs iOS raw), M2 signed level', () => {
    expect(parseNoiseLevelGet6118(fromHex('82'))).toMatchObject({ enabled: true, level: 2, raw: 0x82, ios: { enabled: true, level: 0x82 }, agree: false })
    expect(parseNoiseLevelGet6118(fromHex('02'))).toMatchObject({ enabled: false, level: 0, raw: 0x02, ios: { enabled: true, level: 2 }, agree: false })
    expect(parseNoiseLevelGet6118(fromHex('00'))).toMatchObject({ enabled: false, level: 0, agree: true }) // live A2 reply, NC off
    expect(parseNoiseLevelGet6118(fromHex('87')).level).toBe(3)
    expect(parseNoiseLevelGetM2(fromHex('02'))).toEqual({ enabled: true, level: 2, raw: 2 })
  })
  it('M2 noise-set reply needs [status, level] (Pro_set_noise.receiveData)', () => {
    expect(parseNoiseSetM2(fromHex('01 02'))).toEqual({ ok: true, level: 2 })
    expect(parseNoiseSetM2(fromHex('01'))).toEqual({ ok: false, level: undefined })
  })
  it('voice-lock reply: M2S set-ack, Lark M2 either ack or new state', () => {
    expect(parseVoiceLockSetReply(fromHex('01'), '6302', false).ok).toBe(true)
    expect(parseVoiceLockSetReply(fromHex('00'), '6302', false).ok).toBe(false)
    expect(parseVoiceLockSetReply(fromHex('00'), '6301', false).ok).toBe(true) // iOS: state = unlocked
    expect(parseVoiceLockSetReply(fromHex('01'), '6301', false).ok).toBe(true) // Android: ack
    expect(parseVoiceLockSetReply(fromHex('00'), '6301', true).ok).toBe(false)
    expect(parseVoiceLockSetReply(new Uint8Array(0), '6301', true)).toEqual({ ok: false, code: null })
  })
  it('flags and acks', () => {
    expect(parseSpeakerGet(fromHex('00'))).toBe(true)
    expect(parseSpeakerGet(fromHex('01'))).toBe(false)
    expect(parseSpeakerGet(new Uint8Array(0))).toBe(false)
    expect(parseFlagIsOne(fromHex('01'))).toBe(true)
    expect(parseFlagIsOne(fromHex('02'))).toBe(false)
    expect(parseSetAck(fromHex('01'))).toEqual({ ok: true, code: 1 })
    expect(parseSetAck(fromHex('00'))).toEqual({ ok: false, code: 0 })
    expect(parseSetAck(new Uint8Array(0))).toEqual({ ok: false, code: null })
  })
  it('device info / button colors / OTA ack', () => {
    expect(parseDeviceInfo(fromHex('02')).cameraRx).toBe(true)
    expect(parseDeviceInfo(fromHex('01')).cameraRx).toBe(false)
    // Lark M2 (type 3): camera only when the LEN low byte is > 8 (resolveDeviceHeaderImageWithPayload @0x1000bda18)
    expect(parseDeviceInfo(fromHex('02 00 00'), '6301').cameraRx).toBe(false)
    expect(parseDeviceInfo(fromHex('02 00 00 06 01 01 5b 5c 00'), '6301').cameraRx).toBe(true)
    expect(parseDeviceInfo(fromHex('02'), '6302').cameraRx).toBe(true)
    expect(parseButtonColors(fromHex('01 02'))).toEqual({ tx1: 1, tx2: 2 })
    expect(parseOtaAck(fromHex('01 00 05'))).toEqual({ ok: true, needCount: 5, hasNeedCount: true })
    expect(parseOtaAck(fromHex('00 01 00'))).toEqual({ ok: false, needCount: 256, hasNeedCount: true })
    expect(parseOtaAck(fromHex('00'))).toEqual({ ok: false, needCount: 0, hasNeedCount: false }) // iOS reads b0 only
    expect(parseOtaResult(fromHex('01'))).toEqual({ ok: true, code: 1 })
  })
  it('describePayload renders a summary', () => {
    expect(describePayload(Cmd.VERSION_GET, 'response', fromHex('01 02 03 04 05 06'))).toBe('VERSION_GET "1.2.3.456"')
    expect(describePayload(Cmd.VOLUME_SET, 'response', fromHex('01'))).toContain('"ok":true')
    expect(describePayload(Cmd.NOISE_TOGGLE, 'request', fromHex('02'))).toBe('NOISE_TOGGLE [0x02]')
  })
})
