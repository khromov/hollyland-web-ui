/**
 * LARK A1 (6108) reply parsers: heartbeat 0x1F (17 / 22 / 23-byte bodies), version, serial, MACs, set acks and the
 * single-value GETs (docs/research/families/a1-6108.md §4.2, §5). Plus the mapping of a heartbeat onto MicState
 * units and canonical control values, used by the session (session.ts).
 *
 * Heartbeat sources:
 *  - A usbmic/protocolV2/ProGetHearInfo.receiveData → usbmic/data/HeartInfoBean: each field read only when the body
 *    covers it; signal mode at body[16], TX3/TX4 at body[17..22] (Android assumes the 23-byte layout).
 *  - I -[HLHeartEntity initA1HeartInfo:] @0x1001fa798: the same fields at buffer offset 3 + i, branching on the LEN
 *    field (@0x1001fac5c: `cmp x21, 0x11; b.lt` → stop after body[15]; `b.eq` 17 → stop after body[16];
 *    `cmp x21, 0x17; csel` → TX3/TX4 from body[17..] when LEN == 23, else from body[16..]). Verified with r2.
 *    The 22-byte layout is a 4-mic firmware without the signal-mode byte; Android would misread it (§4.2).
 * This parser follows iOS (FAMILIES.md §3.8 "branch on LEN 17 / 22 / 23 as iOS does"); `layout: 'android'` gives
 * Android's reading for the cross-check tests.
 */
import { CONTROL, compareVersions, controlKey } from '../../core/controls'
import type { ControlValue, MicUnit } from '../../core/types'
import { A1_TX_UNITS, a1TxOfIndex, a1UnitOfByte, type A1TxUnitId, type A1UnitId } from './commands'

// ------------------------------------------------------------------------------- heartbeat

export interface A1TxStatus {
  /** body[0/1/17/18] == 1. */
  online: boolean
  /** Percent 0..100 (body[2/3/19/20]). The app hides it when 0 or the mic is offline (HLDevice6302Activity.updateBatteryView). */
  battery: number
  /** body[4/5/21/22] == 1. */
  muted: boolean
}

/**
 * Which body layout was read:
 *  - 'short'   LEN < 17: settings up to body[15] (mic recognition), no signal mode, no TX3/TX4
 *  - '2mic'    LEN == 17: + signal mode at body[16]
 *  - '4mic'    LEN == 23: signal mode at body[16], TX3/TX4 at body[17..22] (the layout Android assumes)
 *  - '4mic-old' any other LEN > 17 (22 in practice): TX3/TX4 at body[16..21], no signal mode (iOS only)
 */
export type A1HeartbeatLayout = 'short' | '2mic' | '4mic' | '4mic-old'

export interface A1Heartbeat {
  layout: A1HeartbeatLayout
  /** Body length (the LEN field). */
  length: number
  /** TX1..TX4; an entry is undefined when the body does not report that mic (2-mic layouts: TX3/TX4). */
  tx: [A1TxStatus | undefined, A1TxStatus | undefined, A1TxStatus | undefined, A1TxStatus | undefined]
  /** body[6] == 1. */
  noiseOn?: boolean
  /** body[7]: 0 Weak, 1 Medium, 2 Strong (A DeviceConnectVariable.NoiseLevelType). */
  noiseLevel?: number
  /** body[8]: 0..5 on a 6-step scale. */
  volume?: number
  /** body[9]: 0 Mono, 1 Stereo. */
  channelMode?: number
  /** body[10]: 0 = 15 min, 1 = Never. */
  shutdownTime?: number
  /** body[11] == 0 (A ProGetHearInfo lightStatus = data[11] == 0). */
  ledOn?: boolean
  /** body[12]: 1 Low, 2 Bright, 3 Equalization. */
  eq?: number
  /** body[13] == 1. */
  reverbOn?: boolean
  /** body[14]: 0 Small, 1 Medium, 2 Large. */
  reverbLevel?: number
  /** body[15] == 1 ("Mic Recognition", I isTXCheckOpen). */
  micRecognition?: boolean
  /** body[16]: 0 Normal, 1 Performance (I isEnhance). Only in the 17- and 23-byte layouts. */
  signalMode?: number
}

const at = (b: Uint8Array, i: number): number | undefined => (i < b.length ? b[i] : undefined)
const flag = (b: Uint8Array, i: number): boolean | undefined => (i < b.length ? b[i] === 1 : undefined)

function txAt(b: Uint8Array, online: number, battery: number, muted: number): A1TxStatus | undefined {
  // A ProGetHearInfo reads each byte independently; a mic is reported when its online byte is present.
  if (online >= b.length) return undefined
  return { online: b[online] === 1, battery: at(b, battery) ?? 0, muted: b[muted] === 1 }
}

/**
 * Parse a 0x1F reply body. `layout: 'ios'` (default) branches on the length like I initA1HeartInfo:;
 * `layout: 'android'` reads like A ProGetHearInfo.receiveData (signal mode at 16 and TX3/TX4 at 17.. whenever the
 * body is long enough).
 */
export function parseA1Heartbeat(body: Uint8Array, o: { layout?: 'ios' | 'android' } = {}): A1Heartbeat {
  const n = body.length
  const hb: A1Heartbeat = {
    layout: n < 17 ? 'short' : n === 17 ? '2mic' : n === 23 ? '4mic' : '4mic-old',
    length: n,
    tx: [undefined, undefined, undefined, undefined],
  }
  // body[0..5] (A: read together when data.length >= 6)
  if (n >= 6) {
    hb.tx[0] = { online: body[0] === 1, battery: body[2], muted: body[4] === 1 }
    hb.tx[1] = { online: body[1] === 1, battery: body[3], muted: body[5] === 1 }
  }
  hb.noiseOn = flag(body, 6)
  hb.noiseLevel = at(body, 7)
  hb.volume = at(body, 8)
  hb.channelMode = at(body, 9)
  hb.shutdownTime = at(body, 10)
  hb.ledOn = n > 11 ? body[11] === 0 : undefined
  hb.eq = at(body, 12)
  hb.reverbOn = flag(body, 13)
  hb.reverbLevel = at(body, 14)
  hb.micRecognition = flag(body, 15)
  if (o.layout === 'android') {
    hb.signalMode = at(body, 16)
    hb.tx[2] = txAt(body, 17, 19, 21)
    hb.tx[3] = txAt(body, 18, 20, 22)
    hb.layout = n >= 18 ? '4mic' : n === 17 ? '2mic' : 'short'
    return hb
  }
  if (n < 17) return hb
  if (n === 17) {
    hb.signalMode = body[16]
    return hb
  }
  // I initA1HeartInfo: @0x1001facb4 `cmp x21, 0x17; csel x23` (LEN == 23 → 1, else 0), then buffer offsets
  // 0x13..0x18 + x23 (body 16..21 + x23) go to setTx3ConnectStatus:, setTx4ConnectStatus:, setTx3BatteryValue:,
  // setTx4BatteryValue:, setTx3MuteStatus:, setTx4MuteStatus: (selrefs @0x100e81470/4b8/460/4a8/488, read with r2).
  const base = n === 23 ? 17 : 16
  if (n === 23) hb.signalMode = body[16]
  hb.tx[2] = txAt(body, base, base + 2, base + 4)
  hb.tx[3] = txAt(body, base + 1, base + 3, base + 5)
  return hb
}

/** Whether a heartbeat reports four mics (TX3/TX4 present). */
export function a1HeartbeatHasFourMics(hb: A1Heartbeat): boolean {
  return hb.tx[2] !== undefined || hb.tx[3] !== undefined
}

// ------------------------------------------------------------------------------- identity

export interface A1Version {
  unit: A1UnitId
  /** Decimal parts joined with '.', e.g. "1.0.1.3" (A ProGetDeviceVersion.receiveData). */
  version: string
  /** Android display form (A application/common/util/USBUtils.formatVersion: 4+ parts and a one-digit last part get a leading 0, "1.0.1.03"). */
  display: string
  parts: number[]
}

/** A USBUtils.formatVersion. */
export function formatA1Version(v: string): string {
  const parts = v.trim().split('.')
  if (parts.length < 4) return v
  const last = parts[parts.length - 1]
  if (last.length !== 1) return v
  return [...parts.slice(0, -1), `0${last}`].join('.')
}

/** 0x0D reply body: [unit, v0, v1, …] (A ProGetDeviceVersion.receiveData; null when the body has <= 2 bytes, as Android ignores it). */
export function parseA1Version(body: Uint8Array): A1Version | null {
  if (body.length <= 2) return null
  const parts = [...body.subarray(1)]
  const version = parts.join('.')
  return { unit: a1UnitOfByte(body[0]), version, display: formatA1Version(version), parts }
}

/** RX firmware gate of the per-mic mute row and the newer OTA list (A blemic/manager/DeviceDataManager.SPEC_VERSION_6108, is6108NewDevice). */
export const A1_NEW_DEVICE_MIN_VERSION = '1.0.1.3'

/** A DeviceDataManager.is6108NewDevice: RX version >= 1.0.1.3 (A application/common/util/HexUtil.compareVersions, inclusive). */
export function isA1NewDevice(rxVersion: string | undefined): boolean {
  return !!rxVersion && compareVersions(rxVersion, A1_NEW_DEVICE_MIN_VERSION) >= 0
}

/**
 * 4 Mic & 1 RX firmware: the RX version's second part is 1 (A larkc1/HLDevice6302Activity.onResGetVersion:
 * split('.') size >= 4 and Integer.parseInt(split[1]) == 1 → is6108FourMicOneRx). Undefined when unknown.
 */
export function isA1FourMicFirmware(rxVersion: string | undefined): boolean | undefined {
  if (!rxVersion) return undefined
  const parts = rxVersion.trim().split('.')
  if (parts.length < 4) return undefined
  return parseInt(parts[1], 10) === 1
}

/** A application/common/util/NumberUtil.bytesToAsciiString: drop 0x00 and 0xFF bytes, decode UTF-8. */
export function a1AsciiString(bytes: Uint8Array): string {
  const kept = bytes.filter((b) => b !== 0x00 && b !== 0xff)
  return kept.length ? new TextDecoder('utf-8', { fatal: false }).decode(kept) : ''
}

/** 0x12 reply body: [unit, ASCII…] (A ProGetDeviceSn.receiveData; null when <= 2 bytes). */
export function parseA1Serial(body: Uint8Array): { unit: A1UnitId; serial: string } | null {
  if (body.length <= 2) return null
  return { unit: a1UnitOfByte(body[0]), serial: a1AsciiString(body.subarray(1)) }
}

/** A application/common/extension/ByteArrayExtKt.toHexString(bytes, ":"): "%02X" joined by ':'. */
export function a1MacString(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
}

/** 0x30 reply body: the RX MAC bytes, no unit byte (A ProGetDeviceMacRX.receiveData: <= 2 bytes or all zero → ""). */
export function parseA1RxMac(body: Uint8Array): string {
  if (body.length <= 2 || body.every((b) => b === 0)) return ''
  return a1MacString(body)
}

/** 0x31 reply body: [TX index, MAC…] (A ProGetDeviceMacTX.receiveData; null when <= 2 bytes, "" when all zero). */
export function parseA1TxMac(body: Uint8Array): { unit: A1UnitId; mac: string } | null {
  if (body.length <= 2) return null
  const mac = body.subarray(1)
  const valid = mac.length > 2 && mac.some((b) => b !== 0)
  return { unit: a1TxOfIndex(body[0]), mac: valid ? a1MacString(mac) : '' }
}

// ------------------------------------------------------------------------------- acks and GETs

/**
 * Set acknowledgement: body[0] == 0 is success (every A usbmic/protocolV2/ProSet* `setStatus = data[0] == 0`;
 * A DeviceConnectVariable.CmdSetResult SUCCESS(0) / FAILURE(1)). Inverted relative to the A2/M2 rule.
 *
 * The apps disagree beyond 0: iOS treats every byte except 0xFF as success (I -[HL6108DeviceInfoSync
 * handleEvent:] @0x100203d98, event type 3 branch @0x1002040b0: subdataWithRange:(3, 1) = body[0] @0x1002040c8,
 * coverDecimalismData:, `cmp x0, #0xff; cset w24, ne` @0x1002040e8 → +[HL6108Effect
 * configResultWithCommand:success:] @0x100204114; type 3 = the set commands 0x01/0x03/0x05/0x07/0x13/0x16/
 * 0x21/0x23/0x27/0x3F, -[HL6108EventMapper eventTypeForCommand:] @0x10001e120). Both agree only that 0x00 is
 * success. The library keeps Android's stricter rule (a reply of 0x01 is a failure, as CmdSetResult names it);
 * `iosOk` records what iOS would show, so a hardware check can tell which reading the firmware follows.
 */
export function parseA1Ack(body: Uint8Array): { ok: boolean; code: number | null; iosOk: boolean } {
  const code = body.length ? body[0] : null
  return { ok: code === 0, code, iosOk: code !== null && code !== 0xff }
}

/** 0x14 / 0x06 reply [on, level] (A ProGetNoise.receiveData; ProGetReverb). */
export function parseA1OnLevel(body: Uint8Array): { on: boolean; level: number } | null {
  if (body.length < 2) return null
  return { on: body[0] === 1, level: body[1] }
}

/** Single-byte GETs: 0x02 mode, 0x04 volume, 0x08 EQ, 0x40 signal mode, 0x41 fail reason (A ProGetVoiceMode … ProGetModeFailReason: data[0]). */
export function parseA1Byte(body: Uint8Array): number | null {
  return body.length ? body[0] : null
}

/** 0x46 reply [1 = on] (A ProGetPerformanceMode.receiveData). */
export function parseA1PerformanceMode(body: Uint8Array): boolean | null {
  return body.length ? body[0] === 1 : null
}

// ------------------------------------------------------------------------------- MicState mapping

/**
 * Family-scoped control ids for A1 settings without a canonical id (core/controls.ts CONTROL). The value domains
 * below are what the session writes into MicState.values; the A1 controls (Phase 2, W5) use the same ids.
 */
export const A1_CONTROL = {
  /** "EQ Adjustment": 1 Low, 2 Bright, 3 Equalization (wire values). */
  EQ: 'a1.eq',
  /** "Reverb Adjustment" switch. */
  REVERB_ENABLED: 'a1.reverb.enabled',
  /** Reverb size: 0 Small, 1 Medium, 2 Large (wire values). */
  REVERB_LEVEL: 'a1.reverb.level',
  /** "Mode setting": 0 Normal, 1 Performance (wire values). */
  SIGNAL_MODE: 'a1.signalMode',
  /**
   * Hidden cloud-driven performance flag (0x45 / 0x46). A value only, read at start-up (0x46) for the console: no
   * control, because neither app lets the user set it (A HLDevice6302ViewModel.handlePerformanceMode syncs it from
   * the cloud config EnhancedModeSwitch; I -[HL6108DeviceInfoSync checkEnhanceStatus:] @0x100204e1c).
   */
  PERFORMANCE: 'a1.performance',
  /**
   * "Wireless settings": 2 = "2 Mic & 1 RX", 4 = "4 Mic & 1 RX", from the RX version's second part (A
   * HLDevice6302Activity.onResGetVersion is6108FourMicOneRx). The switch re-flashes RX and mics: catalogued as a
   * destructive control, never implemented (controls.ts).
   */
  WIRELESS_MODE: 'a1.wirelessMode',
} as const

/**
 * MicState values of a heartbeat, keyed like the legacy adapter (families/legacy/controls.ts conventions):
 *  - noise.enabled boolean; noise.level 1-based (wire 0 Weak → 1, 1 Medium → 2, 2 Strong → 3)
 *  - volume 0..5; channel.mode 0 Mono / 1 Stereo; led true = on; autoOff true = "15min" (wire 0), false = "Never"
 *  - mic.recognition boolean; mic.mute:txN boolean for every mic the body reports
 *  - a1.eq / a1.reverb.enabled / a1.reverb.level / a1.signalMode (wire values, see A1_CONTROL)
 * Fields the body does not carry are left out (never guessed).
 */
export function a1HeartbeatValues(hb: A1Heartbeat): Record<string, ControlValue> {
  const v: Record<string, ControlValue> = {}
  const put = (k: string, x: ControlValue | undefined) => {
    if (x !== undefined) v[k] = x
  }
  put(CONTROL.NOISE_ENABLED, hb.noiseOn)
  put(CONTROL.NOISE_LEVEL, hb.noiseLevel === undefined ? undefined : hb.noiseLevel + 1)
  put(CONTROL.VOLUME, hb.volume)
  put(CONTROL.CHANNEL_MODE, hb.channelMode)
  put(CONTROL.AUTO_OFF, hb.shutdownTime === undefined ? undefined : hb.shutdownTime === 0)
  put(CONTROL.LED, hb.ledOn)
  put(CONTROL.MIC_RECOGNITION, hb.micRecognition)
  put(A1_CONTROL.EQ, hb.eq)
  put(A1_CONTROL.REVERB_ENABLED, hb.reverbOn)
  put(A1_CONTROL.REVERB_LEVEL, hb.reverbLevel)
  put(A1_CONTROL.SIGNAL_MODE, hb.signalMode)
  hb.tx.forEach((t, i) => {
    if (t) v[controlKey(CONTROL.MIC_MUTE, A1_TX_UNITS[i])] = t.muted
  })
  return v
}

/** Mic slots of a firmware mode: 4 for 4 Mic & 1 RX (RX version x.1.x.x), 2 otherwise; undefined while unknown. */
export function a1MicSlotsOfVersion(rxVersion: string | undefined): 2 | 4 | undefined {
  const four = isA1FourMicFirmware(rxVersion)
  return four === undefined ? undefined : four ? 4 : 2
}

/**
 * MicState unit patches of a heartbeat. Mics the body does not report (TX3/TX4 in a 2-mic layout) are marked
 * offline. Battery is left out while a mic is offline or reports 0 (the app hides it then).
 */
export function a1HeartbeatUnits(hb: A1Heartbeat): Partial<Record<A1TxUnitId, Partial<MicUnit>>> {
  const out: Partial<Record<A1TxUnitId, Partial<MicUnit>>> = {}
  A1_TX_UNITS.forEach((u, i) => {
    const t = hb.tx[i]
    if (!t) {
      out[u] = { online: false, battery: undefined, muted: undefined }
      return
    }
    out[u] = { online: t.online, battery: t.online && t.battery > 0 ? Math.min(100, t.battery) : undefined, muted: t.muted }
  })
  return out
}
