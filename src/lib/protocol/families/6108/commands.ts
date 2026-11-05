/**
 * LARK A1 (6108) command table and request builders (docs/research/families/a1-6108.md §5).
 *
 * IDs: A application/common/protocol/ProtocolV2 `HID_*` constants and usbmic/protocolV2/ProtocolFactoryV2.createProtocol.
 * Senders and payloads: A usbmic/messenger/UsbMessengerV2. iOS confirmation: I -[HL6108EventMapper eventTypeForCommand:]
 * @0x10001e120 (jump table @0x100c160c8) and I -[HL6108DefaultPayloadCodec payloadForAction:deviceType:] @0x1002e0760.
 *
 * The ids collide with the legacy `AA DD` table with different meanings (0x05 is reverb here, volume on the A2), so
 * this table is separate from commands.ts. Every setter takes an absolute value (no toggles, unlike the legacy 0x19).
 *
 * Safety classes (FAMILIES.md §2.3, enforced by core/engine.ts from this catalogue):
 *  - 'disruptive' reboot 0x0C, speaker 0x25 (hidden on the A1; other models reboot after it): need { confirm }
 *  - 'destructive' 0x3C / 0x3D (2↔4-mic mode-switch flow, the mics must be re-paired): refused on untested products
 *  - 'ota' 0x1A..0x1E (Feature 6 DFU), 0x2C, 0x2D, 0x3E: always refused; firmware update is never implemented
 */
import type { CommandCatalogue } from '../../core/types'

export const A1Cmd = {
  SET_VOICE_MODE: 0x01,
  GET_VOICE_MODE: 0x02,
  SET_VOICE_LEVEL: 0x03,
  GET_VOICE_LEVEL: 0x04,
  SET_REVERB: 0x05,
  GET_REVERB: 0x06,
  SET_EQ: 0x07,
  GET_EQ: 0x08,
  SET_DEVICE_REBOOT: 0x0c,
  GET_DEVICE_VERSION: 0x0d,
  GET_DEVICE_SN: 0x12,
  SET_NOISE: 0x13,
  GET_NOISE: 0x14,
  SET_TX_MUTE: 0x16,
  OTA_DFU_RX_UPGRADE: 0x1a,
  OTA_DFU_TX_UPGRADE: 0x1b,
  OTA_DFU_ENTER: 0x1c,
  OTA_DFU_DATA: 0x1d,
  OTA_DFU_VERIFY: 0x1e,
  GET_HEART_INFO: 0x1f,
  SET_LIGHT: 0x21,
  GET_LIGHT: 0x22,
  SET_TX_IDENTIFY: 0x23,
  GET_TX_IDENTIFY: 0x24,
  SET_SPEAKER: 0x25,
  GET_SPEAKER: 0x26,
  SET_SHUTDOWN_TIME: 0x27,
  GET_SHUTDOWN_TIME: 0x28,
  OTA_DEVICE: 0x2c,
  UPGRADE_RESULT: 0x2d,
  GET_DEVICE_MAC_RX: 0x30,
  GET_DEVICE_MAC_TX: 0x31,
  REFRESH_RX: 0x3c,
  RX_INTO_PAIR: 0x3d,
  TX_INTO_OTA: 0x3e,
  SET_SIGNAL_MODE: 0x3f,
  GET_SIGNAL_MODE: 0x40,
  GET_MODE_FAIL_REASON: 0x41,
  SET_PERFORMANCE_MODE: 0x45,
  GET_PERFORMANCE_MODE: 0x46,
} as const

export type A1CmdId = (typeof A1Cmd)[keyof typeof A1Cmd]

const PV2 = 'A application/common/protocol/ProtocolV2'
const MSG = 'A usbmic/messenger/UsbMessengerV2'
const PRO = 'A usbmic/protocolV2'

/** Every A1 command id, including the documented-only OTA and mode-switch ids so the engine can refuse them. */
export const A1_COMMANDS: CommandCatalogue = {
  // ---------------------------------------------------------------- reads used by the apps
  [A1Cmd.GET_HEART_INFO]: {
    name: 'GET_HEART_INFO', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_HEART_INFO; ${PRO}/ProGetHearInfo.receiveData; ${MSG}.getHeartInfo; larkc1/HLDevice6302Activity$mRunnable$1.run (1 s); I -[HLDeviceController sendHeartInfo] @0x1002c4998 (3 s), -[HLHeartEntity initA1HeartInfo:] @0x1001fa798`,
    description: 'Status poll: mics online / battery / mute and every setting (body 17, 22 or 23 bytes).',
  },
  [A1Cmd.GET_DEVICE_VERSION]: {
    name: 'GET_DEVICE_VERSION', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_DEVICE_VERSION; ${PRO}/ProGetDeviceVersion.receiveData; ${MSG}.getDeviceVersion([unit]); I +[HL6108Messenger sendGetDeviceVersionWithType:] @0x1002e106c`,
    description: 'Payload [unit 0 RX, 1..4 TX]; reply [unit, decimal version parts…].',
  },
  [A1Cmd.GET_DEVICE_SN]: {
    name: 'GET_DEVICE_SN', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_DEVICE_SN; ${PRO}/ProGetDeviceSn.receiveData; ${MSG}.getSn([unit]); I +[HL6108Messenger …] @0x1002e10ec`,
    description: 'Payload [unit]; reply [unit, ASCII…] (0x00 / 0xFF dropped).',
  },
  [A1Cmd.GET_DEVICE_MAC_RX]: {
    name: 'GET_DEVICE_MAC_RX', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_DEVICE_MAC_RX; ${PRO}/ProGetDeviceMacRX.receiveData; ${MSG}.getMac(RX); I sendGetDeviceTXMacWithType @0x1002e116c (misnamed)`,
  },
  [A1Cmd.GET_DEVICE_MAC_TX]: {
    name: 'GET_DEVICE_MAC_TX', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_DEVICE_MAC_TX; ${PRO}/ProGetDeviceMacTX.receiveData; ${MSG}.getMac(TXn) payload [n - 1]; I sendGetDeviceRXMacWithType: @0x1002e11b8 (misnamed)`,
    description: 'Payload [TX index 0..3]; reply [TX index, MAC…].',
  },
  [A1Cmd.GET_SIGNAL_MODE]: {
    name: 'GET_SIGNAL_MODE', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_SIGNAL_MODE; ${PRO}/ProGetSignalMode.receiveData; ${MSG}.getSignalMode; blemic/setting/SignalModeActivity.onCreate`,
  },
  [A1Cmd.GET_MODE_FAIL_REASON]: {
    name: 'GET_MODE_FAIL_REASON', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_MODE_FAIL_REASON; ${PRO}/ProGetModeFailReason.receiveData; ${MSG}.getModeFailReason (after a failed 0x3F)`,
  },
  [A1Cmd.GET_PERFORMANCE_MODE]: {
    name: 'GET_PERFORMANCE_MODE', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_PERFORMANCE_MODE; ${PRO}/ProGetPerformanceMode.receiveData; ${MSG}.getPerformanceMode; larkc1/viewmodel/HLDevice6302ViewModel.handleDeviceMac; I +[HL6108Messenger …] @0x1002e16d8`,
    description: 'Hidden cloud-driven "performance mode" flag: reply [1 = on].',
  },
  [A1Cmd.GET_VOICE_MODE]: {
    name: 'GET_VOICE_MODE', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_VOICE_MODE; ${PRO}/ProGetVoiceMode; I +[HL6108Messenger getDeviceInitialInfo] @0x1002e0dd8 (start-up), -[HL6108DeviceInfoSync queryCommandForSetCommand:] @0x100204d88`,
    description: 'No Android A1 caller; iOS start-up and read-back after 0x01.',
  },
  [A1Cmd.GET_EQ]: {
    name: 'GET_EQ', safety: 'read', retrySafe: true,
    source: `${PV2}.HID_GET_EQ; ${PRO}/ProGetEQ; I +[HL6108Messenger getDeviceInitialInfo] @0x1002e0dd8, queryCommandForSetCommand: @0x100204d88`,
    description: 'No Android A1 caller; iOS start-up and read-back after 0x07.',
  },
  // ---------------------------------------------------------------- reads without an A1 caller (a1-6108.md §8 #7)
  [A1Cmd.GET_VOICE_LEVEL]: {
    name: 'GET_VOICE_LEVEL', safety: 'read', retrySafe: true, source: `${PV2}.HID_GET_VOICE_LEVEL; ${PRO}/ProGetVoiceLevel (default 1)`,
    description: 'No A1 caller in either app (the heartbeat carries the volume).',
  },
  [A1Cmd.GET_REVERB]: {
    name: 'GET_REVERB', safety: 'read', retrySafe: true, source: `${PV2}.HID_GET_REVERB; ${PRO}/ProGetReverb`,
    description: 'No caller in either app.',
  },
  [A1Cmd.GET_NOISE]: {
    name: 'GET_NOISE', safety: 'read', retrySafe: true, source: `${PV2}.HID_GET_NOISE; ${PRO}/ProGetNoise.receiveData ([on, level])`,
    description: 'No A1 caller (the heartbeat carries NC).',
  },
  [A1Cmd.GET_LIGHT]: { name: 'GET_LIGHT', safety: 'read', retrySafe: true, source: `${PV2}.HID_GET_LIGHT (constant only, no class)`, description: 'Reply layout unknown.' },
  [A1Cmd.GET_TX_IDENTIFY]: { name: 'GET_TX_IDENTIFY', safety: 'read', retrySafe: true, source: `${PV2}.HID_GET_TX_IDENTIFY (constant only)`, description: 'Reply layout unknown.' },
  [A1Cmd.GET_SPEAKER]: { name: 'GET_SPEAKER', safety: 'read', retrySafe: true, source: `${PV2}.HID_GET_SPEAKER; ${MSG}.getSpeaker (empty body)`, description: 'Reply layout unknown.' },
  [A1Cmd.GET_SHUTDOWN_TIME]: { name: 'GET_SHUTDOWN_TIME', safety: 'read', retrySafe: true, source: `${PV2}.HID_GET_SHUTDOWN_TIME (constant only)`, description: 'Reply layout unknown.' },

  // ---------------------------------------------------------------- settings (ack body[0] == 0)
  [A1Cmd.SET_NOISE]: {
    name: 'SET_NOISE', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_NOISE; ${PRO}/ProSetNoise; ${MSG}.setNoiseLevel(level, isOpen) → [isOpen, level]; I action6108SetNoiseOpen:level:`,
    description: '[on 0/1, level 0 Weak / 1 Medium / 2 Strong] (DeviceConnectVariable.NoiseLevelType).',
  },
  [A1Cmd.SET_VOICE_LEVEL]: {
    name: 'SET_VOICE_LEVEL', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_VOICE_LEVEL; ${PRO}/ProSetVoiceLevel; ${MSG}.setVoice; application/common/widget/CustomScaleSeekBar (6 steps); I action6108SetVoiceLevel:`,
    description: '[index 0..5].',
  },
  [A1Cmd.SET_VOICE_MODE]: {
    name: 'SET_VOICE_MODE', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_VOICE_MODE; ${PRO}/ProSetVoiceMode; ${MSG}.setVoiceMode; I action6108SetVocalMode:`,
    description: '[0 Mono / 1 Stereo].',
  },
  [A1Cmd.SET_EQ]: {
    name: 'SET_EQ', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_EQ; ${PRO}/ProSetEQ; ${MSG}.setEQ; blemic/device/DeviceConnectVariable.EQ; I eqValueForSelectedIndex: @0x1002e0bac`,
    description: '[1 Low / 2 Bright / 3 Equalization].',
  },
  [A1Cmd.SET_REVERB]: {
    name: 'SET_REVERB', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_REVERB; ${PRO}/ProSetReverb; ${MSG}.setReverb(value, isOpen) → [isOpen, value]; DeviceConnectVariable.Reverb; I action6108SetReverbOpen:level:`,
    description: '[on 0/1, level 0 Small / 1 Medium / 2 Large].',
  },
  [A1Cmd.SET_TX_MUTE]: {
    name: 'SET_TX_MUTE', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_TX_MUTE; ${PRO}/ProSetTxMute; ${MSG}.setTxMute → [coerceIn(ordinal - 1, 0, 3), mute]; I action6108SetMuteIndex:isOpen:`,
    description: '[TX index 0..3 (TX1 = 0), 1 mute / 0 unmute]. App row needs RX firmware >= 1.0.1.3.',
  },
  [A1Cmd.SET_LIGHT]: {
    name: 'SET_LIGHT', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_LIGHT; ${PRO}/ProSetLight; ${MSG}.setLight; I action6108SetLightOpen: ([!isOpen])`,
    description: '[0 = on, 1 = off].',
  },
  [A1Cmd.SET_TX_IDENTIFY]: {
    name: 'SET_TX_IDENTIFY', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_TX_IDENTIFY; ${PRO}/ProSetTxIdentify; ${MSG}.setTxIdentify; I action6108SetTXCheckOpen:`,
    description: '"Mic Recognition": [1 on / 0 off].',
  },
  [A1Cmd.SET_SHUTDOWN_TIME]: {
    name: 'SET_SHUTDOWN_TIME', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_SHUTDOWN_TIME; ${PRO}/ProSetShutdownTime; ${MSG}.setShutdownTime; I action6108SetShutdown:`,
    description: '"Schedule power off": [0 = 15 min, 1 = Never].',
  },
  [A1Cmd.SET_SIGNAL_MODE]: {
    name: 'SET_SIGNAL_MODE', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_SIGNAL_MODE; ${PRO}/ProSetSignalMode; ${MSG}.setSignalMode; blemic/setting/SignalModeActivity; I read-back 0x46 (queryCommandForSetCommand: @0x100204d88)`,
    description: '"Mode setting": [0 Normal / 1 Performance]; behind the cloud flag ModeSwitch in the app. On failure the app sends 0x41.',
  },
  [A1Cmd.SET_PERFORMANCE_MODE]: {
    name: 'SET_PERFORMANCE_MODE', safety: 'write', retrySafe: true,
    source: `${PV2}.HID_SET_PERFORMANCE_MODE; ${PRO}/ProSetPerformanceMode; ${MSG}.setPerformanceMode; HLDevice6302ViewModel.handlePerformanceMode (cloud EnhancedModeSwitch); I +[HL6108Messenger sendSetPerformanceEnabled:] @0x1002e165c`,
    description: 'Hidden flag the apps sync from the cloud: [1 on / 0 off]. No UI in either app.',
  },

  // ---------------------------------------------------------------- restart-causing (confirm per call)
  [A1Cmd.SET_DEVICE_REBOOT]: {
    name: 'SET_DEVICE_REBOOT', safety: 'disruptive', retrySafe: false,
    source: `${PV2}.HID_SET_DEVICE_REBOOT; ${PRO}/ProSetDeviceReboot; ${MSG}.setRestart`,
    description: 'Reboots the receiver. Only reachable after a speaker change, which the A1 app hides (a1-6108.md §8 #8).',
  },
  [A1Cmd.SET_SPEAKER]: {
    name: 'SET_SPEAKER', safety: 'disruptive', retrySafe: false,
    source: `${PV2}.HID_SET_SPEAKER; ${PRO}/ProSetSpeaker; ${MSG}.setSpeaker ([0 on / 1 off]); the "Phone Speaker" row is hidden for 1031 (HLDevice6302Activity.initView)`,
    description: 'Hidden on the A1; on other models the app reboots the RX after it. Classed disruptive until tested.',
  },

  // ---------------------------------------------------------------- 2↔4-mic mode switch (re-pairing)
  [A1Cmd.REFRESH_RX]: {
    name: 'REFRESH_RX', safety: 'destructive', retrySafe: false,
    source: `${PV2}.HID_REFRESH_RX; ${PRO}/ProRefreshRx; ${MSG}.setRefreshRx; blemic/setting/ModeSwitchActivity.startRefreshRx; I event 15`,
    description: 'Part of the wireless 2↔4-mic switch (after the TX re-flash). Never used by Hollyland Web UI.',
  },
  [A1Cmd.RX_INTO_PAIR]: {
    name: 'RX_INTO_PAIR', safety: 'destructive', retrySafe: false,
    source: `${PV2}.HID_RX_INTO_PAIR; ${PRO}/ProSetRxIntoPair; ${MSG}.setRxIntoPair; ModeSwitchActivity.sendRxIntoPair`,
    description: 'Puts the RX into pairing mode during the mode switch; mics must be re-paired.',
  },

  // ---------------------------------------------------------------- firmware update: always refused
  [A1Cmd.OTA_DEVICE]: {
    name: 'OTA_DEVICE', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_OTA_DEVICE; ${PRO}/ProSetUpgradeDevice; ${MSG}.setUpgradeDevice ([0 RX+TX / 1 RX / 2 TX], DeviceConnectVariable.UpgradeDeviceType)`,
  },
  [A1Cmd.UPGRADE_RESULT]: {
    name: 'UPGRADE_RESULT', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_UPGRADE_RESULT; ${PRO}/ProGetUpgradeResult; ${MSG}.getUpgradeResult; ModeSwitchActivity.startAskTxOTAResult (3 s poll)`,
    description: 'A GET, but only meaningful during a firmware update: classed ota so nothing sends it.',
  },
  [A1Cmd.TX_INTO_OTA]: {
    name: 'TX_INTO_OTA', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_TX_INTO_OTA; ${PRO}/ProSetTxIntoOTA; ${MSG}.setTxIntoOTA; I event 16`,
  },
  [A1Cmd.OTA_DFU_RX_UPGRADE]: {
    name: 'OTA_DFU_RX_UPGRADE', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_OTA_DFU_RX_UPGRADE; ${PRO}/ProRxUpgrade; ${MSG}.sendRxUpgrade (Feature 6, 160 B, service 0)`,
  },
  [A1Cmd.OTA_DFU_TX_UPGRADE]: {
    name: 'OTA_DFU_TX_UPGRADE', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_OTA_DFU_TX_UPGRADE; ${PRO}/ProTxUpgrade; ${MSG}.sendTxUpgrade (Feature 6, service 0)`,
  },
  [A1Cmd.OTA_DFU_ENTER]: {
    name: 'OTA_DFU_ENTER', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_OTA_DFU_ENTER; ${PRO}/ProOTADfuEnter; ${MSG}.enterDfu (Feature 6, service 2: type, version, size u32 LE)`,
  },
  [A1Cmd.OTA_DFU_DATA]: {
    name: 'OTA_DFU_DATA', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_OTA_DFU_DATA; ${PRO}/ProOTADfuData; ${MSG}.sendOTAPkg (offset u32 LE + 128 B, DeviceDataManager.USB_DATA_PKT_SIZE_6108)`,
  },
  [A1Cmd.OTA_DFU_VERIFY]: {
    name: 'OTA_DFU_VERIFY', safety: 'ota', retrySafe: false,
    source: `${PV2}.HID_OTA_DFU_VERIFY; ${PRO}/ProOTADfuVerify; ${MSG}.verifyCrc (Feature 6, service 2)`,
  },
}

export function a1CommandName(cmd: number): string {
  return A1_COMMANDS[cmd]?.name ?? `0x${cmd.toString(16).padStart(2, '0').toUpperCase()}`
}

// ------------------------------------------------------------------------------- values

/** NC strength on the wire (A blemic/device/DeviceConnectVariable.NoiseLevelType; "Medium" exists only on the 6108). */
export const A1NoiseLevel = { WEAK: 0, MEDIUM: 1, STRONG: 2 } as const
/** EQ preset on the wire (A DeviceConnectVariable.EQ OVERCAST/BRIGHT/BALANCE; R "Low" / "Bright" / "Equalization"). */
export const A1Eq = { LOW: 1, BRIGHT: 2, EQUALIZATION: 3 } as const
/** Reverb size on the wire (A DeviceConnectVariable.Reverb GEAR_ONE/TWO/THREE; R "Small" / "Medium" / "Large"). */
export const A1ReverbLevel = { SMALL: 0, MEDIUM: 1, LARGE: 2 } as const
/** Channel mode (A ProSetVoiceMode; R "Mono" / "Stereo"). */
export const A1ChannelMode = { MONO: 0, STEREO: 1 } as const
/** "Schedule power off" (A ProSetShutdownTime; R "15min" / "Never"). */
export const A1ShutdownTime = { MIN_15: 0, NEVER: 1 } as const
/** "Mode setting" (A ProSetSignalMode; R "Normal mode" / "Performance mode"). */
export const A1SignalMode = { NORMAL: 0, PERFORMANCE: 1 } as const
/** Volume steps (A CustomScaleSeekBar.totalCount = 6; a1-6108.md §4.2 body[8]). */
export const A1_VOLUME_STEPS = 6

// ------------------------------------------------------------------------------- units

/** Units an A1 kit can have: RX + up to four mics (2 Mic & 1 RX or 4 Mic & 1 RX firmware). */
export type A1UnitId = 'rx' | 'tx1' | 'tx2' | 'tx3' | 'tx4'
export type A1TxUnitId = Exclude<A1UnitId, 'rx'>
export const A1_UNITS: readonly A1UnitId[] = ['rx', 'tx1', 'tx2', 'tx3', 'tx4']
export const A1_TX_UNITS: readonly A1TxUnitId[] = ['tx1', 'tx2', 'tx3', 'tx4']

/** Unit byte of 0x0D / 0x12 (A application/common/protocol/Protocol.HLDeviceType ordinal: RX 0, TX1..TX4 1..4). */
export function a1UnitByte(unit: A1UnitId): number {
  return A1_UNITS.indexOf(unit)
}

/** Unit of a reply's unit byte (A ProGetDeviceVersion / ProGetDeviceSn: RangesKt.coerceIn(data[0], 0, 4)). */
export function a1UnitOfByte(b: number): A1UnitId {
  return A1_UNITS[Math.min(4, Math.max(0, b | 0))]
}

/** 0-based TX index of 0x16 / 0x31 (A UsbMessengerV2.setTxMute / getMac: ordinal - 1; TX1 = 0). */
export function a1TxIndex(unit: A1TxUnitId): number {
  return A1_TX_UNITS.indexOf(unit)
}

/** Unit of a 0-based TX index (A ProGetDeviceMacTX: coerceIn(data[0] + 1, 0, 4)). */
export function a1TxOfIndex(index: number): A1UnitId {
  return a1UnitOfByte(index + 1)
}

// ------------------------------------------------------------------------------- requests

/** One A1 request: command + payload bytes (encodeA1Frame builds the 64-byte report). */
export interface A1Request {
  cmd: number
  payload?: readonly number[]
}

function int(name: string, v: number, min: number, max: number): number {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} must be an integer in ${min}..${max}, got ${v}`)
  return v
}

function isA1Unit(u: string): u is A1UnitId {
  return (A1_UNITS as readonly string[]).includes(u)
}

function unitArg(u: string): A1UnitId {
  if (!isA1Unit(u)) throw new RangeError(`not an A1 unit: ${u} (rx, tx1..tx4)`)
  return u
}

function txArg(u: string): A1TxUnitId {
  if (!(A1_TX_UNITS as readonly string[]).includes(u)) throw new RangeError(`not an A1 mic: ${u} (tx1..tx4)`)
  return u as A1TxUnitId
}

/**
 * Request builders, payloads as A UsbMessengerV2 builds them. Only the commands the apps use, plus the GETs; no
 * builder exists for the disruptive, destructive and OTA ids (they stay catalogue-only).
 */
export const A1Requests = {
  /** 0x1F, empty payload. A UsbMessengerV2.getHeartInfo. */
  heartbeat: (): A1Request => ({ cmd: A1Cmd.GET_HEART_INFO }),
  /** 0x0D [unit]. A UsbMessengerV2.getDeviceVersion: saveReserved([deviceType.ordinal()]). */
  version: (unit: A1UnitId): A1Request => ({ cmd: A1Cmd.GET_DEVICE_VERSION, payload: [a1UnitByte(unitArg(unit))] }),
  /** 0x12 [unit]. A UsbMessengerV2.getSn. */
  serial: (unit: A1UnitId): A1Request => ({ cmd: A1Cmd.GET_DEVICE_SN, payload: [a1UnitByte(unitArg(unit))] }),
  /** 0x30, empty payload. A UsbMessengerV2.getMac(HL_DEVICE_TYPE_RX). */
  rxMac: (): A1Request => ({ cmd: A1Cmd.GET_DEVICE_MAC_RX }),
  /** 0x31 [TX index]. A UsbMessengerV2.getMac(TXn): saveReserved([ordinal - 1]). */
  txMac: (unit: A1TxUnitId): A1Request => ({ cmd: A1Cmd.GET_DEVICE_MAC_TX, payload: [a1TxIndex(txArg(unit))] }),
  /** 0x13 [on, level]. A UsbMessengerV2.setNoiseLevel(level, isOpen). */
  setNoise: (on: boolean, level: number): A1Request => ({ cmd: A1Cmd.SET_NOISE, payload: [on ? 1 : 0, int('NC level', level, 0, 2)] }),
  /** 0x14. A ProGetNoise (no A1 caller). */
  getNoise: (): A1Request => ({ cmd: A1Cmd.GET_NOISE }),
  /** 0x03 [index]. A UsbMessengerV2.setVoice. */
  setVolume: (index: number): A1Request => ({ cmd: A1Cmd.SET_VOICE_LEVEL, payload: [int('volume', index, 0, A1_VOLUME_STEPS - 1)] }),
  /** 0x04. A ProGetVoiceLevel (no A1 caller). */
  getVolume: (): A1Request => ({ cmd: A1Cmd.GET_VOICE_LEVEL }),
  /** 0x01 [mode]. A UsbMessengerV2.setVoiceMode. */
  setChannelMode: (mode: number): A1Request => ({ cmd: A1Cmd.SET_VOICE_MODE, payload: [int('channel mode', mode, 0, 1)] }),
  /** 0x02. I start-up and read-back after 0x01. */
  getChannelMode: (): A1Request => ({ cmd: A1Cmd.GET_VOICE_MODE }),
  /** 0x07 [1 Low / 2 Bright / 3 Equalization]. A UsbMessengerV2.setEQ. */
  setEq: (eq: number): A1Request => ({ cmd: A1Cmd.SET_EQ, payload: [int('EQ', eq, 1, 3)] }),
  /** 0x08. I start-up and read-back after 0x07. */
  getEq: (): A1Request => ({ cmd: A1Cmd.GET_EQ }),
  /** 0x05 [on, level]. A UsbMessengerV2.setReverb(value, isOpen). */
  setReverb: (on: boolean, level: number): A1Request => ({ cmd: A1Cmd.SET_REVERB, payload: [on ? 1 : 0, int('reverb level', level, 0, 2)] }),
  /** 0x06. A ProGetReverb (no caller). */
  getReverb: (): A1Request => ({ cmd: A1Cmd.GET_REVERB }),
  /** 0x16 [TX index, mute]. A UsbMessengerV2.setTxMute. */
  setTxMute: (unit: A1TxUnitId, muted: boolean): A1Request => ({ cmd: A1Cmd.SET_TX_MUTE, payload: [a1TxIndex(txArg(unit)), muted ? 1 : 0] }),
  /** 0x21 [0 = on, 1 = off]. A UsbMessengerV2.setLight; I action6108SetLightOpen: sends [!isOpen]. */
  setLed: (on: boolean): A1Request => ({ cmd: A1Cmd.SET_LIGHT, payload: [on ? 0 : 1] }),
  /** 0x23 [1 on / 0 off]. A UsbMessengerV2.setTxIdentify. */
  setMicRecognition: (on: boolean): A1Request => ({ cmd: A1Cmd.SET_TX_IDENTIFY, payload: [on ? 1 : 0] }),
  /** 0x27 [0 = 15 min, 1 = Never]. A UsbMessengerV2.setShutdownTime. */
  setShutdownTime: (value: number): A1Request => ({ cmd: A1Cmd.SET_SHUTDOWN_TIME, payload: [int('shutdown time', value, 0, 1)] }),
  /** 0x3F [0 Normal / 1 Performance]. A UsbMessengerV2.setSignalMode. */
  setSignalMode: (mode: number): A1Request => ({ cmd: A1Cmd.SET_SIGNAL_MODE, payload: [int('signal mode', mode, 0, 1)] }),
  /** 0x40. A UsbMessengerV2.getSignalMode. */
  getSignalMode: (): A1Request => ({ cmd: A1Cmd.GET_SIGNAL_MODE }),
  /** 0x41. A UsbMessengerV2.getModeFailReason. */
  getModeFailReason: (): A1Request => ({ cmd: A1Cmd.GET_MODE_FAIL_REASON }),
  /** 0x45 [1 on / 0 off]. A UsbMessengerV2.setPerformanceMode (hidden, cloud-driven). */
  setPerformanceMode: (on: boolean): A1Request => ({ cmd: A1Cmd.SET_PERFORMANCE_MODE, payload: [on ? 1 : 0] }),
  /** 0x46. A UsbMessengerV2.getPerformanceMode. */
  getPerformanceMode: (): A1Request => ({ cmd: A1Cmd.GET_PERFORMANCE_MODE }),
} as const
