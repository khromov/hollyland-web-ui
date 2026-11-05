/**
 * LegacyMicDevice: HollylandDevice (6118 / 6301 / 6302 / 6501) behind the common MicDevice interface
 * (docs/FAMILIES.md §0 #2). This class maps HollylandDevice's DeviceState to MicState and
 * `set(id, value)` to its typed setters. The wrapped device stays reachable as `.legacy` for
 * everything the generic interface does not cover (custom buttons, typed getters, OTA-free
 * diagnostics, DeviceState.forcedProfile).
 *
 * Safety: HollylandDevice's own rules apply unchanged (allowDestructive + confirm for restart,
 * unpair, factory reset; ReadOnlyError under a forced developer profile). On top of them,
 * FAMILIES.md §2.3: a hardware-untested product never gets destructive commands, and
 * firmware-update (OTA) frames are refused in sendRaw (see sendRaw for the console rules).
 */
import { OTA_DATA_MAGIC, Target, decodeFrame } from '../../codec'
import { COMMANDS } from '../../commands'
import {
  DestructiveCommandError, HollylandDevice, ReadOnlyError, UnsupportedError,
  type DeviceState, type HollylandDeviceOptions, type RxAvailability, type SetResult, type UnitInfo,
} from '../../device'
import { Emitter } from '../../emitter'
import { displayName, familyCodeOf, supportOf, type ProductInfo } from '../../models'
import type { Transport } from '../../transport'
import { CONTROL, controlById, validateControlValue, visibleControls } from '../../core/controls'
import { ControlUnavailableError } from '../../core/errors'
import type { FamilyCode, UnitId } from '../../core/ids'
import type {
  ControlAvailability, ControlId, ControlSpec, ControlValue, MicDevice, MicEvents, MicSetOptions, MicState, MicTrafficEntry,
  MicUnit, SupportInfo,
} from '../../core/types'
import { legacyControls } from './controls'

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

const TARGET_UNIT: Record<number, UnitId> = { [Target.RX]: 'rx', [Target.TX1]: 'tx1', [Target.TX2]: 'tx2' }

function toUnit(id: UnitId, u: UnitInfo): MicUnit {
  const out: MicUnit = { id, online: u.online }
  if (u.label !== undefined) out.label = u.label // Lark C1 2nd gen: Mic1/Mic2 swapped for display
  if (u.version !== undefined) out.version = u.version
  if (u.serial !== undefined) out.serial = u.serial
  if (u.battery !== undefined) out.battery = u.battery
  if (u.charging !== undefined) out.charging = u.charging
  if (u.muted !== undefined) out.muted = u.muted
  return out
}

/** DeviceState.settings → canonical control values. */
export function legacyValues(s: DeviceState): MicState['values'] {
  const v: MicState['values'] = {}
  const st = s.settings
  if (st.noiseEnabled !== undefined) v[CONTROL.NOISE_ENABLED] = st.noiseEnabled
  // While NC is off the heartbeat reads 0; the RX keeps the last level (PROTOCOL.md §11.7), so only a level > 0 is a value.
  if (st.noiseLevel !== undefined && st.noiseLevel > 0) v[CONTROL.NOISE_LEVEL] = st.noiseLevel
  if (st.volume !== undefined) v[CONTROL.VOLUME] = st.volume
  if (st.channelMode !== undefined) v[CONTROL.CHANNEL_MODE] = st.channelMode
  if (st.voicePreset) {
    v[CONTROL.PRESET_ENABLED] = st.voicePreset.enabled
    v[CONTROL.PRESET_STYLE] = st.voicePreset.preset
  }
  if (st.ledOn !== undefined) v[CONTROL.LED] = st.ledOn
  if (st.autoPowerOff !== undefined) v[CONTROL.AUTO_OFF] = st.autoPowerOff
  if (st.micRecognition !== undefined) v[CONTROL.MIC_RECOGNITION] = st.micRecognition
  if (st.smartBattery !== undefined) v[CONTROL.SMART_BATTERY] = st.smartBattery
  if (st.speakerPassthrough !== undefined) v[CONTROL.SPEAKER] = st.speakerPassthrough
  if (st.voiceLocked !== undefined) v[CONTROL.VOLUME_LOCK] = st.voiceLocked
  return v
}

const GATE_CONTROL: Readonly<Record<string, ControlId>> = {
  noiseToggle: CONTROL.NOISE_ENABLED,
  led: CONTROL.LED,
  voiceLock: CONTROL.VOLUME_LOCK,
}

/**
 * Firmware gates (DeviceState.featureGates) and the official apps' preconditions, mirroring
 * HollylandDevice.checkPreconditions and the setters that call it (device.ts). Advisory: the
 * wrapped device enforces them itself (PreconditionError).
 */
export function legacyAvailability(s: DeviceState): MicState['availability'] {
  const a: MicState['availability'] = {}
  if (s.readOnly) {
    // HollylandDeviceOptions.readOnly / forceProfile: every write is refused with ReadOnlyError.
    const message = s.forcedProfile
      ? `read-only: the ${s.forcedProfile.profile.name} profile is forced on a ${s.forcedProfile.actual.name}`
      : 'read-only: writes are disabled'
    for (const c of legacyControls(s.product)) a[c.id] = { ok: false, reason: 'read-only', message }
  }
  for (const [k, gate] of Object.entries(s.featureGates)) {
    const id = GATE_CONTROL[k]
    if (!id || gate === 'ok' || gate === undefined) continue
    a[id] = gate === 'version-unknown'
      ? { ok: false, reason: 'version-unknown', message: 'the receiver firmware version is not known yet' }
      : { ok: false, reason: 'firmware-too-old', message: `receiver firmware ${s.units.rx.version ?? '?'} is too old` }
  }
  if (s.rx !== 'available' || !s.heartbeat) return a
  const fam = s.product.family
  const caps = s.product.capabilities
  const { tx1, tx2 } = s.units
  const st = s.settings
  const noMic = !tx1.online && !tx2.online
  const online = [tx1, tx2].filter((u) => u.online)
  const allMuted = online.length > 0 && online.every((u) => u.muted === true)
  const block = (ids: readonly ControlId[], reason: string, message: string) => {
    for (const id of ids) if (!a[id]) a[id] = { ok: false, reason, message }
  }
  if (noMic) {
    const ids: ControlId[] = [CONTROL.NOISE_LEVEL, CONTROL.CHANNEL_MODE, CONTROL.PRESET_ENABLED, CONTROL.PRESET_STYLE, CONTROL.MIC_RECOGNITION]
    // Lark C1: volume needs no mic (A larkc1/HLDeviceActivity.isAllowSetVoice, Capabilities.volumeNeedsMic).
    if (caps?.volumeNeedsMic !== false) ids.push(CONTROL.VOLUME)
    if (fam === '6118') ids.push(CONTROL.LED, CONTROL.NOISE_ENABLED)
    if (fam === '6302') ids.push(CONTROL.NOISE_ENABLED)
    block(ids, 'mic-disconnected', 'no transmitter is online; the app refuses this setting')
  }
  if (fam === '6118' && allMuted) block([CONTROL.NOISE_LEVEL, CONTROL.NOISE_ENABLED], 'all-mics-muted', 'every online transmitter is muted')
  // Lark C1: no NC-off check (Capabilities.noiseLevelNeedsNcOn, iOS type < 3).
  if (st.noiseEnabled === false && caps?.noiseLevelNeedsNcOn !== false) {
    block([CONTROL.NOISE_LEVEL], 'noise-off', 'noise cancellation is off; turn it on before choosing a level')
  }
  if (fam !== '6118' && st.voiceLocked === true) block([CONTROL.VOLUME], 'volume-locked', 'the volume is locked')
  if (st.ledOn === false) block([CONTROL.MIC_RECOGNITION], 'led-off', 'Mic Recognition is offered only while the LED is on')
  return a
}

export function toMicState(s: DeviceState, family: FamilyCode): MicState {
  const units: MicState['units'] = {
    rx: toUnit('rx', s.units.rx),
    tx1: toUnit('tx1', s.units.tx1),
    tx2: toUnit('tx2', s.units.tx2),
  }
  return {
    product: s.product, family, connected: s.connected, rx: s.rx, missedHeartbeats: s.missedHeartbeats, lastStatusAt: s.lastHeartbeatAt,
    units, values: legacyValues(s), availability: legacyAvailability(s), raw: s.heartbeat ?? undefined,
  }
}

export class LegacyMicDevice implements MicDevice {
  /** The wrapped HollylandDevice (full legacy API). */
  readonly legacy: HollylandDevice
  readonly family: FamilyCode
  readonly support: SupportInfo
  readonly controls: readonly ControlSpec[]
  private readonly allControls: readonly ControlSpec[]
  private readonly events = new Emitter<MicEvents>()
  private cache: { from: DeviceState; state: MicState } | null = null
  private readonly unsubs: (() => void)[]

  constructor(transport: Transport, options?: HollylandDeviceOptions)
  constructor(device: HollylandDevice)
  constructor(a: Transport | HollylandDevice, options: HollylandDeviceOptions = {}) {
    this.legacy = a instanceof HollylandDevice ? a : new HollylandDevice(a, options)
    this.family = familyCodeOf(this.legacy.product) ?? '6118'
    this.support = supportOf(this.legacy.product)
    this.allControls = legacyControls(this.legacy.product)
    this.controls = visibleControls(this.allControls, this.support)
    const d = this.legacy
    this.unsubs = [
      d.on('state', () => this.events.emit('state', this.state)),
      d.on('heartbeat', (hb) => this.events.emit('status', hb)),
      d.on('tx-online', (t) => this.events.emit('unit-online', TARGET_UNIT[t])),
      d.on('tx-offline', (t) => this.events.emit('unit-offline', TARGET_UNIT[t])),
      d.on('rx-unavailable', () => this.events.emit('rx-unavailable')),
      d.on('unsolicited', (f) => this.events.emit('push', f)),
      d.on('error', (e) => this.events.emit('error', e)),
      d.on('disconnect', (r) => this.events.emit('disconnect', r)),
    ]
  }

  /** Detach from the wrapped HollylandDevice (when the wrapper is dropped but the device lives on). */
  dispose(): void {
    for (const u of this.unsubs.splice(0)) u()
    this.events.removeAll()
  }

  /** Wrap an existing HollylandDevice (e.g. the UI session's). */
  static wrap(device: HollylandDevice): LegacyMicDevice {
    return new LegacyMicDevice(device)
  }

  get product(): ProductInfo {
    return this.legacy.product
  }

  get transport(): Transport {
    return this.legacy.transport
  }

  get state(): MicState {
    const s = this.legacy.state
    if (this.cache?.from !== s) this.cache = { from: s, state: toMicState(s, this.family) }
    return this.cache.state
  }

  on<K extends keyof MicEvents>(event: K, listener: (...args: MicEvents[K]) => void): () => void {
    // Traffic goes straight to the wrapped device: it only logs while someone listens.
    if (event === 'traffic') return this.legacy.onTraffic(listener as (e: MicTrafficEntry) => void)
    return this.events.on(event, listener)
  }

  onTraffic(listener: (e: MicTrafficEntry) => void): () => void {
    return this.legacy.onTraffic(listener)
  }

  async connect(): Promise<MicState> {
    await this.legacy.connect()
    return this.state
  }

  disconnect(): Promise<void> {
    return this.legacy.disconnect()
  }

  probe(): Promise<RxAvailability> {
    return this.legacy.probe()
  }

  /**
   * 'status' is the heartbeat. On a product whose heartbeat carries no settings (Lark C1,
   * Capabilities.heartbeatSettings false) it also reads 0x11 and 0x04, where both apps take the NC
   * level and the volume from (legacy-6501.md §4).
   */
  async refresh(what: 'status' | 'identity' | 'settings'): Promise<void> {
    if (what === 'status') {
      await this.legacy.refreshStatus()
      if (this.product.family === '6501' && this.product.capabilities?.heartbeatSettings === false) {
        await this.legacy.getNoiseLevel()
        await this.legacy.getVolume()
      }
    } else if (what === 'identity') await this.legacy.getIdentity()
    else await this.legacy.getSettings()
  }

  pauseHeartbeat(): void {
    this.legacy.pauseHeartbeat()
  }

  resumeHeartbeat(): void {
    this.legacy.resumeHeartbeat()
  }

  /**
   * Console frames, with the engine's rules (core/engine.ts FamilyDevice.sendRaw) on top of
   * HollylandDevice.sendRaw (which still refuses anything but a catalogued read unless forced):
   *  - firmware upload is refused on every product, forced or not: catalogued 'ota' ids (0x08/0x09/0x0D)
   *    and the raw OTA data packet `55` + 63 bytes, which is not an AA DD frame (codec.ts OTA_DATA_MAGIC;
   *    A FileUtils.getDataWithIndex / USBHIDService.isLegacyRawOtaPacket; I +[HL6501Messenger
   *    sendUpgradeDataWithIndex:name:] @0x10008a63c);
   *  - 'notify' ids (0x0B, 0x0E, 0x0F) are device → host only;
   *  - on a hardware-untested product a forced frame must be a catalogued request of this product's family:
   *    destructive ids, uncatalogued ids, ids of another family (e.g. 0x19 NC toggle on a 6501 product,
   *    commands.ts WITH_6501) and bytes that are not an AA DD request are refused.
   * The wrapped HollylandDevice (`.legacy`) keeps its own, looser console rules for hardware exploration.
   */
  async sendRaw(frame: Uint8Array, o: { force?: boolean; timeoutMs?: number } = {}): Promise<void> {
    if (frame.length > 0 && frame[0] === OTA_DATA_MAGIC) {
      throw new DestructiveCommandError('a firmware data packet (0x55): firmware update is never sent by Mic Console')
    }
    const f = decodeFrame(frame)
    const request = f && f.direction === 'request' ? f : null
    const info = request ? COMMANDS[request.cmd] : undefined
    if (info?.safety === 'ota') throw new DestructiveCommandError(`${info.name} belongs to firmware update, which Mic Console never sends`)
    if (info?.safety === 'notify') throw new DestructiveCommandError(`${info.name} is sent by the device only`)
    if (this.support.hardware === 'untested' && o.force) {
      const name = displayName(this.product)
      if (!request) {
        throw new DestructiveCommandError(`these bytes cannot be classified and ${name} is not tested on hardware: refused`)
      }
      if (!info) {
        throw new DestructiveCommandError(`command 0x${hex2(request.cmd)} is not catalogued and ${name} is not tested on hardware: refused`)
      }
      if (info.safety === 'destructive') {
        throw new DestructiveCommandError(`${info.name} is destructive and ${name} is not tested on hardware: refused`)
      }
      const family = this.product.family
      if (family && !info.families.includes(family)) {
        throw new DestructiveCommandError(`${info.name} is not a ${family} command and ${name} is not tested on hardware: refused`)
      }
    }
    await this.legacy.sendRaw(frame, o)
  }

  async set(id: ControlId, value: ControlValue, o: MicSetOptions = {}): Promise<SetResult> {
    const control = controlById(this.controls, id)
    if (!control) {
      const hidden = controlById(this.allControls, id)
      if (hidden) throw new DestructiveCommandError(`${hidden.label} is destructive and ${displayName(this.product)} is not tested on hardware: refused`)
      throw new UnsupportedError(`${id} is not a control of ${displayName(this.product)}`)
    }
    const v = validateControlValue(control, value, o.unit)
    const gate: ControlAvailability | undefined = this.state.availability[id]
    // Forced developer profile / readOnly: HollylandDevice refuses it anyway; say so before any precondition.
    if (gate && !gate.ok && gate.reason === 'read-only') throw new ReadOnlyError(null, `${control.label}: ${gate.message ?? 'read-only'}`)
    // Firmware gates are enforced by HollylandDevice (UnsupportedError); report them with the generic error.
    if (gate && !gate.ok && (gate.reason === 'version-unknown' || gate.reason === 'firmware-too-old')) {
      throw new ControlUnavailableError(id, gate.reason, gate.message)
    }
    const d = this.legacy
    const confirm = o.confirm === true
    switch (id) {
      case CONTROL.NOISE_ENABLED:
        return d.setNoiseCancellation(v as boolean)
      case CONTROL.NOISE_LEVEL:
        return d.setNoiseLevel(v as number)
      case CONTROL.VOLUME:
        return d.setVolume(v as number)
      case CONTROL.CHANNEL_MODE:
        return d.setChannelMode(v as number)
      case CONTROL.PRESET_ENABLED:
        return d.setVoicePreset(v as boolean, d.state.settings.voicePreset?.preset ?? 0)
      case CONTROL.PRESET_STYLE:
        return d.setVoicePreset(d.state.settings.voicePreset?.enabled ?? true, v as number)
      case CONTROL.LED:
        return d.setLed(v as boolean)
      case CONTROL.AUTO_OFF:
        return d.setAutoPowerOff(v as boolean)
      case CONTROL.MIC_RECOGNITION:
        return d.setMicRecognition(v as boolean)
      case CONTROL.SMART_BATTERY:
        return d.setSmartBattery(v as boolean)
      case CONTROL.SPEAKER:
        return d.setSpeakerPassthrough(v as boolean)
      case CONTROL.VOLUME_LOCK:
        return d.setVoiceLock(v as boolean)
      case CONTROL.RESTART_RX:
        return d.restartRx({ confirm })
      case CONTROL.REMOVE_PAIRING:
        return d.removePairing(o.unit === 'tx2' ? 2 : 1, { confirm })
      case CONTROL.FACTORY_RESET:
        return d.factoryReset({ confirm })
      default:
        throw new UnsupportedError(`${id} has no legacy mapping`)
    }
  }
}
