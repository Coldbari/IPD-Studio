// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectDoc } from '../model/types'
import { buildIndex, type ProjectIndex } from '../model/projectIndex'
import type { Rule, RuleFinding, Severity } from './rules'
import { ALL_RULES } from './rules/index'

export interface IgnoredEntry {
  reason: string
  by?: string
  at: string
}

export interface ReportGroup {
  rule: Rule
  findings: RuleFinding[]
}

export interface QaReport {
  /** Live findings, grouped by rule, ordered critical → warning → info. */
  groups: ReportGroup[]
  counts: Record<Severity, number>
  /** Findings the user has explicitly accepted, with their reason. */
  ignored: { finding: RuleFinding; rule: Rule; entry: IgnoredEntry }[]
  total: number
  index: ProjectIndex
}

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/**
 * Run every rule over one index.
 *
 * A rule that throws is contained: a bad rule must never take the whole report
 * down, because then a single edge case would hide every other finding on the
 * drawing. It is reported as a finding against itself instead.
 */
export function runRules(ix: ProjectIndex, ignored: Record<string, IgnoredEntry> = {}): QaReport {
  const groups: ReportGroup[] = []
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  const suppressed: QaReport['ignored'] = []

  // The active standard may force a rule to a different severity, or silence
  // it outright. Applied HERE rather than in each rule so that every consumer —
  // the report, the counts, the rail badge, the status bar — sees one severity
  // and cannot disagree about how serious a finding is.
  const overrides = ix.standard.severityOverrides ?? {}

  for (const baseRule of ALL_RULES) {
    const override = overrides[baseRule.id]
    if (override === 'off') continue
    // A shallow clone, so `group.rule.severity` is the EFFECTIVE severity and
    // no consumer has to know overrides exist.
    const rule: Rule = override ? { ...baseRule, severity: override } : baseRule

    let produced: RuleFinding[]
    try {
      produced = rule.run(ix)
    } catch (err) {
      produced = [
        {
          ruleId: rule.id,
          key: `__rule-error:${rule.id}`,
          entityKey: rule.id,
          message: `This check could not run: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]
    }

    // One finding per (rule, entity). A rule that walks NODES will emit the
    // same key twice when two symbols wear one tag — and since the key is the
    // engineering identity, those are one entity, so reporting it twice is
    // noise and accepting one would silently accept both. The duplicate TAG
    // itself is still reported, by the rule whose subject is the duplication.
    const live: RuleFinding[] = []
    const seen = new Set<string>()
    for (const f of produced) {
      if (seen.has(f.key)) continue
      seen.add(f.key)
      const entry = ignored[f.key]
      if (entry) suppressed.push({ finding: f, rule, entry })
      else live.push(f)
    }
    if (live.length) {
      groups.push({ rule, findings: live })
      counts[rule.severity] += live.length
    }
  }

  groups.sort(
    (a, b) =>
      ORDER[a.rule.severity] - ORDER[b.rule.severity] ||
      a.rule.discipline.localeCompare(b.rule.discipline) ||
      a.rule.title.localeCompare(b.rule.title),
  )

  return {
    groups,
    counts,
    ignored: suppressed,
    total: counts.critical + counts.warning + counts.info,
    index: ix,
  }
}

/**
 * One report per document, however many panels ask — the status bar, the rail
 * badge, the drawer and the Checks workspace all read this.
 */
let cache: { doc: ProjectDoc; ignored: unknown; value: QaReport } | null = null

/** A stable stand-in for "no ignores". A fresh `{}` per call would make the
 *  identity check below always fail, quietly re-running every rule on every
 *  render — which is the whole thing this cache exists to prevent. */
const NO_IGNORES: Record<string, IgnoredEntry> = {}

export function qaFor(doc: ProjectDoc): QaReport {
  const ignored = doc.qa?.ignored ?? NO_IGNORES
  if (cache && cache.doc === doc && cache.ignored === ignored) return cache.value
  const value = runRules(buildIndex(doc), ignored)
  cache = { doc, ignored, value }
  return value
}

/** Test seam — the cache would otherwise leak between cases. */
export function resetQaCache(): void {
  cache = null
}
