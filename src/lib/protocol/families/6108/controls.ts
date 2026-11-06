/**
 * LARK A1 (6108) controls (docs/FAMILIES.md §3.8 row 6108, §4.2; docs/research/families/a1-6108.md §5–6): the
 * ControlSpecs with the official app labels, the availability rules (the firmware gate and the app's preconditions)
 * and the translation of a control write into A1 requests.
 *
 * Every A1 setting is in the 0x1F heartbeat (a1-6108.md §4.2), so every readable control has `readBack: 'status'`:
 * the probe heartbeat at connect populates them all (check 10), and each confirmed write is read back with one
 * heartbeat 150 ms later (iOS reads back after every set: I -[HL6108DeviceInfoSync queryCommandForSetCommand:]
 * @0x100204d88 maps 0x03/0x05/0x13/0x16/0x21/0x23/0x27 to 0x1F; Android relies on its 1 s poll).
 *
 * Labels: Android `res/values/strings.xml` (R key in each `source`), layouts `activity_hldevice_6302.xml`,
 * `hldevice_6108.xml`, `activity_signal_mode.xml`. Screens: A larkc1/HLDevice6302Activity (is6108Device branch),
 * A blemic/setting/SignalModeActivity, A blemic/setting/ModeSettingActivity → ModeSwitchActivity.
 *
 * Preconditions, as the home screen checks them before sending (A HLDevice6302Activity):
 *  - isAllMicOffline (no mic online, toast R mic_offline_tip) blocks NC, volume, channel mode, EQ, reverb and Mic
 *    Recognition ('mic-disconnected'); auto power-off and the LED have no check
 *  - isTxOnlineAndMuteCountEqual (every online mic muted, toast R toast_tx_mute) blocks NC ('all-mics-muted')
 *  - NC level and reverb size buttons are shown only while NC / reverb is on (updateNoiseView noiseLevelBottom,
 *    updateReverbView reverbOption): 'noise-off' / 'reverb-off'
 *  - Mic Recognition in 2 Mic & 1 RX mode needs Mic1 and Mic2 (toast R toast_connect_mic): 'both-mics-required'
 *  - per-mic mute: the row needs RX firmware >= 1.0.1.3 (DeviceDataManager.is6108NewDevice, inclusive); Mic3 / Mic4
 *    exist only in 4 Mic & 1 RX mode ('two-mic-mode'); an offline mic is refused ('mic-offline', R mic_offline_tip)
 * The engine enforces them through MicState.availability (requireAvailable; `enforcePreconditions: false` and
 * `ignoreFirmwareGates` relax them as for every family).
 */
import { UnsupportedError } from '../../device'
import { CONTROL, controlKey, requireAvailable, versionGate } from '../../core/controls'
import type {
  ControlAvailability, ControlId, ControlSpec, ControlValue, EngineContext, MicState, UnitId, WritePlan,
} from '../../core/types'
import type { ProductInfo } from '../../models'
import type { A1Reply } from './codec'
import {
  A1Eq, A1NoiseLevel, A1ReverbLevel, A1Requests, A1_TX_UNITS, A1_VOLUME_STEPS, type A1Request, type A1TxUnitId,
} from './commands'
import {
  A1_CONTROL, A1_NEW_DEVICE_MIN_VERSION, a1MicSlotsOfVersion, isA1FourMicFirmware, type A1Heartbeat,
} from './status'

const ACT = 'A larkc1/HLDevice6302Activity'
const MSG = 'A usbmic/messenger/UsbMessengerV2'
const HB = 'A usbmic/protocolV2/ProGetHearInfo.receiveData'
const IHB = 'I -[HLHeartEntity initA1HeartInfo:] @0x1001fa798'

/** Delay of the heartbeat read-back after a confirmed write (engine default for every family). */
export const A1_READBACK_DELAY_MS = 150

/**
 * NC level and reverb size the Android app sends before its first heartbeat (A HLDevice6302Activity.<init>:
 * noiseType = NoiseLevelType.STRONG_NOISE, reverbType = Reverb.GEAR_ONE). Used when the switch is written while the
 * level is unknown (a blind write on a write-only link): the switch payload always carries a level.
 */
export const A1_APP_DEFAULT_NOISE_LEVEL = A1NoiseLevel.STRONG
export const A1_APP_DEFAULT_REVERB_LEVEL = A1ReverbLevel.SMALL

/** Mic slots of the mute row: TX1..TX4 (4 Mic & 1 RX); TX3 / TX4 are 'two-mic-mode' on 2 Mic & 1 RX firmware. */
export const A1_MUTE_UNITS: readonly UnitId[] = A1_TX_UNITS

export const A1_CONTROLS: readonly ControlSpec[] = [
  {
    id: CONTROL.MIC_MUTE, label: 'Mic mute', group: 'mics', kind: 'switch', perUnit: A1_MUTE_UNITS, safety: 'write', readBack: 'status',
    confidence: 'high',
    description:
      'Mutes one mic (Mic1–Mic4). The official app shows the row from receiver firmware 1.0.1.3, Mic3 / Mic4 only in ' +
      '4 Mic & 1 RX mode, and refuses a mic that is not connected. The mic button changes it too (read from the heartbeat).',
    source:
      `${ACT}.initView$lambda$19$lambda$7..10 (tx<n>Status false → R mic_offline_tip) → ${MSG}.setTxMute ([coerceIn(ordinal - 1, 0, 3), mute], 0x16); ` +
      `onResGetVersion: micMuteView visible when blemic/manager/DeviceDataManager.is6108NewDevice (RX >= 1.0.1.3), mic3Mic4MuteView when is6108FourMicOneRx; ` +
      `${HB} body[4]/[5]/[21]/[22]; I action6108SetMuteIndex:isOpen:, ${IHB}; R title_mic_mute, ble_device_mic1..4`,
  },
  {
    id: CONTROL.NOISE_ENABLED, label: 'NC', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status', confidence: 'high',
    description: 'Sent with the current level ([on, level]). Refused while no mic is online or every online mic is muted.',
    source:
      `${ACT}.initView$lambda$4 (isAllMicOffline, isTxOnlineAndMuteCountEqual → R toast_tx_mute) → setNoiseLevel(noiseType, isOpen) → ` +
      `${MSG}.setNoiseLevel → [isOpen, level] (0x13); ${HB} body[6]; I action6108SetNoiseOpen:level:, ${IHB}; R noise_reduction_msg`,
  },
  {
    id: CONTROL.NOISE_LEVEL, label: 'NC level', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [
      { value: A1NoiseLevel.WEAK + 1, label: 'Weak' }, // R tv_weak, wire 0
      { value: A1NoiseLevel.MEDIUM + 1, label: 'Medium' }, // R tv_medium, wire 1 (mediumLevel visible only for 1031)
      { value: A1NoiseLevel.STRONG + 1, label: 'Strong' }, // R tv_strong, wire 2
    ],
    description: 'Weak / Medium / Strong, offered while NC is on (the app sends [1, level], so a level also keeps NC on).',
    source:
      `${ACT}.onClick low_level / medium_level / strong_level → setNoiseLevel({0|1|2}, true) (0x13 [1, level]); updateNoiseView (noiseLevelBottom ` +
      `visible while on; mediumLevel visible only when is6108Device); blemic/device/DeviceConnectVariable.NoiseLevelType; ${HB} body[7]; ` +
      `I action6108SetNoiseOpen:level:; R tv_weak, tv_medium, tv_strong`,
  },
  {
    id: CONTROL.VOLUME, label: 'Volume adjustment', group: 'receiver', kind: 'steps',
    range: { min: 0, max: A1_VOLUME_STEPS - 1, step: 1, displayOffset: 1 }, safety: 'write', readBack: 'status', confidence: 'high',
    description: 'Six-step scale (index 0..5). Refused while no mic is online.',
    source:
      `${ACT}.initView$lambda$22$lambda$21 (isAllMicOffline) → setVoice(index) → ${MSG}.setVoice (0x03); voiceProgressbar ` +
      `application/common/widget/CustomScaleSeekBar (totalCount 6; the 6-button group is hidden for 1031); ${HB} body[8]; ` +
      `I action6108SetVoiceLevel:; R volume_adjust`,
  },
  {
    id: CONTROL.CHANNEL_MODE, label: 'Channel Mode', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [
      { value: 0, label: 'Mono' }, // R mono
      { value: 1, label: 'Stereo' }, // R stereo
    ],
    description: 'Refused while no mic is online. The app debounces taps by 400 ms; queued writes coalesce here instead.',
    source:
      `${ACT}.onClick mono_mode / stereo_mode (isAllMicOffline, isNotFastClick) → setVoiceMode({0|1}) → ${MSG}.setVoiceMode (0x01); ` +
      `${HB} body[9]; I action6108SetVocalMode:; R vocal_tract, mono, stereo`,
  },
  {
    id: A1_CONTROL.EQ, label: 'EQ Adjustment', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    // Layout order (hldevice_6108.xml balance_btn, overcast_btn, bright_btn), which is also iOS's
    // eqValueForSelectedIndex: @0x1002e0bac (UI index 0 → 3, 1 → 1, 2 → 2). Values are the wire values.
    options: [
      { value: A1Eq.EQUALIZATION, label: 'Equalization' }, // R option_balance, DeviceConnectVariable.EQ.BALANCE
      { value: A1Eq.LOW, label: 'Low' }, // R option_overcast, EQ.OVERCAST
      { value: A1Eq.BRIGHT, label: 'Bright' }, // R option_bright, EQ.BRIGHT
    ],
    description: 'Three EQ presets. Refused while no mic is online.',
    source:
      `${ACT}.initView$lambda$19$lambda$11..13 (isAllMicOffline) → setEq(EQ.OVERCAST/BRIGHT/BALANCE) → ${MSG}.setEQ (0x07); updateEqView; ` +
      `blemic/device/DeviceConnectVariable.EQ; ${HB} body[12]; I eqValueForSelectedIndex: @0x1002e0bac, action6108SetEQSelectedIndex:; ` +
      `R title_eq, option_balance, option_overcast, option_bright`,
  },
  {
    id: A1_CONTROL.REVERB_ENABLED, label: 'Reverb Adjustment', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status',
    confidence: 'high',
    description: 'Sent with the current size ([on, size]). Refused while no mic is online.',
    source:
      `${ACT}.initView$lambda$19$lambda$17 (isAllMicOffline) → setReverb(reverbType, isOpen) → ${MSG}.setReverb → [isOpen, value] (0x05); ` +
      `${HB} body[13]; I action6108SetReverbOpen:level:, ${IHB}; R title_reverb`,
  },
  {
    id: A1_CONTROL.REVERB_LEVEL, label: 'Reverb size', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status', confidence: 'high',
    options: [
      { value: A1ReverbLevel.SMALL, label: 'Small' }, // R gear_one, Reverb.GEAR_ONE
      { value: A1ReverbLevel.MEDIUM, label: 'Medium' }, // R gear_two
      { value: A1ReverbLevel.LARGE, label: 'Large' }, // R gear_three
    ],
    description: 'Small / Medium / Large, offered while reverb is on (the app sends [1, size]).',
    source:
      `${ACT}.initView$lambda$19$lambda$14..16 (isAllMicOffline) → setReverb(GEAR_ONE/TWO/THREE, true) (0x05 [1, size]); updateReverbView ` +
      `(reverbOption visible while on); blemic/device/DeviceConnectVariable.Reverb; ${HB} body[14]; I action6108SetReverbOpen:level:; ` +
      `R gear_one, gear_two, gear_three`,
  },
  {
    id: CONTROL.MIC_RECOGNITION, label: 'Mic Recognition', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status',
    confidence: 'high',
    description: 'In 2 Mic & 1 RX mode it needs Mic1 and Mic2 connected; in 4 Mic & 1 RX mode any mic.',
    source:
      `${ACT}.initView$lambda$19$lambda$18 (!is6108FourMicOneRx && (!tx1Status || !tx2Status) → R toast_connect_mic; isAllMicOffline) → ` +
      `setTxIdentify(on ? Status.FAIL_CLOSE(1) : SUC_OPEN(0)) → ${MSG}.setTxIdentify (0x23); ${HB} body[15]; ` +
      `I action6108SetTXCheckOpen:, ${IHB} (isTXCheckOpen); R title_tx_identify`,
  },
  {
    id: CONTROL.AUTO_OFF, label: 'Schedule power off', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status',
    confidence: 'high',
    description: 'On = "15min", off = "Never".',
    source:
      `${ACT}.onClick quarter_time / never_time → setShutdownTime({0|1}) → ${MSG}.setShutdownTime (0x27, 0 = 15 min, 1 = never); ` +
      `updateShutDownView; ${HB} body[10]; I action6108SetShutdown:; R shutdown_time, quarter_time, never_time`,
  },
  {
    id: CONTROL.LED, label: 'Indicator Light Switch', group: 'settings', kind: 'switch', safety: 'write', readBack: 'status',
    confidence: 'high',
    source:
      `${ACT}.initView$lambda$6 → setLight(on ? 0 : 1) → ${MSG}.setLight (0x21, 0 = on); ctLight visible only when is6108Device; ` +
      `${HB} lightStatus = body[11] == 0; I action6108SetLightOpen: ([!isOpen]); R light_switch`,
  },
  {
    id: A1_CONTROL.SIGNAL_MODE, label: 'Mode setting', group: 'advanced', kind: 'choice', safety: 'write', readBack: 'status',
    confidence: 'medium',
    options: [
      { value: 0, label: 'Normal mode' }, // R title_normal_signal, "Conventional daily scenario usage"
      { value: 1, label: 'Performance mode' }, // R title_enhance_signal
    ],
    description:
      'Normal mode: conventional daily scenario usage. Performance mode: for complex environments or high pedestrian traffic. ' +
      'The official app shows it only when the cloud flag ModeSwitch is on. A plain setting (no restart); a failure is ' +
      'followed by a read of the fail reason (0x41), as Android does. iOS reads it back with 0x46 instead of 0x40 (unresolved).',
    source:
      `A blemic/setting/SignalModeActivity.initView (clNormalSignal → Status.SUC_OPEN(0), clEnhanceSignal → FAIL_CLOSE(1)) → setSignalMode → ` +
      `${MSG}.setSignalMode (0x3F); onCreate getSignalMode (0x40) + 1 s heartbeat; onResHeartInfoV2 heartInfo.getSignalMode() = body[16]; ` +
      `onResponseSet failure → getModeFailReason (0x41); blemic/setting/SettingActivity (visible if HUpdater config ModeSwitch); ` +
      `${IHB} isEnhance, I queryCommandForSetCommand: @0x100204d88 (0x3F → 0x46); R signal_mode, title_normal_signal, title_enhance_signal, desc_normal_signal, desc_enhance_signal`,
  },
  {
    // Catalogue only: hidden for untested products (destructive) and refused by a1EncodeSet everywhere.
    id: A1_CONTROL.WIRELESS_MODE, label: 'Wireless settings', group: 'advanced', kind: 'choice', safety: 'destructive', readBack: 'get',
    confidence: 'medium',
    options: [
      { value: 2, label: '2 Mic & 1 RX' }, // R title_two_mic_one_rx
      { value: 4, label: '4 Mic & 1 RX' }, // R title_four_mic_one_rx
    ],
    confirmText: 'Switching mode re-flashes the receiver and every mic with the other firmware (about 5 minutes); the mics must be paired again.',
    description:
      'The current mode is read from the receiver version (0x0D: second part 1 = 4 Mic & 1 RX). Switching it is a firmware ' +
      're-flash (0x2C, Feature-6 DFU 0x1A..0x1E, 0x2D, 0x3C/0x3D/0x3E) and is never implemented.',
    source:
      `${ACT}.onResGetVersion (Integer.parseInt(split[1]) == 1 → is6108FourMicOneRx); A blemic/setting/ModeSettingActivity → ModeSwitchActivity ` +
      `(sendRxIntoPair, startRefreshRx, startAskTxOTAResult; visible if cloud config WirelessSwitch); I -[HL6108DeviceInfoSync isOpen4t1r] @0x100206480, ` +
      `-[HL6108Engine changeDeviceModeWithStatus:is4t1r:] @0x10026d21c; R title_mode_setting, title_two_mic_one_rx, title_four_mic_one_rx`,
  },
]

/** Controls of an A1 row (one PID; 2- vs 4-mic is decided at run time from the RX version). */
export function a1Controls(_product: ProductInfo): readonly ControlSpec[] {
  return A1_CONTROLS
}

// ------------------------------------------------------------------------------- availability

const OK: ControlAvailability = { ok: true }
const R_MIC_OFFLINE = 'Mic not connected, current function not available' // R mic_offline_tip
const R_TX_MUTE = 'Mic is currently muted. Noise cancellation settings are unavailable.' // R toast_tx_mute
const R_CONNECT_MIC = 'Mic1 and Mic2 are not connected; the current function cannot be configured.' // R toast_connect_mic

/** The last heartbeat applied to the state (FamilyDevice stores it in `raw` through statusApplied). */
export function a1LastHeartbeat(state: MicState): A1Heartbeat | undefined {
  const r = state.raw as Partial<A1Heartbeat> | undefined
  return r && typeof r === 'object' && typeof r.layout === 'string' && Array.isArray(r.tx) ? (r as A1Heartbeat) : undefined
}

/**
 * Mic slots of the kit, for the 2- or 4-mic layout: from the RX version (A HLDevice6302Activity.onResGetVersion), else
 * 4 when a heartbeat reports TX3 or TX4 online, else undefined (the app assumes 2 until the version arrives).
 */
export function a1MicSlots(state: MicState): 2 | 4 | undefined {
  const v = state.values[A1_CONTROL.WIRELESS_MODE]
  if (v === 2 || v === 4) return v
  const fromVersion = a1MicSlotsOfVersion(state.units.rx.version)
  if (fromVersion) return fromVersion
  return state.units.tx3?.online || state.units.tx4?.online ? 4 : undefined
}

/**
 * Availability of every A1 control key in the current state. Complete on every call (ok entries included), because
 * the engine merges availability: a key left out would keep an old refusal.
 */
export function a1Availability(state: MicState, o: { ignoreFirmwareGates?: boolean } = {}): Record<string, ControlAvailability> {
  const a: Record<string, ControlAvailability> = {}
  for (const c of A1_CONTROLS) {
    if (c.id === A1_CONTROL.WIRELESS_MODE) continue
    a[c.id] = OK
  }
  const rxVersion = state.units.rx.version
  // A HLDevice6302Activity: is6108FourMicOneRx defaults to false until onResGetVersion.
  const fourMic = isA1FourMicFirmware(rxVersion) === true
  const muteGate = versionGate(rxVersion, A1_NEW_DEVICE_MIN_VERSION, { ignore: o.ignoreFirmwareGates })
  a[CONTROL.MIC_MUTE] = muteGate
  for (const u of A1_TX_UNITS) {
    const key = controlKey(CONTROL.MIC_MUTE, u)
    if (!muteGate.ok) a[key] = muteGate
    else if (!fourMic && (u === 'tx3' || u === 'tx4')) {
      a[key] = { ok: false, reason: 'two-mic-mode', message: 'Mic3 and Mic4 exist only in 4 Mic & 1 RX mode' }
    } else if (!state.units[u]?.online) a[key] = { ok: false, reason: 'mic-offline', message: R_MIC_OFFLINE }
    else a[key] = OK
  }

  const hb = a1LastHeartbeat(state)
  if (hb && hb.signalMode === undefined && state.values[A1_CONTROL.SIGNAL_MODE] === undefined) {
    // I initA1HeartInfo: reads isEnhance only when LEN is 17 or 23 (@0x1001fac5c); a 22-byte (or shorter) body is a
    // firmware without "Mode setting" [I], and 0x40 got no answer at start-up.
    // A firmware-gate reason: `ignoreFirmwareGates` lets it through (core/controls.ts requireAvailable).
    a[A1_CONTROL.SIGNAL_MODE] = {
      ok: false, reason: 'firmware-too-old',
      message: `this receiver firmware's ${hb.length}-byte heartbeat has no signal-mode byte (Mode setting not supported)`,
    }
  }
  if (!hb) return a

  const online = A1_TX_UNITS.filter((u) => state.units[u]?.online)
  const block = (ids: readonly ControlId[], reason: string, message: string) => {
    for (const id of ids) if (a[id]?.ok !== false) a[id] = { ok: false, reason, message }
  }
  // Mic Recognition: the 2T1R check comes before isAllMicOffline (initView$lambda$19$lambda$18).
  if (!fourMic && (!state.units.tx1?.online || !state.units.tx2?.online)) {
    block([CONTROL.MIC_RECOGNITION], 'both-mics-required', R_CONNECT_MIC)
  }
  if (!online.length) {
    block(
      [
        CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.CHANNEL_MODE, A1_CONTROL.EQ, A1_CONTROL.REVERB_ENABLED,
        A1_CONTROL.REVERB_LEVEL, CONTROL.MIC_RECOGNITION,
      ],
      'mic-disconnected', R_MIC_OFFLINE,
    )
  } else if (online.every((u) => state.values[controlKey(CONTROL.MIC_MUTE, u)] === true)) {
    // Mute state from values: the heartbeat's, or a confirmed mute write not read back yet.
    block([CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL], 'all-mics-muted', R_TX_MUTE)
  }
  if (state.values[CONTROL.NOISE_ENABLED] === false) {
    block([CONTROL.NOISE_LEVEL], 'noise-off', 'noise cancellation is off; the app shows the levels only while it is on')
  }
  if (state.values[A1_CONTROL.REVERB_ENABLED] === false) {
    block([A1_CONTROL.REVERB_LEVEL], 'reverb-off', 'reverb is off; the app shows the sizes only while it is on')
  }
  return a
}

// ------------------------------------------------------------------------------- writes

const num = (v: ControlValue) => v as number

/**
 * A control write as A1 requests (ProtocolSpec.encodeSet). Every setter is absolute (no toggles), so every write may
 * go out blind on a write-only link (`blindWrites`). Availability is evaluated again here on the current state, with
 * the engine's rules (requireAvailable: firmware gates unless ignoreFirmwareGates, preconditions unless
 * enforcePreconditions is false), so a blind write (no heartbeat, no availability yet) cannot bypass the mute gate.
 */
export function a1EncodeSet(
  ctx: EngineContext<A1Request, A1Reply>,
  id: ControlId,
  value: ControlValue,
  o: { unit?: UnitId },
): WritePlan<A1Request> {
  requireAvailable({ ...ctx.state, availability: a1Availability(ctx.state, ctx.options) }, id, o.unit, ctx.options)
  const v = ctx.state.values
  const plan = (request: A1Request, optimistic: Partial<Record<ControlId, ControlValue>>): WritePlan<A1Request> => ({
    requests: [request], optimistic, readBack: { request: A1Requests.heartbeat(), delayMs: A1_READBACK_DELAY_MS },
  })
  switch (id) {
    case CONTROL.MIC_MUTE: {
      const unit = o.unit as A1TxUnitId
      return plan(A1Requests.setTxMute(unit, value === true), { [controlKey(id, unit)]: value })
    }
    case CONTROL.NOISE_ENABLED: {
      const level = v[CONTROL.NOISE_LEVEL]
      return plan(A1Requests.setNoise(value === true, typeof level === 'number' ? level - 1 : A1_APP_DEFAULT_NOISE_LEVEL), { [id]: value })
    }
    case CONTROL.NOISE_LEVEL:
      return plan(A1Requests.setNoise(true, num(value) - 1), { [id]: value, [CONTROL.NOISE_ENABLED]: true })
    case CONTROL.VOLUME:
      return plan(A1Requests.setVolume(num(value)), { [id]: value })
    case CONTROL.CHANNEL_MODE:
      return plan(A1Requests.setChannelMode(num(value)), { [id]: value })
    case A1_CONTROL.EQ:
      return plan(A1Requests.setEq(num(value)), { [id]: value })
    case A1_CONTROL.REVERB_ENABLED: {
      const level = v[A1_CONTROL.REVERB_LEVEL]
      return plan(A1Requests.setReverb(value === true, typeof level === 'number' ? level : A1_APP_DEFAULT_REVERB_LEVEL), { [id]: value })
    }
    case A1_CONTROL.REVERB_LEVEL:
      return plan(A1Requests.setReverb(true, num(value)), { [id]: value, [A1_CONTROL.REVERB_ENABLED]: true })
    case CONTROL.MIC_RECOGNITION:
      return plan(A1Requests.setMicRecognition(value === true), { [id]: value })
    case CONTROL.AUTO_OFF:
      // true = "15min" (wire 0), false = "Never" (wire 1).
      return plan(A1Requests.setShutdownTime(value === true ? 0 : 1), { [id]: value })
    case CONTROL.LED:
      return plan(A1Requests.setLed(value === true), { [id]: value })
    case A1_CONTROL.SIGNAL_MODE:
      return plan(A1Requests.setSignalMode(num(value)), { [id]: value })
    case A1_CONTROL.WIRELESS_MODE:
      throw new UnsupportedError(
        'Wireless settings (2 Mic & 1 RX ↔ 4 Mic & 1 RX) re-flashes the receiver and the mics; Hollyland Web UI never implements it',
      )
    default:
      throw new UnsupportedError(`${id} is not a LARK A1 control`)
  }
}
