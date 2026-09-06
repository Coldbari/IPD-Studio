import { beforeEach, describe, expect, it } from 'vitest'
import { activeSheet, useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import '../../src/symbols/lib/index'

const st = () => useStore.getState()
const sheet = () => activeSheet(st())

describe('fluid services in the store', () => {
  beforeEach(() => {
    st().loadIntoStore(createEmptyDoc())
  })

  it('new docs carry the starter fluid set', () => {
    expect((st().doc.fluids ?? []).map((f) => f.name)).toContain('Water')
  })

  it('assigning a fluid stays on the selected line section', () => {
    const a = st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    const v = st().addNode({ symbolId: 'valve.gate', kind: 'valve', x: 200, y: 40, rotation: 0 })
    const e1 = st().addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: v, portId: 'w' } })
    const e2 = st().addEdge({ lineClass: 'process.major', source: { nodeId: v, portId: 'e' }, target: { x: 400, y: 48 } })
    const water = (st().doc.fluids ?? []).find((f) => f.name === 'Water')!

    st().setEdgeFluid(e1, water.id)
    expect(sheet().edges.find((e) => e.id === e1)?.fluidId).toBe(water.id)
    expect(sheet().edges.find((e) => e.id === e2)?.fluidId).toBeUndefined()

    st().undo()
    expect(sheet().edges.find((e) => e.id === e1)?.fluidId).toBeUndefined()
    expect(sheet().edges.find((e) => e.id === e2)?.fluidId).toBeUndefined()
  })

  it('removing a fluid clears it from lines', () => {
    const v = st().addNode({ symbolId: 'valve.gate', kind: 'valve', x: 200, y: 40, rotation: 0 })
    const e1 = st().addEdge({ lineClass: 'process.major', source: { x: 0, y: 48 }, target: { nodeId: v, portId: 'w' } })
    const id = st().addFluid('Brine', '#00838f')
    st().setEdgeFluid(e1, id)
    expect(sheet().edges.find((e) => e.id === e1)?.fluidId).toBe(id)
    st().removeFluid(id)
    expect((st().doc.fluids ?? []).some((f) => f.id === id)).toBe(false)
    expect(sheet().edges.find((e) => e.id === e1)?.fluidId).toBeUndefined()
  })
})
