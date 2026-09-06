import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { makeLink } from '../../src/canvas/shapes'
import type { PlantEdge, PlantNode } from '../../src/model/types'

const node = (id: string, symbolId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): PlantNode => ({
  id, symbolId, kind: 'instrument', x, y, rotation,
})

const edge = (partial?: Partial<PlantEdge>): PlantEdge => ({
  id: 'e1',
  lineClass: 'signal.electric',
  source: { nodeId: 'a', portId: 'e' },
  target: { nodeId: 'b', portId: 'w' },
  ...partial,
})

const routerName = (e: PlantEdge, nodes: Map<string, PlantNode>) =>
  (makeLink(e, nodes).get('router') as { name: string }).name

describe('adjacent facing ports route straight', () => {
  // Two 40px bubbles side by side, one grid square apart: a.e at (136,116),
  // b.w at (144,116) — aligned, facing, 8px apart.
  const a = node('a', 'instr.bubble', 96, 96)
  const b = node('b', 'instr.bubble', 144, 96)
  const nodes = new Map([['a', a], ['b', b]])

  it('facing aligned close ports use the normal (straight) router', () => {
    expect(routerName(edge(), nodes)).toBe('normal')
  })
  it('manhattan returns when the ports are out of line', () => {
    const shifted = new Map([['a', a], ['b', { ...b, y: 108 }]])
    expect(routerName(edge(), shifted)).toBe('manhattan')
  })
  it('manhattan returns when the ports face away from each other', () => {
    // connect a.w to b.e: ports point outward, a straight line would cut
    // through both symbols
    expect(routerName(edge({ source: { nodeId: 'a', portId: 'w' }, target: { nodeId: 'b', portId: 'e' } }), nodes)).toBe('manhattan')
  })
  it('manhattan returns for long runs where obstacle avoidance matters', () => {
    const far = new Map([['a', a], ['b', { ...b, x: 400 }]])
    expect(routerName(edge(), far)).toBe('manhattan')
  })
  it('manhattan returns once the user adds vertices', () => {
    expect(routerName(edge({ vertices: [{ x: 160, y: 80 }] }), nodes)).toBe('manhattan')
  })
  it('vertical facing pair works too', () => {
    const top = node('a', 'instr.bubble', 96, 96)
    const bottom = node('b', 'instr.bubble', 96, 160)
    const vNodes = new Map([['a', top], ['b', bottom]])
    const vEdge = edge({ source: { nodeId: 'a', portId: 's' }, target: { nodeId: 'b', portId: 'n' } })
    expect(routerName(vEdge, vNodes)).toBe('normal')
  })
  it('rotation is honored when deciding whether ports face each other', () => {
    // rotate the right bubble 180: its w port now faces right (away) — the
    // port also swings to the far side, so nothing faces and manhattan rules
    const spun = new Map([['a', a], ['b', { ...b, rotation: 180 as const }]])
    expect(routerName(edge(), spun)).toBe('manhattan')
  })

  it('point-to-point links with bends route orthogonally, never raw diagonals', () => {
    const pt = edge({ source: { x: 0, y: 0 }, target: { x: 96, y: 0 }, vertices: [{ x: 48, y: 48 }] })
    expect(routerName(pt, nodes)).toBe('manhattan')
    // still straight when the line has no bends
    const straight = edge({ source: { x: 0, y: 0 }, target: { x: 96, y: 0 } })
    expect(routerName(straight, nodes)).toBe('normal')
  })
})
