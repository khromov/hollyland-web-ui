/**
 * LARK MAX 2 controls (official app labels from Android R strings), which product offers which, and their firmware
 * gates and preconditions. docs/research/families/max2-6701.md §5, §6; FAMILIES.md §3.8 row 6701, §4.2.
 *
 * Read paths (`readBack`, conformance check 10):
 *  - 'status'  the heartbeat 0x600B (USB poll; BLE: the iOS poll to target 2) AND the "get all" batch at start-up
 *              (A BleMicCmd.getMicBoxAllInfo) or a start-up GET, so the value is known after connect on both links
 *  - 'get'     only a GET carries it (USB Output 0x8044, monitoring volume 0x6019)
 *
 * Per product (A HLBleDeviceActivity.initView / updateFourMicOneRxState visibility, productId 1026 / 1027 / 101):
 *  - Timecode page: not on the mobile RX 1026 (clTimeCodeSet: productId != 1026)
 *  - Mic Recognition: USB only (txIdentifyView: is6701UsbDevice)
 *  - 4 Mic & 1 RX: USB, RX ≥ 3.0.0.50 (cl4mic1rx: is6701UsbDevice && isNew6701USBDevice)
 *  - RX Pairing Mode: mobile RX 1026, RX ≥ 3.0.0.50 (clRxPair)
 *  - Wireless Monitoring (+ OWS page): mobile RX 1026, 2 Mic & 1 RX mode, RX ≥ 3.0.0.50 (clWirelessMonitor)
 */
import { controlKey, versionGate } from '../../core/controls'
import type { ControlAvailability, ControlSpec, MicState, UnitId } from '../../core/types'
import type { ProductInfo } from '../../models'
import {
  MAX2_FPS_LABELS, MAX2_GAIN_MAX, MAX2_GAIN_OFFSET_DB, MAX2_NC_DEPTH_MAX, MAX2_NC_DEPTH_OFFSET_DB, MAX2_SPEC_VERSION_USB,
} from './commands'
import { MAX2_CONTROL, MAX2_TC_RESET_TEXT, isMax2Mobile } from './ids'

export {
  MAX2_CONTROL, MAX2_TC_RESET_TEXT, MAX2_VALUE, isMax2Box, isMax2Camera, isMax2Mobile, max2ChannelRefusal,
} from './ids'

export const MAX2_MIC_UNITS: readonly UnitId[] = ['tx1', 'tx2', 'tx3', 'tx4']

const A = 'A blemic/device/HLBleDeviceActivity'
const RESTART = 'The receiver restarts.'

/** Every MAX 2 control (the superset; max2Controls(product) filters per product). */
export const MAX2_CONTROLS: readonly ControlSpec[] = [
  {
    id: MAX2_CONTROL.SPEAKER, label: 'Phone Speaker', group: 'receiver', kind: 'switch', safety: 'disruptive',
    confirmText: `Settings successful. The device will restart in a few seconds. ${RESTART}`, readBack: 'status', confidence: 'high',
    source: `${A} voiceOutgoingSwitch → SetRxOutSwitchIntent; RxOutSwitchState type 2 → CountDownDialog (R voice_outgoing_text, device_restart_success_msg); heartbeat byte 8 / get-all 0x6003`,
  },
  {
    id: MAX2_CONTROL.BIT_DEPTH, label: 'Internal Recording Depth', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [{ value: 0, label: '32bit float' }, { value: 1, label: '24bit' }],
    source: `${A} sample32Btn / sample24Btn → SetRxSamplingIntent (DeviceConnectVariable.RxSamplingType 32-bit 0, 24-bit 1; R internal_sample_depth); refused while TX recording (R toast_record_status); heartbeat byte 9 / get-all 0x6004`,
  },
  {
    id: MAX2_CONTROL.USB_OUTPUT, label: 'USB Output', group: 'audio', kind: 'choice', safety: 'disruptive', readBack: 'get', confidence: 'medium',
    options: [{ value: 0, label: '24bit' }, { value: 1, label: '32bit float' }],
    confirmText: `Changing the sample depth will restart the device. ${RESTART}`,
    description: 'The Android app only ever sends 24bit; 32bit float shows "Only supports Apple devices." Changing it restarts the receiver (iOS).',
    source: `${A} usbSampleBtn → GetUacModeIntent (0x8044); sample24Btn → SetUacModeIntent(0) (0x8043); sample32Btn on USB Output → R toast_ios_device_supported; updateUacModeState(mode == 0 → 24bit). Disruptive from iOS: -[HLLarkMAX2View changeUSBRecordWithIndex:] @0x1000108fc confirms with "切换采样深度将重启设备，确认继续？" (en "Changing the sample depth will restart the device. Continue?", +[HLCommonUtils showSampleSetDialogWithTitle:cancelBlock:confirm:]) before 0x8043 [1 − index], and -[HLBleDeviceController showConfigSuccess:cmd:] @0x100246f5c shows "Settings applied successfully. The device will automatically restart." after the ack`,
  },
  {
    id: MAX2_CONTROL.MIC_LOCK, label: 'Lock Mic', group: 'mics', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
    source: `${A} lockMicSwitch → SetMicLockIntent (R lock_mic_msg); heartbeat byte 10 / get-all 0x6005`,
  },
  {
    id: MAX2_CONTROL.NOISE_ENABLED, label: 'NC', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
    source: `${A} noiseSwitch → SetNoiseLevelIntent(on, progressbarNoise); refused without a mic online (isAllowSet, R mic_offline_tip); heartbeat byte 11 / get-all 0x6006`,
  },
  {
    id: MAX2_CONTROL.NOISE_DEPTH, label: 'NC', group: 'audio', kind: 'range', safety: 'write', readBack: 'status', confidence: 'high',
    range: { min: 0, max: MAX2_NC_DEPTH_MAX, step: 1, unit: 'dB', displayOffset: MAX2_NC_DEPTH_OFFSET_DB },
    description: 'Noise reduction depth (shown 5–25 dB)',
    source: `${A}$initView$1$8 progressbarNoise.onStopTrackingTouch → SetNoiseLevelIntent(true, progress), no mic-online check (isAllowSet guards the switch only); noiseLevelView visible only while NC is on; heartbeat byte 12 / get-all 0x6006 [on, depth]`,
  },
  {
    id: MAX2_CONTROL.GAIN_TYPE, label: 'Dynamic Gain', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [{ value: 0, label: 'Set gain to' }, { value: 1, label: 'Dynamic Gain' }],
    source: `${A} gainStrong/Medium/Weak (DYNAMIC_GAIN) vs progressbarGainMic* (CUSTOM_GAIN) → SetVoiceGainIntent (DeviceConnectVariable.VoiceGainType); heartbeat byte 13 / get-all 0x6007[0]`,
  },
  {
    id: MAX2_CONTROL.GAIN_DYNAMIC, label: 'Dynamic Gain', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [{ value: 0, label: 'High' }, { value: 1, label: 'Medium' }, { value: 2, label: 'Low' }],
    source: `${A} initView lambdas 9–11: SetVoiceGainIntent(DYNAMIC_GAIN, STRONG/MEDIUM/WEAK_GAIN) (R dynamic_gain_strong/medium/weak); heartbeat byte 14 / get-all 0x6007[1]`,
  },
  {
    id: MAX2_CONTROL.MIC_GAIN, label: 'Set gain to', group: 'mics', kind: 'range', safety: 'write', readBack: 'status', confidence: 'high',
    range: { min: 0, max: MAX2_GAIN_MAX, step: 1, unit: 'dB', displayOffset: MAX2_GAIN_OFFSET_DB }, perUnit: MAX2_MIC_UNITS,
    source: `${A} progressbarGainMic1..4.onStopTrackingTouch → SetVoiceGainIntent(CUSTOM_GAIN, STRONG_GAIN.level, g1..g4) (R custom_gain; getSignedString = value − 20); heartbeat bytes 15/16, 37/38 / get-all 0x6007[2..5]`,
  },
  {
    id: MAX2_CONTROL.CHANNEL_MODE, label: 'Channel Mode', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [{ value: 0, label: 'Mono' }, { value: 1, label: 'Stereo' }, { value: 2, label: 'Secure audio track' }],
    source: `${A} initView lambdas 12–14 (R vocal_tract, mono, stereo, secure_audio_track): stereo/safety refused while TC is on in Mode 1/2 except on 1026 (toast_unavailable_stereo / _audio_track); safety only on 101 (toast_voice_mode); heartbeat byte 17 / get-all 0x6008`,
  },
  {
    id: MAX2_CONTROL.TC_ENABLED, label: 'Timecode switch', group: 'timecode', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
    source: 'A blemic/device/TimeCodeActivity switch → SetTcSwitchIntent (R title_time_code_switch); heartbeat byte 29 / get-all 0x6015',
  },
  {
    id: MAX2_CONTROL.TC_MODE, label: 'Timecode Mode', group: 'timecode', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [{ value: 0, label: 'Mode 1' }, { value: 1, label: 'Mode 2' }, { value: 2, label: 'Mode 3' }],
    source: 'A TimeCodeActivity initView lambdas 3–5 → SetTcModeIntent(TcMode.MODE_ONE..THREE) (R time_code_mode_one..three); heartbeat byte 20 / get-all 0x600E',
  },
  {
    id: MAX2_CONTROL.TC_FPS, label: 'Timecode Frame Rate', group: 'timecode', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: MAX2_FPS_LABELS.map((label, value) => ({ value, label })),
    source: 'A TimeCodeActivity initView lambdas 6–14 → SetInputFpsIntent(InputFps.FPS_23..FPS_60) (R layout/activity_time_code.xml tv_fps_*); heartbeat byte 21; GET 0x600F on the TC page',
  },
  {
    id: MAX2_CONTROL.TC_TIMING, label: 'Timing Method', group: 'timecode', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [{ value: 0, label: 'Count From Zero' }, { value: 1, label: 'Real-time Timing' }, { value: 2, label: 'Reset' }],
    // 'write': choosing a method is a plain write. Reset (2) is sent only after a confirm dialog, which Max2Device
    // enforces per value (pass { confirm: true }); confirmText is that dialog.
    confirmText: MAX2_TC_RESET_TEXT,
    description: 'Reset (2) needs confirm and is offered in Count From Zero only (the Reset row is hidden in Real-time Timing).',
    source: 'A TimeCodeActivity initView lambdas 15/16 → SetTimingIntent(FROM_ZERO / REAL_TIME); the Reset row (lambda 17, clReset visible only while timingMode == FROM_ZERO: updateTimingModeView) → TimeCodeActivity$initView$1$17$1: `if (confirmReset()) dispatch(SetTimingIntent(RESET))`; confirmReset = BaseDialog R title_reset / msg_reset ("After reset, timecode will be 00:00:00:00 and new recording will start.") with dialog_cancel / dialog_confirm (R from_zero_method, real_time_method, reset); heartbeat byte 22; GET 0x6010',
  },
  {
    id: MAX2_CONTROL.MIC_RECOGNITION, label: 'Mic Recognition', group: 'mics', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
    source: `${A} txIdentifySwitch → SetTxIdentifyIntent (R title_tx_identify; USB only); heartbeat byte 28; GET 0x6013 at start-up (HLBleDeviceActivity$getDeviceAllInfo$1, USB)`,
  },
  {
    id: MAX2_CONTROL.FOUR_MIC, label: '4 Mic & 1 RX', group: 'receiver', kind: 'switch', safety: 'disruptive', readBack: 'status', confidence: 'medium',
    confirmText: 'Switches between 2 Mic & 1 RX and 4 Mic & 1 RX; the mics reconnect to the receiver.',
    source: `${A} switch → SetMicQuantityIntent(!is6701FourMicMode) (R title_four_mic_one_rx, tip_four_mic_one_rx; toast_four_mic_switch_*); heartbeat byte 47 (len ≥ 34); GET 0x6016 at start-up when RX ≥ 3.0.0.50 (getFourModeOrVersion). Disruptive by this library's choice: neither app shows a restart notice [?]`,
  },
  {
    id: MAX2_CONTROL.RX_PAIR, label: 'RX Pairing Mode', group: 'receiver', kind: 'action', safety: 'disruptive', readBack: 'none', confidence: 'medium',
    confirmText: 'The receiver enters pairing mode; mics that are not in pairing mode must be put into it by hand.',
    source: `${A} rxPairBtn ("Start Pairing") → SetMobileRxPairIntent (0x701E, empty payload; R title_rx_pair, setting_pair_start); I Localizable "Mic has not entered pairing mode, please manually enter pairing mode for Mic"`,
  },
  {
    id: MAX2_CONTROL.WIRELESS, label: 'Wireless Monitoring Toggle', group: 'monitoring', kind: 'switch', safety: 'disruptive', readBack: 'status', confidence: 'medium',
    confirmText: 'The device switches between 2TX&2RX and 4TX&4RX mode. RX devices will restart to adapt.',
    source: 'A blemic/device/WirelessMonitorActivity wirelessSwitch → SetWirelessMonitorIntent(on ? Status.FAIL_CLOSE(1) : SUC_OPEN(0)) (R title_wireless_monitor_switch); I Localizable "After enabling Wireless Monitoring, the device switches to 2TX&2RX mode. RX devices will restart to adapt. Confirm?"; heartbeat byte 33 (len ≥ 34)',
  },
  {
    id: MAX2_CONTROL.OWS_MONITOR, label: 'Monitoring Status', group: 'monitoring', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'medium',
    description: 'On = Play, off = Pause',
    source: 'A WirelessMonitorActivity tvPlay / tvPause → SetEarphoneMonitorIntent(FAIL_CLOSE(1) play / SUC_OPEN(0) pause) (R title_monitor_status, status_play, status_pause); heartbeat byte 48 (len ≥ 34)',
  },
  {
    id: MAX2_CONTROL.OWS_VOLUME, label: 'Monitoring Volume', group: 'monitoring', kind: 'range', safety: 'write', readBack: 'get', confidence: 'medium',
    range: { min: 0, max: MAX2_GAIN_MAX, step: 1, unit: 'dB', displayOffset: MAX2_GAIN_OFFSET_DB },
    source: 'A WirelessMonitorActivity progressbarMonitorVolume → SetEarphoneVolumeIntent(progress), read back with GetEarphoneVolumeIntent after the ack (R title_monitor_volume; getSignedString = value − 20)',
  },
  {
    id: MAX2_CONTROL.OWS_PAIR, label: 'Start Pairing', group: 'monitoring', kind: 'action', safety: 'disruptive', readBack: 'none', confidence: 'medium',
    confirmText: 'Searching disconnects the current headphones and pauses Wireless Monitoring.',
    source: 'A WirelessMonitorActivity earPairBtn (not paired) → SetEarphonePairIntent(Status.SUC_OPEN(0)) (R start_pair); I Localizable "Searching will disconnect current headphones and pause Wireless Monitoring. Continue?". "Delete pairing" (0x6017 [1]) is destructive and not offered',
  },
]

export type Max2Link = 'usb' | 'ble'

/** USB RX (1026 mobile, 1027 camera) or the BLE charging case (101). */
export function max2LinkOf(p: ProductInfo): Max2Link {
  return p.productId === 101 ? 'ble' : 'usb'
}


const USB_ONLY = new Set<string>([MAX2_CONTROL.MIC_RECOGNITION, MAX2_CONTROL.FOUR_MIC])
const MOBILE_ONLY = new Set<string>([MAX2_CONTROL.RX_PAIR, MAX2_CONTROL.WIRELESS, MAX2_CONTROL.OWS_MONITOR, MAX2_CONTROL.OWS_VOLUME, MAX2_CONTROL.OWS_PAIR])
const TIMECODE = new Set<string>([MAX2_CONTROL.TC_ENABLED, MAX2_CONTROL.TC_MODE, MAX2_CONTROL.TC_FPS, MAX2_CONTROL.TC_TIMING])
/** Controls behind DeviceDataManager.isNew6701USBDevice (RX ≥ 3.0.0.50). */
export const MAX2_GATED = new Set<string>([
  MAX2_CONTROL.FOUR_MIC, MAX2_CONTROL.RX_PAIR, MAX2_CONTROL.WIRELESS, MAX2_CONTROL.OWS_MONITOR, MAX2_CONTROL.OWS_VOLUME, MAX2_CONTROL.OWS_PAIR,
])

/** Controls the official app offers for a product (see the header). */
export function max2Controls(p: ProductInfo): ControlSpec[] {
  const usb = max2LinkOf(p) === 'usb'
  return MAX2_CONTROLS.filter((c) => {
    if (USB_ONLY.has(c.id) && !usb) return false
    if (MOBILE_ONLY.has(c.id) && !isMax2Mobile(p)) return false
    if (TIMECODE.has(c.id) && isMax2Mobile(p)) return false
    return true
  })
}

const has = (controls: readonly ControlSpec[], id: string) => controls.some((c) => c.id === id)

/**
 * Availability (firmware gates and the official app's preconditions) from the current state. `fourMic`,
 * `wireless`, `earConnect` and `recording` come from the heartbeat / GETs; unknown means "not refused".
 */
export function max2Availability(
  controls: readonly ControlSpec[],
  s: Pick<MicState, 'units' | 'values'>,
  extra: { recording?: boolean; earConnect?: number; ignoreFirmwareGates?: boolean },
): Partial<Record<string, ControlAvailability>> {
  const out: Partial<Record<string, ControlAvailability>> = {}
  const ok: ControlAvailability = { ok: true }
  const v = s.values
  // Firmware gate (A DeviceDataManager.isNew6701USBDevice: RX version, "v" stripped, compareVersions ≥ 3.0.0.50).
  const gate = versionGate(s.units.rx.version, MAX2_SPEC_VERSION_USB, { ignore: extra.ignoreFirmwareGates })
  for (const id of MAX2_GATED) if (has(controls, id)) out[id] = gate
  // A updateFourMicOneRxState: clWirelessMonitor visible only in 2 Mic & 1 RX mode.
  if (has(controls, MAX2_CONTROL.WIRELESS) && gate.ok && v[MAX2_CONTROL.FOUR_MIC] === true) {
    out[MAX2_CONTROL.WIRELESS] = { ok: false, reason: 'four-mic-mode', message: 'Wireless Monitoring is offered in 2 Mic & 1 RX mode only' }
  }
  // A WirelessMonitorActivity.updateWirelessState: the pairing row needs monitoring on; play/pause and volume also
  // need a connected earphone (updateMonitorAndVolume(isOpen && isConnected)).
  const wirelessOff = v[MAX2_CONTROL.WIRELESS] === false
  const earsOff = extra.earConnect === 0
  for (const id of [MAX2_CONTROL.OWS_MONITOR, MAX2_CONTROL.OWS_VOLUME, MAX2_CONTROL.OWS_PAIR]) {
    if (!has(controls, id) || !gate.ok) continue
    if (wirelessOff) out[id] = { ok: false, reason: 'wireless-off', message: 'Wireless Monitoring is off' }
    else if (earsOff && id !== MAX2_CONTROL.OWS_PAIR) out[id] = { ok: false, reason: 'earphone-disconnected', message: 'No OWS Monitor Earphone connected' }
    else out[id] = ok
  }
  // A HLBleDeviceActivity.isAllowSet (any TX online) guards the NC switch only (initView$lambda$27$lambda$8,
  // R mic_offline_tip). The depth slider (HLBleDeviceActivity$initView$1$8.onStopTrackingTouch) has no mic check; it is
  // shown only while NC is on.
  const anyMic = MAX2_MIC_UNITS.some((u) => s.units[u]?.online)
  const noMic: ControlAvailability = { ok: false, reason: 'mic-disconnected', message: 'Mic not connected, current function not available' }
  out[MAX2_CONTROL.NOISE_ENABLED] = anyMic ? ok : noMic
  out[MAX2_CONTROL.NOISE_DEPTH] = v[MAX2_CONTROL.NOISE_ENABLED] === false ? { ok: false, reason: 'noise-off', message: 'NC is off' } : ok
  // A initView lambdas 17/18: both bit-depth buttons refuse while TX internal recording is on (R toast_record_status).
  const rec: ControlAvailability = extra.recording
    ? { ok: false, reason: 'recording-on', message: 'Please disable the internal recording function before switching the bit depth.' }
    : ok
  out[MAX2_CONTROL.BIT_DEPTH] = rec
  out[MAX2_CONTROL.USB_OUTPUT] = rec
  // Mic 3/4 gains exist in 4 Mic & 1 RX mode only (A SetVoiceGainIntent: 6-byte payload when is6701FourMicMode).
  const four = v[MAX2_CONTROL.FOUR_MIC] === true
  for (const u of ['tx3', 'tx4'] as const) {
    out[controlKey(MAX2_CONTROL.MIC_GAIN, u)] = four || s.units[u]?.online ? ok : { ok: false, reason: 'two-mic-mode', message: 'Mic 3/4 exist in 4 Mic & 1 RX mode only' }
  }
  return out
}

/**
 * Availability while replies are not delivered (write-only link): the firmware-gated controls wait for an RX version
 * that cannot be read ('version-unknown'), and the writes that carry values the app has not read are refused, as
 * encodeSet refuses them ('state-unknown'): the NC switch sends the current depth, every gain write sends all mic
 * gains. A value sent blind counts as known (the engine re-applies this after every blind write). No mic checks:
 * nothing is known about the mics.
 */
export function max2BlindAvailability(
  controls: readonly ControlSpec[],
  s: Pick<MicState, 'units' | 'values'>,
  extra: { ignoreFirmwareGates?: boolean } = {},
): Partial<Record<string, ControlAvailability>> {
  const out: Partial<Record<string, ControlAvailability>> = {}
  const ok: ControlAvailability = { ok: true }
  const v = s.values
  const gate = versionGate(s.units.rx.version, MAX2_SPEC_VERSION_USB, { ignore: extra.ignoreFirmwareGates })
  for (const id of MAX2_GATED) if (has(controls, id)) out[id] = gate
  const unknown = (what: string): ControlAvailability => ({ ok: false, reason: 'state-unknown', message: `${what} cannot be read (replies are not delivered)` })
  if (has(controls, MAX2_CONTROL.NOISE_ENABLED)) out[MAX2_CONTROL.NOISE_ENABLED] = typeof v[MAX2_CONTROL.NOISE_DEPTH] === 'number' ? ok : unknown('the NC depth')
  const four = v[MAX2_CONTROL.FOUR_MIC] === true
  const mics = four ? MAX2_MIC_UNITS : MAX2_MIC_UNITS.slice(0, 2)
  const known = (except?: string) => mics.every((u) => u === except || typeof v[controlKey(MAX2_CONTROL.MIC_GAIN, u)] === 'number')
  for (const id of [MAX2_CONTROL.GAIN_TYPE, MAX2_CONTROL.GAIN_DYNAMIC]) if (has(controls, id)) out[id] = known() ? ok : unknown('the mic gains')
  if (has(controls, MAX2_CONTROL.MIC_GAIN)) {
    for (const u of MAX2_MIC_UNITS) {
      out[controlKey(MAX2_CONTROL.MIC_GAIN, u)] = !mics.includes(u)
        ? { ok: false, reason: 'two-mic-mode', message: 'Mic 3/4 exist in 4 Mic & 1 RX mode only' }
        : known(u) ? ok : unknown('the other mic gains')
    }
  }
  return out
}

