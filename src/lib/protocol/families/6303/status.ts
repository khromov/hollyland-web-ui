/**
 * LARK M3 (6303) reply parsers and the mapping of the 0x6000 heartbeat into MicState (m3-6303.md §5.1–§5.3).
 *
 * Layouts are the generated deserializers (A protocol/core/sound/data/*EntitySerializer.deserialize, ByteBuffer
 * LITTLE_ENDIAN, every field a signed byte unless noted); semantics come from how the Android UI uses each field
 * (A larkc1/c6303/viewmodel/EquipmentViewModel, ui/equipment/controller/EquipmentFragment, ui/setting/controller/
 * MoreSetting6303Activity). iOS field names: I HL6303SettingEntity (_denoiseState, _volumeValue, _trackMode,
 * _smartMixSoundState, _indicatorLightState, _txColorIdentifierState, _samplingDepth, _nonPluggingSoundOut, _micLock,
 * _micAutoPowerOff, _cameraAutoPowerOff, _workMode, _mainRxIndex, _isMainRx…), I HL6303DeviceInfoResponse.
 */
import { CONTROL, controlKey } from '../../core/controls'
import type { ControlAvailability, ControlId, ControlValue, MicUnit, UnitId } from '../../core/types'
import type { ProductInfo } from '../../models'
import { M3_CAMERA_GAIN_DB, M3_SOUND_MODE, M3_SYSTEM, M3_TX_UNITS, m3RxDeviceId } from './commands'
import { isM3PhoneRx } from './products'

// ------------------------------------------------------------------------------------------- control ids

/** Family-scoped control ids (canonical ids from core/controls.ts CONTROL where the meaning matches). */
export const M3_CONTROL = {
  /** "Smart mix" (A R mic_mix; heartbeat byte 25). */
  SMART_MIX: 'm3.smartMix',
  /** "Camera Power On/Off" hot-shoe power sync, camera RX only (R hot_shoe_switch_title; byte 24). */
  HOT_SHOE_SYNC: 'm3.hotShoeSync',
  /** "TX button lock" (R title_sound_mic_lock; byte 26). */
  TX_BUTTON_LOCK: 'm3.txButtonLock',
  /** "Bit Depth" 24-bit / 32-bit float (R sample_depth; 0x6011 byte 1). */
  BIT_DEPTH: 'm3.bitDepth',
  /** Camera RX "RX volume" levels 1–3 in dB (R volume_first_gear / volume_two_gear / volume_three_gear; 0x100E). */
  CAMERA_LEVEL_1: 'm3.cameraVolume.level1',
  CAMERA_LEVEL_2: 'm3.cameraVolume.level2',
  CAMERA_LEVEL_3: 'm3.cameraVolume.level3',
} as const

export const M3_CAMERA_LEVELS = [M3_CONTROL.CAMERA_LEVEL_1, M3_CONTROL.CAMERA_LEVEL_2, M3_CONTROL.CAMERA_LEVEL_3] as const

/**
 * Read-only status values the heartbeat carries besides the controls (MicState.values keys; no ControlSpec).
 * They are reported so the UI can show them; nothing writes them.
 */
export const M3_INFO = {
  /** RF topology, heartbeat byte 22: 0 = 4TX&4RX (4T4R), 1 = 2TX&2RX (wireless monitoring). */
  SYSTEM: 'm3.system',
  /** Camera RX: the volume level selected on the receiver, 0–2 = Level 1–3 (byte 14; A EquipmentFragment.updateRxType: 3 segments, not clickable). */
  CAMERA_GEAR: 'm3.cameraVolume.gear',
  /** Number (1–4) of the RX the host is plugged into (byte 2 + 1). */
  RX_NUMBER: 'm3.rxNumber',
  /** Number (1–4) of the primary RX (byte 23 + 1). */
  PRIMARY_RX_NUMBER: 'm3.primaryRxNumber',
  /** Pairing in progress (byte 20; A PairDeviceActivity). */
  PAIRING: 'm3.pairing',
  /** Voice profiles changed on the device (byte 28 isRefreshCanto); cleared with 0x6015. */
  PROFILES_CHANGED: 'm3.voiceProfilesChanged',
  /** Wireless-monitoring earphone track mode (byte 29). */
  EAR_MODE: 'm3.earMode',
  /** 0x6006 work mode (0 = 4T4R, 1 = 2T2R), when read. */
  WORK_MODE: 'm3.workMode',
  /** Bluetooth earphone volume 0–127 from 0x0036 events (wireless monitoring). */
  EAR_VOLUME: 'm3.earphone.volume',
  /** Bluetooth earphone link from 0x0031 / 0x0032 events. */
  EAR_CONNECTED: 'm3.earphone.connected',
} as const

/** Controls only the primary RX may change ("The primary RX manages all global parameters", R main_master_switch_note). */
export const M3_PRIMARY_ONLY: readonly ControlId[] = [
  // A EquipmentFragment.updateMasterSlaveMode disables voiceOutgoingSwitch (NC), voiceMixingSwitch (smart mix),
  // swColorDifference (TX recognition), swIndicatorLight (LED); initNoiseData$lambda$35–37 and the mute callback
  // (initView$1$2.onMuteIconClick) return unless isMaster.
  CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, M3_CONTROL.SMART_MIX, CONTROL.MIC_RECOGNITION, CONTROL.LED, CONTROL.MIC_MUTE,
  // A MoreSetting6303Activity.updateMasterUI disables buttonLockSwitch / buttonAutoExitSwitch; initView$lambda$7 / 10 / 12
  // return unless isMaster (bit depth, auto power off, TX button lock).
  M3_CONTROL.TX_BUTTON_LOCK, CONTROL.AUTO_OFF, M3_CONTROL.BIT_DEPTH,
]

// ---------------------------------------------------------------------------------------------- heartbeat

/** 0x6000 body length (A HLHeartInfo6303EntityExtKt.cmdSize: 30 single bytes). */
export const M3_HEARTBEAT_SIZE = 30

/** Decoded 0x6000 heartbeat, field names of A protocol/core/sound/data/HLHeartInfo6303Entity (cmdSerialize order). */
export interface M3Heartbeat {
  /** Payload bytes received (shorter bodies are zero-extended to 30, A CmdGetHeart6303.decodePayload). */
  length: number
  /** 0: bitmask TX1..TX4 online (low nibble, A TxStatusUtilKt.parseMicStatusFromByte). */
  txConnectState: number
  /** 1: bitmask RX1..RX4 online. */
  rxConnectState: number
  /** 2: index 0–3 of the RX the host is plugged into (payload id = index + 6). */
  currentRxDeviceId: number
  /** 3–6: TX1..TX4 battery % (signed; < 0 shows "--", A EquipmentMicAdapter). */
  txBattery: [number, number, number, number]
  /** 7–10: RX1..RX4 battery %; −1 (0xFF) = no battery, i.e. a phone RX (A EquipmentFragment.updateMasterSlaveMode). */
  rxBattery: [number, number, number, number]
  /** 11: bitmask TX1..TX4 muted. */
  txMuteStatus: number
  /** 12: NC on. */
  denoiseSwitch: number
  /** 13: NC level 0 Weak, 1 Medium, 2 Strong (A EquipmentFragment.updateNoiseStatus). */
  denoiseLevel: number
  /** 14: phone RX volume 0–5 (shown + 1); camera RX: the selected level 0–2. */
  volumeLevel: number
  /** 15: 0 Mono, 1 Stereo, 2 4-track. */
  channelMode: number
  /** 16: not used by either UI [?]. */
  autoShutdownEnable: number
  /** 17: not used by either UI. */
  eqMode: number
  /** 18: 1 = "TX Recognition" on. */
  txRecognitionSwitch: number
  /** 19: 1 = TX indicator LED off (A EquipmentViewModel GetUIState micLedOff = ledSwitch == 1). */
  ledSwitch: number
  /** 20: 1 = pairing in progress. */
  pairState: number
  /** 21: 0 = this RX is the primary (A HLHeartInfo6303Entity.isMainRx = masterSlaveMode == 0). */
  masterSlaveMode: number
  /** 22: 0 = 4T4R, 1 = 2T2R (is4t4r = deviceMode == 0). */
  deviceMode: number
  /** 23: index of the primary RX (A VersionUtilKt.getRxType: index == mainRxId → RX, else RX_SUB). */
  mainRxId: number
  /** 24: 1 = camera power sync via hot shoe on. */
  hotShoeSwitch: number
  /** 25: 1 = Smart mix on. */
  swMixNoise: number
  /** 26: 1 = TX button lock (A MoreSetting6303Activity.initFlow → updateKeyLock(micLockSwitch == 1)). */
  micLockSwitch: number
  /** 27: 1 = "Auto power off" (camera RX and TX, 15 min) on (updateAutoPowerOff(micAutoExitSw == 1)). */
  micAutoExitSw: number
  /** 28: 1 = voice profiles changed on the device → the app sends 0x6015 and reloads them. */
  isRefreshCanto: number
  /** 29: wireless-monitoring earphone track mode. */
  earMode: number
  // ---- derived as HLHeartInfo6303Entity.<init> does
  txOnline: [boolean, boolean, boolean, boolean]
  rxOnline: [boolean, boolean, boolean, boolean]
  txMuted: [boolean, boolean, boolean, boolean]
  isMainRx: boolean
  is4t4r: boolean
}

const s8 = (b: number) => (b > 127 ? b - 256 : b)
const bits4 = (b: number): [boolean, boolean, boolean, boolean] => [0, 1, 2, 3].map((i) => ((b & 0x0f) >> i & 1) === 1) as [boolean, boolean, boolean, boolean]

/** A HLHeartInfo6303EntitySerializer.deserialize after CmdGetHeart6303's zero extension. Never throws. */
export function parseM3Heartbeat(payload: ArrayLike<number>): M3Heartbeat {
  const p = new Uint8Array(Math.max(M3_HEARTBEAT_SIZE, payload.length))
  p.set(Array.from(payload).slice(0, p.length))
  const hb: M3Heartbeat = {
    length: payload.length,
    txConnectState: p[0], rxConnectState: p[1], currentRxDeviceId: p[2],
    txBattery: [s8(p[3]), s8(p[4]), s8(p[5]), s8(p[6])],
    rxBattery: [s8(p[7]), s8(p[8]), s8(p[9]), s8(p[10])],
    txMuteStatus: p[11], denoiseSwitch: p[12], denoiseLevel: p[13], volumeLevel: p[14], channelMode: p[15],
    autoShutdownEnable: p[16], eqMode: p[17], txRecognitionSwitch: p[18], ledSwitch: p[19], pairState: p[20],
    masterSlaveMode: p[21], deviceMode: p[22], mainRxId: p[23], hotShoeSwitch: p[24], swMixNoise: p[25],
    micLockSwitch: p[26], micAutoExitSw: p[27], isRefreshCanto: p[28], earMode: p[29],
    txOnline: bits4(p[0]), rxOnline: bits4(p[1]), txMuted: bits4(p[11]),
    isMainRx: p[21] === 0, is4t4r: p[22] === 0,
  }
  return hb
}

/** Fields of a heartbeat body (the 30 raw bytes, batteries signed), for the simulator and tests. */
export type M3HeartbeatFields = Omit<M3Heartbeat, 'length' | 'txOnline' | 'rxOnline' | 'txMuted' | 'isMainRx' | 'is4t4r'>

/** Inverse of parseM3Heartbeat (A HLHeartInfo6303EntityExtKt.cmdSerialize order). */
export function encodeM3Heartbeat(h: M3HeartbeatFields): number[] {
  const b = (v: number) => v & 0xff
  return [
    h.txConnectState, h.rxConnectState, h.currentRxDeviceId, ...h.txBattery, ...h.rxBattery, h.txMuteStatus,
    h.denoiseSwitch, h.denoiseLevel, h.volumeLevel, h.channelMode, h.autoShutdownEnable, h.eqMode, h.txRecognitionSwitch,
    h.ledSwitch, h.pairState, h.masterSlaveMode, h.deviceMode, h.mainRxId, h.hotShoeSwitch, h.swMixNoise, h.micLockSwitch,
    h.micAutoExitSw, h.isRefreshCanto, h.earMode,
  ].map(b)
}

/** NC level wire 0–2 → 1-based control value (A EquipmentFragment.updateNoiseStatus: 1 Medium, 2 Strong, anything else Weak). */
export function m3NoiseLevelValue(wire: number): number {
  return wire === 1 ? 2 : wire === 2 ? 3 : 1
}

/** Channel mode wire → control value (A EquipmentFragment.updateSoundMode: 1 Stereo, 2 4-track, anything else Mono). */
export function m3ChannelModeValue(wire: number): number {
  return wire === M3_SOUND_MODE.STEREO || wire === M3_SOUND_MODE.FOUR_TRACK ? wire : M3_SOUND_MODE.MONO
}

// ---------------------------------------------------------------------------------------------- topology

/**
 * Which receiver slot (index 0–3) each RX unit stands for: `rx` is the RX the host is plugged into (heartbeat byte 2),
 * rx2..rx4 the other three slots in ascending index order. MicUnit.label carries the real number ("RX 3"); MicState
 * values carry M3_INFO.RX_NUMBER / PRIMARY_RX_NUMBER. (UnitId has no per-slot ids: core/ids.ts.)
 */
export function m3RxSlots(currentRxIndex: number): readonly { unit: UnitId; index: number }[] {
  const cur = currentRxIndex >= 0 && currentRxIndex <= 3 ? currentRxIndex : 0
  const others = [0, 1, 2, 3].filter((i) => i !== cur)
  return [{ unit: 'rx', index: cur }, { unit: 'rx2', index: others[0] }, { unit: 'rx3', index: others[1] }, { unit: 'rx4', index: others[2] }]
}

/** Unit for a payload device id (TX 1–4, RX 6–9 through the current slot map); null for 0 / 10 / unknown. */
export function m3UnitOfDeviceId(deviceId: number, currentRxIndex: number): UnitId | null {
  if (deviceId >= 1 && deviceId <= 4) return M3_TX_UNITS[deviceId - 1]
  if (deviceId >= 6 && deviceId <= 9) return m3RxSlots(currentRxIndex).find((s) => s.index === deviceId - 6)?.unit ?? null
  return null
}

/** Payload device id of a unit (TX 1–4, RX slot + 6). */
export function m3DeviceIdOfUnit(unit: UnitId, currentRxIndex: number): number | null {
  const tx = (M3_TX_UNITS as readonly UnitId[]).indexOf(unit)
  if (tx >= 0) return tx + 1
  const slot = m3RxSlots(currentRxIndex).find((s) => s.unit === unit)
  return slot ? m3RxDeviceId(slot.index) : null
}

/** Heartbeat → units: TX online / battery / mute, RX slots with battery (phone RX: none), role and kind. */
export function m3HeartbeatUnits(hb: M3Heartbeat, product: ProductInfo): Partial<Record<UnitId, Partial<MicUnit>>> {
  const out: Partial<Record<UnitId, Partial<MicUnit>>> = {}
  M3_TX_UNITS.forEach((u, i) => {
    const online = hb.txOnline[i]
    const battery = hb.txBattery[i]
    out[u] = { online, battery: online && battery >= 0 ? battery : undefined, muted: online ? hb.txMuted[i] : undefined }
  })
  for (const { unit, index } of m3RxSlots(hb.currentRxDeviceId)) {
    const battery = hb.rxBattery[index]
    if (unit === 'rx') {
      // Phone vs camera by PID (A Device6303DataManager.isPhoneRx: PID 1038 || 1039); the header label also uses
      // battery == −1 → "Phone" (A EquipmentFragment.updateMasterSlaveMode).
      out.rx = {
        online: true, battery: battery >= 0 ? battery : undefined, role: hb.isMainRx ? 'primary' : 'secondary',
        kind: isM3PhoneRx(product) ? 'phone-rx' : 'camera-rx', label: `RX ${index + 1}`,
      }
      continue
    }
    const online = hb.rxOnline[index]
    out[unit] = online
      ? {
          online, battery: battery >= 0 ? battery : undefined, role: index === hb.mainRxId ? 'primary' : 'secondary',
          kind: battery === -1 ? 'phone-rx' : 'camera-rx', label: `RX ${index + 1}`,
        }
      : { online: false, battery: undefined, role: undefined, kind: undefined, label: `RX ${index + 1}` }
  }
  return out
}

/** Heartbeat → MicState.values: every home-page and More Settings value the official app reads from it. */
export function m3HeartbeatValues(hb: M3Heartbeat, product: ProductInfo): Partial<Record<ControlId, ControlValue>> {
  const phone = isM3PhoneRx(product)
  const v: Partial<Record<ControlId, ControlValue>> = {
    [CONTROL.NOISE_ENABLED]: hb.denoiseSwitch === 1,
    [CONTROL.NOISE_LEVEL]: m3NoiseLevelValue(hb.denoiseLevel),
    [CONTROL.CHANNEL_MODE]: m3ChannelModeValue(hb.channelMode),
    [CONTROL.MIC_RECOGNITION]: hb.txRecognitionSwitch === 1,
    // Inverted on the wire: 1 = LED off (A EquipmentFragment.updateMicLedOff: swIndicatorLight.setChecked(!off)).
    [CONTROL.LED]: hb.ledSwitch !== 1,
    [M3_CONTROL.SMART_MIX]: hb.swMixNoise === 1,
    [M3_CONTROL.TX_BUTTON_LOCK]: hb.micLockSwitch === 1,
    [CONTROL.AUTO_OFF]: hb.micAutoExitSw === 1,
    [M3_INFO.SYSTEM]: hb.deviceMode === M3_SYSTEM.TWO_T_TWO_R ? M3_SYSTEM.TWO_T_TWO_R : M3_SYSTEM.FOUR_T_FOUR_R,
    [M3_INFO.RX_NUMBER]: (hb.currentRxDeviceId & 3) + 1,
    [M3_INFO.PRIMARY_RX_NUMBER]: (hb.mainRxId & 3) + 1,
    [M3_INFO.PAIRING]: hb.pairState === 1,
    [M3_INFO.PROFILES_CHANGED]: hb.isRefreshCanto === 1,
    [M3_INFO.EAR_MODE]: hb.earMode,
  }
  if (phone) {
    // Phone RX "RX volume", 6 segments (A EquipmentFragment.initGainLevel setSegmentCount(6), updateGainLevel(level + 1)).
    v[CONTROL.VOLUME] = Math.min(5, hb.volumeLevel)
  } else {
    v[M3_INFO.CAMERA_GEAR] = Math.min(2, hb.volumeLevel)
    // Camera RX only (A EquipmentFragment.updateHotShoeSwitch: ctHotShoeSwitch visible if isCameraRx).
    v[M3_CONTROL.HOT_SHOE_SYNC] = hb.hotShoeSwitch === 1
  }
  M3_TX_UNITS.forEach((u, i) => {
    v[controlKey(CONTROL.MIC_MUTE, u)] = hb.txMuted[i]
  })
  return v
}

const SECONDARY: ControlAvailability = {
  ok: false, reason: 'secondary-rx', message: 'The primary RX manages all global parameters; switch to the primary RX to change this.',
}
const NO_TX: ControlAvailability = { ok: false, reason: 'mic-disconnected', message: 'Setup failed. Please connect the tx and try again' }
const OK: ControlAvailability = { ok: true }

/**
 * The official app's preconditions for the current heartbeat (FAMILIES.md §3.8 row 6303). No firmware gates in the
 * home / More Settings pages (m3-6303.md §6: features are gated by PID, primary role and RF mode).
 */
export function m3Availability(hb: M3Heartbeat, values: Partial<Record<ControlId, ControlValue>>): Partial<Record<ControlId, ControlAvailability>> {
  const primary = hb.isMainRx
  const anyTx = hb.txOnline.some(Boolean)
  const gate = (extra?: ControlAvailability): ControlAvailability => (!primary ? SECONDARY : extra ?? OK)
  const a: Partial<Record<ControlId, ControlAvailability>> = {}
  for (const id of M3_PRIMARY_ONLY) a[id] = gate()
  // NC switch and levels: "Setup failed. Please connect the tx" without a mic (A Device6303DataManager.isMicConnected,
  // EquipmentFragment.initNoiseData$lambda$35–39); the device fails the set too (EquipmentUIState.SetSwitchFail).
  a[CONTROL.NOISE_ENABLED] = gate(anyTx ? OK : NO_TX)
  // The level row is hidden while NC is off (A EquipmentFragment.updateNoiseStatus: llNoise GONE).
  const ncOn = (values[CONTROL.NOISE_ENABLED] ?? hb.denoiseSwitch === 1) === true
  a[CONTROL.NOISE_LEVEL] = gate(!anyTx ? NO_TX : ncOn ? OK : { ok: false, reason: 'noise-off', message: 'Turn Noise Cancellation on first.' })
  // Smart mix is shown in 4TX&4RX only (A EquipmentFragment.updateMixEnable: ctMixing visible if is4t4r).
  a[M3_CONTROL.SMART_MIX] = gate(hb.is4t4r ? OK : { ok: false, reason: 'not-4t4r', message: 'Smart mix needs 4TX&4RX mode (wireless monitoring is on).' })
  // A mic tile's mute key exists only while the mic is online (A EquipmentMicAdapter: click listener set if isOnline).
  M3_TX_UNITS.forEach((u, i) => {
    a[controlKey(CONTROL.MIC_MUTE, u)] = !primary ? SECONDARY : hb.txOnline[i] ? OK : { ok: false, reason: 'mic-offline', message: `TX${i + 1} is not connected.` }
  })
  return a
}

/** Short traffic-log text. */
export function describeM3Heartbeat(hb: M3Heartbeat): string {
  const tx = M3_TX_UNITS.map((_, i) => (hb.txOnline[i] ? `TX${i + 1} ${hb.txBattery[i] >= 0 ? `${hb.txBattery[i]}%` : '--'}${hb.txMuted[i] ? ' muted' : ''}` : null))
    .filter(Boolean)
    .join(', ')
  const rx = [0, 1, 2, 3].filter((i) => hb.rxOnline[i] || i === hb.currentRxDeviceId).map((i) => `RX${i + 1}${i === hb.currentRxDeviceId ? '*' : ''}${i === hb.mainRxId ? ' primary' : ''}`).join(', ')
  const mode = ['mono', 'stereo', '4-track'][hb.channelMode] ?? `mode ${hb.channelMode}`
  return `${hb.length} B, ${hb.is4t4r ? '4T4R' : '2T2R'}, ${rx}; ${tx || 'no TX'}; NC ${hb.denoiseSwitch ? `on L${hb.denoiseLevel}` : 'off'}, ` +
    `vol ${hb.volumeLevel}, ${mode}${hb.isRefreshCanto ? ', profiles changed' : ''}`
}

// ------------------------------------------------------------------------------------------- other replies

export interface M3DeviceInfo {
  deviceId: number
  /** NUL-terminated ASCII / UTF-8, trimmed (A Device6303DataManager.cacheDeviceSn trims). */
  serial: string
  /** "a.b.c.d" (unsigned bytes; A DeviceInfo6303ViewModel joins the signed values, which only differs above 127). */
  version: string
  /** "AA:BB:CC:DD:EE:FF" (A DeviceInfo6303ViewModel: "%02X" joined with ":"). */
  mac: string
}

/**
 * 0x600A reply, 25 bytes (A HLAudioGetDeviceInfoResponseEntitySerializer): deviceId, interval1, sn[11] (cut at the
 * first 0), interval2, version[4], interval3, mac[6]. iOS models the same reply as snStr / macStr / countryStr
 * (I HL6303DeviceInfoResponse), so one separator may be a country code [?]. Null when shorter than 25 bytes.
 */
export function parseM3DeviceInfo(p: Uint8Array): M3DeviceInfo | null {
  if (p.length < 25) return null
  let end = 2
  while (end < 13 && p[end] !== 0) end++
  const serial = new TextDecoder('utf-8', { fatal: false }).decode(p.subarray(2, end)).trim()
  const version = Array.from(p.subarray(14, 18)).join('.')
  const mac = Array.from(p.subarray(19, 25), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':')
  return { deviceId: p[0], serial, version, mac }
}

export interface M3FirmwareItem {
  /** Payload device id (1–4 TX, 6–9 RX, 10 hot shoe). */
  id: number
  /** "a.b.c.d" (A VersionUtilKt.getVersionString: bytes & 255 joined with "."). */
  version: string
}

/** 0x6012 reply: up to 9 × {id u8, version[4]} (A HLGetFirmwareVerResponseEntitySerializer, HLFirmwareVerItemEntitySerializer). */
export function parseM3FirmwareVersions(p: Uint8Array): M3FirmwareItem[] {
  const out: M3FirmwareItem[] = []
  for (let i = 0; i < 9 && i * 5 + 5 <= p.length; i++) {
    const o = i * 5
    out.push({ id: p[o], version: Array.from(p.subarray(o + 1, o + 5)).join('.') })
  }
  return out
}

/** "0.0.0.0" and empty versions mean "not known" (A HLDeviceVolTrack6303ViewModel retries 0x6012 after 2 s on 0.0.0.0). */
export function isM3VersionKnown(v: string | undefined): v is string {
  return !!v && !/^0(\.0)*$/.test(v)
}

export interface M3SettingInfo {
  /** 0 = success (A MoreSetting6303ViewModel.handleNotification: isSuccess() == 0, else retry up to 5×). */
  isSuccess: number
  /** 0 = 24-bit, 1 = 32-bit float. */
  sampling: number
  /** "Playback without unplugging". */
  soundOut: boolean
  micLock: boolean
  micAutoExit: boolean
}

/** 0x6011 reply [isSuccess, sampling, outSound, micLock, micAutoExit] (A HLSettingInfoResponseEntitySerializer). */
export function parseM3SettingInfo(p: Uint8Array): M3SettingInfo | null {
  if (p.length < 5) return null
  return { isSuccess: p[0], sampling: p[1], soundOut: p[2] === 1, micLock: p[3] === 1, micAutoExit: p[4] === 1 }
}

/** 0x100E reply [dev, gear1, gear2, gear3] (A HLAudioGetGainLevelResponseEntity) → dB (wire − 10, coerced to −10…+10). */
export function parseM3CameraGains(p: Uint8Array): [number, number, number] | null {
  if (p.length < 4) return null
  const db = (w: number) => Math.max(M3_CAMERA_GAIN_DB.MIN, Math.min(M3_CAMERA_GAIN_DB.MAX, w - M3_CAMERA_GAIN_DB.WIRE_OFFSET))
  return [db(p[1]), db(p[2]), db(p[3])]
}

/**
 * New camera levels after setting one of them, keeping "Level 1 ≤ Level 2 ≤ Level 3" (R rx_volume_desc). The app
 * repairs an out-of-order triple with the smallest total change (A BottomCameraRxDialog.runConstraintCheck), which
 * can undo the slider the user just moved; this library keeps the requested level and moves the neighbours instead.
 * Either way only ordered triples are sent.
 */
export function m3CameraGainsWith(current: readonly [number, number, number], level: 0 | 1 | 2, db: number): [number, number, number] {
  const g: [number, number, number] = [current[0], current[1], current[2]]
  g[level] = db
  for (let i = level - 1; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1])
  for (let i = level + 1; i < 3; i++) g[i] = Math.max(g[i], g[i - 1])
  return g
}

/** Single-value GET replies of the form [deviceId, value] (A HLGet*ResponseEntity: DeviceId(), value). */
export function parseM3DevValue(p: Uint8Array): { deviceId: number; value: number } | null {
  return p.length >= 2 ? { deviceId: p[0], value: p[1] } : null
}

/** 0x1002 reply [dev, level, on] (A HLGetNoiseStatusResponseEntity: DeviceId, NoiseLevel, NoiseStatus). */
export function parseM3Noise(p: Uint8Array): { level: number; on: boolean } | null {
  return p.length >= 3 ? { level: p[1], on: p[2] === 1 } : null
}

/** 0x0039 reply 39 B {mac[6], btName[33] UTF-8} (A HLBtStatusForHeartEntity). */
export function parseM3BtStatus(p: Uint8Array): { mac: string; name: string } | null {
  if (p.length < 6) return null
  const mac = Array.from(p.subarray(0, 6), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':')
  let end = 6
  while (end < Math.min(p.length, 39) && p[end] !== 0) end++
  return { mac, name: new TextDecoder('utf-8', { fatal: false }).decode(p.subarray(6, end)) }
}

/** Camera levels as control values. */
export function m3CameraGainValues(g: readonly [number, number, number]): Partial<Record<ControlId, ControlValue>> {
  return { [M3_CONTROL.CAMERA_LEVEL_1]: g[0], [M3_CONTROL.CAMERA_LEVEL_2]: g[1], [M3_CONTROL.CAMERA_LEVEL_3]: g[2] }
}

