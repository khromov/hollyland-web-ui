/**
 * Conformance check 10, "populated after connect" (core/conformance.ts), tested on itself with variants of the toy
 * driver: what counts as readable, per-unit keys and offline units, the explanations it accepts (availability, a
 * declared exception) and the ones it refuses ('version-unknown', stale or reason-less exceptions, defaults that
 * did not come from the device).
 */
import { describe, expect, it } from 'vitest'
import { lookupProduct } from '../../models'
import { CONTROL, controlKey } from '../controls'
import {
  checkNothingInvented, checkPopulatedAfterConnect, isReadableControl, MIN_EXCEPTION_REASON_LENGTH, notReadOnConnectProblems, populationRuns,
} from '../conformance'
import { FamilyDevice } from '../engine'
import type { ControlSpec, EngineContext, FamilyDriver, MicState, ProtocolSpec } from '../types'
import { LEGACY_DRIVERS } from '../../families/legacy'
import { TOY_COMMANDS, TOY_CONTROLS, TOY_PRODUCT, TOY_SPEC, toyDriver, type ToyMsg, type ToyReq } from './toy-driver'

const READABLE = [CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.LED, 'mic.mute:tx1', 'mic.mute:tx2']

/** The toy driver with extra controls and / or a changed ProtocolSpec. */
function toyVariant(name: string, o: { extra?: readonly ControlSpec[]; spec?: Partial<ProtocolSpec<ToyReq, ToyMsg>> } = {}): FamilyDriver {
  const controls = [...TOY_CONTROLS, ...(o.extra ?? [])]
  const spec: ProtocolSpec<ToyReq, ToyMsg> = { ...TOY_SPEC, ...o.spec, controls: () => controls }
  return {
    ...toyDriver,
    name: `Toy (${name})`,
    controls,
    createDevice: (t, p, opts) => new FamilyDevice(t, p, { family: '6108', commands: TOY_COMMANDS, spec }, opts),
  }
}

/** onMessage that runs the toy mapping, then rewrites what it set. */
function rewriteValues(f: (v: MicState['values']) => MicState['values']): Partial<ProtocolSpec<ToyReq, ToyMsg>> {
  return {
    onMessage(ctx, msg, solicited) {
      const c = Object.create(ctx) as EngineContext<ToyReq, ToyMsg>
      c.setValues = (v) => ctx.setValues(f(v))
      TOY_SPEC.onMessage(c, msg, solicited)
    },
  }
}

const extraControl = (id: string, readBack: ControlSpec['readBack']): ControlSpec => ({
  id, label: id, group: 'settings', kind: 'switch', safety: 'write', readBack, confidence: 'high', source: 'toy',
})

describe('check 10: what is readable', () => {
  it('readBack status / get / push is readable; none and actions are not', () => {
    expect(TOY_CONTROLS.filter(isReadableControl).map((c) => c.id)).toEqual([
      CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.LED, CONTROL.MIC_MUTE,
    ])
    expect(isReadableControl(extraControl('x', 'push'))).toBe(true)
    expect(isReadableControl(extraControl('x', 'get'))).toBe(true)
    expect(isReadableControl(extraControl('x', 'none'))).toBe(false)
    // An action with a read-back (legacy Remove Pairing, readBack 'status') has no value of its own.
    expect(isReadableControl({ ...extraControl('x', 'status'), kind: 'action' })).toBe(false)
  })
})

describe('check 10: populated after connect', () => {
  it('the toy driver: every readable key is populated, per unit for per-unit controls', async () => {
    const r = await checkPopulatedAfterConnect(toyDriver, TOY_PRODUCT)
    expect(r.rx).toBe('available')
    expect(r.checked).toEqual(READABLE)
    expect(r.populated).toEqual(READABLE)
    expect(r).toMatchObject({ missing: [], invalid: [], unavailable: [], excepted: [], offline: [], stale: [] })
    expect(r.values[controlKey(CONTROL.MIC_MUTE, 'tx2')]).toBe(false)
  })

  it('a per-unit key of an offline unit is not checked (nothing to read), and is reported', async () => {
    const r = await checkPopulatedAfterConnect(toyDriver, TOY_PRODUCT, { sim: { online: ['rx', 'tx1'] } })
    expect(r.offline).toEqual(['mic.mute:tx2'])
    expect(r.checked).not.toContain('mic.mute:tx2')
    expect(r.missing).toEqual([])
  })

  it('a status value the driver does not map is missing, with the start-up-read hint', async () => {
    const d = toyVariant('no volume in status', {
      spec: rewriteValues((v) => {
        const { [CONTROL.VOLUME]: _drop, ...rest } = v
        return rest
      }),
    })
    const r = await checkPopulatedAfterConnect(d, TOY_PRODUCT)
    expect(r.missing.map((m) => [m.key, m.readBack])).toEqual([[CONTROL.VOLUME, 'status']])
    expect(r.missing[0].hint).toMatch(/read it at start-up too/)
  })

  it('a GET-backed control nobody reads on connect is missing; push-backed too', async () => {
    const d = toyVariant('unread GET and push', { extra: [extraControl('toy.gain', 'get'), extraControl('toy.meter', 'push')] })
    const r = await checkPopulatedAfterConnect(d, TOY_PRODUCT)
    expect(r.missing.map((m) => [m.key, m.readBack])).toEqual([['toy.gain', 'get'], ['toy.meter', 'push']])
    expect(r.missing[0].hint).toMatch(/no GET/)
    expect(r.missing[1].hint).toMatch(/no push/)
  })

  it('fetchIdentity / fetchSettings in deviceOptions are ignored: the start-up reads always run', async () => {
    // toy.item* come from GET_ALL, sent only under fetchSettings.
    const d = toyVariant('settings via GET_ALL', { extra: [{ ...extraControl('toy.item1', 'get'), kind: 'steps', range: { min: 0, max: 255, step: 1 } }] })
    const r = await checkPopulatedAfterConnect(d, TOY_PRODUCT, { deviceOptions: { fetchSettings: false, fetchIdentity: false } })
    expect(r.missing).toEqual([])
    expect(r.values['toy.item1']).toBe(20)
  })

  it('a value outside its ControlSpec is invalid', async () => {
    const d = toyVariant('volume 9', { spec: rewriteValues((v) => (CONTROL.VOLUME in v ? { ...v, [CONTROL.VOLUME]: 9 } : v)) })
    const r = await checkPopulatedAfterConnect(d, TOY_PRODUCT)
    expect(r.invalid).toEqual([{ key: CONTROL.VOLUME, value: 9, error: expect.stringMatching(/outside 0..5/) }])
    expect(r.populated).not.toContain(CONTROL.VOLUME)
  })
})

describe('check 10: accepted and refused explanations', () => {
  const gated = (reason: string) =>
    toyVariant(`gated ${reason}`, {
      extra: [extraControl('toy.gated', 'get')],
      spec: {
        onMessage(ctx, msg, solicited) {
          TOY_SPEC.onMessage(ctx, msg, solicited)
          ctx.setAvailability({ 'toy.gated': { ok: false, reason, message: 'test gate' } })
        },
      },
    })

  it('availability with a reason (firmware too old, a precondition) explains an unknown value', async () => {
    for (const reason of ['firmware-too-old', 'noise-off']) {
      const r = await checkPopulatedAfterConnect(gated(reason), TOY_PRODUCT)
      expect(r.missing, reason).toEqual([])
      expect(r.unavailable).toEqual([{ key: 'toy.gated', reason }])
    }
  })

  it("'version-unknown' after the identity reads is not an explanation", async () => {
    const r = await checkPopulatedAfterConnect(gated('version-unknown'), TOY_PRODUCT)
    expect(r.missing.map((m) => m.key)).toEqual(['toy.gated'])
    expect(r.missing[0].hint).toMatch(/RX version is unknown/)
  })

  it('a declared exception excuses the value and is reported with its reason; scoping by product and run', async () => {
    const d = toyVariant('unread GET', { extra: [extraControl('toy.gain', 'get')] })
    const reason = 'only the iOS app reads it (test)'
    const ok = await checkPopulatedAfterConnect(d, TOY_PRODUCT, { notReadOnConnect: { 'toy.gain': reason } })
    expect(ok.missing).toEqual([])
    expect(ok.excepted).toEqual([{ key: 'toy.gain', reason }])
    // Scoped to another product or another run: it does not apply.
    const other = await checkPopulatedAfterConnect(d, TOY_PRODUCT, { notReadOnConnect: { 'toy.gain': { reason, productIds: [0xf002] } } })
    expect(other.missing.map((m) => m.key)).toEqual(['toy.gain'])
    const preset = await checkPopulatedAfterConnect(d, TOY_PRODUCT, { notReadOnConnect: { 'toy.gain': { reason, runs: ['toy-4mic'] } } })
    expect(preset.missing.map((m) => m.key)).toEqual(['toy.gain'])
  })

  it('a per-unit exception covers that unit only; a bare id covers every unit', async () => {
    const d = toyVariant('no tx2 mute', {
      spec: rewriteValues((v) => {
        const { 'mic.mute:tx2': _a, 'mic.mute:tx1': _b, ...rest } = v
        return rest
      }),
    })
    const unit = await checkPopulatedAfterConnect(d, TOY_PRODUCT, { notReadOnConnect: { 'mic.mute:tx2': 'tx2 is never reported (test)' } })
    expect(unit.missing.map((m) => m.key)).toEqual(['mic.mute:tx1'])
    const all = await checkPopulatedAfterConnect(d, TOY_PRODUCT, { notReadOnConnect: { [CONTROL.MIC_MUTE]: 'mute is never reported (test)' } })
    expect(all.missing).toEqual([])
    expect(all.excepted.map((e) => e.key)).toEqual(['mic.mute:tx1', 'mic.mute:tx2'])
  })

  it('an exception for a value that is populated is stale', async () => {
    const r = await checkPopulatedAfterConnect(toyDriver, TOY_PRODUCT, { notReadOnConnect: { [CONTROL.LED]: 'thought it was GET-only (test)' } })
    expect(r.stale).toEqual([CONTROL.LED])
  })

  it('declarations are validated: reason length, readable control, unit, product and run', () => {
    const problems = notReadOnConnectProblems(toyDriver, {
      [CONTROL.VOLUME]: 'n/a',
      'toy.nothing': 'no such control here (test)',
      [CONTROL.RESTART_RX]: 'an action has no value (test)',
      'mic.mute:tx3': 'tx3 is not in perUnit (test)',
      [CONTROL.LED]: { reason: 'scoped to a foreign product (test)', productIds: [1041] },
      [CONTROL.NOISE_LEVEL]: { reason: 'scoped to an unknown run (test)', runs: ['nope'] },
      'mic.mute:tx1': { reason: 'a valid per-unit exception', runs: ['default', 'toy'] },
    })
    expect(problems).toEqual([
      `${CONTROL.VOLUME}: the reason must say why the value stays unknown (at least ${MIN_EXCEPTION_REASON_LENGTH} characters)`,
      'toy.nothing: not a control (or control:unit key) of Toy',
      `${CONTROL.RESTART_RX}: ${CONTROL.RESTART_RX} has no read path (readBack 'none' or an action); nothing to excuse`,
      'mic.mute:tx3: not a control (or control:unit key) of Toy',
      `${CONTROL.LED}: product 1041 is not served by Toy`,
      `${CONTROL.NOISE_LEVEL}: run "nope" is neither 'default' nor a mock preset id`,
    ])
  })
})

describe('check 10: nothing invented', () => {
  it('with every reply dropped no readable control has a value', async () => {
    const r = await checkNothingInvented(toyDriver, TOY_PRODUCT)
    expect(r).toEqual({ rx: 'unavailable', packets: 0, invented: [] })
  })

  it('a device that shows defaults before the receiver answered is caught', async () => {
    class Defaults extends FamilyDevice<ToyReq, ToyMsg> {
      override get state(): MicState {
        const s = super.state
        return { ...s, values: { [CONTROL.VOLUME]: 3, ...s.values } }
      }
    }
    const d: FamilyDriver = {
      ...toyDriver,
      createDevice: (t, p, o) => new Defaults(t, p, { family: '6108', commands: TOY_COMMANDS, spec: TOY_SPEC }, o),
    }
    expect((await checkNothingInvented(d, TOY_PRODUCT)).invented).toEqual([CONTROL.VOLUME])
  })
})

describe('check 10: runs', () => {
  it('one default run per product (standing for presets without options), one per preset with simulator options', () => {
    expect(populationRuns(toyDriver, TOY_PRODUCT)).toEqual([{ id: 'default', product: TOY_PRODUCT, sim: {}, presets: ['toy'] }])
    const a2 = lookupProduct(0x3547, 1041)!
    expect(populationRuns(LEGACY_DRIVERS['6118'], a2).map((r) => ({ id: r.id, sim: r.sim }))).toEqual([
      { id: 'default', sim: {} },
      { id: 'blind', sim: { dropReplies: true } },
    ])
  })
})
