// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE VERDICT, over synthetic reports.
 *
 * Deliberately built from hand-made QaReports rather than from drawings: the
 * evaluator's contract is with the REPORT, and a test that had to arrange a
 * P&ID to produce one warning would be testing the rules, not the verdict.
 */

import { describe, expect, it } from 'vitest'
import {
  CONFORMANCE_LABEL,
  acceptedCounts,
  evaluateConformance,
  historicalConformance,
  issueBlockers,
} from '../../src/model/conformance'
import type { QaReport } from '../../src/validate/engine'
import type { Rule, RuleFinding, Severity } from '../../src/validate/rules'
import type { IssueGate } from '../../src/model/standard'

const rule = (id: string, severity: Severity): Rule =>
  ({ id, title: id, severity, discipline: 'data', run: () => [] })
const finding = (ruleId: string, entityKey: string): RuleFinding =>
  ({ ruleId, key: `${ruleId}:${entityKey}`, entityKey, message: `${ruleId} on ${entityKey}` })

/** A report with `open` live findings per severity and `accepted` waived ones. */
function report(open: Partial<Record<Severity, number>> = {}, accepted: Partial<Record<Severity, number>> = {}): QaReport {
  const groups: QaReport['groups'] = []
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const sev of ['critical', 'warning', 'info'] as const) {
    const n = open[sev] ?? 0
    if (!n) continue
    counts[sev] = n
    groups.push({
      rule: rule(`open-${sev}`, sev),
      findings: Array.from({ length: n }, (_, i) => finding(`open-${sev}`, `E${i}`)),
    })
  }
  const ignored: QaReport['ignored'] = []
  for (const sev of ['critical', 'warning', 'info'] as const) {
    for (let i = 0; i < (accepted[sev] ?? 0); i++) {
      ignored.push({
        finding: finding(`acc-${sev}`, `A${i}`),
        rule: rule(`acc-${sev}`, sev),
        entry: { reason: 'agreed with the client', by: 'PN', at: '2026-01-01T00:00:00.000Z' },
      })
    }
  }
  return {
    groups, counts, ignored,
    total: counts.critical + counts.warning + counts.info,
    rulesEvaluated: 40, rulesDisabled: [],
    index: undefined as never,
  }
}

const criticalGate: IssueGate = { blockSeverities: ['critical'] }

describe('the conformance verdict', () => {
  it('a clean drawing is Conformant', () => {
    expect(evaluateConformance(report(), criticalGate).status).toBe('conformant')
  })

  it('info findings alone are Conformant — they were reported, not blocking', () => {
    expect(evaluateConformance(report({ info: 9 }), criticalGate).status).toBe('conformant')
  })

  it('an open warning under a critical-only gate is Conformant', () => {
    expect(evaluateConformance(report({ warning: 3 }), criticalGate).status).toBe('conformant')
  })

  it('an open warning under a warning gate is Non-conformant', () => {
    const gate: IssueGate = { blockSeverities: ['critical', 'warning'] }
    expect(evaluateConformance(report({ warning: 1 }), gate).status).toBe('non-conformant')
  })

  it('an open critical is Non-conformant', () => {
    expect(evaluateConformance(report({ critical: 1 }), criticalGate).status).toBe('non-conformant')
  })

  it('an accepted finding is Conformant WITH ACCEPTED FINDINGS — never plain Conformant', () => {
    const v = evaluateConformance(report({}, { critical: 1 }), criticalGate)
    expect(v.status).toBe('conformant-with-accepted')
    expect(v.accepted.critical).toBe(1)
    expect(v.open.total).toBe(0)
  })

  it('an accepted BLOCKED finding is Non-conformant when the house does not permit waivers', () => {
    const gate: IssueGate = { blockSeverities: ['critical'], allowAcceptedFindings: false }
    expect(evaluateConformance(report({}, { critical: 1 }), gate).status).toBe('non-conformant')
    // ...and an accepted finding at an UNBLOCKED severity still does not block.
    expect(evaluateConformance(report({}, { info: 1 }), gate).status).toBe('conformant-with-accepted')
  })

  it('with no gate at all nothing blocks, but accepted findings are still declared', () => {
    expect(evaluateConformance(report({ critical: 5 }), undefined).status).toBe('conformant')
    expect(evaluateConformance(report({}, { critical: 1 }), undefined).status).toBe('conformant-with-accepted')
  })

  it('no QA evaluation is Not evaluated, and is not mistaken for clean', () => {
    const v = evaluateConformance(undefined, criticalGate)
    expect(v.status).toBe('not-evaluated')
    expect(v.rulesEvaluated).toBe(0)
    expect(CONFORMANCE_LABEL[v.status]).toBe('Not evaluated')
  })

  it('carries the disabled checks through, so a verdict is never read alone', () => {
    const r = { ...report(), rulesEvaluated: 37, rulesDisabled: ['no-relief', 'orphan-binding'] }
    const v = evaluateConformance(r, criticalGate)
    expect(v.status).toBe('conformant')
    expect(v.rulesEvaluated).toBe(37)
    expect(v.rulesDisabled).toEqual(['no-relief', 'orphan-binding'])
  })

  it('counts open and accepted apart — they are never summed', () => {
    const r = report({ critical: 2, info: 1 }, { warning: 3 })
    const v = evaluateConformance(r, criticalGate)
    expect(v.open).toEqual({ critical: 2, warning: 0, info: 1, total: 3 })
    expect(v.accepted).toEqual({ critical: 0, warning: 3, info: 0, total: 3 })
    expect(acceptedCounts(r).total).toBe(3)
  })

  it('copies the policy rather than aliasing it', () => {
    const gate: IssueGate = { blockSeverities: ['critical'] }
    const v = evaluateConformance(report(), gate)
    gate.blockSeverities!.push('warning')
    expect(v.policyApplied!.blockSeverities).toEqual(['critical'])
  })

  it('is pure — the same report and gate give the same answer', () => {
    const r = report({ warning: 2 }, { info: 1 })
    expect(evaluateConformance(r, criticalGate)).toEqual(evaluateConformance(r, criticalGate))
  })
})

describe('why an issue is refused', () => {
  const subject = { status: 'IFC', checkedBy: '', approvedBy: '' }

  it('says nothing when there is no gate', () => {
    const r = report({ critical: 4 })
    expect(issueBlockers(subject, undefined, r, evaluateConformance(r, undefined))).toEqual([])
  })

  it('names the open findings that block, by severity and count', () => {
    const r = report({ critical: 2 })
    const reasons = issueBlockers(subject, criticalGate, r, evaluateConformance(r, criticalGate))
    expect(reasons).toEqual(['2 open critical findings.'])
  })

  it('uses the singular for one finding', () => {
    const r = report({ critical: 1 })
    expect(issueBlockers(subject, criticalGate, r, evaluateConformance(r, criticalGate)))
      .toEqual(['1 open critical finding.'])
  })

  it('names accepted findings separately when the house does not permit them', () => {
    const gate: IssueGate = { blockSeverities: ['critical'], allowAcceptedFindings: false }
    const r = report({}, { critical: 1 })
    const reasons = issueBlockers(subject, gate, r, evaluateConformance(r, gate))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('accepted critical')
    expect(reasons[0]).toContain('does not permit accepted findings')
  })

  it('requires a checker when the policy says so', () => {
    const gate: IssueGate = { requireChecker: true }
    const r = report()
    expect(issueBlockers(subject, gate, r, evaluateConformance(r, gate)))
      .toEqual(['A checker is required, and none is named.'])
    expect(issueBlockers({ ...subject, checkedBy: 'AB' }, gate, r, evaluateConformance(r, gate))).toEqual([])
    // Whitespace is not a name.
    expect(issueBlockers({ ...subject, checkedBy: '   ' }, gate, r, evaluateConformance(r, gate))).toHaveLength(1)
  })

  it('requires an approver when the policy says so', () => {
    const gate: IssueGate = { requireApprover: true }
    const r = report()
    expect(issueBlockers(subject, gate, r, evaluateConformance(r, gate)))
      .toEqual(['An approver is required, and none is named.'])
    expect(issueBlockers({ ...subject, approvedBy: 'CD' }, gate, r, evaluateConformance(r, gate))).toEqual([])
  })

  it('requires a QA evaluation — and a CLEAN report satisfies it', () => {
    const gate: IssueGate = { requireQaEvaluation: true }
    expect(issueBlockers(subject, gate, undefined, evaluateConformance(undefined, gate))).toHaveLength(1)
    // Zero findings is evaluated. No sentinel, no fake finding.
    const clean = report()
    expect(clean.total).toBe(0)
    expect(issueBlockers(subject, gate, clean, evaluateConformance(clean, gate))).toEqual([])
  })

  it('reports every reason at once, in a stable order', () => {
    const gate: IssueGate = { blockSeverities: ['critical', 'warning'], requireChecker: true, requireApprover: true }
    const r = report({ critical: 1, warning: 2 })
    const reasons = issueBlockers(subject, gate, r, evaluateConformance(r, gate))
    expect(reasons).toEqual([
      '1 open critical finding.',
      '2 open warning findings.',
      'A checker is required, and none is named.',
      'An approver is required, and none is named.',
    ])
  })
})

describe('reading a revision issued before conformance existed', () => {
  it('a recorded verdict is shown as recorded', () => {
    const rec = evaluateConformance(report({ warning: 1 }), criticalGate)
    const h = historicalConformance({ conformance: rec })
    expect(h.status).toBe('conformant')
    expect(h.countsOnly).toBe(false)
    expect(h.record).toBe(rec)
  })

  it('counts without evidence are Not recorded, and say the findings are missing', () => {
    const h = historicalConformance({ qaAtIssue: { critical: 1, warning: 2, info: 0, total: 3 } })
    expect(h.status).toBe('not-recorded')
    expect(h.countsOnly).toBe(true)
    expect(h.open.total).toBe(3)
  })

  it('counts WITH evidence are still Not recorded, but the findings survive', () => {
    const h = historicalConformance({
      qaAtIssue: { critical: 0, warning: 0, info: 0, total: 0 },
      qaEvidence: { findings: [], omitted: 0, capturedAt: '2026-01-01T00:00:00.000Z' },
    })
    expect(h.status).toBe('not-recorded')
    expect(h.countsOnly).toBe(false)
  })

  it('a bare legacy row is Not recorded with nothing invented', () => {
    const h = historicalConformance({})
    expect(h.status).toBe('not-recorded')
    expect(h.open).toEqual({ critical: 0, warning: 0, info: 0, total: 0 })
    expect(h.record).toBeUndefined()
  })
})
