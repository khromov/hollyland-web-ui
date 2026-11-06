/**
 * MELO P1 ProtocolSpec for FamilyDevice<MomaRequest, MomaMessage> (docs/FAMILIES.md §3.3, §3.8 row 6201).
 *
 *  - framing:   the shared Moma codec (moma/), profile MOMA_6201_BLE over Web Bluetooth (target 1) or
 *               MOMA_6201_USB over HID (target 0), both control 0x04 with XOR (A Protocol6201Provider
 *               .createCommandPostBuilder); MOMA_6201_IOS (target 1, control 0x00, no XOR) for the iOS cross-check.
 *               Replies are decoded with their own control byte, so XOR on or off both decode.
 *  - probe:     0x600B, also the 3 s status poll (A application/common/util/EventLooper default 3000 ms via
 *               c6201/data/runtime/DeviceRuntimeManager.startHeartBeat; melo-6201.md §4.1)
 *  - start-up:  0x600A [0] (A DeviceRuntimeManager.requestMasterDeviceVersionNow) under fetchIdentity, then the
 *               More Settings / mixer GETs under fetchSettings in the app's order (meloStartupReads()), then the
 *               mic gain GET the firmware selects (A MoreSettingActivity.dispatchMicGainQueryByFirmwareVersion).
 *               They are background reads; MeloDevice.connect() waits for them (within a budget), so the first
 *               state is populated and a first write never starts from an unread struct (0x130A / 0x1308 /
 *               0x1319 / 0x2000 / 0x1142 are read-modify-write).
 *  - per unit:  then 0x600A [type] for every unit the heartbeat reports online (A DeviceRuntimeManager
 *               .checkAllOnlineDeviceVersions), in the background.
 *  - pushes:    VU levels (0x11EB) after the 0x11E0 source selection and the 0x6048 subscription (MeloSession,
 *               device.ts startLevels): a level stream, not MicState.values. Unsolicited GET replies (the mixer
 *               page treats 0x1309 as a possible "PUSH": A HLVolumeListView.updateTrackVolumeOutputStatus) are
 *               applied like replies.
 *  - gates:     RX >= 3.0.7.9 per-mic gain, < 3.0.7.9 shared Near / Mid / Far; >= 4.0.0.1 V2 structures, noise
 *               gate hidden (commands.ts MELO_GATE).
 */
import { UnsupportedError } from '../../device'
import { compareVersions, controlKey, versionGate } from '../../core/controls'
import { ControlUnavailableError } from '../../core/errors'
import type {
  ControlAvailability, ControlId, ControlValue, EngineContext, MicState, MicUnit, ProtocolSpec, UnitId, WritePlan,
} from '../../core/types'
import { decodeMomaFrame } from '../../moma/codec'
import type { MomaProfile } from '../../moma/profiles'
import { createMomaSpecBase, momaRequest, momaStatusAck, type MomaMessage, type MomaRequest } from '../../moma/spec'
import {
  MELO_CMD, MELO_COMMANDS, MELO_DEVICE_TYPE, MELO_GATE, MELO_LED_DEVICE, MELO_UNIT_DEVICE_TYPE, meloDeviceInfoRequest, meloGet,
  meloHeartbeatRequest, meloNoiseGateGet, meloNotifyStartRequest, meloNotifyStopRequest, meloUnitOfDeviceType, meloVuSourceRequest,
} from './commands'
import { MELO_CONTROL as C, MELO_CONTROLS } from './controls'
import {
  encodeMeloBitDepths, encodeMeloI32, encodeMeloLed, encodeMeloStreamIn, encodeMeloStreamOut, encodeMeloTxGains, meloNoiseGateSetPayload,
  parseMeloAllLevels, parseMeloBitDepths, parseMeloDeviceInfo, parseMeloHeartbeat, parseMeloI32, parseMeloInputLevels, parseMeloLeds,
  parseMeloNoiseGate, parseMeloOutputLevels, parseMeloStreamIn, parseMeloStreamOut, parseMeloTxGains,
  type MeloBitDepths, type MeloHeartbeat, type MeloLed, type MeloLevels, type MeloNoiseGate, type MeloStreamIn, type MeloStreamOut,
} from './status'

type Ctx = EngineContext<MomaRequest, MomaMessage>

const noop = () => null

/**
 * GETs sent at start-up and by refresh('settings'), in the official app's order: A larkc1/c6201/ui/setting/
 * viewmodel/MoreSettingViewModel.getMoreSettingsDeviceInfo (0x1311 auto speaker, 0x1303 jack, 0x1143 [02 00]
 * noise gate, 0x1301 NC, then getUsbOutputVolumeStatus: 0x130B track faders, 0x1309 outputs), A
 * larkc1/c6201/ui/setting/LightSettingActivity (0x3004 LED) and the home page's work mode (0x1155). The
 * 0x1118 chain-switch read the same method sends is left out (V1/V2 entity, not implemented).
 * 0x1305 (bit depths incl. the second-port RX's rxSlave byte) is an iOS read: +[HL6201Messenger getDeviceSetInfo]
 * sends it right after 0x1301 (@0x10023c318); Android never reads it. The 0x1304 writes keep its rxSlave byte.
 */
export function meloStartupReads(): MomaRequest[] {
  return [
    meloGet(MELO_CMD.AUTO_SPEAKER_GET),
    meloGet(MELO_CMD.JACK_DIR_GET),
    meloNoiseGateGet(),
    meloGet(MELO_CMD.NC_GET),
    meloGet(MELO_CMD.BIT_DEPTH_GET),
    meloGet(MELO_CMD.STREAM_IN_GET),
    meloGet(MELO_CMD.STREAM_OUT_GET),
    meloGet(MELO_CMD.LED_GET),
    meloGet(MELO_CMD.WORK_MODE_GET),
  ]
}

/** Units whose version is read with 0x600A once they are online, in the app's order (master first, separately). */
export const MELO_IDENTITY_UNITS: readonly UnitId[] = ['tx1', 'tx2', 'remote', 'earL', 'earR']

/** 'v2' from RX 4.0.0.1 (A Protocol6201SessionState.isNewStructure), 'v1' below, null while the version is unknown. */
export function meloStructure(rxVersion: string | undefined): 'v1' | 'v2' | null {
  if (!rxVersion || /^0(\.0)*$/.test(rxVersion.trim())) return null
  return compareVersions(rxVersion, MELO_GATE.NEW_STRUCTURE) >= 0 ? 'v2' : 'v1'
}

/** Per-mic gain (true), shared Near / Mid / Far (false) or unknown (null): A MoreSettingActivity.resolveNewFirmwareVersion. */
export function meloIndependentGain(rxVersion: string | undefined): boolean | null {
  const g = versionGate(rxVersion, MELO_GATE.INDEPENDENT_TX_GAIN)
  return g.ok ? true : g.reason === 'firmware-too-old' ? false : null
}

/** The mic gain GET the firmware selects, or null while the version is unknown (the app then reads neither). */
export function meloGainRead(rxVersion: string | undefined): MomaRequest | null {
  const g = meloIndependentGain(rxVersion)
  return g === null ? null : meloGet(g ? MELO_CMD.TX_GAIN_GET : MELO_CMD.MIC_GAIN_GET)
}

/** Total length of the Moma frame at buf[0] (for BleFrameJoiner): null when more bytes are needed, 0 to resync. */
export function meloFrameLength(buf: Uint8Array): number | null {
  if (!buf.length) return null
  if (buf[0] !== 0xaa && buf[0] !== 0xbb) return 0
  const r = decodeMomaFrame(buf, { heads: 'both' })
  return r.status === 'ok' ? r.length : r.status === 'incomplete' ? null : 0
}

// ---------------------------------------------------------------------------------- session

export type MeloLevelListener = (levels: MeloLevels) => void

/**
 * Per-device state the spec hooks share with MeloDevice: the engine context (captured on the first hook call),
 * the structs read-modify-write controls need, and the VU level stream.
 */
export class MeloSession {
  ctx: Ctx | null = null
  /** onConnected finished its start-up reads. */
  startupDone = false
  /** startLevels() was asked for (re-sent after a reconnect). */
  levelsWanted: { intervalMs: number } | null = null
  /** 0x6048 acknowledged and not stopped since. */
  levelsActive = false
  latestLevels: MeloLevels | null = null
  heartbeat: MeloHeartbeat | null = null
  nc: { on: boolean; level: number } | null = null
  streamIn: MeloStreamIn | null = null
  streamOut: MeloStreamOut | null = null
  txGains: [number, number] | null = null
  readonly leds = new Map<number, MeloLed>()
  noiseGate: MeloNoiseGate | null = null
  /** Last 0x1305 reply (iOS start-up read): the 0x1304 writes keep its rxSlave byte. */
  bitDepths: MeloBitDepths | null = null
  /** Every 0x600A reply by device type (hardware version and serial included). */
  readonly deviceInfo = new Map<number, ReturnType<typeof parseMeloDeviceInfo>>()
  private readonly listeners = new Set<MeloLevelListener>()

  bind(ctx: Ctx): void {
    this.ctx = ctx
  }

  onLevels(l: MeloLevelListener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  emitLevels(levels: MeloLevels): void {
    this.latestLevels = levels
    for (const l of [...this.listeners]) {
      try {
        l(levels)
      } catch (e) {
        this.ctx?.emitError(e as Error)
      }
    }
  }

  /**
   * The link dropped or was closed: the device stops pushing (a reconnect re-subscribes if levelsWanted), and the
   * structs are forgotten, so no read-modify-write after a reconnect starts from what an earlier session read.
   */
  linkDown(): void {
    this.levelsActive = false
    this.startupDone = false
    this.heartbeat = null
    this.nc = null
    this.streamIn = null
    this.streamOut = null
    this.txGains = null
    this.noiseGate = null
    this.bitDepths = null
    this.leds.clear()
  }
}

// ------------------------------------------------------------------------------ availability

const OK: ControlAvailability = { ok: true }
const noMic: ControlAvailability = {
  ok: false, reason: 'no-mic-online', message: 'Device not connected. This feature cannot be configured (no mic is online; R toast_device_offline)',
}
const unitOffline = (u: UnitId): ControlAvailability => ({ ok: false, reason: 'unit-offline', message: `${u} is not online` })
const tooNew = (min: string, what: string): ControlAvailability => ({
  ok: false, reason: 'firmware-too-new', message: `${what} is replaced from receiver firmware ${min} on`,
})

/**
 * Firmware gates and the official app's preconditions, from the last heartbeat, NC state and RX version:
 *  - NC switch, shared gain, MIC bit depth: a mic online (A MoreSettingActivity …$canOperateMicNoiseReductionGate,
 *    setSampleDepthEvent micSample24Btn / micSample32Btn (lambda$55$lambda$44 / 46, Version302 48 / 50), the gain
 *    buttons: R toast_device_offline). The OUTPUT bit depth has no such check: soundCardSample24Btn / 32Btn
 *    (lambda$55$lambda$52 / 54) open DialogShowingManager.showSampleBitRebootDeviceDialog directly.
 *  - NC level: NC on (R toast_mic_noise_reduc_switch_close)
 *  - noise gate: hidden from 4.0.0.1 (shown while the version is unknown, as isNewStructureFirmwareVersion is
 *    false for a blank version); the jack plugged (R instrument_plug_in_35mm) and set to input
 *    (R no_connect_35mm_output_port) (setNoiseGateEvent$canOperateNoiseGate); the threshold also needs the gate on
 *    (setNoiseGateEvent$lambda$37: noiseGateSwitchState CLOSE → R toast_noise_gate_switch_close)
 *  - 3.5 mm mode: something plugged in (set35mmPortEvent, R instrument_plug_in_35mm_set_input)
 *  - per-mic gain >= 3.0.7.9, per mic online (updateMicOnlineVisibility); shared gain < 3.0.7.9
 *  - mic LED rows, mic faders and mute: that mic online (LightSettingActivity switchPairedUpdateUi;
 *    HLVolumeListView shows only the online mic's fader)
 *  - LED brightness: that LED on (A larkc1/c6201/widget/view/HISeekbarItemView.updateSeekBarVisibility: the
 *    brightness tabs are INVISIBLE while the switch is off)
 */
export function meloAvailability(state: MicState, s: MeloSession): Partial<Record<ControlId, ControlAvailability>> {
  const hb = s.heartbeat
  const v = state.units.rx.version
  const out: Partial<Record<ControlId, ControlAvailability>> = {}
  const micsKnown = hb !== null
  const anyMic = hb ? hb.mic1Online || hb.mic2Online : true
  const micGate = micsKnown && !anyMic ? noMic : OK
  out[C.NC_ENABLED] = micGate
  out[C.NC_DEPTH] = micGate.ok && s.nc && !s.nc.on ? { ok: false, reason: 'noise-off', message: 'Please turn on noise cancellation' } : micGate
  out[C.MIC_BIT_DEPTH] = micGate
  // A MoreSettingActivity.setSampleDepthEvent$lambda$55$lambda$52 / 54 (soundCardSample24Btn / 32Btn): no mic check.
  out[C.OUTPUT_BIT_DEPTH] = OK

  const independent = meloIndependentGain(v)
  out[C.MIC_GAIN_PRESET] =
    independent === null ? versionGate(v, MELO_GATE.INDEPENDENT_TX_GAIN) : independent ? tooNew(MELO_GATE.INDEPENDENT_TX_GAIN, 'Mic Gain (Near / Mid / Far)') : micGate
  const perMic = versionGate(v, MELO_GATE.INDEPENDENT_TX_GAIN)
  out[C.MIC_GAIN] = perMic

  const v2 = meloStructure(v) === 'v2'
  const jack = (): ControlAvailability => {
    if (!hb) return OK
    if (!hb.conn35Online) return { ok: false, reason: 'jack-empty', message: 'Plug instrument into 3.5mm jack.' }
    if (hb.conn35DirOut) return { ok: false, reason: 'jack-output', message: 'The 3.5 mm jack is set to output' }
    return OK
  }
  const gate = v2 ? tooNew(MELO_GATE.NEW_STRUCTURE, 'Noise Gate') : jack()
  out[C.NOISE_GATE_ENABLED] = gate
  // A setNoiseGateEvent$lambda$37: canOperateNoiseGate first, then the switch state (R toast_noise_gate_switch_close).
  out[C.NOISE_GATE_THRESHOLD] =
    gate.ok && s.noiseGate && !s.noiseGate.enable ? { ok: false, reason: 'noise-gate-off', message: 'Please turn on the noise gate' } : gate
  out[C.JACK_MODE] = hb && !hb.conn35Online ? { ok: false, reason: 'jack-empty', message: 'Plug into 3.5mm, set 3.5mm to "Input".' } : OK

  for (const u of ['tx1', 'tx2'] as const) {
    const on = state.units[u]?.online
    const off = micsKnown && !on ? unitOffline(u) : undefined
    out[controlKey(C.MIC_GAIN, u)] = perMic.ok ? (off ?? OK) : perMic
    for (const id of [C.LED, C.LED_BRIGHTNESS, C.MIC_VOLUME, C.MIC_MUTE]) out[controlKey(id, u)] = off ?? OK
  }
  for (const u of ['rx', 'tx1', 'tx2'] as const) {
    const key = controlKey(C.LED_BRIGHTNESS, u)
    if (out[key] && !out[key]!.ok) continue
    const led = s.leds.get(MELO_LED_DEVICE[u]!)
    out[key] = led && !led.on ? { ok: false, reason: 'led-off', message: 'Turn the LED on to set its brightness' } : OK
  }
  return out
}

/**
 * Availability while replies are not delivered (write-only link): meloAvailability (firmware gates wait for an RX
 * version that cannot be read), plus 'state-unknown' for every write encodeMeloSet builds from a read structure
 * (NC switch + level, noise gate, bit depths, LEDs, track faders, output volumes), as encodeMeloSet refuses them.
 */
export function meloBlindAvailability(state: MicState, s: MeloSession): Partial<Record<ControlId, ControlAvailability>> {
  const out = meloAvailability(state, s)
  const unknown = (what: string): ControlAvailability => ({ ok: false, reason: 'state-unknown', message: `${what} cannot be read (replies are not delivered)` })
  const block = (id: ControlId, have: boolean, what: string) => {
    if (have) return
    for (const key of [id, ...(MELO_CONTROLS.find((c) => c.id === id)?.perUnit ?? []).map((u) => controlKey(id, u))]) {
      if (out[key]?.ok !== false) out[key] = unknown(what)
    }
  }
  block(C.NC_ENABLED, !!s.nc, 'the NC level')
  block(C.NOISE_GATE_ENABLED, !!s.noiseGate, 'the noise gate')
  block(C.NOISE_GATE_THRESHOLD, !!s.noiseGate, 'the noise gate')
  block(C.MIC_GAIN, !!s.txGains, 'the mic gains')
  block(C.MIC_BIT_DEPTH, !!s.heartbeat, 'the bit depths')
  block(C.OUTPUT_BIT_DEPTH, !!s.heartbeat, 'the bit depths')
  for (const id of [C.MIC_VOLUME, C.MIC_MUTE, C.INSTRUMENT_VOLUME, C.INSTRUMENT_MUTE, C.BGM_VOLUME, C.BGM_MUTE]) block(id, !!s.streamIn, 'the track faders')
  for (const id of [C.WIRELESS_OUT_VOLUME, C.WIRELESS_OUT_MUTE, C.WIRED_OUT_VOLUME, C.WIRED_OUT_MUTE, C.USB_OUT_VOLUME, C.USB_OUT_MUTE]) {
    block(id, !!s.streamOut, 'the output volumes')
  }
  for (const u of Object.keys(MELO_LED_DEVICE) as UnitId[]) {
    if (s.leds.get(MELO_LED_DEVICE[u]!)) continue
    for (const id of [C.LED, C.LED_BRIGHTNESS]) {
      const key = controlKey(id, u)
      if (out[key]?.ok !== false) out[key] = unknown(`the ${u} LED`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------------- mapping

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

const ledUnit = (device: number): UnitId | undefined => (Object.entries(MELO_LED_DEVICE) as [UnitId, number][]).find(([, d]) => d === device)?.[0]

function applyHeartbeat(ctx: Ctx, s: MeloSession, hb: MeloHeartbeat): void {
  s.heartbeat = hb
  const units: Partial<Record<UnitId, Partial<MicUnit>>> = {
    // A DeviceInfoDisplayMapper: the RX card shows rxPower when > 0.
    rx: { battery: hb.rxPower > 0 ? hb.rxPower : undefined },
    tx1: { online: hb.mic1Online, battery: hb.mic1Power, charging: hb.mic1Charge },
    tx2: { online: hb.mic2Online, battery: hb.mic2Power, charging: hb.mic2Charge },
    // No online flag for the case; boxPower > 0 is taken as present [I] (the app has no case card in the home list).
    box: { online: hb.boxPower > 0, battery: hb.boxPower > 0 ? hb.boxPower : undefined },
    // A DeviceInfoDisplayMapper: EP1 online for earConnectState 1 or 3, EP2 for 2 or 3.
    earL: { online: hb.earConnectState === 1 || hb.earConnectState === 3, battery: hb.earLPower, charging: hb.earLCharge },
    earR: { online: hb.earConnectState === 2 || hb.earConnectState === 3, battery: hb.earRPower, charging: hb.earRCharge },
    // Remote: connected flag and a low-battery bit only (rcIsLowVabt is in state.raw).
    remote: { online: hb.rcConnState },
  }
  ctx.patchUnits(units)
  const values: Partial<Record<ControlId, ControlValue>> = {}
  if (hb.mic1SamDepth === 0 || hb.mic1SamDepth === 1) values[C.MIC_BIT_DEPTH] = hb.mic1SamDepth
  if (hb.rxSamDepth === 0 || hb.rxSamDepth === 1) values[C.OUTPUT_BIT_DEPTH] = hb.rxSamDepth
  ctx.setValues(values)
  ctx.statusApplied(hb)
}

function applyStreamIn(ctx: Ctx, s: MeloSession, si: MeloStreamIn): void {
  s.streamIn = si
  // A HLVolumeItemView.setSeekBarValue: RangesKt.coerceIn(value, min, max).
  ctx.setValues({
    [controlKey(C.MIC_VOLUME, 'tx1')]: clamp(si.vol[0], 0, 24),
    [controlKey(C.MIC_VOLUME, 'tx2')]: clamp(si.vol[1], 0, 24),
    [C.INSTRUMENT_VOLUME]: clamp(si.vol[2], 0, 24),
    [C.BGM_VOLUME]: clamp(si.vol[3], 0, 16),
    [controlKey(C.MIC_MUTE, 'tx1')]: si.mute[0] === 1,
    [controlKey(C.MIC_MUTE, 'tx2')]: si.mute[1] === 1,
    [C.INSTRUMENT_MUTE]: si.mute[2] === 1,
    [C.BGM_MUTE]: si.mute[3] === 1,
  })
  const p: Partial<Record<UnitId, Partial<MicUnit>>> = {}
  if (ctx.state.units.tx1) p.tx1 = { muted: si.mute[0] === 1 }
  if (ctx.state.units.tx2) p.tx2 = { muted: si.mute[1] === 1 }
  ctx.patchUnits(p)
}

function applyStreamOut(ctx: Ctx, s: MeloSession, so: MeloStreamOut): void {
  s.streamOut = so
  ctx.setValues({
    [C.WIRELESS_OUT_VOLUME]: clamp(so.owsVol, 0, 40),
    [C.WIRELESS_OUT_MUTE]: so.owsMute === 1,
    [C.WIRED_OUT_VOLUME]: clamp(so.conn35OutVol, 0, 40),
    [C.WIRED_OUT_MUTE]: so.conn35OutMute === 1,
    [C.USB_OUT_VOLUME]: clamp(so.uacUpstreamVol, 0, 40),
    [C.USB_OUT_MUTE]: so.uacUpstreamMute === 1,
  })
}

function onMeloMessage(ctx: Ctx, s: MeloSession, msg: MomaMessage): void {
  const p = msg.payload
  const bad = (what: string) => ctx.note(`MELO P1: ${what} reply of ${p.length} bytes ignored`)
  switch (msg.cmd) {
    case MELO_CMD.HEARTBEAT: {
      const hb = parseMeloHeartbeat(p)
      if (!hb) return bad('heartbeat (needs 31)')
      applyHeartbeat(ctx, s, hb)
      break
    }
    case MELO_CMD.DEVICE_INFO: {
      const info = parseMeloDeviceInfo(p)
      if (!info) return bad('device info (needs 20)')
      s.deviceInfo.set(info.deviceType, info)
      const unit = meloUnitOfDeviceType(info.deviceType)
      // A Protocol6201SessionState.onDeviceInfoDecoded keeps the master version only when not blank.
      if (unit && info.swVersion) ctx.patchUnits({ [unit]: { version: info.swVersion, ...(info.serial ? { serial: info.serial } : {}) } })
      break
    }
    case MELO_CMD.NC_GET: {
      if (p.length < 2) return bad('NC')
      s.nc = { on: p[0] === 1, level: p[1] }
      ctx.setValues({ [C.NC_ENABLED]: s.nc.on, [C.NC_DEPTH]: clamp(s.nc.level, 5, 25) })
      break
    }
    case MELO_CMD.NOISE_GATE_GET: {
      const g = parseMeloNoiseGate(p)
      if (!g) return bad('noise gate (needs 20)')
      s.noiseGate = g
      ctx.setValues({ [C.NOISE_GATE_ENABLED]: g.enable, [C.NOISE_GATE_THRESHOLD]: clamp(Math.round(g.threshold), -80, -55) })
      break
    }
    case MELO_CMD.MIC_GAIN_GET: {
      const g = parseMeloI32(p)
      if (g === null) return bad('mic gain')
      // A MoreSettingActivity.updateMicGainSupView selects a button only for 20 / 26 / 32.
      if (g === 20 || g === 26 || g === 32) ctx.setValues({ [C.MIC_GAIN_PRESET]: g })
      else ctx.note(`MELO P1: mic gain ${g} is none of Near / Mid / Far`)
      break
    }
    case MELO_CMD.TX_GAIN_GET: {
      const g = parseMeloTxGains(p)
      if (!g) return bad('per-mic gain')
      s.txGains = g
      // A MoreSettingActivity.setupIndependentMicGainSeekbar: coerceIn(gain − 19, 1, 13) → 20..32 dB.
      ctx.setValues({ [controlKey(C.MIC_GAIN, 'tx1')]: clamp(g[0], 20, 32), [controlKey(C.MIC_GAIN, 'tx2')]: clamp(g[1], 20, 32) })
      break
    }
    case MELO_CMD.BIT_DEPTH_GET: {
      // I +[HL6201Messenger getDeviceSetInfo] reads it at start-up and keeps it as the uacBitEntity that the 0x1304
      // writes modify. The values come from the heartbeat (bytes 8 / 14), as on Android; only the struct is kept.
      const b = parseMeloBitDepths(p)
      if (!b) return bad('bit depths (needs 4)')
      s.bitDepths = b
      break
    }
    case MELO_CMD.AUTO_SPEAKER_GET: {
      const v = parseMeloI32(p)
      if (v === null) return bad('auto speaker')
      ctx.setValues({ [C.AUTO_SPEAKER]: v === 1 })
      break
    }
    case MELO_CMD.JACK_DIR_GET: {
      const v = parseMeloI32(p)
      if (v === null) return bad('3.5 mm mode')
      if (v === 0 || v === 1) ctx.setValues({ [C.JACK_MODE]: v })
      break
    }
    case MELO_CMD.WORK_MODE_GET: {
      // A CmdGetWorkMode6201: anything but 4 bytes is ProtocolData.Empty.
      if (p.length !== 4) return bad('work mode (needs 4)')
      const v = parseMeloI32(p)!
      if (v >= 0 && v <= 2) ctx.setValues({ [C.WORK_MODE]: v })
      break
    }
    case MELO_CMD.STREAM_IN_GET: {
      const si = parseMeloStreamIn(p)
      if (!si) return bad('track faders (needs 15)')
      applyStreamIn(ctx, s, si)
      break
    }
    case MELO_CMD.STREAM_OUT_GET: {
      const so = parseMeloStreamOut(p)
      if (!so) return bad('outputs (needs 6)')
      applyStreamOut(ctx, s, so)
      break
    }
    case MELO_CMD.LED_GET: {
      const values: Partial<Record<ControlId, ControlValue>> = {}
      for (const l of parseMeloLeds(p)) {
        const u = ledUnit(l.device)
        if (!u) continue
        s.leds.set(l.device, l)
        values[controlKey(C.LED, u)] = l.on
        if (l.brightness >= 0 && l.brightness <= 2) values[controlKey(C.LED_BRIGHTNESS, u)] = l.brightness
      }
      ctx.setValues(values)
      break
    }
    case MELO_CMD.VU_ALL_GET: {
      const l = parseMeloAllLevels(p)
      if (!l) return bad('VU (needs 26)')
      s.emitLevels({ ...l, cmd: msg.cmd, at: ctx.now() })
      return
    }
    case MELO_CMD.VU_INPUTS_GET: {
      const inputs = parseMeloInputLevels(p)
      if (inputs) s.emitLevels({ inputs, cmd: msg.cmd, at: ctx.now() })
      return
    }
    case MELO_CMD.VU_OUTPUTS_GET: {
      const outputs = parseMeloOutputLevels(p)
      if (outputs) s.emitLevels({ outputs, cmd: msg.cmd, at: ctx.now() })
      return
    }
    default:
      return
  }
  ctx.setAvailability(meloAvailability(ctx.state, s))
}

// ---------------------------------------------------------------------------------- writes

const stateUnknown = (id: ControlId, what: string) =>
  new ControlUnavailableError(id, 'state-unknown', `${id}: ${what} has not been read from the receiver yet (refresh('settings'))`)

function plan(req: MomaRequest, optimistic: Partial<Record<ControlId, ControlValue>>, readBack?: MomaRequest): WritePlan<MomaRequest> {
  return { requests: [req], optimistic, ...(readBack ? { readBack: { request: readBack } } : {}) }
}

function encodeMeloSet(s: MeloSession, id: ControlId, value: ControlValue, unit: UnitId | undefined): WritePlan<MomaRequest> {
  const n = value as number
  const b = value as boolean
  const key = controlKey(id, unit)
  switch (id) {
    case C.NC_ENABLED: {
      if (!s.nc) throw stateUnknown(id, 'the NC level (0x1301)')
      return plan(momaRequest(MELO_CMD.NC_SET, [b ? 1 : 0, s.nc.level]), { [id]: b }, meloGet(MELO_CMD.NC_GET))
    }
    case C.NC_DEPTH: {
      // Only offered with NC on (availability 'noise-off'), so the switch byte is 1, as in the app's dialog.
      return plan(momaRequest(MELO_CMD.NC_SET, [1, n]), { [id]: n, [C.NC_ENABLED]: true }, meloGet(MELO_CMD.NC_GET))
    }
    case C.NOISE_GATE_ENABLED:
    case C.NOISE_GATE_THRESHOLD: {
      const g = s.noiseGate
      if (!g) throw stateUnknown(id, 'the noise gate (0x1143)')
      const enable = id === C.NOISE_GATE_ENABLED ? b : g.enable
      const threshold = id === C.NOISE_GATE_THRESHOLD ? n : Math.round(g.threshold)
      return plan(momaRequest(MELO_CMD.NOISE_GATE_SET, meloNoiseGateSetPayload(enable, threshold)), { [id]: value }, meloNoiseGateGet())
    }
    case C.MIC_GAIN_PRESET:
      return plan(momaRequest(MELO_CMD.MIC_GAIN_SET, encodeMeloI32(n)), { [id]: n }, meloGet(MELO_CMD.MIC_GAIN_GET))
    case C.MIC_GAIN: {
      if (!s.txGains) throw stateUnknown(id, 'the mic gains (0x131A)')
      const g: [number, number] = [...s.txGains]
      g[unit === 'tx2' ? 1 : 0] = n
      return plan(momaRequest(MELO_CMD.TX_GAIN_SET, encodeMeloTxGains(g[0], g[1])), { [key]: n }, meloGet(MELO_CMD.TX_GAIN_GET))
    }
    case C.MIC_BIT_DEPTH:
    case C.OUTPUT_BIT_DEPTH: {
      const hb = s.heartbeat
      if (!hb) throw stateUnknown(id, 'the heartbeat')
      // tx1 / tx2 / rxM from the heartbeat, as A MoreSettingActivity.sampleEntity (a mic change sets both mics).
      // rxS (the second-port RX, PID 1033) follows iOS, not Android: A never sets it (always 0, which would put a
      // slave RX on 24-bit with every change); I HLFunctionSetView copies the new output depth into it
      // (rxRecordView block @0x1001dbc84 setRxMUacBit: → @0x1001dbc98 setRxSUacBit:(rxMUacBit)), and a mic change
      // keeps the uacBitEntity read with 0x1305 at start-up (@0x1001db650–0x1001db6cc). Without that read the output
      // depth stands in (what the iOS output change leaves there) [?].
      const mic = id === C.MIC_BIT_DEPTH ? { tx1: n, tx2: n } : { tx1: hb.mic1SamDepth, tx2: hb.mic2SamDepth }
      const rxMaster = id === C.OUTPUT_BIT_DEPTH ? n : hb.rxSamDepth
      const rxSlave = id === C.OUTPUT_BIT_DEPTH ? n : (s.bitDepths?.rxSlave ?? hb.rxSamDepth)
      const next: MeloBitDepths = { ...mic, rxMaster, rxSlave }
      return { requests: [momaRequest(MELO_CMD.BIT_DEPTH_SET, encodeMeloBitDepths(next))], optimistic: { [id]: n } }
    }
    case C.AUTO_SPEAKER:
      // Restarts the receiver: no read-back (the next connect reads 0x1311).
      return { requests: [momaRequest(MELO_CMD.AUTO_SPEAKER_SET, encodeMeloI32(b ? 1 : 0))], optimistic: { [id]: b } }
    case C.JACK_MODE:
      return plan(momaRequest(MELO_CMD.JACK_DIR_SET, encodeMeloI32(n)), { [id]: n }, meloGet(MELO_CMD.JACK_DIR_GET))
    case C.WORK_MODE:
      return plan(momaRequest(MELO_CMD.WORK_MODE_SET, encodeMeloI32(n)), { [id]: n }, meloGet(MELO_CMD.WORK_MODE_GET))
    case C.LED:
    case C.LED_BRIGHTNESS: {
      const u = unit ?? 'rx'
      const device = MELO_LED_DEVICE[u]
      if (device === undefined) throw new UnsupportedError(`${id}: no LED on ${u}`)
      const cur = s.leds.get(device)
      if (!cur) throw stateUnknown(id, `the ${u} LED (0x3004)`)
      // A brightness change keeps the switch as it is: I -[HLLightSetViewController soundView] slider block
      // @0x100061690–0x1000616b4 passes soundView.isOpen to +[HL6201Messenger sendLEDWithType:isOpen:value:]. A
      // LightSettingActivity sends switch = true, but only shows the brightness tabs while the switch is on
      // (availability 'led-off'), so both apps send the same bytes whenever the app offers the change.
      const led: MeloLed = id === C.LED ? { on: b, device, brightness: cur.brightness } : { on: cur.on, device, brightness: n }
      const optimistic: Partial<Record<ControlId, ControlValue>> = { [controlKey(C.LED, u)]: led.on, [controlKey(C.LED_BRIGHTNESS, u)]: led.brightness }
      return plan(momaRequest(MELO_CMD.LED_SET, encodeMeloLed(led)), optimistic, meloGet(MELO_CMD.LED_GET))
    }
    case C.MIC_VOLUME:
    case C.MIC_MUTE:
    case C.INSTRUMENT_VOLUME:
    case C.INSTRUMENT_MUTE:
    case C.BGM_VOLUME:
    case C.BGM_MUTE: {
      const cur = s.streamIn
      if (!cur) throw stateUnknown(id, 'the track faders (0x130B)')
      const track = id === C.MIC_VOLUME || id === C.MIC_MUTE ? (unit === 'tx2' ? 1 : 0) : id === C.INSTRUMENT_VOLUME || id === C.INSTRUMENT_MUTE ? 2 : 3
      const next: MeloStreamIn = { vol: [...cur.vol], mute: [...cur.mute], solo: [...cur.solo] }
      if (id === C.MIC_VOLUME || id === C.INSTRUMENT_VOLUME || id === C.BGM_VOLUME) next.vol[track] = n
      else next.mute[track] = b ? 1 : 0
      // A HLVolumeListView.setVolumeInMic*VolumeAndMute: vol[4] = the effect volume as read, mute[4] = 0, solo as read.
      next.mute[4] = 0
      return plan(momaRequest(MELO_CMD.STREAM_IN_SET, encodeMeloStreamIn(next)), { [key]: value }, meloGet(MELO_CMD.STREAM_IN_GET))
    }
    case C.WIRELESS_OUT_VOLUME:
    case C.WIRELESS_OUT_MUTE:
    case C.WIRED_OUT_VOLUME:
    case C.WIRED_OUT_MUTE:
    case C.USB_OUT_VOLUME:
    case C.USB_OUT_MUTE: {
      const cur = s.streamOut
      if (!cur) throw stateUnknown(id, 'the output volumes (0x1309)')
      const next: MeloStreamOut = { ...cur }
      if (id === C.WIRELESS_OUT_VOLUME) next.owsVol = n
      if (id === C.WIRELESS_OUT_MUTE) next.owsMute = b ? 1 : 0
      if (id === C.WIRED_OUT_VOLUME) next.conn35OutVol = n
      if (id === C.WIRED_OUT_MUTE) next.conn35OutMute = b ? 1 : 0
      if (id === C.USB_OUT_VOLUME) next.uacUpstreamVol = n
      if (id === C.USB_OUT_MUTE) next.uacUpstreamMute = b ? 1 : 0
      return plan(momaRequest(MELO_CMD.STREAM_OUT_SET, encodeMeloStreamOut(next)), { [id]: value }, meloGet(MELO_CMD.STREAM_OUT_GET))
    }
    default:
      throw new UnsupportedError(`${id} is not a MELO P1 control`)
  }
}

/**
 * A SET the receiver acknowledged becomes the struct the next read-modify-write starts from, so two writes in a
 * row (mic 1 fader, then mic 2 fader) compose instead of the second one reverting the first until the read-back
 * arrives. Blind writes get no ack and leave the structs as read; the structs cannot be read blind anyway.
 */
function applyAcknowledgedWrite(s: MeloSession, req: MomaRequest): void {
  for (const it of req.items) {
    const p = Uint8Array.from(it.payload ?? [])
    switch (it.cmd) {
      case MELO_CMD.NC_SET:
        if (p.length >= 2) s.nc = { on: p[0] === 1, level: p[1] }
        break
      case MELO_CMD.NOISE_GATE_SET:
        s.noiseGate = parseMeloNoiseGate(p) ?? s.noiseGate
        break
      case MELO_CMD.TX_GAIN_SET:
        s.txGains = parseMeloTxGains(p) ?? s.txGains
        break
      case MELO_CMD.STREAM_IN_SET:
        s.streamIn = parseMeloStreamIn(p) ?? s.streamIn
        break
      case MELO_CMD.STREAM_OUT_SET:
        s.streamOut = parseMeloStreamOut(p) ?? s.streamOut
        break
      case MELO_CMD.LED_SET:
        if (p.length >= 3) s.leds.set(p[1], { on: p[0] !== 0, device: p[1], brightness: p[2] })
        break
      case MELO_CMD.BIT_DEPTH_SET:
        // Until the next heartbeat reports the new depths (the receiver restarts on this one).
        if (s.heartbeat && p.length >= 4) s.heartbeat = { ...s.heartbeat, mic1SamDepth: p[0], mic2SamDepth: p[1], rxSamDepth: p[2] }
        break
    }
  }
  if (s.ctx) s.ctx.setAvailability(meloAvailability(s.ctx.state, s))
}

// ------------------------------------------------------------------------------------- spec

/** 0x600A replies echo the device type in payload[0]; TX1 / TX2 may answer as MIC1 / MIC2 (A DeviceRuntimeManager.updateDeviceInfoList). */
function deviceInfoMatches(requested: number, msg: MomaMessage): boolean {
  if (msg.payload.length < 20) return true // the app takes any short reply as "no info"
  const t = msg.payload[0]
  return t === requested || (requested === MELO_DEVICE_TYPE.TX1 && t === MELO_DEVICE_TYPE.MIC1) || (requested === MELO_DEVICE_TYPE.TX2 && t === MELO_DEVICE_TYPE.MIC2)
}

async function settleAll(ps: readonly Promise<unknown>[]): Promise<void> {
  const r = await Promise.allSettled(ps)
  const failed = r.find((x): x is PromiseRejectedResult => x.status === 'rejected')
  if (failed) throw failed.reason
}

export function createMeloSpec(profile: MomaProfile, s: MeloSession): ProtocolSpec<MomaRequest, MomaMessage> {
  const framing = createMomaSpecBase(profile, {
    commands: MELO_COMMANDS,
    matchItem: (it, msg) => it.cmd !== MELO_CMD.DEVICE_INFO || deviceInfoMatches(it.payload?.[0] ?? 0, msg),
    ack: (req, msg) => {
      const a = momaStatusAck(msg)
      if (a.ok) applyAcknowledgedWrite(s, req)
      return a
    },
    // Per-unit setters must not replace each other in the queue (A Protocol6201Provider skipQueueDistinct for 0x600A).
    coalesceKey: (r) =>
      r.items.map((it) => (it.cmd === MELO_CMD.LED_SET || it.cmd === MELO_CMD.DEVICE_INFO ? `${it.cmd}:${it.payload?.[it.cmd === MELO_CMD.LED_SET ? 1 : 0]}` : String(it.cmd))).join(','),
  })
  // A DeviceRuntimeManager.checkAllOnlineDeviceVersions order: master, (slave), TX1, TX2, remote, EP1, EP2. The slave
  // (type 2) is not asked: no unit models a second receiver, and a kit without one would leave the read unanswered.
  const unitIdentityReads = (state: MicState): MomaRequest[] =>
    MELO_IDENTITY_UNITS.filter((u) => state.units[u]?.online).map((u) => meloDeviceInfoRequest(MELO_UNIT_DEVICE_TYPE[u]!))
  return {
    ...framing,
    probe: meloHeartbeatRequest,
    heartbeat: { request: meloHeartbeatRequest, intervalMs: 3000 },
    async onConnected(ctx) {
      s.bind(ctx)
      const o = ctx.options
      const bg = { priority: 'background' } as const
      const reads: Promise<unknown>[] = []
      const identity = o.fetchIdentity ? ctx.request(meloDeviceInfoRequest(MELO_DEVICE_TYPE.SOUND_CARD_MASTER), bg).catch(noop) : Promise.resolve(null)
      if (o.fetchSettings) for (const r of meloStartupReads()) reads.push(ctx.request(r, bg).catch(noop))
      await identity
      ctx.setAvailability(meloAvailability(ctx.state, s))
      const gain = o.fetchSettings ? meloGainRead(ctx.state.units.rx.version) : null
      if (gain) reads.push(ctx.request(gain, bg).catch(noop))
      if (o.fetchIdentity) for (const r of unitIdentityReads(ctx.state)) reads.push(ctx.request(r, bg).catch(noop))
      await Promise.all(reads)
      s.startupDone = true
      if (s.levelsWanted) await startMeloLevels(ctx, s, s.levelsWanted.intervalMs).catch((e: unknown) => ctx.emitError(e as Error))
    },
    onMessage(ctx, msg) {
      s.bind(ctx)
      onMeloMessage(ctx, s, msg)
    },
    onUnitOnline(ctx, unit) {
      s.bind(ctx)
      // Units online at connect are read by onConnected (after the master); this covers units that come online later.
      if (!s.startupDone) return
      const type = MELO_UNIT_DEVICE_TYPE[unit]
      if (ctx.options.fetchIdentity && type !== undefined && unit !== 'rx') ctx.request(meloDeviceInfoRequest(type), { priority: 'background' }).catch(noop)
      // A LightSettingActivity re-reads 0x3004 when a mic comes online; the gain rows follow the mic too.
      if (ctx.options.fetchSettings && (unit === 'tx1' || unit === 'tx2')) {
        ctx.request(meloGet(MELO_CMD.LED_GET), { priority: 'background' }).catch(noop)
        const gain = meloGainRead(ctx.state.units.rx.version)
        if (gain) ctx.request(gain, { priority: 'background' }).catch(noop)
      }
    },
    async refresh(ctx, what) {
      s.bind(ctx)
      if (what === 'status') {
        await ctx.request(meloHeartbeatRequest())
        return
      }
      if (what === 'identity') {
        await ctx.request(meloDeviceInfoRequest(MELO_DEVICE_TYPE.SOUND_CARD_MASTER))
        await Promise.all(unitIdentityReads(ctx.state).map((r) => ctx.request(r).catch(noop)))
        ctx.setAvailability(meloAvailability(ctx.state, s))
        return
      }
      const reads = meloStartupReads()
      const gain = meloGainRead(ctx.state.units.rx.version)
      if (gain) reads.push(gain)
      await settleAll(reads.map((r) => ctx.request(r)))
    },
    encodeSet(ctx, id, value, o) {
      s.bind(ctx)
      return encodeMeloSet(s, id, value, o.unit)
    },
    blindAvailability: (ctx) => meloBlindAvailability(ctx.state, s),
    controls: () => MELO_CONTROLS,
    // Android: 200 ms per transfer (A protocol/core/parser/CommandExecutionConfig); 500 ms leaves room for BLE writes
    // with response (melo-6201.md §4.5).
    timing: { replyTimeoutMs: 500, probeTimeoutMs: 1000, interFrameDelayMs: 0 },
  }
}

// ------------------------------------------------------------------------------- VU stream

/**
 * Start the VU push as the mixer page does: 0x11E0 inputs + outputs on, then 0x6048 for 0x11EB
 * (A larkc1/c6201/v2/data/runtime/C6201VuSubscriptionCoordinator.reconcile: setVuChainType, then startCmdNotify;
 * A HLVolumeListView.getVolumeRecordVuData).
 */
export async function startMeloLevels(ctx: Ctx, s: MeloSession, intervalMs = 100): Promise<void> {
  s.levelsWanted = { intervalMs }
  for (const req of [meloVuSourceRequest(true, true), meloNotifyStartRequest([MELO_CMD.VU_ALL_GET], intervalMs)]) {
    const m = await ctx.request(req)
    if (m) {
      const a = momaStatusAck(m)
      if (!a.ok) throw new Error(`MELO P1 refused the VU subscription (${req.items[0].cmd === MELO_CMD.VU_SOURCE_SET ? '0x11E0' : '0x6048'}, code ${a.code})`)
    }
  }
  s.levelsActive = true
}

/** 0x6049: stops every push (A CmdSetNotifyStop6201; C6201VuSubscriptionCoordinator stopCmdNotify when no page needs VU). */
export async function stopMeloLevels(ctx: Ctx, s: MeloSession): Promise<void> {
  s.levelsWanted = null
  if (ctx.state.connected) await ctx.request(meloNotifyStopRequest())
  s.levelsActive = false
}
