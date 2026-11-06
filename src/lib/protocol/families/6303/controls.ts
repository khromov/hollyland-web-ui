/**
 * LARK M3 (6303) controls: the home page (A larkc1/c6303/ui/equipment/controller/EquipmentFragment, I HL6303SettingVc)
 * and More Settings (A larkc1/c6303/ui/setting/controller/MoreSetting6303Activity, I HL6303MoreSettingView), filtered
 * by PID (camera RX vs phone RX, A Device6303DataManager.isPhoneRx). Labels: Android res/values/strings.xml (R key in
 * each `source`). Preconditions (primary RX, a TX online, NC on, 4TX&4RX) are reported per state in
 * MicState.availability (status.ts m3Availability).
 *
 * Read paths (ControlSpec.readBack, conformance check 10):
 *  - 'status': the 0x6000 heartbeat carries it (status.ts m3HeartbeatValues)
 *  - 'get':    0x6011 setting info (bit depth, playback without unplugging) or 0x100E (camera levels), read at start-up
 *
 * Not offered here (catalogue only, commands.ts): factory reset and unpairing (destructive), firmware update (OTA),
 * wireless monitoring / work mode, primary switch and RX locate (multi-RX page), voice profiles (FAMILIES.md §2.2 W10).
 */
import { CONTROL } from '../../core/controls'
import type { ControlSpec } from '../../core/types'
import type { ProductInfo } from '../../models'
import { M3_CAMERA_GAIN_DB, M3_SAMPLING, M3_SOUND_MODE, M3_TX_UNITS } from './commands'
import { isM3PhoneRx } from './products'
import { M3_CONTROL } from './status'

const EQF = 'A larkc1/c6303/ui/equipment/controller/EquipmentFragment'
const EQVM = 'A larkc1/c6303/viewmodel/EquipmentViewModel.handleUserIntent'
const MORE = 'A larkc1/c6303/ui/setting/controller/MoreSetting6303Activity'
const HB = 'heartbeat 0x6000'
/** "Restart Device" / "This change requires a restart. Continue?" (R restart_device, restart_device_desc). */
export const M3_RESTART_TEXT = 'This change requires a restart. Continue?'

export const M3_NOISE_LEVELS = [
  { value: 1, label: 'Weak' }, // R noise_level_weak, wire 0
  { value: 2, label: 'Medium' }, // R noise_level_mid, wire 1
  { value: 3, label: 'Strong' }, // R noise_level_strong, wire 2
] as const

const noiseEnabled: ControlSpec = {
  id: CONTROL.NOISE_ENABLED, label: 'Noise Cancellation', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
  description: 'Primary RX only; needs at least one TX online.',
  source: `${EQF}.initNoiseData$lambda$39 (voiceOutgoingSwitch, isMicConnected) → ${EQVM} SetNoiseStatus → 0x1003 [0, level, on]; ${HB} byte 12; R mic_noise; I HL6303SettingEntity._denoiseState`,
}

const noiseLevel: ControlSpec = {
  id: CONTROL.NOISE_LEVEL, label: 'Noise Cancellation level', group: 'audio', kind: 'choice', options: M3_NOISE_LEVELS, safety: 'write', readBack: 'status',
  confidence: 'high', description: 'Weak / Medium / Strong (wire 0–2). Shown while NC is on; primary RX only; needs a TX online.',
  source: `${EQF}.initNoiseData$lambda$35–37 (isMaster, isMicConnected) → 0x1003 [0, level 0–2, on]; ${HB} byte 13 (updateNoiseStatus); R noise_level_weak / noise_level_mid / noise_level_strong; I HL6303SettingEntity._denoiseLevel`,
}

/** Phone RX only: 6 segments (A EquipmentFragment.initGainLevel setSegmentCount(6); updateRxType). */
const phoneVolume: ControlSpec = {
  id: CONTROL.VOLUME, label: 'RX volume', group: 'receiver', kind: 'steps', range: { min: 0, max: 5, step: 1, displayOffset: 1 }, safety: 'write',
  readBack: 'status', confidence: 'high', description: 'Phone RX output volume, 6 steps (shown 1–6).',
  source: `${EQF}.setGainLevel(segment) → ${EQVM} SetGainLevel(segment − 1) → 0x100D [0, level 0–5]; ${HB} byte 14 (updateGainLevel(level + 1)); R rx_volume; I HL6303SettingEntity._volumeValue, HL6303RxVolumeView.numOfVolume`,
}

/** Camera RX only: three dB levels set in the "RX volume" dialog (A BottomCameraRxDialog). */
function cameraLevel(i: 0 | 1 | 2): ControlSpec {
  const id = [M3_CONTROL.CAMERA_LEVEL_1, M3_CONTROL.CAMERA_LEVEL_2, M3_CONTROL.CAMERA_LEVEL_3][i]
  const key = ['volume_first_gear', 'volume_two_gear', 'volume_three_gear'][i]
  return {
    id, label: `RX volume Level ${i + 1}`, group: 'receiver', kind: 'range',
    range: { min: M3_CAMERA_GAIN_DB.MIN, max: M3_CAMERA_GAIN_DB.MAX, step: 1, unit: 'dB' }, safety: 'write', readBack: 'get', confidence: 'medium',
    description: 'Camera RX output gain of one level of the receiver\'s volume key, −10…+10 dB. "Note: Level 1 ≤ Level 2 ≤ Level 3": setting one level moves the others to keep that order.',
    source: `${EQF}.initView$lambda$8 → ${EQVM} GetGainLevelDetail → 0x100E [0] → [dev, g1, g2, g3] (wire = dB + 10, A BottomCameraRxDialog.toTextShow / runConstraintCheck); UpdateCameraGain → 0x1010 [0, g1, g2, g3]; R ${key}, rx_volume_desc; I HL6303SheetRxVolumeInputAlertView (minDB, maxDB)`,
  }
}

const channelMode: ControlSpec = {
  id: CONTROL.CHANNEL_MODE, label: 'Channel Mode', group: 'audio', kind: 'choice',
  options: [
    { value: M3_SOUND_MODE.MONO, label: 'Mono' }, // R sound_mode_mono
    { value: M3_SOUND_MODE.STEREO, label: 'Stereo' }, // R sound_mode_stereo
    { value: M3_SOUND_MODE.FOUR_TRACK, label: '4-track' }, // R sound_mode_four
  ],
  // 'write': Mono ↔ Stereo is a plain write. Entering or leaving 4-track restarts the receiver, which M3Device
  // enforces per value (pass { confirm: true }); confirmText is the dialog the app shows then.
  safety: 'write', confirmText: `Switching to or from 4-track: ${M3_RESTART_TEXT}`, readBack: 'status', confidence: 'high',
  description: '4-track is offered in 4TX&4RX only; switching to or from it restarts the receiver (needs confirm).',
  source: `${EQF}.initSoundMode$lambda$28 / 31 / 34 (showSwitchDialog when entering or leaving 4-track; stFourChannels visible if is4t4r) → ${EQVM} SetSoundMode → 0x1005 [0, mode]; ${HB} byte 15 (updateSoundMode); R sound_mode_desc, restart_device_desc; I HL6303SettingEntity._trackMode`,
}

const smartMix: ControlSpec = {
  id: M3_CONTROL.SMART_MIX, label: 'Smart mix', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
  description: 'When enabled, multi-mic input prioritizes the main speaker for clearer dialogue. Only works in Mono mode. 4TX&4RX only; primary RX only.',
  source: `${EQF}.initObserver$lambda$41 → ${EQVM} SetMixEnable → 0x100B [0, on]; ${HB} byte 25; updateMixEnable (ctMixing visible if is4t4r); R mic_mix, mix_sound_tip, support_mono_mode; I HL6303SettingEntity._smartMixSoundState`,
}

const txRecognition: ControlSpec = {
  id: CONTROL.MIC_RECOGNITION, label: 'TX Recognition', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
  description: 'Colour identification of the TXs. Primary RX only.',
  source: `${EQF}.initView$lambda$17 (swColorDifference) → ${EQVM} SetMicLinkKnowLed → 0x600C [on]; ${HB} byte 18; R mic_color_recognition; I HL6303SettingEntity._txColorIdentifierState`,
}

const led: ControlSpec = {
  id: CONTROL.LED, label: 'Indicator Light Switch', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
  description: 'TX indicator lights (true = on; the wire byte is inverted). Primary RX only.',
  source: `${EQF}.initView$lambda$15 → ${EQVM} SetMicLedOff(!checked) → 0x6009 [off]; ${HB} byte 19 (1 = off, updateMicLedOff); R mic_light_switch; I HL6303SettingEntity._indicatorLightState`,
}

/** Camera RX only (A EquipmentFragment.updateHotShoeSwitch). */
const hotShoe: ControlSpec = {
  id: M3_CONTROL.HOT_SHOE_SYNC, label: 'Camera Power On/Off', group: 'receiver', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'medium',
  description: 'Power the camera RX on and off with the camera through the hot shoe.',
  source: `${EQF}.initView$lambda$20 → ${EQVM} SetHotShoeSwitch → 0x6014 [on]; ${HB} byte 24; R hot_shoe_switch_title; I HL6303CommandType.setSyncCameraAutoPowerOff, HL6303SettingEntity._cameraAutoPowerOff`,
}

const mute: ControlSpec = {
  id: CONTROL.MIC_MUTE, label: 'Mute', group: 'mics', kind: 'switch', perUnit: M3_TX_UNITS, safety: 'write', readBack: 'status', confidence: 'high',
  description: 'Per TX; the TX must be online. Primary RX only.',
  source: `${EQF}.initView$1$2.onMuteIconClick (isMaster; A EquipmentMicAdapter: online tiles only) → ${EQVM} SetAudioMute(position + 1) → 0x1001 [txId 1–4, mute]; read back 0x1000 [txId]; ${HB} byte 11 bitmask; R slience; I HL6303SettingTxEntity._muteState`,
}

const playback: ControlSpec = {
  id: CONTROL.SPEAKER, label: 'Playback without unplugging', group: 'settings', kind: 'switch', safety: 'disruptive', confirmText: M3_RESTART_TEXT,
  readBack: 'get', confidence: 'medium', description: 'Restarts the receiver.',
  source: `${MORE}.initView$lambda$4 (showRestartDeviceNoteDialog) → MoreSetting6303ViewModel SetDeviceSoundOut → 0x1007 [0, on]; 0x6011 byte 2 (GetSettingInfoState.soundOut); R sound_card_external; I HL6303MoreSettingView.nonPluggingSwitch, HL6303SettingEntity._nonPluggingSoundOut`,
}

const bitDepth: ControlSpec = {
  id: M3_CONTROL.BIT_DEPTH, label: 'Bit Depth', group: 'settings', kind: 'choice',
  options: [
    { value: M3_SAMPLING.BIT24, label: '24bit' }, // R sample_depth_24bit
    { value: M3_SAMPLING.FLOAT32, label: '32bit float' }, // R sample_depth_32bit
  ],
  safety: 'disruptive', confirmText: M3_RESTART_TEXT, readBack: 'get', confidence: 'medium',
  description: 'Restarts the receiver; primary RX only. Only 24bit is written: 32bit float is refused with "Only supports Apple devices." as in the Android app (iOS offers it; not tested on hardware). Disable internal recording on the RX first.',
  source: `${MORE}.initView$lambda$7 (isMaster, showRestartDeviceNoteDialog) / $lambda$8 (32bit float → toast only_support_apple) → SetDeviceSampling → 0x1009 [0, sampling]; 0x6011 byte 1; R mic_sampling_depth, sample_depth_24bit, sample_depth_32bit, toast_record_status; I HL6303SettingEntity._samplingDepth`,
}

const txLock: ControlSpec = {
  id: M3_CONTROL.TX_BUTTON_LOCK, label: 'TX button lock', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
  description: 'Primary RX only.',
  source: `${MORE}.initView$lambda$12 (isMaster) → SetKeyLock → 0x6005 [lock]; ${HB} byte 26 (MoreSetting6303Activity.initFlow → updateKeyLock(micLockSwitch == 1)); 0x6011 byte 3; R title_sound_mic_lock; I HL6303MoreSettingView.micButtonLockSwitch, HL6303SettingEntity._micLock`,
}

const autoOff: ControlSpec = {
  id: CONTROL.AUTO_OFF, label: 'Auto power off', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
  description: 'Camera RX and TX will automatically power off after 15-min inactivity. Primary RX only.',
  source: `${MORE}.initView$lambda$10 (isMaster) → SetAutoPowerOff → 0x6002 [on]; ${HB} byte 27 (updateAutoPowerOff(micAutoExitSw == 1)); 0x6011 byte 4; R title_mic_auto_exit, title_mic_auto_exit_desc; I HL6303SettingEntity._micAutoPowerOff`,
}

/** Controls of one product, home page first, in the official app's order. */
export function m3Controls(product: ProductInfo): ControlSpec[] {
  const phone = isM3PhoneRx(product)
  return [
    mute,
    noiseEnabled,
    noiseLevel,
    ...(phone ? [phoneVolume] : [cameraLevel(0), cameraLevel(1), cameraLevel(2)]),
    channelMode,
    smartMix,
    txRecognition,
    led,
    ...(phone ? [] : [hotShoe]),
    playback,
    bitDepth,
    txLock,
    autoOff,
  ]
}

/** Superset of every M3 product's controls (FamilyDriver.controls). */
export const M3_ALL_CONTROLS: readonly ControlSpec[] = [
  mute, noiseEnabled, noiseLevel, phoneVolume, cameraLevel(0), cameraLevel(1), cameraLevel(2), channelMode, smartMix, txRecognition, led, hotShoe,
  playback, bitDepth, txLock, autoOff,
]
