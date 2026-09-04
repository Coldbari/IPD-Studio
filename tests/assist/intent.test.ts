import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { matchIntent, runQuery, suggestionsFor } from '../../src/assist/intent'
import { selectionBrief } from '../../src/assist/context'
import { qaFor } from '../../src/validate/engine'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

const st = () => useStore.getState()
const ctx = () => {
  const s = st()
  return { ix: qaFor(s.doc).index, brief: selectionBrief(s.doc, s.activeSheetId, s.selection) }
}

beforeEach(() => { st().loadIntoStore(createEmptyDoc('intent')) })

describe('matchIntent', () => {
  it.each([
    ['is this loop complete?', 'loop-complete'],
    ['what does this loop still need', 'loop-complete'],
    ['what is downstream of this valve', 'downstream'],
    ['is this tag legal', 'tag-legal'],
    ['which loops are missing a controller', 'loops-missing-controller'],
    ['how much does this loop cost', 'loop-cost'],
    ['what instruments are on this line', 'on-this-line'],
    ['what does FIC-101 control', 'what-controls'],
    ['does this vessel have relief', 'has-relief'],
    ['which instruments have no datasheet', 'without-datasheet'],
    ['is this loop on the hmi screen', 'hmi-coverage'],
    ['why did that finding fire', 'why-finding'],
  ] as const)('routes %s', (q, expected) => {
    expect(matchIntent(q)).toBe(expected)
  })

  it('routes the four unanswerable topics to an honest refusal', () => {
    expect(matchIntent('is this psv sized right')).toBe('psv-sizing')
    expect(matchIntent('what changed since revision 2')).toBe('revision')
    expect(matchIntent('what trips this interlock')).toBe('interlock')
    expect(matchIntent('what is my hazard here')).toBe('hazard')
  })

  it('returns null rather than guessing when nothing matches', () => {
    expect(matchIntent('what is the weather in Pune')).toBeNull()
    expect(matchIntent('')).toBeNull()
  })

  // Regression: a bare keyword used to capture whole questions that were never
  // about that query, so the user got a confident answer to a different
  // question. Anything vaguer than these patterns must fall through.
  it('does not capture prose that merely contains a keyword', () => {
    expect(matchIntent('summarise the control philosophy of this plant')).toBeNull()
    expect(matchIntent('why did you design it this way')).toBeNull()
    expect(matchIntent('is the control room manned at night')).toBeNull()
  })
})

describe('runQuery', () => {
  it('answers a routed question end to end', () => {
    const ft = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 80, y: 0, rotation: 0, tag: { letters: 'FIC', loop: '101' } })
    st().setSelection([ft])
    const { ix, brief } = ctx()
    const a = runQuery('loop-complete', ix, brief)
    expect(a.headline).toMatch(/F-101/)
    expect(a.rows.length).toBe(2)
  })

  it('refuses PSV sizing with the fields that are missing', () => {
    const { ix, brief } = ctx()
    expect(runQuery('psv-sizing', ix, brief).gap?.missing).toMatch(/relieving load/i)
  })
})

describe('suggestionsFor', () => {
  it('offers loop questions only once something tagged is selected', () => {
    expect(suggestionsFor(ctx().brief).map((s) => s.id)).not.toContain('loop-complete')
    const ft = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
    st().setSelection([ft])
    expect(suggestionsFor(ctx().brief).map((s) => s.id)).toContain('loop-complete')
  })

  it('always offers something, even with an empty selection', () => {
    expect(suggestionsFor(ctx().brief).length).toBeGreaterThan(0)
  })
})
