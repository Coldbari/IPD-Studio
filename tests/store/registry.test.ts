import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

function fresh() {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  return useStore.getState()
}
const doc = () => useStore.getState().doc
const nodes = () => doc().sheets[0]!.nodes

beforeEach(() => { fresh() })

describe('a record follows its object', () => {
  it('survives a rename', () => {
    const s = fresh()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'FT', loop: '101' })
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', '0-100 m3/h')

    useStore.getState().setTag(id, { letters: 'FT', loop: '102' })

    expect(doc().registry?.['FT-102']?.fields['signal.range']).toBe('0-100 m3/h')
    expect(doc().registry?.['FT-101']).toBeUndefined()
  })

  // The bug tag-keying exists to prevent: node ids do not survive a redraw.
  it('survives delete-and-redraw of the symbol', () => {
    const s = fresh()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'PT', loop: '200' })
    useStore.getState().setRecordField('PT-200', 'instrument', 'signal.range', '0-10 bar')

    useStore.getState().deleteIds([id])
    expect(nodes()).toHaveLength(0)
    // the record is deliberately still there
    expect(doc().registry?.['PT-200']?.fields['signal.range']).toBe('0-10 bar')

    const again = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 9, y: 9, rotation: 0 })
    useStore.getState().setTag(again, { letters: 'PT', loop: '200' })
    expect(doc().registry?.['PT-200']?.fields['signal.range']).toBe('0-10 bar')
  })

  it('refuses to merge two records when a rename collides', () => {
    const s = fresh()
    const a = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const b = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 40, y: 0, rotation: 0 })
    useStore.getState().setTag(a, { letters: 'FT', loop: '101' })
    useStore.getState().setTag(b, { letters: 'FT', loop: '102' })
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', 'A')
    useStore.getState().setRecordField('FT-102', 'instrument', 'signal.range', 'B')

    useStore.getState().setTag(a, { letters: 'FT', loop: '102' })

    expect(doc().registry?.['FT-101']?.fields['signal.range']).toBe('A')
    expect(doc().registry?.['FT-102']?.fields['signal.range']).toBe('B')
  })

  it('carries a line record across a renumber', () => {
    const s = fresh()
    const id = s.addEdge({
      lineClass: 'process.major',
      source: { x: 0, y: 0 },
      target: { x: 50, y: 0 },
      lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '001' },
    })
    useStore.getState().setRecordField('6"-CS-CW-001', 'line', 'spec.material', 'CS')
    useStore.getState().setEdge(id, { lineNumber: { size: '8"', spec: 'CS', service: 'CW', seq: '001' } })
    expect(doc().registry?.['8"-CS-CW-001']?.fields['spec.material']).toBe('CS')
    expect(doc().registry?.['6"-CS-CW-001']).toBeUndefined()
  })

  it('does not copy a record onto a pasted symbol', () => {
    const s = fresh()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'FT', loop: '101' })
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', '0-100')

    const original = nodes()[0]!
    useStore.getState().pasteNodes([original], [])
    // a pasted symbol arrives untagged, so it is a new object needing its own spec
    expect(nodes()).toHaveLength(2)
    expect(nodes()[1]!.tag).toBeUndefined()
    expect(Object.keys(doc().registry ?? {})).toEqual(['FT-101'])
  })
})

describe('pending line endpoints', () => {
  it('closes a free endpoint when a matching tagged device is added', () => {
    const s = fresh()
    const source = s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 0, y: 0, rotation: 0 })
    const edgeId = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: source, portId: 'e' },
      target: { x: 80, y: 8, pendingTag: 'TK-101' },
      lineNumber: { size: '2"', spec: 'CS', service: 'FW', seq: '001' },
    })
    const device = useStore.getState().addNode({ symbolId: 'valve.gate', kind: 'valve', x: 80, y: 0, rotation: 0 })
    useStore.getState().setTag(device, { letters: 'TK', loop: '101' })
    const edge = useStore.getState().doc.sheets[0]!.edges.find((e) => e.id === edgeId)!
    expect(edge.target).toEqual({ nodeId: device, portId: 'w' })
    expect(edge.lineNumber?.service).toBe('FW')
  })

  it('matches the tag whatever the loop-number zeros look like on either side', () => {
    const s = fresh()
    const vessel = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 400, y: 300, rotation: 0 })
    useStore.getState().setTag(vessel, { letters: 'V', loop: '01' })
    const edgeId = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: vessel, portId: 'w1' },
      // typed by hand with the leading zero; the device is later tagged X-1
      target: { x: 300, y: 308, pendingTag: 'X01' },
    })
    const device = useStore.getState().addNode({ symbolId: 'valve.gate', kind: 'valve', x: 240, y: 300, rotation: 0 })
    useStore.getState().setTag(device, { letters: 'X', loop: '1' })
    const edge = useStore.getState().doc.sheets[0]!.edges.find((e) => e.id === edgeId)!
    expect(edge.target).toEqual({ nodeId: device, portId: 'e' })
  })

  it('resolves for a device that only carries a label, when the label is set', () => {
    const s = fresh()
    const vessel = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 400, y: 300, rotation: 0 })
    useStore.getState().setTag(vessel, { letters: 'V', loop: '01' })
    const edgeId = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: vessel, portId: 'w1' },
      target: { x: 300, y: 308, pendingTag: 'X01' },
    })
    const device = useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 300, y: 280, rotation: 0 })
    useStore.getState().setLabel(device, 'X01')
    const edge = useStore.getState().doc.sheets[0]!.edges.find((e) => e.id === edgeId)!
    expect(isPortEndTarget(edge)).toBe(true)
  })

  it('prefers the nozzle that faces back along the line, not the nearest port', () => {
    const s = fresh()
    // V01 sits east of the free end; the pipe runs west from its w1 nozzle.
    const vessel = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 400, y: 300, rotation: 0 })
    useStore.getState().setTag(vessel, { letters: 'V', loop: '01' })
    const edgeId = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: vessel, portId: 'w1' },
      target: { x: 300, y: 308, pendingTag: 'X01' },
    })
    // The pump lands with its suction right ON the free end — the old
    // nearest-port rule would grab the suction. The discharge faces the
    // vessel, so the line must land there instead.
    const pump = useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 300, y: 280, rotation: 0 })
    useStore.getState().setTag(pump, { letters: 'X', loop: '01' })
    const edge = useStore.getState().doc.sheets[0]!.edges.find((e) => e.id === edgeId)!
    expect(edge.target).toEqual({ nodeId: pump, portId: 'discharge' })
  })

  it('serves two pending lines on one device with the two facing nozzles', () => {
    const s = fresh()
    const upstream = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 100, y: 300, rotation: 0 })
    useStore.getState().setTag(upstream, { letters: 'U', loop: '01' })
    const downstream = s.addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 400, y: 300, rotation: 0 })
    useStore.getState().setTag(downstream, { letters: 'V', loop: '01' })
    const inId = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: upstream, portId: 'e1' },
      target: { x: 220, y: 300, pendingTag: 'X01' },
    })
    const outId = useStore.getState().addEdge({
      lineClass: 'process.major',
      source: { nodeId: downstream, portId: 'w1' },
      target: { x: 320, y: 300, pendingTag: 'X01' },
    })
    const pump = useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 260, y: 280, rotation: 0 })
    useStore.getState().setTag(pump, { letters: 'X', loop: '01' })
    const edges = useStore.getState().doc.sheets[0]!.edges
    expect(edges.find((e) => e.id === inId)!.target).toEqual({ nodeId: pump, portId: 'suction' })
    expect(edges.find((e) => e.id === outId)!.target).toEqual({ nodeId: pump, portId: 'discharge' })
  })
})

function isPortEndTarget(edge: { target: unknown }): boolean {
  const t = edge.target as { nodeId?: string }
  return typeof t.nodeId === 'string'
}

describe('sheet copies', () => {
  it('clones nodes and remaps connected edge endpoints', () => {
    const s = fresh()
    const source = s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 0, y: 0, rotation: 0 })
    const target = s.addNode({ symbolId: 'valve.gate', kind: 'valve', x: 80, y: 0, rotation: 0 })
    const edge = s.addEdge({
      lineClass: 'process.major',
      source: { nodeId: source, portId: 'e' },
      target: { nodeId: target, portId: 'w' },
    })
    const original = doc().sheets[0]!
    const copy = s.duplicateSheet(original.id, '吹扫方案')!
    const copied = doc().sheets.find((sh) => sh.id === copy.sheetId)!

    expect(copied.name).toBe('吹扫方案')
    expect(copied.nodes.map((n) => n.id)).not.toContain(source)
    expect(copied.nodes).toHaveLength(2)
    expect(copied.edges).toHaveLength(1)
    expect(copied.edges[0]!.id).not.toBe(edge)
    expect(copied.edges[0]!.source).toEqual({ nodeId: copy.nodeIdMap[source], portId: 'e' })
    expect(copied.edges[0]!.target).toEqual({ nodeId: copy.nodeIdMap[target], portId: 'w' })
  })
})

describe('record edits are undoable', () => {
  it('undo restores the previous field value', () => {
    const s = fresh()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'FT', loop: '101' })
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', 'first')
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', 'second')
    expect(doc().registry?.['FT-101']?.fields['signal.range']).toBe('second')

    useStore.getState().undo()
    expect(doc().registry?.['FT-101']?.fields['signal.range']).toBe('first')
  })

  it('purge removes a record outright', () => {
    const s = fresh()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'FT', loop: '101' })
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', 'x')
    useStore.getState().purgeRecord('FT-101')
    expect(doc().registry?.['FT-101']).toBeUndefined()
  })
})
