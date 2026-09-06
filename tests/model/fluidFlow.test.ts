import { describe, expect, it } from 'vitest'
import type { PlantEdge, PlantNode, SheetContent } from '../../src/model/types'
import { propagateFluid } from '../../src/model/fluidFlow'
import '../../src/symbols/lib/index'

const node = (id: string, kind: PlantNode['kind'], symbolId: string): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0 }) as PlantNode
const edge = (id: string, a: string, b: string, lineClass = 'process.major'): PlantEdge =>
  ({
    id,
    lineClass: lineClass as PlantEdge['lineClass'],
    source: { nodeId: a, portId: 'e' },
    target: { nodeId: b, portId: 'w' },
  })

const content = (nodes: PlantNode[], edges: PlantEdge[]): SheetContent => ({ nodes, edges })

describe('propagateFluid', () => {
  it('flows through valves, pumps, and junctions; stops at vessels', () => {
    // TK1 -e1- valve -e2- pump -e3- junction -e4- TK2, junction -e5- fitting -e6- HX
    const sc = content(
      [
        node('tk1', 'equipment', 'vessel.tank'),
        node('v1', 'valve', 'valve.gate'),
        node('p1', 'equipment', 'pump.centrifugal'),
        node('j1', 'fitting', 'fit.junction'),
        node('tk2', 'equipment', 'vessel.vertical'),
        node('f1', 'fitting', 'fit.reducer'),
        node('hx', 'equipment', 'hx.shell-tube'),
      ],
      [
        edge('e1', 'tk1', 'v1'),
        edge('e2', 'v1', 'p1'),
        edge('e3', 'p1', 'j1'),
        edge('e4', 'j1', 'tk2'),
        edge('e5', 'j1', 'f1'),
        edge('e6', 'f1', 'hx'),
      ],
    )
    // start mid-run: the whole connected run gets it, both directions
    expect(propagateFluid(sc, 'e2').sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
    // tanks and HX are terminals: nothing beyond them (e4/e6 still included as arriving edges)
  })

  it('does not cross a vessel onto its other nozzles', () => {
    // e1 into TK, e2 out of TK: assigning e1 must NOT color e2
    const sc = content(
      [node('a', 'fitting', 'fit.junction'), node('tk', 'equipment', 'vessel.tank'), node('b', 'fitting', 'fit.junction')],
      [edge('e1', 'a', 'tk'), edge('e2', 'tk', 'b')],
    )
    expect(propagateFluid(sc, 'e1')).toEqual(['e1'])
  })

  it('ignores signal lines and free ends', () => {
    const sc = content(
      [node('v1', 'valve', 'valve.gate'), node('i1', 'instrument', 'instr.bubble')],
      [
        { id: 'e1', lineClass: 'process.major', source: { x: 0, y: 0 }, target: { nodeId: 'v1', portId: 'w' } },
        edge('e2', 'v1', 'i1', 'signal.electric'),
      ],
    )
    expect(propagateFluid(sc, 'e1')).toEqual(['e1'])
  })

  it('flows through a shared line junction without a component node', () => {
    const junction = { x: 100, y: 100, junctionId: 'j1' }
    const sc = content(
      [node('a', 'valve', 'valve.gate'), node('b', 'valve', 'valve.gate'), node('c', 'valve', 'valve.gate')],
      [
        { id: 'left', lineClass: 'process.major', source: { nodeId: 'a', portId: 'e' }, target: junction },
        { id: 'right', lineClass: 'process.major', source: junction, target: { nodeId: 'b', portId: 'w' } },
        { id: 'branch', lineClass: 'process.major', source: junction, target: { nodeId: 'c', portId: 'w' } },
      ],
    )
    expect(propagateFluid(sc, 'branch').sort()).toEqual(['branch', 'left', 'right'])
  })
})
