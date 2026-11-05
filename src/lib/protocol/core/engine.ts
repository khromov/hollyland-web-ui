/**
 * FamilyDevice<Req, Msg>: the generic device engine for every non-legacy family (docs/FAMILIES.md
 * §3.3). A generalized copy of HollylandDevice's internals (device.ts is not refactored):
 *
 *  - user and background queues, one request in flight, coalescing of queued setters
 *  - correlation through the driver's `matches()` (batch requests complete on the last item)
 *  - retries for catalogued retry-safe READS only; toggles, writes and destructive commands are
 *    never resent
 *  - heartbeat with nested pause, missed-heartbeat counting
 *  - reply-delivery probe: `rx: 'unavailable'` when the OS drops replies; then reads are refused and
 *    writes need `blindWrites` (toggles never go out blind)
 *  - safety (FAMILIES.md §2.3), enforced here for every request whatever the driver does, and for
 *    every catalogued item of a multi-item request (ProtocolSpec.commandsOf):
 *      · every command must be in the driver's catalogue (sendRaw with force excepted, and only on a
 *        product that is not 'untested')
 *      · the probe, the heartbeat and every background request must be catalogued 'read'
 *      · 'ota' is always refused (firmware upload is not implemented, by design)
 *      · 'destructive' is refused when `support.hardware === 'untested'`, regardless of options;
 *        otherwise it needs `allowDestructive` plus a per-call `confirm`
 *      · 'disruptive' needs a per-call `confirm`
 *      · 'notify' ids are device → host only
 *      · sendRaw stays read-only unless forced, and forced frames still pass the rules above
 *  - traffic log with the driver's `describe()`
 */
import { toHex } from '../codec'
import { DestructiveCommandError, DisconnectedError, RxUnavailableError, TimeoutError, UnsupportedError, type SetResult } from '../device'
import { Emitter } from '../emitter'
import { displayName, supportOf, unitsOf, type ProductInfo } from '../models'
import type { Transport } from '../transport'
import { hex16 } from './bytes'
import { controlById, requireAvailable, validateControlValue, visibleControls } from './controls'
import { CommandSafetyError, RequestTimeoutError } from './errors'
import type { FamilyCode, UnitId } from './ids'
import type {
  CommandCatalogue, CommandSpec, ControlAvailability, ControlId, ControlSpec, ControlValue, EngineContext, EngineRequestOptions,
  MessageAssembler, MicDevice, MicDeviceOptions, MicEvents, MicSetOptions, MicState, MicTrafficEntry, MicUnit, ProtocolSpec,
  ResolvedMicDeviceOptions, RxAvailability, SupportInfo,
} from './types'

export interface FamilyDeviceConfig<Req, Msg> {
  family: FamilyCode
  commands: CommandCatalogue
  spec: ProtocolSpec<Req, Msg>
}

type Priority = 'user' | 'background'

interface Waiter<Msg> {
  resolve: (m: Msg | null) => void
  reject: (e: Error) => void
}

interface Job<Req, Msg> {
  /** Absent for a raw frame that did not parse (sendRaw with force). */
  req?: Req
  frame: Uint8Array
  cmd: number | null
  name: string
  key: string
  expectReply: boolean
  timeoutMs: number
  retries: number
  priority: Priority
  coalesce: boolean
  waiters: Waiter<Msg>[]
}

interface Awaiting<Req, Msg> {
  job: Job<Req, Msg>
  resolve: (m: Msg) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface InternalRequestOptions extends EngineRequestOptions {
  /** The connect / re-run probe (read-only rule, works while rx is not 'available'). */
  probe?: boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Hex dump without trailing zero padding (Moma 6303 frames are padded to 64 / 512). */
function hexTrim(bytes: Uint8Array, minBytes = 8): string {
  let end = bytes.length
  while (end > minBytes && bytes[end - 1] === 0) end--
  const s = toHex(bytes.subarray(0, end))
  return end < bytes.length ? `${s} …(${bytes.length - end}×00)` : s
}

/** Delay before the background read-back of a confirmed write (MoreSetting6118ViewModel.TOGGLE_CONFIRM_DELAY_MS). */
const DEFAULT_READBACK_DELAY_MS = 150
/** An identical message within this window after a reply is a duplicate (the A2 sends 2 IN reports per request). */
const DUPLICATE_WINDOW_MS = 1000

export class FamilyDevice<Req, Msg> implements MicDevice {
  readonly transport: Transport
  readonly product: ProductInfo
  readonly family: FamilyCode
  readonly support: SupportInfo
  readonly controls: readonly ControlSpec[]
  readonly commands: CommandCatalogue
  protected readonly spec: ProtocolSpec<Req, Msg>
  protected readonly opts: ResolvedMicDeviceOptions
  private readonly events = new Emitter<MicEvents>()
  private readonly assembler: MessageAssembler<Msg>
  private readonly allControls: readonly ControlSpec[]
  private readonly userQueue: Job<Req, Msg>[] = []
  private readonly bgQueue: Job<Req, Msg>[] = []
  private pumping = false
  private inflight: Job<Req, Msg> | null = null
  private awaiting: Awaiting<Req, Msg> | null = null
  private lastReply: { hex: string; time: number } | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatPauseCount = 0
  private heartbeatQueued = false
  private seq = 0
  private unsubs: (() => void)[] = []
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly delays = new Set<(e: Error) => void>()
  private connectedTask: Promise<void> | null = null
  private currentPacket: Uint8Array | null = null
  private _state: MicState
  private readonly ctx: EngineContext<Req, Msg>

  constructor(transport: Transport, product: ProductInfo, config: FamilyDeviceConfig<Req, Msg>, options: MicDeviceOptions = {}) {
    this.transport = transport
    this.product = options.product ?? product
    this.family = config.family
    this.commands = config.commands
    this.spec = config.spec
    this.support = supportOf(this.product)
    const t = config.spec.timing
    this.opts = {
      requestTimeoutMs: options.requestTimeoutMs ?? t.replyTimeoutMs,
      probeTimeoutMs: options.probeTimeoutMs ?? t.probeTimeoutMs,
      retries: options.retries ?? 2,
      interFrameDelayMs: options.interFrameDelayMs ?? t.interFrameDelayMs,
      heartbeatIntervalMs:
        options.heartbeatIntervalMs === undefined ? (config.spec.heartbeat?.intervalMs ?? null) : options.heartbeatIntervalMs,
      heartbeatMissLimit: options.heartbeatMissLimit ?? 3,
      blindWrites: options.blindWrites ?? false,
      allowDestructive: options.allowDestructive ?? false,
      enforcePreconditions: options.enforcePreconditions ?? true,
      ignoreFirmwareGates: options.ignoreFirmwareGates ?? false,
      fetchIdentity: options.fetchIdentity ?? true,
      fetchSettings: options.fetchSettings ?? true,
      now: options.now ?? (() => Date.now()),
    }
    this.allControls = config.spec.controls(this.product)
    this.controls = visibleControls(this.allControls, this.support)
    this.assembler = config.spec.createAssembler()
    this.assembler.onGarbage = (b) => this.logTraffic('rx', b, 'garbage', `← ${b.length} bytes that are not a frame`)
    const units: MicState['units'] = { rx: { id: 'rx', online: false } }
    for (const u of unitsOf(this.product)) if (u !== 'rx') units[u] = { id: u, online: false }
    this._state = {
      product: this.product, family: this.family, connected: false, rx: 'unknown', missedHeartbeats: 0, lastStatusAt: null,
      units, values: {}, availability: {},
    }
    this.ctx = this.createContext()
  }

  // ------------------------------------------------------------------------------ events

  on<K extends keyof MicEvents>(event: K, listener: (...args: MicEvents[K]) => void): () => void {
    return this.events.on(event, listener)
  }

  onTraffic(listener: (e: MicTrafficEntry) => void): () => void {
    return this.events.on('traffic', listener)
  }

  get state(): MicState {
    return this._state
  }

  get rx(): RxAvailability {
    return this._state.rx
  }

  /** Queued + in-flight requests. */
  get pendingRequests(): number {
    return this.userQueue.length + this.bgQueue.length + (this.inflight ? 1 : 0)
  }

  get heartbeatPaused(): boolean {
    return this.heartbeatPauseCount > 0
  }

  /** Resolves once the queues are empty and onConnected finished (tests, hardware checks). */
  async idle(timeoutMs = 5000): Promise<void> {
    const end = Date.now() + timeoutMs
    for (;;) {
      if (this.connectedTask) await this.connectedTask.catch(() => undefined)
      if (!this.pumping && !this.userQueue.length && !this.bgQueue.length && !this.connectedTask) return
      if (Date.now() > end) return
      await sleep(1)
    }
  }

  // ---------------------------------------------------------------------------- lifecycle

  async connect(): Promise<MicState> {
    if (!this.transport.isOpen) await this.transport.open()
    this.unsubs.push(
      this.transport.onPacket((p) => this.handlePacket(p)),
      this.transport.onDisconnect((reason) => this.handleDisconnect(reason)),
    )
    this.assembler.reset()
    this.patch({ connected: true, units: { ...this._state.units, rx: { ...this._state.units.rx, online: true } } })
    try {
      await this.requestInternal(this.spec.probe(), { timeoutMs: this.opts.probeTimeoutMs, retries: 1, probe: true })
      this.patch({ rx: 'available' })
    } catch (e) {
      if (!(e instanceof TimeoutError)) {
        // Safety refusal, transport failure…: leave nothing half-open.
        this.teardown(e as Error)
        this.patch({ connected: false })
        throw e
      }
      this.patch({ rx: 'unavailable' })
      this.events.emit('rx-unavailable')
    }
    if (this._state.rx === 'available') {
      this.startConnectedTask()
      this.startHeartbeat()
    }
    return this._state
  }

  async disconnect(): Promise<void> {
    this.teardown(new DisconnectedError('closed by host'))
    await this.transport.close()
    this.patch({ connected: false })
  }

  async probe(timeoutMs = this.opts.probeTimeoutMs): Promise<RxAvailability> {
    try {
      await this.requestInternal(this.spec.probe(), { timeoutMs, retries: 0, probe: true })
      const wasRunning = this._state.rx === 'available' && !!this.heartbeatTimer
      this.patch({ rx: 'available' })
      if (!wasRunning) this.startConnectedTask()
      if (!this.heartbeatTimer) this.startHeartbeat()
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e
      if (this._state.rx !== 'available') this.patch({ rx: 'unavailable' })
    }
    return this._state.rx
  }

  async refresh(what: 'status' | 'identity' | 'settings'): Promise<void> {
    if (this._state.rx === 'unavailable') throw new RxUnavailableError()
    if (this.spec.refresh) return this.spec.refresh(this.ctx, what)
    if (what === 'status') await this.requestInternal(this.spec.heartbeat?.request() ?? this.spec.probe(), {})
  }

  pauseHeartbeat(): void {
    this.heartbeatPauseCount++
  }

  resumeHeartbeat(): void {
    if (this.heartbeatPauseCount > 0) this.heartbeatPauseCount--
  }

  // --------------------------------------------------------------------------------- writes

  async set(id: ControlId, value: ControlValue, o: MicSetOptions = {}): Promise<SetResult> {
    const control = controlById(this.controls, id)
    if (!control) {
      const hidden = controlById(this.allControls, id)
      if (hidden) throw new DestructiveCommandError(`${hidden.label} is ${hidden.safety} and hidden for ${displayName(this.product)} (${this.untestedNote()})`)
      throw new UnsupportedError(`${id} is not a control of ${displayName(this.product)}`)
    }
    const v = validateControlValue(control, value, o.unit)
    this.checkControlSafety(control, o.confirm === true)
    if (!this._state.connected) throw new DisconnectedError('not connected')
    const blind = this._state.rx === 'unavailable'
    if (blind && !this.opts.blindWrites) throw new RxUnavailableError()
    requireAvailable(this._state, id, o.unit, this.opts)
    const plan = this.spec.encodeSet(this.ctx, id, v, { unit: o.unit })
    // Nothing to send (e.g. a toggle already in the requested state).
    if (!plan.requests.length) return { ok: true, confirmed: !blind, code: null }
    // Check every request before sending any of them.
    for (const r of plan.requests) {
      const info = this.checkCommand(this.spec.commandOf(r), { priority: 'user', confirm: o.confirm })
      if (blind && info.toggle) throw new RxUnavailableError(`${info.name} is a toggle and cannot be sent blind`)
      if (info.safety === 'read') throw new CommandSafetyError(this.spec.commandOf(r), `${id}: ${info.name} is a read, not a write`)
    }
    let ack: { ok: boolean; code: number | null } = { ok: true, code: null }
    for (const r of plan.requests) {
      const m = await this.requestInternal(r, { expectReply: !blind, coalesce: plan.requests.length === 1, confirm: o.confirm })
      if (m) ack = this.spec.ack(r, m)
      if (!ack.ok) break
    }
    if (ack.ok) {
      if (plan.optimistic) this.ctx.setValues(plan.optimistic)
      if (!blind && plan.readBack) this.scheduleReadBack(plan.readBack.request, plan.readBack.delayMs ?? DEFAULT_READBACK_DELAY_MS)
    }
    return { ok: ack.ok, confirmed: !blind, code: ack.code }
  }

  async sendRaw(frame: Uint8Array, o: { force?: boolean; timeoutMs?: number } = {}): Promise<void> {
    if (!this._state.connected) throw new DisconnectedError('not connected')
    const req = this.spec.parseRequest?.(frame) ?? null
    if (req !== null) {
      const cmd = this.spec.commandOf(req)
      const info = this.commands[cmd]
      if (!o.force && info?.safety !== 'read') {
        throw new CommandSafetyError(cmd, `refusing to send ${info?.name ?? hex16(cmd)} without force (not a catalogued read)`)
      }
      if (info) {
        await this.requestInternal(req, { timeoutMs: o.timeoutMs, confirm: o.force === true, retries: 0 })
        return
      }
      // Parsed but uncatalogued (forced). On an untested product the bytes cannot be classified, as for
      // unparsable bytes below: refused (FAMILIES.md §2.3; the catalogues come from Android, iOS-only
      // commands such as MELO P1 0x131B are missing from them, melo-6201.md §5).
      if (this.support.hardware === 'untested') {
        throw new DestructiveCommandError(
          `${hex16(cmd)} is not in the ${this.family} command catalogue and ${displayName(this.product)} is not tested on hardware: refused`,
        )
      }
      // Tested product: sent as is (no reply correlation beyond matches()), but every catalogued item of
      // the frame still passes the rules, so an uncatalogued item cannot carry an OTA or destructive one.
      for (const id of this.commandIdsOf(req)) if (this.commands[id]) this.checkCommand(id, { priority: 'user', confirm: true })
      await this.enqueueRaw(frame, cmd)
      return
    }
    if (!o.force) throw new CommandSafetyError(-1, 'refusing to send bytes that do not parse as a request without force')
    if (this.support.hardware === 'untested') {
      throw new DestructiveCommandError(`these bytes cannot be classified and ${displayName(this.product)} is not tested on hardware: refused`)
    }
    await this.enqueueRaw(frame, null)
  }

  // -------------------------------------------------------------------------- internals

  /** Every command id of a request (ProtocolSpec.commandsOf; default the catalogue key alone). */
  private commandIdsOf(req: Req): readonly number[] {
    return this.spec.commandsOf?.(req) ?? [this.spec.commandOf(req)]
  }

  private untestedNote(): string {
    return this.support.hardware === 'untested' ? 'not tested on hardware' : 'firmware upload is not implemented'
  }

  private checkControlSafety(c: ControlSpec, confirm: boolean): void {
    if (c.safety === 'ota') throw new DestructiveCommandError(`${c.label}: firmware-update controls are never sent`)
    if (c.safety === 'destructive') {
      if (this.support.hardware === 'untested') {
        throw new DestructiveCommandError(`${c.label} is destructive and ${displayName(this.product)} is not tested on hardware: refused`)
      }
      if (!this.opts.allowDestructive || !confirm) {
        throw new DestructiveCommandError(`${c.label} is destructive: construct the device with allowDestructive and pass { confirm: true }`)
      }
    }
    if (c.safety === 'disruptive' && !confirm) {
      throw new DestructiveCommandError(`${c.label}: ${c.confirmText ?? 'this restarts the receiver'} Pass { confirm: true }.`)
    }
  }

  /** The safety rules of FAMILIES.md §2.3 for one command id. */
  private checkCommand(cmd: number, o: { priority?: Priority; confirm?: boolean; probe?: boolean }): CommandSpec {
    const info = this.commands[cmd]
    if (!info) throw new CommandSafetyError(cmd, `${hex16(cmd)} is not in the ${this.family} command catalogue`)
    if (info.safety === 'notify') throw new CommandSafetyError(cmd, `${info.name} is sent by the device only`)
    if (info.safety === 'ota') throw new DestructiveCommandError(`${info.name} belongs to firmware update, which Hollyland Web UI never sends`)
    if ((o.probe || o.priority === 'background') && info.safety !== 'read') {
      throw new CommandSafetyError(cmd, `${info.name} is not a read: the probe and background polls may only read (FAMILIES.md §2.3)`)
    }
    if (info.safety === 'destructive') {
      if (this.support.hardware === 'untested') {
        throw new DestructiveCommandError(`${info.name} is destructive and ${displayName(this.product)} is not tested on hardware: refused`)
      }
      if (!this.opts.allowDestructive || o.confirm !== true) {
        throw new DestructiveCommandError(`${info.name} is destructive: construct the device with allowDestructive and pass { confirm: true }`)
      }
    }
    if (info.safety === 'disruptive' && o.confirm !== true) {
      throw new DestructiveCommandError(`${info.name} restarts or re-enumerates the device: pass { confirm: true }`)
    }
    return info
  }

  private requestInternal(req: Req, o: InternalRequestOptions): Promise<Msg | null> {
    if (!this._state.connected) return Promise.reject(new DisconnectedError('not connected'))
    let job: Job<Req, Msg>
    try {
      const cmd = this.spec.commandOf(req)
      const priority = o.priority ?? 'user'
      const info = this.checkCommand(cmd, { priority, confirm: o.confirm, probe: o.probe })
      // A batch: every item must be catalogued and pass the same rules, whatever item commandOf ranked first.
      for (const id of this.commandIdsOf(req)) if (id !== cmd) this.checkCommand(id, { priority, confirm: o.confirm, probe: o.probe })
      let expectReply = o.expectReply ?? true
      if (!o.probe && this._state.rx === 'unavailable') {
        if (info.safety === 'read') throw new RxUnavailableError()
        if (!this.opts.blindWrites) throw new RxUnavailableError()
        if (info.toggle) throw new RxUnavailableError(`${info.name} is a toggle and cannot be sent blind`)
        expectReply = false
      }
      const retrySafeRead = info.retrySafe && info.safety === 'read' && !info.toggle
      job = {
        req, frame: this.spec.encode(req), cmd, name: info.name,
        key: this.spec.coalesceKey?.(req) ?? String(cmd),
        expectReply,
        timeoutMs: o.timeoutMs ?? this.opts.requestTimeoutMs,
        retries: retrySafeRead ? (o.retries ?? this.opts.retries) : 0,
        priority, coalesce: o.coalesce ?? false, waiters: [],
      }
    } catch (e) {
      return Promise.reject(e)
    }
    const p = new Promise<Msg | null>((resolve, reject) => job.waiters.push({ resolve, reject }))
    this.enqueue(job)
    return p
  }

  private enqueueRaw(frame: Uint8Array, cmd: number | null): Promise<void> {
    const job: Job<Req, Msg> = {
      frame: frame.slice(), cmd, name: cmd === null ? 'raw' : hex16(cmd), key: `raw:${this.seq}`, expectReply: false, timeoutMs: 0,
      retries: 0, priority: 'user', coalesce: false, waiters: [],
    }
    const p = new Promise<Msg | null>((resolve, reject) => job.waiters.push({ resolve, reject }))
    this.enqueue(job)
    return p.then(() => undefined)
  }

  private enqueue(job: Job<Req, Msg>): void {
    const q = job.priority === 'user' ? this.userQueue : this.bgQueue
    if (job.coalesce) {
      const i = q.findIndex((j) => j.coalesce && j.key === job.key)
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

  private async execute(job: Job<Req, Msg>): Promise<Msg | null> {
    const attempts = 1 + job.retries
    for (let a = 0; a < attempts; a++) {
      const reply = job.expectReply ? this.awaitReply(job) : null
      // The reply timer runs during send(): if it fires and send() then fails, the transport error is what
      // the caller gets and the timeout must not surface as an unhandled rejection. Awaiting `reply` below
      // still sees the rejection; this only marks it handled.
      reply?.catch(() => undefined)
      // Logged before sending: a synchronous transport (feature reports) delivers the reply inside send().
      this.logTraffic('tx', job.frame, job.req === undefined ? 'raw' : a > 0 ? `retry ${a}` : undefined,
        job.req === undefined ? `→ raw ${job.name}` : `→ ${this.spec.describe(job.req, 'tx')}`, job.req)
      try {
        await this.transport.send(job.frame)
      } catch (e) {
        this.cancelAwait(job)
        throw e
      }
      if (!reply) return null
      try {
        return await reply
      } catch (e) {
        if (!(e instanceof TimeoutError) || a === attempts - 1) throw e
      }
    }
    return null
  }

  private awaitReply(job: Job<Req, Msg>): Promise<Msg> {
    return new Promise<Msg>((resolve, reject) => {
      const timer = this.replyTimer(job, reject)
      this.awaiting = { job, resolve, reject, timer }
    })
  }

  private replyTimer(job: Job<Req, Msg>, reject: (e: Error) => void): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      if (this.awaiting?.job === job) this.awaiting = null
      this.logTraffic('rx', new Uint8Array(0), 'timeout', `timeout waiting for ${job.name} (${job.timeoutMs} ms)`)
      reject(new RequestTimeoutError(job.cmd ?? -1, job.timeoutMs, job.name))
    }, job.timeoutMs)
  }

  private cancelAwait(job: Job<Req, Msg>): void {
    if (this.awaiting?.job !== job) return
    clearTimeout(this.awaiting.timer)
    this.awaiting = null
  }

  private handlePacket(packet: Uint8Array): void {
    this.currentPacket = packet
    let msgs: Msg[]
    try {
      msgs = this.assembler.push(packet)
    } catch (e) {
      this.events.emit('error', e as Error)
      msgs = []
    }
    if (!msgs.length) this.logTraffic('rx', packet, 'partial', `← ${packet.length} bytes (incomplete frame)`)
    for (const m of msgs) this.handleMessage(m)
    this.currentPacket = null
  }

  private rawOf(msg: Msg): Uint8Array {
    return this.spec.rawOf?.(msg) ?? this.currentPacket ?? new Uint8Array(0)
  }

  private handleMessage(msg: Msg): void {
    if (this._state.rx !== 'available' && this._state.connected) this.patch({ rx: 'available' })
    const a = this.awaiting
    if (a && a.job.req !== undefined) {
      let m: 'done' | 'partial' | false = false
      try {
        m = this.spec.matches(a.job.req, msg)
      } catch (e) {
        this.events.emit('error', e as Error)
      }
      if (m === 'done') {
        clearTimeout(a.timer)
        this.awaiting = null
        const raw = this.rawOf(msg)
        this.lastReply = { hex: toHex(raw), time: this.opts.now() }
        this.logTraffic('rx', raw, 'reply', `← ${this.spec.describe(msg, 'rx')}`, msg)
        this.dispatch(msg, true)
        a.resolve(msg)
        return
      }
      if (m === 'partial') {
        // Batch reply: more items follow; restart the reply timer.
        clearTimeout(a.timer)
        a.timer = this.replyTimer(a.job, a.reject)
        this.logTraffic('rx', this.rawOf(msg), 'reply-part', `← ${this.spec.describe(msg, 'rx')}`, msg)
        this.dispatch(msg, true)
        return
      }
    }
    const raw = this.rawOf(msg)
    const hex = toHex(raw)
    if (this.lastReply && raw.length && this.lastReply.hex === hex && this.opts.now() - this.lastReply.time < DUPLICATE_WINDOW_MS) {
      this.logTraffic('rx', raw, 'duplicate', `← ${this.spec.describe(msg, 'rx')}`, msg)
      return
    }
    this.logTraffic('rx', raw, 'unsolicited', `← ${this.spec.describe(msg, 'rx')}`, msg)
    this.dispatch(msg, false)
    this.events.emit('push', msg)
  }

  private dispatch(msg: Msg, solicited: boolean): void {
    try {
      this.spec.onMessage(this.ctx, msg, solicited)
    } catch (e) {
      this.events.emit('error', e as Error)
    }
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
    for (const r of [...this.delays]) r(err)
    this.delays.clear()
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

  private startConnectedTask(): void {
    if (!this.spec.onConnected || this.connectedTask) return
    const task = this.spec
      .onConnected(this.ctx)
      .catch((e: unknown) => {
        if (!(e instanceof DisconnectedError) && !(e instanceof TimeoutError)) this.events.emit('error', e as Error)
      })
      .finally(() => {
        if (this.connectedTask === task) this.connectedTask = null
      })
    this.connectedTask = task
  }

  private scheduleReadBack(req: Req, delayMs: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      if (!this._state.connected || this._state.rx !== 'available') return
      this.requestInternal(req, { priority: 'background' }).catch(() => undefined)
    }, delayMs)
    this.timers.add(t)
  }

  // ---------------------------------------------------------------------------- heartbeat

  private startHeartbeat(): void {
    this.stopHeartbeat()
    const hb = this.spec.heartbeat
    const iv = this.opts.heartbeatIntervalMs
    if (!hb || iv === null || iv <= 0) return
    const tick = () => {
      this.heartbeatTimer = setTimeout(tick, iv)
      if (this.heartbeatPauseCount > 0 || this.heartbeatQueued || !this._state.connected || this._state.rx !== 'available') return
      this.heartbeatQueued = true
      this.requestInternal(hb.request(), { priority: 'background', retries: 0 })
        .then(() => {
          if (this._state.missedHeartbeats) this.patch({ missedHeartbeats: 0 })
        })
        .catch((e: unknown) => {
          if (e instanceof TimeoutError) {
            const n = this._state.missedHeartbeats + 1
            this.patch({ missedHeartbeats: n })
            if (n === this.opts.heartbeatMissLimit) this.events.emit('error', new Error(`${n} status polls without reply`))
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

  // -------------------------------------------------------------------------------- state

  private createContext(): EngineContext<Req, Msg> {
    const self = this
    return {
      get product() {
        return self.product
      },
      get state() {
        return self._state
      },
      get options() {
        return self.opts
      },
      request: (req, o = {}) => self.requestInternal(req, o),
      patchUnits: (p) => self.patchUnits(p),
      setValues: (v) => {
        self._state = { ...self._state, values: { ...self._state.values, ...v } }
        self.emitState()
      },
      setAvailability: (a) => {
        self._state = { ...self._state, availability: { ...self._state.availability, ...a } }
        self.emitState()
      },
      statusApplied: (raw) => {
        self._state = { ...self._state, raw, lastStatusAt: self.opts.now(), missedHeartbeats: 0 }
        self.emitState()
        self.events.emit('status', raw)
      },
      emitError: (e) => self.events.emit('error', e),
      note: (text) => self.logTraffic('rx', new Uint8Array(0), 'note', text),
      now: () => self.opts.now(),
      delay: (ms) =>
        new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            self.timers.delete(t)
            self.delays.delete(reject)
            resolve()
          }, ms)
          self.timers.add(t)
          self.delays.add(reject)
        }),
    }
  }

  private patchUnits(p: Partial<Record<UnitId, Partial<MicUnit>>>): void {
    const units = { ...this._state.units }
    const changes: [UnitId, boolean][] = []
    for (const [id, patch] of Object.entries(p) as [UnitId, Partial<MicUnit> | undefined][]) {
      if (!patch) continue
      const prev: MicUnit = units[id] ?? { id, online: false }
      const next: MicUnit = { ...prev, ...patch, id }
      if (id !== 'rx' && prev.online !== next.online) changes.push([id, next.online])
      if (id === 'rx') units.rx = next
      else units[id] = next
    }
    this._state = { ...this._state, units }
    this.emitState()
    for (const [id, online] of changes) {
      this.events.emit(online ? 'unit-online' : 'unit-offline', id)
      if (online && this.spec.onUnitOnline && this._state.rx === 'available') {
        try {
          this.spec.onUnitOnline(this.ctx, id)
        } catch (e) {
          this.events.emit('error', e as Error)
        }
      }
    }
  }

  private patch(p: Partial<MicState>): void {
    this._state = { ...this._state, ...p }
    this.emitState()
  }

  private emitState(): void {
    this.events.emit('state', this._state)
  }

  private logTraffic(direction: 'tx' | 'rx', bytes: Uint8Array, note: string | undefined, summary: string, message?: unknown): void {
    if (this.events.listenerCount('traffic') === 0) return
    this.events.emit('traffic', {
      seq: ++this.seq, time: this.opts.now(), direction, bytes, hex: bytes.length ? hexTrim(bytes) : '', frame: null, summary, note,
      message,
    })
  }
}

/** Availability helper for drivers: mark several controls at once. */
export function availabilityFor(ids: readonly ControlId[], a: ControlAvailability): Partial<Record<ControlId, ControlAvailability>> {
  const out: Partial<Record<ControlId, ControlAvailability>> = {}
  for (const id of ids) out[id] = a
  return out
}
