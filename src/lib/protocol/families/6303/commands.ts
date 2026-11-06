/**
 * LARK M3 (6303) command table, payload unit ids and request builders (docs/research/families/m3-6303.md §5).
 *
 * IDs: A protocol/core/sound/command/type/Command6303 (87 constants) and the generated classes in
 * A protocol/core/sound/command/device6303/Cmd*6303 (payload layouts: *EntityExtKt.cmdSerialize, *EntitySerializer
 * .deserialize, all ByteOrder.LITTLE_ENDIAN). iOS confirmation: the HL6303CommandType raw-value table
 * (I @0x100c1a318, init(rawValue:) @0x1004401f4); every id both apps share has the same value
 * (__tests__/command-tables.ts pins the shared, Android-only and iOS-only ids).
 *
 * The ids collide with 6201 / 6701 ids of different meaning (6303 0x600B = TX recognition GET, 6201/6701 0x600B =
 * heartbeat), so this table is family-private. Every setter takes an absolute value: there are no toggles.
 *
 * Safety classes (FAMILIES.md §2.3, enforced by core/engine.ts from this catalogue):
 *  - 'disruptive' (need { confirm }): 0x1007 playback without unplugging and 0x1009 bit depth (A MoreSetting6303Activity
 *    shows "Restart Device / This change requires a restart. Continue?" before both), 0x6007 work mode (wireless
 *    monitoring, the RXs restart: R enable_wireless_note), 0x0034 switch primary RX (A MasterDeviceSwitchActivity
 *    "master_slave_switching" loading dialog), 0x600E start pairing. 0x1005 channel mode is 'write' here: only a
 *    change to or from 4-track restarts (A EquipmentFragment.initSoundMode$lambda$28/31/34 → showSwitchDialog), which
 *    M3Device enforces per value (session.ts).
 *  - 'destructive' (refused on untested products, documented only): 0x6003 factory reset, 0x600D unpair a TX / RX,
 *    0x002F / 0x0030 forget Bluetooth earphones, 0x0024 write the Bluetooth MAC (iOS only).
 *  - 'ota' (always refused; firmware update is never implemented): 0x4000–0x400B, 0x4011–0x4013 (m3-6303.md §5.7).
 *  - 'notify' (device → host only): Bluetooth events 0x0029, 0x002A, 0x0031, 0x0032, 0x0036 (m3-6303.md §5.5).
 *  - Voice profiles (0x1F00–0x1F19) are catalogued only (FAMILIES.md §2.2 W10); writes are 'write', the page
 *    heartbeats and 0x1F02 (Android / iOS name conflict) are 'write' too, so nothing sends them in the background.
 */
import type { Safety } from '../../commands'
import type { CommandCatalogue, CommandSpec, UnitId } from '../../core/types'
import { momaRequest, type MomaRequest } from '../../moma/spec'

export const M3Cmd = {
  // ------------------------------------------------------------ RF / Bluetooth earphones (wireless monitoring)
  BT_GET_RF_MAC: 0x001b,
  BT_SET_RF_MAC: 0x0024,
  BT_GET_RF_NAME: 0x0025,
  BT_SET_RF_NAME: 0x0026,
  BT_INQUIRY: 0x0027,
  BT_INQ_CANCEL: 0x0028,
  BT_INQ_REPORT: 0x0029,
  BT_INQ_COMPLETE: 0x002a,
  BT_CONNECT: 0x002b,
  BT_DISCONNECT: 0x002c,
  BT_GET_CDL: 0x002d,
  BT_GET_PDL: 0x002e,
  BT_DELETE_PDL: 0x002f,
  BT_CLEAN_PDL: 0x0030,
  BT_CONNECT_EVT: 0x0031,
  BT_DISCONN_EVT: 0x0032,
  BT_GET_PD_NAME: 0x0033,
  RF_SET_RX_MASTER: 0x0034,
  BT_AVRCP_SET_VOL: 0x0035,
  BT_AVRCP_VOL_RPT: 0x0036,
  BT_SET_CHN_MODE: 0x0037,
  BT_GET_CHN_MODE: 0x0038,
  BT_STATUS_FOR_HEART: 0x0039,
  BT_STATUS_CLEAR_INQUIRY_RESULT: 0x0040,
  // ------------------------------------------------------------ audio (home page, More Settings)
  GET_MUTE: 0x1000,
  SET_MUTE: 0x1001,
  GET_NOISE_STATUS: 0x1002,
  SET_NOISE_STATUS: 0x1003,
  GET_SOUND_MODE: 0x1004,
  SET_SOUND_MODE: 0x1005,
  GET_SOUND_OUT: 0x1006,
  SET_SOUND_OUT: 0x1007,
  GET_SAMPLING: 0x1008,
  SET_SAMPLING: 0x1009,
  GET_MIX_ENABLE: 0x100a,
  SET_MIX_ENABLE: 0x100b,
  GET_GAIN_LEVEL: 0x100c,
  SET_GAIN_LEVEL: 0x100d,
  GET_GAIN_LEVEL_DETAIL: 0x100e,
  SET_GAIN_LEVEL_DETAIL: 0x100f,
  SET_GAIN_DETAIL_ALL: 0x1010,
  SET_BT_EAR_SOUND_MODE: 0x1012,
  // ------------------------------------------------------------ device VU (iOS enum only, 6201 ids)
  SET_VU_TYPE: 0x11e0,
  GET_VU_IN: 0x11e1,
  GET_VU_OUT: 0x11e9,
  // ------------------------------------------------------------ voice profiles ("Bel canto", iOS "SmileSound")
  GET_BEL_UI_IOS: 0x1f00,
  SET_BEL_UI: 0x1f01,
  BEL_PARAM: 0x1f02,
  SET_BEL_PARAM_IOS: 0x1f03,
  GET_BEL_ALL: 0x1f04,
  SET_BEL_ALL: 0x1f05,
  GET_BEL_DF: 0x1f08,
  SET_BEL_DF: 0x1f09,
  GET_BEL_EX: 0x1f11,
  SET_BEL_EX: 0x1f12,
  APP_UPDATA_BEL_DF_EX: 0x1f14,
  ENTER_BEL_PAGE: 0x1f15,
  SET_BEL_TEMPLATE_NAME: 0x1f16,
  GET_BEL_UI: 0x1f18,
  BEL_SET_PAGE_HEART: 0x1f19,
  // ------------------------------------------------------------ identity
  STATUS_FOR_SOFTWARE_VER: 0x3000,
  GET_RX_INDEX: 0x3001,
  GET_RX_TYPE: 0x3002,
  // ------------------------------------------------------------ firmware update (documented only)
  OTA_TRAN_START: 0x4000,
  OTA_TRAN_SUSPEND: 0x4001,
  OTA_TRAN_RELOCATION: 0x4002,
  OTA_TRAN_PACKAGE: 0x4003,
  OTA_SEND_TYPE: 0x4005,
  OTA_DOWNLOAD_RX: 0x4006,
  OTA_NOTIFY_DOWNLOAD_TX: 0x4007,
  OTA_DOWNLOAD_SUB_RX: 0x4008,
  OTA_NOTIFY_DEVICE: 0x4009,
  OTA_UPGRADE_NOTIFY_FINISH: 0x400a,
  OTA_START_REMOTE_UPDATE: 0x400b,
  OTA_NOTIFY_DOWNLOAD_HOTSHOE: 0x4011,
  OTA_HOTSHOE_TRAN_PACKAGE: 0x4012,
  OTA_HOTSHOE_NOTIFY_DEVICE: 0x4013,
  // ------------------------------------------------------------ status, settings, maintenance
  HEART_BEAT_GET: 0x6000,
  GET_AUTO_POWEROFF: 0x6001,
  SET_AUTO_POWEROFF: 0x6002,
  RESTORE_FACTORY: 0x6003,
  GET_KEY_LOCK: 0x6004,
  SET_KEY_LOCK: 0x6005,
  GET_WORK_MODE: 0x6006,
  SET_WORK_MODE: 0x6007,
  GET_MIC_LED_OFF: 0x6008,
  SET_MIC_LED_OFF: 0x6009,
  GET_DEV_INFO: 0x600a,
  GET_MIC_LINK_KNOW_LED: 0x600b,
  SET_MIC_LINK_KNOW_LED: 0x600c,
  CLEAR_PAIR_DEVICE: 0x600d,
  START_PAIR_DEVICE: 0x600e,
  STOP_PAIR_DEVICE: 0x600f,
  GET_HOME_INFO: 0x6010,
  GET_SETTING_INFO: 0x6011,
  GET_FIRMWARE_VER: 0x6012,
  APP_ENTER_BEL_PAGE: 0x6013,
  SET_SYNC_HOTSHOE: 0x6014,
  SET_BEL_APP_UPDATE: 0x6015,
  UI_CONNECT_LED_CTRL: 0x8000,
} as const

export type M3CmdId = (typeof M3Cmd)[keyof typeof M3Cmd]

const A = 'A protocol/core/sound/command/type/Command6303'
const DEV = 'A protocol/core/sound/command/device6303/'
const IOS = 'I HL6303CommandType'

interface EntryInit {
  /** Android Command6303 constant (the catalogue name); iOS-only ids use the iOS case name. */
  name: string
  safety: Safety
  /** Android generated class under device6303/ (absent: constant only, no class in 3.1.0). */
  cls?: string
  /** iOS HL6303CommandType case (absent: not in the iOS enum). */
  ios?: string
  /** Where the apps send it, payload notes (citation). */
  used?: string
  description?: string
}

function entry(e: EntryInit): CommandSpec {
  const src = [
    e.cls || !e.name.match(/^[a-z]/) ? `${A}.${e.name}${e.cls ? ` (${DEV}${e.cls})` : ''}` : 'not in A Command6303',
    e.ios ? `${IOS}.${e.ios} @0x100c1a318` : 'not in the iOS HL6303CommandType enum',
    ...(e.used ? [e.used] : []),
  ]
  return {
    name: e.name, safety: e.safety, retrySafe: e.safety === 'read', source: src.join('; '),
    ...(e.description ? { description: e.description } : {}),
  }
}

const EQ = 'A larkc1/c6303/viewmodel/EquipmentViewModel.handleUserIntent'
const MORE = 'A larkc1/c6303/ui/setting/controller/MoreSetting6303Activity'
const WM = 'A larkc1/c6303/viewmodel/WirelessMonitoringViewModel'
const CANTO = 'A larkc1/c6303/viewmodel/CantoViewModel'
const OTA = 'A larkc1/c6303/viewmodel/FirmwareUpgrade6303ViewModel / HotShopUpgrade6303ViewModel'
const LATER = 'Voice profiles: catalogued only, implemented later with src/lib/dsp (FAMILIES.md §2.2 W10).'

/** Every known 6303 command id (both apps), including documented-only destructive / OTA ids so the engine can refuse them. */
export const M3_COMMANDS: CommandCatalogue = {
  // ------------------------------------------------------------------------------------- status and identity
  [M3Cmd.HEART_BEAT_GET]: entry({
    name: 'CMD_APP_HEART_BEAT_GET', safety: 'read', cls: 'CmdGetHeart6303', ios: 'getHeart',
    used: 'A larkc1/c6303/viewmodel/BaseViewModel6303.heartLooper (EventLooper 1500 ms, HLDeviceVolTrack6303Activity.getHeartTime); I HL6303HeartBeatManager.heartBeatTimer (NSTimer 1.5 s @0x1004b6378)',
    description: 'Status poll: 30-byte heartbeat (status.ts parseM3Heartbeat), zero-extended when shorter (CmdGetHeart6303.decodePayload).',
  }),
  [M3Cmd.GET_DEV_INFO]: entry({
    name: 'CMD_HL_APP_GET_DEV_INFO', safety: 'read', cls: 'CmdGetDeviceInfo6303', ios: 'deviceInfo',
    used: 'A HLDeviceVolTrack6303ViewModel.getCurrentDeviceInfo / collectOnlineDeviceSn (VersionUtilKt.snProbeDeviceIds); payload [deviceId]',
    description: 'Payload [deviceId 1–4 TX, 6–9 RX, 10 hot shoe]; 25-byte reply {deviceId, sep, sn[11], sep, version[4], sep, mac[6]}.',
  }),
  [M3Cmd.GET_FIRMWARE_VER]: entry({
    name: 'HL_APP_GET_FRIMWARE_VER', safety: 'read', cls: 'CmdGetFirmwareVer6303', ios: 'getAppFirmwareVersion',
    used: 'A HLDeviceVolTrack6303ViewModel.getFirmwareVer (payload [heartbeat deviceMode], 500 ms retry); DeviceVersion6303ViewModel asks both systems',
    description: 'Payload [system 0 = 4T4R, 1 = 2T2R]; reply 9 × {id u8, version[4]} (HLGetFirmwareVerResponseEntitySerializer).',
  }),
  [M3Cmd.GET_SETTING_INFO]: entry({
    name: 'CMD_HL_GET_SETTING_INFO', safety: 'read', cls: 'CmdGetSettingInfo6303', ios: 'getAppSettingInfo',
    used: 'A larkc1/c6303/viewmodel/MoreSetting6303ViewModel.getMoreSettingsDeviceInfo (retried up to 5× while isSuccess != 0)',
    description: 'Reply [isSuccess 0 = ok, sampling, outSound, micLock, micAutoExit] (HLSettingInfoResponseEntitySerializer).',
  }),
  [M3Cmd.GET_HOME_INFO]: entry({
    name: 'CMD_HL_GET_HOME_INFO', safety: 'read', cls: 'CmdGetHomeInfo6303', ios: 'getHomeInfo',
    description: 'Reply [isSuccess, mixSound, micLight, micColorKnow] (HLHomeInfoResponseEntity); no Android caller.',
  }),
  [M3Cmd.STATUS_FOR_SOFTWARE_VER]: entry({
    name: 'CMD_HL_STATUS_FOR_SOFTWARE_VER', safety: 'read', cls: 'CmdCheckStatusVersion6303', ios: 'getFirmwareVersion',
    description: 'Payload [deviceId]; reply [deviceId, v0, v1, …]. No Android caller (checkStatusVersion is unused).',
  }),
  [M3Cmd.GET_RX_INDEX]: entry({ name: 'HL_GET_RX_INDEX', safety: 'read', cls: 'CmdGetRXIndex6303', ios: 'getRxIndex', description: 'Reply [mode, index]; no Android caller.' }),
  [M3Cmd.GET_RX_TYPE]: entry({
    name: 'CMD_HL_GET_RX_TYPE', safety: 'read', cls: 'CmdGetRXType6303', ios: 'getRxDeviceType',
    description: 'Reply [type, index] (iOS HL6303RxDeviceType cameraRx1…phoneRx4); Android uses the PID instead.',
  }),
  // -------------------------------------------------------------------------------- home page GET / SET pairs
  [M3Cmd.GET_MUTE]: entry({
    name: 'CMD_HL_AUDIO_GET_MUTE', safety: 'read', cls: 'CmdGetAudioMute6303', ios: 'getMuteState',
    used: `${EQ} (refresh after a mute toggle, currentRefreshMuteMicId)`, description: 'Payload [txId 1–4]; reply [txId, mute].',
  }),
  [M3Cmd.SET_MUTE]: entry({
    name: 'CMD_HL_AUDIO_SET_MUTE', safety: 'write', cls: 'CmdSetMute6303', ios: 'setMuteState',
    used: `${EQ} SetAudioMute → HLSetMuteEntity(txId, mute)`, description: 'Payload [txId 1–4, mute 0/1].',
  }),
  [M3Cmd.GET_NOISE_STATUS]: entry({ name: 'CMD_HL_AUDIO_GET_NOISE_STATUS', safety: 'read', cls: 'CmdGetNoiseStatus6303', ios: 'getDeNoiseState', description: 'Payload [0]; reply [dev, level, on].' }),
  [M3Cmd.SET_NOISE_STATUS]: entry({
    name: 'CMD_HL_AUDIO_SET_NOISE_STATUS', safety: 'write', cls: 'CmdSetNoiseStatus6303', ios: 'setDeNoiseState',
    used: `${EQ} SetNoiseStatus → HLSetNoiseStatusEntity(0, level, on)`, description: 'Payload [0, level 0–2, on 0/1].',
  }),
  [M3Cmd.GET_SOUND_MODE]: entry({ name: 'CMD_HL_AUDIO_GET_SOUND_MODE', safety: 'read', cls: 'CmdGetSoundMode6303', ios: 'getSoundMode', description: 'Payload [0]; reply [dev, mode].' }),
  [M3Cmd.SET_SOUND_MODE]: entry({
    name: 'CMD_HL_AUDIO_SET_SOUND_MODE', safety: 'write', cls: 'CmdSetSoundMode6303', ios: 'setSoundMode',
    used: `${EQ} SetSoundMode → HLSetSoundModeEntity(0, mode); A EquipmentFragment.showSwitchDialog before entering / leaving 4-track`,
    description: 'Payload [0, mode 0 Mono / 1 Stereo / 2 4-track]. A change to or from 4-track restarts the receiver (M3Device asks for confirm).',
  }),
  [M3Cmd.GET_SOUND_OUT]: entry({ name: 'CMD_HL_AUDIO_GET_SOUND_OUT', safety: 'read', cls: 'CmdGetSoundOut6303', ios: 'getSoundOutState', description: 'Payload [0]; reply [dev, on].' }),
  [M3Cmd.SET_SOUND_OUT]: entry({
    name: 'CMD_HL_AUDIO_SET_SOUND_OUT', safety: 'disruptive', cls: 'CmdSetSoundOut6303', ios: 'setSoundOutState',
    used: `${MORE}.initView$lambda$4 (showRestartDeviceNoteDialog first) → MoreSetting6303ViewModel SetDeviceSoundOut`,
    description: '"Playback without unplugging": payload [0, on]. The app shows "This change requires a restart." first.',
  }),
  [M3Cmd.GET_SAMPLING]: entry({ name: 'CMD_HL_AUDIO_GET_SAMPLING', safety: 'read', cls: 'CmdGetSampling6303', ios: 'getSampleDepth', description: 'Payload [0]; reply [dev, sampling].' }),
  [M3Cmd.SET_SAMPLING]: entry({
    name: 'CMD_HL_AUDIO_SET_SAMPLING', safety: 'disruptive', cls: 'CmdSetSampling6303', ios: 'setSampleDepth',
    used: `${MORE}.initView$lambda$7 (primary only, showRestartDeviceNoteDialog; nothing sent when already 24-bit) → SetDeviceSampling(SAMPLE_24_BIT) only; $lambda$8 (32-bit float) → R only_support_apple, nothing sent`,
    description: '"Bit Depth": payload [0, 0 = 24-bit / 1 = 32-bit float]; restarts the receiver. Android only ever sends [0, 0]; the library refuses [0, 1].',
  }),
  [M3Cmd.GET_MIX_ENABLE]: entry({ name: 'CMD_HL_AUDIO_GET_MIX_ENABLE', safety: 'read', cls: 'CmdGetMixEnable6303', ios: 'getSmartSoundMix', description: 'Payload [0]; reply [dev, on].' }),
  [M3Cmd.SET_MIX_ENABLE]: entry({
    name: 'HL_AUDIO_SET_MIX_ENABLE', safety: 'write', cls: 'CmdSetMixEnable6303', ios: 'setSmartSoundMix',
    used: `${EQ} SetMixEnable → HLSetMixEnableEntity(0, on)`, description: '"Smart mix": payload [0, on].',
  }),
  [M3Cmd.GET_GAIN_LEVEL]: entry({ name: 'CMD_HL_AUDIO_GET_GAIN_LEVEL', safety: 'read', cls: 'CmdGetGainLevel6303', ios: 'getAudioGainLevel', description: 'Payload [0]; reply [dev, level] (HLGetGainLevelResponseEntity).' }),
  [M3Cmd.SET_GAIN_LEVEL]: entry({
    name: 'CMD_HL_AUDIO_SET_GAIN_LEVEL', safety: 'write', cls: 'CmdSetGainLevel6303', ios: 'setAudioGainLevel',
    used: `${EQ} SetGainLevel(segment − 1) → HLSetGainLevelEntity(0, level)`, description: 'Phone RX "RX volume": payload [0, level 0–5].',
  }),
  [M3Cmd.GET_GAIN_LEVEL_DETAIL]: entry({
    name: 'CMD_HL_AUDIO_GET_GAIN_LEVEL_DETAIL', safety: 'read', cls: 'CmdGetGainLevelDetail6303', ios: 'getAudioGainLevelDetail',
    used: `${EQ} GetGainLevelDetail (camera RX volume dialog, A EquipmentFragment tvVolumeSetting)`,
    description: 'Payload [0]; reply [dev, gear1, gear2, gear3], wire = dB + 10 (A BottomCameraRxDialog.toTextShow = v − 10).',
  }),
  [M3Cmd.SET_GAIN_LEVEL_DETAIL]: entry({
    name: 'CMD_HL_AUDIO_SET_GAIN_LEVEL_DETAIL', safety: 'write', cls: 'CmdSetGainLevelDetail6303', ios: 'setAudioGainLevelDetail',
    description: 'Payload [dev, gear, value] (HLAudioSetGainLevelEntity); no Android caller (the dialog sends 0x1010).',
  }),
  [M3Cmd.SET_GAIN_DETAIL_ALL]: entry({
    name: 'CMD_HL_AUDIO_SET_GAIN_DETAIL_ALL', safety: 'write', cls: 'CmdSetGainDetailAll6303', ios: 'setAudioGainAllLevelDetail',
    used: `${EQ} UpdateCameraGain → HLAudioSetGainDetailAllEntity(0, g1, g2, g3)`, description: 'Camera RX volume levels: payload [0, g1, g2, g3], wire = dB + 10.',
  }),
  [M3Cmd.SET_BT_EAR_SOUND_MODE]: entry({
    name: 'HL_AUDIO_SET_BT_EAR_SOUND_MODE', safety: 'write', cls: 'CmdSetBtEarSoundMode6303', ios: 'setAudioBtEarSoundMode',
    description: 'Wireless-monitoring earphone track mode: payload [0, mode] (later extra, W10).',
  }),
  [M3Cmd.GET_AUTO_POWEROFF]: entry({ name: 'CMD_HL_APP_GET_AUTO_POWEROFF', safety: 'read', cls: 'CmdGetAutoPowerOff6303', ios: 'getAutoPowerOff', description: 'Reply [on] (iOS HL6303ParsedResponse.getAutoPowerOff).' }),
  [M3Cmd.SET_AUTO_POWEROFF]: entry({
    name: 'CMD_HL_APP_SET_AUTO_POWEROFF', safety: 'write', cls: 'CmdSetAutoPowerOff6303', ios: 'setAutoPowerOff',
    used: `${MORE}.initView$lambda$10 (primary only) → HLAudioSetAutoPowerOffEntity(on)`, description: '"Auto power off" (camera RX and TX, 15 min): payload [on].',
  }),
  [M3Cmd.GET_KEY_LOCK]: entry({ name: 'CMD_HL_APP_GET_KEY_LOCK', safety: 'read', cls: 'CmdGetKeyLock6303', ios: 'getKeyLock', description: 'Reply [lock].' }),
  [M3Cmd.SET_KEY_LOCK]: entry({
    name: 'CMD_HL_APP_SET_KEY_LOCK', safety: 'write', cls: 'CmdSetKeyLock6303', ios: 'setKeyLock',
    used: `${MORE}.initView$lambda$12 (primary only) → HLAudioSetKeyLockEntity(lock)`, description: '"TX button lock": payload [lock].',
  }),
  [M3Cmd.GET_MIC_LED_OFF]: entry({ name: 'CMD_HL_APP_GET_MIC_LED_OFF', safety: 'read', cls: 'CmdGetMicLedOff6303', ios: 'getMicLedOff', description: 'Reply [off].' }),
  [M3Cmd.SET_MIC_LED_OFF]: entry({
    name: 'CMD_HL_APP_SET_MIC_LED_OFF', safety: 'write', cls: 'CmdSetMicLedOff6303', ios: 'setMicLedOff',
    used: `${EQ} SetMicLedOff(!swIndicatorLight.isChecked) → HLAudioSetMicLedOffEntity(off)`, description: '"Indicator Light Switch", inverted: payload [1 = LED off].',
  }),
  [M3Cmd.GET_MIC_LINK_KNOW_LED]: entry({ name: 'CMD_HL_APP_GET_MIC_LINK_KNOW_LED', safety: 'read', cls: 'CmdGetMicLinkKnowLed6303', ios: 'getMicLinkKnowLed', description: 'Reply [on].' }),
  [M3Cmd.SET_MIC_LINK_KNOW_LED]: entry({
    name: 'CMD_HL_APP_SET_MIC_LINK_KNOW_LED', safety: 'write', cls: 'CmdSetMicLinkKnowLed6303', ios: 'setMicLinkKnowLed',
    used: `${EQ} SetMicLinkKnowLed → HLAudioSetMicLinkKnowLedEntity(on)`, description: '"TX Recognition": payload [on].',
  }),
  [M3Cmd.SET_SYNC_HOTSHOE]: entry({
    name: 'CMD_HL_APP_SET_SYNC_HOTSHOE', safety: 'write', cls: 'CmdSetSyncHotshoe6303', ios: 'setSyncCameraAutoPowerOff',
    used: `${EQ} SetHotShoeSwitch → HLSetSyncHotshoeEntity(on); shown on camera RX only (A EquipmentFragment.updateHotShoeSwitch)`,
    description: '"Camera Power On/Off" (hot-shoe power sync): payload [on].',
  }),
  [M3Cmd.GET_WORK_MODE]: entry({ name: 'CMD_HL_APP_GET_WORK_MODE', safety: 'read', cls: 'CmdGetWorkMode6303', ios: 'getWorkMode', description: 'Reply [workMode 0 = 4T4R, 1 = 2T2R wireless monitoring].' }),
  [M3Cmd.SET_WORK_MODE]: entry({
    name: 'CMD_HL_APP_SET_WORK_MODE', safety: 'disruptive', cls: 'CmdSetWorkMode6303', ios: 'setWorkMode',
    used: `${WM}.handleUserIntent SwitchWirelessMode → HLAudioSetWorkModeEntity(on); R enable_wireless_note`,
    description: 'Wireless monitoring on (2TX&2RX) / off (4TX&4RX): the RXs restart. Later extra (W10).',
  }),
  // ------------------------------------------------------------------------------- multi-RX, pairing, maintenance
  [M3Cmd.RF_SET_RX_MASTER]: entry({
    name: 'HL_RF_SET_RX_MASTER', safety: 'disruptive', cls: 'CmdSetRxMaster6303', ios: 'setRxIndex',
    used: 'A larkc1/c6303/viewmodel/MasterDeviceSwitchViewModel SetMainRxIntent → HLRfSetRxMasterEntity(position); "master_slave_switching" dialog',
    description: '"Switch Primary/Secondary Device": payload [rxIndex]. Multi-RX page, later extra (W10).',
  }),
  [M3Cmd.UI_CONNECT_LED_CTRL]: entry({
    name: 'HL_UI_CONNECT_LED_CTRL', safety: 'write', cls: 'CmdUiConnectLedCtrl6303', ios: 'setRxLed',
    used: 'A MasterDeviceSwitchViewModel → HLUiConnectLedCtrlEntity(position, ctrl)', description: 'Locate an RX by flashing its LED: payload [position, ctrl] (polarity [?]).',
  }),
  [M3Cmd.START_PAIR_DEVICE]: entry({
    name: 'CMD_HL_APP_START_PAIR_DEVICE', safety: 'disruptive', cls: 'CmdStartPairDevice6303', ios: 'startPairDevice',
    used: 'A larkc1/c6303/viewmodel/CancelPairDevice6303ViewModel (PairDeviceActivity.startPair)', description: 'Enter pairing; heartbeat byte 20 shows it.',
  }),
  [M3Cmd.STOP_PAIR_DEVICE]: entry({ name: 'CMD_HL_APP_STOP_PAIR_DEVICE', safety: 'write', cls: 'CmdStopPairDevice6303', ios: 'stopPairDevice', used: 'A CancelPairDevice6303ViewModel (PairDeviceActivity.stopPair)' }),
  [M3Cmd.CLEAR_PAIR_DEVICE]: entry({
    name: 'CMD_HL_APP_CLEAR_PAIR_DEVICE', safety: 'destructive', cls: 'CmdClearPairDevice6303', ios: 'deleteParDevice',
    used: 'A CancelPairDevice6303ViewModel CancelPairDevice → HLClearPairDeviceEntity(deviceId)', description: 'Unpair a TX / RX: payload [deviceId]. Documented only.',
  }),
  [M3Cmd.RESTORE_FACTORY]: entry({
    name: 'CMD_HL_APP_RESTORE_FACTORY', safety: 'destructive', cls: 'CmdRestoreFactory6303', ios: 'restoreFactory',
    used: `${MORE} showFactoryResetDialog (primary only) → MoreSetting6303ViewModel.restoreFactory`, description: 'Factory reset. Documented only.',
  }),
  // ------------------------------------------------------------------------------- voice profiles (catalogue only)
  [M3Cmd.APP_ENTER_BEL_PAGE]: entry({ name: 'HL_APP_ENTER_BEL_PAGE', safety: 'write', cls: 'CmdAppEnterBelPage6303', description: `Payload [page]; no Android caller. ${LATER}` }),
  [M3Cmd.SET_BEL_APP_UPDATE]: entry({
    name: 'HL_APP_SET_BEL_APP_UPDATE', safety: 'write', cls: 'CmdSetBelAppUpdate6303', ios: 'setBelAppUpdateClear',
    used: 'A EquipmentViewModel.handleNotification (heartbeat isRefreshCanto == 1 → setBelAppUpdate)',
    description: 'Clears the heartbeat "voice profiles changed" flag (byte 28). Sent only on request (M3Device.acknowledgeVoiceProfileRefresh).',
  }),
  [M3Cmd.GET_BEL_UI_IOS]: entry({ name: 'getAudioBelUi', safety: 'read', ios: 'getAudioBelUi', description: `iOS only. ${LATER}` }),
  [M3Cmd.SET_BEL_UI]: entry({ name: 'CMD_HL_AUDIO_SET_BEL_UI', safety: 'write', cls: 'CmdAudioSetBelUI6303', ios: 'setAudioBelUi', description: `Payload [0, txMask, ModBelUiT (100 B)]. ${LATER}` }),
  [M3Cmd.BEL_PARAM]: entry({
    name: 'CMD_HL_AUDIO_GET_BEL_PARAM', safety: 'write', cls: 'CmdAudioSetBelParam6303', ios: 'getAudioBelParms',
    description: `Name conflict: Android uses it as a setter [0, txMask, ModBelDspT] (audioSetBelParam), iOS names it getAudioBelParms; classed 'write'. ${LATER}`,
  }),
  [M3Cmd.SET_BEL_PARAM_IOS]: entry({ name: 'setAudioBelParms', safety: 'write', ios: 'setAudioBelParms', description: `iOS only. ${LATER}` }),
  [M3Cmd.GET_BEL_ALL]: entry({
    name: 'CMD_HL_AUDIO_GET_BEL_ALL', safety: 'read', cls: 'CmdAudioGetBelAll6303', ios: 'getAudioBelAll',
    used: `${CANTO} (drops replies whose txPosition differs)`, description: `Payload [0, txMask]; 374-byte reply {deviceType, txPosition, ModAlgBelT}. ${LATER}`,
  }),
  [M3Cmd.SET_BEL_ALL]: entry({
    name: 'CMD_HL_AUDIO_SET_BEL_ALL', safety: 'write', cls: 'CmdAudioSetBelAll6303', ios: 'setAudioBelAll',
    used: `${CANTO} (txMask 1 << txIndex)`, description: `Apply a voice profile: payload [0, txMask, ModAlgBelT (372 B)] (512-byte packet). ${LATER}`,
  }),
  [M3Cmd.GET_BEL_DF]: entry({ name: 'HL_AUDIO_GET_BEL_DF', safety: 'read', cls: 'CmdAudioGetBelDF6303', description: `One-Tap Enhance per TX: payload [0, txPos]. ${LATER}` }),
  [M3Cmd.SET_BEL_DF]: entry({ name: 'HL_AUDIO_SET_BEL_DF', safety: 'write', cls: 'CmdAudioSetBelDF6303', description: `Payload [0, txPos, on]. ${LATER}` }),
  [M3Cmd.GET_BEL_EX]: entry({ name: 'HL_AUDIO_GET_BEL_EX', safety: 'read', cls: 'CmdAudioGetBelEX6303', description: `Payload [0, 0]; reply [0, 0, df, ex]. ${LATER}` }),
  [M3Cmd.SET_BEL_EX]: entry({ name: 'HL_AUDIO_SET_BEL_EX', safety: 'write', cls: 'CmdAudioSetBelEX6303', ios: 'setAudioBelDfEx', description: `Payload [0, 0, df, ex]. ${LATER}` }),
  [M3Cmd.APP_UPDATA_BEL_DF_EX]: entry({ name: 'HL_AUDIO_APP_UPDATA_BEL_DF_EX', safety: 'write', cls: 'CmdAudioAppUpdataBelDfEx6303', description: `Payload [0, 0, df, ex]. ${LATER}` }),
  [M3Cmd.ENTER_BEL_PAGE]: entry({
    name: 'HL_AUDIO_ENTER_BEL_PAGE', safety: 'write', cls: 'CmdAudioEnterBelPage6303', ios: 'getBelDfHeartBeat',
    used: 'A BaseViewModel6303.cantoHeartLooper (1500 ms, replaces 0x6000 on the voice tab)',
    description: `Voice-page heartbeat [updateStatus 0] → 6 B; "enters" the page, so classed 'write' (never polled here). ${LATER}`,
  }),
  [M3Cmd.SET_BEL_TEMPLATE_NAME]: entry({ name: 'HL_AUDIO_SET_BEL_TEMPLATE_NAME', safety: 'write', cls: 'CmdSetBelTemplateName6303', ios: 'setBelDfTemplateName', description: `Payload [txIndex, name[64] UTF-8]. ${LATER}` }),
  [M3Cmd.GET_BEL_UI]: entry({ name: 'CMD_HL_AUDIO_GET_BEL_UI', safety: 'read', cls: 'CmdAudioGetBelUI6303', ios: 'getAllMicSmileSoundUI', description: `Reply 4 × ModBelUiT (100 B, 413-byte frame): profile names on the mic tiles. ${LATER}` }),
  [M3Cmd.BEL_SET_PAGE_HEART]: entry({
    name: 'HL_AUDIO_BEL_SET_PAGE_HEART', safety: 'write', cls: 'CmdAudioBelSetPageHeart6303', ios: 'getBelSetPageHeartBeat',
    used: 'A BaseViewModel6303.cantoSetPageHeartLooper (2000 ms)', description: `Edit-page keep-alive (empty payload). ${LATER}`,
  }),
  // ------------------------------------------------------------------------------- device VU (iOS enum, 6201 ids)
  [M3Cmd.SET_VU_TYPE]: entry({ name: 'setVuType', safety: 'write', ios: 'setVuType', description: 'iOS enum only (6201 VU id); no 6303 code path uses it [?].' }),
  [M3Cmd.GET_VU_IN]: entry({ name: 'getVuIn', safety: 'read', ios: 'getVuIn', description: 'iOS enum only (6201 VU id); no 6303 code path uses it [?].' }),
  [M3Cmd.GET_VU_OUT]: entry({ name: 'getVuOut', safety: 'read', ios: 'getVuOut', description: 'iOS enum only (6201 VU id); no 6303 code path uses it [?].' }),
  // ------------------------------------------------------------------------------- wireless monitoring (later extra)
  [M3Cmd.BT_STATUS_FOR_HEART]: entry({
    name: 'HL_RF_BT_STATUS_FOR_HEART', safety: 'read', cls: 'CmdBtStatusForHeart6303',
    used: 'A EquipmentViewModel.btStatusHeartLooper (5000 ms while !is4t4r); WirelessMonitoringViewModel (1000 ms)',
    description: 'Connected earphone: 39 B {mac[6], btName[33]}.',
  }),
  [M3Cmd.BT_INQUIRY]: entry({ name: 'HL_RF_BT_INQUIRY', safety: 'write', cls: 'CmdBtInquiry6303', ios: 'startBtRfInquiry', used: WM }),
  [M3Cmd.BT_INQ_CANCEL]: entry({ name: 'HL_RF_BT_INQ_CANCEL', safety: 'write', cls: 'CmdBtInqCancel6303', ios: 'stopBtRfInquiry', used: WM }),
  [M3Cmd.BT_INQ_REPORT]: entry({ name: 'HL_RF_BT_INQ_REPORT', safety: 'notify', cls: 'CmdBtInqReport6303', ios: 'reportBtRfInfo', description: 'Event: 73 B {devType, rssi, mac[6], nameLen, name[64]}.' }),
  [M3Cmd.BT_INQ_COMPLETE]: entry({ name: 'HL_RF_BT_INQ_COMPLETE', safety: 'notify', cls: 'CmdBtInqComplete6303', ios: 'reportBtRfInqComplete', description: 'Event: [ok].' }),
  [M3Cmd.BT_CONNECT]: entry({ name: 'HL_RF_BT_CONNECT', safety: 'write', cls: 'CmdBtConnect6303', ios: 'btRfConnect', used: WM, description: 'Payload 00 00 00 00 + mac[6].' }),
  [M3Cmd.BT_DISCONNECT]: entry({ name: 'HL_RF_BT_DISCONNECT', safety: 'write', cls: 'CmdBtDisconnect6303', ios: 'btRfDisconnect', used: WM, description: 'Payload 00 00 + mac[6].' }),
  [M3Cmd.BT_GET_CDL]: entry({ name: 'HL_RF_BT_GET_CDL', safety: 'read', cls: 'CmdBtGetCdl6303', ios: 'btRfGetConnectedList', used: WM, description: 'Payload [start 0, count 0xFF].' }),
  [M3Cmd.BT_GET_PDL]: entry({ name: 'HL_RF_BT_GET_PDL', safety: 'read', cls: 'CmdBtGetPdl6303', ios: 'btRfGetPairedList', used: WM, description: 'Payload [start 0, count 0xFF].' }),
  [M3Cmd.BT_DELETE_PDL]: entry({ name: 'HL_RF_BT_DELETE_PDL', safety: 'destructive', cls: 'CmdBtDeletePdl6303', ios: 'btRfDeletePDL', used: WM, description: 'Forget paired earphones: [count, mac…]. Documented only.' }),
  [M3Cmd.BT_CLEAN_PDL]: entry({ name: 'HL_RF_BT_CLEAN_PDL', safety: 'destructive', ios: 'btRfCleanPDL', description: 'Forget every paired earphone. Constant only in Android 3.1.0. Documented only.' }),
  [M3Cmd.BT_CONNECT_EVT]: entry({ name: 'HL_RF_BT_CONNECT_EVT', safety: 'notify', cls: 'CmdBtConnectEvt6303', ios: 'reportBtRfConnectEvt', description: 'Event: 10 B {btChn, status, hdl i16, mac[6]}.' }),
  [M3Cmd.BT_DISCONN_EVT]: entry({ name: 'HL_RF_BT_DISCONN_EVT', safety: 'notify', cls: 'CmdBtDisconnectEvt6303', ios: 'reportBtRfDisConnectEvt', description: 'Event: 10 B {btChn, reason, hdl i16, mac[6]}.' }),
  [M3Cmd.BT_GET_PD_NAME]: entry({ name: 'HL_RF_BT_GET_PD_NAME', safety: 'read', cls: 'CmdBtGetPdName6303', ios: 'getRfBtPdName', description: 'Payload mac[6]; reply name.' }),
  [M3Cmd.BT_AVRCP_SET_VOL]: entry({
    name: 'HL_RF_BT_AVRCP_SET_VOL', safety: 'write', cls: 'CmdBtAvrcpSetVol6303', ios: 'setRfBtEarPhonesVoiceLevel',
    used: `${EQ} SetSvVol → HLBtAvrcpSetVolEntity(vol)`, description: 'Earphone volume 0–127 (2T2R with an earphone; later extra).',
  }),
  [M3Cmd.BT_AVRCP_VOL_RPT]: entry({ name: 'HL_RF_BT_AVRCP_VOL_RPT', safety: 'notify', cls: 'CmdBtAvrcpVolRpt6303', ios: 'rfBtEarPhonesVoiceLevelRpt', description: 'Event: [vol].' }),
  [M3Cmd.BT_STATUS_CLEAR_INQUIRY_RESULT]: entry({ name: 'HL_RF_BT_STATUS_CLEAR_INQUIRY_RESULT', safety: 'write', cls: 'CmdBtStatusClearInquiryResult6303', description: 'Payload mac[6].' }),
  [M3Cmd.BT_GET_RF_MAC]: entry({ name: 'getBtRfMac', safety: 'read', ios: 'getBtRfMac', description: 'iOS only.' }),
  [M3Cmd.BT_SET_RF_MAC]: entry({ name: 'setBtRfMac', safety: 'destructive', ios: 'setBtRfMac', description: 'iOS only: rewrites the RF Bluetooth MAC. Documented only.' }),
  [M3Cmd.BT_GET_RF_NAME]: entry({ name: 'getBtRfName', safety: 'read', ios: 'getBtRfName', description: 'iOS only.' }),
  [M3Cmd.BT_SET_RF_NAME]: entry({ name: 'setBtRfName', safety: 'write', ios: 'setBtRfName', description: 'iOS only.' }),
  [M3Cmd.BT_SET_CHN_MODE]: entry({ name: 'rfBtSetChnMode', safety: 'write', ios: 'rfBtSetChnMode', description: 'iOS only.' }),
  [M3Cmd.BT_GET_CHN_MODE]: entry({ name: 'rfBtGetChnMode', safety: 'read', ios: 'rfBtGetChnMode', description: 'iOS only.' }),
  // ------------------------------------------------------------------------------- firmware update (never sent)
  [M3Cmd.OTA_TRAN_START]: entry({ name: 'CMD_APP_FIRMWARE_TRAN_START', safety: 'ota', cls: 'CmdStartFirmwareTran6303', ios: 'startUpdateUpload', used: OTA, description: '{size i32, packageSize i32, crc i32}.' }),
  [M3Cmd.OTA_TRAN_SUSPEND]: entry({ name: 'CMD_HL_FIRMWARE_TRAN_SUSPEND', safety: 'ota', cls: 'CmdFirmwareTranSuspend6303', ios: 'pauseUpdateUpload', used: OTA }),
  [M3Cmd.OTA_TRAN_RELOCATION]: entry({ name: 'CMD_APP_FIRMWARE_TRAN_RELOCATION', safety: 'ota', used: OTA }),
  [M3Cmd.OTA_TRAN_PACKAGE]: entry({ name: 'CMD_APP_FIRMWARE_TRAN_PACKAGE', safety: 'ota', cls: 'CmdSendFirmwarePackage6303', ios: 'uploadUpdateData', used: `${OTA}; Protocol6303Provider.getUsbConfig maxPacketSize 512` }),
  [M3Cmd.OTA_SEND_TYPE]: entry({ name: 'CMD_APP_OTA_SEND_TYPE', safety: 'ota', cls: 'CmdOtaSendType6303', ios: 'setUpdateDevice', used: OTA, description: '[devType, system, hasHotShoe].' }),
  [M3Cmd.OTA_DOWNLOAD_RX]: entry({ name: 'CMD_APP_OTA_DOWNLOAD_RX', safety: 'ota', cls: 'CmdOtaDownloadRx6303', ios: 'downloadRx', used: OTA }),
  [M3Cmd.OTA_NOTIFY_DOWNLOAD_TX]: entry({
    name: 'CMD_APP_OTA_NOTIFY_DOWNLOAD_TX', safety: 'ota', cls: 'CmdOtaDownloadTx6303', ios: 'downloadTx', used: OTA,
    description: 'Android also names 0x4007 CMD_APP_OTA_NOTIFY_DOWNLOAD_REMOTE (CmdNotifyDownloadRemoteState6303).',
  }),
  [M3Cmd.OTA_DOWNLOAD_SUB_RX]: entry({ name: 'downloadSubRx', safety: 'ota', ios: 'downloadSubRx', description: 'iOS only.' }),
  [M3Cmd.OTA_NOTIFY_DEVICE]: entry({ name: 'CMD_APP_OTA_NOTIFY_DEVICE', safety: 'ota', cls: 'CmdNotifyOtaNotify6303', ios: 'uploadCompleteCheck', used: OTA }),
  [M3Cmd.OTA_UPGRADE_NOTIFY_FINISH]: entry({ name: 'CMD_APP_OTA_UPGRADE_NOTIFY_FINISH', safety: 'ota', cls: 'CmdCheckUpgradeFinish6303', ios: 'updateProgress', used: OTA }),
  [M3Cmd.OTA_START_REMOTE_UPDATE]: entry({ name: 'startRemodeUpdate', safety: 'ota', ios: 'startRemodeUpdate', description: 'iOS only.' }),
  [M3Cmd.OTA_NOTIFY_DOWNLOAD_HOTSHOE]: entry({ name: 'CMD_APP_OTA_NOTIFY_DOWNLOAD_HOTSHOP', safety: 'ota', cls: 'CmdNotifyDownloadHotShopState6303', ios: 'startUpdateHotshoes', used: OTA, description: 'Hot-shoe accessory: {size i32, ver[4]}.' }),
  [M3Cmd.OTA_HOTSHOE_TRAN_PACKAGE]: entry({ name: 'CMD_APP_HOTSHOP_FIRMWARE_TRAN_PACKAGE', safety: 'ota', cls: 'CmdSendHotShopFirmwarePackage6303', ios: 'uploadHotshoesUpdateData', used: OTA }),
  [M3Cmd.OTA_HOTSHOE_NOTIFY_DEVICE]: entry({ name: 'CMD_APP_HOT_SHOP_OTA_NOTIFY_DEVICE', safety: 'ota', cls: 'CmdNotifyHotShopOtaDevice6303', ios: 'uploadHotshoesCheck', used: OTA, description: '{sum32 i32}.' }),
}

export function m3CommandName(cmd: number): string {
  return M3_COMMANDS[cmd]?.name ?? `0x${cmd.toString(16).padStart(4, '0')}`
}

// ------------------------------------------------------------------------------------------ payload unit ids

/**
 * Unit ids inside payloads (A larkc1/c6303/ui/Device6303DataManager): TX1–TX4 = 1–4 (txIndexToDeviceId = idx + 1),
 * RX1–RX4 = 6–9 (rxIndexToDeviceId = idx + 6), hot-shoe accessory = 10 (hotShoeDeviceId), 0 = this RX.
 * A different numbering from the envelope addresses (moma MOMA_ID).
 */
export const M3_DEVICE_ID = {
  THIS_RX: 0,
  TX1: 1,
  TX2: 2,
  TX3: 3,
  TX4: 4,
  RX1: 6,
  RX2: 7,
  RX3: 8,
  RX4: 9,
  HOT_SHOE: 10,
} as const

export const M3_TX_UNITS = ['tx1', 'tx2', 'tx3', 'tx4'] as const satisfies readonly UnitId[]
export type M3TxUnit = (typeof M3_TX_UNITS)[number]

/** TX unit → payload id 1–4 (A Device6303DataManager.txIndexToDeviceId). */
export function m3TxDeviceId(unit: M3TxUnit): number {
  return M3_TX_UNITS.indexOf(unit) + 1
}

/** RX index 0–3 → payload id 6–9 (A Device6303DataManager.rxIndexToDeviceId). */
export function m3RxDeviceId(rxIndex: number): number {
  return rxIndex + 6
}

/** RF topology (A protocol/core/sound/constant/DeviceControlConstant.System6303Type; heartbeat byte 22). */
export const M3_SYSTEM = { FOUR_T_FOUR_R: 0, TWO_T_TWO_R: 1 } as const

/** Channel mode values (A EquipmentFragment.updateSoundMode: 1 Stereo, 2 4-track, else Mono). */
export const M3_SOUND_MODE = { MONO: 0, STEREO: 1, FOUR_TRACK: 2 } as const

/** Bit depth values (A DeviceControlConstant.MicSamplingType: SAMPLE_24_BIT 0, 32-bit float 1). */
export const M3_SAMPLING = { BIT24: 0, FLOAT32: 1 } as const

/** Camera RX gain levels: wire = dB + 10, −10…+10 dB (A BottomCameraRxDialog.toProgress / toTextShow, coerceIn(−10, 10)). */
export const M3_CAMERA_GAIN_DB = { MIN: -10, MAX: 10, WIRE_OFFSET: 10 } as const

// --------------------------------------------------------------------------------------------- request builders

const u8 = (v: number | boolean) => (typeof v === 'boolean' ? (v ? 1 : 0) : v & 0xff)

/**
 * Request builders, payloads exactly as the generated serializers write them (A *EntityExtKt.cmdSerialize, LE).
 * Every request goes to target 0 (broadcast) with report id 8 (moma MOMA_6303).
 */
export const M3Requests = {
  heartbeat: (): MomaRequest => momaRequest(M3Cmd.HEART_BEAT_GET),
  /** A HLAudioGetDeviceInfoEntity(deviceId). */
  deviceInfo: (deviceId: number): MomaRequest => momaRequest(M3Cmd.GET_DEV_INFO, [deviceId]),
  /** A HLGetFirmwareVerEntity(system): 0 = 4T4R, 1 = 2T2R. */
  firmwareVersions: (system: number): MomaRequest => momaRequest(M3Cmd.GET_FIRMWARE_VER, [system]),
  settingInfo: (): MomaRequest => momaRequest(M3Cmd.GET_SETTING_INFO),
  homeInfo: (): MomaRequest => momaRequest(M3Cmd.GET_HOME_INFO),
  /** A HLAudioGetGainLevelEntity(0). */
  gainLevelDetail: (): MomaRequest => momaRequest(M3Cmd.GET_GAIN_LEVEL_DETAIL, [0]),
  /** A HLGetGainLevelEntity(0). */
  getGainLevel: (): MomaRequest => momaRequest(M3Cmd.GET_GAIN_LEVEL, [0]),
  getMute: (txId: number): MomaRequest => momaRequest(M3Cmd.GET_MUTE, [txId]),
  getNoise: (): MomaRequest => momaRequest(M3Cmd.GET_NOISE_STATUS, [0]),
  getSoundMode: (): MomaRequest => momaRequest(M3Cmd.GET_SOUND_MODE, [0]),
  getSoundOut: (): MomaRequest => momaRequest(M3Cmd.GET_SOUND_OUT, [0]),
  getSampling: (): MomaRequest => momaRequest(M3Cmd.GET_SAMPLING, [0]),
  getMixEnable: (): MomaRequest => momaRequest(M3Cmd.GET_MIX_ENABLE, [0]),
  getAutoPowerOff: (): MomaRequest => momaRequest(M3Cmd.GET_AUTO_POWEROFF),
  getKeyLock: (): MomaRequest => momaRequest(M3Cmd.GET_KEY_LOCK),
  getWorkMode: (): MomaRequest => momaRequest(M3Cmd.GET_WORK_MODE),
  getMicLedOff: (): MomaRequest => momaRequest(M3Cmd.GET_MIC_LED_OFF),
  getMicLinkKnowLed: (): MomaRequest => momaRequest(M3Cmd.GET_MIC_LINK_KNOW_LED),
  btStatus: (): MomaRequest => momaRequest(M3Cmd.BT_STATUS_FOR_HEART),
  /** A HLSetMuteEntity(txId 1–4, mute). */
  setMute: (txId: number, mute: boolean): MomaRequest => momaRequest(M3Cmd.SET_MUTE, [txId, u8(mute)]),
  /** A HLSetNoiseStatusEntity(0, level 0–2, on). */
  setNoise: (level: number, on: boolean): MomaRequest => momaRequest(M3Cmd.SET_NOISE_STATUS, [0, u8(level), u8(on)]),
  /** A HLSetSoundModeEntity(0, mode). */
  setSoundMode: (mode: number): MomaRequest => momaRequest(M3Cmd.SET_SOUND_MODE, [0, u8(mode)]),
  /** A HLSetGainLevelEntity(0, level 0–5). */
  setGainLevel: (level: number): MomaRequest => momaRequest(M3Cmd.SET_GAIN_LEVEL, [0, u8(level)]),
  /** A HLAudioSetGainDetailAllEntity(0, g1, g2, g3), wire values (dB + 10). */
  setGainDetailAll: (g1: number, g2: number, g3: number): MomaRequest => momaRequest(M3Cmd.SET_GAIN_DETAIL_ALL, [0, u8(g1), u8(g2), u8(g3)]),
  /** A HLSetSoundOutEntity(0, on). */
  setSoundOut: (on: boolean): MomaRequest => momaRequest(M3Cmd.SET_SOUND_OUT, [0, u8(on)]),
  /** A HLSetSamplingEntity(0, sampling). */
  setSampling: (sampling: number): MomaRequest => momaRequest(M3Cmd.SET_SAMPLING, [0, u8(sampling)]),
  /** A HLSetMixEnableEntity(0, on). */
  setMixEnable: (on: boolean): MomaRequest => momaRequest(M3Cmd.SET_MIX_ENABLE, [0, u8(on)]),
  /** A HLAudioSetAutoPowerOffEntity(on). */
  setAutoPowerOff: (on: boolean): MomaRequest => momaRequest(M3Cmd.SET_AUTO_POWEROFF, [u8(on)]),
  /** A HLAudioSetKeyLockEntity(lock). */
  setKeyLock: (lock: boolean): MomaRequest => momaRequest(M3Cmd.SET_KEY_LOCK, [u8(lock)]),
  /** A HLAudioSetMicLedOffEntity(off): 1 = LED off. */
  setMicLedOff: (off: boolean): MomaRequest => momaRequest(M3Cmd.SET_MIC_LED_OFF, [u8(off)]),
  /** A HLAudioSetMicLinkKnowLedEntity(on). */
  setMicLinkKnowLed: (on: boolean): MomaRequest => momaRequest(M3Cmd.SET_MIC_LINK_KNOW_LED, [u8(on)]),
  /** A HLSetSyncHotshoeEntity(on). */
  setSyncHotshoe: (on: boolean): MomaRequest => momaRequest(M3Cmd.SET_SYNC_HOTSHOE, [u8(on)]),
  /** A ProtocolSender6303.setBelAppUpdate(): empty payload. */
  setBelAppUpdate: (): MomaRequest => momaRequest(M3Cmd.SET_BEL_APP_UPDATE),
} as const
