/**
 * HollylandDevice: high-level, transport-agnostic controller for LARK A2 / A2S (6118),
 * Lark M2 (6301) and LARK M2S (6302) receivers. See docs/PROTOCOL.md §5 (session) and §9.
 *
 *  - one request in flight at a time (the firmware has no transaction ids; replies echo the
 *    command byte, so correlation is by command + source unit)
 *  - timeouts and retries (reads only; toggles and destructive commands are never resent)
 *  - user requests jump ahead of background polling; queued setters for the same command AND
 *    target are coalesced (narrower than Android UsbCommandQueue, which replaces any pending
 *    item with the same command byte, reads and other targets included; PROTOCOL.md §5.2)
 *  - runtime feature set: PID capabilities minus firmware-gated features (`features`)
 *  - the apps' UI preconditions (TX online, NC on, not locked…) enforced as PreconditionError
 *  - heartbeat poll (0x10) with TX online/offline detection and identity fetch per unit
 *  - typed events + a raw traffic hook for a debug console
 *  - "RX unavailable" mode: on macOS/Windows the OS HID stack drops the device's replies
 *    (report id 0xBB is not declared). Writes still reach the device; the class then reports
 *    `rx: 'unavailable'` and refuses unconfirmed writes unless `blindWrites` is enabled.
 */
import {
  decodeFrame, encodeRequest, FrameAssembler, Target, TARGET_NAMES, toHexTrimmed,
  type DecodedFrame, type RequestFrame,
} from './codec'
import {
  Cmd, COMMANDS, CommandError, Requests, commandName, describePayload, isReadOnlyCommand, isVersionMissing,
  parseButtonColors, parseDeviceId, parseDeviceInfo, parseFlagIsOne, parseHeartbeat, parseNoiseLevelGet6118,
  parseNoiseLevelGetM2, parseNoiseSetM2, parseSerial, parseSetAck, parseSpeakerGet, parseVersion6118, parseVersionLegacy,
  parseVoiceLockSetReply,
  type ButtonAssignment, type Family, type Heartbeat, type SetAck,
} from './commands'
import { Emitter } from './emitter'
import { resolveFeatures, resolveProduct, type Capabilities, type FeatureGateState, type GatedFeature, type ProductInfo } from './models'
import type { Transport } from './transport'

// ------------------------------------------------------------------------------------ types

export type RxAvailability = 'unknown' | 'available' | 'unavailable'

export interface UnitInfo {
  target: Target
  online: boolean
  version?: string
  serial?: string
  /** Percent; RX only on the camera receiver. */
  battery?: number
  charging?: boolean
  muted?: boolean
}

export interface Settings {
  noiseLevel?: number
  noiseEnabled?: boolean
  volume?: number
  channelMode?: number
  voicePreset?: { enabled: boolean; preset: number }
  ledOn?: boolean
  autoPowerOff?: boolean
  micRecognition?: boolean
  smartBattery?: boolean
  speakerPassthrough?: boolean
  voiceLocked?: boolean
  buttons?: [ButtonAssignment | undefined, ButtonAssignment | undefined]
  buttonColors?: { tx1: number; tx2: number }
  /** From 0x16 (iOS): 2 = camera RX. */
  rxVariant?: number
  /** 0x16 decoded with the iOS rule for this family (Lark M2 also needs LEN > 8). The PID stays authoritative. */
  rxCameraByDeviceInfo?: boolean
}

export interface DeviceState {
  product: ProductInfo
  connected: boolean
  rx: RxAvailability
  /** Consecutive heartbeat timeouts after the link had been up. */
  missedHeartbeats: number
  lastHeartbeatAt: number | null
  heartbeat: Heartbeat | null
  units: { rx: UnitInfo; tx1: UnitInfo; tx2: UnitInfo }
  settings: Settings
  /**
   * Runtime feature set: `product.capabilities` minus the firmware-gated features that the RX
   * version does not (yet) allow. Use this, not `product.capabilities`, to decide what to show.
   */
  features: Capabilities | null
  /** Why each firmware-gated feature is (un)available. */
  featureGates: Partial<Record<GatedFeature, FeatureGateState>>
}

export interface TrafficEntry {
  seq: number
  time: number
  direction: 'tx' | 'rx'
  bytes: Uint8Array
  hex: string
  frame: DecodedFrame | null
  summary: string
  /** 'reply' | 'duplicate' | 'unsolicited' | 'timeout' | 'raw' … */
  note?: string
}

export interface DeviceEvents {
  state: [DeviceState]
  heartbeat: [Heartbeat]
  'tx-online': [Target]
  'tx-offline': [Target]
  'rx-unavailable': []
  traffic: [TrafficEntry]
  unsolicited: [DecodedFrame]
  error: [Error]
  disconnect: [Error | undefined]
}

export interface SetResult {
  ok: boolean
  /** True when the device acknowledged; false for blind writes. */
  confirmed: boolean
  code: number | null
}

export interface HollylandDeviceOptions {
  /** Override PID-based product detection. */
  product?: ProductInfo
  requestTimeoutMs?: number
  /** Extra attempts for retry-safe commands. */
  retries?: number
  /** Pause between frames (iOS EADSessionManager usleep(20 ms)). */
  interFrameDelayMs?: number
  /** null disables polling; default = product heartbeat (1 s A2/M2S, 3 s M2). */
  heartbeatIntervalMs?: number | null
  /** Heartbeat timeouts before `missedHeartbeats` triggers an 'error' event. */
  heartbeatMissLimit?: number
  /** Append the iOS XOR byte (default false = exact Android bytes). */
  appendXor?: boolean
  /** Timeout for the initial heartbeat that detects whether replies are delivered. */
  probeTimeoutMs?: number
  /** Fetch versions / serials on connect and when a TX comes online (default true). */
  fetchIdentity?: boolean
  /** Fetch the extra GET-only settings (speaker, mic recognition, …) on connect (default true). */
  fetchSettings?: boolean
  /** Allow writes when replies cannot be received (results have confirmed = false). */
  blindWrites?: boolean
  /** Required (together with a per-call confirm flag) for restart / unpair / factory reset. */
  allowDestructive?: boolean
  /**
   * After a volume / noise-level / noise-toggle write is dispatched, ignore heartbeat volume,
   * noise level and noise on/off for this long (iOS isInUserConfigProtectWindow: 1 s, only those
   * three fields, cleared when the set fails).
   */
  userChangeProtectMs?: number
  /** Offer firmware-gated features even while the RX version is unknown or too old (default false). */
  ignoreFirmwareGates?: boolean
  /**
   * Refuse writes the official apps never send in the current state (no TX online, NC off,
   * volume locked, …) with PreconditionError (default true). Only checked once a heartbeat has
   * been seen.
   */
  enforcePreconditions?: boolean
  /** Pause before asking again for a version / serial that came back missing (iOS: 1 s). */
  identityRetryDelayMs?: number
  now?: () => number
}

export class TimeoutError extends Error {
  readonly cmd: number
  constructor(cmd: number, ms: number) {
    super(`no reply to ${commandName(cmd)} within ${ms} ms`)
    this.name = 'TimeoutError'
    this.cmd = cmd
  }
}

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedError'
  }
}

export class RxUnavailableError extends Error {
  constructor(message = 'device replies are not delivered on this platform (see PROTOCOL.md §2.4); enable blindWrites to send unconfirmed') {
    super(message)
    this.name = 'RxUnavailableError'
  }
}

export class DestructiveCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DestructiveCommandError'
  }
}

export type PreconditionReason =
  | 'mic-disconnected'
  | 'all-mics-muted'
  | 'noise-off'
  | 'volume-locked'
  | 'both-mics-required'
  | 'led-off'

/** A write the official apps refuse in the current device state (see enforcePreconditions). */
export class PreconditionError extends Error {
  readonly reason: PreconditionReason
  constructor(reason: PreconditionReason, message: string) {
    super(message)
    this.name = 'PreconditionError'
    this.reason = reason
  }
}

export class DisconnectedError extends Error {
  constructor(message = 'device disconnected') {
    super(message)
    this.name = 'DisconnectedError'
  }
}

type Priority = 'user' | 'background'

interface Waiter {
  resolve: (f: DecodedFrame | null) => void
  reject: (e: Error) => void
}

interface Job {
  frame: RequestFrame
  expectReply: boolean
  timeoutMs: number
  retries: number
  priority: Priority
  coalesce: boolean
  waiters: Waiter[]
}

interface Awaiting {
  job: Job
  resolve: (f: DecodedFrame) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** C6118DeviceRuntimeManager.MAX_REQUEST_RETRY_COUNT: separate budgets for version and serial. */
const MAX_IDENTITY_TRIES = 4
/** MoreSetting6118ViewModel.TOGGLE_CONFIRM_DELAY_MS */
const TOGGLE_CONFIRM_DELAY_MS = 150
/** MoreSetting6118ViewModel.FACTORY_RESET_RUNTIME_RECOVERY_DELAY_MS */
const FACTORY_RESET_RECOVERY_DELAY_MS = 1000
/** Fields covered by the iOS protect window (handleHeartbeatEntity @0x1000bc4bc skips exactly these). */
const PROTECTED_KEYS: readonly SettingKey[] = ['volume', 'noiseLevel', 'noiseEnabled']
/** Commands that open the protect window (-[HL6501Engine dispatchAction:] @0x1000bafec-0x1000bb110). */
const PROTECT_CMDS: ReadonlySet<number> = new Set([Cmd.VOLUME_SET, Cmd.NOISE_LEVEL_SET, Cmd.NOISE_TOGGLE])

type SettingKey = keyof Settings

// ------------------------------------------------------------------------------------ class

export class HollylandDevice {
  readonly transport: Transport
  readonly product: ProductInfo
  private readonly opts: Required<Omit<HollylandDeviceOptions, 'product' | 'heartbeatIntervalMs'>> & { heartbeatIntervalMs: number | null }
  private readonly events = new Emitter<DeviceEvents>()
  private readonly assembler = new FrameAssembler('packet')
  private readonly userQueue: Job[] = []
  private readonly bgQueue: Job[] = []
  private pumping = false
  private inflight: Job | null = null
  private awaiting: Awaiting | null = null
  private lastReply: { hex: string; time: number } | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatPauseCount = 0
  private heartbeatQueued = false
  private seq = 0
  private unsubs: (() => void)[] = []
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private versionTries: Record<Target, number> = { 0: 0, 1: 0, 2: 0 }
  private serialTries: Record<Target, number> = { 0: 0, 1: 0, 2: 0 }
  private identityRunning: Record<Target, boolean> = { 0: false, 1: false, 2: false }
  private readonly protectUntil: Partial<Record<SettingKey, number>> = {}
  private _state: DeviceState

  constructor(transport: Transport, options: HollylandDeviceOptions = {}) {
    this.transport = transport
    const info = transport.info
    this.product = options.product ?? resolveProduct(info?.vendorId ?? 0, info?.productId ?? 0)
    this.opts = {
      requestTimeoutMs: options.requestTimeoutMs ?? 500,
      retries: options.retries ?? 2,
      interFrameDelayMs: options.interFrameDelayMs ?? 20,
      heartbeatIntervalMs:
        options.heartbeatIntervalMs === undefined ? this.product.heartbeatIntervalMs || 1000 : options.heartbeatIntervalMs,
      heartbeatMissLimit: options.heartbeatMissLimit ?? 3,
      appendXor: options.appendXor ?? false,
      probeTimeoutMs: options.probeTimeoutMs ?? 1200,
      fetchIdentity: options.fetchIdentity ?? true,
      fetchSettings: options.fetchSettings ?? true,
      blindWrites: options.blindWrites ?? false,
      allowDestructive: options.allowDestructive ?? false,
      userChangeProtectMs: options.userChangeProtectMs ?? 1000,
      ignoreFirmwareGates: options.ignoreFirmwareGates ?? false,
      enforcePreconditions: options.enforcePreconditions ?? true,
      identityRetryDelayMs: options.identityRetryDelayMs ?? 1000,
      now: options.now ?? (() => Date.now()),
    }
    const unit = (t: Target): UnitInfo => ({ target: t, online: t === Target.RX })
    this._state = {
      product: this.product,
      connected: false,
      rx: 'unknown',
      missedHeartbeats: 0,
      lastHeartbeatAt: null,
      heartbeat: null,
      units: { rx: unit(Target.RX), tx1: unit(Target.TX1), tx2: unit(Target.TX2) },
      settings: {},
      features: null,
      featureGates: {},
    }
    this.recomputeFeatures(false)
  }

  // ------------------------------------------------------------------------------ events

  on<K extends keyof DeviceEvents>(event: K, listener: (...args: DeviceEvents[K]) => void): () => void {
    return this.events.on(event, listener)
  }

  /** Raw traffic hook (every TX and RX packet with a decoded summary). */
  onTraffic(listener: (entry: TrafficEntry) => void): () => void {
    return this.events.on('traffic', listener)
  }

  get state(): DeviceState {
    return this._state
  }

  get family(): Family | null {
    return this.product.family
  }

  /** Static capabilities of the PID (superset). See `features` for what the connected firmware allows. */
  get capabilities(): Capabilities | null {
    return this.product.capabilities
  }

  /** Runtime feature set (PID capabilities minus firmware-gated features not allowed by the RX version). */
  get features(): Capabilities | null {
    return this._state.features
  }

  get rx(): RxAvailability {
    return this._state.rx
  }

  // -------------------------------------------------------------------------- lifecycle

  /**
   * Open the transport, detect whether replies are delivered (heartbeat probe), then start
   * polling. There is no handshake or authentication in this protocol (PROTOCOL.md §5.1).
   */
  async connect(): Promise<DeviceState> {
    if (!this.product.family || !this.product.capabilities) {
      throw new UnsupportedError(`${this.product.name} (PID 0x${this.product.productId.toString(16)}) is not supported by this protocol`)
    }
    if (!this.transport.isOpen) await this.transport.open()
    this.unsubs.push(
      this.transport.onPacket((p) => this.handlePacket(p)),
      this.transport.onDisconnect((reason) => this.handleDisconnect(reason)),
    )
    this.patch({ connected: true })
    this.assembler.reset()

    // Probe: the heartbeat is the cheapest read-only command.
    try {
      const f = await this.request(Requests.heartbeat(), { timeoutMs: this.opts.probeTimeoutMs, retries: 1 })
      if (f) this.applyHeartbeatFrame(f)
      this.patch({ rx: 'available' })
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e
      this.patch({ rx: 'unavailable' })
      this.events.emit('rx-unavailable')
    }

    if (this._state.rx === 'available') {
      if (this.opts.fetchIdentity) void this.fetchIdentity(Target.RX)
      if (this.opts.fetchSettings) void this.fetchExtraSettings()
      this.startHeartbeat()
    }
    return this._state
  }

  /** Stop polling, reject pending requests and close the transport. */
  async disconnect(): Promise<void> {
    this.teardown(new DisconnectedError('closed by host'))
    await this.transport.close()
    this.patch({ connected: false })
  }

  /**
   * Re-run the reply-delivery probe (e.g. after the user switched browser/OS). Resolves to the
   * new availability and starts polling when replies arrive.
   */
  async probe(timeoutMs = this.opts.probeTimeoutMs): Promise<RxAvailability> {
    try {
      const f = await this.request(Requests.heartbeat(), { timeoutMs, retries: 0 })
      if (f) this.applyHeartbeatFrame(f)
      const wasAvailable = this._state.rx === 'available' && !!this.heartbeatTimer
      this.patch({ rx: 'available' })
      if (!wasAvailable) {
        if (this.opts.fetchIdentity) void this.fetchIdentity(Target.RX)
        if (this.opts.fetchSettings) void this.fetchExtraSettings()
      }
      if (!this.heartbeatTimer) this.startHeartbeat()
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e
      if (this._state.rx !== 'available') this.patch({ rx: 'unavailable' })
    }
    return this._state.rx
  }

  /** Number of queued + in-flight requests. */
  get pendingRequests(): number {
    return this.userQueue.length + this.bgQueue.length + (this.inflight ? 1 : 0)
  }

  /**
   * Pause the heartbeat poll. Calls nest (C6118RuntimeSession.pauseHeartbeat keeps a pauseCount);
   * polling resumes after the matching number of resumeHeartbeat() calls. Android pauses it for
   * the whole firmware upgrade (C6118OtaTrafficGate).
   */
  pauseHeartbeat(): void {
    this.heartbeatPauseCount++
  }

  resumeHeartbeat(): void {
    if (this.heartbeatPauseCount > 0) this.heartbeatPauseCount--
  }

  get heartbeatPaused(): boolean {
    return this.heartbeatPauseCount > 0
  }

  // ---------------------------------------------------------------------- generic request

  /**
   * Send one request and wait for the reply with the same command byte.
   * Resolves null when `expectReply` is false.
   */
  async request(
    frame: RequestFrame,
    o: { timeoutMs?: number; retries?: number; priority?: Priority; expectReply?: boolean; coalesce?: boolean } = {},
  ): Promise<DecodedFrame | null> {
    if (!this._state.connected) throw new DisconnectedError('not connected')
    const info = COMMANDS[frame.cmd]
    const retrySafe = info ? info.retrySafe : false
    const job: Job = {
      frame,
      expectReply: o.expectReply ?? true,
      timeoutMs: o.timeoutMs ?? this.opts.requestTimeoutMs,
      retries: retrySafe ? (o.retries ?? this.opts.retries) : 0,
      priority: o.priority ?? 'user',
      coalesce: o.coalesce ?? false,
      waiters: [],
    }
    const p = new Promise<DecodedFrame | null>((resolve, reject) => job.waiters.push({ resolve, reject }))
    this.enqueue(job)
    return p
  }

  /** Send arbitrary packet bytes. Refuses anything not catalogued as read-only unless force. */
  async sendRaw(packet: Uint8Array, o: { force?: boolean; timeoutMs?: number } = {}): Promise<DecodedFrame | null> {
    const f = decodeFrame(packet)
    if (!o.force && (!f || f.direction !== 'request' || !isReadOnlyCommand(f.cmd))) {
      throw new CommandError(`refusing to send ${f ? commandName(f.cmd) : 'non-AA DD packet'} without force (not read-only)`)
    }
    if (f && f.direction === 'request') {
      return this.request({ cmd: f.cmd, target: f.target, payload: f.payload }, { timeoutMs: o.timeoutMs })
    }
    await this.transport.send(packet)
    this.logTraffic('tx', packet, 'raw')
    return null
  }

  // ------------------------------------------------------------------------------ reads

  async refreshStatus(): Promise<Heartbeat> {
    const f = await this.read(Requests.heartbeat())
    return this.applyHeartbeatFrame(f)
  }

  async getFirmwareVersion(target: Target = Target.RX): Promise<string> {
    const fam = this.requireFamily()
    const f = await this.read(Requests.versionFor(fam, target))
    const v = fam === '6118' ? parseVersion6118(f.payload) : parseVersionLegacy(f.payload)
    if (!isVersionMissing(v)) this.patchUnit(this.unitOf(f, target), { version: v })
    return v
  }

  async getSerialNumber(target: Target = Target.RX): Promise<string> {
    const f = await this.read(Requests.serial(target))
    const s = parseSerial(f.payload, this.requireFamily())
    if (s) this.patchUnit(this.unitOf(f, target), { serial: s })
    return s
  }

  /**
   * 0x16 (iOS only; Android never sends it). iOS uses it to tell the camera RX apart
   * (getDeviceInitialInfo block @0x10008ac88, resolveDeviceHeaderImageWithPayload: @0x1000bd910).
   * Over USB the PID already does that, so the result is stored but does not change `features`.
   */
  async getDeviceInfo(): Promise<{ variant: number; cameraRx: boolean; raw: Uint8Array }> {
    const fam = this.requireFamily()
    const f = await this.read(Requests.deviceInfo())
    const d = parseDeviceInfo(f.payload, fam, f.length & 0xff)
    this.patchSettings({ rxVariant: d.variant, rxCameraByDeviceInfo: d.cameraRx })
    return d
  }

  /** 0x08: only useful for firmware upload, but read-only. */
  async getDeviceId(target: Target = Target.RX): Promise<{ id: number; raw: Uint8Array }> {
    return parseDeviceId((await this.read(Requests.deviceId(target))).payload)
  }

  /**
   * Noise-cancellation state. M2/M2S: 0x11 (Pro_get_noise). 6118: the heartbeat (body[6]), because
   * the apps decode the 6118's 0x11 reply in two incompatible ways and the Android A2 UI never
   * sends it (see parseNoiseLevelGet6118 / getNoiseLevelRaw).
   */
  async getNoiseLevel(): Promise<{ enabled: boolean; level: number }> {
    const fam = this.requireFamily()
    if (fam === '6118') {
      const hb = await this.refreshStatus()
      if (hb.family !== '6118' || !hb.valid.noise) throw new CommandError('heartbeat carried no valid noise level')
      return { enabled: hb.noiseEnabled, level: hb.noiseLevel }
    }
    const f = await this.read(Requests.noiseLevelGet())
    const r = parseNoiseLevelGetM2(f.payload)
    this.patchSettings({ noiseLevel: r.level, noiseEnabled: r.enabled })
    return { enabled: r.enabled, level: r.level }
  }

  /** Raw 0x11 reply, decoded both ways on the 6118 (no state change). For diagnostics. */
  async getNoiseLevelRaw(): Promise<ReturnType<typeof parseNoiseLevelGet6118> | ReturnType<typeof parseNoiseLevelGetM2>> {
    const fam = this.requireFamily()
    const f = await this.read(Requests.noiseLevelGet())
    return fam === '6118' ? parseNoiseLevelGet6118(f.payload) : parseNoiseLevelGetM2(f.payload)
  }

  async getVolume(): Promise<number> {
    const v = (await this.read(Requests.volumeGet())).payload[0] ?? 0
    this.patchSettings({ volume: v })
    return v
  }

  async getSpeakerPassthrough(): Promise<boolean> {
    const v = parseSpeakerGet((await this.read(Requests.speakerGet())).payload)
    this.patchSettings({ speakerPassthrough: v })
    return v
  }

  async getMicRecognition(): Promise<boolean> {
    this.requireFeature('micRecognition')
    const v = parseFlagIsOne((await this.read(Requests.micRecognitionGet())).payload)
    this.patchSettings({ micRecognition: v })
    return v
  }

  async getSmartBattery(): Promise<boolean> {
    this.requireFeature('smartBattery')
    const v = parseFlagIsOne((await this.read(Requests.smartBatteryGet())).payload)
    this.patchSettings({ smartBattery: v })
    return v
  }

  async getVoiceLock(): Promise<boolean> {
    const v = parseFlagIsOne((await this.read(Requests.voiceLockGet())).payload)
    this.patchSettings({ voiceLocked: v })
    return v
  }

  async getButtonColors(): Promise<{ tx1: number; tx2: number }> {
    this.requireFeature('customButtons')
    const v = parseButtonColors((await this.read(Requests.buttonColorsGet())).payload)
    this.patchSettings({ buttonColors: v })
    return v
  }

  /** Battery levels from a fresh heartbeat. */
  async getBattery(): Promise<{ tx1: number | null; tx2: number | null; rx: number | null }> {
    await this.refreshStatus()
    const u = this._state.units
    return {
      tx1: u.tx1.online ? (u.tx1.battery ?? null) : null,
      tx2: u.tx2.online ? (u.tx2.battery ?? null) : null,
      rx: this.product.capabilities?.rxBattery ? (u.rx.battery ?? null) : null,
    }
  }

  /** Version + serial for the RX and every online TX. */
  async getIdentity(): Promise<DeviceState['units']> {
    await this.refreshStatus()
    for (const t of [Target.RX, Target.TX1, Target.TX2] as Target[]) {
      if (!this.unit(t).online) continue
      await this.getFirmwareVersion(t).catch((e: unknown) => this.events.emit('error', e as Error))
      await this.getSerialNumber(t).catch((e: unknown) => this.events.emit('error', e as Error))
    }
    return this._state.units
  }

  /** Heartbeat + every GET-only setting the product supports. */
  async getSettings(): Promise<Settings> {
    await this.refreshStatus()
    await this.fetchExtraSettings('user')
    return this._state.settings
  }

  // ----------------------------------------------------------------------------- writes

  /**
   * Noise-cancellation strength. The apps only offer the level buttons while NC is on
   * (C6118DeviceActivity.updateNoiseView hides ctNoiseLevel; HLDeviceActivity strong/low_level
   * toast noise_is_closed_notice; HLDevice6302Activity.updateNoiseView hides noiseLevelBottom;
   * iOS HLLarkM2View noiseView block @0x1000cf3d0 toasts and does not send).
   */
  async setNoiseLevel(level: number): Promise<SetResult> {
    const fam = this.requireFamily()
    const max = this.requireFeature('noiseMaxLevel')
    if (level < 1 || level > max) throw new CommandError(`noise level must be 1..${max}`)
    this.checkPreconditions(fam === '6118' ? ['mic', 'not-all-muted', 'noise-on'] : ['mic', 'noise-on'])
    return this.write(Requests.noiseLevelSet(level, fam), { noiseLevel: level }, true)
  }

  /**
   * Turn noise cancellation on/off. The firmware only offers a TOGGLE (0x19 [02]), so the
   * current state must be known from a heartbeat; the call is a no-op when already in the
   * requested state. Refused in RX-unavailable mode (a blind toggle could invert the state).
   * The result comes from the heartbeat read right after the toggle (iOS shows "set successful"
   * for every 0x19 reply and also relies on the next heartbeat; handleConfigResponseEvent
   * @0x1000bcc48): `ok` = the heartbeat shows the requested state, `code` = the raw ack byte.
   */
  async setNoiseCancellation(enabled: boolean): Promise<SetResult> {
    const fam = this.requireFamily()
    this.requireFeature('noiseToggle')
    if (this._state.rx !== 'available') throw new RxUnavailableError('noise on/off is a toggle and needs a known current state')
    const hb = await this.refreshStatus()
    const current = hb.family === '6118' ? hb.noiseEnabled : (hb.noiseLevel ?? 0) > 0
    if (current === enabled) return { ok: true, confirmed: true, code: null }
    // 6118: resolveRxAndNoiseBlockReason; M2S: initView$lambda$4 (isAllMicOffline); Lark M2 and iOS M2: no check
    this.checkPreconditions(fam === '6118' ? ['mic', 'not-all-muted'] : fam === '6302' ? ['mic'] : [])
    const r = await this.write(Requests.noiseToggle(), {}, false)
    if (!r.confirmed) return r
    try {
      const after = await this.refreshStatus()
      const now = after.family === '6118' ? after.noiseEnabled : (after.noiseLevel ?? 0) > 0
      if (now === enabled) this.patchSettings({ noiseEnabled: enabled })
      return { ok: now === enabled, confirmed: true, code: r.code }
    } catch {
      return r
    }
  }

  /** RX output volume. Refused while the volume lock is on (HLDeviceActivity / HLDevice6302Activity.onClickBtnGroup; iOS voiceView block @0x1000cfb48). */
  async setVolume(step: number): Promise<SetResult> {
    const fam = this.requireFamily()
    const steps = this.requireFeature('volumeSteps')
    const frame = Requests.volumeSet(step, steps - 1)
    this.checkPreconditions(fam === '6118' ? ['mic'] : ['mic', 'not-locked'])
    return this.write(frame, { volume: step }, true)
  }

  async setChannelMode(mode: number): Promise<SetResult> {
    const fam = this.requireFamily()
    const modes = this.requireFeature('channelModes')
    if (!modes.includes(mode)) throw new UnsupportedError(`channel mode ${mode} not supported by ${this.product.name}`)
    this.checkPreconditions(['mic'])
    return this.write(Requests.channelModeSet(mode, fam), { channelMode: mode }, true)
  }

  async setVoicePreset(enabled: boolean, preset: number): Promise<SetResult> {
    this.requireFeature('voicePreset')
    const frame = Requests.voicePresetSet(enabled, preset)
    this.checkPreconditions(['mic'])
    return this.write(frame, { voicePreset: { enabled, preset } }, true)
  }

  /** LED. 6118: home-screen setting, needs a TX online. M2S: firmware > 2.0.0.9 (feature gate). */
  async setLed(on: boolean): Promise<SetResult> {
    const fam = this.requireFamily()
    this.requireFeature('led')
    if (fam === '6118') this.checkPreconditions(['mic'])
    return this.write(Requests.ledSet(on), { ledOn: on }, true)
  }

  /** "Mic Recognition": the A2 app shows it only while the LED is on (C6118DeviceActivityKt.shouldShowMicIdentifySection). */
  async setMicRecognition(on: boolean): Promise<SetResult> {
    this.requireFeature('micRecognition')
    this.checkPreconditions(['mic', 'led-on'])
    return this.write(Requests.micRecognitionSet(on), { micRecognition: on }, true)
  }

  /**
   * "Smart battery life" (LARK A2 1041 only). Like MoreSetting6118ViewModel.scheduleSmartBatteryRefresh,
   * 0x3E is read back 150 ms after the write (TOGGLE_CONFIRM_DELAY_MS).
   */
  async setSmartBattery(on: boolean): Promise<SetResult> {
    this.requireFeature('smartBattery')
    const r = await this.write(Requests.smartBatterySet(on), { smartBattery: on }, true)
    if (r.confirmed) this.scheduleReadBack(Requests.smartBatteryGet(), (f) => this.patchSettings({ smartBattery: parseFlagIsOne(f.payload) }))
    return r
  }

  async setAutoPowerOff(enabled: boolean): Promise<SetResult> {
    this.requireFeature('autoPowerOff')
    return this.write(Requests.autoOffSet(enabled), { autoPowerOff: enabled }, true)
  }

  /**
   * Volume lock: camera receivers only (M2 PID 8/33 with RX firmware > 2.0.0.31, M2S PID 1030).
   * The reply is read with parseVoiceLockSetReply (iOS decodes the Lark M2 reply as the new state).
   */
  async setVoiceLock(locked: boolean): Promise<SetResult> {
    const fam = this.requireFamily()
    this.requireFeature('voiceLock')
    return this.write(Requests.voiceLockSet(locked), { voiceLocked: locked }, true, {
      parseAck: (p) => parseVoiceLockSetReply(p, fam, locked),
    })
  }

  /**
   * M2S custom button: write function slot 1 or 2 (heartbeat bytes 11/12), or slot 0 for the
   * colour-only update. The app opens the editor only with both TXs online
   * (HLDevice6302Activity.initView$lambda$20) and closes it when one drops (CustomFunctionActivity.onResHeartInfo).
   */
  async setCustomButton(b: { index: 0 | 1 | 2; func: number; keyOp: number; tx1Color: number; tx2Color: number }): Promise<SetResult> {
    this.requireFeature('customButtons')
    const frame = Requests.buttonCustomSet(b)
    this.checkPreconditions(['both-mics'])
    const optimistic: Settings = b.index === 0 ? { buttonColors: { tx1: b.tx1Color, tx2: b.tx2Color } } : {}
    return this.write(frame, optimistic, false)
  }

  /** M2S TX identify colours (CustomFunctionActivity.sendColor): `37 [00 00 00 c1 c2]`, pairs (1,2) or (2,1) only. */
  async setButtonColors(tx1Color: number, tx2Color: number): Promise<SetResult> {
    return this.setCustomButton({ index: 0, func: 0, keyOp: 0, tx1Color, tx2Color })
  }

  /**
   * Speaker passthrough ("External speaker without unplugging"). The setting only takes effect
   * after an RX restart; the Android app restarts 3 s after a successful set. Pass
   * `{ restart: true, confirm: true }` (with allowDestructive) to do the same. After a failed set
   * 0x13 is read back 150 ms later (MoreSetting6118ViewModel.scheduleAutoSpeakerRefresh).
   */
  async setSpeakerPassthrough(on: boolean, o: { restart?: boolean; confirm?: boolean } = {}): Promise<SetResult> {
    this.requireFeature('speakerPassthrough')
    if (o.restart) this.requireDestructive('restartRx', o.confirm === true)
    const r = await this.write(Requests.speakerSet(on), { speakerPassthrough: on }, true)
    if (r.confirmed && !r.ok) {
      this.scheduleReadBack(Requests.speakerGet(), (f) => this.patchSettings({ speakerPassthrough: parseSpeakerGet(f.payload) }))
    }
    if (r.ok && o.restart) {
      await sleep(3000)
      await this.restartRx({ confirm: o.confirm === true })
    }
    return r
  }

  // ------------------------------------------------------------ disruptive / destructive

  /** Reboots the receiver; the transport will disconnect. */
  async restartRx(o: { confirm: boolean }): Promise<SetResult> {
    this.requireDestructive('restartRx', o.confirm)
    return this.write(Requests.restartRx(), {}, false, { expectReply: false })
  }

  /** Removes the pairing of TX1 or TX2. The mic must be re-paired on the hardware. 6118 only. */
  async removePairing(tx: 1 | 2, o: { confirm: boolean }): Promise<SetResult> {
    this.requireDestructive('removePairing', o.confirm)
    return this.write(Requests.removePairing(tx), {}, false)
  }

  /**
   * Factory reset of the receiver. 6118 only. After a success the cached identity and settings
   * are dropped and re-read 1 s later (MoreSetting6118ViewModel.startFactoryResetRuntimeRecovery:
   * shut the runtime down, wait FACTORY_RESET_RUNTIME_RECOVERY_DELAY_MS = 1000, rebuild the
   * session. In 3.1.0 that method has no call site; the library does it anyway since it only reads).
   */
  async factoryReset(o: { confirm: boolean }): Promise<SetResult> {
    this.requireDestructive('factoryReset', o.confirm)
    const r = await this.write(Requests.factoryReset(), {}, false)
    if (r.ok && r.confirmed) void this.recoverAfterFactoryReset()
    return r
  }

  // ---------------------------------------------------------------------------- internals

  private requireFamily(): Family {
    if (!this.product.family) throw new UnsupportedError(`${this.product.name} is not supported`)
    return this.product.family
  }

  private requireCap<K extends keyof Capabilities>(k: K): Capabilities[K] {
    const caps = this.product.capabilities
    const v = caps?.[k]
    if (!caps || v === false || v === 0 || (Array.isArray(v) && v.length === 0)) {
      throw new UnsupportedError(`${String(k)} is not supported by ${this.product.name}`)
    }
    return v as Capabilities[K]
  }

  /** Like requireCap, but against the runtime feature set (firmware gates applied). */
  private requireFeature<K extends keyof Capabilities>(k: K): Capabilities[K] {
    const caps = this.requireCap(k)
    const f = this._state.features
    const v = f?.[k]
    if (!f || v === false || v === 0 || (Array.isArray(v) && v.length === 0)) {
      const gate = this._state.featureGates[k as GatedFeature]
      const why = gate === 'version-unknown'
        ? 'the RX firmware version is not known yet'
        : gate === 'firmware-too-old' ? `RX firmware ${this._state.units.rx.version ?? '?'} is too old` : 'not available'
      throw new UnsupportedError(`${String(k)} on ${this.product.name}: ${why} (PROTOCOL.md §4)`)
    }
    return caps
  }

  /**
   * The official apps' UI preconditions. Checked only when enforcePreconditions is on, replies
   * are delivered and a heartbeat has been seen (otherwise the state is unknown).
   *  mic: at least one TX online (HLDevice6118ViewModel.resolveMicRequiredBlockReason;
   *       HLDevice6302Activity.isAllMicOffline; HLDeviceActivity tx1Status/tx2Status;
   *       iOS +[HLLarkProtocolHelper isAllTXDisonline] @0x1000d2bc8, HLLarkM2View blocks)
   *  not-all-muted: 6118 noise settings (resolveRxAndNoiseBlockReason ALL_ONLINE_MIC_MUTED; iOS toast @0x100669c8c)
   *  noise-on / not-locked / both-mics / led-on: see the setters.
   */
  private checkPreconditions(checks: readonly ('mic' | 'not-all-muted' | 'noise-on' | 'not-locked' | 'both-mics' | 'led-on')[]): void {
    if (!this.opts.enforcePreconditions || this._state.rx !== 'available' || !this._state.heartbeat) return
    const { tx1, tx2 } = this._state.units
    const s = this._state.settings
    for (const c of checks) {
      if (c === 'mic' && !tx1.online && !tx2.online) {
        throw new PreconditionError('mic-disconnected', 'no transmitter is online; the app refuses this setting')
      }
      if (c === 'not-all-muted') {
        const online = [tx1, tx2].filter((u) => u.online)
        if (online.length && online.every((u) => u.muted === true)) {
          throw new PreconditionError('all-mics-muted', 'every online transmitter is muted; the app refuses noise settings')
        }
      }
      if (c === 'noise-on' && s.noiseEnabled === false) {
        throw new PreconditionError('noise-off', 'noise cancellation is off; turn it on before choosing a level')
      }
      if (c === 'not-locked' && s.voiceLocked === true) throw new PreconditionError('volume-locked', 'the volume is locked')
      if (c === 'both-mics' && !(tx1.online && tx2.online)) {
        throw new PreconditionError('both-mics-required', 'the app edits custom buttons only while both transmitters are online')
      }
      if (c === 'led-on' && s.ledOn === false) {
        throw new PreconditionError('led-off', 'Mic Recognition is offered only while the LED is on')
      }
    }
  }

  private requireDestructive(k: 'restartRx' | 'removePairing' | 'factoryReset', confirm: boolean): void {
    this.requireCap(k)
    if (!this.opts.allowDestructive || confirm !== true) {
      throw new DestructiveCommandError(`${k} is destructive: construct the device with allowDestructive and pass { confirm: true }`)
    }
  }

  private async read(frame: RequestFrame): Promise<DecodedFrame> {
    if (this._state.rx === 'unavailable') throw new RxUnavailableError()
    const f = await this.request(frame)
    if (!f) throw new TimeoutError(frame.cmd, 0)
    return f
  }

  private async write(
    frame: RequestFrame,
    optimistic: Settings,
    coalesce: boolean,
    o: { expectReply?: boolean; parseAck?: (payload: Uint8Array) => SetAck } = {},
  ): Promise<SetResult> {
    const info = COMMANDS[frame.cmd]
    const blind = this._state.rx === 'unavailable'
    if (blind && !this.opts.blindWrites) throw new RxUnavailableError()
    if (blind && info?.toggle) throw new RxUnavailableError(`${info.name} is a toggle and cannot be sent blind`)
    const expectReply = o.expectReply ?? !blind
    // iOS opens the protect window when the action is dispatched, for 0x05 / 0x06 / 0x19 only.
    const protects = PROTECT_CMDS.has(frame.cmd) && this.opts.userChangeProtectMs > 0
    if (protects) {
      const until = this.opts.now() + this.opts.userChangeProtectMs
      for (const k of PROTECTED_KEYS) this.protectUntil[k] = until
    }
    const f = await this.request(frame, { expectReply, coalesce })
    let ack: SetAck = { ok: true, code: null }
    if (f) ack = o.parseAck ? o.parseAck(f.payload) : this.parseAckFor(frame.cmd, f.payload)
    if (ack.ok) {
      this.patchSettings(optimistic)
    } else if (protects) {
      // handleConfigResponseEvent @0x1000bcd24-0x1000bcd50: failed 0x05/0x06/0x19 -> setLastUserConfigSetTime:nil
      for (const k of PROTECTED_KEYS) delete this.protectUntil[k]
    }
    return { ok: ack.ok, confirmed: !!f, code: ack.code }
  }

  /** Set-ack decoding per command and family. */
  private parseAckFor(cmd: number, payload: Uint8Array): SetAck {
    if (cmd === Cmd.NOISE_LEVEL_SET && this.product.family !== '6118') {
      // Pro_set_noise.receiveData needs [status, level]
      const r = parseNoiseSetM2(payload)
      return { ok: r.ok, code: payload.length ? payload[0] : null }
    }
    return parseSetAck(payload) // Base6118UsbCmd.parseSetResponse / Pro_set_*: payload[0] == 1
  }

  /** Background read-back of a setting (MoreSetting6118ViewModel TOGGLE_CONFIRM_DELAY_MS = 150). */
  private scheduleReadBack(frame: RequestFrame, apply: (f: DecodedFrame) => void, delayMs = TOGGLE_CONFIRM_DELAY_MS): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      if (!this._state.connected || this._state.rx !== 'available') return
      this.request(frame, { priority: 'background' })
        .then((f) => f && apply(f))
        .catch(() => undefined)
    }, delayMs)
    this.timers.add(t)
  }

  private async recoverAfterFactoryReset(): Promise<void> {
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t)
        resolve()
      }, FACTORY_RESET_RECOVERY_DELAY_MS)
      this.timers.add(t)
    })
    if (!this._state.connected || this._state.rx !== 'available') return
    const clear = (u: UnitInfo): UnitInfo => ({ ...u, version: undefined, serial: undefined })
    const units = this._state.units
    this._state = { ...this._state, settings: {}, units: { rx: clear(units.rx), tx1: clear(units.tx1), tx2: clear(units.tx2) } }
    this.versionTries = { 0: 0, 1: 0, 2: 0 }
    this.serialTries = { 0: 0, 1: 0, 2: 0 }
    this.recomputeFeatures()
    try {
      await this.refreshStatus()
    } catch {
      return
    }
    if (this.opts.fetchIdentity) {
      for (const t of [Target.RX, Target.TX1, Target.TX2] as Target[]) if (this.unit(t).online) void this.fetchIdentity(t)
    }
    if (this.opts.fetchSettings) void this.fetchExtraSettings()
  }

  private enqueue(job: Job): void {
    const q = job.priority === 'user' ? this.userQueue : this.bgQueue
    if (job.coalesce) {
      const i = q.findIndex((j) => j.coalesce && j.frame.cmd === job.frame.cmd && j.frame.target === job.frame.target)
      if (i >= 0) {
        const [old] = q.splice(i, 1)
        job.waiters.unshift(...old.waiters)
      }
    }
    q.push(job)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      for (;;) {
        const job = this.userQueue.shift() ?? this.bgQueue.shift()
        if (!job) break
        if (!this._state.connected) {
          for (const w of job.waiters) w.reject(new DisconnectedError())
          continue
        }
        this.inflight = job
        try {
          const res = await this.execute(job)
          for (const w of job.waiters) w.resolve(res)
        } catch (e) {
          for (const w of job.waiters) w.reject(e as Error)
        } finally {
          this.inflight = null
        }
        if (this.opts.interFrameDelayMs > 0) await sleep(this.opts.interFrameDelayMs)
      }
    } finally {
      this.pumping = false
    }
  }

  private async execute(job: Job): Promise<DecodedFrame | null> {
    const packet = encodeRequest(job.frame, { appendXor: this.opts.appendXor })
    const attempts = 1 + job.retries
    for (let a = 0; a < attempts; a++) {
      const reply = job.expectReply ? this.awaitReply(job) : null
      try {
        await this.transport.send(packet)
      } catch (e) {
        this.cancelAwait()
        throw e
      }
      this.logTraffic('tx', packet, a > 0 ? `retry ${a}` : undefined)
      if (!reply) return null
      try {
        return await reply
      } catch (e) {
        if (!(e instanceof TimeoutError) || a === attempts - 1) throw e
      }
    }
    return null
  }

  private awaitReply(job: Job): Promise<DecodedFrame> {
    return new Promise<DecodedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.awaiting?.job === job) this.awaiting = null
        this.events.emit('traffic', {
          seq: ++this.seq, time: this.opts.now(), direction: 'rx', bytes: new Uint8Array(0), hex: '', frame: null,
          summary: `timeout waiting for ${commandName(job.frame.cmd)} (${job.timeoutMs} ms)`, note: 'timeout',
        })
        reject(new TimeoutError(job.frame.cmd, job.timeoutMs))
      }, job.timeoutMs)
      this.awaiting = { job, resolve, reject, timer }
    })
  }

  private cancelAwait(): void {
    if (this.awaiting) clearTimeout(this.awaiting.timer)
    this.awaiting = null
  }

  private handlePacket(packet: Uint8Array): void {
    const frames = this.assembler.push(packet)
    if (!frames.length) {
      this.logTraffic('rx', packet, 'unparsed')
      return
    }
    for (const f of frames) this.handleFrame(f)
  }

  private handleFrame(f: DecodedFrame): void {
    if (this._state.rx !== 'available' && this._state.connected) this.patch({ rx: 'available' })
    const a = this.awaiting
    if (a && f.direction === 'response' && f.cmd === a.job.frame.cmd) {
      clearTimeout(a.timer)
      this.awaiting = null
      this.lastReply = { hex: toHexTrimmed(f.raw), time: this.opts.now() }
      this.logTraffic('rx', f.raw, 'reply', f)
      a.resolve(f)
      return
    }
    // The live A2 produces two interrupt-IN reports per request (PROTOCOL.md §11): treat an
    // identical frame shortly after a reply as a duplicate.
    const hex = toHexTrimmed(f.raw)
    if (this.lastReply && this.lastReply.hex === hex && this.opts.now() - this.lastReply.time < 1000) {
      this.logTraffic('rx', f.raw, 'duplicate', f)
      return
    }
    this.logTraffic('rx', f.raw, 'unsolicited', f)
    if (f.direction === 'response' && f.cmd === Cmd.HEARTBEAT) this.applyHeartbeatFrame(f)
    this.events.emit('unsolicited', f)
  }

  private handleDisconnect(reason?: Error): void {
    this.teardown(new DisconnectedError(reason?.message ?? 'device disconnected'))
    this.patch({ connected: false })
    this.events.emit('disconnect', reason)
  }

  private teardown(err: Error): void {
    this.stopHeartbeat()
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    for (const u of this.unsubs.splice(0)) u()
    const a = this.awaiting
    if (a) {
      clearTimeout(a.timer)
      this.awaiting = null
      a.reject(err)
    }
    for (const q of [this.userQueue, this.bgQueue]) {
      for (const j of q.splice(0)) for (const w of j.waiters) w.reject(err)
    }
  }

  // --------------------------------------------------------------------------- heartbeat

  private startHeartbeat(): void {
    this.stopHeartbeat()
    const iv = this.opts.heartbeatIntervalMs
    if (iv === null || iv <= 0) return
    const tick = () => {
      this.heartbeatTimer = setTimeout(tick, iv)
      if (this.heartbeatPauseCount > 0 || this.heartbeatQueued || !this._state.connected) return
      this.heartbeatQueued = true
      this.request(Requests.heartbeat(), { priority: 'background', retries: 0 })
        .then((f) => {
          if (f) this.applyHeartbeatFrame(f)
          if (this._state.missedHeartbeats) this.patch({ missedHeartbeats: 0 })
        })
        .catch((e: unknown) => {
          if (e instanceof TimeoutError) {
            const n = this._state.missedHeartbeats + 1
            this.patch({ missedHeartbeats: n })
            if (n === this.opts.heartbeatMissLimit) this.events.emit('error', new Error(`${n} heartbeats without reply`))
          } else if (!(e instanceof DisconnectedError)) {
            this.events.emit('error', e as Error)
          }
        })
        .finally(() => {
          this.heartbeatQueued = false
        })
    }
    this.heartbeatTimer = setTimeout(tick, iv)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private applyHeartbeatFrame(f: DecodedFrame): Heartbeat {
    const fam = this.requireFamily()
    const hb = parseHeartbeat(fam, f.payload)
    const prev = this._state.units
    const now = this.opts.now()
    const tx = (u: UnitInfo, t: Heartbeat['tx'][number], flagsValid: boolean): UnitInfo => ({
      ...u,
      online: t.online,
      battery: t.battery,
      // muted / charging exist only in the 6118 heartbeat (body[15]); M2/M2S leave them unknown.
      charging: flagsValid ? t.charging : undefined,
      muted: flagsValid ? t.muted : undefined,
    })
    const flagsValid = hb.family === '6118' && hb.valid.flags
    const units = {
      rx: { ...prev.rx, online: true },
      tx1: tx(prev.tx1, hb.tx[0], flagsValid),
      tx2: tx(prev.tx2, hb.tx[1], flagsValid),
    }
    const s: Settings = {}
    if (hb.family === '6118') {
      // Apply only what is present / plausible (iOS HLHeartEntity + handleHeartbeatEntity validation).
      const v = hb.valid
      if (v.noise) Object.assign(s, { noiseLevel: hb.noiseLevel, noiseEnabled: hb.noiseEnabled })
      if (v.volume) s.volume = hb.volume
      if (v.channelMode) s.channelMode = hb.channelMode
      if (v.autoPowerOff) s.autoPowerOff = hb.autoPowerOff
      if (v.led) s.ledOn = hb.ledOn
      if (v.voicePreset) s.voicePreset = hb.voicePreset
      if (this.product.capabilities?.rxBattery && v.rxBattery) {
        units.rx = { ...units.rx, battery: hb.rxCamera.battery, charging: v.flags ? hb.rxCamera.charging : undefined }
      }
    } else {
      const features = this._state.features
      const m: Settings = {
        noiseLevel: hb.noiseLevel, noiseEnabled: hb.noiseLevel === undefined ? undefined : hb.noiseLevel > 0,
        // HLDeviceActivity.onEvent(16): the 6301 screen reads heartbeat volume only for productId >= 8;
        // the mobile Lark M2 (PID 7) takes its volume from 0x04 alone.
        volume: hb.family === '6301' && this.product.productId < 8 ? undefined : hb.volume,
        // 6301: lock byte used only on the camera RX with firmware > 2.0.0.31 (isNew6301Camera);
        // 6302: HLDevice6302Activity.onResHeartInfo applies it on every PID.
        voiceLocked: hb.family === '6301' && !features?.voiceLock ? undefined : hb.voiceLocked,
        channelMode: hb.channelMode, autoPowerOff: hb.autoPowerOff, ledOn: hb.ledOn, buttons: hb.buttons,
      }
      for (const [k, v] of Object.entries(m)) if (v !== undefined) (s as Record<string, unknown>)[k] = v
    }
    for (const k of Object.keys(s) as SettingKey[]) {
      if ((this.protectUntil[k] ?? 0) > now) delete s[k]
    }
    const wasOnline = [prev.tx1.online, prev.tx2.online]
    this._state = {
      ...this._state,
      heartbeat: hb,
      lastHeartbeatAt: now,
      missedHeartbeats: 0,
      units,
      settings: { ...this._state.settings, ...s },
    }
    this.events.emit('heartbeat', hb)
    this.emitState()
    ;[Target.TX1, Target.TX2].forEach((t, i) => {
      const on = hb.tx[i].online
      if (on && !wasOnline[i]) {
        this.events.emit('tx-online', t)
        this.versionTries[t] = 0
        this.serialTries[t] = 0
        if (this.opts.fetchIdentity) void this.fetchIdentity(t)
      } else if (!on && wasOnline[i]) {
        // HLDeviceActivity clears the TX version/SN when it drops (HlDevice.setVersion(2, "")).
        this.patchUnit(t, { version: undefined, serial: undefined })
        this.events.emit('tx-offline', t)
      }
    })
    return hb
  }

  /**
   * Version + serial for one unit. Separate budgets of 4 tries each
   * (C6118DeviceRuntimeManager.shouldRequestVersion / shouldRequestText, MAX_REQUEST_RETRY_COUNT);
   * a missing version ("", "0.0.0.0", "0.0.0.000", see isVersionMissing) is asked for again after
   * identityRetryDelayMs (iOS handleDeviceVersionEntity: 1 s).
   */
  private async fetchIdentity(t: Target): Promise<void> {
    const fam = this.product.family
    if (!fam || this.identityRunning[t]) return
    this.identityRunning[t] = true
    try {
      for (;;) {
        if (!this._state.connected || !this.unit(t).online || this._state.rx !== 'available') return
        const needVersion = isVersionMissing(this.unit(t).version) && this.versionTries[t] < MAX_IDENTITY_TRIES
        const needSerial = !this.unit(t).serial && this.serialTries[t] < MAX_IDENTITY_TRIES
        if (!needVersion && !needSerial) return
        try {
          if (needVersion) {
            this.versionTries[t]++
            const f = await this.request(Requests.versionFor(fam, t), { priority: 'background' })
            if (f) {
              const v = fam === '6118' ? parseVersion6118(f.payload) : parseVersionLegacy(f.payload)
              if (!isVersionMissing(v)) this.patchUnit(this.unitOf(f, t), { version: v })
            }
          }
          if (needSerial) {
            this.serialTries[t]++
            const f = await this.request(Requests.serial(t), { priority: 'background' })
            if (f) {
              const sn = parseSerial(f.payload, fam)
              if (sn.trim()) this.patchUnit(this.unitOf(f, t), { serial: sn })
            }
          }
        } catch (e) {
          if (e instanceof DisconnectedError) return
        }
        const stillMissing = isVersionMissing(this.unit(t).version) || !this.unit(t).serial
        if (stillMissing && this.opts.identityRetryDelayMs > 0) await this.delay(this.opts.identityRetryDelayMs)
      }
    } finally {
      this.identityRunning[t] = false
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t)
        resolve()
      }, ms)
      this.timers.add(t)
    })
  }

  /**
   * GET-only settings after connect. Android A2 More settings: 0x3E (A2 only here), 0x13; home: 0x3C.
   * Android M2/M2S start-up: 0x13, 0x35 (on every 6301/6302 PID). iOS: 0x16, 0x13 (+ 0x3C, 0x3E on
   * 6118), never 0x35. M2S: 0x38 when custom buttons are available.
   */
  private async fetchExtraSettings(priority: Priority = 'background'): Promise<void> {
    const caps = this.product.capabilities
    const fam = this.product.family
    if (!caps || !fam) return
    const run = async (frame: RequestFrame, apply: (f: DecodedFrame) => void) => {
      try {
        const f = await this.request(frame, { priority })
        if (f) apply(f)
      } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof DisconnectedError)) this.events.emit('error', e as Error)
      }
    }
    const features = () => this._state.features ?? caps
    await run(Requests.deviceInfo(), (f) => {
      const d = parseDeviceInfo(f.payload, fam, f.length & 0xff)
      this.patchSettings({ rxVariant: d.variant, rxCameraByDeviceInfo: d.cameraRx })
    })
    if (caps.speakerPassthrough) await run(Requests.speakerGet(), (f) => this.patchSettings({ speakerPassthrough: parseSpeakerGet(f.payload) }))
    if (caps.micRecognition) await run(Requests.micRecognitionGet(), (f) => this.patchSettings({ micRecognition: parseFlagIsOne(f.payload) }))
    if (caps.smartBattery) await run(Requests.smartBatteryGet(), (f) => this.patchSettings({ smartBattery: parseFlagIsOne(f.payload) }))
    if (fam !== '6118') await run(Requests.voiceLockGet(), (f) => this.patchSettings({ voiceLocked: parseFlagIsOne(f.payload) }))
    if (features().customButtons) await run(Requests.buttonColorsGet(), (f) => this.patchSettings({ buttonColors: parseButtonColors(f.payload) }))
  }

  // ------------------------------------------------------------------------------- state

  private unit(t: Target): UnitInfo {
    return t === Target.TX1 ? this._state.units.tx1 : t === Target.TX2 ? this._state.units.tx2 : this._state.units.rx
  }

  /**
   * Attribute a reply to a unit: the source byte when it is 0x81/0x82, else the request target.
   * (Android stores a 0x80 / unexpected source as RX data; the live A2 always echoes the addressed
   * unit, so the two agree on real traffic.)
   */
  private unitOf(f: DecodedFrame, requested: Target): Target {
    return f.sourceKnown && f.target !== Target.RX ? f.target : requested
  }

  private recomputeFeatures(emit = true): void {
    const r = resolveFeatures(this.product.capabilities, this._state.units.rx.version, {
      ignoreFirmwareGates: this.opts.ignoreFirmwareGates,
    })
    this._state = { ...this._state, features: r?.caps ?? null, featureGates: r?.gates ?? {} }
    if (emit) this.emitState()
  }

  private patch(p: Partial<DeviceState>): void {
    this._state = { ...this._state, ...p }
    this.emitState()
  }

  private patchUnit(t: Target, p: Partial<UnitInfo>): void {
    const key = t === Target.TX1 ? 'tx1' : t === Target.TX2 ? 'tx2' : 'rx'
    this._state = { ...this._state, units: { ...this._state.units, [key]: { ...this._state.units[key], ...p } } }
    if (t === Target.RX && 'version' in p) this.recomputeFeatures(false)
    this.emitState()
  }

  private patchSettings(p: Settings): void {
    this._state = { ...this._state, settings: { ...this._state.settings, ...p } }
    this.emitState()
  }

  private emitState(): void {
    this.events.emit('state', this._state)
  }

  private logTraffic(direction: 'tx' | 'rx', bytes: Uint8Array, note?: string, frame?: DecodedFrame): void {
    if (this.events.listenerCount('traffic') === 0) return
    const f = frame ?? decodeFrame(bytes)
    const fam = this.product.family ?? '6118'
    const summary = f
      ? `${f.direction === 'request' ? '→' : '←'} ${TARGET_NAMES[f.target]} ${describePayload(f.cmd, f.direction, f.payload, fam)}`
      : `${direction === 'tx' ? '→' : '←'} (not an AA DD / BB DD frame)`
    this.events.emit('traffic', {
      seq: ++this.seq, time: this.opts.now(), direction, bytes, hex: toHexTrimmed(bytes), frame: f, summary, note,
    })
  }
}
