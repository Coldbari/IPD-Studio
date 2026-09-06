import { beforeEach, describe, expect, it } from 'vitest'
import { activeSheet, useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import type { PlantEdge, PlantNode } from '../../src/model/types'
import '../../src/symbols/lib/index'

const st = () => useStore.getState()
const sheet = () => activeSheet(st())

const node = (id: string, x: number, y: number): PlantNode =>
  ({ id, kind: 'equipment', symbolId: 'pump.centrifugal', x, y, rotation: 0 }) as PlantNode

const edge = (id: string, over: Partial<PlantEdge>): PlantEdge =>
  ({ id, lineClass: 'process-major', source: { nodeId: 'a', portId: 'e' }, target: { nodeId: 'b', portId: 'w' }, ...over }) as PlantEdge

/**
 * Marquee-selecting a drawing and dragging it used to move the symbols and
 * leave every routed line behind, because moveNodes only touched nodes.
 */
describe('moveNodes carries the lines with the symbols', () => {
  beforeEach(() => {
    st().loadIntoStore(createEmptyDoc())
  })

  const seed = (edges: PlantEdge[], nodes = [node('a', 100, 100), node('b', 300, 100), node('c', 500, 100)]) => {
    const d = st().doc
    d.sheets[0]!.nodes = nodes
    d.sheets[0]!.edges = edges
    st().loadIntoStore({ ...d })
  }

  it('translates the waypoints of a line whose both ends move', () => {
    seed([edge('e1', { vertices: [{ x: 200, y: 40 }, { x: 250, y: 40 }] })])
    st().moveNodes(['a', 'b'], 40, -25)
    expect(sheet().nodes.find((n) => n.id === 'a')).toMatchObject({ x: 140, y: 75 })
    expect(sheet().edges[0]!.vertices).toEqual([{ x: 240, y: 15 }, { x: 290, y: 15 }])
  })

  it('leaves the waypoints alone when only one end moves — that line is stretching', () => {
    seed([edge('e1', { vertices: [{ x: 200, y: 40 }] })])
    st().moveNodes(['a'], 40, -25)
    expect(sheet().edges[0]!.vertices).toEqual([{ x: 200, y: 40 }])
  })

  it('carries a free end, which no selection can contain', () => {
    seed([edge('e1', { source: { nodeId: 'a', portId: 'e' }, target: { x: 600, y: 220 }, vertices: [{ x: 400, y: 220 }] })])
    st().moveNodes(['a'], 10, 10)
    expect(sheet().edges[0]!.target).toEqual({ x: 610, y: 230 })
    expect(sheet().edges[0]!.vertices).toEqual([{ x: 410, y: 230 }])
  })

  it('moves every limb of a shared line junction as one rigid group', () => {
    const junction = { x: 260, y: 140, junctionId: 'j1' }
    seed([
      edge('left', { source: { nodeId: 'a', portId: 'e' }, target: junction }),
      edge('right', { source: junction, target: { nodeId: 'b', portId: 'w' } }),
      edge('branch', { source: junction, target: { nodeId: 'c', portId: 'w' } }),
    ])
    st().moveNodes(['a', 'b', 'c'], 32, 24)
    const ends = sheet().edges.flatMap((e) => [e.source, e.target])
      .filter((end): end is { x: number; y: number; junctionId: string } => 'junctionId' in end)
    expect(ends).toHaveLength(3)
    expect(ends.every((end) => end.x === 292 && end.y === 164)).toBe(true)
  })

  it('a fully free-floating line is left alone', () => {
    seed([edge('e1', { source: { x: 10, y: 10 }, target: { x: 20, y: 20 } })])
    st().moveNodes(['a', 'b'], 50, 50)
    expect(sheet().edges[0]!.source).toEqual({ x: 10, y: 10 })
    expect(sheet().edges[0]!.target).toEqual({ x: 20, y: 20 })
  })

  it('select-all keeps the drawing rigid: every relative offset survives', () => {
    seed([
      edge('e1', { vertices: [{ x: 200, y: 40 }] }),
      edge('e2', { source: { nodeId: 'b', portId: 'e' }, target: { nodeId: 'c', portId: 'w' }, vertices: [{ x: 400, y: 160 }] }),
    ])
    const before = sheet()
    const geom = (s = sheet()) => [
      ...s.nodes.map((n) => [n.x, n.y]),
      ...s.edges.flatMap((e) => (e.vertices ?? []).map((v) => [v.x, v.y])),
    ]
    const origin = geom(before)
    st().moveNodes(['a', 'b', 'c'], 120, 70)
    expect(geom()).toEqual(origin.map(([x, y]) => [x! + 120, y! + 70]))
  })

  it('is one undo step, geometry included', () => {
    seed([edge('e1', { vertices: [{ x: 200, y: 40 }] })])
    st().moveNodes(['a', 'b'], 40, -25)
    st().undo()
    expect(sheet().nodes.find((n) => n.id === 'a')).toMatchObject({ x: 100, y: 100 })
    expect(sheet().edges[0]!.vertices).toEqual([{ x: 200, y: 40 }])
  })
})
