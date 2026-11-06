/**
 * MELO P1 payload layouts: the 31-byte heartbeat, the 20-byte device info, VU levels and the More Settings /
 * mixer structs. Payloads are little-endian (A ByteBuffer.order(LITTLE_ENDIAN) in every
 * protocol/core/sound/data/*Serializer and *ExtKt class); booleans are one byte read as `get() == 1`.
 * Paths are relative to com/hollyland/ in the Android 3.1.0 decompile; melo-6201.md §4.3, §5.2–§5.4.
 */
import { ByteWriter, f32, i16, i32 } from '../../core/bytes'

const bool = (b: Uint8Array, i: number) => b[i] === 1

// ---------------------------------------------------------------------------------- heartbeat

/** A protocol/core/sound/data/HLSoundHeartEntity, field order of HLSoundHeartEntitySerializer.deserialize. */
export interface MeloHeartbeat {
  rxPower: number
  boxPower: number
  mic1Power: number
  mic2Power: number
  mic1Charge: boolean
  mic2Charge: boolean
  mic1Online: boolean
  mic2Online: boolean
  /** A DeviceControlConstant.MicSamplingType: 0 = 24-bit, 1 = 32-bit. */
  mic1SamDepth: number
  mic2SamDepth: number
  /** Something is plugged into the 3.5 mm jack. */
  conn35Online: boolean
  /** The jack is set to output (A Audio35PortDirection OUTPUT = 1), else input (instrument). */
  conn35DirOut: boolean
  /**
   * Android field name `owsOnline`. The mixer page enables the BGM (accompaniment) fader with it
   * (A larkc1/c6201/widget/view/HLVolumeListView.updateTrackVolumeInputStatus, track 3), while the 2.4 G monitor
   * output follows `earConnectState`; so it probably flags the Bluetooth backing-track source [I], not the
   * earphones as melo-6201.md §4.3 reads it.
   */
  owsOnline: boolean
  rxOutSwitch: boolean
  rxSamDepth: number
  rxMicLock: number
  /** Not used by the Android app (NC is read with 0x1301). */
  rxNoiseSwitch: boolean
  rxNoiseMode: number
  rxGainSwitch: boolean
  rxGainMode: number
  rxGainL: number
  rxGainR: number
  earLPower: number
  earLCharge: boolean
  earRPower: number
  earRCharge: boolean
  /** A DeviceControlConstant.HeartBleEarConnectState: 0 none, 1 left, 2 right, 3 both. */
  earConnectState: number
  micTypeRaw: number
  /** bits 0–1 (A HLSoundHeartEntity.getMic1Type). Meanings [?]. */
  mic1Type: number
  /** bits 2–3 (getMic2Type). */
  mic2Type: number
  musicStyle2Evt: number
  rcConnState: boolean
  rcIsLowVabt: boolean
  /** Payload length as received (31; longer payloads are accepted, extra bytes ignored). */
  length: number
}

export const MELO_HEARTBEAT_LENGTH = 31

/**
 * A HLSoundHeartEntitySerializer.deserialize: 31 sequential `get()`s; a shorter payload throws
 * (BufferUnderflowException → Result.failure in CmdGetHeart6201), so the heartbeat is all or nothing. Java bytes
 * are signed; battery percentages fit 0..127, so they are read unsigned here.
 */
export function parseMeloHeartbeat(p: Uint8Array): MeloHeartbeat | null {
  if (p.length < MELO_HEARTBEAT_LENGTH) return null
  return {
    rxPower: p[0], boxPower: p[1], mic1Power: p[2], mic2Power: p[3],
    mic1Charge: bool(p, 4), mic2Charge: bool(p, 5), mic1Online: bool(p, 6), mic2Online: bool(p, 7),
    mic1SamDepth: p[8], mic2SamDepth: p[9],
    conn35Online: bool(p, 10), conn35DirOut: bool(p, 11), owsOnline: bool(p, 12), rxOutSwitch: bool(p, 13),
    rxSamDepth: p[14], rxMicLock: p[15], rxNoiseSwitch: bool(p, 16), rxNoiseMode: p[17],
    rxGainSwitch: bool(p, 18), rxGainMode: p[19], rxGainL: p[20], rxGainR: p[21],
    earLPower: p[22], earLCharge: bool(p, 23), earRPower: p[24], earRCharge: bool(p, 25),
    earConnectState: p[26], micTypeRaw: p[27], mic1Type: p[27] & 3, mic2Type: (p[27] >> 2) & 3,
    musicStyle2Evt: p[28], rcConnState: bool(p, 29), rcIsLowVabt: bool(p, 30),
    length: p.length,
  }
}

/** Inverse of parseMeloHeartbeat (simulator). */
export function encodeMeloHeartbeat(h: Omit<MeloHeartbeat, 'length' | 'mic1Type' | 'mic2Type'>): Uint8Array {
  const b = (v: boolean) => (v ? 1 : 0)
  return Uint8Array.from([
    h.rxPower, h.boxPower, h.mic1Power, h.mic2Power, b(h.mic1Charge), b(h.mic2Charge), b(h.mic1Online), b(h.mic2Online),
    h.mic1SamDepth, h.mic2SamDepth, b(h.conn35Online), b(h.conn35DirOut), b(h.owsOnline), b(h.rxOutSwitch),
    h.rxSamDepth, h.rxMicLock, b(h.rxNoiseSwitch), h.rxNoiseMode, b(h.rxGainSwitch), h.rxGainMode, h.rxGainL, h.rxGainR,
    h.earLPower, b(h.earLCharge), h.earRPower, b(h.earRCharge), h.earConnectState, h.micTypeRaw, h.musicStyle2Evt,
    b(h.rcConnState), b(h.rcIsLowVabt),
  ])
}

// -------------------------------------------------------------------------------- device info

/** A protocol/core/sound/data/HLSoundDeviceInfoEntity. */
export interface MeloDeviceInfo {
  deviceType: number
  serial: string
  swVersion: string
  hwVersion: string
}

export const MELO_DEVICE_INFO_LENGTH = 20

/** A NumberUtil.bytesToAsciiString: drops 0x00 and 0xFF bytes. */
function snOf(b: Uint8Array): string {
  let s = ''
  for (const x of b) if (x !== 0 && x !== 0xff) s += String.fromCharCode(x)
  return s
}

/** A NumberUtil.bytesToDecimalString(bytes, ".", littleEndian = true): bytes reversed, decimal, dot-joined. */
function versionOf(b: Uint8Array): string {
  return Array.from(b).reverse().join('.')
}

/**
 * A CmdGetDeviceInfo6201.decodePayload: `[0]` type, `[1..11]` SN, `[12..15]` SW version and `[16..19]` HW version,
 * each version byte-reversed ("d c b a" → "a.b.c.d"). Under 20 bytes the app keeps type 0 and empty strings,
 * which Protocol6201SessionState.onDeviceInfoDecoded ignores (blank version): null here.
 */
export function parseMeloDeviceInfo(p: Uint8Array): MeloDeviceInfo | null {
  if (p.length < MELO_DEVICE_INFO_LENGTH) return null
  return { deviceType: p[0], serial: snOf(p.subarray(1, 12)), swVersion: versionOf(p.subarray(12, 16)), hwVersion: versionOf(p.subarray(16, 20)) }
}

/** Inverse of parseMeloDeviceInfo (simulator). */
export function encodeMeloDeviceInfo(i: MeloDeviceInfo): Uint8Array {
  const v = (s: string) => {
    const parts = s.split('.').map((x) => parseInt(x, 10) & 0xff)
    while (parts.length < 4) parts.push(0)
    return parts.slice(0, 4).reverse()
  }
  return new ByteWriter().u8(i.deviceType).ascii(i.serial, 11).bytes(v(i.swVersion)).bytes(v(i.hwVersion)).toBytes()
}

// ----------------------------------------------------------------------------------------- VU

/** A data/HLSoundChainInputVU (voice1, voice2, inst, acc1, acc2), i16 LE, dB (A sound/ui_component/equalizer/AudioLevelView: minLevel −60). */
export interface MeloInputLevels {
  mic1: number
  mic2: number
  instrument: number
  bgmL: number
  bgmR: number
}

/** A data/HLSoundChainOutputVU (masterUac L/R, slaveUac L/R, dac L/R, owsUac L/R), i16 LE, dB. */
export interface MeloOutputLevels {
  usbL: number
  usbR: number
  usb2L: number
  usb2R: number
  wiredL: number
  wiredR: number
  wirelessL: number
  wirelessR: number
}

export interface MeloLevels {
  inputs?: MeloInputLevels
  outputs?: MeloOutputLevels
  /** Command the levels came from (0x11EB both, 0x11E1 inputs, 0x11E9 outputs). */
  cmd: number
  /** Host time the push arrived. */
  at: number
}

export const MELO_VU_INPUT_BYTES = 10
export const MELO_VU_OUTPUT_BYTES = 16

export function parseMeloInputLevels(p: Uint8Array, off = 0): MeloInputLevels | null {
  if (p.length < off + MELO_VU_INPUT_BYTES) return null
  const r = (i: number) => i16(p, off + i * 2)!
  return { mic1: r(0), mic2: r(1), instrument: r(2), bgmL: r(3), bgmR: r(4) }
}

export function parseMeloOutputLevels(p: Uint8Array, off = 0): MeloOutputLevels | null {
  if (p.length < off + MELO_VU_OUTPUT_BYTES) return null
  const r = (i: number) => i16(p, off + i * 2)!
  return { usbL: r(0), usbR: r(1), usb2L: r(2), usb2R: r(3), wiredL: r(4), wiredR: r(5), wirelessL: r(6), wirelessR: r(7) }
}

/** A HLSoundChainInputAndOutputVUSerializer: inputs (10 B) then outputs (16 B). */
export function parseMeloAllLevels(p: Uint8Array): { inputs: MeloInputLevels; outputs: MeloOutputLevels } | null {
  const inputs = parseMeloInputLevels(p, 0)
  const outputs = parseMeloOutputLevels(p, MELO_VU_INPUT_BYTES)
  return inputs && outputs ? { inputs, outputs } : null
}

export function encodeMeloAllLevels(inputs: MeloInputLevels, outputs: MeloOutputLevels): Uint8Array {
  const w = new ByteWriter()
  for (const v of [inputs.mic1, inputs.mic2, inputs.instrument, inputs.bgmL, inputs.bgmR]) w.i16(v)
  for (const v of [outputs.usbL, outputs.usbR, outputs.usb2L, outputs.usb2R, outputs.wiredL, outputs.wiredR, outputs.wirelessL, outputs.wirelessR]) w.i16(v)
  return w.toBytes()
}

// ------------------------------------------------------------------------------ mixer structs

/**
 * 0x130A / 0x130B: A data/HLAudioInVoiceEntity = trackVol[5], trackMute[5], trackSolo[5] (signed bytes,
 * HLAudioInVoiceEntitySerializer / HLAudioInVoiceEntityExtKt, 15 bytes). Track order from the mixer page
 * (A larkc1/c6201/widget/view/HLVolumeListView.updateTrackVolumeInputStatus): 0 mic 1, 1 mic 2, 2 instrument
 * (3.5 mm in), 3 BGM; 4 is the effect volume, which the page writes back unchanged (HLVolumeListViewKt.getEffectVolume).
 * Mute 1 = muted (A DeviceControlConstant.TrackStreamInMuteStatus OPEN = 1 when the mute key is selected); the page
 * always writes mute[4] = 0 and keeps solo as read.
 */
export interface MeloStreamIn {
  vol: number[]
  mute: number[]
  solo: number[]
}

export const MELO_STREAM_IN_BYTES = 15

const s8 = (x: number) => (x << 24) >> 24

export function parseMeloStreamIn(p: Uint8Array): MeloStreamIn | null {
  if (p.length < MELO_STREAM_IN_BYTES) return null
  const r = (o: number) => Array.from(p.subarray(o, o + 5), s8)
  return { vol: r(0), mute: r(5), solo: r(10) }
}

export function encodeMeloStreamIn(s: MeloStreamIn): Uint8Array {
  const out = new Uint8Array(MELO_STREAM_IN_BYTES)
  for (let i = 0; i < 5; i++) {
    out[i] = (s.vol[i] ?? 0) & 0xff
    out[5 + i] = (s.mute[i] ?? 0) & 0xff
    out[10 + i] = (s.solo[i] ?? 0) & 0xff
  }
  return out
}

/**
 * 0x1308 / 0x1309: A data/HLAudioOutVoiceEntity = owsVol, owsMute, conn35OutVol, conn35OutMute, uacUpstreamVol,
 * uacUpstreamMute (6 signed bytes, HLAudioOutVoiceEntitySerializer). Mute 1 = muted
 * (A DeviceControlConstant.TrackStreamOutMuteStatus MUTE = 1).
 */
export interface MeloStreamOut {
  owsVol: number
  owsMute: number
  conn35OutVol: number
  conn35OutMute: number
  uacUpstreamVol: number
  uacUpstreamMute: number
}

export const MELO_STREAM_OUT_BYTES = 6

export function parseMeloStreamOut(p: Uint8Array): MeloStreamOut | null {
  if (p.length < MELO_STREAM_OUT_BYTES) return null
  return {
    owsVol: s8(p[0]), owsMute: s8(p[1]), conn35OutVol: s8(p[2]), conn35OutMute: s8(p[3]), uacUpstreamVol: s8(p[4]), uacUpstreamMute: s8(p[5]),
  }
}

export function encodeMeloStreamOut(s: MeloStreamOut): Uint8Array {
  return Uint8Array.from([s.owsVol, s.owsMute, s.conn35OutVol, s.conn35OutMute, s.uacUpstreamVol, s.uacUpstreamMute].map((x) => x & 0xff))
}

/** One LED group of 0x3004 / the 0x2000 payload (A data/HLLEDStatusEntity: ledSwitch, ledDeviceType, ledBrightness). */
export interface MeloLed {
  on: boolean
  device: number
  /** A DeviceControlConstant.LedStatus: 0 ZERO, 1 FIFTY, 2 ONE_HUNDRED. */
  brightness: number
}

/** A CmdGetLed6201.decodePayload: groups of 3 bytes, `switch != 0`. */
export function parseMeloLeds(p: Uint8Array): MeloLed[] {
  const out: MeloLed[] = []
  for (let i = 0; i + 2 < p.length; i += 3) out.push({ on: p[i] !== 0, device: p[i + 1], brightness: p[i + 2] })
  return out
}

/** A HLLEDStatusEntityExtKt.cmdSerialize: [switch ? 1 : 0, ledDeviceType, ledBrightness]. */
export function encodeMeloLed(l: MeloLed): Uint8Array {
  return Uint8Array.from([l.on ? 1 : 0, l.device & 0xff, l.brightness & 0xff])
}

/** i32 LE payload (A data/SingleRadioData, HLAudioUACMicGainSupEntity, HLWorkModeEntity). */
export function parseMeloI32(p: Uint8Array): number | null {
  return p.length >= 4 ? i32(p, 0)! : null
}

export function encodeMeloI32(v: number): Uint8Array {
  return new ByteWriter().i32(v).toBytes()
}

/** 0x1319 / 0x131A: A data/HLIndependentTxGainEntity (i32 tx1Gain, i32 tx2Gain). */
export function parseMeloTxGains(p: Uint8Array): [number, number] | null {
  return p.length >= 8 ? [i32(p, 0)!, i32(p, 4)!] : null
}

export function encodeMeloTxGains(tx1: number, tx2: number): Uint8Array {
  return new ByteWriter().i32(tx1).i32(tx2).toBytes()
}

/** 0x1304 / 0x1305: A data/HLAudioUACBitEntity (tx1UacBit, tx2UacBit, rxMUacBit, rxSUacBit), 0 = 24-bit, 1 = 32-bit. */
export interface MeloBitDepths {
  tx1: number
  tx2: number
  rxMaster: number
  rxSlave: number
}

export function parseMeloBitDepths(p: Uint8Array): MeloBitDepths | null {
  return p.length >= 4 ? { tx1: p[0], tx2: p[1], rxMaster: p[2], rxSlave: p[3] } : null
}

export function encodeMeloBitDepths(b: MeloBitDepths): Uint8Array {
  return Uint8Array.from([b.tx1, b.tx2, b.rxMaster, b.rxSlave].map((x) => x & 0xff))
}

/**
 * 0x1142 / 0x1143: A data/HlAudioNoiseGateParamSetEntity = HLSoundParamEntity (u8 paramChange, u8 enable,
 * u8 streamType, u8 algoIndex) + f32 threshold + i32 attack + i32 release + f32 floor (20 bytes).
 */
export interface MeloNoiseGate {
  paramChange: number
  enable: boolean
  streamType: number
  algoIndex: number
  threshold: number
  attack: number
  release: number
  floor: number
}

export const MELO_NOISE_GATE_BYTES = 20

export function parseMeloNoiseGate(p: Uint8Array): MeloNoiseGate | null {
  if (p.length < MELO_NOISE_GATE_BYTES) return null
  return {
    paramChange: p[0], enable: p[1] !== 0, streamType: p[2], algoIndex: p[3],
    threshold: f32(p, 4)!, attack: i32(p, 8)!, release: i32(p, 12)!, floor: f32(p, 16)!,
  }
}

export function encodeMeloNoiseGate(g: MeloNoiseGate): Uint8Array {
  return new ByteWriter()
    .u8(g.paramChange).u8(g.enable ? 1 : 0).u8(g.streamType).u8(g.algoIndex)
    .f32(g.threshold).i32(g.attack).i32(g.release).f32(g.floor)
    .toBytes()
}

/**
 * The noise gate SET as the More Settings page sends it: paramChange 1, the switch, stream type 2 (instrument,
 * A AudioStreamType.TYPE_INS), algo 0, the threshold, and attack / release / floor left at the entity defaults
 * 0 / 0 / 0.0 (A MoreSettingActivity: `new HlAudioNoiseGateParamSetEntity(new HLSoundParamEntity(1, state,
 * TYPE_INS, 0), threshold, 0, 0, 0.0f, 28, null)`).
 */
export function meloNoiseGateSetPayload(enable: boolean, threshold: number): Uint8Array {
  return encodeMeloNoiseGate({ paramChange: 1, enable, streamType: 2, algoIndex: 0, threshold, attack: 0, release: 0, floor: 0 })
}
