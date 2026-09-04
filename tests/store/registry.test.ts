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

describe('a rename onto a key that already has a record', () => {
  it('refuses to merge, reports the collision, and leaves both records intact', () => {
    const s = fresh()
    const a = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const b = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 64, y: 0, rotation: 0 })
    useStore.getState().setTag(a, { letters: 'FT', loop: '101' })
    useStore.getState().setTag(b, { letters: 'FT', loop: '102' })
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', '0-100 m3/h')
    useStore.getState().setRecordField('FT-102', 'instrument', 'signal.range', '0-250 m3/h')

    // FT-101 is renamed onto FT-102, which another symbol already owns.
    const result = useStore.getState().setTag(a, { letters: 'FT', loop: '102' })

    // Merging two engineering records is unrecoverable, so neither moved...
    expect(result.collision).toBe(true)
    expect(doc().registry?.['FT-101']?.fields['signal.range']).toBe('0-100 m3/h')
    expect(doc().registry?.['FT-102']?.fields['signal.range']).toBe('0-250 m3/h')
  })

  it('reports no collision on an ordinary rename', () => {
    const s = fresh()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'FT', loop: '101' })
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', '0-100 m3/h')

    const result = useStore.getState().setTag(id, { letters: 'FT', loop: '103' })

    expect(result.collision).toBe(false)
    expect(doc().registry?.['FT-103']?.fields['signal.range']).toBe('0-100 m3/h')
  })

  it('reports a collision when a line is renumbered onto an occupied number', () => {
    const s = fresh()
    const n1 = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    const n2 = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })
    const e1 = useStore.getState().addEdge({ lineClass: 'process.major', source: { nodeId: n1, portId: 'e' }, target: { nodeId: n2, portId: 'w' } })
    const e2 = useStore.getState().addEdge({ lineClass: 'process.major', source: { x: 0, y: 96 }, target: { x: 96, y: 96 } })
    const A = { size: '3"', spec: 'CS150', service: 'P', seq: '001' }
    const B = { size: '3"', spec: 'CS150', service: 'P', seq: '002' }
    useStore.getState().setEdge(e1, { lineNumber: A })
    useStore.getState().setEdge(e2, { lineNumber: B })
    const keyA = '3"-CS150-P-001'
    const keyB = '3"-CS150-P-002'
    useStore.getState().setRecordField(keyA, 'line', 'line.material', 'CS')
    useStore.getState().setRecordField(keyB, 'line', 'line.material', 'SS')

    const result = useStore.getState().setEdge(e1, { lineNumber: B })

    expect(result.collision).toBe(true)
    expect(doc().registry?.[keyA]?.fields['line.material']).toBe('CS')
    expect(doc().registry?.[keyB]?.fields['line.material']).toBe('SS')
  })
})
