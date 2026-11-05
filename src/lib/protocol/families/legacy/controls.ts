/**
 * ControlSpecs for the legacy `AA DD` families (6118 / 6301 / 6302 / 6501), derived
 * from the product's static capabilities (models.ts). Firmware gates and the apps' preconditions
 * are reported per state in MicState.availability (adapter.ts), not here.
 *
 * Labels: Android `res/values/strings.xml` (R key in each `source`).
 */
import type { Capabilities, ProductInfo } from '../../models'
import { CONTROL } from '../../core/controls'
import type { ControlOption, ControlSpec } from '../../core/types'

const NOISE_6118: readonly ControlOption[] = [
  { value: 1, label: 'Weak' }, // R noise_level_weak
  { value: 2, label: 'Medium' }, // R noise_level_mid
  { value: 3, label: 'Strong' }, // R noise_level_strong
]
const NOISE_M2: readonly ControlOption[] = [
  { value: 1, label: 'Weak' }, // R device_noise_level_low ("Weak"), Pro_set_noise 1
  { value: 2, label: 'Strong' }, // R device_noise_level_strong, Pro_set_noise 2
]
const CHANNEL: Readonly<Record<number, string>> = {
  0: 'Mono', // R sound_mode_mono
  1: 'Stereo', // R sound_mode_stereo
  2: 'SafeTr', // R c6118_safe_track (safety track)
}
const PRESETS: readonly ControlOption[] = [
  { value: 0, label: 'Bright' }, // R c6118_preset_btn1
  { value: 1, label: 'Low' }, // R c6118_preset_btn2
  { value: 2, label: 'Balance' }, // R c6118_preset_btn3
]

/**
 * 6501 group (Lark C1 / C1 2nd gen / M1 2nd gen / Mini): the controls of A larkc1/HLDeviceActivity +
 * res/layout/activity_hldevice.xml that these PIDs show (legacy-6501.md §6). No NC switch, volume lock,
 * channel mode, auto-off, LED or custom buttons. Labels are the layout's R strings.
 */
function controls6501(caps: Capabilities): ControlSpec[] {
  // Lark C1 (PID 1): NC level and volume are read with 0x11 / 0x04, the heartbeat carries neither.
  const viaGet = caps.heartbeatSettings === false
  const map = caps.volumeWireValues
  const out: ControlSpec[] = []
  if (caps.noiseMaxLevel > 0) {
    out.push({
      id: CONTROL.NOISE_LEVEL, label: 'NC Level', group: 'audio', kind: 'choice', options: NOISE_M2, safety: 'write',
      readBack: viaGet ? 'get' : 'status', confidence: 'high',
      description: caps.noiseLevelNeedsNcOn === false
        ? 'Weak / Strong. Read with 0x11; offered while NC is off, as iOS does for this model.'
        : 'Weak / Strong. Refused while NC is off on the receiver (the official app has no NC switch for this model).',
      source:
        'A larkc1/HLDeviceActivity.onClick strong_level / low_level → usbmic/protocol/Pro_set_noise.saveReserved({2|1}) (0x06), ' +
        'onEvent cmd 17 (0x11) + cmd 16 (`productId != 1`); I sendSetDeviceNoiseLevel: @0x10008b460, noiseView block @0x1000cf438; ' +
        'R device_noise_level, device_noise_level_low, device_noise_level_strong',
    })
  }
  if (caps.volumeSteps > 0) {
    out.push({
      id: CONTROL.VOLUME, label: 'Volume', group: 'receiver', kind: 'steps',
      range: { min: 0, max: caps.volumeSteps - 1, step: 1, displayOffset: 1 }, safety: 'write', readBack: viaGet ? 'get' : 'status',
      // Android 6 buttons vs iOS 3 (as on the M2); the Lark C1 wire map has no documented meaning.
      confidence: map ? 'low' : 'medium',
      description: map
        ? `Buttons 1–${map.length} are sent as ${map.join(', ')} on the wire (DeviceCompat.getVoiceLevels(1)); the dB meaning is not documented. Allowed with no mic online.`
        : 'Six buttons as in the Android app (iOS offers three, 0..2).',
      source:
        'A larkc1/HLDeviceActivity.onClickBtnGroup (sends the button tag, 0x05), updateVoiceGroup + application/common/compatibility/DeviceCompat.getVoiceLevels, ' +
        'isAllowSetVoice, onEvent cmd 4 / cmd 16 (`productId >= 8`); I sendSetDeviceVoliceLevel: @0x10008b56c, HLLarkM2View voiceView @0x1000cf8c4; R volume',
    })
  }
  if (caps.speakerPassthrough) {
    out.push({
      id: CONTROL.SPEAKER, label: 'Phone Speaker', group: 'settings', kind: 'switch', safety: 'write', readBack: 'get', confidence: 'high',
      description: 'Takes effect after the receiver restarts (the Android app restarts it 3 s after a successful set).',
      source:
        'A larkc1/HLDeviceActivity.onCreate voice_outgoing_switch listener (0x12, !z ? 1 : 0), onEvent cmd 19 (0x13), mVoiceRunable (0x0C after 3 s); ' +
        'I sendSetDeviceVoiceOutStatus: @0x10008b5fc; R voice_outgoing_msg2, device_restart_success_msg',
    })
  }
  if (caps.restartRx) {
    out.push({
      id: CONTROL.RESTART_RX, label: 'Restart Device', group: 'advanced', kind: 'action', safety: 'disruptive', readBack: 'none',
      confirmText: 'The receiver restarts; it disconnects for a few seconds.', confidence: 'high',
      description: 'The official app sends it only after a Phone Speaker change.',
      source: 'A usbmic/protocol/Pro_set_restart (0x0C), larkc1/HLDeviceActivity.mVoiceRunable; I sendRestartRxDevice @0x10008b1f4; R restart_device',
    })
  }
  return out
}

/** Every control a legacy product may offer, from its static capabilities (superset of the runtime feature set). */
export function legacyControls(product: ProductInfo): ControlSpec[] {
  const caps: Capabilities | null = product.capabilities
  if (!caps) return []
  if (product.family === '6501') return controls6501(caps)
  const a2 = product.family === '6118'
  const out: ControlSpec[] = []
  if (caps.noiseToggle) {
    out.push({
      id: CONTROL.NOISE_ENABLED, label: 'Noise Cancellation', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status',
      confidence: 'high',
      description: 'The firmware only toggles (0x19 [02]); the state is read back from the heartbeat. Never sent blind.',
      source: 'A device6118/CmdSetNoiseSwitch6118, usbmic/protocol/Pro_set_noise_status; I codec @0x10011b9fc case 0x19; R c6118_noise_reduction_msg',
    })
  }
  if (caps.noiseMaxLevel > 0) {
    out.push({
      id: CONTROL.NOISE_LEVEL, label: 'Noise Cancellation level', group: 'audio', kind: 'choice', options: a2 ? NOISE_6118 : NOISE_M2,
      safety: 'write', readBack: 'status', confidence: 'high',
      source: 'A device6118/CmdSetNoiseLevel6118, usbmic/protocol/Pro_set_noise; I sendSetDeviceNoiseLevel: @0x10008b460',
    })
  }
  if (caps.volumeSteps > 0) {
    out.push({
      id: CONTROL.VOLUME, label: 'RX volume', group: 'receiver', kind: 'steps',
      range: { min: 0, max: caps.volumeSteps - 1, step: 1, displayOffset: 1 }, safety: 'write', readBack: 'status',
      // M2/M2S: Android 6 buttons vs iOS 3 (PROTOCOL.md §12 #33).
      confidence: a2 ? 'high' : 'medium',
      source: 'A device6118/CmdSetVoiceLevel6118, C6118DeviceActivityKt.homeRxVolumeStepCount, DeviceCompat.getVoiceLevels; I sendSetDeviceVoliceLevel: @0x10008b56c; R c6118_rx_volume',
    })
  }
  if (caps.channelModes.length > 0) {
    out.push({
      id: CONTROL.CHANNEL_MODE, label: 'Channel Mode', group: 'audio', kind: 'choice',
      options: caps.channelModes.map((m) => ({ value: m, label: CHANNEL[m] ?? `Mode ${m}` })),
      safety: 'write', readBack: 'status', confidence: 'high',
      source: 'A device6118/CmdSetVoiceMode6118, C6118DeviceActivity.setupVoiceModeActions; I codec case 0x18; R sound_mode_desc',
    })
  }
  if (caps.voicePreset) {
    out.push(
      {
        id: CONTROL.PRESET_ENABLED, label: 'Bel canto preset', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status',
        confidence: 'high', source: 'A device6118/CmdSetBeautyVoice6118 [enable, preset]; I closures @0x100669f60 / @0x10066a298; R c6118_preset_title',
      },
      {
        id: CONTROL.PRESET_STYLE, label: 'Bel canto preset style', group: 'audio', kind: 'choice', options: PRESETS, safety: 'write',
        readBack: 'status', confidence: 'high', source: 'A device6118/CmdSetBeautyVoice6118; R c6118_preset_btn1..3',
      },
    )
  }
  if (caps.led) {
    out.push({
      id: CONTROL.LED, label: 'Indicator Light Switch', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status',
      confidence: 'high', source: 'A device6118/CmdSetLight6118 (0 = on); I codec case 0x39 ([!isOn]); R light_switch',
    })
  }
  if (caps.autoPowerOff) {
    out.push({
      id: CONTROL.AUTO_OFF, label: 'Mic auto power-off', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status',
      confidence: 'high', description: 'Shut down after 15 minutes of inactivity',
      source: 'A device6118/CmdSetShutdownTime6118, usbmic/protocol/Pro_set_shutdown_time (0 = 15 min, 1 = never); I codec case 0x36; R c6118_title_mic_auto_shutdown',
    })
  }
  if (caps.micRecognition) {
    out.push({
      id: CONTROL.MIC_RECOGNITION, label: 'Mic Recognition', group: 'settings', kind: 'switch', safety: 'write', readBack: 'get',
      confidence: 'high', source: 'A device6118/CmdSetTxIdentify6118; I codec case 0x3B; R title_tx_identify',
    })
  }
  if (caps.smartBattery) {
    out.push({
      id: CONTROL.SMART_BATTERY, label: 'Smart battery life', group: 'settings', kind: 'switch', safety: 'write', readBack: 'get',
      confidence: 'high', source: 'A device6118/CmdSetSmartBattery6118 (0x3D), MoreSetting6118ActivityKt.shouldShowSmartBatteryItem (1041 only); I codec case 0x3D; R c6118_title_smart_battery_life',
    })
  }
  if (caps.speakerPassthrough) {
    out.push({
      id: CONTROL.SPEAKER, label: 'External speaker without unplugging', group: 'settings', kind: 'switch', safety: 'write', readBack: 'get',
      confidence: 'high', description: 'Takes effect after the receiver restarts (the Android app restarts it 3 s later).',
      source: 'A device6118/CmdSetSpeaker6118 (0x12, 0 = on), MoreSetting6118ViewModel.startSpeakerRestartCountdown; I sendSetDeviceVoiceOutStatus: @0x10008b5fc; R c6118_title_free_plug_speaker',
    })
  }
  if (caps.voiceLock) {
    out.push({
      id: CONTROL.VOLUME_LOCK, label: 'Volume lock', group: 'receiver', kind: 'switch', safety: 'write', readBack: 'status',
      confidence: 'medium', source: 'A usbmic/protocol/Pro_set_voice_lock (0x34), HLDeviceActivity.setVoiceLockVisibility; I codec case 0x34; R device_voice_locked',
    })
  }
  if (caps.restartRx) {
    out.push({
      id: CONTROL.RESTART_RX, label: 'Restart Device', group: 'advanced', kind: 'action', safety: 'disruptive', readBack: 'none',
      confirmText: 'The receiver restarts; it disconnects for a few seconds.', confidence: 'high',
      source: 'A device6118/CmdRestartRx6118, usbmic/protocol/Pro_set_restart (0x0C); I sendRestartRxDevice @0x10008b1f4; R restart_device',
    })
  }
  if (caps.removePairing) {
    out.push({
      id: CONTROL.REMOVE_PAIRING, label: 'Remove Pairing', group: 'advanced', kind: 'action', perUnit: ['tx1', 'tx2'], safety: 'destructive',
      readBack: 'status', confirmText: 'This device will need to be paired again after deletion.', confidence: 'high',
      source: 'A device6118/CmdDeletePair6118, C6118PairDeviceViewModel (0x3F); I deleteDevicePairWithType: @0x10008b820; R c6118_device_del_pair',
    })
  }
  if (caps.factoryReset) {
    out.push({
      id: CONTROL.FACTORY_RESET, label: 'Factory Reset', group: 'advanced', kind: 'action', safety: 'destructive', readBack: 'none',
      confirmText: 'Factory reset will erase some data.', confidence: 'high',
      source: 'A device6118/CmdFactoryReset6118, MoreSetting6118ViewModel (0x40); I sendRestoreFactoryReset @0x10008b8b0; R c6118_title_factory_reset',
    })
  }
  return out
}
