import { describe, expect, it } from 'vitest'
import type { PlantNode, ProjectDoc } from '../../src/model/types'
import { DEFAULT_PRICES, priceKeyFor, projectCost, unitCost } from '../../src/model/costs'
import { createEmptyDoc } from '../../src/model/doc'
import '../../src/symbols/lib/index'

const node = (over: Partial<PlantNode>): PlantNode =>
  ({ id: 'n', kind: 'equipment', symbolId: 'pump.centrifugal', x: 0, y: 0, rotation: 0, ...over }) as PlantNode

describe('priceKeyFor', () => {
  it('classifies instrument bubbles by ISA letters', () => {
    const bubble = (letters: string) =>
      priceKeyFor(node({ kind: 'instrument', symbolId: 'instr.bubble', tag: { letters, loop: '100' } }))
    expect(bubble('FT')).toBe('instr.transmitter')
    expect(bubble('PIT')).toBe('instr.transmitter')
    expect(bubble('FIC')).toBe('instr.controller')
    expect(bubble('TE')).toBe('instr.element')
    expect(bubble('PI')).toBe('instr.indicator')
    expect(bubble('LSH')).toBe('instr.switch')
    expect(bubble('FY')).toBe('instr.converter')
    expect(bubble('AIT')).toBe('instr.analyzer') // analysis family outranks the T suffix
  })
  it('equipment prices by symbol id', () => {
    expect(priceKeyFor(node({ symbolId: 'pump.centrifugal' }))).toBe('pump.centrifugal')
  })
})

describe('unitCost precedence', () => {
  const n = node({ symbolId: 'pump.centrifugal' })
  it('table default when nothing overrides', () => {
    expect(unitCost(n, undefined)).toBe(DEFAULT_PRICES['pump.centrifugal']!.price)
  })
  it('project override beats the table', () => {
    expect(unitCost(n, { currency: '$', overrides: { 'pump.centrifugal': 9999 } })).toBe(9999)
  })
  it('per-node cost beats everything', () => {
    expect(unitCost({ ...n, cost: 123 }, { currency: '$', overrides: { 'pump.centrifugal': 9999 } })).toBe(123)
  })
  it('category fallback for unknown ids; annotations are free', () => {
    expect(unitCost(node({ symbolId: 'valve.gate' }))).toBeGreaterThan(0)
    expect(unitCost(node({ kind: 'annotation', symbolId: 'ann.text' }))).toBe(0)
    expect(unitCost(node({ kind: 'fitting', symbolId: 'fit.junction' }))).toBe(30)
  })
})

describe('projectCost', () => {
  const doc = (): ProjectDoc => {
    const d = createEmptyDoc()
    d.sheets[0]!.nodes = [
      node({ id: 'a', symbolId: 'pump.centrifugal' }),
      node({ id: 'b', symbolId: 'pump.centrifugal' }),
      node({ id: 'c', kind: 'instrument', symbolId: 'instr.bubble', tag: { letters: 'FT', loop: '100' } }),
    ]
    d.sheets.push({ ...d.sheets[0]!, id: 's2', nodes: [node({ id: 'd', symbolId: 'valve.gate' })] })
    return d
  }
  it('sums every sheet, groups by price key', () => {
    const r = projectCost(doc())
    const pumps = r.lines.find((l) => l.key === 'pump.centrifugal')!
    expect(pumps.count).toBe(2)
    expect(pumps.subtotal).toBe(2 * DEFAULT_PRICES['pump.centrifugal']!.price)
    expect(r.hardware).toBe(r.lines.reduce((s, l) => s + l.subtotal, 0))
    expect(r.unpriced).toBe(0)
  })
  it('applies the install factor to the total only', () => {
    const d = doc()
    d.budget = { currency: '$', installFactor: 3 }
    const r = projectCost(d)
    expect(r.total).toBe(r.hardware * 3)
  })
  it('every catalog category has a fallback price entry', () => {
    for (const cat of ['valves', 'rotating', 'vessels', 'heat', 'inline', 'flow-elements', 'accessories', 'safety', 'control-valves']) {
      expect(DEFAULT_PRICES[`cat.${cat}`], cat).toBeDefined()
    }
  })
})
