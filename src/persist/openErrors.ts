// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { DocError } from '../model/migrate'
import { DexpiImportError } from '../import/dexpi'
import type { Notice } from '../feedback/notices'

/**
 * What went wrong opening a file, in the engineer's words.
 *
 * Every failure here used to be one sentence: "Could not read X as an IPD
 * Studio drawing". That covers four genuinely different situations, and the
 * fix is different in each — so the one message could only ever be right by
 * accident.
 *
 * The four are distinguishable from evidence the importers already produce,
 * which is the only reason this is honest:
 *
 *   unsupported   nothing tried to read it — the extension is not one we open
 *   unreadable    JSON.parse threw: the bytes are not the format they claim
 *   not-a-drawing it parsed, and it is not a drawing — DocError says which part
 *   dexpi         the DEXPI importer's own complaint, which is already specific
 *
 * Anything else falls through to a message that says what happened and stops.
 * `null` for a cause is a real answer, and a better one than a plausible
 * invention — see the `body` rule on Notice.
 */
export type OpenFailure = 'unsupported' | 'unreadable' | 'not-a-drawing' | 'dexpi' | 'unknown'

export function classifyOpenError(err: unknown): OpenFailure {
  if (err instanceof DexpiImportError) return 'dexpi'
  if (err instanceof DocError) return 'not-a-drawing'
  if (err instanceof SyntaxError) return 'unreadable'
  return 'unknown'
}

/** The formats this application opens, named once. */
export const OPENABLE = '.pnid drawings, legacy .json drawings, and DEXPI/Proteus .xml'

/**
 * Build the notice for a failed open.
 *
 * `retry` is offered only where retrying could plausibly differ — picking a
 * different file. There is no "Try again" on a file whose contents are
 * simply wrong: an offer to repeat something that cannot work is worse than
 * no offer at all.
 */
export function openFailureNotice(
  fileName: string,
  err: unknown,
  onPickAnother?: () => void,
): Omit<Notice, 'id'> {
  const kind = classifyOpenError(err)
  const detail = err instanceof Error ? err.message : String(err)
  const another = onPickAnother
    ? [{ label: 'Open a different file', run: onPickAnother, primary: true }]
    : undefined

  switch (kind) {
    case 'unsupported':
      return {
        kind: 'error',
        title: `IPD Studio does not open ${fileName}`,
        body: `It opens ${OPENABLE}.`,
        hint: 'A DXF can be loaded as a trace-over background instead — File ▸ Load a DXF underlay.',
        actions: another,
      }
    case 'unreadable':
      return {
        kind: 'error',
        title: `${fileName} could not be read`,
        body: 'The file is not valid JSON, so nothing in it could be parsed. It is most likely truncated or was saved by something else.',
        hint: 'If this came from a cloud sync or a download that was interrupted, fetching it again usually fixes it.',
        details: detail,
        actions: another,
      }
    case 'not-a-drawing':
      return {
        kind: 'error',
        title: `${fileName} is not an IPD Studio drawing`,
        // DocError's message names the part that is missing, so it is the
        // explanation rather than a technical aside.
        body: `The file reads as valid JSON, but ${detail.toLowerCase()}.`,
        hint: 'Check that this is a .pnid file and not, say, an exported report or a settings file.',
        actions: another,
      }
    case 'dexpi':
      return {
        kind: 'error',
        title: `${fileName} could not be imported`,
        body: detail,
        hint: 'DEXPI files export from most P&ID tools as Proteus XML — an export set to a different schema will not carry a <PlantModel>.',
        actions: another,
      }
    default:
      return {
        kind: 'error',
        // Nothing is known about why, so nothing is claimed about why.
        title: `${fileName} could not be opened`,
        hint: 'Your current drawing is untouched.',
        details: detail,
        actions: another,
      }
  }
}

/**
 * Underlay outcomes.
 *
 * The parser knows two things and no more: whether it could parse the file at
 * all, and which entity types it skipped. It does NOT know whether geometry is
 * in paper space, in a block, or on a frozen layer — so this must not say that
 * it does. What it can do is name the four entity types it reads and point at
 * the export setting that produces them, framed as the advice it is.
 */
export function underlayFailureNotice(fileName: string, err: unknown): Omit<Notice, 'id'> {
  const detail = err instanceof Error ? err.message : String(err)
  return {
    kind: 'error',
    title: `${fileName} could not be read as a DXF`,
    hint: 'Re-exporting from your CAD tool as R12 or 2000-format DXF is usually enough. Your drawing is untouched.',
    details: detail,
  }
}

/** A DXF that parsed and had nothing this app can draw. Distinct from a parse
 *  failure, and the user's next step is completely different. */
export function underlayEmptyNotice(fileName: string): Omit<Notice, 'id'> {
  return {
    kind: 'warning',
    title: `Nothing in ${fileName} could be drawn`,
    body: 'The file was read, but it contains none of the four entity types an underlay uses: lines, polylines, circles and arcs.',
    hint: 'Geometry held inside blocks, or on a layout rather than in model space, will not appear. Exploding blocks and exporting from model space usually brings it through.',
  }
}
