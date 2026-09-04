import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { selectionBrief } from '../../src/assist/context'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

const st = () => useStore.getState()
const brief = () => {
  const s = st()
  return selectionBrief(s.doc, s.activeSheetId, s.selection)
}

beforeEach(() => { st().loadIntoStore(createEmptyDoc('brief')) })

describe('selectionBrief', () => {
  it('reports an empty selection against the active sheet, never the project', () => {
    const b = brief()
    expect(b.selection.kind).toBe('empty')
    expect(b.project.activeSheet.name).toBeTruthy()
    expect(b.focus).toBeUndefined()
  })

  it('describes one node with its tag expansion and port connection state', () => {
    const id = st().addNode({
      symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0,
      tag: { letters: 'FT', loop: '101' },
    })
    st().setSelection([id])
    const b = brief()
    expect(b.selection.kind).toBe('node')
    expect(b.focus?.ref).toBe('FT-101')
    expect(b.focus?.objectType).toBe('node')
    if (b.focus?.objectType !== 'node') throw new Error('expected a node focus')
    expect(b.focus.tag?.expanded).toMatch(/flow/i)
    expect(b.focus.ports.length).toBeGreaterThan(0)
    expect(b.focus.ports.every((p) => p.connected === false)).toBe(true)
  })

  it('falls back to the label when a node is untagged, rather than inventing a tag', () => {
    const id = st().addNode({
      symbolId: 'vessel.tank', kind: 'equipment', x: 0, y: 0, rotation: 0, label: 'TK-201 Crude Feed',
    })
    st().setSelection([id])
    const f = brief().focus
    expect(f?.ref).toBe('TK-201 Crude Feed')
    if (f?.objectType !== 'node') throw new Error('expected a node focus')
    expect(f.tag).toBeUndefined()
  })

  it('carries loop membership for a tagged instrument', () => {
    const a = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 80, y: 0, rotation: 0, tag: { letters: 'FIC', loop: '101' } })
    st().setSelection([a])
    const b = brief()
    expect(b.loop?.ref).toBe('F-101')
    expect(b.loop?.byTag).toEqual(expect.arrayContaining(['FT-101', 'FIC-101']))
    expect(b.loop?.roles.transmitter).toContain('FT-101')
    expect(b.loop?.roles.controller).toContain('FIC-101')
  })

  it('reports an edge with how much of its run carries a flow arrow', () => {
    const a = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    const b2 = st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 240, y: 0, rotation: 0 })
    const e = st().addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b2, portId: 'w' } })
    st().setSelection([e])
    const b = brief()
    expect(b.selection.kind).toBe('edge')
    if (b.focus?.objectType !== 'edge') throw new Error('expected an edge focus')
    expect(b.focus.run.arrowsTotal).toBeGreaterThan(0)
    expect(b.focus.run.arrowsMarked).toBe(0)
  })

  it('aggregates rather than detailing a selection larger than eight', () => {
    const ids = Array.from({ length: 9 }, (_, i) =>
      st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: i * 40, y: 0, rotation: 0 }))
    st().setSelection(ids)
    const b = brief()
    expect(b.selection.kind).toBe('many')
    expect(b.focus).toBeUndefined()
    expect(b.aggregate?.count).toBe(9)
  })

  it('surfaces open findings against the selected object', () => {
    // an untagged instrument trips the missing-tag rule
    const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setSelection([id])
    expect(brief().findings.some((f) => f.ruleId === 'missing-tag')).toBe(true)
  })
})
