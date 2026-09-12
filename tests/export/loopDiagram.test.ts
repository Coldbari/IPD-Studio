import { describe, expect, it } from 'vitest'
import { XMLValidator } from 'fast-xml-parser'
import '../../src/symbols/lib/index'
import { loopDiagramSvg } from '../../src/export/loopDiagram'
import { classifyMember } from '../../src/model/loop'
import { createEmptyDoc } from '../../src/model/doc'
import type { Tag } from '../../src/model/types'

let n = 0
function docWith(...tags: Tag[]) {
  const doc = createEmptyDoc('Loop Test')
  doc.sheets[0]!.nodes = tags.map((tag) => ({
    id: `n${n++}`,
    symbolId: tag.letters.endsWith('V') ? 'cv.globe' : 'instr.bubble',
    kind: tag.letters.endsWith('V') ? ('valve' as const) : ('instrument' as const),
    x: 0, y: 0, rotation: 0 as const, tag,
  }))
  return doc
}

describe('classifyMember', () => {
  it('assigns roles by letters', () => {
    expect(classifyMember('FE')).toBe('element')
    expect(classifyMember('FT')).toBe('transmitter')
    expect(classifyMember('FIC')).toBe('controller')
    expect(classifyMember('FV')).toBe('final')
    expect(classifyMember('LSH')).toBe('switch')
    expect(classifyMember('FY')).toBe('relay')
    expect(classifyMember('FQI')).toBe('indicator')
  })
})

describe('loopDiagramSvg', () => {
  it('lays out a full loop across field/control columns with terminals', () => {
    const doc = docWith({ letters: 'FT', loop: '101' }, { letters: 'FIC', loop: '101' }, { letters: 'FV', loop: '101' })
    const svg = loopDiagramSvg(doc, 'F', '101')
    expect(XMLValidator.validate(svg)).toBe(true)
    expect(svg).toContain('LOOP F-101')
    // FT and FV in the field column (x<400), FIC in control room (x>600)
    const ftX = Number(/data-member="FT-101" data-x="(\d+)"/.exec(svg)?.[1])
    const ficX = Number(/data-member="FIC-101" data-x="(\d+)"/.exec(svg)?.[1])
    expect(ftX).toBeLessThan(400)
    expect(ficX).toBeGreaterThan(600)
    // terminal pairs numbered
    expect(svg).toContain('>1<')
    expect(svg).toContain('>2<')
  })
  it('renders switch-only loops without controller entries', () => {
    const doc = docWith({ letters: 'LSH', loop: '201' }, { letters: 'LAH', loop: '201' })
    const svg = loopDiagramSvg(doc, 'L', '201')
    expect(XMLValidator.validate(svg)).toBe(true)
    expect(svg).toContain('LSH-201')
  })
  it('throws on unknown loops', () => {
    expect(() => loopDiagramSvg(createEmptyDoc('x'), 'F', '999')).toThrow()
  })
})
