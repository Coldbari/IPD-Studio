import { beforeEach, describe, expect, it } from 'vitest'
import { activeSheet, useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

function reset() {
  useStore.getState().loadIntoStore(createEmptyDoc('test'))
}

function addPump(x = 0, y = 0): string {
  return useStore.getState().addNode({
    symbolId: 'pump.centrifugal', kind: 'equipment', x, y, rotation: 0,
  })
}

describe('store', () => {
  beforeEach(reset)

  it('addNode returns id and appends node, marking dirty', () => {
    const id = addPump(8, 16)
    const s = useStore.getState()
    expect(activeSheet(s).nodes).toHaveLength(1)
    expect(activeSheet(s).nodes[0]!.id).toBe(id)
    expect(s.dirty).toBe(true)
  })

  it('setNodePos and moveNodes update positions', () => {
    const id = addPump(0, 0)
    useStore.getState().setNodePos(id, 24, 32)
    expect(activeSheet(useStore.getState()).nodes[0]).toMatchObject({ x: 24, y: 32 })
    useStore.getState().moveNodes([id], 8, -8)
    expect(activeSheet(useStore.getState()).nodes[0]).toMatchObject({ x: 32, y: 24 })
  })

  it('rotateNode cycles through quadrants', () => {
    const id = addPump()
    const s = useStore.getState()
    s.rotateNode(id); s.rotateNode(id); s.rotateNode(id); s.rotateNode(id)
    expect(activeSheet(useStore.getState()).nodes[0]!.rotation).toBe(0)
    useStore.getState().rotateNode(id)
    expect(activeSheet(useStore.getState()).nodes[0]!.rotation).toBe(90)
  })

  it('deleteIds cascades attached edges', () => {
    const a = addPump(0, 0)
    const b = addPump(100, 0)
    const e = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: a, portId: 'out' },
      target: { nodeId: b, portId: 'in' },
    })
    expect(activeSheet(useStore.getState()).edges).toHaveLength(1)
    useStore.getState().deleteIds([a])
    const s = useStore.getState()
    expect(activeSheet(s).nodes).toHaveLength(1)
    expect(activeSheet(s).edges).toHaveLength(0)
    expect(activeSheet(s).edges.find((x) => x.id === e)).toBeUndefined()
  })

  it('deleteSelected deletes the selection and clears it', () => {
    const a = addPump()
    useStore.getState().setSelection([a])
    useStore.getState().deleteSelected()
    const s = useStore.getState()
    expect(activeSheet(s).nodes).toHaveLength(0)
    expect(s.selection).toEqual([])
  })

  it('pasteNodes remaps ids/edges, offsets +16, strips tags', () => {
    const a = addPump(0, 0)
    const b = addPump(100, 0)
    useStore.getState().setTag(a, { letters: 'FT', loop: '100' })
    useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: a, portId: 'out' },
      target: { nodeId: b, portId: 'in' },
    })
    const sheet = activeSheet(useStore.getState())
    useStore.getState().pasteNodes(sheet.nodes, sheet.edges)
    const s = useStore.getState()
    expect(activeSheet(s).nodes).toHaveLength(4)
    expect(activeSheet(s).edges).toHaveLength(2)
    const pasted = activeSheet(s).nodes.slice(2)
    expect(pasted[0]!.id).not.toBe(a)
    expect(pasted[0]!.x).toBe(16)
    expect(pasted[0]!.tag).toBeUndefined()
    const pastedEdge = activeSheet(s).edges[1]!
    expect('nodeId' in pastedEdge.source && pastedEdge.source.nodeId).toBe(pasted[0]!.id)
    expect(s.selection).toEqual(pasted.map((p) => p.id))
  })

  it('pasteNodes remaps shared line junction ids away from the original', () => {
    const a = addPump(0, 0)
    const b = addPump(100, 0)
    const junction = { x: 50, y: 20, junctionId: 'original-junction' }
    const sheet = activeSheet(useStore.getState())
    useStore.getState().pasteNodes(
      sheet.nodes,
      [
        { id: 'left', lineClass: 'process.major', source: { nodeId: a, portId: 'out' }, target: junction },
        { id: 'right', lineClass: 'process.major', source: junction, target: { nodeId: b, portId: 'in' } },
      ],
    )
    const copied = activeSheet(useStore.getState()).edges
    const ids = copied.flatMap((edge) => [edge.source, edge.target])
      .flatMap((end) => 'junctionId' in end && end.junctionId ? [end.junctionId] : [])
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).not.toBe('original-junction')
  })

  it('edits one persisted section without changing adjacent sections', () => {
    const a = addPump(0, 0)
    const b = addPump(200, 0)
    const junction = { x: 100, y: 20, junctionId: 'line-junction' }
    useStore.getState().addBatch([], [
      { id: 'left', lineGroupId: 'main', lineClass: 'process.major', source: { nodeId: a, portId: 'out' }, target: junction },
      { id: 'right', lineGroupId: 'main', lineClass: 'process.major', source: junction, target: { nodeId: b, portId: 'in' } },
      { id: 'branch', lineGroupId: 'branch', lineClass: 'process.major', source: junction, target: { x: 100, y: 160 } },
    ])
    useStore.getState().setEdge('right', { arrow: 'flow', lineClass: 'process.minor' })
    const edges = activeSheet(useStore.getState()).edges
    expect(edges.find((edge) => edge.id === 'right')?.lineClass).toBe('process.minor')
    expect(edges.find((edge) => edge.id === 'left')?.lineClass).toBe('process.major')
    expect(edges.find((edge) => edge.id === 'branch')?.lineClass).toBe('process.major')
    expect(edges.find((edge) => edge.id === 'right')?.arrow).toBe('flow')
    expect(edges.filter((edge) => edge.arrow === 'flow')).toHaveLength(1)
  })

  it('keeps untouched fixed routes stable during a free-end vertex edit', () => {
    const untouched = {
      id: 'untouched-fixed',
      lineGroupId: 'untouched-fixed',
      lineClass: 'process.major' as const,
      routing: 'fixed' as const,
      source: { x: 64, y: 64 },
      target: { x: 192, y: 64 },
      vertices: [{ x: 128, y: 64 }],
    }
    useStore.getState().addBatch([], [
      {
        id: 'edited-free',
        lineGroupId: 'edited-free',
        lineClass: 'process.major',
        source: { x: 32, y: 160, pendingTag: 'L-101' },
        target: { x: 224, y: 160 },
        vertices: [{ x: 128, y: 160 }],
      },
      untouched,
    ])
    const before = activeSheet(useStore.getState()).edges.find((edge) => edge.id === untouched.id)!
    useStore.getState().setEdge('edited-free', {
      source: { x: 40, y: 168, pendingTag: 'L-101' },
      vertices: [{ x: 128, y: 168 }],
    }, { preserveOtherEdges: true })
    const after = activeSheet(useStore.getState()).edges
    expect(after.find((edge) => edge.id === untouched.id)).toBe(before)
    expect(after.find((edge) => edge.id === untouched.id)).toEqual(untouched)
  })

  it('toggles the flow arrow on the selected section', () => {
    const a = addPump(0, 0)
    const b = addPump(200, 0)
    const junction = { x: 100, y: 20, junctionId: 'cycle-junction' }
    useStore.getState().addBatch([], [
      { id: 'left', lineGroupId: 'main', lineClass: 'process.major', source: { nodeId: a, portId: 'out' }, target: junction },
      { id: 'right', lineGroupId: 'main', lineClass: 'process.major', source: junction, target: { nodeId: b, portId: 'in' } },
      { id: 'branch', lineGroupId: 'branch', lineClass: 'process.major', source: junction, target: { x: 100, y: 160 } },
    ])
    const positions = () => activeSheet(useStore.getState()).edges.filter((edge) => edge.arrow === 'flow').map((edge) => edge.id)
    expect(positions()).toEqual([])
    useStore.getState().cycleEdgeArrow('left')
    expect(positions()).toEqual(['left'])
    useStore.getState().cycleEdgeArrow('left')
    expect(positions()).toEqual([])
    useStore.getState().cycleEdgeArrow('left')
    expect(positions()).toEqual(['left'])
  })

  it('toggles and reverses one line section', () => {
    const a = addPump(0, 0)
    const b = addPump(200, 0)
    const junction = { x: 100, y: 20, junctionId: 'reverse-junction' }
    useStore.getState().addBatch([], [
      { id: 'left', lineGroupId: 'main', lineClass: 'process.major', source: { nodeId: a, portId: 'out' }, target: junction, vertices: [{ x: 40, y: 20 }] },
      { id: 'right', lineGroupId: 'main', lineClass: 'process.major', source: junction, target: { nodeId: b, portId: 'in' }, vertices: [{ x: 160, y: 20 }] },
      { id: 'branch', lineGroupId: 'branch', lineClass: 'process.major', source: junction, target: { x: 100, y: 160 }, vertices: [{ x: 120, y: 20 }] },
    ])
    useStore.getState().setEdge('branch', { arrow: 'flow' })
    expect(activeSheet(useStore.getState()).edges.filter((edge) => edge.arrow === 'flow').map((edge) => edge.id)).toEqual(['branch'])
    useStore.getState().setEdge('branch', { arrow: 'none' })
    expect(activeSheet(useStore.getState()).edges.some((edge) => edge.arrow === 'flow')).toBe(false)
    useStore.getState().reverseEdgeDirection('right')
    const edges = activeSheet(useStore.getState()).edges
    expect(edges.find((edge) => edge.id === 'right')?.source).toEqual({ nodeId: b, portId: 'in' })
    expect(edges.find((edge) => edge.id === 'right')?.target).toEqual(junction)
    expect(edges.find((edge) => edge.id === 'right')?.vertices).toEqual([{ x: 160, y: 20 }])
  })

  it('keeps a branch selection independent from the original line', () => {
    const a = addPump(0, 0)
    const b = addPump(200, 0)
    const junction = { x: 100, y: 20, junctionId: 'selection-junction' }
    useStore.getState().addBatch([], [
      { id: 'left', lineGroupId: 'main', lineClass: 'process.major', source: { nodeId: a, portId: 'out' }, target: junction },
      { id: 'right', lineGroupId: 'main', lineClass: 'process.major', source: junction, target: { nodeId: b, portId: 'in' } },
      { id: 'branch', lineGroupId: 'branch', lineClass: 'process.major', source: junction, target: { x: 100, y: 160 } },
    ])
    useStore.getState().setSelection(['branch'])
    expect(useStore.getState().selection).toEqual(['branch'])
    useStore.getState().setSelection(['right'])
    expect(useStore.getState().selection).toEqual(['right'])
  })

  it('undo/redo replay doc changes but not selection', () => {
    const a = addPump()
    useStore.getState().setSelection([a])
    useStore.getState().undo()
    expect(activeSheet(useStore.getState()).nodes).toHaveLength(0)
    useStore.getState().redo()
    expect(activeSheet(useStore.getState()).nodes).toHaveLength(1)
  })

  it('auto layout is one undoable edit and leaves other sheets untouched', async () => {
    const a = addPump(300, 220)
    const b = addPump(304, 224)
    useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: a, portId: 'out' },
      target: { nodeId: b, portId: 'in' },
      vertices: [{ x: 310, y: 230 }],
    })
    const before = structuredClone(activeSheet(useStore.getState()))
    const otherSheetId = useStore.getState().addSheet()
    const otherNode = addPump(777, 333)
    useStore.getState().setActiveSheet(before.id)

    const arranged = activeSheet(useStore.getState())
    expect(arranged.nodes[0]!.x).toBeLessThan(arranged.nodes[1]!.x)
    expect(arranged.edges[0]!.vertices?.length ?? 0).toBeLessThanOrEqual(2)
    expect(useStore.getState().doc.sheets.find((candidate) => candidate.id === otherSheetId)!.nodes[0])
      .toMatchObject({ id: otherNode, x: 777, y: 333 })

    useStore.getState().undo()
    expect(activeSheet(useStore.getState()).nodes).toEqual(before.nodes)
    expect(activeSheet(useStore.getState()).edges).toEqual(before.edges)
  })

  it('loadIntoStore clears history and dirty', () => {
    addPump()
    useStore.getState().loadIntoStore(createEmptyDoc('fresh'))
    const s = useStore.getState()
    expect(s.doc.meta.name).toBe('fresh')
    expect(s.dirty).toBe(false)
    s.undo()
    expect(useStore.getState().doc.meta.name).toBe('fresh')
  })
})

describe('multi-sheet', () => {
  beforeEach(reset)

  it('addSheet appends, switches, and scopes actions to the new sheet', () => {
    const s = useStore.getState()
    const firstSheetId = s.activeSheetId
    const id2 = s.addSheet()
    expect(useStore.getState().activeSheetId).toBe(id2)
    addPump()
    const state = useStore.getState()
    expect(activeSheet(state).nodes).toHaveLength(1)
    expect(state.doc.sheets.find((sh) => sh.id === firstSheetId)!.nodes).toHaveLength(0)
  })

  it('deleteSheet refuses the last sheet and reactivates the first', () => {
    const s = useStore.getState()
    s.deleteSheet(s.activeSheetId)
    expect(useStore.getState().doc.sheets).toHaveLength(1)
    const id2 = useStore.getState().addSheet()
    useStore.getState().deleteSheet(id2)
    const state = useStore.getState()
    expect(state.doc.sheets).toHaveLength(1)
    expect(state.activeSheetId).toBe(state.doc.sheets[0]!.id)
  })

  it('renameSheet and setSheetMeta update the right sheet', () => {
    const s = useStore.getState()
    s.renameSheet(s.activeSheetId, 'Overview')
    useStore.getState().setSheetMeta({ drawingNumber: 'PID-7' })
    const sheet = activeSheet(useStore.getState())
    expect(sheet.name).toBe('Overview')
    expect(sheet.drawingNumber).toBe('PID-7')
  })

  it('setNodeLink pairs off-page connectors', () => {
    const s = useStore.getState()
    const a = s.addNode({ symbolId: 'ann.offpage', kind: 'annotation', x: 0, y: 0, rotation: 0 })
    const sheet2 = useStore.getState().addSheet()
    const b = useStore.getState().addNode({ symbolId: 'ann.offpage', kind: 'annotation', x: 0, y: 0, rotation: 0 })
    useStore.getState().setActiveSheet(useStore.getState().doc.sheets[0]!.id)
    useStore.getState().setNodeLink(a, { sheetId: sheet2, nodeId: b })
    expect(activeSheet(useStore.getState()).nodes[0]!.link).toEqual({ sheetId: sheet2, nodeId: b })
  })
})
