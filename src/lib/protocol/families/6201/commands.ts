/**
 * MELO P1 (family 6201) command catalogue, unit device types and request builders.
 * docs/research/families/melo-6201.md §4–§5. Nothing here was run against hardware.
 *
 * Ids come from A protocol/core/sound/command/type/Command6201 (string values, "0x600B" → 0x600B, A
 * HexUtils.hexStringToByteArray) and A blemic/operation/BleMicCommUtil (0x600A, 0x600B, 0x2007, 0x4000–0x4005);
 * executors are A protocol/core/sound/command/device6201/Cmd*6201. iOS: +[HL6201Messenger …] in
 * /Applications/larkSound.app (addresses in melo-6201.md). Paths below are relative to com/hollyland/.
 *
 * Safety classes (FAMILIES.md §2.3; the engine enforces them for every request and batch item):
 *  - read:        GETs, device info, VU reads, box battery reads
 *  - write:       settings SETs with absolute values (no toggles: every SET carries the target state), the VU
 *                 subscription (0x11E0 / 0x6048 / 0x6049)
 *  - disruptive:  restart the receiver or re-enumerate it: bit depth 0x1304 (R reboot_device_switch_sample_bit
 *                 "Changing the sample depth will restart the device. Continue?"), auto speaker output 0x1310
 *                 (R switching_to_external_and_restart_device), wireless monitoring 0x112A (iOS copy: enabling
 *                 switches to 2TX&2RX, disabling restarts the RX into 4TX&4RX), iOS-only UAC layout 0x131B (the RX
 *                 re-enumerates on USB: I HLUSBChannelSwitchCoordinator)
 *  - destructive: factory reset, unpairing, serial-number write, tone-file writes (overwrite device storage)
 *  - ota:         firmware update 0x4000–0x4008 (never sent: FAMILIES.md §2.1)
 * Effects (EQ, compressor, reverb…) and presets are catalogued with their class so sendRaw can classify them; the
 * driver implements none of them yet (FAMILIES.md §2.2 W10).
 */
import type { CommandCatalogue, CommandSpec, UnitId } from '../../core/types'
import { momaBatch, momaRequest, type MomaRequest } from '../../moma/spec'

// ------------------------------------------------------------------------------------------- ids

export const MELO_CMD = {
  // System, status, identity (melo-6201.md §5.2)
  /** A Command6201.CMD_APP_HEART_BEAT_GET = BleMicCommUtil.CMD_APP_HEART_INFO "0x600B"; 31-byte reply. */
  HEARTBEAT: 0x600b,
  /** A Command6201.CMD_APP_DEVICE_INFO_GET = BleMicCommUtil.CMD_APP_DEVICE_VERSION "0x600A"; payload u8 DeviceType. */
  DEVICE_INFO: 0x600a,
  /** A Command6201.CMD_APP_SOFTWARE_VERSION_GET "0x3002": no executor, unused. */
  SOFTWARE_VERSION: 0x3002,
  /** A Command6201.HL_APP_CMD_NOTIFY_START "0x6048" (A CmdSetNotifyStart6201). */
  NOTIFY_START: 0x6048,
  /** A Command6201.HL_APP_CMD_NOTIFY_STOP "0x6049" (A CmdSetNotifyStop6201), empty payload, stops every push. */
  NOTIFY_STOP: 0x6049,

  // VU (§5.4)
  /** A CMD_CHAIN_VU_TYPE_SET "0x11E0" (A CmdSetChainVuType6201, HLSoundChinaVUTypeExtKt.cmdSerialize). */
  VU_SOURCE_SET: 0x11e0,
  /** A CMD_APP_ALGO_CHAIN_INPUTS_VU_GET "0x11E1": 5 × i16. */
  VU_INPUTS_GET: 0x11e1,
  /** A CMD_CHAIN_VU_VOCAL1_GET … CMD_CHAIN_VU_BUS_GET "0x11E2".."0x11E8" (Pro Tuning chains). */
  VU_CHAIN_VOCAL1_GET: 0x11e2,
  VU_CHAIN_VOCAL2_GET: 0x11e3,
  VU_CHAIN_INST_GET: 0x11e4,
  VU_CHAIN_ACC_GET: 0x11e5,
  VU_CHAIN_SPATIAL_GET: 0x11e6,
  VU_CHAIN_PREBUS_GET: 0x11e7,
  VU_CHAIN_BUS_GET: 0x11e8,
  /** A CMD_APP_ALGO_CHAIN_OUTPUTS_VU_GET "0x11E9": 8 × i16. */
  VU_OUTPUTS_GET: 0x11e9,
  /** A CMD_ALGO_CHAIN_INPUT_OUTPUT_VU_GET "0x11EB": 5 + 8 × i16 (A CmdGetAllChainInputAndOutputVu6201). */
  VU_ALL_GET: 0x11eb,

  // More Settings (§5.3)
  NC_SET: 0x1300, // A CMD_APP_RX_NOISE_LEVEL_SET
  NC_GET: 0x1301, // A CMD_APP_RX_NOISE_LEVEL_GET
  JACK_DIR_SET: 0x1302, // A CMD_APP_AUDIO_35CONN_DIR_CTRL_SET
  JACK_DIR_GET: 0x1303, // A CMD_APP_AUDIO_35CONN_DIR_CTRL_GET
  BIT_DEPTH_SET: 0x1304, // A CMD_APP_RX_SAMPLE_DEPTH_SET
  BIT_DEPTH_GET: 0x1305, // A CMD_APP_RX_SAMPLE_DEPTH_GET
  UAC_STREAM_SET: 0x1306, // A CMD_APP_RX_UAC_OUT_SET
  UAC_STREAM_GET: 0x1307, // A CMD_APP_RX_UAC_OUT_GET
  STREAM_OUT_SET: 0x1308, // A CMD_APP_AUDIO_STREAM_OUT_VOL_SET
  STREAM_OUT_GET: 0x1309, // A CMD_APP_AUDIO_STREAM_OUT_VOL_GET
  STREAM_IN_SET: 0x130a, // A CMD_APP_AUDIO_STREAM_IN_VOL_SET
  STREAM_IN_GET: 0x130b, // A CMD_APP_AUDIO_STREAM_IN_VOL_GET
  ALGO_SHOW_SET: 0x130c, // A CMD_AUDIO_ALGO_SHOW_EN_SET
  ALGO_SHOW_GET: 0x130d, // A CMD_AUDIO_ALGO_SHOW_EN_GET
  OWS_VOL_SET: 0x130e, // A CMD_APP_AUDIO_OWS_VOL_SET
  OWS_VOL_GET: 0x130f, // A CMD_APP_AUDIO_OWS_VOL_GET
  AUTO_SPEAKER_SET: 0x1310, // A CMD_APP_AUDIO_NOT_PLUG_AND_PLAY_SWITCH_SET
  AUTO_SPEAKER_GET: 0x1311, // A CMD_APP_AUDIO_NOT_PLUG_AND_PLAY_SWITCH_GET
  MIC_GAIN_SET: 0x1312, // A CMD_APP_MIC_GAIN_SUP_SET
  MIC_GAIN_GET: 0x1313, // A CMD_APP_RX_GAIN_SUP_GET
  REMOTE_REMAP_SET: 0x1314, // A CMD_APP_AUDIO_REMOTE_CTRL_REMAP_SET
  REMOTE_REMAP_GET: 0x1315, // A CMD_APP_AUDIO_REMOTE_CTRL_REMAP_GET
  VIRTUAL_REMOTE_SET: 0x1317, // A CMD_HL_AUDIO_VIRTUAL_REMOTE_CONTROL_SET
  VIRTUAL_REMOTE_GET: 0x1318, // A CMD_HL_AUDIO_VIRTUAL_REMOTE_CONTROL_GET
  TX_GAIN_SET: 0x1319, // A CMD_APP_INDEPENDENT_TX_GAIN_SET
  TX_GAIN_GET: 0x131a, // A CMD_APP_INDEPENDENT_TX_GAIN_GET
  UAC_LAYOUT_SET: 0x131b, // iOS only: I sendSetUACChAndContentWithUploadChNum:… @0x10023dca4
  UAC_LAYOUT_GET: 0x131c, // iOS only
  GUIDE_TTS: 0x131d, // A CMD_HL_AUDIO_BEGINNNER_GUIDE_TTS
  LED_SET: 0x2000, // A CMD_APP_LED_LIGHT_SET
  LED_GET: 0x3004, // A CMD_APP_LED_LIGHT_GET
  MONITOR_SET: 0x112a, // A CMD_MONITOR_CTRL_SET
  MONITOR_GET: 0x112b, // A CMD_MONITOR_CTRL_GET
  WORK_MODE_SET: 0x1154, // A CMD_HL_AUDIO_APP_WORK_MODE_SWITCH_SET
  WORK_MODE_GET: 0x1155, // A CMD_HL_AUDIO_APP_WORK_MODE_SWITCH_GET
  NOISE_GATE_SET: 0x1142, // A CMD_HL_AUDIO_NOISEGATE_PARAM_SET
  NOISE_GATE_GET: 0x1143, // A CMD_HL_AUDIO_NOISEGATE_PARAM_GET
  RECORD_PLAY: 0x1145, // A CMD_HL_AUDIO_SINGING_RECORD_PLAY_SET

  // Destructive (§5.6)
  FACTORY_RESET: 0x2007, // A CMD_APP_RESTORE_FACTORY_SET = BleMicCommUtil.CMD_APP_RESET_FACTORY_SETTING
  TX_CLEAR_PAIR: 0x001f, // A CMD_APP_TX_CLEAR_PAIR_SET
  EAR_CLEAR_PAIR: 0x0022, // A CMD_APP_EAR_CLEAR_PAIR_SET
  REMOTE_CLEAR_PAIR: 0x001c, // A CMD_APP_REMOTE_CTRL_CLEAR_PAIR_SET
  SN_SET: 0x700a, // A HL_PRODUCT_SN_NUM_SET

  // Box battery, USB only (§5.7)
  BOX_BATTERY_LEVEL: 0x7011, // A CMD_BOX_BATTERY_LEVEL_GET
  BOX_BATTERY_TEMP: 0x7013, // A CMD_BOX_BATTERY_TEMPERATURE_GET
  BOX_BATTERY_INFO: 0x3100, // A CMD_BOX_BATTERY_INFO_GET
  BOX_BATTERY_RECORD: 0x3101, // A CMD_BOX_BATTERY_RECORD_GET
} as const

/** 6201 device types (A protocol/core/sound/constant/DeviceControlConstant.DeviceType), the 0x600A payload. */
export const MELO_DEVICE_TYPE = {
  SOUND_CARD_MASTER: 0,
  REMOTE_CONTROL: 1,
  SOUND_CARD_SLAVE: 2,
  EP1: 3,
  EP2: 4,
  TX1: 5,
  TX2: 6,
  BOX: 7,
  /** Aliases of TX1 / TX2 (A DeviceRuntimeManager.updateDeviceInfoList stores TX1 info under MIC1 too). */
  MIC1: 8,
  MIC2: 9,
} as const

/**
 * Unit → the device type the app asks 0x600A for (A c6201/data/runtime/DeviceRuntimeManager
 * .checkAllOnlineDeviceVersions: master, slave, TX1/TX2 when online, remote when connected, EP1/EP2 by the
 * heartbeat's earConnectState). The case (BOX = 7) is not asked there; its version comes from the USB upgrade flow.
 */
export const MELO_UNIT_DEVICE_TYPE: Partial<Record<UnitId, number>> = {
  rx: MELO_DEVICE_TYPE.SOUND_CARD_MASTER,
  remote: MELO_DEVICE_TYPE.REMOTE_CONTROL,
  earL: MELO_DEVICE_TYPE.EP1,
  earR: MELO_DEVICE_TYPE.EP2,
  tx1: MELO_DEVICE_TYPE.TX1,
  tx2: MELO_DEVICE_TYPE.TX2,
}

/** Device type of a 0x600A reply → unit (TX aliases included). Slave and BOX have no unit here. */
export function meloUnitOfDeviceType(type: number): UnitId | undefined {
  switch (type) {
    case MELO_DEVICE_TYPE.SOUND_CARD_MASTER: return 'rx'
    case MELO_DEVICE_TYPE.REMOTE_CONTROL: return 'remote'
    case MELO_DEVICE_TYPE.EP1: return 'earL'
    case MELO_DEVICE_TYPE.EP2: return 'earR'
    case MELO_DEVICE_TYPE.TX1:
    case MELO_DEVICE_TYPE.MIC1: return 'tx1'
    case MELO_DEVICE_TYPE.TX2:
    case MELO_DEVICE_TYPE.MIC2: return 'tx2'
    case MELO_DEVICE_TYPE.BOX: return 'box'
    default: return undefined
  }
}

/** LED device byte of 0x2000 / 0x3004 (A DeviceControlConstant.LedDeviceType SOUND_CARD 0, TX_ONE 1, TX_TWO 2). */
export const MELO_LED_DEVICE: Partial<Record<UnitId, number>> = { rx: 0, tx1: 1, tx2: 2 }

// ------------------------------------------------------------------------------------ gates

/**
 * RX master firmware gates (melo-6201.md §4.2):
 *  - NEW_STRUCTURE 4.0.0.1: A protocol/core/sound/entity/Protocol6201SessionState.NEW_STRUCTURE_MIN_VERSION
 *    (isNewStructure: compareVersions(master, "4.0.0.1") >= 0) switches 0x1128/0x1129, 0x1117/0x1118, 0x1138/0x1139
 *    and 0x113C to their V2 entities; A c6201/ui/setting/MoreSettingActivity.updateVersionBasedUI hides
 *    "Noise Gate" and "Auto volume adjustment" and shows "Loudness Detection" from there on (blank version: V1 UI).
 *  - INDEPENDENT_TX_GAIN 3.0.7.9: A MoreSettingActivity.INDEPENDENT_TX_GAIN_MIN_VERSION = 50333449 (0x03000709,
 *    DeviceOTAHelper.removeLettersAndDotsToInt), resolveNewFirmwareVersion: >= → per-mic gain 0x1319 / 0x131A,
 *    else the shared Near / Mid / Far 0x1312 / 0x1313; version unknown → neither is read
 *    (dispatchMicGainQueryByFirmwareVersion). I +[HL6201Messenger isNewFirmwareForIndependentGain] @0x10023c430.
 */
export const MELO_GATE = {
  NEW_STRUCTURE: '4.0.0.1',
  INDEPENDENT_TX_GAIN: '3.0.7.9',
} as const

// --------------------------------------------------------------------------------- catalogue

const A = 'A protocol/core/sound/command'
const read = (name: string, source: string, description?: string): CommandSpec => ({ name, safety: 'read', retrySafe: true, source, ...(description ? { description } : {}) })
const write = (name: string, source: string, description?: string): CommandSpec => ({ name, safety: 'write', retrySafe: true, source, ...(description ? { description } : {}) })
const disruptive = (name: string, source: string, description: string): CommandSpec => ({ name, safety: 'disruptive', retrySafe: false, source, description })
const destructive = (name: string, source: string, description: string): CommandSpec => ({ name, safety: 'destructive', retrySafe: false, source, description })
const ota = (name: string, source: string): CommandSpec => ({ name, safety: 'ota', retrySafe: false, source, description: 'firmware update (melo-6201.md §5.8): never sent' })

/** DSP effect pairs (SET, GET) from Command6201, catalogue only (melo-6201.md §5.4; FAMILIES.md W10). */
const EFFECTS: readonly [number, number, string, string][] = [
  [0x1102, 0x1103, 'COMPRESS_PARAM', 'CmdSetEffectCompress6201 / CmdGetEffectCompress6201'],
  [0x1104, 0x1105, 'DE_ESSER_PARAM', 'CmdSetEffectDeEsser6201 / CmdGetEffectDeEsser6201'],
  [0x1106, 0x1107, 'MS_EQ_PARAM', 'CmdSetEffectMsEq6201 / CmdGetEffectMsEq6201'],
  [0x1108, 0x1109, 'DELAY_PARAM', 'CmdSetReverbDelayParam6201 / CmdGetReverbDelayParam6201'],
  [0x110a, 0x110b, 'ROOM_PARAM', 'CmdSetReverbRoomParam6201 / CmdGetReverbRoomParam6201'],
  [0x110e, 0x110f, 'SIDE_COMPRESS_PARAM', 'CmdSetEffectSideCompress6201 / CmdGetEffectSideCompress6201'],
  [0x1110, 0x1111, 'MTBD_COMPRESS_PARAM', 'CmdSetEffectMtbdCompress6201 / CmdGetEffectMtbdCompress6201'],
  [0x1112, 0x1113, 'EQ_PARAM', 'CmdSetEffectEq6201 / CmdGetEffectEq6201'],
  [0x1114, 0x1115, 'DISTORTION_PARAM', 'CmdSetDistortion6201 / CmdGetDistortion6201'],
  [0x1117, 0x1118, 'SWITCH_ALL_CHAIN', 'CmdSetSwitchAllChain6201 / CmdGetSwitchAllChain6201 (V1/V2 by firmware)'],
  [0x1126, 0x1127, 'VOICE_INS_MIX', 'CmdSetMixVoiceIns6201 / CmdGetMixVoiceIns6201'],
  [0x1128, 0x1129, 'ALL_CHAIN_LEVEL', 'CmdSetAllChainLevel6201 / CmdGetAllChainLevel6201 (V1/V2 by firmware)'],
  [0x112e, 0x112f, 'AUDIO_SIDE_COMPRESS_INPUT_SEL', 'CmdSetAudioSideCompressInputSel6201 / CmdGetAudioSideCompressInputSel6201'],
  [0x1132, 0x1133, 'APP_AUDIO_PREFESSINAL_MUSIC_SYTLE', 'CmdSetAudioProfessionalMusicStyle6201 / CmdGetAudioProfessionalMusicStyle6201'],
  [0x1134, 0x1135, 'AUDIO_NOVICE_MUSIC_SYTLE', 'CmdSetAudioNovice6201 / CmdGetAudioNovice6201'],
  [0x1136, 0x1137, 'AUDIO_OPEN_CLOSE_MUSIC_SYTLE', 'CmdSetOpenAndClose6201 / CmdGetOpenAndClose6201'],
  [0x1138, 0x1139, 'HL_AUDIO_MUSIC_STYLE', 'CmdSetAudioNoviceAndProfessionalMusicStyle6201 / CmdGet… (V1/V2 by firmware)'],
  [0x113a, 0x113b, 'HL_AUDIO_MUSIC_STYLE_TYPE', 'CmdSetMusicStyleType6201 / CmdGetMusicStyleType6201'],
  [0x1140, 0x1141, 'HL_AUDIO_APP_REMOTE_DODGE', 'CmdSetDodgeVolume6201 / CmdGetDodgeVolume6201'],
  [0x1146, 0x1147, 'DARGONVERB_PARAM', 'CmdSetReverbDatverbParam6201 / CmdGetReverbDargonverbParam6201'],
  [0x1148, 0x1149, 'LUFS_AGC_PARAM', 'CmdSetLufsAgc6201 / CmdGetLufsAgc6201'],
  [0x114a, 0x114b, 'HPF_PARAM', 'CmdSetHpf6201 / CmdGetHpf6201'],
  [0x114c, 0x114d, 'INPUT_DELAY_PARAM', 'CmdSetInputDelay6201 / CmdGetInputDelay6201'],
  [0x114e, 0x114f, 'SMART_CARVING_PARAM', 'CmdSetSmartCarving6201 / CmdGetSmartCarving6201'],
  [0x1152, 0x1153, 'HL_AUDIO_APP_DODGE_SWITCH', 'CmdSetDodgeSwitch6201 / CmdGetDodgeSwitch6201'],
]

function effectEntries(): Record<number, CommandSpec> {
  const out: Record<number, CommandSpec> = {}
  for (const [set, get, name, exec] of EFFECTS) {
    const src = `${A}/type/Command6201.CMD_${name}_SET/_GET; ${A}/device6201/${exec}`
    out[set] = write(`${name}_SET`, src, 'catalogue only: DSP effects and presets are a later extra (FAMILIES.md W10)')
    out[get] = read(`${name}_GET`, src)
  }
  return out
}

/**
 * Every 6201 id in A Command6201 (114 executors) plus the iOS-only 0x131B / 0x131C, with its safety class.
 * Ids outside this catalogue are refused by the engine (and, forced, on an untested product).
 */
export const MELO_COMMANDS: CommandCatalogue = {
  [MELO_CMD.HEARTBEAT]: read('CMD_APP_HEART_BEAT_GET', `${A}/device6201/CmdGetHeart6201 → data/HLSoundHeartEntitySerializer; I +[HL6201Messenger …] -[HL6201ViewModel sendHeartInfo] @0x10026e1f0`),
  [MELO_CMD.DEVICE_INFO]: read('CMD_APP_DEVICE_INFO_GET', `${A}/device6201/CmdGetDeviceInfo6201.encodePayload (NumberUtil.otherType2Bytes(Integer) = 1 byte) / decodePayload; I sendGetDeviceInfoVersion: @0x10023c4fc`),
  [MELO_CMD.SOFTWARE_VERSION]: read('CMD_APP_SOFTWARE_VERSION_GET', `${A}/type/Command6201.CMD_APP_SOFTWARE_VERSION_GET (no executor)`),
  [MELO_CMD.NOTIFY_START]: write('HL_APP_CMD_NOTIFY_START', `${A}/device6201/CmdSetNotifyStart6201 → data/HlSoundNotifyInfoExtKt.cmdSerialize`, 'start device pushes of the listed GET ids (VU meters)'),
  [MELO_CMD.NOTIFY_STOP]: write('HL_APP_CMD_NOTIFY_STOP', `${A}/device6201/CmdSetNotifyStop6201`, 'stop every device push'),
  [MELO_CMD.VU_SOURCE_SET]: write('CMD_CHAIN_VU_TYPE_SET', `${A}/device6201/CmdSetChainVuType6201 → data/HLSoundChinaVUTypeExtKt.cmdSerialize`, 'select the VU sources (inputs / outputs / chains)'),
  [MELO_CMD.VU_INPUTS_GET]: read('CMD_APP_ALGO_CHAIN_INPUTS_VU_GET', `${A}/device6201/CmdGetChainInputVu6201 → data/HLSoundChainInputVUSerializer`),
  [MELO_CMD.VU_CHAIN_VOCAL1_GET]: read('CMD_CHAIN_VU_VOCAL1_GET', `${A}/device6201/CmdGetVuChainVocal16201`),
  [MELO_CMD.VU_CHAIN_VOCAL2_GET]: read('CMD_CHAIN_VU_VOCAL2_GET', `${A}/device6201/CmdGetVuChainVocal26201`),
  [MELO_CMD.VU_CHAIN_INST_GET]: read('CMD_CHAIN_VU_INST_GET', `${A}/device6201/CmdGetVuChainInst6201`),
  [MELO_CMD.VU_CHAIN_ACC_GET]: read('CMD_CHAIN_VU_ACC_GET', `${A}/device6201/CmdGetVuChainAcc6201`),
  [MELO_CMD.VU_CHAIN_SPATIAL_GET]: read('CMD_CHAIN_VU_SPACIAL_GET', `${A}/device6201/CmdGetVuChainSpacial6201`),
  [MELO_CMD.VU_CHAIN_PREBUS_GET]: read('CMD_CHAIN_VU_PRE_BUS_GET', `${A}/device6201/CmdGetVuChainPreBus6201`),
  [MELO_CMD.VU_CHAIN_BUS_GET]: read('CMD_CHAIN_VU_BUS_GET', `${A}/device6201/CmdGetVuChainBus6201`),
  [MELO_CMD.VU_OUTPUTS_GET]: read('CMD_APP_ALGO_CHAIN_OUTPUTS_VU_GET', `${A}/device6201/CmdGetChainOutputVu6201 → data/HLSoundChainOutputVUSerializer`),
  [MELO_CMD.VU_ALL_GET]: read('CMD_ALGO_CHAIN_INPUT_OUTPUT_VU_GET', `${A}/device6201/CmdGetAllChainInputAndOutputVu6201 → data/HLSoundChainInputAndOutputVUSerializer; pushed after 0x6048 (larkc1/c6201/v2/data/runtime/C6201VuSubscriptionCoordinator.reconcile)`),

  [MELO_CMD.NC_SET]: write('CMD_APP_RX_NOISE_LEVEL_SET', `${A}/device6201/CmdSetNoiseLevel6201.encodePayload: otherType2Bytes(Boolean isOpen, Integer level) = [on, level]; I sendSetNoiseReduction:value: @0x10023dbbc`),
  [MELO_CMD.NC_GET]: read('CMD_APP_RX_NOISE_LEVEL_GET', `${A}/device6201/CmdGetNoiseLevel6201.decodePayload: [0] == 1 on, [1] level`),
  [MELO_CMD.JACK_DIR_SET]: write('CMD_APP_AUDIO_35CONN_DIR_CTRL_SET', `${A}/device6201/CmdSet35PortDirection6201 → data/SingleRadioDataExtKt (i32 LE)`),
  [MELO_CMD.JACK_DIR_GET]: read('CMD_APP_AUDIO_35CONN_DIR_CTRL_GET', `${A}/device6201/CmdGet35PortDirection6201 → SingleRadioDataSerializer (i32 LE)`),
  [MELO_CMD.BIT_DEPTH_SET]: disruptive('CMD_APP_RX_SAMPLE_DEPTH_SET', `${A}/device6201/CmdSetSampleDepth6201 → data/HLAudioUACBitEntityExtKt; A larkc1/c6201/ui/home/tuning/manager/DialogShowingManager.showSampleBitRebootDeviceDialog`, 'the receiver restarts (R reboot_device_switch_sample_bit)'),
  [MELO_CMD.BIT_DEPTH_GET]: read('CMD_APP_RX_SAMPLE_DEPTH_GET', `${A}/device6201/CmdGetSampleDepth6201 → HLAudioUACBitEntitySerializer (4 × u8)`),
  [MELO_CMD.UAC_STREAM_SET]: write('CMD_APP_RX_UAC_OUT_SET', `${A}/device6201/CmdSetRxUACStream6201 → data/HLAudioUACStreamExtKt (8 × bool)`, 'USB audio stream routing; not offered yet'),
  [MELO_CMD.UAC_STREAM_GET]: read('CMD_APP_RX_UAC_OUT_GET', `${A}/device6201/CmdGetRxUACStream6201 → HLAudioUACStreamSerializer`),
  [MELO_CMD.STREAM_OUT_SET]: write('CMD_APP_AUDIO_STREAM_OUT_VOL_SET', `${A}/device6201/CmdSetAudioStreamOut6201 → data/HLAudioOutVoiceEntityExtKt (6 × u8)`),
  [MELO_CMD.STREAM_OUT_GET]: read('CMD_APP_AUDIO_STREAM_OUT_VOL_GET', `${A}/device6201/CmdGetAudioStreamOut6201 → HLAudioOutVoiceEntitySerializer`),
  [MELO_CMD.STREAM_IN_SET]: write('CMD_APP_AUDIO_STREAM_IN_VOL_SET', `${A}/device6201/CmdSetAudioStreamIn6201 → data/HLAudioInVoiceEntityExtKt (15 × u8)`),
  [MELO_CMD.STREAM_IN_GET]: read('CMD_APP_AUDIO_STREAM_IN_VOL_GET', `${A}/device6201/CmdGetAudioStreamIn6201 → HLAudioInVoiceEntitySerializer`),
  [MELO_CMD.ALGO_SHOW_SET]: write('CMD_AUDIO_ALGO_SHOW_EN_SET', `${A}/device6201/CmdSetAudioAlgoShowEn6201 (19 × bool)`, 'effect enables; catalogue only'),
  [MELO_CMD.ALGO_SHOW_GET]: read('CMD_AUDIO_ALGO_SHOW_EN_GET', `${A}/type/Command6201.CMD_AUDIO_ALGO_SHOW_EN_GET`),
  [MELO_CMD.OWS_VOL_SET]: write('CMD_APP_AUDIO_OWS_VOL_SET', `${A}/device6201/CmdSetOwsVolume6201 → data/HLAudioOWSEntityExtKt`, 'earphone volume; the mixer page uses 0x1308 instead'),
  [MELO_CMD.OWS_VOL_GET]: read('CMD_APP_AUDIO_OWS_VOL_GET', `${A}/device6201/CmdGetOwsVolume6201 → HLAudioOWSEntitySerializer`),
  [MELO_CMD.AUTO_SPEAKER_SET]: disruptive('CMD_APP_AUDIO_NOT_PLUG_AND_PLAY_SWITCH_SET', `${A}/device6201/CmdSetNotPlugPlay6201 (SingleRadioData i32); A DialogShowingManager.showExternalSwitchDialog`, 'the receiver restarts (R switching_to_external_and_restart_device; I "Switching … will restart the device")'),
  [MELO_CMD.AUTO_SPEAKER_GET]: read('CMD_APP_AUDIO_NOT_PLUG_AND_PLAY_SWITCH_GET', `${A}/device6201/CmdGetNotPlugPlay6201: SingleRadioData == Protocol6201Status.OPEN (1)`),
  [MELO_CMD.MIC_GAIN_SET]: write('CMD_APP_MIC_GAIN_SUP_SET', `${A}/device6201/CmdSetMicGainSup6201 → data/HLAudioUACMicGainSupEntityExtKt (i32 LE)`),
  [MELO_CMD.MIC_GAIN_GET]: read('CMD_APP_RX_GAIN_SUP_GET', `${A}/device6201/CmdGetMicGainSup6201 → HLAudioUACMicGainSupEntitySerializer (i32 LE)`),
  [MELO_CMD.REMOTE_REMAP_SET]: write('CMD_APP_AUDIO_REMOTE_CTRL_REMAP_SET', `${A}/type/Command6201.CMD_APP_AUDIO_REMOTE_CTRL_REMAP_SET`, 'catalogue only'),
  [MELO_CMD.REMOTE_REMAP_GET]: read('CMD_APP_AUDIO_REMOTE_CTRL_REMAP_GET', `${A}/type/Command6201.CMD_APP_AUDIO_REMOTE_CTRL_REMAP_GET`),
  [MELO_CMD.VIRTUAL_REMOTE_SET]: write('CMD_HL_AUDIO_VIRTUAL_REMOTE_CONTROL_SET', `${A}/device6201/CmdSetVirtualRemoteControl6201`, 'catalogue only'),
  [MELO_CMD.VIRTUAL_REMOTE_GET]: read('CMD_HL_AUDIO_VIRTUAL_REMOTE_CONTROL_GET', `${A}/device6201/CmdGetVirtualRemoteControl6201`),
  [MELO_CMD.TX_GAIN_SET]: write('CMD_APP_INDEPENDENT_TX_GAIN_SET', `${A}/device6201/CmdSetIndependentTxGain6201 → data/HLIndependentTxGainEntityExtKt (2 × i32 LE)`),
  [MELO_CMD.TX_GAIN_GET]: read('CMD_APP_INDEPENDENT_TX_GAIN_GET', `${A}/device6201/CmdGetIndependentTxGain6201 → HLIndependentTxGainEntitySerializer`),
  [MELO_CMD.UAC_LAYOUT_SET]: disruptive('UAC_CH_AND_CONTENT_SET (iOS only)', 'I +[HL6201Messenger sendSetUACChAndContentWithUploadChNum:…] @0x10023dca4, HLAudioUACChannelConfigEntity @0x10001bfb0; not in A Command6201', 'the RX re-enumerates on USB (I HLUSBChannelSwitchCoordinator)'),
  [MELO_CMD.UAC_LAYOUT_GET]: read('UAC_CH_AND_CONTENT_GET (iOS only)', 'I HLAudioUACChannelConfigEntity @0x10001bfb0; not in A Command6201'),
  [MELO_CMD.GUIDE_TTS]: write('CMD_HL_AUDIO_BEGINNNER_GUIDE_TTS', `${A}/device6201/CmdSetBeginnerGuideTts6201; I sendBeginnerGuideTTSPlay: @0x10023de24`, 'catalogue only'),
  [MELO_CMD.LED_SET]: write('CMD_APP_LED_LIGHT_SET', `${A}/device6201/CmdSetLed6201 → data/HLLEDStatusEntityExtKt [switch, ledDeviceType, brightness]; I sendLEDWithType:isOpen:value: @0x10023c58c`),
  [MELO_CMD.LED_GET]: read('CMD_APP_LED_LIGHT_GET', `${A}/device6201/CmdGetLed6201.decodePayload: n × [switch, ledDeviceType, brightness]`),
  [MELO_CMD.MONITOR_SET]: disruptive('CMD_MONITOR_CTRL_SET', `${A}/device6201/CmdSetMonitorControl6201`, 'wireless monitoring: iOS says enabling switches to 2TX&2RX mode and disabling restarts the RX; catalogue only'),
  [MELO_CMD.MONITOR_GET]: read('CMD_MONITOR_CTRL_GET', `${A}/device6201/CmdGetMonitorControl6201`),
  [MELO_CMD.WORK_MODE_SET]: write('CMD_HL_AUDIO_APP_WORK_MODE_SWITCH_SET', `${A}/device6201/CmdSetWorkMode6201 → data/HLWorkModeEntityExtKt (i32 LE); I sendSetAppWorkMode: @0x10023d2fc`),
  [MELO_CMD.WORK_MODE_GET]: read('CMD_HL_AUDIO_APP_WORK_MODE_SWITCH_GET', `${A}/device6201/CmdGetWorkMode6201.decodePayload (payload must be 4 bytes)`),
  [MELO_CMD.NOISE_GATE_SET]: write('CMD_HL_AUDIO_NOISEGATE_PARAM_SET', `${A}/device6201/CmdSetAudioNoiseGateParam6201 → data/HlAudioNoiseGateParamSetEntityExtKt (20 B)`),
  [MELO_CMD.NOISE_GATE_GET]: read('CMD_HL_AUDIO_NOISEGATE_PARAM_GET', `${A}/device6201/CmdGetAudioNoiseGateParam6201 (request [02 00]); I getDeviceSetInfo @0x10023c224`),
  [MELO_CMD.RECORD_PLAY]: write('CMD_HL_AUDIO_SINGING_RECORD_PLAY_SET', `${A}/device6201/CmdSetSingingRecordPlay6201`, 'catalogue only'),
  [0x113c]: write('CMD_HL_AUDIO_REMOTE_KEY_MUSIC_STYLE_TYPE_MAP', `${A}/device6201/CmdSetRemoteKeyMusicStyleType6201 (V1/V2 by firmware)`, 'catalogue only'),
  [0x113d]: read('CMD_HL_AUDIO_NOTIFY_CURRENT_MUSIC_STYLE', `${A}/device6201/CmdGetAudioNotifyCurrentMusicStyle6201 (i32 currentMusicStyleKey; also pushed [I])`),
  [0x113f]: read('CMD_HL_AUDIO_APP_GET_REMOTE_KEY_MUSIC_STYLE_INFO', `${A}/device6201/CmdGetRemoteKeyMusicStyleInfo6201`),
  [0x1144]: write('CMD_HL_AUDIO_MUSIC_STYLE_HEAD_INFO_SET', `${A}/device6201/CmdSetMusicStyleHeadInfo6201`, 'catalogue only'),
  [0x1150]: write('HL_AUDIO_EFFECT_SIMPLE_MODE_PARAM_SET', `${A}/device6201/CmdSetAudioEffectSimpleModeParam6201`, 'catalogue only'),
  ...effectEntries(),
  [0x6044]: read('HL_APP_GET_TONE_FILE_STATE', `${A}/device6201/CmdToneFileState6201`),
  [0x6045]: destructive('HL_APP_TONE_FILE_WRITE_INIT', `${A}/device6201/CmdToneFileWriteInit6201`, 'starts overwriting a tone (sound-effect pad) file on the device'),
  [0x6046]: destructive('HL_APP_TONE_FILE_WRITE', `${A}/device6201/CmdToneFileWrite6201`, 'writes tone file data to the device'),
  [0x6047]: destructive('HL_AUDIO_TONE_FILE_WRITE_DONE', `${A}/device6201/CmdToneFileWriteDone6201`, 'commits a tone file'),

  [MELO_CMD.FACTORY_RESET]: destructive('CMD_APP_RESTORE_FACTORY_SET', `${A}/device6201/CmdSetRestoreFactory6201; A blemic/operation/BleMicCommUtil.CMD_APP_RESET_FACTORY_SETTING`, 'factory reset (R "Factory Reset")'),
  [MELO_CMD.TX_CLEAR_PAIR]: destructive('CMD_APP_TX_CLEAR_PAIR_SET', `${A}/device6201/CmdSetMicClearPair6201`, 'removes a mic pairing'),
  [MELO_CMD.EAR_CLEAR_PAIR]: destructive('CMD_APP_EAR_CLEAR_PAIR_SET', `${A}/device6201/CmdSetEarphoneClearPair6201`, 'removes the earphone pairing'),
  [MELO_CMD.REMOTE_CLEAR_PAIR]: destructive('CMD_APP_REMOTE_CTRL_CLEAR_PAIR_SET', `${A}/device6201/CmdSetRemoteCtrlClearPair6201`, 'removes the remote pairing'),
  [MELO_CMD.SN_SET]: destructive('HL_PRODUCT_SN_NUM_SET', `${A}/device6201/CmdSetProductSn6201 (larkc1/c6201/ui/debug only)`, 'writes the serial number (production tool)'),

  [MELO_CMD.BOX_BATTERY_LEVEL]: read('CMD_BOX_BATTERY_LEVEL_GET', `${A}/type/Command6201.CMD_BOX_BATTERY_LEVEL_GET (USB only: not in A mic_ble/messenger/BleMessenger6201)`),
  [MELO_CMD.BOX_BATTERY_TEMP]: read('CMD_BOX_BATTERY_TEMPERATURE_GET', `${A}/type/Command6201.CMD_BOX_BATTERY_TEMPERATURE_GET (USB only)`),
  [MELO_CMD.BOX_BATTERY_INFO]: read('CMD_BOX_BATTERY_INFO_GET', `${A}/type/Command6201.CMD_BOX_BATTERY_INFO_GET (USB only)`),
  [MELO_CMD.BOX_BATTERY_RECORD]: read('CMD_BOX_BATTERY_RECORD_GET', `${A}/type/Command6201.CMD_BOX_BATTERY_RECORD_GET (USB only)`),

  [0x4000]: ota('CMD_APP_FIRMWARE_TRAN_START', 'A blemic/operation/BleMicCommUtil.CMD_APP_FIRMWARE_TRAN_START; A Command6201.CMD_APP_FIRMWARE_TRAN_START'),
  [0x4001]: ota('CMD_APP_FIRMWARE_TRAN_SUSPEND', 'A Command6201.CMD_APP_FIRMWARE_TRAN_SUSPEND (no executor)'),
  [0x4002]: ota('CMD_APP_FIRMWARE_TRAN_RELOCATION', 'A BleMicCommUtil.CMD_APP_FIRMWARE_TRAN_RELOCATION'),
  [0x4003]: ota('CMD_APP_FIRMWARE_TRAN_PACKAGE', 'A BleMicCommUtil.CMD_APP_FIRMWARE_TRAN_PACKAGE (512-byte USB transfers: Protocol6201Provider.providerUsbConfig override)'),
  [0x4004]: ota('CMD_APP_FIRMWARE_TRAN_END', 'A BleMicCommUtil.CMD_APP_FIRMWARE_TRAN_END'),
  [0x4005]: ota('CMD_APP_APPOINT_OTA_DEVICE', 'A BleMicCommUtil.CMD_APP_FIRMWARE_TRAN_DEVICE'),
  [0x4006]: ota('CMD_APP_OTA_NOTIFY_DEVICE', 'A Command6201.CMD_APP_OTA_NOTIFY_DEVICE'),
  [0x4007]: ota('CMD_APP_OTA_NOTIFY_FINISH', 'A Command6201.CMD_APP_OTA_NOTIFY_FINISH'),
  [0x4008]: ota('CMD_APP_OTA_CHECK_BOX_STATE', 'A Command6201.CMD_APP_OTA_CHECK_BOX_STATE'),
}

// ----------------------------------------------------------------------------------- requests

/** 0x600B, no payload (A ProtocolSender6201.getHeartInfo via DeviceRuntimeManager.startHeartBeat). */
export const meloHeartbeatRequest = (): MomaRequest => momaRequest(MELO_CMD.HEARTBEAT)

/** 0x600A [deviceType] (A CmdGetDeviceInfo6201.encodePayload: one byte, Integer & 0xFF). */
export const meloDeviceInfoRequest = (deviceType: number): MomaRequest => momaRequest(MELO_CMD.DEVICE_INFO, [deviceType & 0xff])

/** GET with no payload (every More Settings GET except the noise gate). */
export const meloGet = (cmd: number): MomaRequest => momaRequest(cmd)

/** 0x1143 [streamType 2 = instrument, algoIndex 0] (A CmdGetAudioNoiseGateParam6201.encodePayload; I getDeviceSetInfo @0x10023c244). */
export const meloNoiseGateGet = (): MomaRequest => momaRequest(MELO_CMD.NOISE_GATE_GET, [2, 0])

/**
 * 0x6048: `u8 count` + count × `{u16 LE cmd, u16 LE intervalMs}` (A data/HlSoundNotifyInfoExtKt.cmdSerialize,
 * HlSoundNotifyInfo__NotifyCmdInfoExtKt; default interval 100 ms: HlSoundNotifyInfo.NotifyCmdInfo constructor).
 * The default follows Android. iOS subscribes with 150 ms and the same layout (+[HL6201Messenger
 * sendGetInOutVU:isAll:] @0x10023d65c `mov w2, #0x96` → -[HLCmdNotifyStartEntity setNotifIntv:]; count byte +
 * entries: -[HLCmdNotifInfoEntity toData] @0x10002ae28), and over an External Accessory link (EADSessionManager
 * deviceType >= 1, @0x10023d5a0–0x10023d604) it polls the VU GET instead of subscribing. Whether the RX honours the
 * interval is a hardware question (melo-6201.md §10).
 */
export function meloNotifyStartRequest(cmds: readonly number[] = [MELO_CMD.VU_ALL_GET], intervalMs = 100): MomaRequest {
  if (!cmds.length || cmds.length > 255) throw new RangeError('0x6048 takes 1..255 command ids')
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 0xffff) throw new RangeError(`interval must be 1..65535 ms, got ${intervalMs}`)
  const p: number[] = [cmds.length]
  for (const c of cmds) p.push(c & 0xff, (c >> 8) & 0xff, intervalMs & 0xff, (intervalMs >> 8) & 0xff)
  return momaRequest(MELO_CMD.NOTIFY_START, p)
}

export const meloNotifyStopRequest = (): MomaRequest => momaRequest(MELO_CMD.NOTIFY_STOP)

/**
 * 0x11E0 with inputs and outputs on and every chain off: 2 bools + vocal1 (7) + vocal2 (7) + instrument (6) +
 * acc (2) + spatial (3) + pre-bus (4) + bus (5) = 36 bytes (A data/HLSoundChinaVUTypeExtKt.cmdSize / cmdSerialize;
 * A larkc1/c6201/widget/view/HLVolumeListView.setVolumeAllVuType sets inputDevicesEnable and outputDevicesEnable).
 */
export function meloVuSourceRequest(inputs = true, outputs = true): MomaRequest {
  const p = new Array<number>(36).fill(0)
  p[0] = inputs ? 1 : 0
  p[1] = outputs ? 1 : 0
  return momaRequest(MELO_CMD.VU_SOURCE_SET, p)
}

/** Several GETs in one frame (A Protocol6201Provider.buildBatchRequest; no 6201 caller in Android 3.1.0 [V]). */
export const meloBatchGet = (cmds: readonly number[]): MomaRequest => momaBatch(cmds)
