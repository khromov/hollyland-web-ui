import { describe, expect, test } from 'vitest'
import { ALL_PRODUCTS, isConnectableProduct, type ProductInfo } from '../../../lib/protocol'
import { bluetoothModels, bluetoothProductsLine, connectableModels, joinAnd, modelName, modelsLine } from '../models'

describe('supported-models line', () => {
  test('every connectable model once, grouped by series', () => {
    expect(modelsLine(connectableModels())).toBe('LARK A2, A2S, M2, M2S, C1, M1, Mini, A1, M3, MAX 2 and MELO P1')
  })

  test('Bluetooth models in the same order', () => {
    expect(modelsLine(bluetoothModels())).toBe('LARK MAX 2 and MELO P1')
    expect(bluetoothProductsLine()).toBe('LARK MAX 2 charging case and MELO P1')
  })

  test('recognised-only rows are left out', () => {
    const names = ALL_PRODUCTS.filter((p) => !isConnectableProduct(p)).map((p) => modelName(p).model)
    expect(names).toContain('MAX')
    expect(modelsLine(connectableModels())).not.toMatch(/\bMAX\b(?! 2)/)
    expect(modelsLine(connectableModels())).not.toMatch(/Mic|Earphone|OWS/)
  })

  test('variants collapse into their model', () => {
    const row = (name: string, extra: Partial<ProductInfo> = {}) => ({ name, ...extra }) as ProductInfo
    expect(modelName(row('Lark M2 (EAGLESHERO)'))).toEqual({ series: 'LARK', model: 'M2' })
    expect(modelName(row('LARK MAX 2 charging case', { deviceKind: 'case' }))).toEqual({ series: 'LARK', model: 'MAX 2' })
    expect(modelName(row('MELO P1'))).toEqual({ series: 'MELO', model: 'P1' })
  })

  test('joinAnd', () => {
    expect(joinAnd([])).toBe('')
    expect(joinAnd(['a'])).toBe('a')
    expect(joinAnd(['a', 'b'])).toBe('a and b')
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
