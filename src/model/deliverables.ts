// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * WHICH DELIVERABLES NO LONGER MATCH THE LAST ISSUED MODEL?
 *
 * WHAT THIS ANSWERS, EXACTLY. Regenerate a report from the document as it
 * stands and from the document as it was when it was last issued, and see
 * whether the two files differ. That is the whole mechanism.
 *
 * WHAT IT DELIBERATELY DOES NOT ANSWER. Which files somebody downloaded,
 * which were generated, which were approved. This product cannot observe any
 * of those: `download()` clicks an anchor and is told nothing, and the PDF,
 * datasheet and loop-diagram paths write into a hidden iframe and call
 * `print()` — there is no file for the app to know about. Persisting a
 * `generatedAt` would be recording that somebody opened a menu.
 *
 * WHY NO HASH, AND NO DEPENDENCY MAP. The plan proposed an `inputHash` over a
 * declared `DELIVERABLE_INPUTS` map of what each report reads. That map would
 * be a second, hand-maintained model of the report beside the report that
 * actually reads the document — and the first time they drifted, staleness
 * would be quietly wrong. The generator is the authority on what belongs in
 * its own output, so the output is what gets compared. Every report here is
 * already asserted byte-identical for one document and none carries a
 * generated-at timestamp, which is what makes string equality exact.
 *
 * WHAT "THE LAST ISSUED MODEL" MEANS. Revisions are per SHEET; there is no
 * project revision and this does not invent one. `lastIssuedModel` names the
 * single most recently issued sheet revision in the document, and the snapshot
 * compared against is that revision's own — so the answer is always reported
 * against a real revision of a real sheet, by code and by date.
 *
 * SNAPSHOTS ARE LOCAL. They live in this machine's IndexedDB and never travel
 * in the `.pnid` (see persist/revisions.ts). A colleague opening the file gets
 * `no-snapshot`, which is the same degradation `compareRevisions` already
 * makes. A MISSING SNAPSHOT IS NEVER REPORTED AS `unchanged`: silence must not
 * read as agreement.
 *
 * RENDERINGS ARE NOT COMPARABLE, and say so rather than being hidden. An SVG
 * or a PDF re-renders geometry, a DXF is a drawing file, and the DEXPI export
 * stamps the export date in `PlantInformation`, so none of them is stable
 * between two runs for reasons that have nothing to do with engineering data.
 *
 * Everything here is pure, synchronous and DOM-free. The caller fetches the
 * snapshot — the shape `compareRevisions` already established.
 */

import type { ProjectDoc, Sheet } from './types'
import { lastIssued } from './revision'
import {
  datasheetMatrixCsv,
  equipmentListCsv,
  instrumentIndexCsv,
  ioListCsv,
  lineListCsv,
  loopListCsv,
  nozzleScheduleCsv,
  valveListCsv,
} from '../export/csv'

export type DeliverableId =
  | 'instrument-index' | 'io-list' | 'line-list' | 'equipment-list'
  | 'valve-list' | 'loop-list' | 'nozzle-schedule' | 'datasheet-matrix'
  | 'svg' | 'pdf-sheet' | 'pdf-all' | 'png' | 'dxf' | 'dexpi'

export interface Deliverable {
  id: DeliverableId
  /** Exactly the label the export menu prints, so the two lists read as one. */
  label: string
  /**
   * The deterministic generator, when there is one. ABSENT is what makes a
   * deliverable non-comparable, so a type cannot be listed as comparable
   * without something to compare.
   */
  generate?: (doc: ProjectDoc) => string
  /** Present exactly when `generate` is not — why this one cannot be compared. */
  notComparable?: string
}

/**
 * THE CATALOGUE IS THE EXPORT MENU.
 *
 * Every entry is a real generator this product already ships, in the menu's
 * own order, under the menu's own labels. Nothing is invented, and nothing the
 * menu offers is quietly left out — a reader who exports a DXF and does not
 * find it here would reasonably conclude it had been checked.
 */
export const DELIVERABLES: readonly Deliverable[] = [
  { id: 'svg', label: 'SVG image', notComparable: 'A rendering of the drawing, not a report of its data.' },
  { id: 'pdf-sheet', label: 'PDF — this sheet', notComparable: 'Printed through the browser; no file this product can read back.' },
  { id: 'pdf-all', label: 'PDF — all sheets', notComparable: 'Printed through the browser; no file this product can read back.' },
  { id: 'png', label: 'PNG image', notComparable: 'A rendering of the drawing, not a report of its data.' },
  { id: 'dxf', label: 'DXF (AutoCAD)', notComparable: 'A drawing file — geometry, which changes when a symbol is moved.' },
  // Real and deterministic apart from one attribute, which is enough to make
  // string comparison useless: `PlantInformation/@Date` is the export date.
  { id: 'dexpi', label: 'DEXPI XML', notComparable: 'Stamps the export date, so two exports of one document never match.' },
  { id: 'instrument-index', label: 'Instrument index', generate: instrumentIndexCsv },
  { id: 'io-list', label: 'I/O list', generate: ioListCsv },
  { id: 'line-list', label: 'Line list', generate: lineListCsv },
  { id: 'equipment-list', label: 'Equipment list', generate: equipmentListCsv },
  { id: 'valve-list', label: 'Valve list', generate: valveListCsv },
  { id: 'loop-list', label: 'Loop list', generate: loopListCsv },
  { id: 'nozzle-schedule', label: 'Nozzle schedule', generate: nozzleScheduleCsv },
  { id: 'datasheet-matrix', label: 'Datasheet matrix', generate: datasheetMatrixCsv },
]

/**
 *  - `unchanged`      — regenerating it today produces the same file.
 *  - `differs`        — it does not. The engineering model has moved since the
 *                       issue; this says nothing about whether that is wrong.
 *  - `no-snapshot`    — there is nothing to compare against. NEVER conflated
 *                       with `unchanged`.
 *  - `not-comparable` — the output is not stable between two runs for reasons
 *                       unrelated to engineering data.
 */
export type DeliverableState = 'unchanged' | 'differs' | 'no-snapshot' | 'not-comparable'

export interface DeliverableRow {
  id: DeliverableId
  label: string
  state: DeliverableState
  /** Why, for every state except the two that speak for themselves. */
  reason?: string
}

/** The issued model to compare against, named by the revision it actually is. */
export interface IssuedModel {
  sheetId: string
  sheetName: string
  drawingNumber: string
  /** The revision code as the title block prints it. */
  code: string
  issuedAt: string
  /** Absent when the revision was issued without a snapshot being kept. */
  snapshotId?: string
}

/**
 * The single most recently issued sheet revision in the document.
 *
 * ACROSS SHEETS, BY `issuedAt`. `lastIssued` answers the question per sheet in
 * array order, which is chronological within one sheet; comparing three sheets
 * needs the timestamp. Ties break on sheet id so two builds agree.
 *
 * This is NOT a project revision and must not become one. It is a pointer at a
 * real revision of a real sheet, which is why every field that identifies it
 * travels with it — a reader is told "PID-1001 Rev B, issued 4 Mar", never
 * "the project revision".
 */
export function lastIssuedModel(doc: ProjectDoc): IssuedModel | undefined {
  let best: { sheet: Sheet; issuedAt: string; code: string; snapshotId?: string } | undefined
  for (const sheet of doc.sheets) {
    const rev = lastIssued(sheet)
    if (!rev?.issuedAt) continue
    if (
      best === undefined ||
      rev.issuedAt > best.issuedAt ||
      (rev.issuedAt === best.issuedAt && sheet.id < best.sheet.id)
    ) {
      best = { sheet, issuedAt: rev.issuedAt, code: rev.code, ...(rev.snapshotId ? { snapshotId: rev.snapshotId } : {}) }
    }
  }
  if (!best) return undefined
  return {
    sheetId: best.sheet.id,
    sheetName: best.sheet.name,
    drawingNumber: best.sheet.drawingNumber,
    code: best.code,
    issuedAt: best.issuedAt,
    ...(best.snapshotId ? { snapshotId: best.snapshotId } : {}),
  }
}

/**
 * The issued side of the comparison, as the caller resolved it.
 *
 * A discriminated pair rather than `ProjectDoc | undefined`, because there are
 * three distinct ways to have no document and a reader deserves to be told
 * which: nothing has ever been issued, the revision kept no snapshot, or the
 * snapshot is simply not on this machine. The states are the same; the
 * sentences are not.
 */
export type IssuedInput =
  | { ok: true; doc: ProjectDoc }
  | { ok: false; reason: string }

/**
 * One row per deliverable, comparing today's output with the issued model's.
 *
 * TWO generations per comparable type, and the caller decides when to pay for
 * them — this is not cheap enough to run on a render. Nothing is cached here:
 * a cache keyed on a document that `touched()` replaces on every keystroke
 * would be a cache that never hits, and memoising belongs where the lifetime
 * is known.
 */
export function deliverableStatus(current: ProjectDoc, issued: IssuedInput): DeliverableRow[] {
  return DELIVERABLES.map((d): DeliverableRow => {
    if (!d.generate) {
      return { id: d.id, label: d.label, state: 'not-comparable', reason: d.notComparable }
    }
    if (!issued.ok) {
      return { id: d.id, label: d.label, state: 'no-snapshot', reason: issued.reason }
    }
    // The generator is the authority on what belongs in its own output, so the
    // output is what is compared. No hash, and no second model of what the
    // report reads that could drift away from the report.
    return {
      id: d.id,
      label: d.label,
      state: d.generate(current) === d.generate(issued.doc) ? 'unchanged' : 'differs',
    }
  })
}

/** How many rows are in each state — the sentence above the list. */
export function countStates(rows: readonly DeliverableRow[]): Record<DeliverableState, number> {
  const counts: Record<DeliverableState, number> = {
    unchanged: 0, differs: 0, 'no-snapshot': 0, 'not-comparable': 0,
  }
  for (const r of rows) counts[r.state] += 1
  return counts
}
