// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { validateProfile, type ProfileProblem, type StandardProfile } from '../model/standard'

/**
 * A standard as a file of its own.
 *
 * The profile lives in the document so a drawing is self-describing, but a
 * company has one standard and many projects — without this, adopting it means
 * re-entering it per drawing, which nobody does twice. One `.ipdstd.json` seeds
 * every project and travels by email like any other engineering document.
 */

export const STANDARD_EXTENSION = '.ipdstd.json'

/** Filesystem-safe, and recognisable in a downloads folder six months later. */
function fileNameFor(std: StandardProfile): string {
  const base = std.name.trim().replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-').slice(0, 60)
  return `${base || 'standard'}${STANDARD_EXTENSION}`
}

export function serializeStandard(std: StandardProfile): string {
  // Pretty-printed on purpose: unlike the cloud payload, this file is meant to
  // be opened, read, diffed in a review and hand-edited by an engineer.
  return JSON.stringify(std, null, 2) + '\n'
}

export function downloadStandard(std: StandardProfile): void {
  const blob = new Blob([serializeStandard(std)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileNameFor(std)
  a.click()
  URL.revokeObjectURL(a.href)
}

export type StandardParseResult =
  | { ok: true; profile: StandardProfile }
  | { ok: false; problems: ProfileProblem[] }

/**
 * Parse a standard file.
 *
 * Malformed JSON is reported as a problem rather than thrown, because this is
 * reached from a file picker: the caller has a place to show a sentence, and an
 * exception there becomes an unexplained dead end.
 */
export function parseStandardFile(text: string): StandardParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, problems: [{ field: 'file', message: 'This file is not valid JSON' }] }
  }
  return validateProfile(raw)
}
