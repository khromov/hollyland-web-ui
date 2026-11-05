/**
 * LARK A1 (6108) ProtocolSpec for the generic engine (core/engine.ts), read-only part (Phase 1, W3):
 * framing, correlation, acks, the status poll, identity reads and the mapping of replies into MicState.
 * Controls, writes, firmware gates and the app's preconditions are added in Phase 2 (W5) through
 * `createA1Spec({ controls, encodeSet })`; until then every `set()` is refused.
 *
 * Session behaviour (a1-6108.md §4.1):
 *  - no handshake; the probe and the status poll are the heartbeat 0x1F (A HLDevice6302Activity$mRunnable$1.run,
 *    every 1000 ms; I -[HLDeviceController sendHeartInfo] @0x1002c4998 every 3.0 s)
 *  - identity on connect, Android order: 0x12 [00] serial, 0x0D [00] version, 0x30 RX MAC
 *    (A HLDevice6302Activity.onStart → getDeviceVersion())
 *  - a mic that comes online: 1 s later 0x0D [n], 0x12 [n], 0x31 [n - 1] (A HLDevice6302Activity.onResHeartInfoV2)
 *  - settings on connect: 0x46 performance flag (A HLDevice6302ViewModel.handleDeviceMac; I getDeviceInitialInfo
 *    @0x1002e0dd8 at 3.5 s). The apps' silent cloud-driven 0x45 write is NOT reproduced.
 *  - set acks: body[0] == 0 (status.ts parseA1Ack; Android's rule, iOS accepts anything but 0xFF)
 */
import { UnsupportedError } from '../../device'
import { FamilyDevice } from '../../core/engine'
import { TimeoutError } from '../../core/errors'
import type {
  ControlSpec, EngineContext, MicDeviceOptions, ProtocolSpec, UnitId,
} from '../../core/types'
import { CONTROL } from '../../core/controls'
import type { ProductInfo } from '../../models'
import type { Transport } from '../../transport'
import { A1Assembler, encodeA1Frame, parseA1Request, type A1Reply } from './codec'
import {
  A1Cmd, A1Requests, A1_COMMANDS, A1_TX_UNITS, a1CommandName, type A1Request, type A1TxUnitId,
} from './commands'
import {
  A1_CONTROL, a1HeartbeatUnits, a1HeartbeatValues, parseA1Ack, parseA1Byte, parseA1Heartbeat, parseA1OnLevel,
  parseA1PerformanceMode, parseA1RxMac, parseA1Serial, parseA1TxMac, parseA1Version, type A1Heartbeat,
} from './status'

/** Status poll interval of the Android app (A HLDevice6302Activity$mRunnable$1.run: postDelayed 1000). iOS polls every 3 s. */
export const A1_HEARTBEAT_INTERVAL_MS = 1000
/** Wait before reading a newly online mic's identity (A HLDevice6302Activity.onResHeartInfoV2 coroutines: delay 1000). */
export const A1_UNIT_IDENTITY_DELAY_MS = 1000

/**
 * Engine timeouts. The feature transport performs SET + GET inside send() with Android's own limits (3000 / 1000 ms),
 * so a reply normally exists before the engine's timer matters; the timer decides how long a GET that produced
 * nothing (refused, stale, empty) keeps a request pending. 1500 ms keeps the "write-only" probe short.
 */
export const A1_TIMING: ProtocolSpec<A1Request, A1Reply>['timing'] = { replyTimeoutMs: 1500, probeTimeoutMs: 1500, interFrameDelayMs: 0 }

export interface A1SpecOptions {
  /** Controls a product offers (Phase 2). Default: none, the session is read-only. */
  controls?: (product: ProductInfo) => readonly ControlSpec[]
  /** Control writes (Phase 2). Default: refuse every control. */
  encodeSet?: ProtocolSpec<A1Request, A1Reply>['encodeSet']
  /** Extra status mapping after the built-in one (Phase 2: availability from gates and preconditions). */
  afterMessage?: (ctx: EngineContext<A1Request, A1Reply>, msg: A1Reply, solicited: boolean) => void
  /** Default A1_HEARTBEAT_INTERVAL_MS. */
  heartbeatIntervalMs?: number
  /** Default A1_UNIT_IDENTITY_DELAY_MS. */
  unitIdentityDelayMs?: number
  timing?: Partial<ProtocolSpec<A1Request, A1Reply>['timing']>
}

const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ')

/** Requests whose reply echoes a unit / TX index in body[0] (A ProGetDeviceVersion, ProGetDeviceSn, ProGetDeviceMacTX). */
const UNIT_ECHO = new Set<number>([A1Cmd.GET_DEVICE_VERSION, A1Cmd.GET_DEVICE_SN, A1Cmd.GET_DEVICE_MAC_TX])
/** Setters addressed per mic: queued writes coalesce per TX index. */
const PER_TX = new Set<number>([A1Cmd.SET_TX_MUTE])

export function describeA1Heartbeat(hb: A1Heartbeat): string {
  const mics = hb.tx
    .map((t, i) => (t ? `TX${i + 1} ${t.online ? `${t.battery}%${t.muted ? ' muted' : ''}` : 'off'}` : null))
    .filter(Boolean)
    .join(', ')
  return `${hb.length} B (${hb.layout}): ${mics}; NC ${hb.noiseOn ? `on L${hb.noiseLevel}` : 'off'}, vol ${hb.volume}, ` +
    `${hb.channelMode === 1 ? 'stereo' : 'mono'}, EQ ${hb.eq}, reverb ${hb.reverbOn ? `on L${hb.reverbLevel}` : 'off'}` +
    (hb.signalMode !== undefined ? `, signal ${hb.signalMode}` : '')
}

function describeReply(msg: A1Reply): string {
  const name = a1CommandName(msg.cmd)
  const info = A1_COMMANDS[msg.cmd]
  switch (msg.cmd) {
    case A1Cmd.GET_HEART_INFO:
      return `${name} ${describeA1Heartbeat(parseA1Heartbeat(msg.payload))}`
    case A1Cmd.GET_DEVICE_VERSION: {
      const v = parseA1Version(msg.payload)
      return v ? `${name} ${v.unit} ${v.version}` : `${name} [${hex(msg.payload)}]`
    }
    case A1Cmd.GET_DEVICE_SN: {
      const s = parseA1Serial(msg.payload)
      return s ? `${name} ${s.unit} ${s.serial}` : `${name} [${hex(msg.payload)}]`
    }
    case A1Cmd.GET_DEVICE_MAC_RX:
      return `${name} ${parseA1RxMac(msg.payload) || '(none)'}`
    case A1Cmd.GET_DEVICE_MAC_TX: {
      const m = parseA1TxMac(msg.payload)
      return m ? `${name} ${m.unit} ${m.mac || '(none)'}` : `${name} [${hex(msg.payload)}]`
    }
  }
  if (info && info.safety !== 'read') {
    const a = parseA1Ack(msg.payload)
    // A failure code iOS would still show as success (parseA1Ack): flagged for the hardware check.
    return `${name} ${a.ok ? 'ok' : `failed (${a.code}${a.iosOk ? '; iOS reads it as success' : ''})`}`
  }
  return `${name} [${hex(msg.payload)}]`
}

async function backgroundRead(ctx: EngineContext<A1Request, A1Reply>, req: A1Request): Promise<void> {
  try {
    await ctx.request(req, { priority: 'background' })
  } catch (e) {
    // One missing reply must not skip the remaining reads; disconnects and safety refusals propagate.
    if (!(e instanceof TimeoutError)) throw e
  }
}

/** The A1 ProtocolSpec (read-only unless Phase 2 passes controls and encodeSet). */
export function createA1Spec(o: A1SpecOptions = {}): ProtocolSpec<A1Request, A1Reply> {
  const identityDelay = o.unitIdentityDelayMs ?? A1_UNIT_IDENTITY_DELAY_MS
  const heartbeat: A1Request = A1Requests.heartbeat()

  async function micIdentity(ctx: EngineContext<A1Request, A1Reply>, unit: A1TxUnitId): Promise<void> {
    await backgroundRead(ctx, A1Requests.version(unit))
    await backgroundRead(ctx, A1Requests.serial(unit))
    await backgroundRead(ctx, A1Requests.txMac(unit))
  }

  const spec: ProtocolSpec<A1Request, A1Reply> = {
    encode: (r) => encodeA1Frame(r.cmd, r.payload ?? []),
    parseRequest: (frame) => {
      const r = parseA1Request(frame)
      return r ? { cmd: r.cmd, payload: [...r.payload] } : null
    },
    createAssembler: () => new A1Assembler(),
    matches: (req, msg) => {
      if (msg.cmd !== req.cmd) return false
      if (UNIT_ECHO.has(req.cmd) && msg.payload[0] !== req.payload?.[0]) return false
      return 'done'
    },
    ack: (_req, msg) => parseA1Ack(msg.payload),
    commandOf: (r) => r.cmd,
    coalesceKey: (r) => (PER_TX.has(r.cmd) || UNIT_ECHO.has(r.cmd) ? `${r.cmd}:${r.payload?.[0] ?? ''}` : String(r.cmd)),
    describe: (x, dir) => {
      if (dir === 'rx') return describeReply(x as A1Reply)
      const r = x as A1Request
      return `${a1CommandName(r.cmd)}${r.payload?.length ? ` [${hex(r.payload)}]` : ''}`
    },
    rawOf: (msg) => msg.raw,
    probe: () => heartbeat,
    heartbeat: { request: () => heartbeat, intervalMs: o.heartbeatIntervalMs ?? A1_HEARTBEAT_INTERVAL_MS },
    async onConnected(ctx) {
      if (ctx.options.fetchIdentity) {
        await backgroundRead(ctx, A1Requests.serial('rx'))
        await backgroundRead(ctx, A1Requests.version('rx'))
        await backgroundRead(ctx, A1Requests.rxMac())
      }
      if (ctx.options.fetchSettings) await backgroundRead(ctx, A1Requests.getPerformanceMode())
    },
    onUnitOnline(ctx, unit: UnitId) {
      if (!ctx.options.fetchIdentity || !(A1_TX_UNITS as readonly UnitId[]).includes(unit)) return
      const tx = unit as A1TxUnitId
      void (async () => {
        if (identityDelay > 0) await ctx.delay(identityDelay)
        if (ctx.state.units[tx]?.online) await micIdentity(ctx, tx)
      })().catch(() => undefined)
    },
    onMessage(ctx, msg, solicited) {
      const p = msg.payload
      switch (msg.cmd) {
        case A1Cmd.GET_HEART_INFO: {
          const hb = parseA1Heartbeat(p)
          ctx.patchUnits(a1HeartbeatUnits(hb))
          ctx.setValues(a1HeartbeatValues(hb))
          ctx.statusApplied(hb)
          break
        }
        case A1Cmd.GET_DEVICE_VERSION: {
          const v = parseA1Version(p)
          if (v) ctx.patchUnits({ [v.unit]: { version: v.version } })
          break
        }
        case A1Cmd.GET_DEVICE_SN: {
          const s = parseA1Serial(p)
          if (s?.serial) ctx.patchUnits({ [s.unit]: { serial: s.serial } })
          break
        }
        case A1Cmd.GET_DEVICE_MAC_RX: {
          const mac = parseA1RxMac(p)
          if (mac) ctx.patchUnits({ rx: { mac } })
          break
        }
        case A1Cmd.GET_DEVICE_MAC_TX: {
          const m = parseA1TxMac(p)
          if (m?.mac) ctx.patchUnits({ [m.unit]: { mac: m.mac } })
          break
        }
        case A1Cmd.GET_PERFORMANCE_MODE: {
          const on = parseA1PerformanceMode(p)
          if (on !== null) ctx.setValues({ [A1_CONTROL.PERFORMANCE]: on })
          break
        }
        case A1Cmd.GET_SIGNAL_MODE: {
          const m = parseA1Byte(p)
          if (m !== null) ctx.setValues({ [A1_CONTROL.SIGNAL_MODE]: m })
          break
        }
        // iOS read-backs (I -[HL6108DeviceInfoSync queryCommandForSetCommand:] @0x100204d88) and the unused GETs.
        case A1Cmd.GET_VOICE_MODE: {
          const m = parseA1Byte(p)
          if (m !== null) ctx.setValues({ [CONTROL.CHANNEL_MODE]: m })
          break
        }
        case A1Cmd.GET_EQ: {
          const m = parseA1Byte(p)
          if (m !== null) ctx.setValues({ [A1_CONTROL.EQ]: m })
          break
        }
        case A1Cmd.GET_VOICE_LEVEL: {
          const m = parseA1Byte(p)
          if (m !== null) ctx.setValues({ [CONTROL.VOLUME]: m })
          break
        }
        case A1Cmd.GET_NOISE: {
          const r = parseA1OnLevel(p)
          if (r) ctx.setValues({ [CONTROL.NOISE_ENABLED]: r.on, [CONTROL.NOISE_LEVEL]: r.level + 1 })
          break
        }
        case A1Cmd.GET_REVERB: {
          const r = parseA1OnLevel(p)
          if (r) ctx.setValues({ [A1_CONTROL.REVERB_ENABLED]: r.on, [A1_CONTROL.REVERB_LEVEL]: r.level })
          break
        }
      }
      o.afterMessage?.(ctx, msg, solicited)
    },
    async refresh(ctx, what) {
      if (what === 'status') {
        await ctx.request(heartbeat)
      } else if (what === 'identity') {
        await ctx.request(A1Requests.version('rx'))
        await backgroundRead(ctx, A1Requests.serial('rx'))
        await backgroundRead(ctx, A1Requests.rxMac())
        for (const u of A1_TX_UNITS) if (ctx.state.units[u]?.online) await micIdentity(ctx, u)
      } else {
        await ctx.request(A1Requests.getPerformanceMode())
        await backgroundRead(ctx, A1Requests.getSignalMode())
      }
    },
    encodeSet:
      o.encodeSet ??
      ((_ctx, id) => {
        throw new UnsupportedError(`${id}: LARK A1 controls are not implemented yet (read-only wire layer)`)
      }),
    controls: (product) => o.controls?.(product) ?? [],
    timing: { ...A1_TIMING, ...o.timing },
  }
  return spec
}

/** A MicDevice for a LARK A1 row on any transport (WebHidFeatureTransport, or a simulator's MockTransport). */
export function createA1Device(
  transport: Transport,
  product: ProductInfo,
  options?: MicDeviceOptions,
  spec: ProtocolSpec<A1Request, A1Reply> = createA1Spec(),
): FamilyDevice<A1Request, A1Reply> {
  return new FamilyDevice(transport, product, { family: '6108', commands: A1_COMMANDS, spec }, options)
}
