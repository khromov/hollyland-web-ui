/**
 * Command catalog, typed request builders and response parsers.
 *
 * Every entry cites its primary source (Android = jadx path under
 * com/hollyland/…, iOS = symbol/address in larkSound 3.1.0). See docs/PROTOCOL.md §6–§8.
 */
import { Target, type RequestFrame, hex8 } from './codec'

// Version comparisons and the Lark C1 volume map live in versions.ts (the registry rows need them without this
// catalogue); re-exported here unchanged.
export { LARK_C1_VOLUME_WIRE, isNewerVersionAndroid, isNewerVersionIos, isVersionMissing, lastVersionComponent } from './versions'

// ------------------------------------------------------------------------------------- IDs

export const Cmd = {
  /** Firmware version, legacy format (M2/M2S; registered but unused on 6118). */
  VERSION_LEGACY_GET: 0x03,
  VOLUME_GET: 0x04,
  VOLUME_SET: 0x05,
  NOISE_LEVEL_SET: 0x06,
  /** OTA preparation: 1-byte device id. Read-only, but only useful for firmware upload. */
  DEVICE_ID_GET: 0x08,
  OTA_TX_ENTER: 0x09,
  /** HIP_6501_DEVWARNING: declared, no implementation in either app (iOS ignores it). */
  DEVICE_WARNING: 0x0a,
  OTA_RESULT: 0x0b,
  RESTART_RX: 0x0c,
  OTA_RX_ENTER: 0x0d,
  OTA_PACKET_ACK: 0x0e,
  HEARTBEAT: 0x10,
  NOISE_LEVEL_GET: 0x11,
  SPEAKER_SET: 0x12,
  SPEAKER_GET: 0x13,
  SERIAL_GET: 0x15,
  /**
   * iOS only (`getDeviceInitialInfo` @0x10008aa48): RX variant, payload[0] == 2 -> camera RX
   * (Lark M2 additionally needs LEN > 8). Android never sends it.
   */
  DEVICE_INFO_GET: 0x16,
  CHANNEL_MODE_SET: 0x18,
  /** Noise-cancellation on/off. The payload is ALWAYS [0x02]: it is a toggle. */
  NOISE_TOGGLE: 0x19,
  VOICE_LOCK_SET: 0x34,
  VOICE_LOCK_GET: 0x35,
  AUTO_OFF_SET: 0x36,
  BUTTON_CUSTOM_SET: 0x37,
  BUTTON_COLORS_GET: 0x38,
  LED_SET: 0x39,
  VOICE_PRESET_SET: 0x3a,
  MIC_RECOGNITION_SET: 0x3b,
  MIC_RECOGNITION_GET: 0x3c,
  SMART_BATTERY_SET: 0x3d,
  SMART_BATTERY_GET: 0x3e,
  REMOVE_PAIRING: 0x3f,
  FACTORY_RESET: 0x40,
  /** 6118 firmware version ("rule version"), 6 bytes. */
  VERSION_GET: 0x41,
} as const
export type CmdId = (typeof Cmd)[keyof typeof Cmd]

/**
 * Legacy `AA DD` families HollylandDevice drives:
 *  - 6118  LARK A2 / A2S
 *  - 6301  Lark M2 (+ EAGLESHERO OEM)
 *  - 6302  LARK M2S
 *  - 6501  Lark C1 / C1 (2nd gen) / M1 (2nd gen) / Lark Mini. Same Android screen and `Pro_*` classes as
 *          the Lark M2 (A larkc1/utils/OpenPageHelper.obtainUsbPageIntent → larkc1/HLDeviceActivity; the codec
 *          constants are literally `Protocol.HIP_6501_*`), same iOS engine (I HL6501Engine). Only a few UI
 *          rules differ (models.ts Capabilities 6501 fields; docs/research/families/legacy-6501.md).
 */
export type Family = '6118' | '6301' | '6302' | '6501'
/** The A2 / M2 / M2S families (unchanged since before the 6501 group was added; see LEGACY_FAMILIES). */
export const ALL_FAMILIES: readonly Family[] = ['6118', '6301', '6302']
/** Every legacy family, the 6501 group included. */
export const LEGACY_FAMILIES: readonly Family[] = ['6118', '6301', '6302', '6501']

/**
 * Safety class.
 *  read        - GET, no side effects (safe for the probe / auto-polling)
 *  write       - changes a setting (idempotent unless `toggle`)
 *  disruptive  - reboots / needs reboot (USB re-enumerates)
 *  destructive - erases pairing / settings
 *  ota         - firmware-upload machinery (can brick)
 *  notify      - device -> host only
 */
export type Safety = 'read' | 'write' | 'disruptive' | 'destructive' | 'ota' | 'notify'

export interface CommandInfo {
  id: number
  name: string
  safety: Safety
  families: readonly Family[]
  /** Units the command may be addressed to. */
  targets: readonly Target[]
  /** Safe to resend automatically when no reply arrives. */
  retrySafe: boolean
  /** Toggles state: never resend, never send blind. */
  toggle?: boolean
  description: string
  android?: string
  ios?: string
}

const RX: readonly Target[] = [Target.RX]
const ANY: readonly Target[] = [Target.RX, Target.TX1, Target.TX2]
const A2: readonly Family[] = ['6118']
const M2S: readonly Family[] = ['6302']
/**
 * Commands the 6501 group uses too (legacy-6501.md §5): sent by A larkc1/HLDeviceActivity
 * (getDeviceVersion: 0x03 0x11 0x04 0x13 0x15 0x35; heartbeat 0x10; setters 0x06 0x05 0x12; 0x0C after
 * 0x12; OTA 0x08 0x09 0x0D) or I +[HL6501Messenger getDeviceInitialInfo] @0x10008aa48 (0x16), plus the
 * device-initiated OTA notifications. NOT for 6501: 0x19 NC toggle, 0x34 volume lock, 0x18 channel mode,
 * 0x36 auto-off (registered, views hidden for these PIDs), 0x37-0x39 (M2S only).
 */
const WITH_6501: readonly Family[] = LEGACY_FAMILIES

const c = (i: CommandInfo): CommandInfo => i

export const COMMANDS: Readonly<Record<number, CommandInfo>> = {
  [Cmd.HEARTBEAT]: c({
    id: Cmd.HEARTBEAT, name: 'HEARTBEAT', safety: 'read', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'Status poll: link, battery, mute/charge flags and all settings. 6501: Lark C1 (PID 1) applies link/battery only; PIDs 11/12/13 also NC level and volume',
    android: 'device6118/CmdGetHeart6118.decodeLegacyPayload; usbmic/protocol/Pro_get_heart.receiveData; larkc1/HLDeviceActivity.onEvent cmd 16 (`productId != 1`, `productId >= 8`), AnonymousClass8.run (every 3 s)',
    ios: '-[HLDeviceController sendHeartInfo] @0x1002c4998; -[HLHeartEntity initEntityWithData:] @0x1001fa17c',
  }),
  [Cmd.VERSION_GET]: c({
    id: Cmd.VERSION_GET, name: 'VERSION_GET', safety: 'read', families: A2, targets: ANY, retrySafe: true,
    description: 'Firmware version (6 bytes, "b0.b1.b2.b3b4b5")',
    android: 'device6118/CmdGetRuleVersion6118; LegacyUsb6118CommandsKt.formatSixByteDeviceVersion',
    ios: '+[HL6501Messenger sendGetDeviceInfoVersion:] @0x10008af00 (0x41 when isConnect6118Device); getNewVersionWithData: @0x1001fd054',
  }),
  [Cmd.VERSION_LEGACY_GET]: c({
    id: Cmd.VERSION_LEGACY_GET, name: 'VERSION_LEGACY_GET', safety: 'read', families: WITH_6501, targets: ANY, retrySafe: true,
    description: 'Firmware version, bytes joined with "."',
    android: 'usbmic/protocol/Pro_get_version.receiveData; device6118/CmdGetDeviceVersion6118 (formatLegacyVersion)',
    ios: 'getVersionWithData: @0x1001fd0f8',
  }),
  [Cmd.SERIAL_GET]: c({
    id: Cmd.SERIAL_GET, name: 'SERIAL_GET', safety: 'read', families: WITH_6501, targets: ANY, retrySafe: true,
    description: 'Serial number (ASCII, NUL terminated)',
    android: 'device6118/CmdGetDeviceSn6118 (asciiString); usbmic/protocol/Pro_get_sn',
    ios: 'messageForDeviceSN: @0x1000da26c',
  }),
  [Cmd.DEVICE_INFO_GET]: c({
    id: Cmd.DEVICE_INFO_GET, name: 'DEVICE_INFO_GET', safety: 'read', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'RX variant (iOS only): payload[0] == 2 -> camera RX; on Lark M2 also LEN > 8. 6501 group: no camera variant; payload[0] == 3 on a "lark m1 pro" = Lark Mini',
    ios: 'getDeviceInitialInfo block @0x10008ac88; -[HL6501Engine resolveDeviceHeaderImageWithPayload:] @0x1000bd910 (type 5 + body[0] == 3 -> type 6 @0x1000bda24; types 0/1/2/4/6 fall through @0x1000bda88)',
  }),
  [Cmd.DEVICE_ID_GET]: c({
    id: Cmd.DEVICE_ID_GET, name: 'DEVICE_ID_GET', safety: 'read', families: WITH_6501, targets: ANY, retrySafe: true,
    description: 'OTA device id (1 byte). Request payload repeats the target index.',
    android: 'device6118/CmdGetDeviceId6118.encodeLegacyPayload; usbmic/protocol/Pro_get_devid',
    ios: 'sendGetDeviceInfoIDWithType: @0x10008b11c',
  }),
  [Cmd.NOISE_LEVEL_GET]: c({
    id: Cmd.NOISE_LEVEL_GET, name: 'NOISE_LEVEL_GET', safety: 'read', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'M2/M2S: signed level 0..2. 6118: Android decodes bit7 = NC on + bits0-6 = level, iOS reads the raw byte as the level (unresolved, see parseNoiseLevelGet6118)',
    android: 'device6118/CmdGetNoiseLevel6118 (never sent by the A2 UI); usbmic/protocol/Pro_get_noise',
    ios: 'sendGetDeviceNoiseLevel @0x10008b3e4; -[HL6501PacketParser messageForNoiseLevel:] @0x1000d9eb0',
  }),
  [Cmd.NOISE_LEVEL_SET]: c({
    id: Cmd.NOISE_LEVEL_SET, name: 'NOISE_LEVEL_SET', safety: 'write', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'Noise-cancellation strength. 6118: 1..3 (Weak/Medium/Strong); M2/M2S/6501: 1..2 (Low/Strong)',
    android: 'device6118/CmdSetNoiseLevel6118 (coerceIn 0..3); usbmic/protocol/Pro_set_noise; larkc1/HLDeviceActivity.onClick strong_level / low_level',
    ios: 'sendSetDeviceNoiseLevel: @0x10008b460; codec @0x10011b9fc',
  }),
  [Cmd.NOISE_TOGGLE]: c({
    id: Cmd.NOISE_TOGGLE, name: 'NOISE_TOGGLE', safety: 'write', families: ALL_FAMILIES, targets: RX, retrySafe: false, toggle: true,
    description: 'Noise-cancellation on/off TOGGLE, payload always [02]; read the result from the heartbeat',
    android: 'device6118/CmdSetNoiseSwitch6118 (LEGACY_6118_NOISE_SWITCH_TOGGLE = 2); usbmic/protocol/Pro_set_noise_status',
    ios: 'codec @0x10011b9fc case 0x19 (isOn ignored); -[HLLarkM2View noiseViewSwitchChanged:] @0x1000ccf58',
  }),
  [Cmd.VOLUME_GET]: c({
    id: Cmd.VOLUME_GET, name: 'VOLUME_GET', safety: 'read', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'RX output volume (the wire value; on the Lark C1, PID 1, a button tag, see LARK_C1_VOLUME_WIRE)',
    android: 'device6118/CmdGetVoiceLevel6118; usbmic/protocol/Pro_get_voice; larkc1/HLDeviceActivity.onEvent cmd 4 (updateVoiceGroupWithIndex selects the button whose tag equals the value)',
    ios: 'sendGetDeviceVoliceLevel @0x10008b4f0',
  }),
  [Cmd.VOLUME_SET]: c({
    id: Cmd.VOLUME_SET, name: 'VOLUME_SET', safety: 'write', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'RX output volume step (0-based). A2 mobile 0..5, A2S camera 0..2, M2/M2S/6501 0..5. Lark C1 (PID 1): buttons 1..6 send 5,4,3,0,1,2',
    android: 'device6118/CmdSetVoiceLevel6118; c6118/ui/home/C6118DeviceActivityKt.homeRxVolumeStepCount; application/common/compatibility/DeviceCompat.getVoiceLevels; larkc1/HLDeviceActivity.onClickBtnGroup (sends the button tag)',
    ios: 'sendSetDeviceVoliceLevel: @0x10008b56c',
  }),
  [Cmd.CHANNEL_MODE_SET]: c({
    id: Cmd.CHANNEL_MODE_SET, name: 'CHANNEL_MODE_SET', safety: 'write', families: ['6118', '6302'], targets: RX, retrySafe: true,
    description: '0 Mono, 1 Stereo, 2 Safety track (6118 only)',
    android: 'device6118/CmdSetVoiceMode6118; c6118/ui/home/C6118DeviceActivity.setupVoiceModeActions',
    ios: 'codec @0x10011b9fc case 0x18; -[HLLarkM2View vocalView] @0x1000d0638',
  }),
  [Cmd.VOICE_PRESET_SET]: c({
    id: Cmd.VOICE_PRESET_SET, name: 'VOICE_PRESET_SET', safety: 'write', families: A2, targets: RX, retrySafe: true,
    description: '"Bel canto preset" (on-device voice EQ): [enable, preset 0 Bright/1 Low/2 Balance]',
    android: 'device6118/CmdSetBeautyVoice6118; strings c6118_preset_btn1..3',
    ios: 'HLLark6118View closures @0x10066a108/@0x10066a440 (use eqSwitch/eqMode)',
  }),
  [Cmd.LED_SET]: c({
    id: Cmd.LED_SET, name: 'LED_SET', safety: 'write', families: ['6118', '6302'], targets: RX, retrySafe: true,
    description: 'Indicator LED: 0 = on, 1 = off (inverted)',
    android: 'device6118/CmdSetLight6118; LegacyUsb6118CommandsKt.LEGACY_6118_LIGHT_VALUE_OPEN = 0',
    ios: 'codec @0x10011b9fc case 0x39 ([!isOn])',
  }),
  [Cmd.MIC_RECOGNITION_SET]: c({
    id: Cmd.MIC_RECOGNITION_SET, name: 'MIC_RECOGNITION_SET', safety: 'write', families: A2, targets: RX, retrySafe: true,
    description: '"Mic Recognition" (TX identify): 1 = on, 0 = off',
    android: 'device6118/CmdSetTxIdentify6118', ios: 'codec case 0x3B',
  }),
  [Cmd.MIC_RECOGNITION_GET]: c({
    id: Cmd.MIC_RECOGNITION_GET, name: 'MIC_RECOGNITION_GET', safety: 'read', families: A2, targets: RX, retrySafe: true,
    description: 'payload[0] == 1 -> on',
    android: 'device6118/CmdGetTxIdentify6118', ios: 'sendGetMicIdentify @0x10008b798',
  }),
  [Cmd.SMART_BATTERY_SET]: c({
    id: Cmd.SMART_BATTERY_SET, name: 'SMART_BATTERY_SET', safety: 'write', families: A2, targets: RX, retrySafe: true,
    description: '"Smart battery life": 1 = on, 0 = off',
    android: 'device6118/CmdSetSmartBattery6118', ios: 'codec case 0x3D',
  }),
  [Cmd.SMART_BATTERY_GET]: c({
    id: Cmd.SMART_BATTERY_GET, name: 'SMART_BATTERY_GET', safety: 'read', families: A2, targets: RX, retrySafe: true,
    description: 'payload[0] == 1 -> on',
    android: 'device6118/CmdGetSmartBattery6118', ios: 'sendGetDeviceEndurance @0x10008b710',
  }),
  [Cmd.SPEAKER_SET]: c({
    id: Cmd.SPEAKER_SET, name: 'SPEAKER_SET', safety: 'write', families: WITH_6501, targets: RX, retrySafe: true,
    description: '"External speaker without unplugging" / phone speaker: 0 = on, 1 = off. Takes effect after RX restart (0x0C).',
    android: 'device6118/CmdSetSpeaker6118; c6118/ui/setting/viewmodel/MoreSetting6118ViewModel.startSpeakerRestartCountdown; larkc1/HLDeviceActivity.onCreate voice_outgoing_switch listener (!z ? 1 : 0)',
    ios: 'sendSetDeviceVoiceOutStatus: @0x10008b5fc ([!on])',
  }),
  [Cmd.SPEAKER_GET]: c({
    id: Cmd.SPEAKER_GET, name: 'SPEAKER_GET', safety: 'read', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'payload[0] == 0 -> speaker passthrough on',
    android: 'device6118/CmdGetSpeaker6118', ios: 'messageForSpeakerStatus: (== 0)',
  }),
  [Cmd.AUTO_OFF_SET]: c({
    id: Cmd.AUTO_OFF_SET, name: 'AUTO_OFF_SET', safety: 'write', families: ['6118', '6302'], targets: RX, retrySafe: true,
    description: 'TX auto power-off: 0 = after 15 min idle, 1 = never',
    android: 'device6118/CmdSetShutdownTime6118; usbmic/protocol/Pro_set_shutdown_time',
    ios: 'codec case 0x36; -[HLLarkM2View shutDownView] @0x1000d1d74',
  }),
  [Cmd.VOICE_LOCK_SET]: c({
    id: Cmd.VOICE_LOCK_SET, name: 'VOICE_LOCK_SET', safety: 'write', families: ['6301', '6302'], targets: RX, retrySafe: true,
    description: 'Volume lock (camera RX only): 1 = locked, 0 = unlocked. Reply: M2S set-ack; Lark M2 per iOS the new lock state (see parseVoiceLockSetReply)',
    android: 'usbmic/protocol/Pro_set_voice_lock; device6118/CmdSetVoiceLock6118 (A2 UI never uses it)',
    ios: 'codec case 0x34; -[HL6501PacketParser messageForVoiceLockStatus:] @0x1000da44c',
  }),
  [Cmd.VOICE_LOCK_GET]: c({
    id: Cmd.VOICE_LOCK_GET, name: 'VOICE_LOCK_GET', safety: 'read', families: WITH_6501, targets: RX, retrySafe: true,
    description: 'payload[0] == 1 -> locked. Android sends it at M2/M2S/6501 start-up (6501: the lock view is hidden, but onClickBtnGroup still refuses volume while it reads locked); iOS never sends it',
    android: 'usbmic/protocol/Pro_get_voice_lock; HLDevice6302Activity.getDeviceVersion; larkc1/HLDeviceActivity.getDeviceVersion + onEvent cmd 53; device6118/CmdGetVoiceLock6118',
    ios: 'not sent; the parser jump table treats 0x35 as unhandled (@0x1000d9888)',
  }),
  [Cmd.BUTTON_CUSTOM_SET]: c({
    id: Cmd.BUTTON_CUSTOM_SET, name: 'BUTTON_CUSTOM_SET', safety: 'write', families: M2S, targets: RX, retrySafe: true,
    description: 'Custom button slot: [slot 1|2, function, keyOperation, tx1Color, tx2Color]; colour-only update: [0, 0, 0, tx1Color, tx2Color]',
    android: 'usbmic/protocol/Pro_set_btn_custom; usbmic/data/DeviceBtnCustom.BtnCustomBean.toByteArray; ui/custom/CustomFunctionActivity.sendData/sendColor',
    ios: '-[HLKeyFuncEntity getPaylodWithEntity] @0x1000dad5c',
  }),
  [Cmd.BUTTON_COLORS_GET]: c({
    id: Cmd.BUTTON_COLORS_GET, name: 'BUTTON_COLORS_GET', safety: 'read', families: M2S, targets: RX, retrySafe: true,
    description: '[tx1LightColor, tx2LightColor] (0 not set, 1 purple, 2 yellow)',
    android: 'usbmic/protocol/Pro_get_btn_custom', ios: '-[HLKeyFuncController requestLightColor] @0x1000dea9c',
  }),
  [Cmd.RESTART_RX]: c({
    id: Cmd.RESTART_RX, name: 'RESTART_RX', safety: 'disruptive', families: WITH_6501, targets: RX, retrySafe: false,
    description: 'Reboots the receiver; USB disconnects and re-enumerates',
    android: 'device6118/CmdRestartRx6118; usbmic/protocol/Pro_set_restart; larkc1/HLDeviceActivity.mVoiceRunable (3 s after a successful 0x12)',
    ios: 'sendRestartRxDevice @0x10008b1f4',
  }),
  [Cmd.REMOVE_PAIRING]: c({
    id: Cmd.REMOVE_PAIRING, name: 'REMOVE_PAIRING', safety: 'destructive', families: A2, targets: RX, retrySafe: false,
    description: 'Removes the pairing of TX1 (1) or TX2 (2); the mic must be re-paired on the hardware',
    android: 'device6118/CmdDeletePair6118 (coerceIn 1..2); c6118/ui/setting/viewmodel/C6118PairDeviceViewModel',
    ios: 'deleteDevicePairWithType: @0x10008b820',
  }),
  [Cmd.FACTORY_RESET]: c({
    id: Cmd.FACTORY_RESET, name: 'FACTORY_RESET', safety: 'destructive', families: A2, targets: RX, retrySafe: false,
    description: 'Factory reset of the RX ("will erase some data")',
    android: 'device6118/CmdFactoryReset6118; MoreSetting6118ViewModel', ios: 'sendRestoreFactoryReset @0x10008b8b0',
  }),
  [Cmd.OTA_TX_ENTER]: c({
    id: Cmd.OTA_TX_ENTER, name: 'OTA_TX_ENTER', safety: 'ota', families: WITH_6501, targets: [Target.TX1, Target.TX2], retrySafe: false,
    description: 'Put a TX into firmware-upgrade mode: payload = devId from 0x08 (Android: 1 byte; iOS: the whole 0x08 payload)',
    android: 'device6118/CmdOtaTxUpgrade6118; usbmic/protocol/Pro_tx_upgrade',
    ios: '+[HL6501Messenger sendEnterUpgradeToDevice:devid:] @0x10008aea4; messageForDeviceInfoID: @0x1000d9abc',
  }),
  [Cmd.OTA_RX_ENTER]: c({
    id: Cmd.OTA_RX_ENTER, name: 'OTA_RX_ENTER', safety: 'ota', families: WITH_6501, targets: RX, retrySafe: false,
    description: 'Put the RX into firmware-upgrade mode (empty payload)', android: 'device6118/CmdOtaRxUpgrade6118; usbmic/protocol/Pro_rx_upgrade',
    ios: 'sendEnterUpgradeToDevice:devid: @0x10008aea4 (RX devId is empty)',
  }),
  [Cmd.OTA_PACKET_ACK]: c({
    id: Cmd.OTA_PACKET_ACK, name: 'OTA_PACKET_ACK', safety: 'notify', families: WITH_6501, targets: ANY, retrySafe: false,
    description: 'Per-0x55-packet ack. Android: [ok, needCount BE16]; iOS reads only payload[0]',
    android: 'device6118/CmdOtaPacketAck6118; c6118/ui/setting/viewmodel/C6118FirmwareUpgradeViewModel.handlePacketAckFailure',
    ios: '-[HL6501PacketParser messageForUpgradePacketResponse:] @0x1000d9e08; -[HL6501UpgradeCoordinator onUpgradePacketResponse:] @0x1000b7c48',
  }),
  [Cmd.OTA_RESULT]: c({
    id: Cmd.OTA_RESULT, name: 'OTA_RESULT', safety: 'notify', families: WITH_6501, targets: ANY, retrySafe: false,
    description: 'Final upgrade result: [1 = ok]. 6501: next unit after 25 s on the Lark C1 (PID 1), 5 s otherwise (documented only)',
    android: 'device6118/CmdOtaUpgradeResult6118; larkc1/HLDeviceActivity.onEvent cmd 11 ((pid != 1 ? 5 : 25) * 1000)',
    ios: 'onUpgradeResult:result: @0x1000b777c (type > 2 -> 5 s, else 25 s @0x1000b79ac)',
  }),
  [Cmd.DEVICE_WARNING]: c({
    id: Cmd.DEVICE_WARNING, name: 'DEVICE_WARNING', safety: 'notify', families: WITH_6501, targets: ANY, retrySafe: false,
    description: 'HIP_6501_DEVWARNING; declared, never implemented (iOS parser ignores 0x0A/0x0F)',
    android: 'application/common/protocol/Protocol.HIP_6501_DEVWARNING = 10',
  }),
}

export function commandInfo(cmd: number): CommandInfo | undefined {
  return COMMANDS[cmd]
}

export function commandName(cmd: number): string {
  return COMMANDS[cmd]?.name ?? `CMD_${hex8(cmd)}`
}

/** True only for commands catalogued as side-effect-free reads. */
export function isReadOnlyCommand(cmd: number): boolean {
  return COMMANDS[cmd]?.safety === 'read'
}

// ----------------------------------------------------------------------------------- enums


/** UI volume step (0-based button index) -> wire value. Without a map the step is the wire value. */
export function volumeStepToWire(step: number, wireValues?: readonly number[]): number {
  if (!wireValues) return step
  const v = wireValues[step]
  if (!Number.isInteger(step) || v === undefined) throw new CommandError(`volume step must be an integer in 0..${wireValues.length - 1}, got ${step}`)
  return v
}

/**
 * Wire value (0x04 reply, heartbeat body[7]) -> UI step. A larkc1/HLDeviceActivity.updateVoiceGroupWithIndex
 * selects the button whose tag equals the value; a value no button carries selects none (undefined).
 */
export function volumeWireToStep(wire: number, wireValues?: readonly number[]): number | undefined {
  if (!wireValues) return wire
  const i = wireValues.indexOf(wire)
  return i < 0 ? undefined : i
}

/** 6118 noise cancellation level (heartbeat byte 6, 0x06/0x11). 0 = off. */
export const NoiseLevel6118 = { OFF: 0, WEAK: 1, MEDIUM: 2, STRONG: 3 } as const
/** 6301/6302 noise level. */
export const NoiseLevelM2 = { OFF: 0, LOW: 1, STRONG: 2 } as const

export const ChannelMode = { MONO: 0, STEREO: 1, SAFETY_TRACK: 2 } as const
export type ChannelMode = (typeof ChannelMode)[keyof typeof ChannelMode]

/** 6118 "Bel canto preset" (strings c6118_preset_btn1..3; DeviceConnectVariable.PRESET). */
export const VoicePreset = { BRIGHT: 0, LOW: 1, BALANCE: 2 } as const
export type VoicePreset = (typeof VoicePreset)[keyof typeof VoicePreset]
export const VOICE_PRESET_NAMES: Record<number, string> = { 0: 'Bright', 1: 'Low', 2: 'Balance' }

/** M2S custom-button function (usbmic/data/DeviceBtnCustom.BtnFunction). */
export const ButtonFunction = { NOT_SET: 0, RX_SELF_LOCK: 1, TX_MUTE_ALL: 2, TX_MUTE_THIS: 3, TX_IDENTIFY: 4 } as const
/** M2S key operation (DeviceBtnCustom.KeyOperation). */
export const KeyOperation = {
  NOT_SET: 0,
  MOBILE_POWER_DOUBLE: 1,
  MOBILE_POWER_TRIPLE: 2,
  CAMERA_POWER_SINGLE: 3,
  CAMERA_POWER_DOUBLE: 4,
  CAMERA_NOISE_DOUBLE: 5,
  TX_POWER_DOUBLE: 6,
  TX_POWER_TRIPLE: 7,
} as const
export const LightColor = { NOT_SET: 0, PURPLE: 1, YELLOW: 2 } as const

/** Physical button of each KeyOperation (DeviceBtnCustom.KeyOperation -> BtnOperation + ClickOperation). */
export const ButtonKey = { NONE: 0, MOBILE_RX_POWER: 1, CAMERA_RX_POWER: 2, CAMERA_RX_NOISE: 3, TX_POWER: 4 } as const
export const KEY_OPERATIONS: Readonly<Record<number, { button: number; clicks: number }>> = {
  0: { button: ButtonKey.NONE, clicks: 0 },
  1: { button: ButtonKey.MOBILE_RX_POWER, clicks: 2 },
  2: { button: ButtonKey.MOBILE_RX_POWER, clicks: 3 },
  3: { button: ButtonKey.CAMERA_RX_POWER, clicks: 1 },
  4: { button: ButtonKey.CAMERA_RX_POWER, clicks: 2 },
  5: { button: ButtonKey.CAMERA_RX_NOISE, clicks: 2 },
  6: { button: ButtonKey.TX_POWER, clicks: 2 },
  7: { button: ButtonKey.TX_POWER, clicks: 3 },
}

/**
 * Functions and buttons the M2S app offers per receiver (DeviceBtnCustom.CameraBtnFunction /
 * MobileBtnFunction, used by larkc1/adapter/CustomFunctionAdapter). RX self-lock exists only on
 * the camera RX.
 */
export const BUTTON_FUNCTIONS: Readonly<Record<'camera' | 'mobile', Readonly<Record<number, readonly number[]>>>> = {
  camera: {
    [ButtonFunction.RX_SELF_LOCK]: [ButtonKey.CAMERA_RX_POWER, ButtonKey.CAMERA_RX_NOISE],
    [ButtonFunction.TX_MUTE_ALL]: [ButtonKey.CAMERA_RX_POWER, ButtonKey.CAMERA_RX_NOISE],
    [ButtonFunction.TX_MUTE_THIS]: [ButtonKey.CAMERA_RX_POWER, ButtonKey.CAMERA_RX_NOISE, ButtonKey.TX_POWER],
    [ButtonFunction.TX_IDENTIFY]: [ButtonKey.CAMERA_RX_POWER, ButtonKey.CAMERA_RX_NOISE, ButtonKey.TX_POWER],
  },
  mobile: {
    [ButtonFunction.TX_MUTE_ALL]: [ButtonKey.MOBILE_RX_POWER],
    [ButtonFunction.TX_MUTE_THIS]: [ButtonKey.MOBILE_RX_POWER, ButtonKey.TX_POWER],
    [ButtonFunction.TX_IDENTIFY]: [ButtonKey.MOBILE_RX_POWER, ButtonKey.TX_POWER],
  },
}

/**
 * Which slot (1 or 2) a function goes into, as CustomFunctionActivity does it: the slot that
 * already holds `func` (sendData / addFunction "Set"), otherwise the first slot whose function is
 * NOT_SET (addFunction "Add"). Returns null when both slots hold other functions.
 * `slots` are the heartbeat bytes 11/12 decoded (ButtonAssignment, index 0 = slot 1).
 */
export function pickButtonSlot(slots: readonly ({ func: number } | undefined)[], func: number): 1 | 2 | null {
  for (let i = 0; i < 2; i++) if (slots[i]?.func === func) return (i + 1) as 1 | 2
  for (let i = 0; i < 2; i++) if ((slots[i]?.func ?? ButtonFunction.NOT_SET) === ButtonFunction.NOT_SET) return (i + 1) as 1 | 2
  return null
}

// -------------------------------------------------------------------------------- builders

export class CommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandError'
  }
}

function int(name: string, v: number, min: number, max: number): number {
  if (!Number.isInteger(v) || v < min || v > max) throw new CommandError(`${name} must be an integer in ${min}..${max}, got ${v}`)
  return v
}

function frame(cmd: number, target: Target = Target.RX, payload: number[] = []): RequestFrame {
  return { cmd, target, payload }
}

function buttonColorFrame(tx1Color: number, tx2Color: number, func = 0, keyOp = 0): RequestFrame {
  if (func !== 0 || keyOp !== 0) throw new CommandError('a colour-only button write (slot 0) must have function 0 and key operation 0')
  const ok =
    (tx1Color === LightColor.PURPLE && tx2Color === LightColor.YELLOW) || (tx1Color === LightColor.YELLOW && tx2Color === LightColor.PURPLE)
  if (!ok) throw new CommandError(`TX colours must be (1 purple, 2 yellow) or (2 yellow, 1 purple), got (${tx1Color}, ${tx2Color})`)
  return frame(Cmd.BUTTON_CUSTOM_SET, Target.RX, [0, 0, 0, tx1Color, tx2Color])
}

/** Request builders. They validate ranges for the given family where it matters. */
export const Requests = {
  heartbeat: () => frame(Cmd.HEARTBEAT),
  /** 6118 version (0x41). */
  version: (target: Target = Target.RX) => frame(Cmd.VERSION_GET, target),
  versionLegacy: (target: Target = Target.RX) => frame(Cmd.VERSION_LEGACY_GET, target),
  /** Version with the right command for the family. */
  versionFor: (family: Family, target: Target = Target.RX) =>
    family === '6118' ? frame(Cmd.VERSION_GET, target) : frame(Cmd.VERSION_LEGACY_GET, target),
  serial: (target: Target = Target.RX) => frame(Cmd.SERIAL_GET, target),
  deviceInfo: () => frame(Cmd.DEVICE_INFO_GET),
  /** Payload repeats the target index (Android CmdGetDeviceId6118.encodeLegacyPayload). */
  deviceId: (target: Target = Target.RX) => frame(Cmd.DEVICE_ID_GET, target, [target]),
  noiseLevelGet: () => frame(Cmd.NOISE_LEVEL_GET),
  volumeGet: () => frame(Cmd.VOLUME_GET),
  speakerGet: () => frame(Cmd.SPEAKER_GET),
  micRecognitionGet: () => frame(Cmd.MIC_RECOGNITION_GET),
  smartBatteryGet: () => frame(Cmd.SMART_BATTERY_GET),
  voiceLockGet: () => frame(Cmd.VOICE_LOCK_GET),
  buttonColorsGet: () => frame(Cmd.BUTTON_COLORS_GET),

  noiseLevelSet: (level: number, family: Family = '6118') =>
    frame(Cmd.NOISE_LEVEL_SET, Target.RX, [int('noise level', level, family === '6118' ? 0 : 0, family === '6118' ? 3 : 2)]),
  /** Always [0x02]: the firmware toggles NC on/off. */
  noiseToggle: () => frame(Cmd.NOISE_TOGGLE, Target.RX, [0x02]),
  volumeSet: (step: number, maxStep = 5) => frame(Cmd.VOLUME_SET, Target.RX, [int('volume step', step, 0, maxStep)]),
  channelModeSet: (mode: number, family: Family = '6118') =>
    frame(Cmd.CHANNEL_MODE_SET, Target.RX, [int('channel mode', mode, 0, family === '6118' ? 2 : 1)]),
  voicePresetSet: (enabled: boolean, preset: number) =>
    frame(Cmd.VOICE_PRESET_SET, Target.RX, [enabled ? 1 : 0, int('voice preset', preset, 0, 2)]),
  /** LED on -> 0, off -> 1. */
  ledSet: (on: boolean) => frame(Cmd.LED_SET, Target.RX, [on ? 0 : 1]),
  micRecognitionSet: (on: boolean) => frame(Cmd.MIC_RECOGNITION_SET, Target.RX, [on ? 1 : 0]),
  smartBatterySet: (on: boolean) => frame(Cmd.SMART_BATTERY_SET, Target.RX, [on ? 1 : 0]),
  /** Speaker passthrough on -> 0, off -> 1. Needs RX restart to take effect. */
  speakerSet: (on: boolean) => frame(Cmd.SPEAKER_SET, Target.RX, [on ? 0 : 1]),
  /** Auto power-off enabled (15 min) -> 0, never -> 1. */
  autoOffSet: (enabled: boolean) => frame(Cmd.AUTO_OFF_SET, Target.RX, [enabled ? 0 : 1]),
  voiceLockSet: (locked: boolean) => frame(Cmd.VOICE_LOCK_SET, Target.RX, [locked ? 1 : 0]),
  /**
   * 0x37 = DeviceBtnCustom.BtnCustomBean.toByteArray: [slot, function, keyOperation, tx1Color, tx2Color].
   * `index` is a function SLOT (1 or 2, heartbeat bytes 11/12), not a TX unit; the physical button
   * is part of `keyOp`. CustomFunctionActivity.sendData sends the current colours with every slot
   * write (0 = not set before the first 0x38 reply). `index: 0` is the colour-only write
   * (sendColor): function and keyOp must then be 0 and the colours a complementary pair.
   */
  buttonCustomSet: (b: { index: 0 | 1 | 2; func: number; keyOp: number; tx1Color: number; tx2Color: number }) => {
    const index = int('button slot', b.index, 0, 2)
    if (index === 0) return buttonColorFrame(b.tx1Color, b.tx2Color, b.func, b.keyOp)
    return frame(Cmd.BUTTON_CUSTOM_SET, Target.RX, [
      index,
      int('button function', b.func, 0, 4),
      int('key operation', b.keyOp, 0, 7),
      int('tx1 color', b.tx1Color, 0, 2),
      int('tx2 color', b.tx2Color, 0, 2),
    ])
  },
  /**
   * Colour-only 0x37 (CustomFunctionActivity.sendColor): `00 00 00 c1 c2`. The app offers only the
   * pairs (PURPLE, YELLOW) and (YELLOW, PURPLE) (initView$lambda$5..8), so other pairs are refused.
   */
  buttonColorSet: (tx1Color: number, tx2Color: number) => buttonColorFrame(tx1Color, tx2Color),
  // firmware-upgrade entry (builders only; HollylandDevice never sends them, PROTOCOL.md §10)
  /** 0x09 to TX1/TX2. Android sends the 1-byte devId, iOS the whole 0x08 reply payload. */
  otaTxEnter: (target: 1 | 2, devId: ArrayLike<number>) => {
    if (target !== Target.TX1 && target !== Target.TX2) throw new CommandError('OTA_TX_ENTER targets TX1 or TX2')
    if (devId.length < 1) throw new CommandError('OTA_TX_ENTER needs the devId from 0x08')
    return frame(Cmd.OTA_TX_ENTER, target, Array.from(devId, (v, i) => int(`devId byte ${i}`, v, 0, 255)))
  },
  /** 0x0D to the RX, empty payload (iOS: the RX devId is empty; Android CmdOtaRxUpgrade6118). */
  otaRxEnter: () => frame(Cmd.OTA_RX_ENTER),
  // destructive / disruptive (gated in HollylandDevice)
  restartRx: () => frame(Cmd.RESTART_RX),
  removePairing: (tx: 1 | 2) => frame(Cmd.REMOVE_PAIRING, Target.RX, [int('tx index', tx, 1, 2)]),
  factoryReset: () => frame(Cmd.FACTORY_RESET),
} as const

// --------------------------------------------------------------------------------- parsers

const at = (p: Uint8Array, i: number): number => (i < p.length ? p[i] : 0)

export interface SetAck {
  ok: boolean
  /** payload[0] or null when the reply carried no payload. */
  code: number | null
}

/** Base6118UsbCmd.parseSetResponse: success iff payload[0] == 1. */
export function parseSetAck(payload: Uint8Array): SetAck {
  return { ok: payload.length > 0 && payload[0] === 1, code: payload.length ? payload[0] : null }
}

export interface TxStatus {
  online: boolean
  /** Percent 0..100 (as reported). */
  battery: number
  /** 6118 only (heartbeat body[15]); undefined on M2/M2S, where neither app decodes a mute flag. */
  muted?: boolean
  /** 6118 only (heartbeat body[15]); undefined on M2/M2S. */
  charging?: boolean
}

/**
 * Which 6118 heartbeat fields carry a usable value. iOS validates before applying
 * (-[HLHeartEntity initEntityWithData:] @0x1001fa17c + -[HL6501Engine handleHeartbeatEntity:]
 * @0x1000bc1d0): noise only if < 4, volume / channel mode / auto-off only if LEN >= 8, LED only
 * if LEN > 9 (both key entities present). Android reads missing bytes as 0. The library is
 * stricter than both: a field counts only when its byte is present (and noise < 4).
 */
export interface Heartbeat6118Validity {
  link: boolean
  noise: boolean
  volume: boolean
  channelMode: boolean
  autoPowerOff: boolean
  led: boolean
  voicePreset: boolean
  /** body[15] mute/charge flags. */
  flags: boolean
  /** body[16] camera-RX battery. */
  rxBattery: boolean
}

export interface Heartbeat6118 {
  family: '6118'
  tx: [TxStatus, TxStatus]
  /** 0 = NC off, 1 Weak, 2 Medium, 3 Strong. */
  noiseLevel: number
  noiseEnabled: boolean
  /** RX volume step (0..5 mobile, 0..2 camera). */
  volume: number
  channelMode: number
  /** TX auto power-off after 15 min idle. */
  autoPowerOff: boolean
  ledOn: boolean
  voicePreset: { enabled: boolean; preset: number }
  /** Camera RX (PID 1042) only. */
  rxCamera: { battery: number; charging: boolean }
  /**
   * body[8] != 0. iOS copies it into volumeLocked for every deviceType >= 3, the A2 included
   * (handleHeartbeatEntity @0x1000bc474), but no A2 view reads it and Android ignores it.
   */
  lockByte: number | undefined
  /** Fields present / plausible (see Heartbeat6118Validity). Raw values above read missing bytes as 0 (Android). */
  valid: Heartbeat6118Validity
  /** Bytes the apps do not decode on the 6118 (body index -> value). */
  unknown: Record<number, number>
  payloadLength: number
}

/** CmdGetHeart6118.decodeLegacyPayload (missing bytes read as 0) + iOS-style validity flags. */
export function parseHeartbeat6118(p: Uint8Array): Heartbeat6118 {
  const has = (i: number) => p.length > i
  const preset = at(p, 14)
  const flags = at(p, 15)
  const unknown: Record<number, number> = {}
  for (const i of [4, 5, 8, 11, 12]) if (i < p.length) unknown[i] = p[i]
  for (let i = 17; i < p.length; i++) unknown[i] = p[i]
  const noise = at(p, 6)
  const hasFlags = has(15)
  return {
    family: '6118',
    tx: [
      { online: at(p, 0) === 1, battery: at(p, 2), muted: (flags & 0x01) !== 0, charging: (flags & 0x04) !== 0 },
      { online: at(p, 1) === 1, battery: at(p, 3), muted: (flags & 0x02) !== 0, charging: (flags & 0x08) !== 0 },
    ],
    noiseLevel: noise,
    noiseEnabled: noise !== 0,
    volume: at(p, 7),
    channelMode: at(p, 9),
    autoPowerOff: at(p, 10) === 0,
    ledOn: at(p, 13) === 0,
    voicePreset: { enabled: (preset & 0x01) !== 0, preset: (preset >> 1) & 0x7f },
    rxCamera: { battery: at(p, 16), charging: (flags & 0x10) !== 0 },
    lockByte: has(8) ? p[8] : undefined,
    valid: {
      link: has(3),
      noise: has(6) && noise < 4, // -[HL6501Engine isHeartbeatNoiseLevelValid:] @0x1000bafac
      volume: has(7),
      channelMode: has(9),
      autoPowerOff: has(10),
      led: has(13),
      voicePreset: has(14),
      flags: hasFlags,
      rxBattery: has(16),
    },
    unknown,
    payloadLength: p.length,
  }
}

export interface ButtonAssignment {
  /** High nibble: ButtonFunction. */
  func: number
  /** Low nibble: KeyOperation. */
  keyOp: number
}

/**
 * M2 / M2S heartbeat, also the 6501 group's: A larkc1/HLDeviceActivity parses it with the same
 * usbmic/protocol/Pro_get_heart (legacy-6501.md §4). What each family APPLIES differs (device.ts).
 */
export interface HeartbeatM2 {
  family: '6301' | '6302' | '6501'
  /** muted / charging are always undefined: neither app decodes them on M2/M2S. */
  tx: [TxStatus, TxStatus]
  /** Signed 16-bit (b4*256 + b5, both signed as in Pro_get_heart); unused by the app. */
  uv: number
  /** 0 off, 1 low, 2 strong. */
  noiseLevel: number | undefined
  volume: number | undefined
  voiceLocked: boolean | undefined
  channelMode: number | undefined
  autoPowerOff: boolean | undefined
  /** Function slots 1 and 2 (body[11], body[12]); not TX1/TX2. */
  buttons: [ButtonAssignment | undefined, ButtonAssignment | undefined]
  ledOn: boolean | undefined
  /** Bytes past body[13] (neither app decodes them on M2/M2S). */
  unknown: Record<number, number>
  payloadLength: number
}

const s8 = (v: number): number => (v > 127 ? v - 256 : v)

/**
 * usbmic/protocol/Pro_get_heart.receiveData (fields gated on payload length; the minimum it accepts is
 * 6 bytes, `data.length >= 6`, which is what a Lark C1 may send: legacy-6501.md §7.1 [?]).
 */
export function parseHeartbeatM2(p: Uint8Array, family: '6301' | '6302' | '6501' = '6302'): HeartbeatM2 {
  const has = (i: number) => p.length > i
  const nib = (v: number): ButtonAssignment => ({ func: (v >> 4) & 0x0f, keyOp: v & 0x0f })
  // HLHeartEntity (@0x1001fa17c) reads the 6118 mute/charge byte (body[15]) for every device, but
  // HL6501Engine.handleHeartbeatEntity applies it only when +[HLDeviceUtils isConnect6118Device]
  // (@0x1000bc628), and Android's Pro_get_heart stops at body[12]. So body[15] stays undecoded here.
  const unknown: Record<number, number> = {}
  for (let i = 14; i < p.length; i++) unknown[i] = p[i]
  return {
    family,
    tx: [
      { online: at(p, 0) === 1, battery: at(p, 2) },
      { online: at(p, 1) === 1, battery: at(p, 3) },
    ],
    uv: s8(at(p, 4)) * 256 + s8(at(p, 5)),
    noiseLevel: has(6) ? p[6] : undefined,
    volume: has(7) ? p[7] : undefined,
    voiceLocked: has(8) ? p[8] === 1 : undefined,
    channelMode: has(9) ? p[9] : undefined,
    autoPowerOff: has(10) ? p[10] === 0 : undefined,
    buttons: [has(11) ? nib(p[11]) : undefined, has(12) ? nib(p[12]) : undefined],
    ledOn: has(13) ? p[13] === 0 : undefined,
    unknown,
    payloadLength: p.length,
  }
}

export type Heartbeat = Heartbeat6118 | HeartbeatM2

export function parseHeartbeat(family: Family, payload: Uint8Array): Heartbeat {
  return family === '6118' ? parseHeartbeat6118(payload) : parseHeartbeatM2(payload, family)
}

/**
 * 0x41: LegacyUsb6118CommandsKt.formatSixByteDeviceVersion: "b0.b1.b2." + b3 + b4 + b5.
 * Android: '' if < 6 bytes, extra bytes ignored. iOS -[HLDeviceEntity getNewVersionWithData:]
 * @0x1001fd054 requires exactly 6 (anything else -> ''). The live A2 sends exactly 6
 * (PROTOCOL.md §11.6), where both agree; the library keeps the Android rule.
 */
export function parseVersion6118(p: Uint8Array): string {
  if (p.length < 6) return ''
  return `${p[0]}.${p[1]}.${p[2]}.${p[3]}${p[4]}${p[5]}`
}

/** Pro_get_version (M2/M2S): decimal bytes joined with '.'. */
export function parseVersionLegacy(p: Uint8Array): string {
  return Array.from(p, (b) => String(b)).join('.')
}

/** LegacyUsb6118CommandsKt.formatLegacyVersion (6118 decoder for 0x03): last part zero-padded to 3. */
export function parseVersionLegacy6118(p: Uint8Array): string {
  const parts = Array.from(p, (b) => String(b))
  if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].padStart(3, '0')
  return parts.join('.')
}

/**
 * 0x15 serial.
 *  - 6118 (LegacyUsb6118CommandsKt.asciiString): bytes up to the first NUL, decoded US-ASCII
 *    (bytes >= 0x80 become U+FFFD, they are not masked), then trimmed.
 *  - M2/M2S (usbmic/protocol/Pro_get_sn.receiveData): the whole payload as UTF-8, no NUL cut,
 *    no trim. U+0000 characters are removed, as iOS does for every family
 *    (-[HL6501PacketParser messageForDeviceSN:] @0x1000da26c); Android would keep them invisibly.
 */
export function parseSerial(p: Uint8Array, family: Family = '6118'): string {
  if (family !== '6118') return new TextDecoder('utf-8').decode(p).replace(/\u0000/g, '')
  let end = p.indexOf(0)
  if (end < 0) end = p.length
  let s = ''
  for (let i = 0; i < end; i++) s += p[i] < 0x80 ? String.fromCharCode(p[i]) : '�'
  return s.trim()
}

export interface NoiseLevelReading {
  enabled: boolean
  level: number
  raw: number
}

/**
 * 0x11 on the 6118. The apps disagree and the A2 UI on Android never sends it:
 *  - Android CmdGetNoiseLevel6118: bit7 = enabled, bits0-6 = level; level = enabled ? b & 0x7F : 0,
 *    clamped 0..3 (this is the top-level result, kept for compatibility).
 *  - iOS messageForNoiseLevel: @0x1000d9eb0 + handleNoiseLevelEvent block @0x1000bd034: level = raw
 *    byte, NC on = raw > 0 (no bit7, no range check).
 * The two agree only for 0x00 (the live A2 reply with NC off, PROTOCOL.md §11.6). `agree` tells
 * whether this reading is unambiguous. HollylandDevice takes 6118 noise state from the heartbeat (body[6]), where both
 * apps agree, and never from 0x11.
 */
export function parseNoiseLevelGet6118(p: Uint8Array): NoiseLevelReading & { ios: { enabled: boolean; level: number }; agree: boolean } {
  const v = at(p, 0)
  const enabled = (v & 0x80) !== 0
  const level = enabled ? Math.min(3, v & 0x7f) : 0
  const ios = { enabled: v > 0, level: v }
  return { enabled, level, raw: v, ios, agree: ios.enabled === enabled && ios.level === level }
}

/** Pro_get_noise: signed byte 0 off / 1 low / 2 strong. */
export function parseNoiseLevelGetM2(p: Uint8Array): NoiseLevelReading {
  const v = s8(at(p, 0))
  return { enabled: v > 0, level: v, raw: at(p, 0) }
}

/**
 * 0x06 reply on M2/M2S (usbmic/protocol/Pro_set_noise.receiveData): needs >= 2 bytes
 * [status, level]; with fewer, setStatus keeps its default false and the app reports failure
 * (UsbMessengerV1.onEvent command 6 -> onResponseSet(getSetStatus())).
 */
export function parseNoiseSetM2(p: Uint8Array): { ok: boolean; level: number | undefined } {
  if (p.length < 2) return { ok: false, level: undefined }
  return { ok: p[0] === 1, level: s8(p[1]) }
}

/**
 * 0x34 reply.
 *  - M2S (deviceType 7) and Android for both families: set-ack, payload[0] == 1
 *    (usbmic/protocol/Pro_set_voice_lock; I messageForVoiceLockStatus: @0x1000da4c8 type-7 path).
 *  - Lark M2 on iOS: the new lock state, payload[0] != 0 -> locked (@0x1000da530).
 * On 6301 the library accepts either reading: ok when payload[0] == 1 or equals the requested
 * state. Unlock -> 0 is "unlocked" for iOS and would be a failure for Android; lock -> 0 fails in both.
 */
export function parseVoiceLockSetReply(p: Uint8Array, family: Family, locked: boolean): SetAck {
  if (!p.length) return { ok: false, code: null }
  const v = p[0]
  if (family === '6301') return { ok: v === 1 || v === (locked ? 1 : 0), code: v }
  return { ok: v === 1, code: v }
}

export const parseByte0 = (p: Uint8Array): number => at(p, 0)
/**
 * 0x3C / 0x3E / 0x35: payload[0] == 1 (Android CmdGetTxIdentify6118 / CmdGetSmartBattery6118 /
 * Pro_get_voice_lock). iOS messageForMicIdentify: @0x1000da68c / messageForEndurance: @0x1000da734
 * take any non-zero value as on; the two differ only for values >= 2 (never observed; the live A2
 * answered 0x00 / 0x01, PROTOCOL.md §11.6).
 */
export const parseFlagIsOne = (p: Uint8Array): boolean => at(p, 0) === 1
/** 0x13: payload[0] == 0 -> speaker passthrough on. */
export const parseSpeakerGet = (p: Uint8Array): boolean => p.length > 0 && p[0] === 0

/**
 * 0x16 (iOS -[HL6501Engine resolveDeviceHeaderImageWithPayload:] @0x1000bd910): payload[0] == 2
 * -> camera RX for M2S (type 7) and A2 (types 8/9). For Lark M2 (type 3) iOS additionally needs the
 * LEN low byte > 8 (@0x1000bd9f4-0x1000bda1c). The live A2 answered LEN 9 `00 00 00 06 01 01 5b 5c 00`.
 */
export function parseDeviceInfo(
  p: Uint8Array,
  family: Family = '6118',
  lenLo: number = p.length & 0xff,
  productId?: number,
): { variant: number; cameraRx: boolean; mini: boolean; raw: Uint8Array } {
  const variant = at(p, 0)
  // 6501 group: resolveDeviceHeaderImageWithPayload: has no camera branch for types 0/1/2/4/6
  // (fall-through @0x1000bda88). Only type 5 ("lark m1 pro") reads body[0]: == 3 means Lark Mini (type 6,
  // `cmp x23, 5; b.eq 0x1000bda24` → `cmp x22, 3; cinc` @0x1000bda2c). Types 0/1/2/4 (C1, MAX, C1 TYPEC,
  // C1 2nd gen) never read it. With `productId` the flag is therefore set only for the PIDs iOS sees as
  // `lark m1 pro` (LARK_M1_PRO_PIDS); without it, body[0] == 3 is reported as is. Over USB the PID already
  // tells PID 12 and 13 apart, so the flag is informational.
  const cameraRx = family !== '6501' && variant === 2 && (family !== '6301' || lenLo > 8)
  const mini = family === '6501' && variant === 3 && (productId === undefined || LARK_M1_PRO_PIDS.includes(productId))
  return { variant, cameraRx, mini, raw: p }
}

/**
 * USB PIDs whose receiver iOS identifies as `lark m1 pro` (deviceType 5): PID 12 (Lark M1 2nd gen) and PID 13
 * (Lark Mini, which has no EA model of its own and becomes type 6 through 0x16 body[0] == 3). models.ts rows
 * 12/13; I -[EADSessionManager setupControllerForAccessory:withProtocolString:] @0x10012477c.
 */
export const LARK_M1_PRO_PIDS: readonly number[] = [12, 13]

/**
 * Lark C1 firmware line (A application/httpcommon/utils/Util.isNew6501): at least 4 dot parts and
 * parts[2] >= 4 = the USB-C ("TYPEC") firmware, whose packages are `6501RX_TYPEC` / `6501TX_TYPEC`
 * (HlDevice.getDeviceCode); iOS turns `lark c1` (type 0) into type 2 when the second-to-last part
 * is "4" (-[HL6501Engine updateDeviceTypeIfNeededByVersion:] @0x1000bd6ac). Informational only: it
 * changes the firmware source and the iOS banner, no command.
 */
export function isNew6501(version: string | undefined): boolean {
  if (!version) return false
  const parts = version.split('.')
  if (parts.length < 4) return false
  const n = parseInt(parts[2], 10)
  return Number.isFinite(n) && n >= 4
}

/** 0x08: Android keeps the first byte (CmdGetDeviceId6118 take(1)); iOS keeps the whole payload as the devId. */
export function parseDeviceId(p: Uint8Array): { id: number; raw: Uint8Array } {
  return { id: at(p, 0), raw: p }
}

/** 0x38 (M2S): [tx1Color, tx2Color]. */
export function parseButtonColors(p: Uint8Array): { tx1: number; tx2: number } {
  return { tx1: at(p, 0), tx2: at(p, 1) }
}

/**
 * 0x0E per-packet ack.
 *  - Android CmdOtaPacketAck6118: ok = b0 != 0, needCount = BE16(b1, b2) when >= 3 bytes; on failure
 *    C6118FirmwareUpgradeViewModel.handlePacketAckFailure resends packet `needCount` (max 3 tries).
 *  - iOS messageForUpgradePacketResponse: @0x1000d9e08 reads only b0; onUpgradePacketResponse:
 *    @0x1000b7c48 resends the same index (sendPkgWithRepeatCount: 10) when b0 == 0.
 */
export function parseOtaAck(p: Uint8Array): { ok: boolean; needCount: number; hasNeedCount: boolean } {
  return { ok: at(p, 0) !== 0, needCount: p.length >= 3 ? (p[1] << 8) | p[2] : 0, hasNeedCount: p.length >= 3 }
}

/** 0x0B final result (CmdOtaUpgradeResult6118): b0 == 1 -> success. */
export function parseOtaResult(p: Uint8Array): { ok: boolean; code: number | null } {
  return { ok: p.length > 0 && p[0] === 1, code: p.length ? p[0] : null }
}

/** Human readable one-line description of a decoded payload, for debug consoles. */
export function describePayload(cmd: number, direction: 'request' | 'response', payload: Uint8Array, family: Family = '6118'): string {
  const info = COMMANDS[cmd]
  const name = info?.name ?? `CMD_${hex8(cmd)}`
  if (direction === 'request') return payload.length ? `${name} [${Array.from(payload, (b) => hex8(b)).join(' ')}]` : name
  try {
    switch (cmd) {
      case Cmd.HEARTBEAT:
        return `${name} ${JSON.stringify(parseHeartbeat(family, payload))}`
      case Cmd.VERSION_GET:
        return `${name} "${parseVersion6118(payload)}"`
      case Cmd.VERSION_LEGACY_GET:
        return `${name} "${family === '6118' ? parseVersionLegacy6118(payload) : parseVersionLegacy(payload)}"`
      case Cmd.SERIAL_GET:
        return `${name} "${parseSerial(payload, family)}"`
      case Cmd.NOISE_LEVEL_GET:
        return `${name} ${JSON.stringify(family === '6118' ? parseNoiseLevelGet6118(payload) : parseNoiseLevelGetM2(payload))}`
      case Cmd.SPEAKER_GET:
        return `${name} speakerOn=${parseSpeakerGet(payload)}`
      case Cmd.MIC_RECOGNITION_GET:
      case Cmd.SMART_BATTERY_GET:
      case Cmd.VOICE_LOCK_GET:
        return `${name} on=${parseFlagIsOne(payload)}`
      case Cmd.VOLUME_GET:
        // 6501: a wire value (the Lark C1 maps it through LARK_C1_VOLUME_WIRE; the others use it as the step).
        return `${name} ${family === '6501' ? 'wire' : 'step'}=${parseByte0(payload)}`
      case Cmd.DEVICE_INFO_GET: {
        const d = parseDeviceInfo(payload, family)
        return `${name} variant=${d.variant} ${family === '6501' ? `mini=${d.mini}` : `cameraRx=${d.cameraRx}`}`
      }
      case Cmd.DEVICE_ID_GET:
        return `${name} id=${hex8(parseDeviceId(payload).id)}`
      case Cmd.BUTTON_COLORS_GET:
        return `${name} ${JSON.stringify(parseButtonColors(payload))}`
      case Cmd.OTA_PACKET_ACK:
        return `${name} ${JSON.stringify(parseOtaAck(payload))}`
      case Cmd.OTA_RESULT:
        return `${name} ${JSON.stringify(parseOtaResult(payload))}`
      case Cmd.NOISE_LEVEL_SET:
        if (family !== '6118') return `${name} ${JSON.stringify(parseNoiseSetM2(payload))}`
        return `${name} ack=${JSON.stringify(parseSetAck(payload))}`
      default:
        if (info && info.safety !== 'read') return `${name} ack=${JSON.stringify(parseSetAck(payload))}`
        return `${name} [${Array.from(payload, (b) => hex8(b)).join(' ')}]`
    }
  } catch (e) {
    return `${name} <parse error: ${(e as Error).message}>`
  }
}
