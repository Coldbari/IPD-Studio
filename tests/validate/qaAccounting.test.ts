// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * WHAT THE REPORT SAYS ABOUT ITSELF.
 *
 * The gap this closes: before it, a document with five checks switched off and
 * a genuinely clean document produced the same report — "0 findings" — and
 * nothing anywhere recorded that nobody had looked. Every conformance verdict
 * downstream rests on this being true, so it is tested on its own first.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { qaFor, resetQaCache, runRules } from '../../src/validate/engine'
import { buildIndex } from '../../src/model/projectIndex'
import { ALL_RULES } from '../../src/validate/rules/index'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import type { ProjectDoc } from '../../src/model/types'

const doc = () => useStore.getState().doc

/** A drawing that produces findings: an untagged symbol, and an instrument
 *  missing a required field. */
function seed(): void {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })
}

const withOverrides = (d: ProjectDoc, overrides: Record<string, 'off' | 'critical' | 'warning' | 'info'>): ProjectDoc =>
  ({ ...d, standard: { ...DEFAULT_STANDARD, severityOverrides: overrides } })

beforeEach(() => {
  resetQaCache()
  seed()
})

describe('the report accounts for the checks it ran', () => {
  it('counts every rule when nothing is switched off', () => {
    const report = qaFor(doc())
    expect(report.rulesEvaluated).toBe(ALL_RULES.length)
    expect(report.rulesDisabled).toEqual([])
  })

  it('names the rules a standard switched off, and stops counting them', () => {
    const off = ALL_RULES.slice(0, 3).map((r) => r.id)
    const report = runRules(buildIndex(withOverrides(doc(), Object.fromEntries(off.map((id) => [id, 'off'])))))

    expect(report.rulesDisabled).toEqual([...off].sort())
    expect(report.rulesEvaluated).toBe(ALL_RULES.length - 3)
    expect(report.rulesEvaluated + report.rulesDisabled.length).toBe(ALL_RULES.length)
  })

  it('a disabled rule produces no finding and is not counted', () => {
    const before = qaFor(doc())
    // Pick a rule that actually fired, so switching it off is observable.
    const fired = before.groups[0]
    expect(fired, 'the fixture must produce at least one finding').toBeDefined()
    const id = fired!.rule.id
    const n = fired!.findings.length

    const after = runRules(buildIndex(withOverrides(doc(), { [id]: 'off' })))
    expect(after.groups.some((g) => g.rule.id === id)).toBe(false)
    expect(after.total).toBe(before.total - n)
    expect(after.rulesDisabled).toContain(id)
  })

  it('a severity override is NOT a disabled rule — it still runs', () => {
    const id = ALL_RULES[0]!.id
    const report = runRules(buildIndex(withOverrides(doc(), { [id]: 'info' })))
    expect(report.rulesDisabled).toEqual([])
    expect(report.rulesEvaluated).toBe(ALL_RULES.length)
  })

  it('lists disabled rules in a deterministic order, whatever order they were configured in', () => {
    const ids = [ALL_RULES[4]!.id, ALL_RULES[1]!.id, ALL_RULES[7]!.id]
    const a = runRules(buildIndex(withOverrides(doc(), Object.fromEntries(ids.map((i) => [i, 'off'])))))
    const b = runRules(buildIndex(withOverrides(doc(), Object.fromEntries([...ids].reverse().map((i) => [i, 'off'])))))
    expect(a.rulesDisabled).toEqual(b.rulesDisabled)
    expect(a.rulesDisabled).toEqual([...a.rulesDisabled].sort())
  })

  it('a clean drawing is EVALUATED, not merely quiet', () => {
    useStore.getState().loadIntoStore(createEmptyDoc('t'))
    const report = qaFor(doc())
    expect(report.total).toBe(0)
    expect(report.rulesEvaluated).toBeGreaterThan(0)
  })
})
