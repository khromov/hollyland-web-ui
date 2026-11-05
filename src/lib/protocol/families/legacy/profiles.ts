/**
 * Developer option: force a 6501 product profile on a connected legacy receiver.
 *
 * The 6501 group (Lark C1 / C1 2nd gen / M1 2nd gen / Mini) uses the Lark M2's commands, classes
 * and codec (A larkc1/HLDeviceActivity for PIDs 1/7/8/11/12/13; I HL6501Engine), so a real Lark M2
 * can exercise the 6501 code path before any of those units is available (docs/FAMILIES.md §5.6
 * step 4). The forced device runs HollylandDevice with the profile row's rules (heartbeat mapping,
 * volume wire map, label swap, preconditions) and is READ-ONLY unless `allowWrites`: the profile's
 * value mappings (e.g. the Lark C1 volume wire map 5,4,3,0,1,2) may mean something else on the real
 * receiver.
 *
 *   const dev = new HollylandDevice(transport, { ...forceProfileOptions('m1g2') })      // read-only
 *   const mic = createProfiledMicDevice(transport, 'c1', { allowWrites: true })        // writes allowed
 *   // UI wiring (later): forceProfileOptions(profileFromSearch(location.search))
 */
import type { Family } from '../../commands'
import { HollylandDevice, type ForceProfileOption, type HollylandDeviceOptions } from '../../device'
import { LEGACY_PRODUCTS, displayName, supportOf, type ProductInfo } from '../../models'
import type { Transport } from '../../transport'
import type { SupportInfo } from '../../core/types'
import { LegacyMicDevice } from './adapter'

export interface LegacyProfile {
  /** Same id as the row's mock preset (`?mock=` / `?profile=`). */
  id: string
  /** displayName() of the row. */
  label: string
  vendorId: number
  productId: number
  family: Family
  support: SupportInfo
  /** What differs from the Lark M2 screen (legacy-6501.md §7). */
  rules: string
}

const RULES: Readonly<Record<number, readonly [id: string, rules: string]>> = {
  1: ['c1', 'heartbeat link/battery only; NC level and volume from 0x11 / 0x04; volume buttons 1–6 sent as 5,4,3,0,1,2; no NC-off check; volume without a mic'],
  11: ['c1g2', 'Mic1/Mic2 swapped for display (Mic1 = TX2); NC level refused while NC is off'],
  12: ['m1g2', 'heartbeat NC level and volume; NC level refused while NC is off'],
  13: ['mini', 'as Lark M1 (2nd gen); 0x16 body[0] = 3 marks a Lark Mini'],
}

/** The selectable 6501 profiles (rows with `family: '6501'`), in registry order. */
export const LEGACY_PROFILES: readonly LegacyProfile[] = LEGACY_PRODUCTS.filter((p) => p.family === '6501' && RULES[p.productId]).map(
  (p) => ({
    id: RULES[p.productId][0], label: displayName(p), vendorId: p.vendorId, productId: p.productId, family: '6501' as const,
    support: supportOf(p), rules: RULES[p.productId][1],
  }),
)

export function legacyProfile(id: string): LegacyProfile | undefined {
  return LEGACY_PROFILES.find((p) => p.id === id)
}

/**
 * Profiles worth offering for a connected receiver: every 6501 profile except the receiver's own row,
 * and none for a product that does not speak the legacy `AA DD` protocol (HollylandDevice.connect()
 * refuses those anyway).
 */
export function profilesFor(actual: ProductInfo | null | undefined): LegacyProfile[] {
  if (actual && actual.code !== 'unknown' && !actual.family && actual.familyCode !== '6501') return []
  return LEGACY_PROFILES.filter((p) => !(actual && p.vendorId === actual.vendorId && p.productId === actual.productId))
}

/**
 * HollylandDeviceOptions that force profile `id` (read-only unless `allowWrites`). Accepts the result
 * of profileFromSearch(); null / undefined / an unknown id give {} (no profile).
 */
export function forceProfileOptions(
  sel: string | { id: string; allowWrites?: boolean } | null | undefined,
  o: { allowWrites?: boolean } = {},
): Pick<HollylandDeviceOptions, 'forceProfile'> {
  if (!sel) return {}
  const id = typeof sel === 'string' ? sel : sel.id
  const allowWrites = (typeof sel === 'string' ? undefined : sel.allowWrites) ?? o.allowWrites ?? false
  const p = legacyProfile(id)
  if (!p) return {}
  const forceProfile: ForceProfileOption = { productId: p.productId, vendorId: p.vendorId, allowWrites }
  return { forceProfile }
}

/**
 * `?profile=<id>` (and `&profileWrites=1` to allow writes) from a URL query string, e.g.
 * `location.search`. Unknown ids give null.
 */
export function profileFromSearch(search: string): { id: string; allowWrites: boolean } | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const id = q.get('profile')
  if (!id || !legacyProfile(id)) return null
  const w = q.get('profileWrites')
  return { id, allowWrites: w === '1' || w === 'true' }
}

/** A LegacyMicDevice with profile `id` forced on `transport` (read-only unless `allowWrites`). */
export function createProfiledMicDevice(
  transport: Transport,
  id: string,
  o: Omit<HollylandDeviceOptions, 'forceProfile'> & { allowWrites?: boolean } = {},
): LegacyMicDevice {
  const { allowWrites, ...rest } = o
  const opts = forceProfileOptions(id, { allowWrites })
  if (!opts.forceProfile) throw new Error(`no legacy profile "${id}" (available: ${LEGACY_PROFILES.map((p) => p.id).join(', ')})`)
  return new LegacyMicDevice(new HollylandDevice(transport, { ...rest, ...opts }))
}
