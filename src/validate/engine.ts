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
 * Translate a rule-finding message. Exact dictionary hits come back through
 * the t() dictionary; the pattern table then catches the parameterised
 * messages ("Line … is used more than once") whose interpolations keep them
 * out of the dictionary. Shared by the Checks workspace and the drawing-side
 * Issues panel so the two never disagree about wording.
 */
export function findingText(message: string, t: (text: string) => string): string {
  const exact = t(message)
  if (exact !== message) return exact
  const patterns: [RegExp, string][] = [
    [/^(.+) has no relief device connected — intended\?$/, '$1 没有连接泄放装置 — 是否符合预期？'],
    [/^Line has an unterminated free end$/, '管线存在未终止的自由端'],
    [/^Line is attached at neither end$/, '管线两端均未连接'],
    [/^Line (.+) has no service or fluid assigned$/, '管线 $1 未指定介质或服务'],
    [/^(.+) has no tag$/, '$1 没有位号'],
    [/^"(.+)" has no tag, so it carries no record$/, '“$1”没有位号，因此没有工程记录'],
    [/^(.+) is not connected to anything$/, '$1 未连接到任何对象'],
    [/^(.+) is used more than once$/, '$1 被重复使用'],
    [/^Line number (.+) is used more than once$/, '管线号 $1 被重复使用'],
    [/^(.+) is not linked to another sheet$/, '$1 未关联到其他图纸'],
    [/^(.+) points at a missing sheet or connector$/, '$1 指向缺失的图纸或连接器'],
    [/^(.+) measures but nothing receives it — add an indicator or controller\?$/, '$1 正在测量，但没有指示器或控制器接收 — 是否添加？'],
    [/^(.+) controls nothing — where is its valve\?$/, '$1 未控制任何对象 — 阀门在哪里？'],
    [/^(.+) has no failure position \(FC \/ FO \/ FL\)$/, '$1 没有故障位置（FC / FO / FL）'],
    [/^(.+) is the only instrument on loop (.+)$/, '$1 是回路 $2 上唯一的仪表'],
    [/^(.+) is missing (.+)$/, '$1 缺少 $2'],
    [/^(.+) numbering skips (.+)$/, '$1 编号跳过 $2'],
    [/^(.+) is a valve tag on an instrument bubble — did you mean the valve symbol\?$/, '$1 是阀门位号却使用了仪表气泡 — 是否应改用阀门符号？'],
    [/^A (.+) line connects incompatible ports$/, '$1 管线连接了不兼容的连接点'],
    [/^Two identical lines connect the same two points — delete one\?$/, '两条相同管线连接同一对连接点 — 是否删除一条？'],
    [/^Electric signal drives (.+) with a pneumatic actuator — insert an I\/P converter$/, '电信号驱动带气动执行器的 $1 — 请插入 I/P 转换器'],
  ]
  for (const [pattern, translated] of patterns) {
    const match = message.match(pattern)
    if (match) return translated.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? '')
  }
  return message
}

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

  for (const rule of ALL_RULES) {
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
