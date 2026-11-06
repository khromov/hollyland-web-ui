/**
 * LARK MAX 2 status decoding: heartbeat 0x600B, unit version 0x600A, BLE pushes 0x6000–0x6002 and the per-setting
 * items (GET replies and the "get all" composite). Byte offsets are payload offsets (item start + 5, A
 * BleMicCommUtil.payloadOffset). docs/research/families/max2-6701.md §4.2, §4.3, §5.
 *
 * Android and iOS agree on the heartbeat byte for byte (A BleMicCommUtil.generateHeartInfo → MicDeviceInfo
 * .HeartInfoResponse; I -[HLBleHeartEntity initEntityWithData:] @0x1001fb0ac). Android reads payload bytes 0..32
 * unconditionally and 33..48 only when the item length is ≥ 34 (`iByte2ToUnsignedShort >= 34`), so the short
 * (33-byte) heartbeat is the base layout and the 49-byte one adds wireless monitoring, live timecode, mic 3/4 and the
 * 4 Mic & 1 RX flag.
 */
import { MOMA_TYPE } from '../../moma/codec'
import { MAX2_CHARGING, MAX2_VERSION_UNIT_OF, type Max2VersionUnit } from './commands'

/** Base heartbeat length (A generateHeartInfo reads cmdStartPosition + 5 … + 37 without a length check). */
export const MAX2_HEARTBEAT_BASE_LENGTH = 33
/** Full heartbeat (bytes 33..48 when len ≥ 34). */
export const MAX2_HEARTBEAT_FULL_LENGTH = 49
/** 0x600A reply: unit, online, SN 16, version 16, battery, hw version 16, chargeStatus (A generateDeviceVersionInfo). */
export const MAX2_VERSION_REPLY_LENGTH = 52

export interface Max2MicStatus {
  battery: number
  charging: boolean
  online: boolean
  /** 0..40 = −20..+20 dB. */
  gain: number
  /** Remaining internal-recording time, unit [?] (A HLBleDeviceActivity.remainTxRecordTime). */
  remainRecordTime: number
}

export interface Max2EarStatus {
  battery: number
  charging: boolean
}

/** Decoded 0x600B payload (field names from A MicDeviceInfo.HeartInfoResponse). */
export interface Max2Heartbeat {
  length: number
  /** byte 0 */ rxBattery: number
  /** byte 1 */ boxBattery: number
  /** bytes 2..7, 15/16, 30/31; 39..46, 37/38, 45/46 for mic 3/4 (len ≥ 34). */
  mics: Max2MicStatus[]
  /** byte 8 outSwitchStatus: "Phone Speaker" 1 = on. */ speaker: boolean
  /** byte 9 sampleDepth: 0 = 32-bit float, 1 = 24-bit. */ sampleDepth: number
  /** byte 10 micLockStatus. */ micLock: boolean
  /** byte 11 noiseSwitchStatus. */ noiseOn: boolean
  /** byte 12 noiseMode: depth index 0..20. */ noiseDepth: number
  /** byte 13 gainSwitchStatus: 0 custom, 1 dynamic. */ gainType: number
  /** byte 14 gainMode: 0 High, 1 Medium, 2 Low. */ gainLevel: number
  /** byte 17 voiceMode: 0 mono, 1 stereo, 2 safety track. */ channelMode: number
  /**
   * byte 18 deviceType, raw. Android decodes it (generateHeartInfo → HeartInfoResponse.deviceType) and never reads it;
   * iOS takes 2 as the camera RX: +[HLBleHeartEntity initEntityWithData:] @0x1001fb5e4–0x1001fb614 (offset 0x12 →
   * coverDecimalismData: → `cmp x0, #0x2; cset w2, eq` → setIsCamera:), the same numbers as the RX identifiers
   * (BleMicCmd: 1026 mobile → 1, 1027 camera → 2).
   */
  deviceType: number
  /** deviceType === 2 (iOS). Through the BOX it decides camera vs phone RX (I -[HLLarkMAX2View updateDeviceHeartInfo:]). */
  isCamera: boolean
  /** byte 19 recordIsOpen: TX internal recording on. */ recording: boolean
  /** byte 20 tcMode 0..2. */ tcMode: number
  /** byte 21 inputFps 0..8. */ inputFps: number
  /** byte 22 timingMode 0..2. */ timingMode: number
  /** bytes 23..26 */ earL: Max2EarStatus
  earR: Max2EarStatus
  /** byte 27 earConnectStatus: 0 none, 1 L, 2 R, 3 both. */ earConnect: number
  /** byte 28 txIdentifyIsOpen ("Mic Recognition"). */ txIdentify: boolean
  /** byte 29 tcModeSettingStatus ("Timecode switch"). */ tcEnabled: boolean
  /** byte 32 resetTiming. */ resetTiming: boolean
  /** Bytes 33..48, present when len ≥ 34. */
  extended?: {
    /** byte 33 isWirelessMonitor (raw; 1 = on: A WirelessMonitorActivity compares with Status.FAIL_CLOSE(1)). iOS also reads tcTimeHour here. */
    wireless: number
    /** bytes 34..36 tcTiming min, sec, frame. */
    tcTime: { min: number; sec: number; frame: number }
    /** byte 47 micFourRxOneMode. */
    fourMic: boolean
    /** byte 48 earMonitorStatus: 1 = playing (A WirelessMonitorActivity.updateEarMonitorState). */
    earMonitor: number
  }
}

/** Decode a heartbeat payload; null when it is shorter than the base layout (Android would throw). */
export function parseMax2Heartbeat(p: Uint8Array): Max2Heartbeat | null {
  if (p.length < MAX2_HEARTBEAT_BASE_LENGTH) return null
  const b = (i: number) => p[i] ?? 0
  const one = (i: number) => b(i) === 1
  const mics: Max2MicStatus[] = [
    { battery: b(2), charging: one(4), online: one(6), gain: b(15), remainRecordTime: b(30) },
    { battery: b(3), charging: one(5), online: one(7), gain: b(16), remainRecordTime: b(31) },
  ]
  const hb: Max2Heartbeat = {
    length: p.length,
    rxBattery: b(0), boxBattery: b(1), mics,
    speaker: one(8), sampleDepth: b(9), micLock: one(10), noiseOn: one(11), noiseDepth: b(12),
    gainType: b(13), gainLevel: b(14), channelMode: b(17), deviceType: b(18), isCamera: b(18) === 2, recording: one(19),
    tcMode: b(20), inputFps: b(21), timingMode: b(22),
    earL: { battery: b(23), charging: one(24) }, earR: { battery: b(25), charging: one(26) }, earConnect: b(27),
    txIdentify: one(28), tcEnabled: one(29), resetTiming: one(32),
  }
  // A generateHeartInfo: `if (iByte2ToUnsignedShort >= 34)` reads cmdStartPosition + 38 … + 53 (payload 33..48).
  if (p.length >= 34) {
    mics.push(
      { battery: b(39), charging: one(41), online: one(43), gain: b(37), remainRecordTime: b(45) },
      { battery: b(40), charging: one(42), online: one(44), gain: b(38), remainRecordTime: b(46) },
    )
    hb.extended = { wireless: b(33), tcTime: { min: b(34), sec: b(35), frame: b(36) }, fourMic: one(47), earMonitor: b(48) }
  }
  return hb
}

/** Decoded 0x600A reply (A MicDeviceInfo.DeviceVersionResponse). */
export interface Max2VersionInfo {
  unit: Max2VersionUnit | null
  unitByte: number
  online: boolean
  serial: string
  version: string
  battery: number
  hardwareVersion: string
  /** chargeStatus 2 = charging. */
  charging: boolean
}

/**
 * ASCII field as Android decodes it: NumberUtil.bytesToAsciiString + trim. NUL and 0xFF padding are dropped
 * (max2-6701.md §5 0x600A: "ASCII is NUL/0xFF-stripped").
 */
function asciiField(p: Uint8Array, off: number, len: number): string {
  let s = ''
  for (let i = off; i < off + len && i < p.length; i++) {
    const c = p[i]
    if (c === 0 || c === 0xff) continue
    s += String.fromCharCode(c)
  }
  return s.trim()
}

/** Decode a 0x600A payload; null when shorter than the 52-byte layout. */
export function parseMax2Version(p: Uint8Array): Max2VersionInfo | null {
  if (p.length < MAX2_VERSION_REPLY_LENGTH) return null
  return {
    unit: MAX2_VERSION_UNIT_OF[p[0]] ?? null,
    unitByte: p[0],
    online: p[1] === 1,
    serial: asciiField(p, 2, 16),
    version: asciiField(p, 18, 16),
    battery: p[34],
    hardwareVersion: asciiField(p, 35, 16),
    charging: p[51] === MAX2_CHARGING,
  }
}

/** 0x6002 push: [tx1Online, tx1Battery, tx2Online, tx2Battery] (A generateTxInfo → TxSingleStatus(online == 1, battery)). */
export function parseMax2MicPush(p: Uint8Array): { online: boolean; battery: number }[] | null {
  if (p.length < 4) return null
  return [
    { online: p[0] === 1, battery: p[1] },
    { online: p[2] === 1, battery: p[3] },
  ]
}

/** 0x6006 item: on = payload[0] == 1; depth only in type 3 replies (A generateNoiseLevelStatus). */
export function parseMax2Noise(type: number, p: Uint8Array): { on: boolean; depth?: number } | null {
  if (!p.length) return null
  return { on: p[0] === 1, ...(type === MOMA_TYPE.DATA && p.length >= 2 ? { depth: p[1] } : {}) }
}

/**
 * 0x6007 item: [type, level, g1, g2(, g3, g4)]; level and gains only in type 3 replies, g3/g4 when len ≥ 6
 * (A generateVoiceGainStatus).
 */
export function parseMax2Gain(type: number, p: Uint8Array): { gainType: number; level?: number; gains?: number[] } | null {
  if (!p.length) return null
  if (type !== MOMA_TYPE.DATA || p.length < 4) return { gainType: p[0] }
  return { gainType: p[0], level: p[1], gains: p.length >= 6 ? [p[2], p[3], p[4], p[5]] : [p[2], p[3]] }
}

/** 0x6014 reply [h, m, s, frame] (A generateZeroTimingResult). */
export function parseMax2TcTime(p: Uint8Array): { hour: number; min: number; sec: number; frame: number } | null {
  if (p.length < 4) return null
  return { hour: p[0], min: p[1], sec: p[2], frame: p[3] }
}

/**
 * Heartbeat payload of a simulated / constructed device (inverse of parseMax2Heartbeat). Byte 18 is `deviceType`
 * when given, else 2 for a camera RX and 1 for a mobile RX.
 */
export function encodeMax2Heartbeat(hb: Omit<Max2Heartbeat, 'deviceType'> & { deviceType?: number }): Uint8Array {
  const n = hb.extended ? Math.max(hb.length, MAX2_HEARTBEAT_FULL_LENGTH) : MAX2_HEARTBEAT_BASE_LENGTH
  const p = new Uint8Array(n)
  const m = hb.mics
  const bit = (v: boolean) => (v ? 1 : 0)
  p[0] = hb.rxBattery
  p[1] = hb.boxBattery
  p[2] = m[0]?.battery ?? 0
  p[3] = m[1]?.battery ?? 0
  p[4] = bit(!!m[0]?.charging)
  p[5] = bit(!!m[1]?.charging)
  p[6] = bit(!!m[0]?.online)
  p[7] = bit(!!m[1]?.online)
  p[8] = bit(hb.speaker)
  p[9] = hb.sampleDepth
  p[10] = bit(hb.micLock)
  p[11] = bit(hb.noiseOn)
  p[12] = hb.noiseDepth
  p[13] = hb.gainType
  p[14] = hb.gainLevel
  p[15] = m[0]?.gain ?? 0
  p[16] = m[1]?.gain ?? 0
  p[17] = hb.channelMode
  p[18] = hb.deviceType ?? (hb.isCamera ? 2 : 1)
  p[19] = bit(hb.recording)
  p[20] = hb.tcMode
  p[21] = hb.inputFps
  p[22] = hb.timingMode
  p[23] = hb.earL.battery
  p[24] = bit(hb.earL.charging)
  p[25] = hb.earR.battery
  p[26] = bit(hb.earR.charging)
  p[27] = hb.earConnect
  p[28] = bit(hb.txIdentify)
  p[29] = bit(hb.tcEnabled)
  p[30] = m[0]?.remainRecordTime ?? 0
  p[31] = m[1]?.remainRecordTime ?? 0
  p[32] = bit(hb.resetTiming)
  if (hb.extended) {
    const x = hb.extended
    p[33] = x.wireless
    p[34] = x.tcTime.min
    p[35] = x.tcTime.sec
    p[36] = x.tcTime.frame
    p[37] = m[2]?.gain ?? 0
    p[38] = m[3]?.gain ?? 0
    p[39] = m[2]?.battery ?? 0
    p[40] = m[3]?.battery ?? 0
    p[41] = bit(!!m[2]?.charging)
    p[42] = bit(!!m[3]?.charging)
    p[43] = bit(!!m[2]?.online)
    p[44] = bit(!!m[3]?.online)
    p[45] = m[2]?.remainRecordTime ?? 0
    p[46] = m[3]?.remainRecordTime ?? 0
    p[47] = bit(x.fourMic)
    p[48] = x.earMonitor
  }
  return p
}

/** 0x600A payload of a simulated unit (inverse of parseMax2Version). */
export function encodeMax2Version(v: Omit<Max2VersionInfo, 'unit'>): Uint8Array {
  const p = new Uint8Array(MAX2_VERSION_REPLY_LENGTH)
  const put = (off: number, s: string) => {
    for (let i = 0; i < 16 && i < s.length; i++) p[off + i] = s.charCodeAt(i) & 0x7f
  }
  p[0] = v.unitByte
  p[1] = v.online ? 1 : 0
  put(2, v.serial)
  put(18, v.version)
  p[34] = v.battery
  put(35, v.hardwareVersion)
  p[51] = v.charging ? MAX2_CHARGING : 1
  return p
}
