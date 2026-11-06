/**
 * LARK MAX 2 (family 6701) command catalogue, request builders and value enums.
 * docs/research/families/max2-6701.md §3, §5. Every id is a constant of
 * A blemic/operation/BleMicCommUtil (CMD_APP_* strings, "0x600B" → 0x600B, big-endian on the wire), built by
 * A blemic/operation/BleMicCmd (cmdSingleSend: empty payload, cmdMultiSend: with payload, cmdMultiMapSend: "get all").
 * iOS builds the same frames through +[NSData requestCommand:payload:needStartEnd:deviceType:] @0x10011d320, but
 * picks the BLE target differently for TX3/TX4 (see MAX2_BLE_TARGET).
 *
 * GET and SET share one id (a GET is the same item with an empty payload, A BleMicCmd.cmdSingleSend vs cmdMultiSend),
 * so the catalogue is keyed by the request FORM, not the wire id alone (FamilyDriver.commands, ProtocolSpec.commandOf):
 *  - `cmd`              the SET form (payload present), classed by what the write does
 *  - `max2GetKey(cmd)`  the GET form (empty payload) of a settable id, always 'read'
 *  - `MAX2_OWS_UNPAIR_KEY` 0x6017 with a non-zero payload ("Delete pairing"), 'destructive'
 * Pure reads (0x600A [unit], 0x600B, 0x6014, 0x8044 …) keep their wire id as key. `max2ItemKey()` maps an item to its
 * key; the engine applies the safety rules (FAMILIES.md §2.3) per key, so a background GET of 0x6003 is a read while
 * the SET of 0x6003 (restarts the RX) needs a confirm.
 */
import { hex16 } from '../../core/bytes'
import type { CommandCatalogue, CommandSpec, Safety } from '../../core/types'
import { decodeMomaFrame, type MomaItemInput } from '../../moma/codec'
import { momaBatch, momaRequest, type MomaRequest } from '../../moma/spec'

export { MAX2_TC_MODE, MAX2_TIMING } from './ids'

// ------------------------------------------------------------------------------------- wire ids

/** A blemic/operation/BleMicCommUtil CMD_APP_* / CMD_UAC_* (max2-6701.md §5). */
export const MAX2_CMD = {
  /** Push [battery] (A generateBoxBatteryInfo: payload[0]). */
  BOX_BATTERY: 0x6000,
  /** Push [battery] (A generateRxBatteryInfo). */
  RX_BATTERY: 0x6001,
  /** Push [tx1Online, tx1Battery, tx2Online, tx2Battery] (A generateTxInfo). */
  MIC_BATTERY: 0x6002,
  /** "Phone Speaker" [1 on / 0 off]; a successful set restarts the RX (A HLBleDeviceActivity RxOutSwitchState → CountDownDialog). */
  RX_OUTSWITCH: 0x6003,
  /** "Internal Recording Depth" [0 32-bit float, 1 24-bit] (A DeviceConnectVariable.RxSamplingType). */
  RX_SAMPLING: 0x6004,
  /** "Lock Mic" [1/0]. */
  MIC_LOCK: 0x6005,
  /** "NC" [on, depth 0..20]; GET reply [on, depth] (A generateNoiseLevelStatus: depth only for type 3). */
  NOISE_LEVEL: 0x6006,
  /** Gain [type, level, g1, g2(, g3, g4)] (A generateVoiceGainStatus; BleDeviceControlViewModel.processUserIntent SetVoiceGainIntent). */
  VOICE_GAIN: 0x6007,
  /** "Channel Mode" [0 mono, 1 stereo, 2 safety track] (A DeviceConnectVariable.VocalTractType). */
  VOCAL_TRACT: 0x6008,
  /** System time, BE64 local-time ms (A NumberUtil.longToByte8(Utils.localZoneTime())). */
  SYSTEM_TIME: 0x6009,
  /** Version / battery of one unit: request [unit], reply 52 B (A generateDeviceVersionInfo). */
  DEVICE_VERSION: 0x600a,
  /** Heartbeat, reply 33 or 49 B (A generateHeartInfo; I -[HLBleHeartEntity initEntityWithData:] @0x1001fb0ac). */
  HEART_INFO: 0x600b,
  OTA_FIRMWARE_VERSION: 0x600c,
  START_OTA_UPGRADE: 0x600d,
  /** "Timecode Mode" [0,1,2] = Mode 1/2/3 (A DeviceConnectVariable.TcMode). */
  TC_MODE: 0x600e,
  /** "Timecode Frame Rate" [0..8] (A DeviceConnectVariable.InputFps). */
  INPUT_FPS: 0x600f,
  /** "Timing Method" [0 from zero, 1 real time, 2 reset] (A DeviceConnectVariable.TimingMode). */
  TIMING_MODE: 0x6010,
  /** "Mic Recognition" [1/0] (USB devices only: A HLBleDeviceActivity txIdentifyView visibility is6701UsbDevice). */
  TX_IDENTIFY: 0x6013,
  /** Live timecode GET → [h, m, s, frame] (A generateZeroTimingResult). */
  START_ZERO_TIMING: 0x6014,
  /** "Timecode switch" [1/0]. */
  TC_SWITCH: 0x6015,
  /** "4 Mic & 1 RX" [1 = 4 Mic & 1 RX, 0 = 2 Mic & 1 RX] (A HLBleDeviceActivity SetMicQuantityIntent). */
  SWITCH_MIC_QUANTITY: 0x6016,
  /** OWS pairing: set [0 start pairing, 1 delete pairing]; GET [0 unpaired, else paired] (A WirelessMonitorActivity). */
  EARPHONE_PAIR: 0x6017,
  /** "Monitoring Status" [1 play, 0 pause] (A WirelessMonitorActivity: FAIL_CLOSE(1) = Play). */
  EARPHONE_MONITOR: 0x6018,
  /** "Monitoring Volume" [0..40] shown −20..+20 (A WirelessMonitorActivity.getSignedString). */
  EARPHONE_VOLUME: 0x6019,
  /** "Wireless Monitoring Toggle" [1 on, 0 off]; restarts the RX (I Localizable, see controls.ts). */
  WIRELESS_STATUS: 0x601a,
  RECORD_NOISE_STATUS: 0x601b,
  BAT3C_BATTERY_HEALTH: 0x601c,
  BAT3C_PRODUCTION_INFO: 0x601d,
  BAT3C_ISSUE_RECORD: 0x601e,
  RESET_FACTORY: 0x2007,
  FIRMWARE_TRAN_START: 0x4000,
  FIRMWARE_TRAN_RELOCATION: 0x4002,
  FIRMWARE_TRAN_PACKAGE: 0x4003,
  FIRMWARE_TRAN_END: 0x4004,
  FIRMWARE_TRAN_DEVICE: 0x4005,
  /** "RX Pairing Mode" → "Start Pairing", empty payload (A BleMicCmd.setMobileRxPair → cmdSingleSend). */
  MOBILE_RX_PAIR: 0x701e,
  CAMERA_GAIN: 0x7020,
  /** "USB Output" depth set [0 = 24-bit]; the app never sends anything else (A HLBleDeviceActivity initView lambda 18). */
  UAC_OUT_MODE_SET: 0x8043,
  /** "USB Output" depth GET → [mode] (A generateUacModeResult). */
  UAC_OUT_MODE_GET: 0x8044,
} as const

/** GET form of a settable id (see the header). */
export const MAX2_GET_FLAG = 0x10000
export const max2GetKey = (cmd: number): number => MAX2_GET_FLAG | cmd
/** 0x6017 with a non-zero payload: "Delete pairing" of the OWS earphones (destructive, documented only). */
export const MAX2_OWS_UNPAIR_KEY = 0x20000 | MAX2_CMD.EARPHONE_PAIR

/** Wire id of a catalogue key. */
export const max2WireId = (key: number): number => key & 0xffff

// --------------------------------------------------------------------------------- unit numbering

/**
 * Units of the 0x600A payload (A DeviceConnectVariable.DeviceType BOX 0, RX 1, TX1 2, TX2 3, TX3 4, TX4 5;
 * HLBleDeviceActivity getDeviceVersionInfo(DeviceType.*)).
 */
export const MAX2_VERSION_UNIT = { box: 0, rx: 1, tx1: 2, tx2: 3, tx3: 4, tx4: 5 } as const
export type Max2VersionUnit = keyof typeof MAX2_VERSION_UNIT
export const MAX2_VERSION_UNIT_OF: Readonly<Record<number, Max2VersionUnit>> = { 0: 'box', 1: 'rx', 2: 'tx1', 3: 'tx2', 4: 'tx3', 5: 'tx4' }

/**
 * BLE envelope targets (A BleMicCmd IDENTIFIER_RX 2, TX1 3, TX2 4, BOX 5, TX3 10, TX4 11). Over USB every request
 * goes to the RX's own identifier instead (BleMicCmd.<init>: 1026 → 1, 1027 → 2; cmdSingleSend/cmdMultiSend
 * `isBle() ? target : identifier`), and "get all" to 0 (cmdMultiMapSend).
 *
 * The library follows Android. iOS disagrees for TX3/TX4: +[NSData hl_targetByteForDeviceType:] @0x10011d288 maps
 * type 1 → 3, 2 → 4, 0 → 2 (BOX link) / 0, and everything else, TX3 and TX4 included, → 5 (the BOX). Which targets
 * the mics answer through the case is a hardware question (max2-6701.md §9 #7).
 */
export const MAX2_BLE_TARGET = { rx: 2, tx1: 3, tx2: 4, box: 5, tx3: 10, tx4: 11 } as const

// ------------------------------------------------------------------------------------- value enums

/** A DeviceConnectVariable.VoiceGainType: CUSTOM_GAIN.ordinal() 0, DYNAMIC_GAIN 1. */
export const MAX2_GAIN_TYPE = { CUSTOM: 0, DYNAMIC: 1 } as const
/** A DeviceConnectVariable.VoiceGainLevel: STRONG_GAIN 0 ("High"), MEDIUM_GAIN 1, WEAK_GAIN 2 ("Low"). */
export const MAX2_GAIN_LEVEL = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const
/** Gain wire value 0..40 = −20..+20 dB (A HLBleDeviceActivity.getSignedString: number − 20). */
export const MAX2_GAIN_MAX = 40
export const MAX2_GAIN_OFFSET_DB = -20
/** NC depth index 0..20, shown as index + 5 dB (max2-6701.md §5 0x6006; vectors: index 10 = "15 dB"). */
export const MAX2_NC_DEPTH_MAX = 20
export const MAX2_NC_DEPTH_OFFSET_DB = 5
/** A DeviceConnectVariable.VocalTractType: MONO 0, STEREO 1, AudioTrack (safety track) 2. */
export const MAX2_CHANNEL = { MONO: 0, STEREO: 1, SAFETY: 2 } as const
/** A DeviceConnectVariable.InputFps FPS_23 0 … FPS_60 8; labels from R layout/activity_time_code.xml tv_fps_*. */
export const MAX2_FPS_LABELS: readonly string[] = ['23.98', '24', '25', '29.97', '29.97 DF', '30', '30 DF', '50', '60']
/** A DeviceConnectVariable.EarConnectStatus NOT_CONNECTED 0, LEFT 1, RIGHT 2, ALL 3. */
export const MAX2_EAR_CONNECT = { NONE: 0, LEFT: 1, RIGHT: 2, BOTH: 3 } as const
/** 0x600A chargeStatus 2 = charging (A HLBleDeviceActivity.updateTxState: setCharging(chargeStatus == 2)). */
export const MAX2_CHARGING = 2
/** RX firmware gate (A blemic/manager/DeviceDataManager.SPEC_VERSION_6701_USB, isNew6701USBDevice: compareVersions ≥ 0). */
export const MAX2_SPEC_VERSION_USB = '3.0.0.50'

// ------------------------------------------------------------------------------------- catalogue

const S = 'A blemic/operation/BleMicCommUtil'

function entry(name: string, safety: Safety, source: string, o: Partial<CommandSpec> = {}): CommandSpec {
  return { name, safety, retrySafe: safety === 'read', source, ...o }
}

/** Settable ids: SET class + GET source. */
const SETTABLE: readonly { cmd: number; name: string; safety: Safety; set: string; get: string; description?: string }[] = [
  {
    cmd: MAX2_CMD.RX_OUTSWITCH, name: 'RX_OUTSWITCH', safety: 'disruptive',
    set: `${S}.CMD_APP_STATUS_RX_OUTSWITCH; BleMicCmd.setRxOutSwitchStatus (target 2); HLBleDeviceActivity RxOutSwitchState type 2 → CountDownDialog (R device_restart_success_msg "The device will restart in %d seconds")`,
    get: 'A BleMicCmd.getMicBoxAllInfo item; generateRxOutSwitchStatus', description: 'Phone Speaker; restarts the RX',
  },
  { cmd: MAX2_CMD.RX_SAMPLING, name: 'RX_SAMPLING', safety: 'write', set: `${S}.CMD_APP_STATUS_RX_SAMPLING; BleMicCmd.setRxSamplingStatus`, get: 'A getMicBoxAllInfo item; generateRxSamplingStatus' },
  { cmd: MAX2_CMD.MIC_LOCK, name: 'MIC_LOCK', safety: 'write', set: `${S}.CMD_APP_STATUS_MIC_LOCK; BleMicCmd.setMicLockStatus`, get: 'A getMicBoxAllInfo item; generateMicLockStatus' },
  {
    cmd: MAX2_CMD.NOISE_LEVEL, name: 'NOISE_LEVEL', safety: 'write',
    set: `${S}.CMD_APP_STATUS_NOISE_LEVEL; BleMicCmd.setNoiseLevelStatus(payload, target); A BLE fan-out to 2, then 3, 4 (10, 11 in 4-mic mode) 200 ms apart, online or not (BleDeviceControlViewModel.processUserIntent SetNoiseLevelIntent → AnonymousClass19); I sends it to each online TX only (-[HLLarkMAX2View updateNoiseView:selIndex:] deviceType 1..4, guarded by tx1IsOnline..tx4IsOnline, targets 3, 4, 5, 5). The library: Android's targets, iOS's online filter (session.ts noisePlan)`,
    get: 'A BleMicCmd.getNoiseLevelStatus (target 3 = TX1 over BLE); getMicBoxAllInfo item; generateNoiseLevelStatus. I reads it from each TX as its 0x600A arrives (-[HLBleViewModel seprateDataWithCmdNum:] → +[HL6701Messenger sendGetDeviceNoiseWithType:] 2 / 3 / 1 / 4)',
  },
  { cmd: MAX2_CMD.VOICE_GAIN, name: 'VOICE_GAIN', safety: 'write', set: `${S}.CMD_APP_STATUS_VOICE_GAIN; BleMicCmd.setVoiceGainStatus`, get: 'A getMicBoxAllInfo item; generateVoiceGainStatus' },
  { cmd: MAX2_CMD.VOCAL_TRACT, name: 'VOCAL_TRACT', safety: 'write', set: `${S}.CMD_APP_STATUS_VOCAL_TRACT; BleMicCmd.setVocalTractStatus`, get: 'A getMicBoxAllInfo item; generateVocalTractStatus' },
  { cmd: MAX2_CMD.TC_MODE, name: 'TCMODE', safety: 'write', set: `${S}.CMD_APP_TCMODE_MSG; BleMicCmd.setTcMode`, get: 'A BleMicCmd.getTcMode; getMicBoxAllInfo item; generateTcModeResult' },
  { cmd: MAX2_CMD.INPUT_FPS, name: 'INPUT_FPS', safety: 'write', set: `${S}.CMD_APP_INPUT_FPS; BleMicCmd.setInputFps`, get: 'A BleMicCmd.getInputFps (TimeCodeActivity on open); generateInputFpsResult' },
  {
    cmd: MAX2_CMD.TIMING_MODE, name: 'TIMING_MODE', safety: 'write',
    set: `${S}.CMD_APP_TIMING_MODE; BleMicCmd.setTimingMode; [2] RESET only after TimeCodeActivity.confirmReset (Max2Device asks for confirm)`,
    get: 'A BleMicCmd.getTimingMode (TimeCodeActivity on open); generateTimingModeResult',
  },
  { cmd: MAX2_CMD.TX_IDENTIFY, name: 'TX_IDENTIFY', safety: 'write', set: `${S}.CMD_APP_TX_IDENTIFY; BleMicCmd.setTxIdentify`, get: 'A BleMicCmd.getTxIdentify (HLBleDeviceActivity$getDeviceAllInfo$1, USB); generateTxIdentifyResult' },
  { cmd: MAX2_CMD.TC_SWITCH, name: 'TC_SWITCH', safety: 'write', set: `${S}.CMD_APP_TC_SWITCH; BleMicCmd.setTcSwitch`, get: 'A BleMicCmd.getTcModeSwitch; getMicBoxAllInfo item; generateTcModeSwitchResult' },
  {
    cmd: MAX2_CMD.SWITCH_MIC_QUANTITY, name: 'SWITCH_MIC_QUANTITY', safety: 'disruptive',
    set: `${S}.CMD_APP_SWITCH_MIC_QUANTITY; BleMicCmd.setMicQuantity; switches 2 Mic & 1 RX ↔ 4 Mic & 1 RX (R tip_four_mic_one_rx) [?] restart behaviour unknown`,
    get: 'A BleMicCmd.getMicQuantity (HLBleDeviceActivity.getIsFourMicMode, fw ≥ 3.0.0.50); generateMicQuantityResult',
  },
  {
    cmd: MAX2_CMD.EARPHONE_PAIR, name: 'EARPHONE_PAIR', safety: 'disruptive',
    set: `${S}.CMD_APP_EARPHONE_PAIR [0] start pairing (WirelessMonitorActivity Status.SUC_OPEN); I Localizable "Searching will disconnect current headphones and pause Wireless Monitoring"`,
    get: 'A BleMicCmd.getEarphonePair (WirelessMonitorActivity.initData); generateEarPhonePairResult',
  },
  { cmd: MAX2_CMD.EARPHONE_MONITOR, name: 'EARPHONE_MONITOR', safety: 'write', set: `${S}.CMD_APP_EARPHONE_MONITOR; BleMicCmd.setEarphoneMonitor`, get: 'A BleMicCmd.getEarphoneMonitor; generateEarPhoneMonitorResult' },
  { cmd: MAX2_CMD.EARPHONE_VOLUME, name: 'EARPHONE_VOLUME', safety: 'write', set: `${S}.CMD_APP_EARPHONE_VOLUME; BleMicCmd.setEarphoneVolume`, get: 'A BleMicCmd.getEarphoneVolume (WirelessMonitorActivity); generateEarPhoneVolumeResult' },
  {
    cmd: MAX2_CMD.WIRELESS_STATUS, name: 'WIRELESS_STATUS', safety: 'disruptive',
    set: `${S}.CMD_APP_WIRELESS_STATUS; BleMicCmd.setWirelessMonitor; I Localizable "…RX devices will restart to adapt. Confirm?"`,
    get: 'A BleMicCmd.getWirelessMonitor; generateWirelessResult',
  },
  { cmd: MAX2_CMD.RECORD_NOISE_STATUS, name: 'RECORD_NOISE_STATUS', safety: 'write', set: `${S}.CMD_APP_RECORD_NOISE_STATUS (Laboratory, cloud-gated HTTP_RECORD_NOISE_KEY; no control)`, get: 'A BleMicCmd.getRecordNoiseStatus; generateRecordNoiseResult' },
]

function buildCatalogue(): CommandCatalogue {
  const c: Record<number, CommandSpec> = {}
  for (const s of SETTABLE) {
    c[s.cmd] = entry(s.name, s.safety, s.set, s.description ? { description: s.description } : {})
    c[max2GetKey(s.cmd)] = entry(`GET_${s.name}`, 'read', s.get)
  }
  c[MAX2_OWS_UNPAIR_KEY] = entry('EARPHONE_UNPAIR', 'destructive', `${S}.CMD_APP_EARPHONE_PAIR [1] "Delete pairing" (WirelessMonitorActivity.deletePairDialog → Status.FAIL_CLOSE)`, {
    description: 'removes the OWS earphone pairing; documented only',
  })
  const add = (cmd: number, name: string, safety: Safety, source: string, o: Partial<CommandSpec> = {}) => (c[cmd] = entry(name, safety, source, o))
  add(MAX2_CMD.BOX_BATTERY, 'STATUS_BOX_BATTERY', 'notify', `${S}.CMD_APP_STATUS_BOX_BATTERY; parseNotifyResult → BoxBatteryInfoResult (pushed over BLE)`)
  add(MAX2_CMD.RX_BATTERY, 'STATUS_RX_BATTERY', 'notify', `${S}.CMD_APP_STATUS_RX_BATTERY; parseNotifyResult → RxBatteryInfoResult`)
  add(MAX2_CMD.MIC_BATTERY, 'STATUS_MIC_BATTERY', 'notify', `${S}.CMD_APP_STATUS_MIC_BATTERY; parseNotifyResult → TxInfoResult`)
  add(MAX2_CMD.SYSTEM_TIME, 'SYSTEM_TIME', 'write', `${S}.CMD_APP_SYSTEM_TIME; BleMicCmd.sendPhoneSystemTime; HLBleDeviceActivity$getDeviceAllInfo$1 (SynchronizeSystemTimeIntent(Utils.localZoneTime()))`)
  add(MAX2_CMD.DEVICE_VERSION, 'DEVICE_VERSION', 'read', `${S}.CMD_APP_DEVICE_VERSION; BleMicCmd.getDeviceVersion([unit]) (BLE target 5); generateDeviceVersionInfo`)
  add(MAX2_CMD.HEART_INFO, 'HEART_INFO', 'read', `${S}.CMD_APP_HEART_INFO; BleMicCmd.getHeartInfo; HLBleDeviceActivity$mRunnable$1 (3 s, USB); I -[HLBleDeviceController sendHeartInfo] @0x1002454ec (3 s, BLE target 2)`)
  add(MAX2_CMD.OTA_FIRMWARE_VERSION, 'OTA_FIRMWARE_VERSION', 'read', `${S}.CMD_APP_OTA_FIRMWARE_VERSION; BleMicCmd.getOTAVersion (OTA flow only; never sent here)`)
  add(MAX2_CMD.START_OTA_UPGRADE, 'START_OTA_UPGRADE', 'ota', `${S}.CMD_APP_START_OTA_UPGRADE; BleMicCmd.startOTAUpgrade`)
  add(MAX2_CMD.START_ZERO_TIMING, 'START_ZERO_TIMING', 'read', `${S}.CMD_APP_START_ZERO_TIMING; BleMicCmd.getStartZeroTiming (TimeCodeActivity); generateZeroTimingResult [h, m, s, frame]`)
  add(MAX2_CMD.BAT3C_BATTERY_HEALTH, 'BAT3C_BATTERY_HEALTH', 'read', `${S}.CMD_APP_GET_BAT3C_BATTERY_HEALTH; BleMicCmd.getBat3cBatteryHealth [0] (target 5) [?] 6701 use`)
  add(MAX2_CMD.BAT3C_PRODUCTION_INFO, 'BAT3C_PRODUCTION_INFO', 'read', `${S}.CMD_APP_GET_BAT3C_PRODUCTION_INFO; BleMicCmd.getBat3cProductionInfo [0]`)
  add(MAX2_CMD.BAT3C_ISSUE_RECORD, 'BAT3C_ISSUE_RECORD', 'read', `${S}.CMD_APP_GET_BAT3C_ISSUE_RECORD; BleMicCmd.getBat3cIssueRecords`)
  add(MAX2_CMD.RESET_FACTORY, 'RESET_FACTORY', 'destructive', `${S}.CMD_APP_RESET_FACTORY_SETTING; BleMicCmd.resetFactory([0, 0], target); SettingActivity "Factory reset" (documented only)`)
  add(MAX2_CMD.FIRMWARE_TRAN_START, 'FIRMWARE_TRAN_START', 'ota', `${S}.CMD_APP_FIRMWARE_TRAN_START; BleMicCmd.startFirmwareTran`)
  add(MAX2_CMD.FIRMWARE_TRAN_RELOCATION, 'FIRMWARE_TRAN_RELOCATION', 'ota', `${S}.CMD_APP_FIRMWARE_TRAN_RELOCATION; BleMicCmd.reLocation`)
  add(MAX2_CMD.FIRMWARE_TRAN_PACKAGE, 'FIRMWARE_TRAN_PACKAGE', 'ota', `${S}.CMD_APP_FIRMWARE_TRAN_PACKAGE; BleMicCmd.tranFirmwarePackage`)
  add(MAX2_CMD.FIRMWARE_TRAN_END, 'FIRMWARE_TRAN_END', 'ota', `${S}.CMD_APP_FIRMWARE_TRAN_END; BleMicCmd.endFirmwareTran`)
  add(MAX2_CMD.FIRMWARE_TRAN_DEVICE, 'FIRMWARE_TRAN_DEVICE', 'ota', `${S}.CMD_APP_FIRMWARE_TRAN_DEVICE; BleMicCmd.firmwareTranDevice`)
  add(MAX2_CMD.MOBILE_RX_PAIR, 'MOBILE_RX_PAIR', 'disruptive', `${S}.CMD_APP_MOBILE_RX_PAIR; BleMicCmd.setMobileRxPair (empty payload); R title_rx_pair "RX Pairing Mode"`, {
    description: 'puts the mobile RX into pairing mode',
  })
  add(MAX2_CMD.CAMERA_GAIN, 'CAMERA_GAIN', 'write', `${S}.CMD_APP_CAMERA_GAIN; BleMicCmd.setCameraGainStatus (blemic/gain/GainSynchronizationActivity; no control)`)
  add(MAX2_CMD.UAC_OUT_MODE_SET, 'UAC_OUT_MODE_SET', 'disruptive', `${S}.CMD_UAC_OUT_MODE_SET; BleMicCmd.setUacModeStatus (A sends it without a dialog); I -[HLLarkMAX2View changeUSBRecordWithIndex:] @0x1000108fc asks "Changing the sample depth will restart the device. Continue?" before sending it and -[HLBleDeviceController showConfigSuccess:cmd:] @0x100246f5c shows "Settings applied successfully. The device will automatically restart." after the ack`, {
    description: 'USB Output bit depth; restarts the RX (iOS)',
  })
  add(MAX2_CMD.UAC_OUT_MODE_GET, 'UAC_OUT_MODE_GET', 'read', `${S}.CMD_UAC_OUT_MODE_GET; BleMicCmd.getUacModeStatus; generateUacModeResult`)
  return c
}

/** Every known command form (FamilyDriver.commands), including the documented-only destructive and OTA ones. */
export const MAX2_COMMANDS: CommandCatalogue = buildCatalogue()

/** Catalogue key of one request item (see the header). */
export function max2ItemKey(it: Pick<MomaItemInput, 'cmd' | 'payload'>): number {
  const n = it.payload?.length ?? 0
  if (n === 0 && MAX2_COMMANDS[max2GetKey(it.cmd)]) return max2GetKey(it.cmd)
  if (it.cmd === MAX2_CMD.EARPHONE_PAIR && n > 0 && it.payload![0] !== 0) return MAX2_OWS_UNPAIR_KEY
  return it.cmd
}

const RISK: Readonly<Record<Safety, number>> = { read: 0, write: 1, disruptive: 2, notify: 3, destructive: 4, ota: 5 }

/** Every item key of a request (ProtocolSpec.commandsOf). */
export function max2KeysOf(req: MomaRequest): number[] {
  return req.items.map(max2ItemKey)
}

/** Catalogue key of a request: the item, or for a batch the riskiest item (uncatalogued ranks highest). */
export function max2CommandOf(req: MomaRequest): number {
  let best = -1
  let bestRisk = -1
  for (const k of max2KeysOf(req)) {
    const info = MAX2_COMMANDS[k]
    const r = info ? RISK[info.safety] : 99
    if (r > bestRisk) {
      best = k
      bestRisk = r
    }
  }
  return best
}

/** Whether a catalogue key is a read (GET form or pure read). */
export function isMax2Read(key: number): boolean {
  return MAX2_COMMANDS[key]?.safety === 'read'
}

/** Display name of a key ("GET_NOISE_LEVEL 0x6006"). */
export function max2KeyName(key: number): string {
  const n = MAX2_COMMANDS[key]?.name
  return n ? `${n} ${hex16(max2WireId(key))}` : hex16(max2WireId(key))
}

// -------------------------------------------------------------------------------- request builders

/** GET of a settable id or a pure read (empty payload). */
export const max2Get = (cmd: number, target?: number): MomaRequest => momaRequest(cmd, [], target === undefined ? {} : { target })

/** SET (payload required; A BleMicCmd.cmdMultiSend). */
export const max2Set = (cmd: number, payload: ArrayLike<number>, target?: number): MomaRequest => {
  if (!payload.length) throw new RangeError(`${hex16(cmd)}: a MAX 2 set carries a payload`)
  return momaRequest(cmd, payload, target === undefined ? {} : { target })
}

/** 0x600A [unit] (A BleMicCmd.getDeviceVersion: cmdMultiSend(…, 5)). */
export const max2Version = (unit: Max2VersionUnit, target?: number): MomaRequest =>
  momaRequest(MAX2_CMD.DEVICE_VERSION, [MAX2_VERSION_UNIT[unit]], target === undefined ? {} : { target })

/**
 * "Get all" (A BleMicCmd.getMicBoxAllInfo → cmdMultiMapSend): 0x6003, 6004, 6005, 6006, 6007, 6008, 6015, 600E with
 * empty payloads; target 2 over BLE, 0 over USB. The app's HashMap<byte[], …> iteration order is not deterministic;
 * this library sends the source order.
 */
export const MAX2_GET_ALL_ITEMS: readonly number[] = [
  MAX2_CMD.RX_OUTSWITCH, MAX2_CMD.RX_SAMPLING, MAX2_CMD.MIC_LOCK, MAX2_CMD.NOISE_LEVEL, MAX2_CMD.VOICE_GAIN, MAX2_CMD.VOCAL_TRACT,
  MAX2_CMD.TC_SWITCH, MAX2_CMD.TC_MODE,
]
export const max2GetAll = (target: number): MomaRequest => momaBatch(MAX2_GET_ALL_ITEMS, { target })

/**
 * 0x6009 payload: BE64 local-time milliseconds (A Utils.localZoneTime = UTC ms + zone offset; NumberUtil.longToByte8
 * is big-endian; I seconds × 1000 → `rev` @0x1000b5754).
 */
export function max2SystemTimePayload(utcMs: number, tzOffsetMinutes = new Date(utcMs).getTimezoneOffset()): number[] {
  let v = BigInt(Math.round(utcMs - tzOffsetMinutes * 60_000))
  const out = new Array<number>(8)
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

/**
 * Length of the request frame at buf[0] (for joining split BLE writes, transports BleFrameJoiner): null while the
 * header or an item is incomplete, 0 for a byte that cannot start a frame (resync).
 */
export function max2FrameLength(buf: Uint8Array): number | null {
  const r = decodeMomaFrame(buf, { heads: 'down' })
  if (r.status === 'ok') return r.length
  return r.status === 'incomplete' ? null : 0
}
