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
 * 10. populated after connect: for every product and every mock preset, after connect() with the
 *     default start-up reads (fetchIdentity / fetchSettings on) every READABLE control
 *     (isReadableControl: ControlSpec.readBack 'status' | 'get' | 'push', not an action) has a valid
 *     value in MicState.values for every online unit it applies to, unless MicState.availability
 *     says why not (firmware gate, precondition) or the driver declares the exception with a reason
 *     (ConformanceOptions.notReadOnConnect). With every reply dropped, no readable value appears
 *     (values come from the device, never from defaults). Catches the Lark M2 PID 7 bug: the volume
 *     stayed unknown after every (re)connect because 0x04 was not read at start-up (PROTOCOL.md §11.8).
 *
 * Test-only module: imports vitest. Not exported from index.ts.
 */
import { describe, expect, it } from 'vitest'
import { DestructiveCommandError, DisconnectedError, PreconditionError, RxUnavailableError, TimeoutError } from '../device'
import { displayName, isConnectableProduct, supportOf, type ProductInfo } from '../models'
import { MockTransport } from '../mock'
import { alternativeValue, controlKey, validateControlValue } from './controls'
import { ControlUnavailableError } from './errors'
import { simulatedTransport } from './simulate'
import type {
  ControlId, ControlSpec, ControlValue, DeviceSimulator, FamilyDriver, MicDevice, MicDeviceOptions, MicState, MockPreset, RxAvailability,
  SimOptions, UnitId,
} from './types'

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
  /**
   * Merged over the fast test defaults. Check 10 ignores `fetchIdentity` / `fetchSettings` here: it
   * always runs the start-up reads a user gets.
   */
  deviceOptions?: MicDeviceOptions
  /** Wait for background work (identity, settings) after connect (default 120 ms). */
  settleMs?: number
  /**
   * Check 10: readable controls whose value is legitimately unknown after connect, keyed by control
   * id (every unit) or per-unit key (`controlKey(id, unit)`, e.g. 'mic.mute:tx3'), with the reason
   * (at least 10 characters; it is printed in the test name). Scope it with `productIds` / `runs`
   * ('default' = the product's default simulator, or a mock preset id) when it holds only there.
   * An exception that names no readable control of the driver, or that excuses nothing on a run it
   * applies to (the value is known, or availability explains it), fails the suite: remove or scope it.
   */
  notReadOnConnect?: Readonly<Record<string, NotReadOnConnect>>
}

/** Reason string, or reason + scope (see ConformanceOptions.notReadOnConnect). */
export type NotReadOnConnect =
  | string
  | {
      reason: string
      /** Only for these products (USB PID / app id). Default: every product. */
      productIds?: readonly number[]
      /** Only for these runs: 'default' or a mock preset id. Default: every run. */
      runs?: readonly string[]
    }

/** Shortest accepted notReadOnConnect reason ("n/a", "todo" and the like are refused). */
export const MIN_EXCEPTION_REASON_LENGTH = 10

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

// ------------------------------------------------------------------- 10. populated after connect

/**
 * Whether a control has a read path, i.e. the device reports its value: in the status / heartbeat
 * reply (`readBack: 'status'`), with a GET (`'get'`) or in a device push (`'push'`). Actions and
 * write-only controls (`readBack: 'none'`) have no value to read. ControlSpec.readBack is the only
 * declaration a driver makes; check 10 holds every readable control to it.
 */
export function isReadableControl(c: ControlSpec): boolean {
  return c.kind !== 'action' && c.readBack !== 'none'
}

/** One connect of check 10: a product's default simulator, or one of its mock presets. */
export interface PopulationRun {
  /** 'default' or the mock preset id (the `runs` scope of notReadOnConnect). */
  id: string
  product: ProductInfo
  sim: SimOptions
  /** Presets without simulator options, which this default run stands for. */
  presets: readonly string[]
}

export interface PopulationReport {
  run: string
  product: ProductInfo
  rx: RxAvailability
  /** Value keys of the readable controls on online units (controlKey), in control order. */
  checked: string[]
  /** Keys whose value is set and fits the ControlSpec. */
  populated: string[]
  /** Unknown, and MicState.availability says why (firmware gate, precondition). */
  unavailable: { key: string; reason: string }[]
  /** Unknown, declared in notReadOnConnect. */
  excepted: { key: string; reason: string }[]
  /** Per-unit keys of units that are offline or absent after connect (nothing to read). */
  offline: string[]
  /** Unknown and unexplained: what the check fails on. */
  missing: { key: string; readBack: ControlSpec['readBack']; hint: string }[]
  /** Values that do not fit their ControlSpec (type, options, range, step). */
  invalid: { key: string; value: ControlValue; error: string }[]
  /** notReadOnConnect keys that apply to this run and matched a checked key, but excused nothing. */
  stale: string[]
  /** MicState.values after the start-up reads (empty when rx was not 'available'). */
  values: MicState['values']
}

export interface PopulationOptions {
  /** 'default' (default) or the mock preset id: scopes notReadOnConnect. */
  run?: string
  sim?: SimOptions
  /** Merged over fast timing; fetchIdentity / fetchSettings are ignored (the start-up reads always run). */
  deviceOptions?: MicDeviceOptions
  /** Wait after connect before the device's queues are drained (default 120 ms). */
  settleMs?: number
  notReadOnConnect?: Readonly<Record<string, NotReadOnConnect>>
}

/**
 * Check 10 device options: fast timing, no status poll (only connect() and its start-up reads may
 * populate the state, not a later poll tick), every other option at its default, so
 * fetchIdentity and fetchSettings are on.
 */
const POPULATE: MicDeviceOptions = { requestTimeoutMs: 40, probeTimeoutMs: 60, interFrameDelayMs: 0, heartbeatIntervalMs: null }

function populateOptions(o: MicDeviceOptions | undefined): MicDeviceOptions {
  const { fetchIdentity: _identity, fetchSettings: _settings, ...rest } = o ?? {}
  return { ...POPULATE, ...rest }
}

/** Wait for the start-up reads: `ms`, then until the device's queues are empty (`idle()`, when the device has one). */
async function settle(device: MicDevice, ms: number): Promise<void> {
  await sleep(ms)
  const idle = (device as { idle?: (timeoutMs?: number) => Promise<void> }).idle
  if (typeof idle === 'function') await idle.call(device, 5000)
}

function normaliseException(e: NotReadOnConnect): Exclude<NotReadOnConnect, string> {
  return typeof e === 'string' ? { reason: e } : e
}

/** The notReadOnConnect entry for `key` (per-unit key first, then the bare id) that applies to this product and run. */
function exceptionFor(
  map: PopulationOptions['notReadOnConnect'],
  key: string,
  id: ControlId,
  product: ProductInfo,
  run: string,
): { k: string; reason: string } | null {
  for (const k of key === id ? [id] : [key, id]) {
    const raw = map?.[k]
    if (raw === undefined) continue
    const e = normaliseException(raw)
    if (e.productIds && !e.productIds.includes(product.productId)) continue
    if (e.runs && !e.runs.includes(run)) continue
    return { k, reason: e.reason }
  }
  return null
}

function missingHint(c: ControlSpec, a: MicState['availability'][string]): string {
  if (a && !a.ok && a.reason === 'version-unknown') {
    return 'its firmware gate is still closed because the RX version is unknown after the start-up identity reads (read it at start-up when options.fetchIdentity)'
  }
  switch (c.readBack) {
    case 'status':
      return 'the status reply of this product does not carry it: read it at start-up too (ProtocolSpec.onConnected under options.fetchSettings; legacy: HollylandDevice.fetchExtraSettings), as the Lark M2 PID 7 volume needs 0x04'
    case 'get':
      return 'no GET for it was answered at start-up: send it from ProtocolSpec.onConnected when options.fetchSettings (legacy: HollylandDevice.fetchExtraSettings)'
    case 'push':
      return 'no push carried it after connect: the simulator must push what the device pushes (DeviceSimulator.attach) and onMessage must map it'
    default:
      return ''
  }
}

/**
 * Check 10 for one product and simulator: connect with the default start-up reads, let them settle,
 * then sort the value key of every readable control on every online unit into populated,
 * unavailable (availability says why), excepted (notReadOnConnect), offline or missing.
 * 'version-unknown' is not accepted as a reason: after the identity reads the version must be known.
 */
export async function checkPopulatedAfterConnect(driver: FamilyDriver, product: ProductInfo, o: PopulationOptions = {}): Promise<PopulationReport> {
  const run = o.run ?? 'default'
  const report: PopulationReport = {
    run, product, rx: 'unknown', checked: [], populated: [], unavailable: [], excepted: [], offline: [], missing: [], invalid: [], stale: [],
    values: {},
  }
  const transport = simulatedTransport(driver.createSimulator(product, o.sim ?? {}))
  const device = driver.createDevice(transport, product, populateOptions(o.deviceOptions))
  try {
    report.rx = (await device.connect()).rx
    if (report.rx !== 'available') return report
    await settle(device, o.settleMs ?? 120)
    const s = device.state
    report.rx = s.rx
    report.values = s.values
    const touched = new Set<string>()
    const used = new Set<string>()
    for (const c of device.controls) {
      if (!isReadableControl(c)) continue
      const keys: { key: string; unit?: UnitId }[] = c.perUnit ? c.perUnit.map((unit) => ({ key: controlKey(c.id, unit), unit })) : [{ key: c.id }]
      for (const { key, unit } of keys) {
        if (unit && unit !== 'rx' && !s.units[unit]?.online) {
          report.offline.push(key)
          continue
        }
        report.checked.push(key)
        const ex = exceptionFor(o.notReadOnConnect, key, c.id, product, run)
        if (ex) touched.add(ex.k)
        const v = s.values[key]
        if (v !== undefined) {
          try {
            validateControlValue(c, v, unit)
            report.populated.push(key)
          } catch (e) {
            report.invalid.push({ key, value: v, error: (e as Error).message })
          }
          continue
        }
        const a = (unit ? s.availability[key] : undefined) ?? s.availability[c.id]
        if (a && !a.ok && a.reason && a.reason !== 'version-unknown') {
          report.unavailable.push({ key, reason: a.reason })
        } else if (ex) {
          used.add(ex.k)
          report.excepted.push({ key, reason: ex.reason })
        } else {
          report.missing.push({ key, readBack: c.readBack, hint: missingHint(c, a) })
        }
      }
    }
    report.stale = [...touched].filter((k) => !used.has(k))
  } finally {
    await device.disconnect().catch(() => undefined)
  }
  return report
}

/**
 * The inverse of check 10: with every reply dropped, rx is 'unavailable' and, as long as no packet
 * came from the device, no readable control has a value. A driver cannot pass check 10 with
 * default values; what MicState.values shows came from the device.
 */
export async function checkNothingInvented(
  driver: FamilyDriver,
  product: ProductInfo,
  o: Pick<PopulationOptions, 'sim' | 'deviceOptions' | 'settleMs'> = {},
): Promise<{ rx: RxAvailability; packets: number; invented: string[] }> {
  const transport = simulatedTransport(driver.createSimulator(product, { ...o.sim, dropReplies: true }))
  let packets = 0
  const off = transport.onPacket(() => packets++)
  const device = driver.createDevice(transport, product, populateOptions(o.deviceOptions))
  try {
    const rx = (await device.connect()).rx
    await settle(device, Math.min(o.settleMs ?? 120, 40))
    const s = device.state
    const invented: string[] = []
    for (const c of device.controls) {
      if (!isReadableControl(c)) continue
      for (const key of c.perUnit ? c.perUnit.map((u) => controlKey(c.id, u)) : [c.id]) if (s.values[key] !== undefined) invented.push(key)
    }
    return { rx, packets, invented }
  } finally {
    off()
    await device.disconnect().catch(() => undefined)
  }
}

const hasSimOptions = (m: MockPreset) => !!m.sim && Object.keys(m.sim).length > 0

/** Check 10 runs of a product: its default simulator (standing for the presets without options), then each preset with simulator options. */
export function populationRuns(driver: FamilyDriver, product: ProductInfo): PopulationRun[] {
  const presets = driver.mockPresets.filter((m) => m.productId === product.productId)
  return [
    { id: 'default', product, sim: {}, presets: presets.filter((m) => !hasSimOptions(m)).map((m) => m.id) },
    ...presets.filter(hasSimOptions).map((m) => ({ id: m.id, product, sim: m.sim!, presets: [] })),
  ]
}

/**
 * Problems with a driver's notReadOnConnect declarations: a reason shorter than
 * MIN_EXCEPTION_REASON_LENGTH, a key that is not a readable control (or a unit outside its perUnit),
 * a productId the driver does not serve, a run that is neither 'default' nor a preset id.
 */
export function notReadOnConnectProblems(driver: FamilyDriver, map: Readonly<Record<string, NotReadOnConnect>>): string[] {
  const out: string[] = []
  const runIds = new Set(['default', ...driver.mockPresets.map((m) => m.id)])
  for (const [key, raw] of Object.entries(map)) {
    const e = normaliseException(raw)
    if (typeof e.reason !== 'string' || e.reason.trim().length < MIN_EXCEPTION_REASON_LENGTH) {
      out.push(`${key}: the reason must say why the value stays unknown (at least ${MIN_EXCEPTION_REASON_LENGTH} characters)`)
    }
    const c = driver.controls.find((x) => x.id === key || (x.perUnit && x.perUnit.some((u) => controlKey(x.id, u) === key)))
    if (!c) out.push(`${key}: not a control (or control:unit key) of ${driver.name}`)
    else if (!isReadableControl(c)) out.push(`${key}: ${c.id} has no read path (readBack 'none' or an action); nothing to excuse`)
    for (const pid of e.productIds ?? []) if (!driver.products.some((p) => p.productId === pid)) out.push(`${key}: product ${pid} is not served by ${driver.name}`)
    for (const r of e.runs ?? []) if (!runIds.has(r)) out.push(`${key}: run "${r}" is neither 'default' nor a mock preset id`)
  }
  return out
}

/** Exceptions that apply to a run, for the test name. */
function exceptionsOfRun(map: ConformanceOptions['notReadOnConnect'], product: ProductInfo, run: string): string[] {
  return Object.entries(map ?? {}).flatMap(([k, raw]) => {
    const e = normaliseException(raw)
    if (e.productIds && !e.productIds.includes(product.productId)) return []
    if (e.runs && !e.runs.includes(run)) return []
    return [`${k} (${e.reason})`]
  })
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
  if (o.notReadOnConnect) {
    const map = o.notReadOnConnect
    describe(`${driver.name} (${driver.code}) notReadOnConnect exceptions`, () => {
      it('10. every exception names a readable control and says why its value stays unknown', () => {
        expect(notReadOnConnectProblems(driver, map)).toEqual([])
      })
    })
  }
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

      for (const run of populationRuns(driver, product)) {
        if (run.sim.dropReplies) {
          it(`10. preset ${run.id} (replies dropped): no readable control gets a value`, async () => {
            const r = await checkNothingInvented(driver, product, { sim: run.sim, deviceOptions: o.deviceOptions, settleMs })
            expect(r.rx).toBe('unavailable')
            if (r.packets === 0) expect(r.invented, 'values without any packet from the device').toEqual([])
          })
          continue
        }
        const label = run.id === 'default' ? `default simulator${run.presets.length ? ` = preset ${run.presets.join(', ')}` : ''}` : `preset ${run.id}`
        const declared = exceptionsOfRun(o.notReadOnConnect, product, run.id)
        it(`10. readable controls are populated after connect (${label})${declared.length ? `; not read on connect: ${declared.join('; ')}` : ''}`, async () => {
          const r = await checkPopulatedAfterConnect(driver, product, {
            run: run.id, sim: run.sim, deviceOptions: o.deviceOptions, settleMs, notReadOnConnect: o.notReadOnConnect,
          })
          expect(r.rx, 'replies are delivered').toBe('available')
          expect(
            r.missing.map((m) => `${m.key} (readBack '${m.readBack}'): ${m.hint}`),
            `readable controls still unknown after connect on ${displayName(product)} (${run.id}); fix the start-up reads, or declare notReadOnConnect with a reason`,
          ).toEqual([])
          expect(r.invalid.map((m) => `${m.key} = ${JSON.stringify(m.value)}: ${m.error}`), 'values that do not fit their ControlSpec').toEqual([])
          expect(
            r.stale.map((k) => `${k}: excuses nothing on this run (the value is known, or availability explains it): remove it or scope it with productIds / runs`),
            'stale notReadOnConnect exceptions',
          ).toEqual([])
        })
      }

      it('10. with every reply dropped, no readable control gets a value (values come from the device, not defaults)', async () => {
        const r = await checkNothingInvented(driver, product, { deviceOptions: o.deviceOptions, settleMs })
        expect(r.rx).toBe('unavailable')
        if (r.packets === 0) expect(r.invented, 'values without any packet from the device').toEqual([])
      })
    })
  }
}
