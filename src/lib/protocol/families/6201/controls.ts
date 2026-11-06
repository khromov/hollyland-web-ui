/**
 * MELO P1 controls (FAMILIES.md §4.2 row 6201, subset): More Settings, the mixer's track faders and output
 * volumes, LED, work mode. Labels are Android R strings (values/strings.xml of HollyAudio 3.1.0); A paths are
 * relative to com/hollyland/ (melo-6201.md §5.3, §6).
 *
 * Read paths (ControlSpec.readBack, held to check 10 of the conformance suite):
 *  - 'get'    the GET the official app sends for the value, sent at start-up (protocol.ts meloStartupReads())
 *  - 'status' the 3 s heartbeat 0x600B (only the two bit depths: A MoreSettingActivity reads them there)
 * No control is write-only. Effects, presets, wireless monitoring (0x112A, restarts the RX), USB stream routing
 * (0x1306) and the remote mappings are catalogued in commands.ts but not offered (FAMILIES.md W10).
 */
import type { ControlSpec } from '../../core/types'
import { MELO_CONTROL } from './ids'

export { MELO_CONTROL } from './ids'

const MS = 'A larkc1/c6201/ui/setting/MoreSettingActivity'
const MIXER = 'A larkc1/c6201/widget/view/HLVolumeListView; R layout/layout_volume_list.xml'

export const MELO_CONTROLS: readonly ControlSpec[] = [
  // ---- More Settings
  {
    id: MELO_CONTROL.NC_ENABLED, label: 'Noise Cancellation Toggle', group: 'audio', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x1300 [on, level] / 0x1301 (A CmdSetNoiseLevel6201 / CmdGetNoiseLevel6201); R setting_mic_noise_switch; ${MS}.setMicNoiseReduction (needs a mic online: R toast_device_offline); I sendSetNoiseReduction:value: @0x10023dbbc`,
  },
  {
    id: MELO_CONTROL.NC_DEPTH, label: 'Noise Cancellation Settings', group: 'audio', kind: 'range', range: { min: 5, max: 25, step: 1, unit: 'dB' },
    safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x1300 / 0x1301 byte 1; ${MS}: NoviceUpdateReverbValueDialog.setMinAndMaxValue(5, 25, 1), refused while NC is off (R toast_mic_noise_reduc_switch_close "Please turn on noise cancellation")`,
    description: 'Value meaning (dB of suppression) taken from the slider; not confirmed on hardware.',
  },
  {
    id: MELO_CONTROL.NOISE_GATE_ENABLED, label: 'Noise Gate Toggle', group: 'audio', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x1142 / 0x1143 [02 00] (A CmdSetAudioNoiseGateParam6201 / CmdGetAudioNoiseGateParam6201); R setting_threshold_switch; ${MS}.updateVersionBasedUI (hidden from RX 4.0.0.1), setNoiseGateEvent$canOperateNoiseGate (needs the 3.5 mm jack plugged and set to input)`,
    description: 'Applies to the instrument input (stream type 2).',
  },
  {
    id: MELO_CONTROL.NOISE_GATE_THRESHOLD, label: 'Threshold Settings', group: 'audio', kind: 'range', range: { min: -80, max: -55, step: 1, unit: 'dB' },
    safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x1142 / 0x1143 f32 threshold; R setting_threshold; ${MS}.setNoiseGateEvent$lambda$37: refused while the gate is off (R toast_noise_gate_switch_close "Please turn on the noise gate"), then NoviceUpdateReverbValueDialog.setMinAndMaxValue(-80, -55, 1)`,
  },
  {
    id: MELO_CONTROL.MIC_GAIN_PRESET, label: 'Mic Gain', group: 'mics', kind: 'choice',
    options: [{ value: 20, label: 'Near' }, { value: 26, label: 'Mid' }, { value: 32, label: 'Far' }],
    safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x1312 / 0x1313 i32 (A CmdSetMicGainSup6201 / CmdGetMicGainSup6201, DeviceControlConstant.MicGain 20/26/32); R title_mic_gainsup, setting_mic_gain_near/middle/far; ${MS}: near → GAIN_SUP_20_DB, mid → 26, far → 32; RX firmware < 3.0.7.9 (resolveNewFirmwareVersion)`,
  },
  {
    id: MELO_CONTROL.MIC_GAIN, label: 'Mic Gain', group: 'mics', kind: 'range', range: { min: 20, max: 32, step: 1, unit: 'dB' }, perUnit: ['tx1', 'tx2'],
    safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x1319 / 0x131A 2 × i32 (A CmdSetIndependentTxGain6201 / CmdGetIndependentTxGain6201); R title_mic1_gainsup / title_mic2_gainsup; ${MS}.setupIndependentMicGainSeekbar: slider 1..13 = gain − 19; row shown only while that mic is online (updateMicOnlineVisibility); RX firmware >= 3.0.7.9; I isNewFirmwareForIndependentGain @0x10023c430`,
  },
  {
    id: MELO_CONTROL.MIC_BIT_DEPTH, label: 'Mic Bit Depth', group: 'mics', kind: 'choice', options: [{ value: 0, label: '24-bit' }, { value: 1, label: '32-bit' }],
    safety: 'disruptive', confirmText: 'Changing the sample depth will restart the device.', readBack: 'status', confidence: 'medium',
    source: `0x1304 [tx1, tx2, rxMaster, rxSlave] (A CmdSetSampleDepth6201, HLAudioUACBitEntity; the page sets tx1 = tx2), read from heartbeat byte 8 mic1SamDepth (${MS} HeartInfoState → updateMicGainView); R title_mic_sampling_depth, reboot_device_switch_sample_bit; needs a mic online (setSampleDepthEvent micSample24Btn / micSample32Btn: R toast_device_offline). rxSlave: as iOS (the 0x1305 struct read at start-up), not Android's 0`,
  },
  {
    id: MELO_CONTROL.OUTPUT_BIT_DEPTH, label: 'Output Bit Depth', group: 'settings', kind: 'choice', options: [{ value: 0, label: '24-bit' }, { value: 1, label: '32-bit' }],
    safety: 'disruptive', confirmText: 'Changing the sample depth will restart the device.', readBack: 'status', confidence: 'medium',
    source: `0x1304 byte 2 rxMUacBit, read from heartbeat byte 14 rxSamDepth (${MS} HeartInfoState → updateRXSampleView); R title_sound_card_sample_depth, reboot_device_switch_sample_bit; no mic-online check (setSampleDepthEvent soundCardSample24Btn / soundCardSample32Btn → showSampleBitRebootDeviceDialog directly). rxSlave = the new depth, as I HLFunctionSetView (setRxSUacBit:(rxMUacBit) @0x1001dbc98); A sends 0`,
  },
  {
    id: MELO_CONTROL.AUTO_SPEAKER, label: 'Smart audio mixer Auto Speaker Output', group: 'settings', kind: 'switch',
    safety: 'disruptive', confirmText: 'Switching to Smart Audio Mixer output will restart the device.', readBack: 'get', confidence: 'medium',
    source: `0x1310 / 0x1311 i32 1 = on (A CmdSetNotPlugPlay6201 / CmdGetNotPlugPlay6201); R title_sound_card_external, switching_to_external_and_restart_device; ${MS}.setExternalSwitchEvent (DialogShowingManager.showExternalSwitchDialog)`,
  },
  {
    id: MELO_CONTROL.JACK_MODE, label: '3.5mm Jack I/O Mode', group: 'settings', kind: 'choice', options: [{ value: 0, label: 'Input' }, { value: 1, label: 'Output' }],
    safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x1302 / 0x1303 i32 (A CmdSet35PortDirection6201 / CmdGet35PortDirection6201, DeviceControlConstant.Audio35PortDirection INPUT 0 / OUTPUT 1); ${MS}.set35mmPortEvent: page opens only with something plugged in (R instrument_plug_in_35mm_set_input)`,
  },
  {
    id: MELO_CONTROL.LED, label: 'LED Settings', group: 'settings', kind: 'switch', perUnit: ['rx', 'tx1', 'tx2'], safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x2000 [switch, ledDeviceType, brightness] / 0x3004 (A CmdSetLed6201 / CmdGetLed6201, LedDeviceType SOUND_CARD 0 / TX_ONE 1 / TX_TWO 2); R title_light_set; A larkc1/c6201/ui/setting/LightSettingActivity (mic rows follow the mic's online state); I sendLEDWithType:isOpen:value: @0x10023c58c`,
  },
  {
    id: MELO_CONTROL.LED_BRIGHTNESS, label: 'LED brightness', group: 'settings', kind: 'choice', perUnit: ['rx', 'tx1', 'tx2'],
    options: [{ value: 0, label: '0 %' }, { value: 1, label: '50 %' }, { value: 2, label: '100 %' }],
    safety: 'write', readBack: 'get', confidence: 'medium',
    source: 'A DeviceControlConstant.LedStatus ZERO 0 / FIFTY 1 / ONE_HUNDRED 2; A LightSettingActivity sends switch = true, with the brightness tabs shown only while the switch is on (larkc1/c6201/widget/view/HISeekbarItemView.updateSeekBarVisibility); I -[HLLightSetViewController soundView] @0x100061690 sends the current isOpen (+[HL6201Messenger sendLEDWithType:isOpen:value:] @0x10023c5cc)',
  },
  {
    id: MELO_CONTROL.WORK_MODE, label: 'Scenario', group: 'audio', kind: 'choice',
    options: [{ value: 0, label: 'Chat' }, { value: 1, label: 'Sing' }, { value: 2, label: 'Inst. & Vocal' }],
    safety: 'write', readBack: 'get', confidence: 'medium',
    source: '0x1154 / 0x1155 i32 (A CmdSetWorkMode6201 / CmdGetWorkMode6201, larkc1/c6201/data/mapper/MusicStyleMapper.workModeOfScenario chat 0 / karaoke 1 / instrument creation 2); R tab_voice_chat, tab_karaoke, tab_instrument_creation; I sendSetAppWorkMode: @0x10023d2fc clamps 0..2',
  },

  // ---- Mixer: input tracks (0x130A / 0x130B)
  {
    id: MELO_CONTROL.MIC_VOLUME, label: 'Mic', group: 'mics', kind: 'steps', range: { min: 0, max: 24, step: 1 }, perUnit: ['tx1', 'tx2'],
    safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x130A / 0x130B trackVol[0] / [1] (A CmdSetAudioStreamIn6201 / CmdGetAudioStreamIn6201); ${MIXER} mic_one / mic_two_volume_item 0..24 (default 12); R track_mic1_name`,
  },
  {
    id: MELO_CONTROL.MIC_MUTE, label: 'Mute', group: 'mics', kind: 'switch', perUnit: ['tx1', 'tx2'], safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x130A / 0x130B trackMute[0] / [1], 1 = muted (A DeviceControlConstant.TrackStreamInMuteStatus OPEN); ${MIXER}.setVolumeInMic*VolumeAndMute`,
  },
  {
    id: MELO_CONTROL.INSTRUMENT_VOLUME, label: 'Instr', group: 'audio', kind: 'steps', range: { min: 0, max: 24, step: 1 }, safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x130A / 0x130B trackVol[2]; ${MIXER} instrument_volume_item 0..24 (default 12); R volume_instrument_tab`,
  },
  {
    id: MELO_CONTROL.INSTRUMENT_MUTE, label: 'Instr mute', group: 'audio', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x130A / 0x130B trackMute[2]; ${MIXER}`,
  },
  {
    id: MELO_CONTROL.BGM_VOLUME, label: 'BGM', group: 'audio', kind: 'steps', range: { min: 0, max: 16, step: 1 }, safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x130A / 0x130B trackVol[3]; ${MIXER} accompaniment_volume_item 0..16 (default 8); R volume_accompaniment`,
  },
  {
    id: MELO_CONTROL.BGM_MUTE, label: 'BGM mute', group: 'audio', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x130A / 0x130B trackMute[3]; ${MIXER}`,
  },

  // ---- Mixer: outputs (0x1308 / 0x1309)
  {
    id: MELO_CONTROL.WIRELESS_OUT_VOLUME, label: 'Mon (2.4G)', group: 'monitoring', kind: 'steps', range: { min: 0, max: 40, step: 1 }, safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x1308 / 0x1309 owsVol (A CmdSetAudioStreamOut6201 / CmdGetAudioStreamOut6201, HLAudioOutVoiceEntity); ${MIXER} ows_earphone_volume_item 0..40; R volume_wireless_monitoring`,
  },
  {
    id: MELO_CONTROL.WIRELESS_OUT_MUTE, label: 'Mon (2.4G) mute', group: 'monitoring', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x1308 / 0x1309 owsMute, 1 = muted (A DeviceControlConstant.TrackStreamOutMuteStatus MUTE); ${MIXER}.updateTrackOutVolumeAndMute`,
  },
  {
    id: MELO_CONTROL.WIRED_OUT_VOLUME, label: 'Wired Monitoring', group: 'monitoring', kind: 'steps', range: { min: 0, max: 40, step: 1 }, safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x1308 / 0x1309 conn35OutVol; ${MIXER} wired_monitor_volume_item 0..40; R volume_wired_monitoring`,
  },
  {
    id: MELO_CONTROL.WIRED_OUT_MUTE, label: 'Wired Monitoring mute', group: 'monitoring', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x1308 / 0x1309 conn35OutMute; ${MIXER}`,
  },
  {
    id: MELO_CONTROL.USB_OUT_VOLUME, label: 'USB', group: 'monitoring', kind: 'steps', range: { min: 0, max: 40, step: 1 }, safety: 'write', readBack: 'get', confidence: 'medium',
    source: `0x1308 / 0x1309 uacUpstreamVol; ${MIXER} otg_output_volume_item 0..40; R volume_usb_output`,
  },
  {
    id: MELO_CONTROL.USB_OUT_MUTE, label: 'USB mute', group: 'monitoring', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'high',
    source: `0x1308 / 0x1309 uacUpstreamMute; ${MIXER}`,
  },
]
