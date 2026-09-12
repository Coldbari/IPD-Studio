// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { SHEET_SIZES_MM, sheetPx } from '../model/doc'
import type { ProjectDoc, Sheet } from '../model/types'
import { INITIAL_REVISION_CODE, isIssued, lastIssued, openRevisions, revisionsOf } from '../model/revision'
import { provenanceLabel, standardProvenance } from '../model/provenance'
import { standardOf } from '../model/standard'
import { activeSheet } from '../store/store'
import { canvasRef } from '../canvas/paperSetup'
import { withEveryCellRendered } from '../canvas/viewport'
import { useStore } from '../store/store'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * THE CONTROLLED TITLE BLOCK.
 *
 * One rule decides everything in here: **the sheet must describe the revision
 * that was issued, not the moment somebody pressed print.**
 *
 * The old block stamped `new Date()` into the DATE field. Print an issued Rev
 * B tomorrow and it came out dated tomorrow — a falsified date on a controlled
 * drawing, and the most consequential thing this program fixes. The date now
 * comes off the revision row: what the engineer dated it, or failing that when
 * it was issued.
 *
 * The second rule: NEVER INVENT A VALUE. A project that has not filled in a
 * client prints an em dash. A revision issued before provenance existed prints
 * "not recorded". Neither is padded with a plausible-looking guess.
 *
 * This is the one implementation. SVG, PNG, PDF-this-sheet and PDF-all-sheets
 * all reach it through `exportSvg`, so they cannot disagree about what was
 * issued.
 */

const BLOCK_W = 560
const BLOCK_H = 150
/** Revision rows printed above the title block, newest first. */
const REV_ROWS = 6
const REV_ROW_H = 15
const MARGIN = 24

/** Nothing recorded. An em dash, never a plausible-looking guess. */
const NONE = '—'
const show = (v: string | undefined): string => (v && v.trim() ? v.trim() : NONE)

/**
 * What the sheet is currently at, and whether that is an issue or work in
 * progress.
 *
 * A drawing with an open revision after its last issue IS work in progress,
 * and saying so is the point: an engineer must be able to tell a printed
 * controlled document from a printed draft at a glance.
 */
interface SheetState {
  code: string
  date: string
  status: string
  preparedBy: string
  checkedBy: string
  approvedBy: string
  issued: boolean
  /** The provenance line, already resolved. */
  standard: string
}

function sheetState(doc: ProjectDoc, sheet: Sheet): SheetState {
  const open = openRevisions(sheet)
  const working = open[open.length - 1]
  const issued = lastIssued(sheet)
  const row = working ?? issued

  if (!row) {
    return {
      code: sheet.revision || INITIAL_REVISION_CODE,
      date: '', status: '', preparedBy: '', checkedBy: '', approvedBy: '',
      issued: false,
      standard: provenanceLabel(standardProvenance(standardOf(doc))),
    }
  }

  const isIssuedRow = !working && Boolean(issued)
  return {
    code: row.code,
    // The engineer's own date first; the issue timestamp only as a fallback,
    // and nothing at all for a row nobody has dated or issued.
    date: row.date || (row.issuedAt ? row.issuedAt.slice(0, 10) : ''),
    status: row.status,
    preparedBy: row.preparedBy,
    checkedBy: row.checkedBy ?? '',
    approvedBy: row.approvedBy ?? '',
    issued: isIssuedRow,
    standard: isIssuedRow
      ? row.standard
        ? provenanceLabel(row.standard)
        : 'not recorded'
      : provenanceLabel(standardProvenance(standardOf(doc))),
  }
}

/** Sheet border, revision table and bottom-right title block, in sheet px. */
export function titleBlockSvg(doc: ProjectDoc, sheet: Sheet): string {
  const { w, h } = sheetPx(sheet.sheetSize)
  const bx = w - MARGIN - BLOCK_W
  const by = h - MARGIN - BLOCK_H
  const st = sheetState(doc, sheet)
  const sheetNo = doc.sheets.findIndex((s) => s.id === sheet.id) + 1

  const line = (x1: number, y1: number, x2: number, y2: number, weight = 1) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="${weight}"/>`
  const label = (x: number, y: number, t: string) =>
    `<text x="${x}" y="${y}" font-family="sans-serif" font-size="7" fill="#666" letter-spacing="0.4">${esc(t)}</text>`
  const value = (x: number, y: number, t: string, size = 11) =>
    `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${size}" fill="#111">${esc(t)}</text>`

  /** One labelled cell of the block, positioned relative to the block corner. */
  const cell = (x: number, y: number, cw: number, ch: number, name: string, v: string, size = 11) =>
    line(bx + x, by + y, bx + x + cw, by + y) +
    (x > 0 ? line(bx + x, by + y, bx + x, by + y + ch) : '') +
    label(bx + x + 6, by + y + 11, name) +
    value(bx + x + 6, by + y + 26, v, size)

  const L = 340 // left/right column split

  return (
    `<g class="title-block">` +
    `<rect x="${MARGIN}" y="${MARGIN}" width="${w - 2 * MARGIN}" height="${h - 2 * MARGIN}" fill="none" stroke="#111" stroke-width="1.5"/>` +
    revisionTableSvg(sheet, bx, by) +
    `<rect x="${bx}" y="${by}" width="${BLOCK_W}" height="${BLOCK_H}" fill="#fff" stroke="#111" stroke-width="1.5"/>` +
    line(bx + L, by, bx + L, by + 130) +

    // --- left column: what the document is ---
    label(bx + 6, by + 11, 'DRAWING TITLE') +
    value(bx + 6, by + 30, `${doc.meta.name || 'Untitled'} — ${sheet.name}`, 13) +
    cell(0, 44, L, 32, 'CLIENT', show(doc.meta.client)) +
    cell(170, 44, L - 170, 32, 'PROJECT No.', show(doc.meta.projectNumber)) +
    cell(0, 76, L, 32, 'PLANT / FACILITY', show(doc.meta.plant)) +
    cell(170, 76, L - 170, 32, 'DISCIPLINE', show(doc.meta.discipline)) +
    cell(0, 108, L, 22, 'PREPARED', show(st.preparedBy), 10) +
    cell(113, 108, 114, 22, 'CHECKED', show(st.checkedBy), 10) +
    cell(227, 108, L - 227, 22, 'APPROVED', show(st.approvedBy), 10) +

    // --- right column: which controlled issue this is ---
    cell(L, 0, BLOCK_W - L, 44, 'DOCUMENT No.', show(doc.meta.documentNumber), 12) +
    cell(L, 44, BLOCK_W - L, 32, 'DRAWING No.', show(sheet.drawingNumber), 12) +
    cell(L, 76, 60, 32, 'REV', st.code, 13) +
    cell(L + 60, 76, BLOCK_W - L - 60, 32, 'ISSUE DATE', show(st.date)) +
    cell(L, 108, 120, 22, 'STATUS', st.issued ? show(st.status) : 'NOT ISSUED', 10) +
    cell(L + 120, 108, BLOCK_W - L - 120, 22, 'SHEET', `${sheetNo} of ${doc.sheets.length}`, 10) +

    // --- conformance stamp, across the foot ---
    line(bx, by + 130, bx + BLOCK_W, by + 130) +
    label(bx + 6, by + 141, st.issued ? 'CHECKED AGAINST' : 'CURRENT STANDARD (NOT AN ISSUE RECORD)') +
    value(bx + 176, by + 143, st.standard, 9) +
    `</g>`
  )
}

/**
 * The revision table, directly above the title block.
 *
 * ISSUED REVISIONS ONLY. A revision table is the record of what has been
 * issued; listing a row somebody is still working towards among them would
 * make a draft look like history. The drawing's current working revision is
 * shown in the title block instead, marked NOT ISSUED — so both facts are on
 * the sheet and neither is disguised as the other.
 *
 * Rows are read straight off the stored revision records, newest at the top.
 * Nothing is recomputed from the live document, so a historical row cannot
 * change because the current user or the current standard did.
 */
function revisionTableSvg(sheet: Sheet, bx: number, blockTop: number): string {
  const issued = revisionsOf(sheet).filter(isIssued)
  const shown = [...issued].reverse().slice(0, REV_ROWS)
  const overflow = issued.length - shown.length
  // Header, plus one row per revision, plus an overflow line when there is one.
  const bodyRows = Math.max(shown.length, 1) + (overflow > 0 ? 1 : 0)
  const th = REV_ROW_H * (bodyRows + 1)
  const ty = blockTop - th

  const COLS: { x: number; w: number; head: string }[] = [
    { x: 0, w: 40, head: 'REV' },
    { x: 40, w: 70, head: 'DATE' },
    { x: 110, w: 210, head: 'DESCRIPTION' },
    { x: 320, w: 60, head: 'PREP' },
    { x: 380, w: 60, head: 'CHKD' },
    { x: 440, w: 60, head: 'APPD' },
    { x: 500, w: 60, head: 'STATUS' },
  ]
  const text = (x: number, y: number, t: string, size = 8, fill = '#111') =>
    `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${size}" fill="${fill}">${esc(t)}</text>`
  /** Trim to what the column can hold, so a long reason cannot run into the
   *  next cell. Deterministic: the same description always truncates the same. */
  const fit = (t: string, w: number, size = 8) => {
    const max = Math.floor(w / (size * 0.55))
    return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t
  }

  const out: string[] = [
    `<rect x="${bx}" y="${ty}" width="${BLOCK_W}" height="${th}" fill="#fff" stroke="#111" stroke-width="1.5"/>`,
    `<line x1="${bx}" y1="${ty + REV_ROW_H}" x2="${bx + BLOCK_W}" y2="${ty + REV_ROW_H}" stroke="#111" stroke-width="1"/>`,
  ]
  for (const c of COLS) {
    if (c.x > 0) out.push(`<line x1="${bx + c.x}" y1="${ty}" x2="${bx + c.x}" y2="${ty + th}" stroke="#111" stroke-width="0.75"/>`)
    out.push(text(bx + c.x + 4, ty + 11, c.head, 7, '#666'))
  }

  shown.forEach((r, i) => {
    const y = ty + REV_ROW_H * (i + 2) - 4
    const cells = [
      r.code,
      r.date || (r.issuedAt ? r.issuedAt.slice(0, 10) : ''),
      r.description,
      r.preparedBy,
      r.checkedBy ?? '',
      r.approvedBy ?? '',
      r.status,
    ]
    COLS.forEach((c, j) => out.push(text(bx + c.x + 4, y, fit(cells[j] ?? '', c.w))))
  })

  if (shown.length === 0) {
    out.push(text(bx + 44, ty + REV_ROW_H * 2 - 4, 'No revisions issued', 8, '#666'))
  }
  if (overflow > 0) {
    out.push(text(bx + 44, ty + REV_ROW_H * (shown.length + 2) - 4, `+ ${overflow} earlier revision${overflow === 1 ? '' : 's'}`, 8, '#666'))
  }
  return out.join('')
}

/** Serialize the current drawing to a standalone SVG document. */
export function exportSvg(doc: ProjectDoc, sheet: Sheet): string {
  const paper = canvasRef.paper
  if (!paper) throw new Error('Canvas not mounted')
  const { w, h } = sheetPx(sheet.sheetSize)
  const mm = SHEET_SIZES_MM[sheet.sheetSize]

  // A big sheet only keeps the cells near the window in the DOM (see
  // canvas/viewport.ts), and this clones the DOM — so everything is brought
  // back first. An export that quietly dropped whatever was off screen would
  // be worse than a slow one.
  const inner = withEveryCellRendered(paper, () => {
    const clone = paper.svg.cloneNode(true) as SVGSVGElement
    for (const sel of [
      '.joint-tools',
      '.joint-highlighter-layer',
      '.pid-underlay',
      '.pid-sheet',
      '[joint-selector="portBody"]',
      '[joint-selector="portDot"]',
      '[joint-selector="hit"]',
    ]) {
      clone.querySelectorAll(sel).forEach((el) => el.remove())
    }
    // Neutralize the paper's pan/zoom transform on the layers group.
    clone.querySelectorAll('.joint-layers').forEach((el) => el.removeAttribute('transform'))
    return clone.innerHTML
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm.w}mm" height="${mm.h}mm" viewBox="0 0 ${w} ${h}">` +
    `<metadata>Generated by IPD Studio</metadata>` +
    `<rect width="${w}" height="${h}" fill="#fff"/>` +
    inner +
    titleBlockSvg(doc, sheet) +
    `</svg>`
  )
}

export function exportSvgFile(): void {
  const state = useStore.getState()
  const sheet = activeSheet(state)
  const svg = exportSvg(state.doc, sheet)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${state.doc.meta.name || 'diagram'}-${sheet.name.replace(/\s+/g, '')}.svg`
  a.click()
  URL.revokeObjectURL(a.href)
}
