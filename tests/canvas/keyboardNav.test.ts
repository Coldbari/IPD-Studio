// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { describeCell, describeSelection, navOrder } from '../../src/canvas/keyboardNav'
import { createEmptyDoc } from '../../src/model/doc'
import type { PlantEdge, PlantNode, Sheet } from '../../src/model/types'
import '../../src/symbols/lib/index'

function sheetOf(nodes: PlantNode[], edges: PlantEdge[] = []): Sheet {
  return { ...createEmptyDoc().sheets[0]!, nodes, edges }
}

const node = (id: string, x: number, y: number, extra: Partial<PlantNode> = {}): PlantNode => ({
  id, symbolId: 'vessel.tank', kind: 'equipment', x, y, rotation: 0, ...extra,
})

describe('the order Tab walks a drawing', () => {
  it('reads top to bottom, then left to right', () => {
    const s = sheetOf([
      node('c', 400, 400),
      node('a', 100, 100),
      node('b', 300, 100),
    ])
    expect(navOrder(s)).toEqual(['a', 'b', 'c'])
  })

  it('treats a row of symbols as a row even when they are a few px apart', () => {
    // Symbols on one run of pipe are rarely on the same pixel. A strict y-sort
    // would walk them in an order that looks arbitrary on screen; banding by a
    // grid square makes the row read left to right the way it looks.
    const s = sheetOf([
      node('right', 400, 104),
      node('left', 100, 100),
      node('mid', 250, 96),
    ])
    expect(navOrder(s)).toEqual(['left', 'mid', 'right'])
  })

  it('is stable for two objects at exactly the same point', () => {
    const s = sheetOf([node('b', 10, 10), node('a', 10, 10)])
    expect(navOrder(s)).toEqual(navOrder(s))
    expect(navOrder(s)).toEqual(['a', 'b'])
  })

  it('includes lines, placed at the end they start from', () => {
    const nodes = [node('n1', 100, 400), node('n2', 500, 400)]
    const edge: PlantEdge = {
      id: 'e1', lineClass: 'process.major',
      source: { nodeId: 'n1', portId: 'e' }, target: { nodeId: 'n2', portId: 'w' },
    }
    const order = navOrder(sheetOf(nodes, [edge]))
    expect(order).toHaveLength(3)
    expect(order).toContain('e1')
  })

  it('survives a line whose source node is gone', () => {
    const edge: PlantEdge = {
      id: 'orphan', lineClass: 'process.major',
      source: { nodeId: 'missing', portId: 'e' }, target: { x: 10, y: 10 },
    }
    expect(() => navOrder(sheetOf([], [edge]))).not.toThrow()
    expect(navOrder(sheetOf([], [edge]))).toEqual(['orphan'])
  })

  it('handles an empty sheet', () => {
    expect(navOrder(sheetOf([]))).toEqual([])
  })
})

describe('what a screen reader is told', () => {
  it('leads with the tag, because that is what an engineer calls it', () => {
    const s = sheetOf([node('a', 0, 0, { tag: { letters: 'FIC', loop: '101' }, label: 'Feed control' })])
    expect(describeCell(s, 'a')).toMatch(/^FIC-101/)
  })

  it('falls back to the label, then to the catalogue name', () => {
    expect(describeCell(sheetOf([node('a', 0, 0, { label: 'Feed tank' })]), 'a')).toMatch(/^Feed tank/)
    expect(describeCell(sheetOf([node('a', 0, 0)]), 'a')).toMatch(/Tank/i)
  })

  it('mentions rotation, which is invisible to someone who cannot see it', () => {
    expect(describeCell(sheetOf([node('a', 0, 0, { rotation: 90 })]), 'a')).toMatch(/rotated 90/)
    expect(describeCell(sheetOf([node('a', 0, 0)]), 'a')).not.toMatch(/rotated/)
  })

  it('names a line by its class, and by its line number when it has one', () => {
    const e: PlantEdge = {
      id: 'e1', lineClass: 'process.major', source: { x: 0, y: 0 }, target: { x: 8, y: 0 },
      lineNumber: { size: '2"', spec: 'CS150', service: 'FW', seq: '001' },
    }
    const said = describeCell(sheetOf([], [e]), 'e1')
    expect(said).toMatch(/line/i)
    expect(said).toContain('2"')
    expect(said).toContain('FW')
  })

  it('says where in the drawing you are, so Tab is not a walk in the dark', () => {
    const s = sheetOf([node('a', 100, 100), node('b', 300, 100), node('c', 100, 400)])
    expect(describeSelection(s, ['b'])).toMatch(/2 of 3/)
    expect(describeSelection(s, ['c'])).toMatch(/3 of 3/)
  })

  it('counts a multi-selection rather than reading it out', () => {
    const s = sheetOf([node('a', 0, 0), node('b', 8, 0), node('c', 16, 0)])
    expect(describeSelection(s, ['a', 'b', 'c'])).toBe('3 objects selected')
  })

  it('says so when nothing is selected', () => {
    expect(describeSelection(sheetOf([]), [])).toBe('Nothing selected')
  })

  it('does not throw on a symbol the catalogue no longer has', () => {
    const s = sheetOf([node('a', 0, 0, { symbolId: 'gone.missing' })])
    expect(() => describeCell(s, 'a')).not.toThrow()
    expect(describeCell(s, 'a')).toBeTruthy()
  })
})

describe('ordering cost', () => {
  it('stays linearithmic at a thousand objects', () => {
    // The first version looked positions up inside the comparator, which is a
    // linear scan per comparison — O(n² log n), or millions of array walks for
    // one Tab press. This guards the shape, not the machine.
    const nodes = Array.from({ length: 1000 }, (_, i) =>
      node(`n${i}`, (i % 40) * 64, Math.floor(i / 40) * 64))
    const started = performance.now()
    const order = navOrder(sheetOf(nodes))
    const took = performance.now() - started
    expect(order).toHaveLength(1000)
    expect(took).toBeLessThan(100)
  })
})
