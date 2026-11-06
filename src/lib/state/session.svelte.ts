/**
 * Session store: the single binding between the UI and the connected product.
 *
 * The device is a MicDevice (core/loader.ts openMicDevice, which fetches the family's driver chunk):
 * LegacyMicDevice over HollylandDevice for LARK A2 / A2S, Lark M2, LARK M2S and the 6501 group, or a
 * family driver's FamilyDevice for the LARK A1, LARK M3, LARK MAX 2 and MELO P1 (docs/FAMILIES.md §3).
 * Two APIs sit on top:
 *
 *  - The legacy API (`state`, `device`, `caps`, `settings`, `units`, `gate()`, `blockReason()`,
 *    `write()` and the typed setters, the speaker-passthrough restart flow, custom buttons, pairing,
 *    factory reset). Unchanged; it serves the hand-tuned pages and is empty for the other families
 *    (`isLegacy` false: `state` / `device` / `caps` / `units` null, `settings` {}).
 *  - The generic API for every product (`mic`, `micState`, `controls`, `value()`, `availability()`,
 *    `blockText()`, `setControl()`, `confirmFor()`, `micSlots`, device-pushed `levels`), plus the
 *    support data (`support`, `untested`, the first-connect notice) and the hardware report.
 *
 *  - connect / auto-reconnect / disconnect over USB (WebHID interrupt or feature reports), Web
 *    Bluetooth, the local bridge, or the development simulator (`?mock=<preset id>`)
 *  - mirrors the device state into Svelte state (every status poll)
 *  - write pipelines: optimistic overlay while pending, rollback + toast on failure
 *  - "write-only" mode when the OS drops the receiver's replies (macOS / Windows): writes go out
 *    unconfirmed and the last values sent from this browser are remembered locally
 *  - block rules from the official app (no mic online, all online mics muted)
 *  - disruptive flows: receiver restarts (overlay + automatic reconnect), remove pairing, factory reset
 */
import {
  CONTROL,
  ControlUnavailableError,
  ControlValueError,
  DestructiveCommandError,
  DisconnectedError,
  RxUnavailableError,
  TimeoutError,
  UnsupportedError,
  a1,
  controlById,
  controlKey,
  displayName,
  familyCodeOf,
  isLegacyMicDevice,
  loadDriver,
  loadedDriverFor,
  m3,
  max2,
  melo,
  openMicDevice,
  supportOf,
  Target,
  type Capabilities,
  type ControlAvailability,
  type ControlGroup,
  type ControlId,
  type ControlSpec,
  type ControlValue,
  type DeviceState,
  type FamilyCode,
  type FeatureGateState,
  type GatedFeature,
  type HollylandDevice,
  type MicDevice,
  type MicState,
  type MicTrafficEntry,
  type MicUnit,
  type ProductInfo,
  type SetResult,
  type Settings,
  type SupportInfo,
  type Transport,
  type UnitId,
  type WebBluetoothTransport,
} from '../protocol/app'
import { traffic } from './traffic.svelte'
import { toasts } from '../ui/toast.svelte'
import type { Confidence } from '../ui/types'
import {
  connectPaths,
  grantedUsbDevices,
  hidTransportFor,
  onUsbDeviceConnect,
  productsFor,
  reconnectBluetooth,
  reconnectUsb,
  requestBluetooth,
  requestUsb,
  resolveUsbProduct,
  sameReceiver,
  type ConnectPaths,
} from './links'
import { confirmInfo, disruptiveKind, reasonText, type ConfirmInfo } from './reasons'
import { displayControls } from './labels'
import { buildHardwareReport, type CheckOutcome, type WriteRecord } from './report'
import { isNoticeDismissed, rememberNoticeDismissed } from './support'

export type { ConnectPaths, LinkKind } from './links'
export type { ConfirmInfo } from './reasons'
export type { CheckOutcome, WriteRecord } from './report'

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
  'mic-disconnected': 'No mic connected',
  'all-muted': 'Mics are muted',
}

export interface ConnectError {
  title: string
  detail?: string
}

/** Pages beyond Overview / Audio / Settings / Device that a product needs (src/components/<page>/<Page>Page.svelte). */
export type ExtraPage = 'mixer' | 'timecode' | 'monitoring'

/** MELO P1 device-pushed levels (dB per input and output, about ten times a second). */
export type DeviceLevels = melo.MeloLevels

/** What a connect factory returns: a transport, optionally with the link kind and registry row it was opened as. */
type Opened = Transport | { transport: Transport; kind?: string; product?: ProductInfo }
type TransportFactory = () => Promise<Opened | null>

const LAST_DEVICE_KEY = 'mc.lastDevice'
const SENT_KEY_PREFIX = 'mc.sent.'
/** Values sent blind through the generic API (write-only), per product. */
const SENT_CONTROL_KEY_PREFIX = 'mc.sentControls.'
/** Writes kept for the hardware report. */
const WRITE_LOG_MAX = 30

/** RX restart (speaker passthrough): after this long the overlay offers "Stop waiting". */
const RESTART_SLOW_MS = 12_000
/** RX restart: give up waiting for the receiver after this long and show the lost banner. */
const RESTART_DEADLINE_MS = 30_000
/** RX restart: still attached this long after RESTART_RX means it didn't drop off USB; resume. */
const RESTART_NO_DROP_MS = 8_000
/** Bluetooth restart: pause between reconnect attempts while the restart overlay is up. */
const BLE_RESTART_RETRY_MS = 3_000

/**
 * Status polls and pushes per family (the console's "hide heartbeats" filter): the A1 heartbeat,
 * the M3 0x6000, the MAX 2 0x600B and BLE pushes, the MELO P1 0x600B and VU pushes.
 */
const POLL_COMMANDS: Partial<Record<FamilyCode, readonly number[]>> = {
  '6108': [0x1f],
  '6303': [0x6000],
  '6701': [0x600b, 0x6000, 0x6001, 0x6002],
  '6201': [0x600b, 0x11eb, 0x11e1, 0x11e9],
}

const HID_KINDS = new Set(['webhid', 'webhid-feature'])

/** A firmware-gated feature the model has but the connected receiver doesn't offer (yet). */
export interface GateInfo {
  state: Exclude<FeatureGateState, 'ok'>
  /** Block reason for the UI (a few words). */
  text: string
  /** The versions involved, for a tooltip. */
  detail?: string
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
function storageRemove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* noop */
  }
}

function describeError(e: unknown): ConnectError {
  const err = e as { name?: string; message?: string }
  const msg = err?.message ?? String(e)
  if (err?.name === 'NotFoundError') return { title: 'No receiver selected' }
  if (err?.name === 'SecurityError') return { title: 'The browser blocked the request', detail: 'Open the page over https, then retry.' }
  if (err instanceof UnsupportedError || err?.name === 'UnsupportedError') return { title: 'This device is not supported' }
  if (/open|NotAllowed|busy|InvalidState/i.test(msg))
    return { title: "Couldn't open the receiver", detail: 'Close other tabs or apps using it, then retry.' }
  if (/not supported/i.test(msg)) return { title: 'This device is not supported', detail: msg }
  return { title: 'Something went wrong', detail: msg }
}

/** Short reason of a failed generic write, for the "Setup failed." toast. */
function writeErrorText(e: unknown, writeOnly = false): string {
  if (e instanceof ControlUnavailableError) return reasonText({ ok: false, reason: e.reason }, writeOnly) ?? 'Unavailable'
  if (e instanceof RxUnavailableError) return 'No reply from the receiver.'
  if (e instanceof TimeoutError) return 'No reply from the receiver.'
  if (e instanceof DestructiveCommandError) return 'Not allowed on this model.'
  if (e instanceof ControlValueError) return 'Invalid value.'
  return (e as Error)?.message ?? String(e)
}

function isOpened(r: Opened): r is { transport: Transport; kind?: string; product?: ProductInfo } {
  return typeof (r as Transport).send !== 'function' && !!(r as { transport?: Transport }).transport
}

/**
 * Fetch the driver chunks a connect of this kind most likely needs while the chooser is up, so opening the
 * receiver does not wait for them: the legacy families (A2, M2, C1 group) for USB and the bridge, the MAX 2
 * case and MELO P1 for Bluetooth. Other families load on demand in attach().
 */
function warmDrivers(kind: string): void {
  if (kind === 'mock') return
  const codes = new Set<FamilyCode>(['6118'])
  if (kind === 'web-bluetooth') {
    codes.clear()
    for (const p of productsFor('bluetooth')) {
      const c = familyCodeOf(p)
      if (c) codes.add(c)
    }
  }
  for (const c of codes) void loadDriver(c).catch(() => undefined)
}

class Session {
  phase: Phase = $state(connectPaths().usb || connectPaths().bluetooth ? 'idle' : 'unsupported')
  step: string | null = $state(null)
  error: ConnectError | null = $state(null)
  /** Legacy products: latest DeviceState from HollylandDevice (replaced on every change). Null otherwise. */
  state: DeviceState | null = $state.raw(null)
  /** Every product: latest MicState (replaced on every change). */
  micState: MicState | null = $state.raw(null)
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
  /** 'webhid' | 'webhid-feature' | 'web-bluetooth' | 'bridge' | 'mock' (LinkKind), or another factory's kind. */
  transportKind: string | null = $state(null)
  lastUpdate: number | null = $state(null)
  /** Connect keys this browser can offer (WebHID, Web Bluetooth, the local bridge). */
  readonly connectPaths: ConnectPaths = connectPaths()

  // ---- generic write pipeline (every product)
  /** Generic writes in flight: controlKey → value shown meanwhile. */
  private controlOverlay: Record<string, ControlValue> = $state({})
  private controlPending: Record<string, number> = $state({})
  /** When this page last sent each control (controlKey → ms), for "Last sent 17:42". In memory only. */
  sentAt: Record<string, number> = $state({})
  /** Write-only: control values last sent from this browser (persisted per product). */
  private sentControls: Record<string, ControlValue> = $state({})
  /** Write-only: control keys the user asked to forget (masked in the device's blind-patched values). */
  private forgottenControls: Set<string> = $state(new Set())

  // ---- support / report
  private noticeDismissed = $state(false)
  /** Results of `runHardwareCheck()` by step id. */
  checkResults: Record<string, CheckOutcome> = $state.raw({})
  checkRunning = $state(false)
  private writeLog: WriteRecord[] = []

  // ---- device-pushed levels (MELO P1)
  /** Last pushed levels, or null (no level stream, or none yet). */
  levels: DeviceLevels | null = $state.raw(null)
  levelsActive = $state(false)
  private levelRefs = 0

  private dev: HollylandDevice | null = null
  /** The attached device (null while the link is lost or restarting). */
  private micDev: MicDevice | null = $state.raw(null)
  /** The device whose pages are shown: kept while the link is lost, so a frozen page keeps its layout. */
  private lastMic: MicDevice | null = $state.raw(null)
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
  /** Web Bluetooth device id of the current session (reconnect without the chooser). */
  private bleDeviceId: string | null = null
  /** The current session's Bluetooth device object: reconnects with gatt.connect() without getDevices(). */
  private bleDevice: WebBluetoothTransport['device'] | null = null

  constructor() {
    if (typeof window === 'undefined' || !this.connectPaths.usb) return
    void this.refreshKnown()
    onUsbDeviceConnect((device) => {
      // Auto-reconnect after an RX restart or a replug while the page is open.
      if ((this.phase === 'lost' || this.phase === 'restarting') && HID_KINDS.has(this.transportKind ?? '')) {
        // getDevices() picks the control collection, like the first connect did; only the receiver the
        // page was showing is reopened (another granted one may be plugged in too).
        const previous = this.product
        if (!previous || sameReceiver(device, previous)) {
          void reconnectUsb(previous)
            .then((r) => r ?? hidTransportFor(device))
            .then((r) => this.attach(r.transport, 'lost', r.product))
            .catch(() => undefined)
        }
      }
      void this.refreshKnown()
    })
    // The legacy driver (A2, M2, C1 group: most receivers) is not in the main chunk; fetch it once the page is
    // idle, so a connect without a chooser (Reconnect, replug) never waits for it either.
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const prefetch = () => void loadDriver('6118').catch(() => undefined)
    if (idle) idle(prefetch, { timeout: 5000 })
    else setTimeout(prefetch, 2000)
  }

  // ------------------------------------------------------------------ derived getters

  /** Legacy products: the HollylandDevice (full legacy API). Null for the other families. */
  get device(): HollylandDevice | null {
    return this.dev
  }
  /** The connected product as a MicDevice (every family); null while the link is lost. */
  get mic(): MicDevice | null {
    return this.micDev
  }
  private get shown(): MicDevice | null {
    return this.micDev ?? this.lastMic
  }
  /**
   * True when the product runs on HollylandDevice (6118 / 6301 / 6302 / 6501): the hand-tuned
   * pages apply. Stays put while the link is lost or the receiver restarts.
   */
  get isLegacy(): boolean {
    return isLegacyMicDevice(this.shown)
  }
  get product(): ProductInfo | null {
    return this.micState?.product ?? this.state?.product ?? null
  }
  get family(): FamilyCode | null {
    return this.shown?.family ?? null
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
  /** The registry's disambiguated name ("LARK M3 (camera RX, 4CH)", "Lark C1 (2nd gen)"), for the Device page. */
  get modelLabel(): string {
    const p = this.product
    return p ? displayName(p) : ''
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
        text: 'Needs newer receiver firmware',
        detail: `Needs firmware newer than ${ref ?? 'the installed one'}${v ? ` (installed: ${v})` : ''}. Update it in the HollyAudio app.`,
      }
    }
    return {
      state: g,
      text: this.writeOnly ? "Can't check receiver firmware" : 'Checking firmware…',
      detail: this.writeOnly ? `Needs firmware newer than ${ref ?? 'a minimum version'}.` : undefined,
    }
  }
  get connected(): boolean {
    return this.phase === 'ready'
  }
  /** True when replies arrive (status and settings are live). */
  get live(): boolean {
    return (this.micState?.rx ?? this.state?.rx) === 'available'
  }
  /** True when the OS drops replies: writes are unconfirmed and nothing can be read. */
  get writeOnly(): boolean {
    return (this.micState?.rx ?? this.state?.rx) === 'unavailable'
  }
  get settings(): Settings {
    const base = this.state?.settings ?? {}
    // Write-only: the library patches its own state with every blind write. Values the user
    // asked to forget stay hidden until they are sent again, so "Forget remembered values" really
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
  /** Legacy products: RX, TX1, TX2 from HollylandDevice. Null for the other families (see `micState.units`, `micSlots`). */
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

  // ------------------------------------------------------------- support (untested)

  /** Support record of the connected product (level, hardware testing, research). */
  get support(): SupportInfo | null {
    return this.shown?.support ?? (this.product ? supportOf(this.product) : null)
  }
  /** Not run on hardware (the "Untested" plate). */
  get untested(): boolean {
    return this.support?.hardware === 'untested'
  }
  /** The same protocol was tested on a sibling model (A2S via the A2). */
  get siblingTested(): boolean {
    return this.support?.hardware === 'sibling-tested'
  }
  /** What was tested, e.g. "LARK A2 fw 3.0.2.008 · macOS Chrome WebHID: write-only · 2026-11-05". */
  get testedOn(): readonly string[] {
    return this.support?.testedOn ?? []
  }
  /** Show the one-time first-connect notice: an untested product, connected, not dismissed in this browser. */
  get untestedNotice(): boolean {
    return this.untested && this.phase === 'ready' && !this.noticeDismissed
  }
  dismissUntestedNotice(): void {
    const p = this.product
    this.noticeDismissed = true
    if (p) rememberNoticeDismissed(p)
  }

  // ------------------------------------------------------------- generic device API

  /**
   * Controls this product offers (destructive and firmware-update controls are absent on untested
   * products), with display words (labels.ts: one casing, "24-bit", bit depths in one order).
   */
  get controls(): readonly ControlSpec[] {
    const c = this.shown?.controls
    return c ? displayControls(c) : []
  }
  controlsIn(group: ControlGroup): ControlSpec[] {
    return this.controls.filter((c) => c.group === group)
  }
  control(id: ControlId): ControlSpec | undefined {
    return controlById(this.controls, id)
  }
  /** Pages this product needs beyond Overview / Audio / Settings / Device. */
  get extraPages(): ExtraPage[] {
    if (!this.shown || this.isLegacy) return []
    const groups = new Set(this.controls.map((c) => c.group))
    const out: ExtraPage[] = []
    if (this.family === '6201') out.push('mixer')
    if (groups.has('timecode')) out.push('timecode')
    // MELO P1 output volumes are part of its Mixer page.
    if (groups.has('monitoring') && this.family !== '6201') out.push('monitoring')
    return out
  }
  /**
   * Current value of a control (per-unit controls take `unit`): a write in flight first, then the
   * device state (read back, or applied after a blind write), then, write-only, the value last sent
   * from this browser. Undefined = unknown.
   */
  value(id: ControlId, unit?: UnitId): ControlValue | undefined {
    const key = controlKey(id, unit)
    if (key in this.controlOverlay) return this.controlOverlay[key]
    // Write-only: the device keeps every blind write in its values; "Forget remembered values" hides them.
    if (this.writeOnly && this.forgottenControls.has(key)) return undefined
    const v = this.micState?.values[key]
    if (v !== undefined) return v
    return this.writeOnly ? this.sentControls[key] : undefined
  }
  /** How the value is known: read back (solid), sent but not confirmed (sent), or not at all (unknown). */
  confidence(id: ControlId, unit?: UnitId): Confidence {
    const v = this.value(id, unit)
    if (v === undefined) return 'unknown'
    return this.live ? 'solid' : 'sent'
  }
  /** Why the control (on this unit) is blocked right now, or null when it is available. */
  availability(id: ControlId, unit?: UnitId): ControlAvailability | null {
    const a = this.micState?.availability
    if (!a) return null
    const v = (unit ? a[controlKey(id, unit)] : undefined) ?? a[id]
    return v && !v.ok ? v : null
  }
  /** A few words for a blocked control ("No mic connected"), or null while it is available. */
  blockText(id: ControlId, unit?: UnitId): string | null {
    return reasonText(this.availability(id, unit), this.writeOnly)
  }
  isPending(id: ControlId, unit?: UnitId): boolean {
    return (this.controlPending[controlKey(id, unit)] ?? 0) > 0
  }
  /** Units in the kit, RX first (online or not), as the device reports them. */
  get unitList(): MicUnit[] {
    const u = this.micState?.units
    return u ? (Object.values(u).filter(Boolean) as MicUnit[]) : []
  }
  /**
   * Mic slots to draw (tx1…tx4): 2 or 4, from the firmware / mode where the family says so
   * (A1 2 / 4-mic firmware, MAX 2 "4 Mic & 1 RX", M3 4CH), else the mics that are online.
   */
  get micSlots(): UnitId[] {
    const s = this.micState
    if (!s) return []
    const tx = (['tx1', 'tx2', 'tx3', 'tx4'] as const).filter((u) => s.units[u])
    let n = Math.min(tx.length, 2)
    if (this.family === '6108') n = a1.a1MicSlots(s) ?? 2
    else if (
      tx.length > 2 &&
      (s.units.tx3?.online || s.units.tx4?.online || s.product.channels >= 4 || s.values[max2.MAX2_CONTROL.FOUR_MIC] === true)
    )
      n = 4
    return tx.slice(0, n)
  }
  /** "RX 1.0.0.15 · TX1 1.0.0.12 · TX2 1.0.0.12 · Case 1.0.0.8" (every unit with a known version), or null. */
  get firmware(): string | null {
    const name: Partial<Record<string, string>> = { box: 'Case', earL: 'Ear L', earR: 'Ear R', remote: 'Remote' }
    const parts = this.unitList.filter((u) => u.version).map((u) => `${name[u.id] ?? u.id.toUpperCase()} ${u.version}`)
    return parts.length ? parts.join(' · ') : null
  }

  /**
   * The confirmation a write needs, or null: disruptive controls (the receiver restarts or changes
   * mode), destructive ones (tested products only), the M3 channel mode to or from 4-track, the
   * MAX 2 timecode reset. Pass `{ confirm: true }` to setControl() after the user agreed.
   */
  confirmFor(id: ControlId, value: ControlValue, unit?: UnitId): ConfirmInfo | null {
    void unit
    const mic = this.micDev
    const spec = this.control(id)
    if (!mic || !spec) return null
    if (spec.safety === 'destructive') return confirmInfo(spec, 'destructive')
    if (spec.safety === 'disruptive') return confirmInfo(spec, disruptiveKind(spec))
    // Legacy speaker passthrough: setControl() runs the official flow, which restarts the receiver.
    if (this.dev && id === CONTROL.SPEAKER) return confirmInfo(spec, 'restart', 'The receiver restarts.')
    if (m3.isM3Device(mic) && id === CONTROL.CHANNEL_MODE && typeof value === 'number' && mic.channelModeNeedsConfirm(value)) {
      return confirmInfo(spec, 'restart', spec.confirmText ?? m3.M3_RESTART_TEXT)
    }
    if (max2.isMax2Device(mic) && id === max2.MAX2_CONTROL.TC_TIMING && typeof value === 'number' && mic.timingNeedsConfirm(value)) {
      return confirmInfo(spec, 'reset', max2.MAX2_TC_RESET_TEXT)
    }
    return null
  }

  /**
   * Generic write for every product: optimistic value while pending, rollback + "Setup failed."
   * toast on failure, remembered locally when sent blind (write-only). A write that needs a
   * confirmation (confirmFor) is refused unless `confirm: true`. A confirmed restart shows the
   * restart overlay and reconnects when the receiver comes back. Returns true on success.
   * Legacy pages keep their typed setters (setVolume() …); this works for legacy products too.
   */
  async setControl(id: ControlId, value: ControlValue, o: { unit?: UnitId; confirm?: boolean } = {}): Promise<boolean> {
    const mic = this.micDev
    if (!mic || this.phase !== 'ready') return false
    const spec = this.control(id)
    if (!spec) return false
    const confirm = this.confirmFor(id, value, o.unit)
    if (confirm && !o.confirm) {
      console.warn(`[session] ${id} needs a confirmation (confirmFor) before setControl(…, { confirm: true })`)
      return false
    }
    // Legacy speaker passthrough: the official flow sets it, counts down and restarts the receiver.
    if (this.dev && id === CONTROL.SPEAKER && typeof value === 'boolean') return this.applySpeakerPassthrough(value)
    const key = controlKey(id, o.unit)
    const epoch = this.epoch
    const seq = (this.writeSeq[`c:${key}`] ?? 0) + 1
    this.writeSeq[`c:${key}`] = seq
    const stale = () => epoch !== this.epoch || this.micDev !== mic
    const newest = () => this.writeSeq[`c:${key}`] === seq
    const shown = spec.kind !== 'action'
    if (shown) this.controlOverlay = { ...this.controlOverlay, [key]: value }
    this.controlPending = { ...this.controlPending, [key]: (this.controlPending[key] ?? 0) + 1 }
    const settle = () => {
      if (!newest() || !(key in this.controlOverlay)) return
      const next = { ...this.controlOverlay }
      delete next[key]
      this.controlOverlay = next
    }
    try {
      const r = await mic.set(id, value, { unit: o.unit, confirm: o.confirm })
      this.logWrite({ at: Date.now(), id, unit: o.unit, value, ok: r.ok, confirmed: r.confirmed, code: r.code })
      if (!r.ok) throw new Error('The receiver rejected the setting.')
      if (stale()) return false
      this.sentAt = { ...this.sentAt, [key]: Date.now() }
      if (shown && !r.confirmed) this.rememberSentControl(key, value)
      settle()
      if (confirm?.kind === 'restart') this.beginRestart(mic, r.confirmed)
      return true
    } catch (e) {
      if (!(e instanceof Error && e.message === 'The receiver rejected the setting.')) {
        this.logWrite({ at: Date.now(), id, unit: o.unit, value, ok: false, error: `${(e as Error)?.name}: ${(e as Error)?.message}` })
      }
      if (stale() || e instanceof DisconnectedError) return false
      settle()
      toasts.error(`Setup failed. ${writeErrorText(e, this.writeOnly)}`, {
        action: { label: 'Retry', run: () => void this.setControl(id, value, o) },
      })
      return false
    } finally {
      if (!stale()) {
        const n = Math.max(0, (this.controlPending[key] ?? 1) - 1)
        const next = { ...this.controlPending }
        if (n > 0) next[key] = n
        else delete next[key]
        this.controlPending = next
      }
    }
  }

  private logWrite(w: WriteRecord) {
    this.writeLog.push(w)
    if (this.writeLog.length > WRITE_LOG_MAX) this.writeLog.splice(0, this.writeLog.length - WRITE_LOG_MAX)
  }

  // ----------------------------------------------------- device-pushed levels (MELO P1)

  /** The product pushes its own levels (MELO P1): meters work without microphone permission. */
  get hasDeviceLevels(): boolean {
    return melo.hasMeloLevels(this.shown)
  }

  /**
   * Start the device level stream while a component shows it; call the returned function on
   * destroy. Reference-counted: the stream stops when the last user releases it, and is started
   * again after a reconnect while someone still uses it.
   */
  useLevels(): () => void {
    this.levelRefs++
    if (this.levelRefs === 1) void this.startLevels()
    let released = false
    return () => {
      if (released) return
      released = true
      this.levelRefs = Math.max(0, this.levelRefs - 1)
      if (this.levelRefs === 0) void this.stopLevels()
    }
  }

  private async startLevels(): Promise<void> {
    const mic = this.micDev
    if (!melo.hasMeloLevels(mic) || this.phase !== 'ready' || !this.live) return
    try {
      await mic.startLevels()
      if (this.micDev === mic) this.levelsActive = mic.levelsActive
    } catch (e) {
      if (this.micDev === mic && !(e instanceof DisconnectedError)) console.warn('[session] levels', e)
    }
  }

  private async stopLevels(): Promise<void> {
    const mic = this.micDev
    this.levelsActive = false
    if (!melo.hasMeloLevels(mic)) return
    await mic.stopLevels().catch(() => undefined)
  }

  // ----------------------------------------------------------------------- lifecycle

  async refreshKnown() {
    if (!this.connectPaths.usb) {
      this.known = null
      return
    }
    try {
      const devices = await grantedUsbDevices()
      if (!devices.length) {
        this.known = null
        return
      }
      const d = devices[0]
      const p = resolveUsbProduct(d.vendorId, d.productId)
      this.known = { name: p?.name ?? d.productName ?? 'receiver' }
    } catch {
      this.known = null
    }
  }

  /**
   * Open the USB chooser (needs a user gesture): every connectable USB product, legacy interrupt
   * reports and the A1's feature reports alike. `anyDevice` lists every HID device (fallback for
   * products whose vendor id is unconfirmed: LARK M3, MELO P1).
   */
  async connect(o: { anyDevice?: boolean } = {}): Promise<void> {
    await this.connectWith('webhid', () => requestUsb(o))
  }

  /** Open the Bluetooth chooser (needs a user gesture): LARK MAX 2 charging case, MELO P1. */
  async connectBluetooth(): Promise<void> {
    await this.connectWith('web-bluetooth', async () => {
      const t = await requestBluetooth()
      return t ? { transport: t, kind: 'web-bluetooth', product: t.product ?? undefined } : null
    })
  }

  /** Reopen a previously granted receiver without the chooser. */
  async reconnect(): Promise<void> {
    if (this.transportKind === 'web-bluetooth') {
      const id = this.bleDeviceId
      if (this.phase === 'lost') {
        // Keep the frozen page while the receiver is out of range or off.
        const t = await reconnectBluetooth(id ?? undefined, 5000, this.bleDevice)
        if (!t) {
          toasts.info('Receiver not found. Turn it on and bring it closer.')
          return
        }
        await this.attach(t, 'lost', t.product ?? undefined)
        return
      }
      const device = this.bleDevice
      await this.connectWith('web-bluetooth', async () => {
        const t = await reconnectBluetooth(id ?? undefined, 5000, device)
        return t ? { transport: t, kind: 'web-bluetooth', product: t.product ?? undefined } : null
      })
      return
    }
    if (this.phase === 'lost' && HID_KINDS.has(this.transportKind ?? '')) {
      // From the "connection lost" banner: keep the frozen page and the automatic reconnect
      // when the receiver isn't plugged in yet, instead of dropping to the connect screen.
      let r: Awaited<ReturnType<typeof reconnectUsb>> = null
      try {
        r = await reconnectUsb(this.product)
      } catch {
        r = null
      }
      if (!r) {
        toasts.info('Receiver not found. Plug it back in.')
        return
      }
      await this.attach(r.transport, 'lost', r.product)
      return
    }
    await this.connectWith('webhid', () => reconnectUsb())
  }

  /** Connect through any transport factory (e.g. the localhost bridge). */
  async connectWith(kind: string, factory: TransportFactory): Promise<void> {
    if (this.phase === 'connecting') return
    this.error = null
    this.phase = 'connecting'
    this.step = kind === 'webhid' || kind === 'web-bluetooth' ? 'Choose the receiver…' : 'Connecting…'
    this.factory = factory
    this.transportKind = kind
    try {
      // The factory runs first: a chooser's requestDevice() must stay inside the click's user gesture.
      const pending = factory()
      warmDrivers(kind)
      const r = await pending
      if (!r) {
        this.phase = 'idle'
        this.step = null
        this.error = { title: 'No receiver selected' }
        return
      }
      const opened = isOpened(r) ? r : { transport: r }
      if (opened.kind) this.transportKind = opened.kind
      await this.attach(opened.transport, 'idle', opened.product)
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
   * `product` names the registry row when the transport's VID/PID cannot (Bluetooth charging
   * case, a product whose vendor id is unconfirmed, the simulator).
   */
  private async attach(t: Transport, fallback: 'idle' | 'lost' = 'idle', product?: ProductInfo): Promise<void> {
    // Already opening one (several HID "connect" events per replug, or a second Reconnect click).
    // Don't close `t`: an unopened WebHID transport shares its HIDDevice with the one in progress.
    if (this.attaching) return
    this.attaching = true
    const epoch = ++this.epoch
    this.detachListeners()
    this.intentionalClose = false
    this.resetWrites()
    this.forgotten = new Set()
    this.forgottenControls = new Set()
    const quiet = fallback === 'lost' && (this.phase === 'lost' || this.phase === 'restarting')
    if (!quiet) {
      this.phase = 'connecting'
      this.lastUpdate = null
    }
    this.step = 'Opening the receiver…'
    try {
      const info = t.info
      const row = product ?? (info ? resolveUsbProduct(info.vendorId, info.productId) : undefined)
      // Fetches the family's driver chunk the first time (warmDrivers() usually did already).
      const mic = await openMicDevice(t, { blindWrites: true, allowDestructive: true, ...(row ? { product: row } : {}) })
      if (epoch !== this.epoch) {
        // Disconnected while the driver was fetched: nothing holds `t` yet.
        await t.close().catch(() => {})
        return
      }
      const previous = this.product
      this.micDev = mic
      this.lastMic = mic
      this.dev = isLegacyMicDevice(mic) ? mic.legacy : null
      if (t.kind === 'web-bluetooth') {
        const ble = t as WebBluetoothTransport
        this.bleDeviceId = ble.deviceId
        this.bleDevice = ble.device
      }
      if (!previous || previous.productId !== mic.product.productId || previous.vendorId !== mic.product.vendorId) {
        this.checkResults = {}
        this.writeLog = []
      }
      this.unsubs.push(
        mic.on('state', (s) => this.onState(s)),
        mic.onTraffic((e) => this.onTraffic(e)),
        mic.on('disconnect', () => this.onDisconnect()),
        mic.on('error', (e) => console.warn('[session]', e)),
      )
      if (melo.hasMeloLevels(mic)) this.unsubs.push(mic.onLevels((l) => (this.levels = l)))
      this.step = 'Reading the receiver…'
      const s = await mic.connect()
      if (epoch !== this.epoch) return
      this.micState = s
      this.state = this.dev ? this.dev.state : null
      this.lastUpdate = s.lastStatusAt ?? null
      this.endRestartFlow()
      this.phase = 'ready'
      this.step = null
      this.error = null
      storageSet(LAST_DEVICE_KEY, { name: s.product.name, at: Date.now() })
      // The connect page's "Reconnect <name>" reopens a granted USB receiver: only a USB session names it.
      if (HID_KINDS.has(this.transportKind ?? '')) this.known = { name: s.product.name }
      else void this.refreshKnown()
      this.noticeDismissed = isNoticeDismissed(s.product)
      this.sentControls = (this.sentControlKey() && storageGet<Record<string, ControlValue>>(this.sentControlKey()!)) || {}
      if (s.rx === 'unavailable') this.restoreSent()
      else this.overlay = {}
      if (this.levelRefs > 0) void this.startLevels()
    } catch (e) {
      if (epoch !== this.epoch) return
      this.detachListeners()
      this.dev = null
      this.micDev = null
      await t.close().catch(() => {})
      this.step = null
      if (quiet) {
        this.endRestartFlow()
        this.phase = 'lost'
        const err = describeError(e)
        toasts.error(`${err.title}.${err.detail ? ` ${err.detail}` : ''}`)
      } else {
        this.lastMic = null
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
    const mic = this.micDev
    this.detachListeners()
    this.dev = null
    this.micDev = null
    this.lastMic = null
    this.state = null
    this.micState = null
    this.overlay = {}
    this.forgotten = new Set()
    this.forgottenControls = new Set()
    this.resetWrites()
    this.endRestartFlow()
    this.lastUpdate = null
    this.levels = null
    this.levelsActive = false
    this.checkResults = {}
    this.writeLog = []
    this.sentAt = {}
    this.phase = this.connectPaths.usb || this.connectPaths.bluetooth ? 'idle' : 'unsupported'
    await mic?.disconnect().catch(() => {})
  }

  private detachListeners() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
  }

  private onState(s: MicState) {
    this.micState = s
    if (this.dev) this.state = this.dev.state
    if (s.lastStatusAt) this.lastUpdate = s.lastStatusAt
  }

  private onDisconnect() {
    if (this.intentionalClose) return
    this.detachListeners()
    this.dev = null
    this.micDev = null
    this.resetWrites()
    this.levelsActive = false
    // During an RX restart the drop is expected; the restart deadline decides when to give up.
    if (this.phase !== 'restarting') this.phase = 'lost'
    else if (this.transportKind === 'web-bluetooth') void this.reconnectBluetoothWhileRestarting()
  }

  /** Bluetooth has no "device connected" event: retry the silent reconnect while the restart overlay is up. */
  private async reconnectBluetoothWhileRestarting() {
    const epoch = this.epoch
    while (this.phase === 'restarting' && epoch === this.epoch && !this.micDev) {
      const t = await reconnectBluetooth(this.bleDeviceId ?? undefined, BLE_RESTART_RETRY_MS, this.bleDevice)
      if (t && this.phase === 'restarting' && epoch === this.epoch) {
        await this.attach(t, 'lost', t.product ?? undefined)
        return
      }
      await t?.close().catch(() => undefined)
      await new Promise((r) => setTimeout(r, BLE_RESTART_RETRY_MS))
    }
  }

  private onTraffic(e: MicTrafficEntry) {
    traffic.add({
      dir: e.direction === 'tx' ? 'out' : 'in',
      bytes: e.bytes,
      decoded: e.summary + (e.note && e.note !== 'reply' ? ` (${e.note})` : ''),
      status: e.note === 'timeout' ? 'timeout' : 'ok',
      heartbeat: this.dev ? e.frame?.cmd === 0x10 : this.isPollTraffic(e),
      manual: e.note === 'raw',
    })
  }

  /** A status poll or push of a non-legacy family (for the console's heartbeat filter). */
  private isPollTraffic(e: MicTrafficEntry): boolean {
    const mic = this.micDev
    const polls = mic ? POLL_COMMANDS[mic.family] : undefined
    if (!polls || !mic) return false
    if (e.direction === 'tx') {
      if (!e.bytes.length) return false
      const cmd = loadedDriverFor(mic.product)?.commandOfFrame(e.bytes) ?? null
      return cmd !== null && polls.includes(cmd)
    }
    const cmd = (e.message as { cmd?: number } | undefined)?.cmd
    return typeof cmd === 'number' && polls.includes(cmd)
  }

  // -------------------------------------------------------------- write-only memory

  /**
   * Storage key for the values sent in write-only mode. WebHID exposes no serial number, so this
   * is per model (product ID) in this browser, not per receiver.
   */
  private sentKey(): string | null {
    const p = this.product
    if (!p) return null
    const serial = this.micDev?.transport.info?.serialNumber ?? ''
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

  /** Generic API: storage key of the control values sent blind, per product (family + id). */
  private sentControlKey(): string | null {
    const p = this.product
    const mic = this.micDev
    if (!p || !mic || isLegacyMicDevice(mic)) return null
    return `${SENT_CONTROL_KEY_PREFIX}${mic.family}.${p.productId.toString(16)}`
  }

  private rememberSentControl(key: string, value: ControlValue) {
    if (!this.writeOnly) return
    if (this.forgottenControls.has(key)) {
      const next = new Set(this.forgottenControls)
      next.delete(key)
      this.forgottenControls = next
    }
    this.sentControls = { ...this.sentControls, [key]: value }
    const k = this.sentControlKey()
    if (k) storageSet(k, this.sentControls)
  }

  /** Forget the values this browser remembered for this model of receiver (write-only mode). */
  forgetSent() {
    const k = this.sentKey()
    if (k) storageRemove(k)
    this.overlay = {}
    // The library already holds every blind write in its own state: hide those values too.
    if (this.writeOnly) this.forgotten = new Set(Object.keys(this.state?.settings ?? {}))
    const ck = this.sentControlKey()
    if (ck) storageRemove(ck)
    this.sentControls = {}
    // Same for the generic API: the device's values hold every blind write.
    if (this.writeOnly) this.forgottenControls = new Set(Object.keys(this.micState?.values ?? {}))
    this.sentAt = {}
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
    this.controlOverlay = {}
    this.controlPending = {}
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
      this.logWrite({ at: Date.now(), id: key, value: patch, ok: r.ok, confirmed: r.confirmed, code: r.code })
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
  private armRestartTimers(mic: MicDevice) {
    this.clearRestartTimers()
    this.restartSlow = false
    this.restartTimers.push(
      setTimeout(() => {
        if (this.phase === 'restarting' && this.micDev === mic) {
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

  /** A confirmed generic write restarts the receiver: show the overlay, wait for it to come back. */
  private beginRestart(mic: MicDevice, confirmed: boolean) {
    if (this.phase !== 'ready' || this.micDev !== mic) return
    this.restartConfirmed = confirmed
    this.restartCountdown = 0
    this.phase = 'restarting'
    this.armRestartTimers(mic)
  }

  /** "Stop waiting" on the restart overlay (and the automatic deadline). */
  stopWaitingForRestart() {
    if (this.phase !== 'restarting') return
    this.endRestartFlow()
    // Still attached: carry on. Gone: the lost banner keeps the automatic reconnect running.
    this.phase = this.micDev ? 'ready' : 'lost'
  }

  /**
   * "External speaker without unplugging": set, then restart the RX after a 3 s countdown
   * (matches the official app). The page reconnects automatically when the RX comes back.
   */
  async setSpeakerPassthrough(on: boolean): Promise<boolean> {
    const dev = this.dev
    const mic = this.micDev
    if (!dev || !mic || this.phase !== 'ready') return false
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
      if (this.phase === 'restarting') this.armRestartTimers(mic)
      return true
    } catch (e) {
      if (this.dev === dev) toasts.error(`Setup failed. ${(e as Error).message}`)
      if (this.phase === 'restarting') this.phase = this.micDev ? 'ready' : 'lost'
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
      toasts.success(r.confirmed ? 'Deleted' : 'Removal sent')
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
      toasts.success(r.confirmed ? 'Reset successful' : 'Reset sent')
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

  /**
   * Raw frame from the developer console. Returns an error message or null. Legacy products: one
   * 64-byte `AA DD` packet through HollylandDevice. Other families: the frame as typed, with the
   * engine's console rules (untested products refuse unclassifiable and destructive frames).
   */
  async sendRaw(bytes: Uint8Array): Promise<string | null> {
    const dev = this.dev
    const mic = this.micDev
    if (!mic) return 'Not connected'
    try {
      if (dev) {
        const packet = new Uint8Array(64)
        packet.set(bytes.subarray(0, 64))
        await dev.sendRaw(packet, { force: true })
      } else {
        await mic.sendRaw(bytes, { force: true })
      }
      return null
    } catch (e) {
      return (e as Error).message
    }
  }

  /** Re-read identity (versions + serials) for every online unit. */
  async refreshIdentity(): Promise<void> {
    if (!this.micDev || !this.live) return
    if (this.dev) await this.dev.getIdentity().catch(() => undefined)
    else await this.micDev.refresh('identity').catch(() => undefined)
  }

  /**
   * DEVELOPMENT ONLY: attach a protocol simulator from the registry's mock presets (`?mock=<id>`,
   * every family: a2, blind, a2s, m2s, m2scam, m2, a1, m3cam4, max2box, melo …; unknown ids fall back
   * to a2). The static registry and the simulators are imported inside the DEV branch only, so a
   * production build contains none of them.
   */
  async connectMock(id: string): Promise<void> {
    if (import.meta.env.DEV) {
      const [{ findMockPreset }, { simulatedTransport }] = await Promise.all([
        import('../protocol/core/registry'),
        import('../protocol/core/simulate'),
      ])
      const found = findMockPreset(id) ?? findMockPreset('a2')
      if (!found) return
      const { driver, preset, product } = found
      const sim = driver.createSimulator(product, preset.sim)
      ;(globalThis as Record<string, unknown>).__sim = (sim as { receiver?: unknown }).receiver ?? sim
      await this.connectWith('mock', async () => ({ transport: simulatedTransport(sim, { latencyMs: 8 }), product }))
    }
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
    if (!this.micDev) return
    await this.micDev.probe().catch(() => undefined)
  }

  // ------------------------------------------------------------------ hardware report

  /** First-contact checklist of the product's driver (docs/FAMILIES.md §5.7). */
  get hardwareChecks() {
    const p = this.product
    // The driver is loaded whenever a product is shown: attach() fetched it before creating the device.
    return (p && loadedDriverFor(p)?.hardwareCheck) || []
  }

  /**
   * Run the checklist's automatic read-only steps (descriptor, reads) and keep the results for the
   * report. Steps that write (even reversibly) are never run from here. Live mode only.
   */
  async runHardwareCheck(): Promise<void> {
    const mic = this.micDev
    if (!mic || this.checkRunning || this.phase !== 'ready') return
    this.checkRunning = true
    try {
      const results: Record<string, CheckOutcome> = {}
      for (const step of this.hardwareChecks) {
        if (!step.run) continue
        if (step.kind === 'write-reversible') {
          results[step.id] = { ok: false, summary: 'writes are not run automatically', skipped: true }
          continue
        }
        if (step.kind === 'read' && !this.live) {
          results[step.id] = { ok: false, summary: 'replies not received', skipped: true }
          continue
        }
        try {
          results[step.id] = await step.run(mic)
        } catch (e) {
          results[step.id] = { ok: false, summary: `${(e as Error).name}: ${(e as Error).message}` }
        }
        if (this.micDev !== mic) break
        this.checkResults = { ...results }
      }
      this.checkResults = results
    } finally {
      this.checkRunning = false
    }
  }

  /** Plain-text report for "Copy hardware report" (null when nothing is connected). */
  hardwareReport(o: { trafficLimit?: number } = {}): string | null {
    const mic = this.micDev
    const p = this.product
    if (!p) return null
    return buildHardwareReport({
      now: Date.now(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      page: typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '',
      product: p,
      support: this.support ?? supportOf(p),
      linkKind: this.transportKind,
      transport: mic?.transport ?? null,
      state: this.micState,
      // The drivers' own labels (the official apps' words), not the display ones.
      controls: this.shown?.controls ?? [],
      writes: this.writeLog,
      checks: this.hardwareChecks,
      checkResults: this.checkResults,
      traffic: traffic.entries,
      trafficLimit: o.trafficLimit,
    })
  }

  /** Copy the report to the clipboard. Returns false when nothing is connected or the clipboard refuses. */
  async copyHardwareReport(): Promise<boolean> {
    const text = this.hardwareReport()
    if (!text) return false
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
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
    const mic = this.micDev
    if (!mic || !this.live || this.phase !== 'ready') return
    if (this.dev) await this.dev.getSettings().catch(() => undefined)
    else await mic.refresh('settings').catch(() => undefined)
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

// Development builds: the session and the simulator (`__sim`, see connectMock) are reachable from the
// browser console and from screenshot scripts.
if (import.meta.env.DEV && typeof window !== 'undefined') (globalThis as Record<string, unknown>).__session = session
