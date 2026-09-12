// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * CONFORMANCE — the verdict, not a second checker.
 *
 * Everything here is a FOLD over a QA report that has already been computed.
 * There is exactly one validation engine in this product (`validate/engine`),
 * and conformance deliberately owns no rules, walks no document and builds no
 * index. If this file ever needs to look at a node, something has gone wrong.
 *
 * The word is "conformant", never "compliant". Compliance is a legal claim
 * about a real standard; what this can honestly say is that the drawing meets
 * the rules the house configured, evaluated by the checks that were switched
 * on. Those are different sentences and only one of them is true.
 *
 * A verdict is therefore never reported alone. It always travels with what it
 * was computed from — open counts, accepted counts, how many rules ran, and
 * which rules were switched off — because "Conformant" with nine checks
 * disabled is not the same document as "Conformant" with all of them on, and a
 * reader must be able to see the difference without being told.
 */

import type { Severity } from '../validate/rules'
import type { QaReport } from '../validate/engine'
import type { IssueGate } from './standard'
import type { QaEvidence } from './provenance'

export type ConformanceStatus =
  /** Evaluated; nothing open at a blocked severity; nothing accepted. */
  | 'conformant'
  /** Evaluated and not blocked, but findings were waived with a reason. */
  | 'conformant-with-accepted'
  /** At least one finding blocks issue under the policy applied. */
  | 'non-conformant'
  /** No QA evaluation was available, and the policy did not demand one. */
  | 'not-evaluated'
  /** Issued before conformance was recorded. Never inferred — see below. */
  | 'not-recorded'

export const CONFORMANCE_LABEL: Record<ConformanceStatus, string> = {
  conformant: 'Conformant',
  'conformant-with-accepted': 'Conformant with accepted findings',
  'non-conformant': 'Non-conformant',
  'not-evaluated': 'Not evaluated',
  'not-recorded': 'Not recorded',
}

export interface ConformanceCounts {
  critical: number
  warning: number
  info: number
  total: number
}

/**
 * The frozen verdict stored on an issued revision.
 *
 * Deliberately does NOT carry the findings. `Revision.qaEvidence` is the single
 * source of truth for what was found; duplicating the list here would create
 * two records that can disagree, and the one a reader happened to open would
 * decide what they believed.
 */
export interface ConformanceRecord {
  status: ConformanceStatus
  /** The gate in force at issue, copied. Absent means the status was ungated —
   *  which is information, not a gap. */
  policyApplied?: IssueGate
  open: ConformanceCounts
  accepted: ConformanceCounts
  rulesEvaluated: number
  rulesDisabled: string[]
}

export const EMPTY_COUNTS: ConformanceCounts = { critical: 0, warning: 0, info: 0, total: 0 }

function emptyCounts(): ConformanceCounts {
  return { critical: 0, warning: 0, info: 0, total: 0 }
}

/** Open findings, by effective severity. */
export function openCounts(report: QaReport): ConformanceCounts {
  return {
    critical: report.counts.critical,
    warning: report.counts.warning,
    info: report.counts.info,
    total: report.total,
  }
}

/**
 * Accepted (ignored) findings, by effective severity.
 *
 * These are NOT in `report.counts` — `runRules` counts live findings only —
 * which is exactly why they need counting separately rather than being
 * subtracted from something. An accepted finding has not gone away; it has
 * been waived, with a reason, by a named person, and that is a different
 * engineering statement from "fixed".
 */
export function acceptedCounts(report: QaReport): ConformanceCounts {
  const out = emptyCounts()
  for (const { rule } of report.ignored) {
    out[rule.severity] += 1
    out.total += 1
  }
  return out
}

function blockedSum(counts: ConformanceCounts, severities: readonly Severity[]): number {
  let n = 0
  for (const sev of severities) n += counts[sev]
  return n
}

/**
 * The verdict for one QA report under one gate.
 *
 * PURE: same report and same gate, same answer, every time, on any machine.
 * Passing `undefined` for the report means "no evaluation was available",
 * which is a real state for a caller that has none — not a zero-finding one.
 *
 * `not-recorded` is never returned here. It describes a revision issued before
 * conformance existed, and only the reader of that revision can know it; the
 * evaluator would have to invent history to produce it.
 */
export function evaluateConformance(report: QaReport | undefined, gate: IssueGate | undefined): ConformanceRecord {
  if (!report) {
    return {
      status: 'not-evaluated',
      ...(gate ? { policyApplied: copyGate(gate) } : {}),
      open: emptyCounts(),
      accepted: emptyCounts(),
      rulesEvaluated: 0,
      rulesDisabled: [],
    }
  }

  const open = openCounts(report)
  const accepted = acceptedCounts(report)
  const blocked = gate?.blockSeverities ?? []
  // Default true: waiving a finding with a written reason is the ordinary
  // engineering escape. A house sets this false when it means "fix it".
  const allowAccepted = gate?.allowAcceptedFindings ?? true

  let status: ConformanceStatus
  if (blockedSum(open, blocked) > 0) status = 'non-conformant'
  else if (!allowAccepted && blockedSum(accepted, blocked) > 0) status = 'non-conformant'
  else if (accepted.total > 0) status = 'conformant-with-accepted'
  else status = 'conformant'

  return {
    status,
    ...(gate ? { policyApplied: copyGate(gate) } : {}),
    open,
    accepted,
    rulesEvaluated: report.rulesEvaluated,
    rulesDisabled: [...report.rulesDisabled],
  }
}

/** A detached copy — a stored policy must not alias the live standard. */
export function copyGate(gate: IssueGate): IssueGate {
  return {
    ...(gate.blockSeverities ? { blockSeverities: [...gate.blockSeverities] } : {}),
    ...(gate.allowAcceptedFindings !== undefined ? { allowAcceptedFindings: gate.allowAcceptedFindings } : {}),
    ...(gate.requireChecker !== undefined ? { requireChecker: gate.requireChecker } : {}),
    ...(gate.requireApprover !== undefined ? { requireApprover: gate.requireApprover } : {}),
    ...(gate.requireQaEvaluation !== undefined ? { requireQaEvaluation: gate.requireQaEvaluation } : {}),
  }
}

/* ------------------------------------------------------------- the gate */

/** What the revision row has to offer the gate. Only the fields a gate asks
 *  about — the gate has no business reading the rest of the row. */
export interface IssueSubject {
  status: string
  checkedBy?: string
  approvedBy?: string
}

/**
 * Why this issue cannot proceed — plain sentences an engineer can act on,
 * in a deterministic order.
 *
 * Empty means the issue may proceed. The list is the same whether it is
 * computed to grey out a button or computed inside the mutation to refuse the
 * write, because it is literally the same function: a gate that the UI and the
 * store evaluate separately is a gate with two opinions.
 */
export function issueBlockers(
  subject: IssueSubject,
  gate: IssueGate | undefined,
  report: QaReport | undefined,
  verdict: ConformanceRecord,
): string[] {
  if (!gate) return []
  const reasons: string[] = []

  if (gate.requireQaEvaluation && !report) {
    reasons.push('A QA evaluation is required before issuing at this status, and none is available.')
  }

  const blocked = gate.blockSeverities ?? []
  if (report) {
    for (const sev of (['critical', 'warning', 'info'] as const)) {
      if (!blocked.includes(sev)) continue
      const n = verdict.open[sev]
      if (n > 0) reasons.push(`${n} open ${sev} finding${n === 1 ? '' : 's'}.`)
    }
    if (gate.allowAcceptedFindings === false) {
      for (const sev of (['critical', 'warning', 'info'] as const)) {
        if (!blocked.includes(sev)) continue
        const n = verdict.accepted[sev]
        if (n > 0) {
          reasons.push(`${n} accepted ${sev} finding${n === 1 ? '' : 's'} — this status does not permit accepted findings.`)
        }
      }
    }
  }

  if (gate.requireChecker && !subject.checkedBy?.trim()) reasons.push('A checker is required, and none is named.')
  if (gate.requireApprover && !subject.approvedBy?.trim()) reasons.push('An approver is required, and none is named.')

  return reasons
}

/* ------------------------------------------------- reading old revisions */

/**
 * How to present a revision that predates conformance.
 *
 * Three genuinely different states, and collapsing them would be a lie of the
 * exact kind this phase exists to remove:
 *
 *  - `conformance` recorded  → show the frozen verdict.
 *  - only `qaAtIssue`        → counts were recorded, the findings were not.
 *  - neither                 → nothing was recorded at all.
 *
 * Nothing is ever recomputed from today's standard. A verdict produced now
 * would describe this afternoon's rules, not the ones the drawing was issued
 * under, and stamping it onto a historical row would be fabricating provenance.
 */
export interface HistoricalConformance {
  record?: ConformanceRecord
  status: ConformanceStatus
  /** True when counts survive but the findings behind them do not. */
  countsOnly: boolean
  open: ConformanceCounts
}

export function historicalConformance(rev: {
  conformance?: ConformanceRecord
  qaAtIssue?: ConformanceCounts
  qaEvidence?: QaEvidence
}): HistoricalConformance {
  if (rev.conformance) {
    return { record: rev.conformance, status: rev.conformance.status, countsOnly: false, open: rev.conformance.open }
  }
  if (rev.qaAtIssue) {
    return { status: 'not-recorded', countsOnly: !rev.qaEvidence, open: { ...rev.qaAtIssue } }
  }
  return { status: 'not-recorded', countsOnly: false, open: emptyCounts() }
}
