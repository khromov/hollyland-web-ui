/**
 * Core contracts for every product family (docs/FAMILIES.md §3.3). Types only, no runtime code.
 *
 *  - MicDevice    what the UI talks to, whatever the framing or transport. HollylandDevice is
 *                 adapted to it by families/legacy (LegacyMicDevice); every other family runs on
 *                 the generic engine (core/engine.ts, FamilyDevice).
 *  - FamilyDriver one per family folder (families/<code>/index.ts exports `driver`).
 *  - ProtocolSpec what a driver gives the engine: framing, correlation, status mapping, writes.
 *
 * Phase 1 agents code against these signatures; changes go through the W0 owner (FAMILIES.md §3.7).
 */
import type { Safety } from '../commands'
import type { RxAvailability, SetResult, TrafficEntry } from '../device'
import type { ProductInfo } from '../models'
import type { Transport, TransportCapabilities, TransportDeviceInfo } from '../transport'
import type { FamilyCode, UnitId } from './ids'

export type { FamilyCode, LinkKind, UnitId } from './ids'
export type { Safety } from '../commands'
export type { RxAvailability, SetResult } from '../device'

// ------------------------------------------------------------------------------ support data

/**
 * How far a product is supported, as data (FAMILIES.md §0 #6, §4.3). The UI derives the
 * "Untested" plate, the first-connect notice and the safety gating from it; the engine refuses
 * destructive and OTA commands when `hardware === 'untested'` (§2.3).
 */
export interface SupportInfo {
  /** supported: full driver; experimental: driver from app code only; recognised: named, cannot connect. */
  level: 'supported' | 'experimental' | 'recognised'
  /** sibling-tested: the same protocol was tested on another model (e.g. A2S via the A2). */
  hardware: 'tested' | 'sibling-tested' | 'untested'
  /** e.g. "LARK A2 fw 3.0.2.008 · macOS Chrome WebHID: write-only · 2026-11-05". */
  testedOn?: readonly string[]
  /** How sure the research is about this product's protocol (FAMILIES.md §1.2 "Confidence"). */
  confidence: 'high' | 'medium' | 'low'
  /** Research document, e.g. "docs/research/families/m3-6303.md". */
  research: string
  /** One-line qualifier, e.g. "high (wire), medium (UI semantics)". */
  note?: string
}

/** Web Bluetooth UUID: 16-bit alias as a number (0xfee7) or a full lowercase UUID string. */
export type BleUuid = number | string

/** Structural copy of the Web Bluetooth `BluetoothLEScanFilter` (no lib types for it in this project). */
export interface BleScanFilter {
  services?: readonly BleUuid[]
  name?: string
  namePrefix?: string
  serviceData?: readonly { service: BleUuid; dataPrefix?: readonly number[]; mask?: readonly number[] }[]
  manufacturerData?: readonly { companyIdentifier: number; dataPrefix?: readonly number[]; mask?: readonly number[] }[]
}

/**
 * How a browser reaches a product (FAMILIES.md §3.4). A product may have several (MELO P1 RX:
 * WebHID and Web Bluetooth). The local bridge serves every product with a `webhid` link
 * (interrupt pipe), so it has no LinkSpec of its own.
 */
export type LinkSpec = WebHidLinkSpec | WebHidFeatureLinkSpec | WebBluetoothLinkSpec

/**
 * Interrupt-pipe HID. `reportId`:
 *  - 'byte0'  the frame's first byte is the report id (legacy `AA DD`, MAX 2 / MELO P1 USB):
 *             sendReport(frame[0], pad(frame[1..])), input [reportId, ...data]
 *  - number   a declared report id that the frame carries in byte 0 (M3: 8, m3-6303.md §2.3);
 *             mapped exactly like 'byte0', but `frame[0]` must equal it
 *  - 'none'   no report-id layer: sendReport(0, pad(frame))
 */
export interface WebHidLinkSpec {
  kind: 'webhid'
  reportId: 'byte0' | 'none' | number
  /**
   * Frame sizes on the wire, report-id byte included (legacy: [64]; M3: [64, 512]). Frames are
   * padded by the family codec, not by the transport. Absent: unknown until a descriptor is seen.
   */
  outSizes?: readonly number[]
  /** Largest input transfer expected (M3: 512). Absent: 64. */
  inSize?: number
  /** Vendor usage page of the control collection, when known (A2: 0xff82). */
  usagePage?: number
  /** Frames vary in length and are written unpadded (MAX 2 USB, MELO P1 USB). */
  variableLength?: boolean
  note?: string
}

/** SET_REPORT / GET_REPORT on a feature report (A1: id 5, 64 bytes incl. id; a1-6108.md §2.1). */
export interface WebHidFeatureLinkSpec {
  kind: 'webhid-feature'
  reportId: number
  /** Report size including the id byte (A1: 64). */
  size: number
  /** Documented only; never used (OTA: A1 report 6, 160 bytes). */
  otaReportId?: number
  note?: string
}

/** GATT service with one write and one notify characteristic (MAX 2 BOX, MELO P1 RX). */
export interface WebBluetoothLinkSpec {
  kind: 'web-bluetooth'
  filters: readonly BleScanFilter[]
  service: BleUuid
  write: BleUuid
  notify: BleUuid
  writeMode: 'with-response' | 'without-response'
  note?: string
}

/** Kind of physical product a registry row names. */
export type DeviceKind = 'receiver' | 'mic' | 'case' | 'earphones'

// ------------------------------------------------------------------------------------ units

export interface MicUnit {
  id: UnitId
  online: boolean
  version?: string
  serial?: string
  mac?: string
  /** Percent 0..100. Absent when the unit reports none (phone receivers). */
  battery?: number
  charging?: boolean
  muted?: boolean
  /** M3 multi-RX. */
  role?: 'primary' | 'secondary'
  kind?: 'phone-rx' | 'camera-rx'
  /** Display label when it differs from the default (Lark C1 2nd gen swaps Mic1/Mic2 for display). */
  label?: string
}

// --------------------------------------------------------------------------------- controls

/** Canonical ('noise.enabled', see core/controls.ts CONTROL) or family-scoped ('a1.eq', 'max2.tc.fps'). */
export type ControlId = string
export type ControlValue = boolean | number | readonly number[]

export type ControlSafety = 'write' | 'disruptive' | 'destructive' | 'ota'
export type ControlGroup = 'mics' | 'receiver' | 'audio' | 'settings' | 'timecode' | 'monitoring' | 'advanced'

export interface ControlOption {
  value: number
  label: string
}

/**
 * One user-facing setting or action (FAMILIES.md §3.3, §4.1 generic control renderer):
 * switch → slide switch (boolean), choice → key row (number from `options`), steps → detent fader
 * (integer in `range`), range → slider (number in `range`), action → key with confirm (value `true`).
 */
export interface ControlSpec {
  id: ControlId
  /** Official app label (Android R strings / iOS Localizable), e.g. "EQ Adjustment". */
  label: string
  group: ControlGroup
  kind: 'switch' | 'choice' | 'steps' | 'range' | 'action'
  options?: readonly ControlOption[]
  range?: { min: number; max: number; step: number; unit?: string; displayOffset?: number }
  /** Per-unit control (per-mic mute / gain): `set()` needs `{ unit }` from this list. */
  perUnit?: readonly UnitId[]
  safety: ControlSafety
  /** For disruptive controls: "The receiver restarts." */
  confirmText?: string
  /** How the new value is confirmed: next status poll, a GET, a device push, or not at all. */
  readBack: 'status' | 'get' | 'push' | 'none'
  /** How sure the value mapping is; 'medium' / 'low' gets a "?" note in the UI (§4.3). */
  confidence: 'high' | 'medium' | 'low'
  /** Citation: "A <class.method>; I <selector> @0x…". */
  source: string
  /** Optional longer description for tooltips. */
  description?: string
}

/** Why a control is (un)available right now: firmware gates and the official app's preconditions. */
export interface ControlAvailability {
  ok: boolean
  /** Machine-readable reason, e.g. 'firmware-too-old', 'version-unknown', 'noise-off', 'secondary-rx'. */
  reason?: string
  /** Human-readable explanation. */
  message?: string
}

// ------------------------------------------------------------------------------------ state

export interface MicState {
  product: ProductInfo
  family: FamilyCode
  connected: boolean
  rx: RxAvailability
  /** Consecutive status-poll timeouts after the link had been up. */
  missedHeartbeats: number
  lastStatusAt: number | null
  units: { rx: MicUnit } & Partial<Record<UnitId, MicUnit>>
  values: Partial<Record<ControlId, ControlValue>>
  availability: Partial<Record<ControlId, ControlAvailability>>
  /** Last decoded status struct (legacy: Heartbeat), for the console. */
  raw?: unknown
}

/** Traffic log entry. `frame` is the legacy DecodedFrame (null for other families); `message` the family's decoded message. */
export interface MicTrafficEntry extends TrafficEntry {
  message?: unknown
}

export interface MicEvents {
  state: [MicState]
  /** A decoded status message was applied (heartbeat / push). */
  status: [unknown]
  'unit-online': [UnitId]
  'unit-offline': [UnitId]
  'rx-unavailable': []
  traffic: [MicTrafficEntry]
  /** Unsolicited message that matched no request (legacy: DecodedFrame). */
  push: [unknown]
  error: [Error]
  disconnect: [Error | undefined]
}

export interface MicSetOptions {
  unit?: UnitId
  /** Required for disruptive (and, where allowed, destructive) controls. */
  confirm?: boolean
}

export interface MicDevice {
  readonly product: ProductInfo
  readonly family: FamilyCode
  readonly support: SupportInfo
  readonly transport: Transport
  readonly state: MicState
  /** Controls offered for this product (destructive/OTA ones are absent for untested products). */
  readonly controls: readonly ControlSpec[]
  connect(): Promise<MicState>
  disconnect(): Promise<void>
  /** Re-run the reply-delivery probe. */
  probe(): Promise<RxAvailability>
  refresh(what: 'status' | 'identity' | 'settings'): Promise<void>
  set(id: ControlId, value: ControlValue, o?: MicSetOptions): Promise<SetResult>
  /** Console: send one raw frame. Refused unless it parses as a catalogued read, or `force`. */
  sendRaw(frame: Uint8Array, o?: { force?: boolean; timeoutMs?: number }): Promise<void>
  /** Nested pause of the status poll. */
  pauseHeartbeat(): void
  resumeHeartbeat(): void
  on<K extends keyof MicEvents>(event: K, listener: (...args: MicEvents[K]) => void): () => void
  onTraffic(listener: (e: MicTrafficEntry) => void): () => void
}

export interface MicDeviceOptions {
  /** Override VID/PID product detection. */
  product?: ProductInfo
  requestTimeoutMs?: number
  probeTimeoutMs?: number
  /** Extra attempts for retry-safe reads. */
  retries?: number
  interFrameDelayMs?: number
  /** null disables polling; default = the protocol's heartbeat interval. */
  heartbeatIntervalMs?: number | null
  heartbeatMissLimit?: number
  /** Allow writes when replies cannot be received (results have confirmed = false; toggles still refused). */
  blindWrites?: boolean
  /** Needed (plus a per-call confirm) for destructive commands on hardware-tested products. Untested: always refused. */
  allowDestructive?: boolean
  /** Refuse writes the official app refuses in the current state (default true). */
  enforcePreconditions?: boolean
  /** Offer firmware-gated controls while the version is unknown or too old (default false). */
  ignoreFirmwareGates?: boolean
  /** Fetch versions / serials on connect and when a unit comes online (default true). */
  fetchIdentity?: boolean
  /** Fetch GET-only settings on connect (default true). */
  fetchSettings?: boolean
  now?: () => number
}

// ---------------------------------------------------------------------------- driver contract

/** Command catalogue entry (A `Command…` constant / I `HL…CommandType` raw value). */
export interface CommandSpec {
  name: string
  safety: Safety
  /** Safe to resend automatically when no reply arrives (the engine retries reads only). */
  retrySafe: boolean
  /** Flips state: never resent, never sent blind (§2.3). */
  toggle?: boolean
  /** Citation: "A <class.method>; I <symbol> @0x…". */
  source: string
  description?: string
}

export type CommandCatalogue = Readonly<Record<number, CommandSpec>>

export interface MockPreset {
  /** `?mock=<id>` in development builds, e.g. 'a1', 'm3cam4', 'max2box'. Unique across drivers. */
  id: string
  label: string
  family: FamilyCode
  productId: number
  sim?: SimOptions
}

export interface HardwareCheckResult {
  ok: boolean
  summary: string
  data?: unknown
}

/** First-contact checklist step (FAMILIES.md §5.7): read-only first, one reversible write last. */
export interface HardwareCheckStep {
  id: string
  title: string
  kind: 'descriptor' | 'read' | 'write-reversible' | 'observe'
  /** What to record in the diagnostic report. */
  detail: string
  /** Automatic run; absent for manual steps. Must only send read commands unless kind is 'write-reversible'. */
  run?: (device: MicDevice) => Promise<HardwareCheckResult>
}

export interface FamilyDriver {
  readonly code: FamilyCode
  /** Family display name, e.g. "LARK A1". */
  readonly name: string
  /** stub: products only, cannot connect. */
  readonly status: 'stub' | 'experimental' | 'supported'
  /** Registry rows this driver serves (USB rows and app/BLE rows). */
  readonly products: readonly ProductInfo[]
  /** Every known command id, including documented-only destructive/OTA ones (so the engine can refuse them in sendRaw). */
  readonly commands: CommandCatalogue
  /** Superset of the family's controls; a device filters them per product. */
  readonly controls: readonly ControlSpec[]
  readonly research: string
  createDevice(transport: Transport, product: ProductInfo, o?: MicDeviceOptions): MicDevice
  createSimulator(product: ProductInfo, o?: SimOptions): DeviceSimulator
  /** Command id of an encoded request frame, or null (used by tests and the console). */
  commandOfFrame(frame: Uint8Array): number | null
  readonly mockPresets: readonly MockPreset[]
  readonly hardwareCheck: readonly HardwareCheckStep[]
}

// ----------------------------------------------------------------------------- engine contract

export interface MessageAssembler<Msg> {
  /** Feed one transport packet; returns every message it completed. */
  push(chunk: Uint8Array): Msg[]
  reset(): void
  onGarbage?: (bytes: Uint8Array) => void
}

export interface EngineRequestOptions {
  /** 'background' requests (polls, identity) must be catalogued 'read' (§2.3). Default 'user'. */
  priority?: 'user' | 'background'
  timeoutMs?: number
  /** Extra attempts; applied only to catalogued retry-safe reads. */
  retries?: number
  /** Default true (false while replies are not delivered). */
  expectReply?: boolean
  /** Replace a queued request with the same coalesce key (setters). */
  coalesce?: boolean
  /** Per-call confirmation for disruptive / destructive commands. */
  confirm?: boolean
}

/** What a driver may do from its ProtocolSpec hooks. */
export interface EngineContext<Req, Msg> {
  readonly product: ProductInfo
  readonly state: MicState
  readonly options: Readonly<ResolvedMicDeviceOptions>
  /** Queue a request; resolves with the message that completed it ('done'), null without a reply. */
  request(req: Req, o?: EngineRequestOptions): Promise<Msg | null>
  /** Merge into units (a unit missing from state is created). Emits unit-online/offline on changes. */
  patchUnits(p: Partial<Record<UnitId, Partial<MicUnit>>>): void
  setValues(v: Partial<Record<ControlId, ControlValue>>): void
  setAvailability(a: Partial<Record<ControlId, ControlAvailability>>): void
  /** A status message was applied: sets lastStatusAt, resets missedHeartbeats, stores `raw`, emits 'status'. */
  statusApplied(raw: unknown): void
  emitError(e: Error): void
  /** Free-text traffic-log note. */
  note(text: string): void
  now(): number
  /** Cancellable sleep (rejects with DisconnectedError on teardown). */
  delay(ms: number): Promise<void>
}

export type ResolvedMicDeviceOptions = Required<Omit<MicDeviceOptions, 'product' | 'heartbeatIntervalMs'>> & {
  heartbeatIntervalMs: number | null
}

/** What `set()` sends: the requests in order, the values to show once acknowledged, an optional read-back. */
export interface WritePlan<Req> {
  requests: readonly Req[]
  /** Applied after every request acknowledged ok (or after a blind write). */
  optimistic?: Partial<Record<ControlId, ControlValue>>
  /** Sent in the background after a confirmed write (e.g. 150 ms later), result goes through onMessage. */
  readBack?: { request: Req; delayMs?: number }
}

/**
 * Per-family protocol, parameterised by the family's request and decoded-message types
 * (A1: `{ cmd, payload }`; Moma: `{ target, items[] }` / one item). FAMILIES.md §3.3.
 */
export interface ProtocolSpec<Req, Msg> {
  /** One complete frame, byte-exact to the Android builder (padding included where the builder pads). */
  encode(req: Req): Uint8Array
  /** Optional inverse of encode, for sendRaw classification. Absent: sendRaw needs force. */
  parseRequest?(frame: Uint8Array): Req | null
  createAssembler(): MessageAssembler<Msg>
  /** Batch "get all" requests complete on the last item: return 'partial' for the others. */
  matches(req: Req, msg: Msg): 'done' | 'partial' | false
  ack(req: Req, msg: Msg): { ok: boolean; code: number | null }
  /** Catalogue key for safety and retry rules. */
  commandOf(req: Req): number
  /**
   * Every command id the request carries (a Moma batch has several). The engine applies the safety
   * rules of FAMILIES.md §2.3 to each catalogued one, so a batch cannot hide a destructive or OTA item
   * behind another item. Absent: `[commandOf(req)]`.
   */
  commandsOf?(req: Req): readonly number[]
  /** Queue coalescing key (default: String(commandOf(req))). */
  coalesceKey?(req: Req): string
  describe(x: Req | Msg, dir: 'tx' | 'rx'): string
  /** Raw bytes of a decoded message, for the traffic log (default: the transport packet). */
  rawOf?(msg: Msg): Uint8Array
  /** Read-only request that tells whether replies are delivered (usually the heartbeat). */
  probe(): Req
  /**
   * Status poll; absent for push-only links. Must be a catalogued read. (The MAX 2 BOX over BLE is
   * push-only on Android, but iOS polls 0x600B through it every 3 s: max2-6701.md §4.2.)
   */
  heartbeat?: { request(): Req; intervalMs: number }
  /** After rx is decided 'available': identity reads, subscriptions (6201 0x6048). */
  onConnected?(ctx: EngineContext<Req, Msg>): Promise<void>
  /** Every decoded message (replies, pushes, partial items). Map status into units/values/availability. */
  onMessage(ctx: EngineContext<Req, Msg>, msg: Msg, solicited: boolean): void
  /** A unit came online (after rx is 'available'): e.g. fetch its version / serial in the background. */
  onUnitOnline?(ctx: EngineContext<Req, Msg>, unit: UnitId): void
  /** refresh('identity' | 'settings'); 'status' sends the heartbeat (or probe) by default. */
  refresh?(ctx: EngineContext<Req, Msg>, what: 'status' | 'identity' | 'settings'): Promise<void>
  /** Translate a control write into requests. Throw ControlUnavailableError / UnsupportedError to refuse. */
  encodeSet(ctx: EngineContext<Req, Msg>, id: ControlId, value: ControlValue, o: { unit?: UnitId }): WritePlan<Req>
  /**
   * Availability while replies are not delivered (rx 'unavailable'): the controls encodeSet would refuse because
   * it needs a value or a firmware version it cannot read ('state-unknown', 'version-unknown'). Pure (no
   * requests, no driver state changes). The engine applies it when rx is decided 'unavailable' and again after
   * every blind write (an optimistic value can make a control writable), and drops it once replies arrive, so a
   * UI shows those controls as blocked instead of letting them fail. Absent: nothing is blocked up front.
   */
  blindAvailability?(ctx: EngineContext<Req, Msg>): Partial<Record<ControlId, ControlAvailability>>
  /** Controls this product offers (before the engine removes destructive/OTA ones for untested products). */
  controls(product: ProductInfo): readonly ControlSpec[]
  timing: { replyTimeoutMs: number; probeTimeoutMs: number; interFrameDelayMs: number }
}

// --------------------------------------------------------------------------------- simulators

export interface SimFaults {
  /** Never answer (models macOS/Windows HID filtering). */
  dropReplies?: boolean
  /** Send every reply twice (the live A2 does). */
  duplicateReplies?: boolean
  /** Split replies into transport packets of this size (BLE MTU, multi-report frames). */
  chunkSize?: number
  /** A1: GET_REPORT returns the previous reply once. */
  staleFeatureReply?: boolean
}

export interface SimOptions extends SimFaults {
  /** RX firmware version to report, e.g. "1.0.1.3". */
  rxVersion?: string
  /** Units online at start (default: rx + the product's first two mics). */
  online?: readonly UnitId[]
  /** Family-specific profile name, e.g. '4mic', 'secondary-rx', 'ble'. */
  profile?: string
  /** Family-specific extras. */
  params?: Readonly<Record<string, unknown>>
}

export interface DeviceSimulator {
  readonly info: TransportDeviceInfo
  readonly capabilities: TransportCapabilities
  /** Plugs into MockTransport.respond: every host frame in, reply packets out. */
  respond(packet: Uint8Array): Uint8Array[]
  /** Device-initiated packets (VU, BLE status pushes, BT events). Returns a detach function. */
  attach?(inject: (packet: Uint8Array) => void): () => void
  /** Mutable: tests flip faults at run time. */
  faults: SimFaults
}
