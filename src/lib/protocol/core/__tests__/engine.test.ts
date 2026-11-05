/**
 * FamilyDevice (core/engine.ts) behaviour beyond the conformance suite: queue, retries,
 * correlation, safety rules (FAMILIES.md §2.3), sendRaw, heartbeat, traffic, sync transports.
 */
import { describe, expect, it } from 'vitest'
import { DestructiveCommandError, DisconnectedError, RxUnavailableError, TimeoutError, UnsupportedError } from '../../device'
import { MockTransport } from '../../mock'
import { BaseTransport, type TransportCapabilities, type TransportDeviceInfo } from '../../transport'
import { CONTROL, controlKey } from '../controls'
import { FamilyDevice } from '../engine'
import { CommandSafetyError, ControlUnavailableError, ControlValueError, RequestTimeoutError } from '../errors'
import { simulatedTransport } from '../simulate'
import type { EngineContext, MicDeviceOptions, MicTrafficEntry, ProtocolSpec } from '../types'
import {
  T, TOY_COMMANDS, TOY_PRODUCT, TOY_SPEC, TOY_TESTED_PRODUCT, ToySimulator, encodeToy, toyDriver, type ToyMsg, type ToyReq,
} from './toy-driver'

const FAST: MicDeviceOptions = {
  requestTimeoutMs: 30, probeTimeoutMs: 40, retries: 1, interFrameDelayMs: 0, heartbeatIntervalMs: null, fetchIdentity: false, fetchSettings: false,
}

function setup(o: { sim?: ConstructorParameters<typeof ToySimulator>[0]; opts?: MicDeviceOptions; product?: typeof TOY_PRODUCT; spec?: ProtocolSpec<ToyReq, ToyMsg> } = {}) {
  const sim = new ToySimulator(o.sim)
  const transport = simulatedTransport(sim)
  const device = new FamilyDevice(transport, o.product ?? TOY_PRODUCT, { family: '6108', commands: TOY_COMMANDS, spec: o.spec ?? TOY_SPEC }, {
    ...FAST, ...o.opts,
  })
  const cmds = () => transport.sent.map((f) => (f[1] << 8) | f[2])
  return { sim, transport, device, cmds }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('FamilyDevice: session', () => {
  it('probes with a read, applies the status and reports rx available', async () => {
    const { device, cmds } = setup()
    const s = await device.connect()
    expect(s.rx).toBe('available')
    expect(cmds()).toEqual([T.STATUS])
    expect(s.units.tx1).toMatchObject({ online: true, battery: 80, muted: false })
    expect(s.values).toMatchObject({ [CONTROL.VOLUME]: 3, [CONTROL.NOISE_ENABLED]: true, [controlKey(CONTROL.MIC_MUTE, 'tx2')]: false })
    expect(s.lastStatusAt).not.toBeNull()
    expect(s.family).toBe('6108')
    await device.disconnect()
    expect(device.state.connected).toBe(false)
  })

  it('runs onConnected in the background (identity, batch get-all) and fetches identity when a unit comes online', async () => {
    const { device, cmds, sim } = setup({ opts: { fetchIdentity: true, fetchSettings: true }, sim: { online: ['rx'] } })
    await device.connect()
    await device.idle()
    expect(device.state.units.rx.version).toBe('1.2.0')
    expect(device.state.values).toMatchObject({ 'toy.item0': 10, 'toy.item1': 20, 'toy.item2': 30 })
    const online: string[] = []
    device.on('unit-online', (u) => online.push(u))
    sim.tx[1].online = true
    await device.refresh('status')
    await device.idle()
    expect(online).toEqual(['tx2'])
    expect(device.state.units.tx2?.version).toBe('0.9.1')
    expect(cmds().filter((c) => c === T.VERSION)).toHaveLength(2)
    await device.disconnect()
  })

  it('marks rx unavailable when replies are dropped, refuses reads, and recovers with probe()', async () => {
    const { device, sim } = setup({ sim: { dropReplies: true } })
    const events: string[] = []
    device.on('rx-unavailable', () => events.push('rx-unavailable'))
    expect((await device.connect()).rx).toBe('unavailable')
    expect(events).toEqual(['rx-unavailable'])
    await expect(device.refresh('status')).rejects.toBeInstanceOf(RxUnavailableError)
    sim.faults.dropReplies = false
    expect(await device.probe()).toBe('available')
    await device.disconnect()
  })

  it('a batch request resolves on its last item and every item reaches onMessage', async () => {
    const { device } = setup()
    await device.connect()
    await device.refresh('settings')
    expect(device.state.values).toMatchObject({ 'toy.item0': 10, 'toy.item1': 20, 'toy.item2': 30 })
    await device.disconnect()
  })

  it('unsolicited pushes go to onMessage and the push event; duplicates are dropped', async () => {
    const { device, sim, transport } = setup()
    const pushes: unknown[] = []
    device.on('push', (m) => pushes.push(m))
    await device.connect()
    sim.push(42)
    expect(device.state.values['toy.level']).toBe(42)
    expect(pushes).toHaveLength(1)
    // An exact copy of the last reply within 1 s is a duplicate, not a push.
    transport.inject(encodeToy(0xa5, T.STATUS, 0, [1, 80, 1, 55, 1, 2, 3, 1, 0]))
    expect(pushes).toHaveLength(1)
    await device.disconnect()
  })

  it('reassembles replies split into 1-byte packets and reports leading garbage', async () => {
    const { device, sim, transport } = setup({ sim: { chunkSize: 1 } })
    const log: MicTrafficEntry[] = []
    device.onTraffic((e) => log.push(e))
    await device.connect()
    expect(device.state.values[CONTROL.VOLUME]).toBe(3)
    sim.faults.chunkSize = undefined
    transport.inject(Uint8Array.of(0x01, 0x02))
    expect(log.some((e) => e.note === 'garbage')).toBe(true)
    await device.disconnect()
  })

  it('logs traffic with the driver description and hex trimmed of padding', async () => {
    const { device } = setup()
    const log: MicTrafficEntry[] = []
    device.onTraffic((e) => log.push(e))
    await device.connect()
    expect(log[0]).toMatchObject({ direction: 'tx', summary: '→ STATUS rx', frame: null })
    expect(log[1]).toMatchObject({ direction: 'rx', note: 'reply', summary: '← STATUS rx' })
    expect((log[1].message as ToyMsg).cmd).toBe(T.STATUS)
    await device.disconnect()
  })
})

describe('FamilyDevice: queue and retries', () => {
  it('retries catalogued retry-safe reads, never writes', async () => {
    const { device, sim, cmds } = setup({ opts: { retries: 2 } })
    await device.connect()
    sim.faults.dropReplies = true
    await expect(device.refresh('status')).rejects.toBeInstanceOf(TimeoutError)
    expect(cmds().filter((c) => c === T.STATUS)).toHaveLength(1 + 3) // probe + 1 try + 2 retries
    const n = cmds().length
    const err = await device.set(CONTROL.VOLUME, 1).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RequestTimeoutError)
    expect((err as Error).message).toBe('no reply to SET_VOLUME within 30 ms')
    expect(cmds().length - n).toBe(1)
    await device.disconnect()
  })

  it('coalesces queued writes of the same command and unit', async () => {
    const { device, cmds } = setup()
    await device.connect()
    const a = device.set(CONTROL.VOLUME, 1)
    const b = device.set(CONTROL.VOLUME, 2)
    const c = device.set(CONTROL.VOLUME, 4)
    const rs = await Promise.all([a, b, c])
    expect(rs.every((r) => r.ok)).toBe(true)
    // the first is in flight already; the second is replaced by the third
    expect(cmds().filter((x) => x === T.SET_VOLUME)).toHaveLength(2)
    expect(device.state.values[CONTROL.VOLUME]).toBe(4)
    await device.disconnect()
  })

  it('disconnect rejects queued and in-flight requests', async () => {
    const { device, sim } = setup()
    await device.connect()
    sim.faults.dropReplies = true
    const p1 = device.refresh('status')
    const p2 = device.set(CONTROL.VOLUME, 1)
    await device.disconnect()
    await expect(p1).rejects.toBeInstanceOf(DisconnectedError)
    await expect(p2).rejects.toBeInstanceOf(DisconnectedError)
  })

  it('a transport unplug emits disconnect and rejects pending work', async () => {
    const { device, sim, transport } = setup()
    await device.connect()
    sim.faults.dropReplies = true
    const p = device.refresh('status')
    const gone = new Promise((r) => device.on('disconnect', r))
    transport.unplug(new Error('unplugged'))
    await gone
    await expect(p).rejects.toBeInstanceOf(DisconnectedError)
    expect(device.state.connected).toBe(false)
  })
})

describe('FamilyDevice: writes', () => {
  it('validates values and units against the ControlSpec', async () => {
    const { device } = setup()
    await device.connect()
    await expect(device.set(CONTROL.VOLUME, 9)).rejects.toBeInstanceOf(ControlValueError)
    await expect(device.set(CONTROL.NOISE_LEVEL, 7)).rejects.toBeInstanceOf(ControlValueError)
    await expect(device.set(CONTROL.MIC_MUTE, true)).rejects.toThrow(/needs a unit/)
    await expect(device.set(CONTROL.MIC_MUTE, true, { unit: 'tx3' })).rejects.toThrow(/not in tx1, tx2/)
    await expect(device.set('nope', true)).rejects.toBeInstanceOf(UnsupportedError)
    await device.disconnect()
  })

  it('applies optimistic values on ack, and schedules the read-back', async () => {
    const { device, sim, cmds } = setup({ opts: { ignoreFirmwareGates: true } })
    await device.connect()
    const r = await device.set(CONTROL.LED, false)
    expect(r).toEqual({ ok: true, confirmed: true, code: 0 })
    expect(device.state.values[CONTROL.LED]).toBe(false)
    expect(sim.ledOn).toBe(false)
    await sleep(20)
    expect(cmds().slice(-2)).toEqual([T.SET_LED, T.STATUS])
    await device.disconnect()
  })

  it('a NAK is ok: false and leaves the value', async () => {
    const { device, sim } = setup()
    await device.connect()
    sim.tx[0].online = false
    sim.tx[1].online = false // the toy firmware NAKs volume without a mic; the engine has not seen a status yet
    const r = await device.set(CONTROL.VOLUME, 1)
    expect(r).toEqual({ ok: false, confirmed: true, code: 1 })
    expect(device.state.values[CONTROL.VOLUME]).toBe(3)
    await device.disconnect()
  })

  it('a toggle already in the requested state sends nothing', async () => {
    const { device, cmds } = setup()
    await device.connect()
    const n = cmds().length
    expect(await device.set(CONTROL.NOISE_ENABLED, true)).toEqual({ ok: true, confirmed: true, code: null })
    expect(cmds().length).toBe(n)
    await device.disconnect()
  })

  it('firmware gates are enforced unless ignoreFirmwareGates; preconditions unless enforcePreconditions is false', async () => {
    const gated = setup({ sim: { rxVersion: '1.0.0' }, opts: { fetchIdentity: true } })
    await gated.device.connect()
    await gated.device.idle()
    expect(gated.device.state.availability[CONTROL.LED]).toMatchObject({ ok: false, reason: 'firmware-too-old' })
    await expect(gated.device.set(CONTROL.LED, false)).rejects.toBeInstanceOf(ControlUnavailableError)
    await gated.device.disconnect()

    const lax = setup({ sim: { online: ['rx'] }, opts: { enforcePreconditions: false } })
    await lax.device.connect()
    expect(lax.device.state.availability[CONTROL.VOLUME]).toMatchObject({ ok: false, reason: 'mic-disconnected' })
    expect((await lax.device.set(CONTROL.VOLUME, 1)).ok).toBe(false) // sent anyway, the toy NAKs
    await lax.device.disconnect()
  })

  it('blind writes: refused by default, unconfirmed with blindWrites, toggles never', async () => {
    const strict = setup({ sim: { dropReplies: true } })
    await strict.device.connect()
    await expect(strict.device.set(CONTROL.VOLUME, 1)).rejects.toBeInstanceOf(RxUnavailableError)
    await strict.device.disconnect()

    const blind = setup({ sim: { dropReplies: true }, opts: { blindWrites: true } })
    await blind.device.connect()
    expect(await blind.device.set(CONTROL.VOLUME, 1)).toEqual({ ok: true, confirmed: false, code: null })
    expect(blind.device.state.values[CONTROL.VOLUME]).toBe(1)
    // Force a known NC state, then try the toggle blind.
    const ctxDevice = blind.device as unknown as { ctx: EngineContext<ToyReq, ToyMsg> }
    ctxDevice.ctx.setValues({ [CONTROL.NOISE_ENABLED]: true })
    await expect(blind.device.set(CONTROL.NOISE_ENABLED, false)).rejects.toThrow(/toggle and cannot be sent blind/)
    expect(blind.cmds()).not.toContain(T.NC_TOGGLE)
    await blind.device.disconnect()
  })
})

describe('FamilyDevice: safety (FAMILIES.md §2.3)', () => {
  it('untested product: destructive and OTA controls are hidden and refused even with allowDestructive + confirm', async () => {
    const { device, cmds } = setup({ opts: { allowDestructive: true } })
    expect(device.support.hardware).toBe('untested')
    expect(device.controls.map((c) => c.id)).not.toContain(CONTROL.FACTORY_RESET)
    expect(device.controls.map((c) => c.id)).not.toContain('toy.firmware')
    await device.connect()
    await expect(device.set(CONTROL.FACTORY_RESET, true, { confirm: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.set('toy.firmware', true, { confirm: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    // Raw frames too, forced or not.
    await expect(device.sendRaw(encodeToy(0x5a, T.FACTORY_RESET, 0), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.sendRaw(encodeToy(0x5a, T.OTA_START, 0), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.sendRaw(Uint8Array.of(1, 2, 3), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    expect(cmds()).not.toContain(T.FACTORY_RESET)
    expect(cmds()).not.toContain(T.OTA_START)
    await device.disconnect()
  })

  it('tested product: destructive needs allowDestructive AND confirm; OTA is still refused', async () => {
    const off = setup({ product: TOY_TESTED_PRODUCT })
    await off.device.connect()
    expect(off.device.controls.map((c) => c.id)).toContain(CONTROL.FACTORY_RESET)
    await expect(off.device.set(CONTROL.FACTORY_RESET, true, { confirm: true })).rejects.toThrow(/allowDestructive/)
    await off.device.disconnect()

    const on = setup({ product: TOY_TESTED_PRODUCT, opts: { allowDestructive: true } })
    await on.device.connect()
    await expect(on.device.set(CONTROL.FACTORY_RESET, true)).rejects.toBeInstanceOf(DestructiveCommandError)
    expect(await on.device.set(CONTROL.FACTORY_RESET, true, { confirm: true })).toMatchObject({ ok: true, confirmed: true })
    await expect(on.device.set('toy.firmware', true, { confirm: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    expect(on.cmds()).not.toContain(T.OTA_START)
    await on.device.disconnect()
  })

  it('disruptive controls need a per-call confirm', async () => {
    const { device, cmds } = setup()
    await device.connect()
    await expect(device.set(CONTROL.RESTART_RX, true)).rejects.toThrow(/The receiver restarts/)
    expect(cmds()).not.toContain(T.RESTART)
    await expect(device.set(CONTROL.RESTART_RX, true, { confirm: true })).rejects.toBeInstanceOf(TimeoutError) // no reply: it restarts
    expect(cmds()).toContain(T.RESTART)
    await device.disconnect()
  })

  it('the probe, background requests and the heartbeat may only read; uncatalogued commands are refused', async () => {
    const writeProbe: ProtocolSpec<ToyReq, ToyMsg> = { ...TOY_SPEC, probe: () => ({ cmd: T.SET_LED, payload: [1] }) }
    const a = setup({ spec: writeProbe })
    await expect(a.device.connect()).rejects.toBeInstanceOf(CommandSafetyError)
    expect(a.transport.sent).toHaveLength(0)
    expect(a.device.state.connected).toBe(false)

    let bgError: unknown = null
    const sneaky: ProtocolSpec<ToyReq, ToyMsg> = {
      ...TOY_SPEC,
      async onConnected(ctx) {
        await ctx.request({ cmd: T.SET_LED, payload: [0] }, { priority: 'background' }).catch((e: unknown) => (bgError = e))
        await ctx.request({ cmd: T.UNCATALOGUED }).catch((e: unknown) => (bgError ??= e))
      },
    }
    const b = setup({ spec: sneaky })
    await b.device.connect()
    await b.device.idle()
    expect(bgError).toBeInstanceOf(CommandSafetyError)
    expect(b.cmds()).toEqual([T.STATUS])
    await b.device.disconnect()

    const notify: ProtocolSpec<ToyReq, ToyMsg> = { ...TOY_SPEC, probe: () => ({ cmd: T.PUSH_LEVEL }) }
    const c = setup({ spec: notify })
    await expect(c.device.connect()).rejects.toThrow(/sent by the device only/)
  })

  it('sendRaw: catalogued reads go through; writes need force; unparsed or uncatalogued bytes need force and a tested product', async () => {
    const { device, cmds } = setup()
    await device.connect()
    await device.sendRaw(encodeToy(0x5a, T.STATUS, 0))
    await expect(device.sendRaw(encodeToy(0x5a, T.SET_VOLUME, 0, [1]))).rejects.toThrow(/without force/)
    await device.sendRaw(encodeToy(0x5a, T.SET_VOLUME, 0, [1]), { force: true })
    // Untested product: a parsed but uncatalogued command is refused like unparsable bytes (FAMILIES.md §2.3).
    await expect(device.sendRaw(encodeToy(0x5a, T.UNCATALOGUED, 0), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    await expect(device.sendRaw(Uint8Array.of(1, 2, 3))).rejects.toBeInstanceOf(CommandSafetyError)
    await expect(device.sendRaw(Uint8Array.of(1, 2, 3), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
    expect(cmds()).toEqual([T.STATUS, T.STATUS, T.SET_VOLUME])
    await device.disconnect()

    const tested = setup({ product: TOY_TESTED_PRODUCT })
    await tested.device.connect()
    await tested.device.sendRaw(encodeToy(0x5a, T.UNCATALOGUED, 0), { force: true })
    expect(tested.cmds().at(-1)).toBe(T.UNCATALOGUED)
    await tested.device.sendRaw(Uint8Array.of(1, 2, 3), { force: true })
    expect(tested.transport.sent.at(-1)).toEqual(Uint8Array.of(1, 2, 3))
    await tested.device.disconnect()
  })

  it('a multi-item request is checked item by item (commandsOf), whatever item commandOf ranks first', async () => {
    // A toy spec whose request carries extra ids: commandOf names the first, commandsOf all of them.
    type BatchReq = ToyReq & { extra?: number[] }
    let driverError: unknown = null
    const batchSpec: ProtocolSpec<ToyReq, ToyMsg> = {
      ...TOY_SPEC,
      // a request built by a driver goes through the same per-item rules
      async onConnected(ctx) {
        await ctx.request({ cmd: T.STATUS, extra: [T.UNCATALOGUED] } as BatchReq).catch((e: unknown) => (driverError = e))
      },
      commandsOf: (r) => [r.cmd, ...((r as BatchReq).extra ?? [])],
      parseRequest: (f) => {
        const r = TOY_SPEC.parseRequest!(f)
        // payload [0xEE, hi, lo] marks a hidden second item in this test framing
        if (r && r.payload?.[0] === 0xee) return { ...r, extra: [(r.payload[1] << 8) | r.payload[2]] } as BatchReq
        return r
      },
    }
    const hidden = (cmd: number, extra: number) => encodeToy(0x5a, cmd, 0, [0xee, extra >> 8, extra & 0xff])

    for (const product of [TOY_PRODUCT, TOY_TESTED_PRODUCT]) {
      const h = setup({ product, spec: batchSpec, opts: { allowDestructive: true } })
      await h.device.connect()
      const before = h.transport.sent.length
      // catalogued read first, OTA hidden behind it: refused on every product
      await expect(h.device.sendRaw(hidden(T.STATUS, T.OTA_START), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
      // uncatalogued first, OTA hidden behind it: refused on every product (untested: uncatalogued; tested: the OTA item)
      await expect(h.device.sendRaw(hidden(T.UNCATALOGUED, T.OTA_START), { force: true })).rejects.toBeInstanceOf(DestructiveCommandError)
      // uncatalogued first, destructive hidden: refused when untested, allowed (forced = confirmed) when tested + allowDestructive
      const d = h.device.sendRaw(hidden(T.UNCATALOGUED, T.FACTORY_RESET), { force: true })
      if (product === TOY_PRODUCT) await expect(d).rejects.toBeInstanceOf(DestructiveCommandError)
      else await d
      expect(h.transport.sent.length).toBe(before + (product === TOY_PRODUCT ? 0 : 1))
      await h.device.idle()
      expect(driverError).toBeInstanceOf(CommandSafetyError)
      driverError = null
      await h.device.disconnect()
    }
  })

  it('a reply timeout during a failing send() is not an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      const sim = new ToySimulator()
      const transport = simulatedTransport(sim)
      const device = new FamilyDevice(transport, TOY_PRODUCT, { family: '6108', commands: TOY_COMMANDS, spec: TOY_SPEC }, { ...FAST, requestTimeoutMs: 10 })
      await device.connect()
      const send = transport.send.bind(transport)
      transport.send = async () => {
        await sleep(40)
        throw new Error('write failed')
      }
      await expect(device.refresh('status')).rejects.toThrow('write failed')
      transport.send = send
      await sleep(20)
      expect(unhandled).toEqual([])
      await device.disconnect()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('FamilyDevice: heartbeat', () => {
  it('polls at the interval, pauses nest, and counts misses', async () => {
    const { device, sim, cmds } = setup({ opts: { heartbeatIntervalMs: 10, heartbeatMissLimit: 2 } })
    const errors: Error[] = []
    device.on('error', (e) => errors.push(e))
    await device.connect()
    await sleep(45)
    const polls = cmds().filter((c) => c === T.STATUS).length
    expect(polls).toBeGreaterThanOrEqual(3)
    device.pauseHeartbeat()
    device.pauseHeartbeat()
    device.resumeHeartbeat()
    const n = cmds().length
    await sleep(35)
    expect(cmds().length).toBe(n)
    device.resumeHeartbeat()
    sim.faults.dropReplies = true
    await sleep(120)
    expect(device.state.missedHeartbeats).toBeGreaterThanOrEqual(2)
    expect(errors.map((e) => e.message)).toContain('2 status polls without reply')
    await device.disconnect()
  })
})

/** A synchronous transport (feature reports): the reply arrives inside send(). */
class SyncTransport extends BaseTransport {
  readonly kind = 'sync'
  readonly capabilities: TransportCapabilities = { receive: 'yes', link: 'feature', maxWrite: 64 }
  readonly info: TransportDeviceInfo = { vendorId: 0x3547, productId: 0xf001 }
  private open_ = false
  private readonly sim: ToySimulator
  constructor(sim: ToySimulator) {
    super()
    this.sim = sim
  }
  get isOpen() {
    return this.open_
  }
  async open() {
    this.open_ = true
  }
  async close() {
    this.open_ = false
  }
  async send(p: Uint8Array) {
    for (const r of this.sim.respond(p)) this.emitPacket(r)
  }
}

describe('FamilyDevice: transports', () => {
  it('works with a synchronous transport that replies inside send()', async () => {
    const sim = new ToySimulator()
    const device = toyDriver.createDevice(new SyncTransport(sim), TOY_PRODUCT, FAST)
    const s = await device.connect()
    expect(s.rx).toBe('available')
    expect((await device.set(CONTROL.VOLUME, 2)).ok).toBe(true)
    await device.disconnect()
  })

  it('MockTransport with explicit options still works (no simulator glue)', async () => {
    const sim = new ToySimulator()
    const t = new MockTransport({ info: sim.info, respond: (p) => sim.respond(p), latencyMs: 2 })
    const device = toyDriver.createDevice(t, TOY_PRODUCT, FAST)
    expect((await device.connect()).rx).toBe('available')
    await device.disconnect()
  })
})
