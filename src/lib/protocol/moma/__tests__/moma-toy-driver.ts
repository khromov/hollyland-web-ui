/**
 * A toy FamilyDriver on the shared Moma codec, one per profile, run through the shared conformance suite
 * (core/conformance.ts) by moma.conformance.test.ts. It proves that createMomaSpecBase (framing, per-item
 * messages, batch correlation, acks, riskiest-item classification), MomaAssembler (report id, padding,
 * XOR, start/end markers, chunked and duplicated replies) and the sim helpers work end to end with
 * FamilyDevice. It is also a compact example for the W6–W8 family agents.
 *
 * Command ids, payloads and status layout are invented for the test (they borrow 6201 ids only for
 * readability); nothing here describes a real product.
 */
import { UnsupportedError } from '../../device'
import { ascii } from '../../core/bytes'
import { CONTROL, controlKey } from '../../core/controls'
import { FamilyDevice } from '../../core/engine'
import { ControlUnavailableError } from '../../core/errors'
import type { DriverFamilyCode } from '../../core/ids'
import { usbProduct } from '../../core/product-rows'
import type {
  CommandCatalogue, ControlSpec, DeviceSimulator, EngineContext, FamilyDriver, ProtocolSpec, SimFaults, SimOptions, SupportInfo, UnitId,
} from '../../core/types'
import type { ProductInfo } from '../../models'
import type { MomaItemInput } from '../codec'
import type { MomaProfile } from '../profiles'
import { applyMomaFaults, encodeMomaReply, momaAck, momaData, momaNotify, MomaRequestReader } from '../sim'
import { createMomaSpecBase, momaBatch, momaCommandOfFrame, momaRequest, type MomaMessage, type MomaRequest } from '../spec'

export const MT = {
  STATUS: 0x600b,
  VERSION: 0x600a,
  GET_NC: 0x1301,
  SET_NC: 0x1300,
  GET_LED: 0x2001,
  SET_LED: 0x2000,
  SET_MUTE: 0x1001,
  RESTART: 0x2005,
  FACTORY_RESET: 0x2007,
  OTA_START: 0x4000,
  VU: 0x11eb,
} as const

const src = 'toy (moma/__tests__/moma-toy-driver.ts)'
export const MOMA_TOY_COMMANDS: CommandCatalogue = {
  [MT.STATUS]: { name: 'STATUS', safety: 'read', retrySafe: true, source: src },
  [MT.VERSION]: { name: 'VERSION', safety: 'read', retrySafe: true, source: src },
  [MT.GET_NC]: { name: 'GET_NC', safety: 'read', retrySafe: true, source: src },
  [MT.GET_LED]: { name: 'GET_LED', safety: 'read', retrySafe: true, source: src },
  [MT.SET_NC]: { name: 'SET_NC', safety: 'write', retrySafe: true, source: src },
  [MT.SET_LED]: { name: 'SET_LED', safety: 'write', retrySafe: true, source: src },
  [MT.SET_MUTE]: { name: 'SET_MUTE', safety: 'write', retrySafe: true, source: src },
  [MT.RESTART]: { name: 'RESTART', safety: 'disruptive', retrySafe: false, source: src },
  [MT.FACTORY_RESET]: { name: 'FACTORY_RESET', safety: 'destructive', retrySafe: false, source: src },
  [MT.OTA_START]: { name: 'OTA_START', safety: 'ota', retrySafe: false, source: src },
  [MT.VU]: { name: 'VU', safety: 'notify', retrySafe: false, source: src },
}

const UNIT_BYTE: Partial<Record<UnitId, number>> = { rx: 0, tx1: 1, tx2: 2 }
const BYTE_UNIT: Record<number, UnitId> = { 0: 'rx', 1: 'tx1', 2: 'tx2' }

const base = { confidence: 'high', source: src } as const
export const MOMA_TOY_CONTROLS: readonly ControlSpec[] = [
  { ...base, id: CONTROL.NOISE_ENABLED, label: 'NC', group: 'audio', kind: 'switch', safety: 'write', readBack: 'status' },
  {
    ...base, id: CONTROL.NOISE_LEVEL, label: 'NC level', group: 'audio', kind: 'choice', safety: 'write', readBack: 'status',
    options: [{ value: 0, label: 'Weak' }, { value: 1, label: 'Medium' }, { value: 2, label: 'Strong' }],
  },
  // Read back with the "get all" batch (refresh('settings')), not the status poll.
  { ...base, id: CONTROL.LED, label: 'LED', group: 'settings', kind: 'switch', safety: 'write', readBack: 'get' },
  { ...base, id: CONTROL.MIC_MUTE, label: 'Mute', group: 'mics', kind: 'switch', safety: 'write', readBack: 'status', perUnit: ['tx1', 'tx2'] },
  { ...base, id: CONTROL.RESTART_RX, label: 'Restart', group: 'advanced', kind: 'action', safety: 'disruptive', readBack: 'none', confirmText: 'The receiver restarts.' },
  { ...base, id: CONTROL.FACTORY_RESET, label: 'Factory reset', group: 'advanced', kind: 'action', safety: 'destructive', readBack: 'none' },
  { ...base, id: 'moma.firmware', label: 'Update firmware', group: 'advanced', kind: 'action', safety: 'ota', readBack: 'none' },
]

const SETTINGS = () => momaBatch([MT.GET_NC, MT.GET_LED])

function ncAvailability(ctx: EngineContext<MomaRequest, MomaMessage>): void {
  const off = ctx.state.values[CONTROL.NOISE_ENABLED] === false
  ctx.setAvailability({ [CONTROL.NOISE_LEVEL]: off ? { ok: false, reason: 'noise-off', message: 'NC is off' } : { ok: true } })
}

function momaToySpec(profile: MomaProfile): ProtocolSpec<MomaRequest, MomaMessage> {
  const framing = createMomaSpecBase(profile, {
    commands: MOMA_TOY_COMMANDS,
    // VERSION replies echo the unit in payload[0].
    matchItem: (it, msg) => it.cmd !== MT.VERSION || msg.payload[0] === (it.payload?.[0] ?? 0),
    coalesceKey: (r) => r.items.map((it) => (it.cmd === MT.SET_MUTE ? `${it.cmd}:${it.payload?.[0]}` : String(it.cmd))).join(','),
  })
  const version = (u: UnitId) => momaRequest(MT.VERSION, [UNIT_BYTE[u] ?? 0])
  return {
    ...framing,
    probe: () => momaRequest(MT.STATUS),
    heartbeat: { request: () => momaRequest(MT.STATUS), intervalMs: 1000 },
    async onConnected(ctx) {
      if (ctx.options.fetchIdentity) await ctx.request(version('rx'), { priority: 'background' })
      if (ctx.options.fetchSettings) await ctx.request(SETTINGS(), { priority: 'background' })
    },
    onMessage(ctx: EngineContext<MomaRequest, MomaMessage>, msg) {
      const p = msg.payload
      switch (msg.cmd) {
        case MT.STATUS: {
          const tx = [0, 1].map((i) => ({ online: p[i * 2] === 1, battery: p[i * 2 + 1] ?? 0, muted: ((p[7] ?? 0) >> i & 1) === 1 }))
          ctx.patchUnits({ tx1: tx[0], tx2: tx[1] })
          ctx.setValues({
            [CONTROL.NOISE_ENABLED]: p[4] === 1, [CONTROL.NOISE_LEVEL]: p[5] ?? 0,
            [controlKey(CONTROL.MIC_MUTE, 'tx1')]: tx[0].muted, [controlKey(CONTROL.MIC_MUTE, 'tx2')]: tx[1].muted,
          })
          ctx.statusApplied({ tx, nc: [p[4], p[5]] })
          ncAvailability(ctx)
          return
        }
        case MT.VERSION:
          ctx.patchUnits({ [BYTE_UNIT[p[0]] ?? 'rx']: { version: ascii(p, 1, p.length - 1) } })
          return
        case MT.GET_NC:
          ctx.setValues({ [CONTROL.NOISE_ENABLED]: p[0] === 1, [CONTROL.NOISE_LEVEL]: p[1] ?? 0 })
          ncAvailability(ctx)
          return
        case MT.GET_LED:
          ctx.setValues({ [CONTROL.LED]: p[0] === 1 })
          return
        case MT.VU:
          ctx.setValues({ 'moma.vu': p[0] ?? 0 })
          return
      }
    },
    async refresh(ctx, what) {
      if (what === 'status') await ctx.request(momaRequest(MT.STATUS))
      else if (what === 'identity') {
        for (const u of ['rx', 'tx1', 'tx2'] as const) if (u === 'rx' || ctx.state.units[u]?.online) await ctx.request(version(u))
      } else await ctx.request(SETTINGS())
    },
    encodeSet(ctx, id, value, o) {
      const level = (ctx.state.values[CONTROL.NOISE_LEVEL] as number | undefined) ?? 1
      const on = ctx.state.values[CONTROL.NOISE_ENABLED]
      switch (id) {
        case CONTROL.NOISE_ENABLED:
          return { requests: [momaRequest(MT.SET_NC, [value ? 1 : 0, level])], optimistic: { [id]: value } }
        case CONTROL.NOISE_LEVEL:
          if (on === false) throw new ControlUnavailableError(id, 'noise-off', 'NC is off')
          return { requests: [momaRequest(MT.SET_NC, [1, value as number])], optimistic: { [id]: value } }
        case CONTROL.LED:
          return { requests: [momaRequest(MT.SET_LED, [value ? 1 : 0])], optimistic: { [id]: value }, readBack: { request: SETTINGS(), delayMs: 5 } }
        case CONTROL.MIC_MUTE:
          return {
            requests: [momaRequest(MT.SET_MUTE, [UNIT_BYTE[o.unit ?? 'tx1'] ?? 1, value ? 1 : 0])],
            optimistic: { [controlKey(id, o.unit)]: value },
          }
        case CONTROL.RESTART_RX:
          return { requests: [momaRequest(MT.RESTART)] }
        case CONTROL.FACTORY_RESET:
          return { requests: [momaRequest(MT.FACTORY_RESET, [0, 0])] }
        case 'moma.firmware':
          return { requests: [momaRequest(MT.OTA_START)] }
        default:
          throw new UnsupportedError(id)
      }
    },
    controls: () => MOMA_TOY_CONTROLS,
    timing: { replyTimeoutMs: 40, probeTimeoutMs: 50, interFrameDelayMs: 0 },
  }
}

/** Simulated receiver answering in the profile's framing. `params.splitBatch`: one reply frame per batch item. */
export class MomaToySimulator implements DeviceSimulator {
  readonly info: { vendorId: number; productId: number; productName: string }
  readonly capabilities = { receive: 'yes' as const, link: 'mock' as const }
  faults: SimFaults
  tx = [
    { online: true, battery: 80, muted: false },
    { online: true, battery: 55, muted: false },
  ]
  ncOn = true
  ncLevel = 1
  led = true
  rxVersion: string
  splitBatch: boolean
  /** Every request frame the simulator decoded. */
  readonly requests: MomaRequest[] = []
  private readonly reader: MomaRequestReader
  private inject: ((p: Uint8Array) => void) | null = null
  private readonly profile: MomaProfile

  constructor(profile: MomaProfile, product: ProductInfo, o: SimOptions = {}) {
    this.profile = profile
    this.reader = new MomaRequestReader(profile)
    this.info = { vendorId: product.vendorId, productId: product.productId, productName: `${product.name} (simulated)` }
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize }
    this.rxVersion = o.rxVersion ?? '1.0.0.1'
    this.splitBatch = o.params?.splitBatch === true
    if (o.online) {
      this.tx[0].online = o.online.includes('tx1')
      this.tx[1].online = o.online.includes('tx2')
    }
  }

  attach(inject: (p: Uint8Array) => void): () => void {
    this.inject = inject
    return () => {
      this.inject = null
    }
  }

  /** Device push (type 0 notify item). */
  pushVu(level: number): void {
    this.inject?.(encodeMomaReply(this.profile, [momaNotify(MT.VU, [level])], { source: this.profile.target }))
  }

  respond(packet: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = []
    for (const f of this.reader.push(packet)) {
      this.requests.push({ items: f.items, target: f.target })
      const items = f.items.flatMap((it) => this.handle(it.cmd, it.payload))
      if (!items.length) continue
      const groups = this.splitBatch ? items.map((i) => [i]) : [items]
      for (const g of groups) out.push(encodeMomaReply(this.profile, g, { source: this.profile.target || 1 }))
    }
    return applyMomaFaults(out, this.faults)
  }

  private handle(cmd: number, p: Uint8Array): MomaItemInput[] {
    switch (cmd) {
      case MT.STATUS:
        return [momaData(cmd, [
          this.tx[0].online ? 1 : 0, this.tx[0].battery, this.tx[1].online ? 1 : 0, this.tx[1].battery,
          this.ncOn ? 1 : 0, this.ncLevel, this.led ? 1 : 0, (this.tx[0].muted ? 1 : 0) | (this.tx[1].muted ? 2 : 0),
        ])]
      case MT.VERSION: {
        const unit = p[0] ?? 0
        if (unit > 2 || (unit > 0 && !this.tx[unit - 1].online)) return []
        const v = unit === 0 ? this.rxVersion : '0.9.0.1'
        return [momaData(cmd, [unit, ...Array.from(v, (c) => c.charCodeAt(0))])]
      }
      case MT.GET_NC:
        return [momaData(cmd, [this.ncOn ? 1 : 0, this.ncLevel])]
      case MT.GET_LED:
        return [momaData(cmd, [this.led ? 1 : 0])]
      case MT.SET_NC:
        this.ncOn = p[0] === 1
        this.ncLevel = p[1]
        return [momaAck(cmd)]
      case MT.SET_LED:
        this.led = p[0] === 1
        return [momaAck(cmd)]
      case MT.SET_MUTE: {
        const t = this.tx[(p[0] ?? 1) - 1]
        if (!t?.online) return [momaAck(cmd, 1)]
        t.muted = p[1] === 1
        return [momaAck(cmd)]
      }
      case MT.FACTORY_RESET:
        return [momaAck(cmd)]
      default:
        return []
    }
  }
}

const SUPPORT: SupportInfo = { level: 'experimental', hardware: 'untested', confidence: 'high', research: src }

export function momaToyProduct(code: DriverFamilyCode, productId: number, name: string): ProductInfo {
  return usbProduct(code, SUPPORT, {
    productId, name, code: `toy-${code}`, txCount: 2, channels: 2, heartbeatIntervalMs: 1000, maxUnits: ['rx', 'tx1', 'tx2'],
    links: [{ kind: 'webhid', reportId: 'byte0' }],
  })
}

export function momaToyDriver(code: DriverFamilyCode, profile: MomaProfile, productId: number): FamilyDriver {
  const product = momaToyProduct(code, productId, `Moma toy (${profile.name})`)
  const spec = momaToySpec(profile)
  return {
    code,
    name: `Moma toy ${profile.name}`,
    status: 'experimental',
    products: [product],
    commands: MOMA_TOY_COMMANDS,
    controls: MOMA_TOY_CONTROLS,
    research: src,
    createDevice: (transport, p, o) => new FamilyDevice(transport, p, { family: code, commands: MOMA_TOY_COMMANDS, spec }, o),
    createSimulator: (p, o) => new MomaToySimulator(profile, p, o),
    commandOfFrame: (f) => momaCommandOfFrame(profile, f, MOMA_TOY_COMMANDS),
    mockPresets: [],
    hardwareCheck: [],
  }
}
