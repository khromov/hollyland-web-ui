/**
 * Shared conformance suite (docs/FAMILIES.md §5.3). Every family test file calls
 *
 *   describeDriverConformance(driver, { gates: [...], preconditions: [...] })
 *
 * Stub drivers get the registry contract only. Drivers with a simulator are run against it:
 *  1. connect() sends only catalogued reads until `rx` is decided; nothing uncatalogued,
 *     destructive or OTA is ever sent
 *  2. a status reply updates units and values; offline units are offline in state
 *  3. every write control round-trips (set → ack → value visible after the read-back)
 *  4. version gates (cases from the family)
 *  5. preconditions refuse what the app refuses (cases from the family)
 *  6. dropped replies → rx 'unavailable'; writes refused without blindWrites; blind writes never
 *     send a toggle
 *  7. duplicate replies are ignored; chunked replies (every listed split size) decode the same
 *  8. no destructive / OTA command for an untested product, even with allowDestructive + confirm
 *  9. unparseable raw bytes are refused; timeouts reject cleanly; disconnect rejects pending requests
 *
 * Test-only module: imports vitest. Not exported from index.ts.
 */
import { describe, expect, it } from 'vitest'
import { DestructiveCommandError, DisconnectedError, PreconditionError, RxUnavailableError, TimeoutError } from '../device'
import { displayName, isConnectableProduct, supportOf, type ProductInfo } from '../models'
import { MockTransport } from '../mock'
import { alternativeValue, controlKey } from './controls'
import { ControlUnavailableError } from './errors'
import { simulatedTransport } from './simulate'
import type { ControlId, ControlSpec, ControlValue, DeviceSimulator, FamilyDriver, MicDeviceOptions, SimOptions, UnitId } from './types'

export interface GateCase {
  name: string
  product?: ProductInfo
  sim: SimOptions
  control: ControlId
  unit?: UnitId
  expect: 'ok' | 'unavailable'
}

export interface PreconditionCase {
  name: string
  product?: ProductInfo
  sim?: SimOptions
  /** Change the simulator before connecting. */
  arrange?: (sim: DeviceSimulator) => void
  control: ControlId
  value: ControlValue
  unit?: UnitId
  /** Expected ControlUnavailableError / PreconditionError reason. */
  reason?: string
}

export interface ConformanceOptions {
  /** Rows to run against (default: connectable rows the driver can simulate). */
  products?: readonly ProductInfo[]
  /** Value to write per control key (default: alternativeValue()). */
  writeValues?: Readonly<Record<string, ControlValue>>
  /** Controls left out of the write round-trip, with the reason. */
  skipWrites?: Readonly<Record<ControlId, string>>
  /** Split sizes for the chunked-reply check (default [1, 7, 20]; [] skips it, e.g. legacy HID never splits). */
  chunkSizes?: readonly number[]
  gates?: readonly GateCase[]
  preconditions?: readonly PreconditionCase[]
  /** Merged over the fast test defaults. */
  deviceOptions?: MicDeviceOptions
  /** Wait for background work (identity, settings) after connect (default 120 ms). */
  settleMs?: number
}

const FAST: MicDeviceOptions = {
  requestTimeoutMs: 40, probeTimeoutMs: 60, retries: 0, interFrameDelayMs: 0, heartbeatIntervalMs: null,
  fetchIdentity: false, fetchSettings: false,
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function canSimulate(driver: FamilyDriver, p: ProductInfo): boolean {
  try {
    driver.createSimulator(p)
    return true
  } catch {
    return false
  }
}

function actionValue(c: ControlSpec, current?: ControlValue): ControlValue {
  return c.kind === 'action' ? true : (alternativeValue(c, current) ?? (c.kind === 'switch' ? true : (c.range?.min ?? c.options?.[0]?.value ?? 0)))
}

/** The registry contract every driver (stub or not) must meet. */
function describeContract(driver: FamilyDriver): void {
  describe(`${driver.name} (${driver.code}) registry contract`, () => {
    it('products carry the family code, support data, links and units', () => {
      expect(driver.products.length).toBeGreaterThan(0)
      for (const p of driver.products) {
        expect(p.familyCode, displayName(p)).toBe(driver.code)
        expect(p.support, displayName(p)).toBeDefined()
        expect(supportOf(p).research.length).toBeGreaterThan(0)
        expect(Array.isArray(p.links), displayName(p)).toBe(true)
        expect(p.maxUnits?.[0] ?? 'rx').toBe('rx')
        if (driver.status === 'stub') expect(isConnectableProduct(p), `${displayName(p)} must not be connectable while the driver is a stub`).toBe(false)
      }
    })

    it('every command and control cites its source', () => {
      for (const [id, c] of Object.entries(driver.commands)) {
        expect(c.name, `command ${id}`).toBeTruthy()
        expect(c.source, `command ${c.name}`).toBeTruthy()
      }
      const ids = new Set<string>()
      for (const c of driver.controls) {
        expect(ids.has(c.id), `duplicate control ${c.id}`).toBe(false)
        ids.add(c.id)
        expect(c.label, c.id).toBeTruthy()
        expect(c.source, c.id).toBeTruthy()
        if (c.kind === 'choice') expect(c.options?.length, `${c.id} options`).toBeGreaterThan(0)
        if (c.kind === 'steps') expect(c.range, `${c.id} range`).toBeDefined()
        if (c.safety === 'disruptive') expect(c.confirmText, `${c.id} confirmText`).toBeTruthy()
      }
    })

    it('mock presets name rows of this driver', () => {
      const ids = new Set<string>()
      for (const m of driver.mockPresets) {
        expect(ids.has(m.id), `duplicate preset ${m.id}`).toBe(false)
        ids.add(m.id)
        expect(m.family).toBe(driver.code)
        expect(driver.products.some((p) => p.productId === m.productId), m.id).toBe(true)
      }
    })

    if (driver.status === 'stub') {
      it('a stub cannot create devices or simulators', () => {
        for (const p of driver.products) {
          expect(() => driver.createDevice(new MockTransport(), p)).toThrow(/not supported yet/)
          expect(() => driver.createSimulator(p)).toThrow(/not supported yet/)
        }
        expect(driver.mockPresets).toHaveLength(0)
      })
    }
  })
}

export function describeDriverConformance(driver: FamilyDriver, o: ConformanceOptions = {}): void {
  describeContract(driver)
  if (driver.status === 'stub') return
  const products = o.products ?? driver.products.filter((p) => isConnectableProduct(p) && canSimulate(driver, p))
  const settleMs = o.settleMs ?? 120
  const chunkSizes = o.chunkSizes ?? [1, 7, 20]

  const harness = (product: ProductInfo, sim: SimOptions = {}, opts: MicDeviceOptions = {}) => {
    const simulator = driver.createSimulator(product, sim)
    const transport = simulatedTransport(simulator)
    const device = driver.createDevice(transport, product, { ...FAST, ...o.deviceOptions, ...opts })
    const cmdOf = (f: Uint8Array) => driver.commandOfFrame(f)
    return { simulator, transport, device, cmdOf }
  }

  const writeControls = (cs: readonly ControlSpec[]) =>
    cs.filter((c) => c.safety === 'write' && c.kind !== 'action' && c.readBack !== 'none' && !o.skipWrites?.[c.id])

  for (const product of products) {
    describe(`${driver.name} conformance: ${displayName(product)} (PID ${product.productId})`, () => {
      it('1. connect() sends only catalogued reads until rx is decided; never anything dangerous', async () => {
        const h = harness(product, {}, { fetchIdentity: true, fetchSettings: true })
        let decidedAt = -1
        h.device.on('state', (s) => {
          if (decidedAt < 0 && s.rx !== 'unknown') decidedAt = h.transport.sent.length
        })
        const s = await h.device.connect()
        await sleep(settleMs)
        expect(s.rx).toBe('available')
        expect(decidedAt).toBeGreaterThan(0)
        h.transport.sent.slice(0, decidedAt).forEach((f) => {
          const cmd = h.cmdOf(f)
          expect(cmd, 'probe frame parses').not.toBeNull()
          expect(driver.commands[cmd!]?.safety, `probe ${cmd}`).toBe('read')
        })
        for (const f of h.transport.sent) {
          const cmd = h.cmdOf(f)
          expect(cmd).not.toBeNull()
          const info = driver.commands[cmd!]
          expect(info, `command ${cmd} is catalogued`).toBeDefined()
          expect(['destructive', 'ota', 'notify']).not.toContain(info!.safety)
        }
        await h.device.disconnect()
      })

      it('2. a status reply updates units and values; offline units are offline', async () => {
        const h = harness(product)
        await h.device.connect()
        await h.device.refresh('status')
        const s = h.device.state
        expect(s.lastStatusAt).not.toBeNull()
        expect(s.units.rx.online).toBe(true)
        expect(Object.values(s.units).some((u) => u && u.id !== 'rx' && u.online)).toBe(true)
        expect(Object.keys(s.values).length).toBeGreaterThan(0)
        await h.device.disconnect()

        const off = harness(product, { online: ['rx'] })
        await off.device.connect()
        await off.device.refresh('status')
        for (const u of Object.values(off.device.state.units)) if (u && u.id.startsWith('tx')) expect(u.online, u.id).toBe(false)
        await off.device.disconnect()
      })

      it('3. every write control round-trips', async () => {
        const h = harness(product)
        await h.device.connect()
        await h.device.refresh('status')
        let tested = 0
        for (const c of writeControls(h.device.controls)) {
          const unit = c.perUnit?.[0]
          const key = controlKey(c.id, unit)
          const state = h.device.state
          const avail = state.availability[key] ?? state.availability[c.id]
          if (avail && !avail.ok) continue
          const value = o.writeValues?.[key] ?? o.writeValues?.[c.id] ?? alternativeValue(c, state.values[key])
          if (value === undefined) continue
          const r = await h.device.set(c.id, value, { unit })
          expect(r, `${key} ack`).toMatchObject({ ok: true, confirmed: true })
          if (c.readBack === 'status') await h.device.refresh('status')
          else if (c.readBack === 'get') await h.device.refresh('settings')
          else await sleep(settleMs)
          expect(h.device.state.values[key], `${key} read back`).toEqual(value)
          tested++
        }
        if (writeControls(h.device.controls).length) expect(tested).toBeGreaterThan(0)
        await h.device.disconnect()
      })

      for (const g of o.gates ?? []) {
        if (g.product && g.product !== product) continue
        it(`4. gate: ${g.name}`, async () => {
          const h = harness(product, g.sim, { fetchIdentity: true })
          await h.device.connect()
          await h.device.refresh('status')
          await h.device.refresh('identity')
          const a = h.device.state.availability[controlKey(g.control, g.unit)] ?? h.device.state.availability[g.control]
          expect(a?.ok ?? true).toBe(g.expect === 'ok')
          await h.device.disconnect()
        })
      }

      for (const pc of o.preconditions ?? []) {
        if (pc.product && pc.product !== product) continue
        it(`5. precondition: ${pc.name}`, async () => {
          const h = harness(product, pc.sim)
          pc.arrange?.(h.simulator)
          await h.device.connect()
          await h.device.refresh('status')
          const before = h.transport.sent.length
          const err = await h.device.set(pc.control, pc.value, { unit: pc.unit }).then(() => null, (e: unknown) => e)
          expect(err instanceof ControlUnavailableError || err instanceof PreconditionError, String(err)).toBe(true)
          if (pc.reason) expect((err as { reason?: string }).reason).toBe(pc.reason)
          expect(h.transport.sent.length, 'nothing sent').toBe(before)
          await h.device.disconnect()
        })
      }

      it('6. dropped replies: rx unavailable, writes refused unless blindWrites, toggles never blind', async () => {
        const strict = harness(product, { dropReplies: true })
        const s = await strict.device.connect()
        expect(s.rx).toBe('unavailable')
        // First write control not refused for another reason (firmware gate while the version is unknown).
        const first = writeControls(strict.device.controls).find((c) => strict.device.state.availability[c.id]?.ok !== false)
        if (first) {
          await expect(strict.device.set(first.id, actionValue(first), { unit: first.perUnit?.[0] })).rejects.toBeInstanceOf(RxUnavailableError)
        }
        await expect(strict.device.refresh('status')).rejects.toBeInstanceOf(RxUnavailableError)
        await strict.device.disconnect()

        const blind = harness(product, { dropReplies: true }, { blindWrites: true })
        await blind.device.connect()
        const from = blind.transport.sent.length
        for (const c of writeControls(blind.device.controls)) {
          const r = await blind.device.set(c.id, actionValue(c), { unit: c.perUnit?.[0] }).catch((e: unknown) => e)
          if (r instanceof Error) continue // refused (toggle, unknown state…)
          expect(r, c.id).toMatchObject({ confirmed: false })
        }
        for (const f of blind.transport.sent.slice(from)) {
          const info = driver.commands[blind.cmdOf(f)!]
          expect(info?.toggle ?? false, `${info?.name} sent blind`).toBe(false)
        }
        await blind.device.disconnect()
      })

      it('7. duplicate and chunked replies decode the same', async () => {
        const base = harness(product)
        await base.device.connect()
        await base.device.refresh('status')
        const want = { values: base.device.state.values, units: base.device.state.units }
        await base.device.disconnect()

        const dup = harness(product, { duplicateReplies: true })
        await dup.device.connect()
        await dup.device.refresh('status')
        await dup.device.refresh('status')
        expect(dup.device.state.values).toEqual(want.values)
        const w = writeControls(dup.device.controls).find((c) => {
          const a = dup.device.state.availability[c.id]
          return !c.perUnit && (!a || a.ok)
        })
        if (w) {
          const r = await dup.device.set(w.id, o.writeValues?.[w.id] ?? alternativeValue(w, dup.device.state.values[w.id])!)
          expect(r).toMatchObject({ ok: true, confirmed: true })
        }
        await dup.device.disconnect()

        for (const n of chunkSizes) {
          const ch = harness(product, { chunkSize: n })
          await ch.device.connect()
          await ch.device.refresh('status')
          expect(ch.device.state.values, `chunk ${n}`).toEqual(want.values)
          expect(ch.device.state.units, `chunk ${n}`).toEqual(want.units)
          await ch.device.disconnect()
        }
      })

      it('8. no destructive or OTA command for an untested product, even with allowDestructive', async () => {
        const untested: ProductInfo = { ...product, support: { ...supportOf(product), hardware: 'untested' } }
        const h = harness(untested, {}, { allowDestructive: true })
        await h.device.connect()
        await h.device.refresh('status')
        const dangerous = driver.controls.filter((c) => c.safety === 'destructive' || c.safety === 'ota')
        expect(h.device.controls.filter((c) => c.safety === 'destructive' || c.safety === 'ota')).toEqual([])
        for (const c of dangerous) {
          await expect(h.device.set(c.id, actionValue(c), { confirm: true, unit: c.perUnit?.[0] }), c.id).rejects.toBeInstanceOf(DestructiveCommandError)
        }
        for (const f of h.transport.sent) {
          const info = driver.commands[h.cmdOf(f)!]
          expect(['destructive', 'ota']).not.toContain(info?.safety)
        }
        await h.device.disconnect()
      })

      it('9. garbage is refused; timeouts reject cleanly; disconnect rejects pending requests', async () => {
        const h = harness(product)
        await h.device.connect()
        const before = h.transport.sent.length
        await expect(h.device.sendRaw(Uint8Array.of(0xde, 0xad, 0xbe, 0xef))).rejects.toThrow()
        expect(h.transport.sent.length).toBe(before)
        h.simulator.faults.dropReplies = true
        await expect(h.device.refresh('status')).rejects.toBeInstanceOf(TimeoutError)
        const pending = h.device.refresh('status')
        await h.device.disconnect()
        await expect(pending).rejects.toBeInstanceOf(DisconnectedError)
      })
    })
  }
}
