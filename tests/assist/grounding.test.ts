import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { validateGrounding, violationFeedback } from '../../src/assist/grounding'
import { qaFor } from '../../src/validate/engine'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

const st = () => useStore.getState()
const ix = () => qaFor(st().doc).index

beforeEach(() => {
  st().loadIntoStore(createEmptyDoc('ground'))
  st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
  st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 200, y: 0, rotation: 0, label: 'TK-201' })
})

describe('the grounding validator', () => {
  it('passes a tag that is actually drawn', () => {
    expect(validateGrounding('FT-101 measures the feed.', ix())).toEqual([])
  })

  it('BLOCKS a plausible tag that does not exist', () => {
    const v = validateGrounding('FT-205 is downstream of FT-101.', ix())
    expect(v).toHaveLength(1)
    expect(v[0]!.text).toBe('FT-205')
  })

  it('accepts an unhyphenated form of a real tag', () => {
    expect(validateGrounding('FT101 is the transmitter.', ix())).toEqual([])
  })

  it('accepts a label the drawing carries', () => {
    expect(validateGrounding('TK-201 feeds the pump.', ix())).toEqual([])
  })

  it('ignores tag-shaped text the user themselves quoted', () => {
    expect(validateGrounding('You asked about "PT-999", which I cannot find.', ix())).toEqual([])
    expect(validateGrounding('You asked about `PT-999`.', ix())).toEqual([])
  })

  it('accepts anything a tool returned this turn, even if newly drawn', () => {
    expect(validateGrounding('FY-101 was added.', ix(), new Set(['FY-101']))).toEqual([])
  })

  it('ignores prose that merely looks numeric', () => {
    expect(validateGrounding('Rated for 150 psi across 3 sheets.', ix())).toEqual([])
  })

  it('feeds the model real tags so its retry is informed', () => {
    const v = validateGrounding('FT-205 does the job.', ix())
    const msg = violationFeedback(v, ix())
    expect(msg).toContain('FT-205')
    expect(msg).toContain('FT-101')
    expect(msg).toMatch(/say the drawing does not contain/i)
  })
})
