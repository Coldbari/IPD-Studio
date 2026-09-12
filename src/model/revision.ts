// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Revisions: the difference between a drawing and a controlled document.
 *
 * Everything here is pure. Creating and issuing live in the store; capturing
 * the snapshot lives in `persist/revisions.ts`. This file only answers
 * questions about a sheet's revision table.
 */

import type { Revision, Sheet } from './types'

/** The default revision code of a sheet nobody has revised. */
export const INITIAL_REVISION_CODE = '0'

/** Deterministic id for the row migration synthesises from a legacy string.
 *  Deterministic so running the migration twice cannot produce two rows. */
export const legacyRevisionId = (sheetId: string): string => `rev-legacy-${sheetId}`

export const revisionsOf = (sheet: Sheet): Revision[] => sheet.revisions ?? []

export const isIssued = (r: Revision): boolean => Boolean(r.issuedAt)

/** The most recent ISSUED revision, if the sheet has ever been issued. */
export function lastIssued(sheet: Sheet): Revision | undefined {
  const list = revisionsOf(sheet)
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]!
    if (isIssued(r)) return r
  }
  return undefined
}

/** Rows that are not yet issued — what the drawing is currently working towards. */
export const openRevisions = (sheet: Sheet): Revision[] => revisionsOf(sheet).filter((r) => !isIssued(r))

/**
 * What the title block should print.
 *
 * The last issued code where there is one; otherwise the stored string, which
 * is what every pre-schema-6 document has and what the title block, the DXF
 * writer and the print path have always read.
 */
export function currentRevisionCode(sheet: Sheet): string {
  return lastIssued(sheet)?.code ?? sheet.revision ?? INITIAL_REVISION_CODE
}

/** A new, unissued row. Nothing about it is guessed: the caller supplies
 *  everything, and what the caller does not know stays empty. */
export function newRevision(id: string, fields: Partial<Revision> & Pick<Revision, 'code' | 'status'>): Revision {
  return {
    id,
    code: fields.code,
    date: fields.date ?? '',
    description: fields.description ?? '',
    preparedBy: fields.preparedBy ?? '',
    status: fields.status,
    ...(fields.checkedBy ? { checkedBy: fields.checkedBy } : {}),
    ...(fields.approvedBy ? { approvedBy: fields.approvedBy } : {}),
  }
}
