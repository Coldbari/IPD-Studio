import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex, neighboursOf, signalReach } from '../../src/model/projectIndex'
import type { PlantEdge, PlantNode } from '../../src/model/types'
import '../../src/symbols/lib/index'

const instrument = (id: string): PlantNode => ({
  id,
  kind: 'instrument',
  symbolId: 'instr.bubble',
  x: 0,
  y: 0,
  rotation: 0,
})

describe('project index line junctions', () => {
  it('connects devices through a shared line endpoint without a junction node', () => {
    const doc = createEmptyDoc('junction index')
    const junction = { x: 100, y: 100, junctionId: 'j1' }
    doc.sheets[0]!.nodes = [instrument('a'), instrument('b'), instrument('c')]
    doc.sheets[0]!.edges = [
      { id: 'left', lineClass: 'signal.electric', source: { nodeId: 'a', portId: 'signal' }, target: junction },
      { id: 'right', lineClass: 'signal.electric', source: junction, target: { nodeId: 'b', portId: 'signal' } },
      { id: 'branch', lineClass: 'signal.electric', source: junction, target: { nodeId: 'c', portId: 'signal' } },
    ] satisfies PlantEdge[]

    const index = buildIndex(doc)
    expect(neighboursOf(index, 'a').sort()).toEqual(['b', 'c'])
    expect([...signalReach(index, 'a', 1)].sort()).toEqual(['b', 'c'])
  })
})
