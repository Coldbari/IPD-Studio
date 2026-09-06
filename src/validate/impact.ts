// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectDoc } from '../model/types'
import { standardOf, type StandardProfile } from '../model/standard'
import { buildIndex } from '../model/projectIndex'
import { runRules } from './engine'
import type { Rule, RuleFinding, Severity } from './rules'

/**
 * What applying a standard would do, before it is applied.
 *
 * This is the detail that decides whether the feature is used at all. Nobody
 * turns a new convention on over a live project on faith — the question is
 * always "how much does this light up?", and a checker that cannot answer it
 * gets switched on once, floods the report, and is switched off for good.
 *
 * It is computed by running the real engine twice, over the same document,
 * with two profiles. Not by reasoning about what the rules *would* say: a
 * preview derived separately from the checker is a second implementation that
 * will eventually disagree with it, and the moment it does the number becomes
 * worthless. Running the engine is the only way the preview count and the
 * post-apply count are guaranteed equal.
 */

export interface RuleDelta {
  rule: Rule
  added: number
  removed: number
}

export interface StandardImpact {
  /** Findings that appear only under the candidate profile. */
  added: RuleFinding[]
  /** Findings the candidate profile silences. */
  removed: RuleFinding[]
  /** Per rule, only where something changes. Sorted by size of change. */
  byRule: RuleDelta[]
  countsBefore: Record<Severity, number>
  countsAfter: Record<Severity, number>
  totalBefore: number
  totalAfter: number
}

/**
 * Deliberately bypasses `qaFor`'s cache. That cache is keyed on document
 * identity and holds exactly one entry; running a hypothetical profile through
 * it would evict the report the whole UI is reading and hand the next caller a
 * report for a standard the project has not adopted.
 */
function reportFor(doc: ProjectDoc, standard: StandardProfile) {
  const ignored = doc.qa?.ignored ?? {}
  return runRules(buildIndex({ ...doc, standard }), ignored)
}

export function previewStandard(
  doc: ProjectDoc,
  candidate: StandardProfile,
  current: StandardProfile = standardOf(doc),
): StandardImpact {
  const before = reportFor(doc, current)
  const after = reportFor(doc, candidate)

  const flatten = (groups: { rule: Rule; findings: RuleFinding[] }[]) => {
    const byKey = new Map<string, RuleFinding>()
    const rules = new Map<string, Rule>()
    for (const g of groups) {
      rules.set(g.rule.id, g.rule)
      for (const f of g.findings) byKey.set(f.key, f)
    }
    return { byKey, rules }
  }

  const b = flatten(before.groups)
  const a = flatten(after.groups)

  const added = [...a.byKey.values()].filter((f) => !b.byKey.has(f.key))
  const removed = [...b.byKey.values()].filter((f) => !a.byKey.has(f.key))

  const deltas = new Map<string, RuleDelta>()
  const bump = (ruleId: string, field: 'added' | 'removed') => {
    const rule = a.rules.get(ruleId) ?? b.rules.get(ruleId)
    if (!rule) return
    const d = deltas.get(ruleId) ?? { rule, added: 0, removed: 0 }
    d[field]++
    deltas.set(ruleId, d)
  }
  for (const f of added) bump(f.ruleId, 'added')
  for (const f of removed) bump(f.ruleId, 'removed')

  return {
    added,
    removed,
    byRule: [...deltas.values()].sort(
      (x, y) => y.added + y.removed - (x.added + x.removed) || x.rule.title.localeCompare(y.rule.title),
    ),
    countsBefore: before.counts,
    countsAfter: after.counts,
    totalBefore: before.total,
    totalAfter: after.total,
  }
}
