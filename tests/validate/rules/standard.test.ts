import { beforeEach, describe, expect, it } from 'vitest'
import '../../../src/symbols/lib/index'
import { createEmptyDoc } from '../../../src/model/doc'
import { buildIndex } from '../../../src/model/projectIndex'
import { runRules, resetQaCache } from '../../../src/validate/engine'
import { DEFAULT_STANDARD, type StandardProfile } from '../../../src/model/standard'
import type { PlantEdge, PlantNode, ProjectDoc } from '../../../src/model/types'

let n = 0
const node = (p: Partial<PlantNode> = {}): PlantNode => ({
  id: `n${n++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, ...p,
})

function doc(nodes: PlantNode[], edges: PlantEdge[] = [], standard?: StandardProfile): ProjectDoc {
  const d = createEmptyDoc('t')
  d.sheets[0]!.nodes = nodes
  d.sheets[0]!.edges = edges
  if (standard) d.standard = standard
  return d
}

const report = (d: ProjectDoc) => runRules(buildIndex(d), d.qa?.ignored ?? {})
const group = (d: ProjectDoc, ruleId: string) => report(d).groups.find((g) => g.rule.id === ruleId)
const withDigits = (digits: 3 | 4): StandardProfile => ({
  ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, digits },
})

beforeEach(() => resetQaCache())

describe('tag-format', () => {
  it('says nothing when the tags already match the standard', () => {
    const d = doc([node({ tag: { letters: 'FT', loop: '101' } })])
    expect(group(d, 'tag-format')).toBeUndefined()
  })

  it('flags a 3-digit tag on a 4-digit standard, and shows the corrected form', () => {
    const d = doc([node({ tag: { letters: 'FT', loop: '101' } })], [], withDigits(4))
    const g = group(d, 'tag-format')
    expect(g?.findings).toHaveLength(1)
    expect(g?.findings[0]!.message).toContain('FT-0101')
  })

  it('is silent on the same drawing under the default standard', () => {
    const nodes = [node({ tag: { letters: 'FT', loop: '101' } })]
    expect(group(doc(nodes), 'tag-format')).toBeUndefined()
    // the SAME drawing, two profiles, two answers — the point of the feature
    expect(group(doc(nodes, [], withDigits(4)), 'tag-format')?.findings).toHaveLength(1)
  })

  it('flags a suffix under a pattern that does not use one', () => {
    const plain: StandardProfile = {
      ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, pattern: 'LL-NNN' },
    }
    const d = doc([node({ tag: { letters: 'FT', loop: '101', suffix: 'A' } })], [], plain)
    expect(group(d, 'tag-format')?.findings[0]!.message).toContain('suffix')
  })

  it('accepts a suffix under LL-NNNA', () => {
    const d = doc([node({ tag: { letters: 'FT', loop: '101', suffix: 'A' } })])
    expect(group(d, 'tag-format')).toBeUndefined()
  })

  it('reports one finding per tag, not per symbol wearing it', () => {
    const d = doc([
      node({ tag: { letters: 'FT', loop: '101' } }),
      node({ tag: { letters: 'FT', loop: '101' } }),
    ], [], withDigits(4))
    expect(group(d, 'tag-format')?.findings).toHaveLength(1)
  })

  it('offers no fix, because a rename is the engineer decision', () => {
    const d = doc([node({ tag: { letters: 'FT', loop: '101' } })], [], withDigits(4))
    expect(group(d, 'tag-format')?.findings[0]!.fix).toBeUndefined()
  })
})

describe('line-number-incomplete', () => {
  const line = (lineNumber: PlantEdge['lineNumber']): PlantEdge => ({
    id: `e${n++}`, lineClass: 'process.major',
    source: { x: 0, y: 0 }, target: { x: 10, y: 0 }, lineNumber,
  })

  it('passes a line carrying every component the standard asks for', () => {
    const d = doc([], [line({ size: '6"', spec: '150', service: 'CW', seq: '001' })])
    expect(group(d, 'line-number-incomplete')).toBeUndefined()
  })

  it('names the missing component', () => {
    const d = doc([], [line({ size: '6"', spec: '150', service: '', seq: '001' })])
    expect(group(d, 'line-number-incomplete')?.findings[0]!.message).toContain('service')
  })

  it('does not ask for a component the standard leaves out', () => {
    const short: StandardProfile = {
      ...DEFAULT_STANDARD, lineNumber: { ...DEFAULT_STANDARD.lineNumber, order: ['size', 'seq'] },
    }
    const d = doc([], [line({ size: '6"', spec: '', service: '', seq: '001' })], short)
    expect(group(d, 'line-number-incomplete')).toBeUndefined()
  })

  it('ignores an unnumbered line entirely', () => {
    const d = doc([], [line(undefined)])
    expect(group(d, 'line-number-incomplete')).toBeUndefined()
  })
})

describe('the standard drives rules that already existed', () => {
  it('required-field-empty asks for the fields the profile lists', () => {
    const ft = node({ tag: { letters: 'FT', loop: '101' } })
    const d = doc([ft])
    d.registry = { 'FT-101': { key: 'FT-101', kind: 'instrument', fields: { 'general.service': 'Feed water' } } }
    // default profile also wants signal.range
    expect(group(d, 'required-field-empty')?.findings[0]!.message).toContain('Calibrated range')

    const relaxed: StandardProfile = {
      ...DEFAULT_STANDARD, required: { ...DEFAULT_STANDARD.required, instrument: ['general.service'] },
    }
    const d2 = { ...d, standard: relaxed }
    expect(group(d2, 'required-field-empty')).toBeUndefined()
  })

  it('no-fail-position switches off when the standard calls it optional', () => {
    const valve = node({ symbolId: 'cv.globe', kind: 'valve', tag: { letters: 'FV', loop: '101' } })
    expect(group(doc([valve]), 'no-fail-position')?.findings).toHaveLength(1)

    const optional: StandardProfile = {
      ...DEFAULT_STANDARD,
      conventions: { ...DEFAULT_STANDARD.conventions, valveFailPosition: 'optional' },
    }
    expect(group(doc([valve], [], optional), 'no-fail-position')).toBeUndefined()
  })
})

describe('severity overrides', () => {
  const dupes = () => [
    node({ tag: { letters: 'FT', loop: '101' } }),
    node({ tag: { letters: 'FT', loop: '101' } }),
  ]

  it('a duplicate tag is critical by default', () => {
    const d = doc(dupes())
    expect(group(d, 'duplicate-tag')?.rule.severity).toBe('critical')
    expect(report(d).counts.critical).toBeGreaterThan(0)
  })

  it('the standard can force a rule to another severity, and the counts follow', () => {
    const std: StandardProfile = { ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-tag': 'info' } }
    const d = doc(dupes(), [], std)
    const g = group(d, 'duplicate-tag')
    expect(g?.rule.severity).toBe('info')
    // the count must move with it, or the badge and the report disagree
    expect(report(d).counts.critical).toBe(0)
    expect(report(d).counts.info).toBeGreaterThan(0)
  })

  it('`off` removes the rule from the report entirely', () => {
    const std: StandardProfile = { ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-tag': 'off' } }
    const d = doc(dupes(), [], std)
    expect(group(d, 'duplicate-tag')).toBeUndefined()
    expect(report(d).counts.critical).toBe(0)
  })

  it('leaves every other rule alone', () => {
    const std: StandardProfile = { ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-tag': 'off' } }
    const plain = doc(dupes())
    const overridden = doc(dupes(), [], std)
    const others = (d: ProjectDoc) => report(d).groups.filter((g) => g.rule.id !== 'duplicate-tag').map((g) => g.rule.id).sort()
    expect(others(overridden)).toEqual(others(plain))
  })
})
