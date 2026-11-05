/**
 * Session store: the single binding between the UI and HollylandDevice.
 *
 *  - connect / auto-reconnect / disconnect over WebHID (or any Transport, e.g. the local bridge)
 *  - mirrors DeviceState into Svelte state (1 Hz heartbeat)
 *  - write pipeline: optimistic overlay while pending, rollback + toast on failure
 *  - "write-only" mode when the OS drops the receiver's replies (macOS / Windows): writes go out
 *    unconfirmed and the last values sent from this browser are remembered locally
 *  - block rules from the official app (no mic online, all online mics muted)
 *  - disruptive flows: speaker passthrough (RX restart), remove pairing, factory reset
 */
import {
  DisconnectedError,
  HollylandDevice,
  WebHidTransport,
  isWebHidSupported,
  lookupProduct,
  Target,
  type Capabilities,
  type DeviceState,
  type FeatureGateState,
  type GatedFeature,
  type ProductInfo,
  type SetResult,
  type Settings,
  type Transport,
  type TrafficEntry as DeviceTraffic,
} from '../protocol'
import { traffic } from './traffic.svelte'
import { toasts } from '../ui/toast.svelte'

export type Phase = 'unsupported' | 'idle' | 'connecting' | 'ready' | 'restarting' | 'lost'

/** Keys of Settings the UI writes through `session.set()`. */
export type SettingKey =
  | 'noiseLevel'
  | 'noiseEnabled'
  | 'volume'
  | 'channelMode'
  | 'voicePreset'
  | 'ledOn'
  | 'micRecognition'
  | 'smartBattery'
  | 'autoPowerOff'
  | 'voiceLocked'

export type BlockReason = 'mic-disconnected' | 'all-muted' | null

export const BLOCK_TEXT: Record<Exclude<BlockReason, null>, string> = {
  'mic-disconnected': 'Mic not connected, current function not available',
  'all-muted': 'Mic is currently muted. Noise cancellation settings are unavailable.',
}

export interface ConnectError {
  title: string
  detail?: string
}

type TransportFactory = () => Promise<Transport | null>

const LAST_DEVICE_KEY = 'mc.lastDevice'
const SENT_KEY_PREFIX = 'mc.sent.'

/** RX restart (speaker passthrough): after this long the overlay offers "Stop waiting". */
const RESTART_SLOW_MS = 12_000
/** RX restart: give up waiting for the receiver after this long and show the lost banner. */
const RESTART_DEADLINE_MS = 30_000
/** RX restart: still attached this long after RESTART_RX means it didn't drop off USB; resume. */
const RESTART_NO_DROP_MS = 8_000

/** A firmware-gated feature the model has but the connected receiver doesn't offer (yet). */
export interface GateInfo {
  state: Exclude<FeatureGateState, 'ok'>
  /** Short explanation for the UI. */
  text: string
}

function storageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function storageSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

function describeError(e: unknown): ConnectError {
  const err = e as { name?: string; message?: string }
  const msg = err?.message ?? String(e)
  if (err?.name === 'NotFoundError') return { title: 'No receiver selected', detail: 'The device list closed without a choice.' }
  if (err?.name === 'SecurityError')
    return { title: 'The browser blocked the request', detail: 'WebHID needs a secure page (https or localhost) and a click.' }
  if (/open|NotAllowed|busy|InvalidState/i.test(msg))
    return { title: "Couldn't open the receiver", detail: `Another tab or app may be using it. Close it and retry. (${msg})` }
  if (/not supported/i.test(msg)) return { title: 'This device is not supported', detail: msg }
  return { title: 'Something went wrong', detail: msg }
}

class Session {
  phase: Phase = $state(isWebHidSupported() ? 'idle' : 'unsupported')
  step: string | null = $state(null)
  error: ConnectError | null = $state(null)
  /** Latest snapshot from the device (replaced on every change). */
  state: DeviceState | null = $state.raw(null)
  /** Values shown while a write is in flight (and kept in write-only mode). */
  overlay: Partial<Settings> = $state({})
  /** Write-only: setting keys the user asked to forget (masked in the library's blind-patched state). */
  private forgotten: Set<string> = $state(new Set())
  pending: Partial<Record<SettingKey, boolean>> = $state({})
  /** Seconds left before the RX restarts (speaker passthrough flow). */
  restartCountdown: number | null = $state(null)
  /** Speaker passthrough flow: the receiver confirmed the setting (false = sent blind, write-only). */
  restartConfirmed = $state(false)
  /** Speaker passthrough flow: the receiver is taking longer than usual to come back. */
  restartSlow = $state(false)
  /** A previously used receiver that can be reopened without the chooser. */
  known: { name: string } | null = $state(null)
  transportKind: string | null = $state(null)
  lastUpdate: number | null = $state(null)

  private dev: HollylandDevice | null = null
  private unsubs: (() => void)[] = []
  private factory: TransportFactory | null = null
  private intentionalClose = false
  /** Bumped on every attach/disconnect, so late results of an old session are ignored. */
  private epoch = 0
  /** Per setting: sequence number of the newest write, and how many writes are in flight. */
  private writeSeq: Record<string, number> = {}
  private pendingCount: Record<string, number> = {}
  private restartTimers: ReturnType<typeof setTimeout>[] = []
  private attaching = false

  constructor() {
    if (typeof window === 'undefined' || !isWebHidSupported()) return
    void this.refreshKnown()
    WebHidTransport.onDeviceConnect((device) => {
      // Auto-reconnect after an RX restart or a replug while the page is open.
      if ((this.phase === 'lost' || this.phase === 'restarting') && this.transportKind === 'webhid') {
        // getDevices() picks the control collection, like the first connect did.
        void WebHidTransport.reconnect()
          .then((t) => t ?? new WebHidTransport(device))
          .then((t) => this.attach(t, 'lost'))
          .catch(() => undefined)
      }
      void this.refreshKnown()
    })
  }

  // ------------------------------------------------------------------ derived getters

  get device(): HollylandDevice | null {
    return this.dev
  }
  get product(): ProductInfo | null {
    return this.state?.product ?? null
  }
  /**
   * What the connected receiver offers: the model's capabilities minus the firmware-gated
   * features its RX firmware doesn't allow (or whose firmware version is still unknown). This is
   * the same set the protocol library checks writes against, so the UI never offers a control the
   * library would refuse. See gate() for why a feature is missing.
   */
  get caps(): Capabilities | null {
    return this.state?.features ?? this.state?.product.capabilities ?? null
  }
  /** Model name as the official app shows it: the A2 camera receiver (PID 1042) is also "LARK A2". */
  get displayName(): string {
    const p = this.product
    if (!p) return ''
    return p.family === '6118' ? 'LARK A2' : p.name
  }
  /**
   * Why a firmware-gated feature of this model is not offered, or null when it is (or the model
   * doesn't have it at all).
   */
  gate(f: GatedFeature): GateInfo | null {
    const g = this.state?.featureGates[f]
    if (!g || g === 'ok') return null
    const ref = this.product?.capabilities?.firmwareGates?.[f]?.androidAbove
    if (g === 'firmware-too-old') {
      const v = this.units?.rx.version
      return {
        state: g,
        text: `Needs receiver firmware newer than ${ref ?? 'the installed one'}${v ? ` (this one runs ${v})` : ''}. Update it with the official HollyAudio app.`,
      }
    }
    return {
      state: g,
      text: this.writeOnly
        ? `Not available here: it needs receiver firmware newer than ${ref ?? 'a minimum version'}, and this system can't read the firmware version.`
        : 'Checking the receiver firmware…',
    }
  }
  get connected(): boolean {
    return this.phase === 'ready'
  }
  /** True when replies arrive (status and settings are live). */
  get live(): boolean {
    return this.state?.rx === 'available'
  }
  /** True when the OS drops replies: writes are unconfirmed and nothing can be read. */
  get writeOnly(): boolean {
    return this.state?.rx === 'unavailable'
  }
  get settings(): Settings {
    const base = this.state?.settings ?? {}
    // Write-only: the library patches its own state with every blind write. Values the user
    // asked to forget stay hidden until they are sent again, so "Forget sent values" really
    // sets those controls back to "Not read".
    if (this.writeOnly && this.forgotten.size) {
      const kept = { ...base } as Record<string, unknown>
      for (const k of this.forgotten) delete kept[k]
      return { ...(kept as Settings), ...this.overlay }
    }
    return { ...base, ...this.overlay }
  }
  /**
   * The channel mode setting, normalised (the A2 shows any value other than 0/1 as SafeTr),
   * whether read back or last sent; null when the receiver has no channel-mode control (Lark M2)
   * or nothing is known.
   */
  get channelModeSetting(): number | null {
    if (!(this.caps?.channelModes.length ?? 0)) return null
    const m = this.settings.channelMode
    if (m === undefined || m === null) return null
    return this.product?.family === '6118' && m !== 0 && m !== 1 ? 2 : m
  }
  /**
   * What the receiver's USB channels carry, for meter and recording labels: the channel mode
   * read back from the receiver, or null when it isn't (write-only) or the model has no mode.
   */
  get usbChannelMode(): number | null {
    return this.writeOnly ? null : this.channelModeSetting
  }
  get units() {
    return this.state?.units ?? null
  }
  get isCameraVariant(): boolean {
    return this.product?.variant === 'camera' || this.state?.settings.rxVariant === 2
  }
  get anyMicOnline(): boolean {
    const u = this.units
    return !!u && (u.tx1.online || u.tx2.online)
  }
  get allOnlineMicsMuted(): boolean {
    const u = this.units
    if (!u) return false
    const online = [u.tx1, u.tx2].filter((t) => t.online)
    return online.length > 0 && online.every((t) => t.muted)
  }

  /** Block rules from the official A2 app (only meaningful when status is live). */
  blockReason(kind: 'mic' | 'noise'): BlockReason {
    if (!this.live) return null
    if (!this.anyMicOnline) return 'mic-disconnected'
    if (kind === 'noise' && this.allOnlineMicsMuted) return 'all-muted'
    return null
  }

  // ----------------------------------------------------------------------- lifecycle

  async refreshKnown() {
    try {
      const devices = await WebHidTransport.getGrantedDevices()
      if (!devices.length) {
        this.known = null
        return
      }
      const d = devices[0]
      const p = lookupProduct(d.vendorId, d.productId)
      this.known = { name: p?.name ?? d.productName ?? 'receiver' }
    } catch {
      this.known = null
    }
  }

  /** Open the browser's device chooser (needs a user gesture). */
  async connect(): Promise<void> {
    await this.connectWith('webhid', () => WebHidTransport.request())
  }

  /** Reopen a previously granted receiver without the chooser. */
  async reconnect(): Promise<void> {
    if (this.phase === 'lost' && this.transportKind === 'webhid') {
      // From the "connection lost" banner: keep the frozen page and the automatic reconnect
      // when the receiver isn't plugged in yet, instead of dropping to the connect screen.
      let t: Transport | null = null
      try {
        t = await WebHidTransport.reconnect()
      } catch {
        t = null
      }
      if (!t) {
        toasts.info('Receiver not found. Plug it back in; the page reconnects automatically.')
        return
      }
      await this.attach(t, 'lost')
      return
    }
    await this.connectWith('webhid', () => WebHidTransport.reconnect())
  }

  /** Connect through any transport factory (e.g. the localhost bridge). */
  async connectWith(kind: string, factory: TransportFactory): Promise<void> {
    if (this.phase === 'connecting') return
    this.error = null
    this.phase = 'connecting'
    this.step = kind === 'webhid' ? 'Waiting for the device chooser…' : 'Connecting…'
    this.factory = factory
    this.transportKind = kind
    try {
      const t = await factory()
      if (!t) {
        this.phase = 'idle'
        this.step = null
        this.error = { title: 'No receiver selected', detail: 'The device list closed without a choice.' }
        return
      }
      await this.attach(t)
    } catch (e) {
      this.phase = 'idle'
      this.step = null
      this.error = describeError(e)
    }
  }

  /**
   * Open `t` and make it the session's device.
   * `fallback: 'lost'` is the automatic path (replug, RX restart, the lost banner's Reconnect):
   * the frozen page or the restart overlay stays up while the receiver is reopened, and a
   * failure goes back to the lost banner instead of the connect screen.
   */
  private async attach(t: Transport, fallback: 'idle' | 'lost' = 'idle'): Promise<void> {
    // Already opening one (several HID "connect" events per replug, or a second Reconnect click).
    // Don't close `t`: an unopened WebHID transport shares its HIDDevice with the one in progress.
    if (this.attaching) return
    this.attaching = true
    const epoch = ++this.epoch
    this.detachListeners()
    this.intentionalClose = false
    this.resetWrites()
    this.forgotten = new Set()
    const quiet = fallback === 'lost' && (this.phase === 'lost' || this.phase === 'restarting')
    if (!quiet) {
      this.phase = 'connecting'
      this.lastUpdate = null
    }
    this.step = 'Opening the receiver…'
    const dev = new HollylandDevice(t, { blindWrites: true, allowDestructive: true })
    this.dev = dev
    this.unsubs.push(
      dev.on('state', (s) => this.onState(s)),
      dev.onTraffic((e) => this.onTraffic(e)),
      dev.on('disconnect', () => this.onDisconnect()),
      dev.on('error', (e) => console.warn('[session]', e)),
    )
    try {
      this.step = 'Reading the receiver…'
      const s = await dev.connect()
      if (epoch !== this.epoch) return
      this.state = s
      this.lastUpdate = s.lastHeartbeatAt ?? null
      this.endRestartFlow()
      this.phase = 'ready'
      this.step = null
      this.error = null
      storageSet(LAST_DEVICE_KEY, { name: s.product.name, at: Date.now() })
      this.known = { name: s.product.name }
      if (s.rx === 'unavailable') this.restoreSent()
      else this.overlay = {}
    } catch (e) {
      if (epoch !== this.epoch) return
      this.detachListeners()
      this.dev = null
      await t.close().catch(() => {})
      this.step = null
      if (quiet) {
        this.endRestartFlow()
        this.phase = 'lost'
        const err = describeError(e)
        toasts.error(`${err.title}.${err.detail ? ` ${err.detail}` : ''}`)
      } else {
        this.phase = 'idle'
        this.error = describeError(e)
      }
    } finally {
      this.attaching = false
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true
    this.epoch++
    const dev = this.dev
    this.detachListeners()
    this.dev = null
    this.state = null
    this.overlay = {}
    this.forgotten = new Set()
    this.resetWrites()
    this.endRestartFlow()
    this.lastUpdate = null
    this.phase = isWebHidSupported() ? 'idle' : 'unsupported'
    await dev?.disconnect().catch(() => {})
  }

  private detachListeners() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
  }

  private onState(s: DeviceState) {
    this.state = s
    if (s.lastHeartbeatAt) this.lastUpdate = s.lastHeartbeatAt
  }

  private onDisconnect() {
    if (this.intentionalClose) return
    this.detachListeners()
    this.dev = null
    this.resetWrites()
    // During an RX restart the drop is expected; the restart deadline decides when to give up.
    if (this.phase !== 'restarting') this.phase = 'lost'
  }

  private onTraffic(e: DeviceTraffic) {
    traffic.add({
      dir: e.direction === 'tx' ? 'out' : 'in',
      bytes: e.bytes,
      decoded: e.summary + (e.note && e.note !== 'reply' ? ` (${e.note})` : ''),
      status: e.note === 'timeout' ? 'timeout' : 'ok',
      heartbeat: e.frame?.cmd === 0x10,
      manual: e.note === 'raw',
    })
  }

  // -------------------------------------------------------------- write-only memory

  /**
   * Storage key for the values sent in write-only mode. WebHID exposes no serial number, so this
   * is per model (product ID) in this browser, not per receiver.
   */
  private sentKey(): string | null {
    const p = this.product
    if (!p) return null
    const serial = this.dev?.transport.info?.serialNumber ?? ''
    return `${SENT_KEY_PREFIX}${p.productId.toString(16)}.${serial}`
  }

  private sentValues(): Partial<Settings> {
    const k = this.sentKey()
    return (k ? storageGet<Partial<Settings>>(k) : null) ?? {}
  }

  private restoreSent() {
    this.overlay = this.sentValues()
  }

  private rememberSent(patch: Partial<Settings>) {
    if (!this.writeOnly) return
    if (this.forgotten.size && Object.keys(patch).some((k) => this.forgotten.has(k))) {
      const next = new Set(this.forgotten)
      for (const k of Object.keys(patch)) next.delete(k)
      this.forgotten = next
    }
    const k = this.sentKey()
    if (!k) return
    storageSet(k, { ...this.sentValues(), ...patch })
  }

  /** Forget the values this browser remembered for this model of receiver (write-only mode). */
  forgetSent() {
    const k = this.sentKey()
    if (k)
      try {
        localStorage.removeItem(k)
      } catch {
        /* noop */
      }
    this.overlay = {}
    // The library already holds every blind write in its own state: hide those values too.
    if (this.writeOnly) this.forgotten = new Set(Object.keys(this.state?.settings ?? {}))
  }

  // --------------------------------------------------------------------- write pipeline

  private setPending(key: string, delta: 1 | -1) {
    const n = Math.max(0, (this.pendingCount[key] ?? 0) + delta)
    this.pendingCount[key] = n
    const p = { ...this.pending } as Record<string, boolean>
    if (n > 0) p[key] = true
    else delete p[key]
    this.pending = p as typeof this.pending
  }

  /** Forget in-flight writes (new device, disconnect): their late results are ignored. */
  private resetWrites() {
    this.writeSeq = {}
    this.pendingCount = {}
    this.pending = {}
  }

  /** Overlay keys of `patch` fall back to the library value (live) or the last sent value (write-only). */
  private settleOverlay(patch: Partial<Settings>) {
    const sent = this.writeOnly ? this.sentValues() : {}
    const next = { ...this.overlay }
    for (const k of Object.keys(patch) as (keyof Settings)[]) {
      if (sent[k] === undefined) delete next[k]
      else next[k] = sent[k] as never
    }
    this.overlay = next
  }

  /**
   * Optimistic write. Shows `patch` immediately, sends with `run`, rolls back on failure.
   * Returns true on success (confirmed, or sent blind in write-only mode).
   *
   * Writes to the same setting can overlap (a retry in the library, fast clicks, arrow keys).
   * Only the newest write of a key settles the overlay: live mode then falls back to the
   * library's confirmed value (heartbeat wins, features.md §4.5), write-only mode to the last
   * value sent. An older write that finishes later never puts its value back.
   */
  async write(key: SettingKey, patch: Partial<Settings>, run: (d: HollylandDevice) => Promise<SetResult>): Promise<boolean> {
    const dev = this.dev
    if (!dev || this.phase !== 'ready') return false
    const epoch = this.epoch
    const seq = (this.writeSeq[key] ?? 0) + 1
    this.writeSeq[key] = seq
    const stale = () => epoch !== this.epoch || this.dev !== dev
    const newest = () => this.writeSeq[key] === seq
    this.overlay = { ...this.overlay, ...patch }
    this.setPending(key, 1)
    try {
      const r = await run(dev)
      if (!r.ok) throw new Error('The receiver rejected the setting.')
      if (stale()) return false
      // Every blind write that went out is remembered, so a failed newer one reverts to it.
      this.rememberSent(patch)
      if (newest() && !this.writeOnly) this.settleOverlay(patch)
      return true
    } catch (e) {
      // Disconnect (on purpose or unplugged) while the write was in flight: the banner or the
      // connect screen says what happened; a "Setup failed" toast would only add noise.
      if (stale() || e instanceof DisconnectedError) return false
      if (newest()) this.settleOverlay(patch)
      const msg = (e as Error)?.message ?? String(e)
      toasts.error(`Setup failed. ${msg}`, {
        action: { label: 'Retry', run: () => void this.write(key, patch, run) },
      })
      return false
    } finally {
      if (!stale()) this.setPending(key, -1)
    }
  }

  // Only the level is sent: whether 0x06 also switches NC on is unknown (features.md §21 #1).
  setNoiseLevel = (level: number) => this.write('noiseLevel', { noiseLevel: level }, (d) => d.setNoiseLevel(level))
  setNoiseEnabled = (on: boolean) => this.write('noiseEnabled', { noiseEnabled: on }, (d) => d.setNoiseCancellation(on))
  setVolume = (step: number) => this.write('volume', { volume: step }, (d) => d.setVolume(step))
  setChannelMode = (mode: number) => this.write('channelMode', { channelMode: mode }, (d) => d.setChannelMode(mode))
  setVoicePreset = (enabled: boolean, preset: number) =>
    this.write('voicePreset', { voicePreset: { enabled, preset } }, (d) => d.setVoicePreset(enabled, preset))
  setLed = (on: boolean) => this.write('ledOn', { ledOn: on }, (d) => d.setLed(on))
  setMicRecognition = (on: boolean) => this.write('micRecognition', { micRecognition: on }, (d) => d.setMicRecognition(on))
  setSmartBattery = (on: boolean) => this.write('smartBattery', { smartBattery: on }, (d) => d.setSmartBattery(on))
  setAutoPowerOff = (on: boolean) => this.write('autoPowerOff', { autoPowerOff: on }, (d) => d.setAutoPowerOff(on))
  setVoiceLock = (locked: boolean) => this.write('voiceLocked', { voiceLocked: locked }, (d) => d.setVoiceLock(locked))

  // --------------------------------------------------------- disruptive / destructive

  private clearRestartTimers() {
    this.restartTimers.forEach((t) => clearTimeout(t))
    this.restartTimers = []
  }

  /** Leave the restart flow's state (the caller sets the phase). */
  private endRestartFlow() {
    this.clearRestartTimers()
    this.restartCountdown = null
    this.restartSlow = false
  }

  /**
   * After RESTART_RX: resume if the receiver never drops off USB, offer "Stop waiting" when it
   * is slow, and give up (lost banner, Reconnect) when it doesn't come back at all. These
   * timers don't depend on the old device, so a receiver that drops and never reappears (the
   * WebHID permission may not survive the re-enumeration, features.md §21 #4) can't leave
   * the full-screen overlay up forever.
   */
  private armRestartTimers(dev: HollylandDevice) {
    this.clearRestartTimers()
    this.restartSlow = false
    this.restartTimers.push(
      setTimeout(() => {
        if (this.phase === 'restarting' && this.dev === dev) {
          this.endRestartFlow()
          this.phase = 'ready'
        }
      }, RESTART_NO_DROP_MS),
      setTimeout(() => {
        if (this.phase === 'restarting') this.restartSlow = true
      }, RESTART_SLOW_MS),
      setTimeout(() => this.stopWaitingForRestart(), RESTART_DEADLINE_MS),
    )
  }

  /** "Stop waiting" on the restart overlay (and the automatic deadline). */
  stopWaitingForRestart() {
    if (this.phase !== 'restarting') return
    this.endRestartFlow()
    // Still attached: carry on. Gone: the lost banner keeps the automatic reconnect running.
    this.phase = this.dev ? 'ready' : 'lost'
  }

  /**
   * "External speaker without unplugging": set, then restart the RX after a 3 s countdown
   * (matches the official app). The page reconnects automatically when the RX comes back.
   */
  async setSpeakerPassthrough(on: boolean): Promise<boolean> {
    const dev = this.dev
    if (!dev || this.phase !== 'ready') return false
    this.setPending('speaker', 1)
    try {
      const r = await dev.setSpeakerPassthrough(on)
      if (!r.ok) throw new Error('The receiver rejected the setting.')
      this.rememberSent({ speakerPassthrough: on })
      this.restartConfirmed = r.confirmed
      this.clearRestartTimers()
      this.restartSlow = false
      this.phase = 'restarting'
      for (let s = 3; s > 0; s--) {
        this.restartCountdown = s
        await new Promise((res) => setTimeout(res, 1000))
      }
      this.restartCountdown = 0
      await dev.restartRx({ confirm: true }).catch(() => undefined)
      if (this.phase === 'restarting') this.armRestartTimers(dev)
      return true
    } catch (e) {
      if (this.dev === dev) toasts.error(`Setup failed. ${(e as Error).message}`)
      if (this.phase === 'restarting') this.phase = this.dev ? 'ready' : 'lost'
      this.endRestartFlow()
      return false
    } finally {
      if (this.dev === dev) this.setPending('speaker', -1)
    }
  }

  get speakerPending(): boolean {
    return !!(this.pending as Record<string, boolean>).speaker
  }

  async removePairing(tx: 1 | 2): Promise<boolean> {
    const dev = this.dev
    if (!dev) return false
    try {
      const r = await dev.removePairing(tx, { confirm: true })
      if (!r.ok) throw new Error('The receiver rejected the request.')
      toasts.success(r.confirmed ? 'Deleted' : 'Sent. The pairing should now be removed.')
      return true
    } catch (e) {
      toasts.error(`Operation failed. ${(e as Error).message}`)
      return false
    }
  }

  async factoryReset(): Promise<boolean> {
    const dev = this.dev
    if (!dev) return false
    try {
      const r = await dev.factoryReset({ confirm: true })
      if (!r.ok) throw new Error('The receiver rejected the request.')
      this.forgetSent()
      toasts.success(r.confirmed ? 'Reset successful' : 'Reset sent.')
      // Re-sync after the receiver settles (official app waits 1 s).
      setTimeout(() => {
        if (this.dev === dev && this.live) {
          void dev.refreshStatus().catch(() => undefined)
          void dev.getSettings().catch(() => undefined)
        }
      }, 1000)
      return true
    } catch (e) {
      toasts.error(`Reset failed. ${(e as Error).message}`)
      return false
    }
  }

  /** Raw frame from the developer console. Returns an error message or null. */
  async sendRaw(bytes: Uint8Array): Promise<string | null> {
    const dev = this.dev
    if (!dev) return 'Not connected.'
    const packet = new Uint8Array(64)
    packet.set(bytes.subarray(0, 64))
    try {
      await dev.sendRaw(packet, { force: true })
      return null
    } catch (e) {
      return (e as Error).message
    }
  }

  /** Re-read identity (versions + serials) for every online unit. */
  async refreshIdentity(): Promise<void> {
    if (!this.dev || !this.live) return
    await this.dev.getIdentity().catch(() => undefined)
  }

  /**
   * DEVELOPMENT ONLY: attach the protocol simulator (for screenshots and UI tests without
   * hardware). Not reachable in production builds.
   */
  async connectMock(kind: string): Promise<void> {
    if (!import.meta.env.DEV) return
    const { MockTransport, SimulatedReceiver } = await import('../protocol')
    const presets: Record<string, { pid: number; family: '6118' | '6301' | '6302'; camera?: boolean; drop?: boolean }> = {
      a2: { pid: 0x0411, family: '6118' },
      a2s: { pid: 0x0412, family: '6118', camera: true },
      blind: { pid: 0x0411, family: '6118', drop: true },
      m2s: { pid: 0x0405, family: '6302' },
      m2scam: { pid: 0x0406, family: '6302', camera: true },
      m2: { pid: 0x0007, family: '6301' },
    }
    const p = presets[kind] ?? presets.a2
    const sim = new SimulatedReceiver({ family: p.family, camera: p.camera, dropReplies: p.drop })
    ;(globalThis as Record<string, unknown>).__sim = sim
    await this.connectWith('mock', async () =>
      new MockTransport({
        info: { vendorId: 0x3547, productId: p.pid, productName: 'Wireless Microphone (simulated)', serialNumber: 'SIM' },
        respond: sim.respond,
        latencyMs: 8,
        capabilities: { receive: p.drop ? 'no' : 'yes' },
      }),
    )
  }

  /**
   * Reopen the receiver on a transport that came back by itself (the local bridge recaptured it
   * after an unplug or an RX restart). Keeps the lost banner / restart overlay until it's ready.
   */
  async reattach(t: Transport): Promise<void> {
    if (this.phase !== 'lost' && this.phase !== 'restarting') return
    await this.attach(t, 'lost')
  }

  /** Re-run the reply probe (e.g. after switching to the bridge). */
  async probe(): Promise<void> {
    if (!this.dev) return
    await this.dev.probe().catch(() => undefined)
  }

  // ===================================================================================
  // Settings + Device pages (src/components/settings, src/components/device).
  // Additive wrappers only: nothing above this line changes behaviour because of them.
  // ===================================================================================

  /**
   * Re-read the GET-only settings (speaker passthrough, smart battery, mic recognition, button
   * colours …), as the official "More Settings" screen does on start. Live mode only.
   */
  async refreshSettings(): Promise<void> {
    const dev = this.dev
    if (!dev || !this.live || this.phase !== 'ready') return
    await dev.getSettings().catch(() => undefined)
  }

  /**
   * Speaker passthrough after the user confirmed the restart. Same as setSpeakerPassthrough(),
   * but in write-only mode the sent value also stays visible until the receiver comes back.
   */
  async applySpeakerPassthrough(on: boolean): Promise<boolean> {
    const ok = await this.setSpeakerPassthrough(on)
    if (ok && this.writeOnly) this.overlay = { ...this.overlay, speakerPassthrough: on }
    return ok
  }

  /** True while a custom-button write (M2S) is in flight. */
  get customButtonsPending(): boolean {
    return !!(this.pending as Record<string, boolean>).buttons
  }

  /**
   * M2S "Custom Functions": write one slot (1 or 2) as [slot, func, keyOp, tx1Color, tx2Color]
   * (cmd 0x37), with the optimistic overlay, rollback and "Setup failed" toast of write().
   * `func = 0, keyOp = 0` clears the slot. Colours default to the current ones (0 = not set).
   * In live mode the heartbeat and the colour GET are re-read before the overlay is dropped,
   * so the UI does not flicker back to the old assignment.
   */
  async setCustomButton(slot: 1 | 2, func: number, keyOp: number, colors?: { tx1: number; tx2: number }): Promise<boolean> {
    // Every slot write also carries the TX light colours. When they aren't known yet, read them
    // first so the write doesn't reset them; if that fails too, 0 ("not set") goes out, which is
    // what the official app sends before its own colour read has answered.
    if (!colors && !this.settings.buttonColors && this.live && this.dev && this.phase === 'ready') {
      await this.dev.getButtonColors().catch(() => undefined)
    }
    const cur = this.settings.buttons
    const buttons: NonNullable<Settings['buttons']> = [cur?.[0], cur?.[1]]
    buttons[slot - 1] = { func, keyOp }
    const c = colors ?? this.settings.buttonColors ?? { tx1: 0, tx2: 0 }
    return this.write('buttons' as SettingKey, { buttons, buttonColors: c }, async (d) => {
      const r = await d.setCustomButton({ index: slot, func, keyOp, tx1Color: c.tx1, tx2Color: c.tx2 })
      if (r.ok && r.confirmed) {
        await d.refreshStatus().catch(() => undefined)
        await d.getButtonColors().catch(() => undefined)
      }
      return r
    })
  }
}

export const session = new Session()
export { Target }
