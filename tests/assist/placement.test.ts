import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { applyFix, describeFix } from '../../src/assist/fixes'
import { executeTool } from '../../src/assist/tools'
import { selectionBrief } from '../../src/assist/context'
import { qaFor, resetQaCache } from '../../src/validate/engine'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

const st = () => useStore.getState()
const nodes = () => st().doc.sheets[0]!.nodes
const ctx = () => {
  const s = st()
  return { ix: qaFor(s.doc).index, brief: selectionBrief(s.doc, s.activeSheetId, s.selection) }
}
const run = (name: string, input: Record<string, unknown>) => {
  const { ix, brief } = ctx()
  return executeTool(name, input, ix, brief)
}

beforeEach(() => {
  st().loadIntoStore(createEmptyDoc('place'))
  resetQaCache()
})

describe('what the assistant may add', () => {
  it('rejects a symbol id it made up, rather than crashing the app', () => {
    // getSymbol THROWS on an unknown id and addNode validates nothing, so an
    // invented id would white-screen the editor on the next validation pass.
    const out = run('place_symbol', { symbolId: 'cv.imaginary' })
    expect(out.isError).toBe(true)
    expect(out.proposedSpec).toBeUndefined()
    expect(out.content).toMatch(/not in the catalog/i)
  })

  it('rejects ISA letters that are not legal', () => {
    const out = run('place_symbol', { symbolId: 'cv.globe', letters: 'FVI' })
    expect(out.isError).toBe(true)
    expect(out.proposedSpec).toBeUndefined()
  })

  it('proposes rather than applies — nothing changes until approval', () => {
    const before = st().doc
    const out = run('place_symbol', { symbolId: 'cv.globe', letters: 'FV' })
    expect(out.proposedSpec).toMatchObject({ kind: 'place-symbol', symbolId: 'cv.globe' })
    expect(st().doc).toBe(before)
    expect(nodes()).toHaveLength(0)
  })

  it('never lets the proposer choose coordinates', () => {
    const out = run('place_symbol', { symbolId: 'cv.globe' })
    expect(JSON.stringify(out.proposedSpec)).not.toMatch(/"x"|"y"/)
  })

  it('applies an approved symbol, tagged and on the sheet', () => {
    const out = run('place_symbol', { symbolId: 'cv.globe', letters: 'FV' })
    const r = applyFix(out.proposedSpec!)
    expect(r.ok).toBe(true)
    expect(nodes()).toHaveLength(1)
    expect(nodes()[0]!.symbolId).toBe('cv.globe')
    expect(nodes()[0]!.tag?.letters).toBe('FV')
    // the loop number came from the app's own numbering, not the proposer
    expect(nodes()[0]!.tag?.loop).toBeTruthy()
  })

  it('states plainly that a placed symbol is not connected', () => {
    const out = run('place_symbol', { symbolId: 'cv.globe' })
    expect(describeFix(out.proposedSpec!, st().doc).blastRadius).toMatch(/Nothing is connected/i)
  })

  it('adds a whole typical loop as ONE undo step', () => {
    const before = st().doc
    const out = run('place_typical', { typicalId: 'flow-control' })
    const r = applyFix(out.proposedSpec!)
    expect(r.ok).toBe(true)
    expect(nodes().length).toBeGreaterThan(3)

    // every member shares one loop number — that is the point of a typical
    const loops = new Set(nodes().map((n) => n.tag?.loop).filter(Boolean))
    expect(loops.size).toBe(1)

    st().undo()
    expect(useStore.getState().doc).toEqual(before)
  })

  it('places beside the object it was asked to sit near', () => {
    const anchor = st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 400, y: 300, rotation: 0, label: 'T-9' })
    resetQaCache()
    const out = run('place_symbol', { symbolId: 'cv.globe', nearTag: 'T-9' })
    expect(out.proposedSpec).toMatchObject({ nearNodeId: anchor })
    applyFix(out.proposedSpec!)
    const placed = nodes().find((n) => n.symbolId === 'cv.globe')!
    expect(placed.x).toBeGreaterThan(400)
  })

  it('find_symbols returns ids that place_symbol will actually accept', () => {
    const found = JSON.parse(run('find_symbols', { query: 'globe' }).content) as { symbolId: string }[]
    expect(found.length).toBeGreaterThan(0)
    for (const f of found) {
      expect(run('place_symbol', { symbolId: f.symbolId }).isError).toBeUndefined()
    }
  })

  it('reports an unknown typical instead of silently doing nothing', () => {
    expect(run('place_typical', { typicalId: 'nonsense-loop' }).isError).toBe(true)
    expect(applyFix({ kind: 'place-typical', typicalId: 'nonsense-loop', sheetId: st().activeSheetId }).ok).toBe(false)
  })
})
