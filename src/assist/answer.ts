// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { FixSpec } from './fixes'

/** One real object the user can jump to. Never a string the app invented. */
export interface AnswerRow {
  /** Node or edge id — the jump target. */
  id: string
  sheetId: string
  /** Tag, line number, label, or symbol name — resolved from the document. */
  ref: string
  /** Why this row is in the answer. */
  note?: string
  tone?: 'ok' | 'warn' | 'gap'
}

/**
 * What the assistant says.
 *
 * `headline` is the only prose, and the app writes it from counts and values
 * read out of the document — it is never generated. Everything the user acts on
 * is in `rows`, each carrying the id of a real object, so an answer structurally
 * cannot name something that is not on a sheet.
 */
export interface Answer {
  headline: string
  rows: AnswerRow[]
  /** Highlighted together by "Show on drawing". */
  focus: string[]
  /** Set when the document cannot answer: what is missing, and what would hold it. */
  gap?: { missing: string; fieldKey?: string; fix?: FixSpec }
}

export function answer(headline: string, rows: AnswerRow[] = [], gapInfo?: Answer['gap']): Answer {
  return { headline, rows, focus: rows.map((r) => r.id), ...(gapInfo ? { gap: gapInfo } : {}) }
}

/**
 * An honest "the drawing does not say".
 *
 * A refusal must never be a dead end: it carries what is missing and, where one
 * exists, the field that would hold it — so declining turns into a work item
 * rather than a shrug.
 */
export function gap(headline: string, missing: string, fieldKey?: string): Answer {
  return { headline, rows: [], focus: [], gap: { missing, ...(fieldKey ? { fieldKey } : {}) } }
}
