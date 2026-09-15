// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * REVIEW COMMENTS — what a checker says about an engineering object.
 *
 * WHERE THEY LIVE, AND WHY THERE. On the object's `EngineeringRecord`, in
 * `record.comments`. Not in `ProjectDoc`, not on the drawn node, not on a
 * revision, and not at a coordinate. The P3-7 audit settled this and the
 * reasoning is worth keeping next to the type:
 *
 *  - `collectTagRefs` states the governing rule already: a `loopId` "is NOT a
 *    tag reference and gets no RefWhere of its own" because it is a stable id.
 *    A reference BY TAG costs an 8th `RefWhere` member — collect, rewrite,
 *    orphan, count and pin. A thread nested in the record stores no tag at all,
 *    so there is nothing to rewrite and nothing that can be orphaned.
 *  - `retagRegistry`'s object spread therefore carries the whole conversation
 *    across a rename for free, exactly as it carries `nozzles` and `loopId`.
 *  - `deleteIds` never touches the registry, so a review survives deleting and
 *    redrawing the symbol — which is the point of keying engineering data by
 *    tag rather than by placement.
 *
 * WHAT A THREAD IS NOT. Not a QA finding: it carries no severity, produces no
 * finding, and blocks no issue. Severity is what a RULE decides against a
 * standard; a sentence somebody typed has no such basis, and giving it one
 * would be a second severity system that could disagree with the first.
 *
 * APPEND-ONLY. A note is never edited in place — a correction is another note.
 * An audit trail that can be rewritten is not an audit trail.
 *
 * SINGLE-USER, AND HONEST ABOUT IT. `by` is a COPIED display name, never a
 * user id: a uid in a file emailed to somebody else resolves to nothing. There
 * are no permissions, no mentions, no read state and no sync, because none of
 * those can be enforced or observed without a server. These are notes in a
 * file, and the file gets passed around.
 *
 * Everything here is pure and DOM-free.
 */

import { ulid } from 'ulid'

export interface ReviewNote {
  /** Stable identity. Never displayed, never reused, never derived. */
  id: string
  /** What the reviewer wrote. Authoritative content. */
  body: string
  /** ISO, the convention `IgnoredFinding.at` and `Revision.issuedAt` use.
   *  METADATA: two revisions do not differ because a note is older. */
  at: string
  /** A copied display name, when one was available. Absent is normal and is
   *  shown as nothing rather than as "Unknown" — inventing a name would be
   *  worse than admitting there is none. */
  by?: string
}

export interface ReviewThread {
  /** Stable identity of the CONVERSATION. Unlike a nozzle number this is never
   *  displayed, so it has nothing to be renumbered by. */
  id: string
  /** Chronological, append-only. Always at least one. */
  notes: ReviewNote[]
  /**
   * ABSENT means open; PRESENT means resolved. That is the whole state
   * machine, and it is why there is no status enum: `open | resolved` with a
   * third value would be a value nothing can produce.
   *
   * Reopening removes the key rather than setting a flag, so a round trip
   * through a saved file is unchanged.
   */
  resolved?: { at: string; by?: string }
}

/** The threads on one record, never undefined — the `nozzlesOf` convention. */
export const threadsOf = (record: { comments?: readonly ReviewThread[] } | undefined): readonly ReviewThread[] =>
  record?.comments ?? []

export const isOpen = (thread: ReviewThread): boolean => thread.resolved === undefined

/**
 * Who to record as the author.
 *
 * A signed-in display name first, then the author named on the document, then
 * nobody. A COPIED STRING in every case: the value is written into a file that
 * travels, and a Firebase uid would resolve to nothing on the machine that
 * opens it next. `ignoreFinding` already writes `doc.meta.author` this way.
 *
 * Blank is not a name. A user who has never filled in the author field gets an
 * unattributed note, which is the truth.
 */
export function reviewAuthor(signedInName: string | undefined, docAuthor: string | undefined): string | undefined {
  return signedInName?.trim() || docAuthor?.trim() || undefined
}

/** A note, or `null` when there is nothing to say. Blank bodies are refused
 *  here rather than stored — an empty comment is not a comment. */
export function newNote(body: string, by?: string, at = new Date().toISOString()): ReviewNote | null {
  const text = body.trim()
  if (!text) return null
  return { id: ulid(), body: text, at, ...(by ? { by } : {}) }
}

/** A thread is its first note; there is no such thing as an empty one. */
export function newThread(body: string, by?: string, at?: string): ReviewThread | null {
  const note = newNote(body, by, at)
  return note ? { id: ulid(), notes: [note] } : null
}

/**
 * Open threads across the whole registry, and how many objects carry one.
 *
 * ONE pass over the records for both numbers. The Project workspace prints
 * "N unresolved on M objects", and walking the registry twice to say one
 * sentence is the shape `buildHierarchy` and the reports have already had
 * taken out of them.
 */
export function unresolvedCount(
  registry: Record<string, { comments?: readonly ReviewThread[] }> | undefined,
): { threads: number; records: number } {
  let threads = 0
  let records = 0
  for (const key in registry) {
    let here = 0
    for (const thread of threadsOf(registry[key])) if (isOpen(thread)) here += 1
    if (here > 0) {
      threads += here
      records += 1
    }
  }
  return { threads, records }
}

/* ------------------------------------------------------- document integrity */

/**
 * Load-time SHAPE check, drawing the line `checkLoops` and `checkNozzles` draw:
 * a malformed shape refuses the file, a broken reference loads.
 *
 * There are no references here to break — a thread names no tag, no node and no
 * revision — so everything this can find is a malformed shape. Absent
 * `comments` is a document written before reviews existed, which is every
 * document so far, and is perfectly valid.
 */
export function checkComments(registry: Record<string, { comments?: unknown }> | undefined): string | null {
  if (!registry) return null
  for (const key of Object.keys(registry)) {
    const raw = registry[key]?.comments
    if (raw === undefined) continue
    if (!Array.isArray(raw)) return `comments on ${key} is malformed`
    const seen = new Set<string>()
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) return `comments on ${key} is malformed`
      const thread = item as Partial<ReviewThread>
      if (typeof thread.id !== 'string' || !thread.id) return `comments on ${key} is malformed`
      if (seen.has(thread.id)) return `comments on ${key} contains a duplicate id: ${thread.id}`
      seen.add(thread.id)
      // A thread IS its notes. One with none could not have been written by
      // this product and cannot be displayed by it.
      if (!Array.isArray(thread.notes) || thread.notes.length === 0) {
        return `comments on ${key} contains a thread with no notes: ${thread.id}`
      }
      const noteIds = new Set<string>()
      for (const n of thread.notes) {
        if (typeof n !== 'object' || n === null) return `comments on ${key} is malformed`
        const note = n as Partial<ReviewNote>
        if (typeof note.id !== 'string' || !note.id) return `comments on ${key} is malformed`
        if (typeof note.body !== 'string') return `comments on ${key} is malformed`
        if (typeof note.at !== 'string') return `comments on ${key} is malformed`
        if (noteIds.has(note.id)) return `comments on ${key} contains a duplicate note id: ${note.id}`
        noteIds.add(note.id)
      }
    }
  }
  return null
}
