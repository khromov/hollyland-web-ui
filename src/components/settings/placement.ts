/**
 * What the Settings page draws for a product on the family drivers (LARK A1, LARK M3, LARK MAX 2,
 * MELO P1), and how.
 *
 * Which page owns a control is decided once, by the generic renderer's `pageOf()`
 * (src/components/controls/controls.ts): the official home screens' controls (groups mics,
 * receiver, audio) are on the Overview, except the set-and-forget ones (locks, recognition, bit
 * depths, phone speaker, 4-mic mode, pairing, camera power); those and the "More Settings" ones
 * (settings, advanced) are here;
 * timecode, monitoring and the MELO P1 mixer have pages of their own
 * (src/components/<page>/<Page>Page.svelte, see App.svelte), which render the Settings section
 * components (TimecodeSection, MonitoringSection, MixerSection).
 */
import type { ControlId, ControlSpec, FamilyCode } from '../../lib/protocol/app'
import { pageOf, type ControlPage } from '../controls/controls'

/** One module: a control, optionally with sub-controls drawn inside it. */
export interface Item {
  id: ControlId
  /** Shown inside the parent module; disabled (nothing marked) while the parent switch is off. */
  nested?: readonly ControlId[]
  /** Module title instead of the control's label. */
  title?: string
  /** A switch drawn as two keys with these legends (e.g. 15min | Never). */
  legends?: { on: string; off: string }
  /** A two-value choice drawn as a switch: which value is on. */
  switchOn?: { on: number; off: number }
  /** Choice values not drawn as keys (offered elsewhere, e.g. the timecode Reset key). */
  hide?: readonly number[]
  /** Values shown as another one (after a timecode Reset the receiver counts from zero). */
  alias?: Readonly<Record<number, number>>
}

/** Per control: how the Settings module draws it (official labels; the A1 and M2S show 15min | Never). */
const ITEM: Readonly<Record<string, Omit<Item, 'id'>>> = {
  'autoOff@6108': { legends: { on: '15min', off: 'Never' } },
  led: { nested: ['melo.led.brightness'] },
  'led@6201': { title: 'LED', nested: ['melo.led.brightness'] },
  'melo.autoSpeaker': { title: 'Auto speaker output' },
  'melo.jack.mode': { title: '3.5 mm jack' },
}

/** Sub-controls drawn inside another module (never on their own). */
const NESTED = new Set<ControlId>(['melo.led.brightness'])

export function itemFor(id: ControlId, family: FamilyCode | null): Item {
  return { id, ...(ITEM[`${id}@${family}`] ?? ITEM[id] ?? {}) }
}

/** The modules of one page's controls, in the driver's order (sub-controls folded into their parent). */
export function itemsOn(page: ControlPage, controls: readonly ControlSpec[], family: FamilyCode | null): Item[] {
  return controls
    .filter((c) => pageOf(c, family) === page && !NESTED.has(c.id) && c.safety !== 'ota')
    .map((c) => itemFor(c.id, family))
}

/** Pages that are drawn as Settings sections while they have no page of their own. */
export type ExtraSection = 'mixer' | 'timecode' | 'monitoring'
