/**
 * The supported-models line of the Connect page, generated from the registry so it follows the
 * drivers: every product a session can open (`isConnectableProduct`), one name per model, grouped
 * by series ("LARK A2, A2S, M2, M2S, C1, M1, Mini, A1, M3, MAX 2 and MELO P1").
 * Variants of one model (camera / phone receivers, 2nd gen, the OEM build, the charging case of a
 * model that also has a receiver) collapse into that model.
 */
import { ALL_PRODUCTS, bleProducts, isConnectableProduct, type ProductInfo } from '../../lib/protocol'

export interface ModelName {
  /** "LARK", "MELO". */
  series: string
  /** "A2", "Mini", "MAX 2", "P1". */
  model: string
}

/** Series and model of a row: "Lark M2 (EAGLESHERO)" → LARK / M2, "LARK MAX 2 charging case" → LARK / MAX 2. */
export function modelName(p: ProductInfo): ModelName {
  let name = p.name.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  if (p.deviceKind === 'case') name = name.replace(/\s+charging case$/i, '')
  const [head, ...rest] = name.split(/\s+/)
  return { series: head.toUpperCase(), model: rest.join(' ') }
}

/** Distinct models of `products`, in registry order. */
export function modelsOf(products: readonly ProductInfo[]): ModelName[] {
  const out: ModelName[] = []
  for (const p of products) {
    const m = modelName(p)
    if (!out.some((x) => x.series === m.series && x.model === m.model)) out.push(m)
  }
  return out
}

/** "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Models grouped by series, the series named once: "LARK A2, A2S, M2 and MELO P1". */
export function modelsLine(models: readonly ModelName[]): string {
  const parts: string[] = []
  let series: string | null = null
  for (const m of models) {
    parts.push(m.series === series ? m.model : `${m.series} ${m.model}`.trim())
    series = m.series
  }
  return joinAnd(parts)
}

/** Every model a session can open, in registry order (USB rows first, then Bluetooth-only rows). */
export function connectableModels(products: readonly ProductInfo[] = ALL_PRODUCTS): ModelName[] {
  return modelsOf(products.filter(isConnectableProduct))
}

/**
 * Models reachable over Web Bluetooth, in the order of `connectableModels` (so the line reads the
 * same way as the full one).
 */
export function bluetoothModels(products: readonly ProductInfo[] = ALL_PRODUCTS): ModelName[] {
  const all = connectableModels(products)
  const ble = modelsOf(bleProducts(products))
  const at = (m: ModelName) => all.findIndex((x) => x.series === m.series && x.model === m.model)
  return [...ble].sort((a, b) => at(a) - at(b))
}

/**
 * The Bluetooth products by name ("LARK MAX 2 charging case and MELO P1"): what the chooser lists,
 * for the "not in the list?" section.
 */
export function bluetoothProductsLine(products: readonly ProductInfo[] = ALL_PRODUCTS): string {
  const order = connectableModels(products)
  const at = (p: ProductInfo) => {
    const m = modelName(p)
    return order.findIndex((x) => x.series === m.series && x.model === m.model)
  }
  const rows = [...bleProducts(products)].sort((a, b) => at(a) - at(b))
  const names: string[] = []
  for (const p of rows) {
    const n = p.name.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
    if (!names.includes(n)) names.push(n)
  }
  return joinAnd(names)
}
