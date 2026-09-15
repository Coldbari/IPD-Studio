// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * WHERE DOES THIS PROJECT STAND?
 *
 * Every number the product needs to answer that already existed, in seven
 * workspaces, and nothing put them in one place. This does — and it computes
 * NONE of them itself.
 *
 * Counts come from the index. Completeness comes from the active standard's
 * required list and the same two accessors `required-field-empty` reads. QA
 * counts are the QA engine's own, handed in rather than recalculated. Budget is
 * `projectCost`. Revisions are `lastIssued`/`openRevisions`. A dashboard that
 * derived any of these separately would be a second source of truth, and the
 * first time it disagreed with the workspace it links to it would be worse than
 * having no dashboard at all.
 *
 * NOTHING HERE IS PERSISTED. No field of `ProjectDoc` changes, no schema moves.
 *
 * THE ONE HONEST ABSENCE: there is no deliverables figure. Tracking which
 * deliverables have been issued and whether they have gone stale is a real
 * capability this product does not have yet, and a tile reading "342 / 386"
 * would be a number nobody measured.
 *
 * Everything here is pure and DOM-free.
 */

import type { ProjectIndex } from './projectIndex'
import type { QaReport } from '../validate/engine'
import type { EntityKind } from './registry'
import type { Revision, Sheet } from './types'
import { requiredFor } from './standard'
import { recordFieldValue } from './hierarchy'
import { projectCost } from './costs'
import { lastIssued, openRevisions, revisionsOf } from './revision'

/** The four record kinds, in the order a dashboard reads them. */
export const HEALTH_KINDS: readonly EntityKind[] = ['equipment', 'line', 'instrument', 'valve']

export interface KindCompleteness {
  kind: EntityKind
  /** Started records of this kind — the denominator's population. */
  records: number
  /** Required-field slots across those records. */
  required: number
  /** How many of those slots hold a value. */
  filled: number
  /**
   * `filled / required`, or ABSENT when `required` is 0.
   *
   * Never 0 for "nothing to measure". A project with no started equipment
   * records is not 0% complete on equipment — it is a project that has not
   * begun specifying equipment, and the two read very differently to somebody
   * deciding whether a package can be issued. The UI prints `—`.
   */
  fraction?: number
}

export interface HealthCounts {
  /** Drawn symbols, by the DRAWING's own kind — the same selection the
   *  equipment and valve lists make, so the tiles and the tables agree. */
  equipment: number
  valves: number
  instruments: number
  /** PHYSICAL PIPING RUNS, which is what one line list row is. Never drawn
   *  edges: a pipe drawn in four segments is one line. */
  lines: number
  sheets: number
}

/** The QA engine's own counts, carried rather than recomputed. */
export interface QaSummary {
  critical: number
  warning: number
  info: number
  total: number
  /** Findings an engineer has explicitly accepted, with a reason on record. */
  accepted: number
  rulesEvaluated: number
  rulesDisabled: number
}

export interface BudgetHealth {
  currency: string
  /** Hardware subtotal and the installed total, exactly as `projectCost` has
   *  always reported them. */
  hardware: number
  total: number
  /** Symbols carrying no price anywhere — the estimate's own caveat. */
  unpriced: number
  /** The target, when one has been set. */
  target?: number
  /** `total / target`, ABSENT when no usable target is set. Never 0, and never
   *  Infinity: a project with no budget has not spent 0% of it. */
  fraction?: number
}

export interface SheetRevisionHealth {
  sheetId: string
  sheetName: string
  drawingNumber: string
  /** The code the title block prints — `lastIssued` where there is one. */
  code: string
  issued: boolean
  issuedAt?: string
  date: string
  description: string
  /** Rows drafted and not yet issued. */
  open: number
}

export interface ProjectHealth {
  counts: HealthCounts
  completeness: {
    byKind: KindCompleteness[]
    /** Field-weighted across every kind, or ABSENT when nothing is started. */
    overall?: number
    /** Records counted in the denominator, for the sentence under the bar. */
    records: number
  }
  qa: QaSummary
  budget: BudgetHealth
  /** One row per sheet, in document order. */
  revisions: SheetRevisionHealth[]
}

/**
 * HAS SOMEBODY STARTED THIS RECORD?
 *
 * Lifted verbatim from `required-field-empty`, because the two must not be able
 * to disagree about who is being measured. A record nobody has begun is not an
 * omission — an untagged pump on a fresh drawing would otherwise drag the whole
 * project to 0% and teach everyone to ignore the number.
 *
 * A unit assignment counts as started on its own: filing an object under a unit
 * is a decision somebody made about it.
 */
function isStarted(record: { unitId?: string; fields: Record<string, string> } | undefined): boolean {
  if (!record) return false
  return record.unitId !== undefined || Object.values(record.fields).some((v) => v.trim() !== '')
}

/**
 * ENGINEERING COMPLETENESS.
 *
 * ```
 *   required-field slots holding a value
 *   ------------------------------------   over STARTED records of one kind
 *   required-field slots on those records
 * ```
 *
 * Field-weighted, not object-weighted. Within one kind the two are identical —
 * every record of a kind is asked for the same list — and across kinds the
 * field-weighted roll-up is the one that does not let a kind with one required
 * field outweigh a kind with six.
 *
 * WHICH RECORDS. Those whose key is currently on a sheet. An orphaned record is
 * `orphan-record`'s finding, and counting its blank fields here would report one
 * problem twice and drag a number an engineer is reading for a different reason.
 *
 * WHAT COUNTS AS REQUIRED comes from `requiredFor` — the active standard's own
 * list, the same call the rule makes. Optional fields are not counted, and this
 * file does not have a second opinion about what "required" means.
 *
 * WHAT COUNTS AS FILLED comes from `recordFieldValue`, which knows a Unit and a
 * Loop are references on the record rather than strings in `fields`, with the
 * legacy per-node `datasheet` behind it — again exactly what the rule reads, so
 * a document written before the registry existed is measured on what it has.
 */
function completenessOf(ix: ProjectIndex, kind: EntityKind): KindCompleteness {
  const fields = requiredFor(ix.standard, kind)
  let records = 0
  let required = 0
  let filled = 0

  if (fields.length > 0) {
    for (const key of Object.keys(ix.records)) {
      const record = ix.records[key]!
      if (record.kind !== kind || !ix.liveKeys.has(key)) continue
      if (!isStarted(record)) continue
      records += 1
      required += fields.length
      // The legacy fallback, for a document that predates the registry. Nodes
      // only: an edge has never had a `datasheet` to fall back to.
      const legacy = ix.nodesByKey.get(key)?.[0]?.node.datasheet
      for (const field of fields) {
        const value = recordFieldValue(record, field) || legacy?.[field] || ''
        if (value.trim() !== '') filled += 1
      }
    }
  }

  return {
    kind,
    records,
    required,
    filled,
    // Absent rather than 0 — see `fraction`.
    ...(required > 0 ? { fraction: filled / required } : {}),
  }
}

function revisionHealth(sheet: Sheet): SheetRevisionHealth {
  const issued: Revision | undefined = lastIssued(sheet)
  const rows = revisionsOf(sheet)
  const latest = issued ?? rows[rows.length - 1]
  return {
    sheetId: sheet.id,
    sheetName: sheet.name,
    drawingNumber: sheet.drawingNumber,
    // The stored string when the sheet has no revision table at all, which is
    // every document written before schema 6.
    code: latest?.code ?? sheet.revision,
    issued: Boolean(issued),
    ...(issued?.issuedAt ? { issuedAt: issued.issuedAt } : {}),
    date: latest?.date ?? '',
    description: latest?.description ?? '',
    open: openRevisions(sheet).length,
  }
}

/**
 * One health projection for one document.
 *
 * `qa` is HANDED IN rather than computed, for the reason the whole file exists:
 * the QA engine is the authority on what a finding is, the editor already keeps
 * exactly one report per document, and a dashboard that ran the rules again
 * could show a different number from the badge beside it.
 *
 * The standard is read off `ix.standard`, which `buildIndex` has already
 * resolved — so nothing here has to remember that an absent standard means the
 * default, which is the same reason no rule has to.
 *
 * ONE PASS over the records, one over the nodes, one over the sheets. Never a
 * `find` inside a loop, and never a second `buildIndex`: the caller has already
 * paid for one.
 */
export function projectHealth(ix: ProjectIndex, qa: QaReport): ProjectHealth {
  let equipment = 0
  let valves = 0
  let instruments = 0
  for (const indexed of ix.allNodes) {
    // The DRAWING's own kind, which is what the equipment and valve lists
    // select on. `kindOfNode` maps a tagged fitting onto the equipment RECORD
    // kind — right for storage, and wrong for a count an engineer reads as
    // "how much equipment is on this plant".
    if (indexed.node.kind === 'equipment') equipment += 1
    else if (indexed.node.kind === 'valve') valves += 1
    else if (indexed.node.kind === 'instrument') instruments += 1
  }

  const byKind = HEALTH_KINDS.map((kind) => completenessOf(ix, kind))
  const required = byKind.reduce((n, k) => n + k.required, 0)
  const filled = byKind.reduce((n, k) => n + k.filled, 0)

  const cost = projectCost(ix.doc)
  const target = ix.doc.budget?.total
  // A target of 0 is not a budget. Dividing by it would print Infinity.
  const usable = typeof target === 'number' && Number.isFinite(target) && target > 0

  return {
    counts: { equipment, valves, instruments, lines: ix.runs.length, sheets: ix.doc.sheets.length },
    completeness: {
      byKind,
      records: byKind.reduce((n, k) => n + k.records, 0),
      ...(required > 0 ? { overall: filled / required } : {}),
    },
    qa: {
      critical: qa.counts.critical,
      warning: qa.counts.warning,
      info: qa.counts.info,
      total: qa.total,
      accepted: qa.ignored.length,
      rulesEvaluated: qa.rulesEvaluated,
      rulesDisabled: qa.rulesDisabled.length,
    },
    budget: {
      currency: ix.doc.budget?.currency ?? 'USD',
      hardware: cost.hardware,
      total: cost.total,
      unpriced: cost.unpriced,
      ...(usable ? { target, fraction: cost.total / target } : {}),
    },
    revisions: ix.doc.sheets.map(revisionHealth),
  }
}

/**
 * A fraction as a percentage, or `—` where there is nothing to measure.
 *
 * The one formatter, so a tile cannot print `0%` for an absent denominator by
 * forgetting to check. `Math.round` rather than a fixed decimal: a dashboard
 * percentage is read at a glance, and 82.4% is not more true than 82%.
 */
export const percentText = (fraction: number | undefined): string =>
  fraction === undefined || !Number.isFinite(fraction) ? '—' : `${Math.round(fraction * 100)}%`
