import { beforeEach, describe, expect, it } from 'vitest'
import { activeSheet, useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import type { PlantEdge } from '../../src/model/types'

/**
 * Regression tests for route-stability bugs:
 *  - editing one line (waypoints, endpoints) or adding a branch used to
 *    re-normalize EVERY line on the sheet, inserting extra bends into other
 *    lines the user never touched ("other lines gain points").
 *  - geometry edits on fixed-routed lines used to drop the routing flag and
 *    all user waypoints, letting the auto-router re-plan the line.
 */

function reset() {
  useStore.getState().loadIntoStore(createEmptyDoc('test'))
}

const sheet = () => activeSheet(useStore.getState())
const edgeOf = (id: string) => sheet().edges.find((e) => e.id === id)

/** A line the user bent diagonally off the grid axis (survives a canvas
 *  vertex commit because cleanVertices only snaps to the 8px grid). */
const diagonalEdge = (id: string): PlantEdge => ({
  id,
  lineGroupId: id,
  lineClass: 'process.major',
  source: { x: 0, y: 0 },
  target: { x: 96, y: 160 },
})

describe('route stability', () => {
  beforeEach(reset)

  it('addBatch does not rewrite other lines', () => {
    useStore.getState().addBatch([], [diagonalEdge('other')])
    // simulate a canvas vertex drag leaving a diagonal bend in the doc
    useStore.getState().setEdge('other', { vertices: [{ x: 48, y: 48 }] }, { preserveOtherEdges: true })
    const before = edgeOf('other')!

    useStore.getState().addBatch([], [{
      id: 'new', lineGroupId: 'new', lineClass: 'process.major',
      source: { x: 200, y: 0 }, target: { x: 200, y: 80 },
    }])

    const after = edgeOf('other')!
    expect(after).toBe(before)
    expect(after.vertices).toEqual([{ x: 48, y: 48 }])
  })

  it('addEdge does not rewrite other lines', () => {
    useStore.getState().addBatch([], [diagonalEdge('other')])
    useStore.getState().setEdge('other', { vertices: [{ x: 48, y: 48 }] }, { preserveOtherEdges: true })
    const before = edgeOf('other')!

    useStore.getState().addEdge({ lineClass: 'process.major', source: { x: 200, y: 0 }, target: { x: 200, y: 80 } })

    const after = edgeOf('other')!
    expect(after).toBe(before)
    expect(after.vertices).toEqual([{ x: 48, y: 48 }])
  })

  it('moving an endpoint does not rewrite other lines', () => {
    useStore.getState().addBatch([], [
      diagonalEdge('other'),
      { id: 'edited', lineGroupId: 'edited', lineClass: 'process.major', source: { x: 200, y: 0 }, target: { x: 200, y: 80 } },
    ])
    useStore.getState().setEdge('other', { vertices: [{ x: 48, y: 48 }] }, { preserveOtherEdges: true })
    const before = edgeOf('other')!

    useStore.getState().setEdge('edited', { target: { x: 240, y: 120 } })

    const after = edgeOf('other')!
    expect(after).toBe(before)
    expect(after.vertices).toEqual([{ x: 48, y: 48 }])
  })

  it('moving an endpoint of a fixed line keeps its routing and waypoints', () => {
    useStore.getState().addBatch([], [{
      id: 'line', lineGroupId: 'line', lineClass: 'process.major', routing: 'fixed',
      source: { x: 0, y: 0 }, target: { x: 192, y: 64 }, vertices: [{ x: 128, y: 0 }, { x: 128, y: 64 }],
    }])
    const before = edgeOf('line')!

    useStore.getState().setEdge('line', { target: { x: 192, y: 160 } })

    const after = edgeOf('line')!
    expect(after?.routing).toBe('fixed')
    // the endpoint moved; every stored waypoint survives untouched
    expect(after?.vertices).toEqual(before.vertices)
    expect(after?.target).toEqual({ x: 192, y: 160 })
  })

  it('save/load round-trip keeps routes byte-identical (no corner re-insertion)', () => {
    useStore.getState().addBatch([], [
      { id: 'line', lineGroupId: 'line', lineClass: 'process.major', source: { x: 80, y: 400 }, target: { x: 320, y: 400 } },
    ])
    // a diagonal bend, exactly what a canvas vertex edit can leave stored
    useStore.getState().setEdge('line', { vertices: [{ x: 200, y: 320 }] }, { preserveOtherEdges: true })
    const json = JSON.stringify(useStore.getState().doc)

    useStore.getState().loadIntoStore(JSON.parse(json))

    expect(edgeOf('line')?.vertices).toEqual([{ x: 200, y: 320 }])
  })

  it('points deleted before saving stay deleted after reopening', () => {
    useStore.getState().addBatch([], [
      { id: 'line', lineGroupId: 'line', lineClass: 'process.major', source: { x: 80, y: 400 }, target: { x: 320, y: 400 } },
    ])
    useStore.getState().setEdge('line', { vertices: [{ x: 200, y: 320 }] }, { preserveOtherEdges: true })
    useStore.getState().setEdgeVertices('line', [])
    const json = JSON.stringify(useStore.getState().doc)

    useStore.getState().loadIntoStore(JSON.parse(json))

    expect(edgeOf('line')?.vertices ?? []).toEqual([])
  })

  it('editing waypoints of a fixed line keeps it fixed (no auto-routing)', () => {
    useStore.getState().addBatch([], [{
      id: 'line', lineGroupId: 'line', lineClass: 'process.major', routing: 'fixed',
      source: { x: 0, y: 0 }, target: { x: 192, y: 64 }, vertices: [{ x: 128, y: 0 }, { x: 128, y: 64 }],
    }])

    useStore.getState().setEdgeVertices('line', [{ x: 128, y: 16 }, { x: 128, y: 80 }])

    const after = edgeOf('line')!
    expect(after?.routing).toBe('fixed')
    expect(after?.vertices).toEqual([{ x: 128, y: 16 }, { x: 128, y: 80 }])
  })

  it('moving a node keeps waypoints of fixed lines attached to it', () => {
    useStore.getState().addBatch([
      { id: 'a', symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 },
    ], [{
      id: 'line', lineGroupId: 'line', lineClass: 'process.major', routing: 'fixed',
      source: { nodeId: 'a', portId: 'out' }, target: { x: 192, y: 32 }, vertices: [{ x: 96, y: 64 }],
    }])
    const before = edgeOf('line')!

    useStore.getState().setNodePos('a', 16, 16)

    const after = edgeOf('line')!
    expect(after).toBe(before)
    expect(after?.routing).toBe('fixed')
    expect(after?.vertices).toEqual(before.vertices)
  })
})
