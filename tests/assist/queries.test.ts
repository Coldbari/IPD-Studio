import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { selectionBrief } from '../../src/assist/context'
import {
  downstreamOf, hasRelief, hmiCoverage, loopComplete, loopCost,
  loopsMissingController, onThisLine, tagLegal, unanswerable, whatControls, withoutDatasheet,
} from '../../src/assist/queries'
import { qaFor } from '../../src/validate/engine'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

const st = () => useStore.getState()
const ctx = () => {
  const s = st()
  return { ix: qaFor(s.doc).index, brief: selectionBrief(s.doc, s.activeSheetId, s.selection) }
}

beforeEach(() => { st().loadIntoStore(createEmptyDoc('q')) })

describe('loopComplete', () => {
  it('names the missing final element rather than calling the loop fine', () => {
    const ft = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 80, y: 0, rotation: 0, tag: { letters: 'FIC', loop: '101' } })
    st().setSelection([ft])
    const { ix, brief } = ctx()
    const a = loopComplete(ix, brief)
    expect(a.headline).toMatch(/final control element/i)
    expect(a.rows.map((r) => r.ref)).toEqual(expect.arrayContaining(['FT-101', 'FIC-101']))
    // every row is a real object the user can jump to
    expect(a.rows.every((r) => r.id && r.sheetId)).toBe(true)
  })

  it('declines cleanly with no loop selected, and says what to do', () => {
    const a = loopComplete(ctx().ix, ctx().brief)
    expect(a.rows).toHaveLength(0)
    expect(a.gap?.missing).toMatch(/tagged instrument/i)
  })
})

describe('downstreamOf', () => {
  it('answers adjacency and refuses to imply direction when arrows are unmarked', () => {
    const v = st().addNode({ symbolId: 'cv.globe', kind: 'valve', x: 0, y: 0, rotation: 0, tag: { letters: 'FV', loop: '101' } })
    const tk = st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 240, y: 0, rotation: 0, label: 'T-1' })
    st().addEdge({ lineClass: 'process.major', source: { nodeId: v, portId: 'e' }, target: { nodeId: tk, portId: 'w' } })
    st().setSelection([v])
    const a = downstreamOf(ctx().ix, ctx().brief)
    expect(a.headline).toMatch(/adjacency, not direction/i)
    expect(a.rows.some((r) => r.ref === 'T-1')).toBe(true)
  })
})

describe('tagLegal', () => {
  it('quotes the ISA validator instead of re-deriving the rule', () => {
    const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    st().setSelection([id])
    expect(tagLegal(ctx().ix, ctx().brief).headline).toMatch(/valid/i)
  })
})

describe('whatControls', () => {
  it('follows the signal chain to the final element', () => {
    const fic = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FIC', loop: '101' } })
    const fv = st().addNode({ symbolId: 'cv.globe', kind: 'valve', x: 0, y: 200, rotation: 0, tag: { letters: 'FV', loop: '101' } })
    st().addEdge({ lineClass: 'signal.electric', source: { nodeId: fic, portId: 's' }, target: { nodeId: fv, portId: 'sig' } })
    st().setSelection([fic])
    const a = whatControls(ctx().ix, ctx().brief)
    expect(a.headline).toMatch(/drives 1 final element/i)
    expect(a.rows[0]?.ref).toBe('FV-101')
  })
})

describe('project-wide queries', () => {
  it('loopsMissingController finds a measured loop with no receiver', () => {
    st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'PT', loop: '300' } })
    expect(loopsMissingController(ctx().ix).headline).toMatch(/no controller/i)
  })

  it('withoutDatasheet lists tagged objects with an empty record', () => {
    st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    const a = withoutDatasheet(ctx().ix)
    expect(a.rows.some((r) => r.ref === 'FT-101')).toBe(true)
  })
})

describe('loopCost', () => {
  it('totals the loop from the price table', () => {
    const ft = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    st().addNode({ symbolId: 'cv.globe', kind: 'valve', x: 80, y: 0, rotation: 0, tag: { letters: 'FV', loop: '101' } })
    st().setSelection([ft])
    expect(loopCost(ctx().ix, ctx().brief).rows).toHaveLength(2)
  })
})

describe('hmiCoverage', () => {
  it('says so honestly when no HMI screen carries a bound tag', () => {
    const ft = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    st().setSelection([ft])
    expect(hmiCoverage(ctx().ix, ctx().brief).gap).toBeDefined()
  })
})

describe('hasRelief', () => {
  it('reports the rule finding rather than re-walking for relief devices', () => {
    const tk = st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 0, y: 0, rotation: 0, label: 'T-1' })
    const p = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 240, y: 0, rotation: 0 })
    st().addEdge({ lineClass: 'process.major', source: { nodeId: tk, portId: 'e' }, target: { nodeId: p, portId: 'w' } })
    st().setSelection([tk])
    expect(hasRelief(ctx().ix, ctx().brief).headline).toBeTruthy()
  })
})

describe('onThisLine', () => {
  it('needs a line and says so', () => {
    expect(onThisLine(ctx().ix, ctx().brief).gap?.missing).toMatch(/process line/i)
  })
})

describe('refusals', () => {
  it.each(['psv-sizing', 'revision', 'interlock', 'hazard'] as const)('%s declines with what is missing', (topic) => {
    const a = unanswerable(topic)
    expect(a.rows).toHaveLength(0)
    expect(a.gap?.missing).toBeTruthy()
  })
})
