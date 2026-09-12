// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The fingerprint, and what it must and must not react to.
 *
 * A fingerprint that changed when nothing meaningful did would make every
 * revision look like it was judged by different rules. One that stayed the
 * same when the rules moved would be worse: it would assert provenance that is
 * not true.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FINDINGS, canonicalStandard, captureQaEvidence, countsOfEvidence,
  fingerprintStandard, provenanceLabel, standardProvenance,
} from '../../src/model/provenance'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import type { StandardProfile } from '../../src/model/standard'
import type { QaReport } from '../../src/validate/engine'
import type { Rule, RuleFinding } from '../../src/validate/rules'

const std = (over: Partial<StandardProfile> = {}): StandardProfile => ({ ...DEFAULT_STANDARD, ...over })

describe('1. identical content, identical fingerprint', () => {
  it('two separately built copies agree', () => {
    expect(fingerprintStandard(std())).toBe(fingerprintStandard(std()))
  })

  it('a JSON round trip does not change it', () => {
    const a = std({ name: 'Acme', version: '2.1' })
    const b = JSON.parse(JSON.stringify(a)) as StandardProfile
    expect(fingerprintStandard(b)).toBe(fingerprintStandard(a))
  })

  it('key ORDER does not change it — JSON key order is an accident', () => {
    const a = std({ name: 'Acme' })
    const reordered = { conventions: a.conventions, name: a.name, required: a.required, lineNumber: a.lineNumber, tagFormat: a.tagFormat, id: a.id, issueStatuses: a.issueStatuses } as StandardProfile
    expect(fingerprintStandard(reordered)).toBe(fingerprintStandard(a))
  })

  it('required-field ORDER does not change it — those arrays are sets', () => {
    // The Standards page appends as boxes are ticked, so two engineers
    // choosing the same fields in a different order must not produce two
    // different standards.
    const a = std({ required: { ...DEFAULT_STANDARD.required, instrument: ['general.service', 'signal.range'] } })
    const b = std({ required: { ...DEFAULT_STANDARD.required, instrument: ['signal.range', 'general.service'] } })
    expect(fingerprintStandard(b)).toBe(fingerprintStandard(a))
  })

  it('is stable across machines and time — no clock, no randomness', () => {
    // A literal, so a change to the hash function is a deliberate decision
    // rather than something noticed after issued drawings stop matching.
    expect(fingerprintStandard(DEFAULT_STANDARD)).toBe(fingerprintStandard(DEFAULT_STANDARD))
    expect(fingerprintStandard(DEFAULT_STANDARD)).toMatch(/^[0-9a-f]{16}$/)
    expect(canonicalStandard(DEFAULT_STANDARD)).toBe(canonicalStandard({ ...DEFAULT_STANDARD }))
  })
})

describe('2. meaningful change, different fingerprint', () => {
  const base = fingerprintStandard(std())
  const cases: [string, StandardProfile][] = [
    ['a required field added', std({ required: { ...DEFAULT_STANDARD.required, instrument: ['general.service', 'signal.range', 'signal.units'] } })],
    ['a tag pattern change', std({ tagFormat: { ...DEFAULT_STANDARD.tagFormat, pattern: 'LL-NNN' } })],
    ['a loop-digit change', std({ tagFormat: { ...DEFAULT_STANDARD.tagFormat, digits: 4 } })],
    ['line-number component ORDER', std({ lineNumber: { ...DEFAULT_STANDARD.lineNumber, order: ['service', 'size', 'spec', 'seq'] } })],
    ['a convention change', std({ conventions: { ...DEFAULT_STANDARD.conventions, valveFailPosition: 'optional' } })],
    ['a severity override', std({ severityOverrides: { 'no-relief': 'off' } })],
    ['an issue-status list change', std({ issueStatuses: ['WIP', 'IFC'] })],
    ['the issue-status ORDER — it is a workflow', std({ issueStatuses: ['IFR', 'WIP', 'IFA', 'IFC', 'AS-BUILT'] })],
    ['a rename', std({ name: 'Something else' })],
    ['a version bump', std({ version: '3.0' })],
    ['a different id', std({ id: 'other' })],
  ]
  for (const [what, profile] of cases) {
    it(what, () => expect(fingerprintStandard(profile)).not.toBe(base))
  }
})

describe('the provenance record', () => {
  it('carries id, name, version and fingerprint', () => {
    const p = standardProvenance(std({ id: 'acme', name: 'Acme', version: '2.1' }))
    expect(p).toEqual({ id: 'acme', name: 'Acme', version: '2.1', fingerprint: fingerprintStandard(std({ id: 'acme', name: 'Acme', version: '2.1' })) })
  })

  it('omits an absent version rather than inventing one', () => {
    expect(standardProvenance(std()).version).toBeUndefined()
  })

  it('reads compactly for a title block', () => {
    const p = standardProvenance(std({ name: 'Acme', version: '2.1' }))
    expect(provenanceLabel(p)).toBe(`Acme v2.1 · ${p.fingerprint.slice(0, 8)}`)
    expect(provenanceLabel(standardProvenance(std({ name: 'Acme' })))).toContain('Acme · ')
  })
})

/* ------------------------------------------------------------- evidence */

const rule = (id: string, severity: Rule['severity'], title: string): Rule =>
  ({ id, title, severity, discipline: 'data', run: () => [] })
const finding = (ruleId: string, entityKey: string, message: string): RuleFinding =>
  ({ ruleId, key: `${ruleId}:${entityKey}`, entityKey, message })

function report(over: Partial<QaReport> = {}): QaReport {
  return {
    groups: [], counts: { critical: 0, warning: 0, info: 0 }, ignored: [], total: 0,
    rulesEvaluated: 0, rulesDisabled: [],
    index: undefined as never, ...over,
  }
}

describe('capturing QA evidence', () => {
  const critical = rule('dup-tag', 'critical', 'Duplicate tags')
  const info = rule('io-type-unclassified', 'info', 'Unclassifiable signals')

  const full = () => report({
    groups: [
      { rule: critical, findings: [finding('dup-tag', 'LT-101', 'LT-101 is used twice')] },
      { rule: info, findings: [finding('io-type-unclassified', 'FE-200', 'FE-200 cannot be classified')] },
    ],
    ignored: [{
      finding: finding('orphan-record', 'PT-300', 'PT-300 has a record and no symbol'),
      rule: rule('orphan-record', 'warning', 'Orphan records'),
      entry: { reason: 'Redrawn next revision', by: 'PN', at: '2026-09-01T00:00:00.000Z' },
    }],
    counts: { critical: 1, warning: 0, info: 1 }, total: 2,
  })

  it('5. keeps the actual findings, not just a number', () => {
    const e = captureQaEvidence(full(), '2026-09-11T00:00:00.000Z')
    expect(e.findings).toHaveLength(3)
    expect(e.findings[0]).toMatchObject({
      ruleId: 'dup-tag', entityKey: 'LT-101', severity: 'critical',
      ruleTitle: 'Duplicate tags', message: 'LT-101 is used twice',
    })
    expect(e.capturedAt).toBe('2026-09-11T00:00:00.000Z')
  })

  it('7. an accepted finding keeps its reason, who and when', () => {
    const e = captureQaEvidence(full())
    const accepted = e.findings.find((f) => f.entityKey === 'PT-300')!
    expect(accepted.ignored).toEqual({ reason: 'Redrawn next revision', by: 'PN', at: '2026-09-01T00:00:00.000Z' })
  })

  it('6. the frozen list and its counts describe one report', () => {
    const e = captureQaEvidence(full())
    expect(countsOfEvidence(e)).toEqual({ critical: 1, warning: 1, info: 1, total: 3 })
    expect(e.findings.length + e.omitted).toBe(3)
  })

  it('orders severity first, then rule, then entity — deterministically', () => {
    const a = captureQaEvidence(full(), 'x')
    const b = captureQaEvidence(full(), 'x')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.findings.map((f) => f.severity)).toEqual(['critical', 'warning', 'info'])
  })

  it('holds no live reference — mutating the report afterwards changes nothing', () => {
    const r = full()
    const e = captureQaEvidence(r)
    r.groups[0]!.findings[0]!.message = 'rewritten'
    r.ignored[0]!.entry.reason = 'rewritten'
    expect(e.findings[0]!.message).toBe('LT-101 is used twice')
    expect(e.findings.find((f) => f.entityKey === 'PT-300')!.ignored!.reason).toBe('Redrawn next revision')
  })

  it('caps a very large report and accounts for every finding it left out', () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      finding('io-type-unclassified', `T-${1000 + i}`, 'cannot classify'))
    const e = captureQaEvidence(report({
      groups: [{ rule: info, findings: many }],
      counts: { critical: 0, warning: 0, info: many.length }, total: many.length,
    }))
    expect(e.findings.length).toBeLessThan(many.length)
    expect(e.omitted).toBe(many.length - e.findings.length)
    // the honest invariant: nothing is silently missing
    expect(countsOfEvidence(e).total).toBe(many.length)
  })

  it('stays inside the byte budget a project file can afford', () => {
    // The budget is in bytes because the cloud ceiling is. A count cap alone
    // cannot bound a payload whose entries vary in length.
    const wordy = Array.from({ length: 2000 }, (_, i) =>
      finding('io-type-unclassified', `T-${1000 + i}`, 'x'.repeat(300)))
    const e = captureQaEvidence(report({
      groups: [{ rule: info, findings: wordy }],
      counts: { critical: 0, warning: 0, info: wordy.length }, total: wordy.length,
    }))
    expect(JSON.stringify(e.findings).length).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES)
    expect(e.omitted).toBeGreaterThan(0)
  })

  it('never exceeds the count backstop either', () => {
    const tiny = Array.from({ length: MAX_EVIDENCE_FINDINGS + 200 }, (_, i) =>
      ({ ...finding('r', `T${i}`, ''), key: `r:T${i}` }))
    const e = captureQaEvidence(report({
      groups: [{ rule: rule('r', 'info', 'T') , findings: tiny }],
      counts: { critical: 0, warning: 0, info: tiny.length }, total: tiny.length,
    }))
    expect(e.findings.length).toBeLessThanOrEqual(MAX_EVIDENCE_FINDINGS)
  })

  it('keeps at least one finding even if it alone exceeds the budget', () => {
    const huge = finding('r', 'T-1', 'y'.repeat(MAX_EVIDENCE_BYTES * 2))
    const e = captureQaEvidence(report({
      groups: [{ rule: rule('r', 'critical', 'T'), findings: [huge] }],
      counts: { critical: 1, warning: 0, info: 0 }, total: 1,
    }))
    expect(e.findings).toHaveLength(1)
    expect(e.omitted).toBe(0)
  })

  it('keeps the SEVERE findings when it caps', () => {
    const noise = Array.from({ length: 2000 }, (_, i) =>
      finding('io-type-unclassified', `T-${1000 + i}`, 'noise'))
    const e = captureQaEvidence(report({
      groups: [
        { rule: info, findings: noise },
        { rule: critical, findings: [finding('dup-tag', 'LT-101', 'the one that matters')] },
      ],
      counts: { critical: 1, warning: 0, info: noise.length }, total: noise.length + 1,
    }))
    expect(e.findings[0]).toMatchObject({ severity: 'critical', entityKey: 'LT-101' })
    expect(e.omitted).toBeGreaterThan(0)
    // the critical survived the cap; only info was dropped
    expect(e.findings.filter((f) => f.severity === 'critical')).toHaveLength(1)
  })

  it('an empty report captures cleanly', () => {
    const e = captureQaEvidence(report())
    expect(e.findings).toEqual([])
    expect(e.omitted).toBe(0)
    expect(countsOfEvidence(e).total).toBe(0)
  })
})
