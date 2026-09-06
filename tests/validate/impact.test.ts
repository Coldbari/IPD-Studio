import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules, qaFor, resetQaCache } from '../../src/validate/engine'
import { previewStandard } from '../../src/validate/impact'
import { DEFAULT_STANDARD, type StandardProfile } from '../../src/model/standard'
import type { PlantNode, ProjectDoc } from '../../src/model/types'

let n = 0
const node = (p: Partial<PlantNode> = {}): PlantNode => ({
  id: `n${n++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, ...p,
})

function doc(nodes: PlantNode[], standard?: StandardProfile): ProjectDoc {
  const d = createEmptyDoc('t')
  d.sheets[0]!.nodes = nodes
  if (standard) d.standard = standard
  return d
}

const report = (d: ProjectDoc) => runRules(buildIndex(d), d.qa?.ignored ?? {})
const fourDigit: StandardProfile = {
  ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, digits: 4 },
}

beforeEach(() => resetQaCache())

describe('previewStandard', () => {
  it('reports nothing changing when the candidate is the current profile', () => {
    const d = doc([node({ tag: { letters: 'FT', loop: '101' } })])
    const impact = previewStandard(d, DEFAULT_STANDARD)
    expect(impact.added).toEqual([])
    expect(impact.removed).toEqual([])
    expect(impact.totalBefore).toBe(impact.totalAfter)
  })

  it('counts what a stricter tag format would light up', () => {
    const d = doc([
      node({ tag: { letters: 'FT', loop: '101' } }),
      node({ tag: { letters: 'PT', loop: '102' } }),
      node({ tag: { letters: 'LT', loop: '1030' } }),
    ])
    const impact = previewStandard(d, fourDigit)
    // the two 3-digit tags gain a finding; the 4-digit one already conforms
    expect(impact.added).toHaveLength(2)
    expect(impact.byRule.find((r) => r.rule.id === 'tag-format')?.added).toBe(2)
  })

  /**
   * The acceptance criterion for the whole feature: an engineer will not turn
   * a standard on over a live project unless the number they were shown is the
   * number they get. If these two ever diverge the preview is worthless.
   */
  it('the previewed count equals the count after the standard is applied', () => {
    const nodes = [
      node({ tag: { letters: 'FT', loop: '101' } }),
      node({ tag: { letters: 'PT', loop: '102' } }),
      node({ tag: { letters: 'LT', loop: '1030' } }),
    ]
    const before = doc(nodes)
    const impact = previewStandard(before, fourDigit)

    const applied = { ...before, standard: fourDigit }
    const actual = report(applied)

    expect(actual.total).toBe(impact.totalAfter)
    expect(actual.counts).toEqual(impact.countsAfter)

    const actualKeys = actual.groups.flatMap((g) => g.findings.map((f) => f.key)).sort()
    const previewedKeys = [
      ...report(before).groups.flatMap((g) => g.findings.map((f) => f.key)).filter(
        (k) => !impact.removed.some((f) => f.key === k),
      ),
      ...impact.added.map((f) => f.key),
    ].sort()
    expect(actualKeys).toEqual(previewedKeys)
  })

  it('counts what switching a rule off would silence', () => {
    const d = doc([
      node({ tag: { letters: 'FT', loop: '101' } }),
      node({ tag: { letters: 'FT', loop: '101' } }),
    ])
    const quiet: StandardProfile = { ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-tag': 'off' } }
    const impact = previewStandard(d, quiet)
    expect(impact.removed.length).toBeGreaterThan(0)
    expect(impact.byRule.find((r) => r.rule.id === 'duplicate-tag')?.removed).toBe(1)
    expect(impact.totalAfter).toBeLessThan(impact.totalBefore)
  })

  it('shows a severity change in the counts even when no finding appears or leaves', () => {
    const d = doc([
      node({ tag: { letters: 'FT', loop: '101' } }),
      node({ tag: { letters: 'FT', loop: '101' } }),
    ])
    const softened: StandardProfile = { ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-tag': 'info' } }
    const impact = previewStandard(d, softened)
    expect(impact.added).toEqual([])
    expect(impact.removed).toEqual([])
    expect(impact.countsBefore.critical).toBeGreaterThan(impact.countsAfter.critical)
  })

  it('does not disturb the report the rest of the app is reading', () => {
    const d = doc([node({ tag: { letters: 'FT', loop: '101' } })])
    const live = qaFor(d)
    previewStandard(d, fourDigit)
    // same document, same cached report object — the preview must not evict it
    expect(qaFor(d)).toBe(live)
  })
})
