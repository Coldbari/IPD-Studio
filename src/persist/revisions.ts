// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Durable snapshots of what a drawing looked like when it was ISSUED.
 *
 * These are NOT the autosave history. `persist/autosave.ts` keeps ten rolling
 * crash-recovery snapshots in `pid-studio.history`, bucketed by time and
 * discarded as they age out — a safety net, not a record. An issued revision
 * must still be there in six months, so it lives under its own key,
 * `pid-studio.revisions`, is written only when someone issues, and is never
 * evicted by anything in this file.
 *
 * Stored as the full ProjectDoc, deliberately. P0-E has to compare revision N
 * with revision N+1 at the model level — object by object, field by field —
 * and only the document can answer that. A rendered image could not. Deltas
 * would be smaller, but a patch engine that must be perfectly reversible is a
 * new correctness surface where a bug silently corrupts history, which is the
 * worst thing a revision system can do; that trade is revisited only with a
 * measurement, not a hunch.
 *
 * Kept OUT of the .pnid: the cloud copy is one Firestore document capped at
 * MAX_DOC_BYTES (~900 kB), and a handful of embedded full snapshots would
 * breach it. The document carries the revision METADATA, which is what travels
 * with the file; the bodies stay on the machine that issued them. A snapshot
 * that is not on this device degrades to "not available here" rather than an
 * error — the revision row is still the record.
 */

import { get, set } from 'idb-keyval'
import type { ProjectDoc } from '../model/types'
// Static: neither module touches the store, so neither can close the import
// cycle the two dynamic imports below exist to avoid — and every extra await
// before `markIssued` widens the window between capturing and stamping.
import { issueGateFor, standardOf } from '../model/standard'
import { captureQaEvidence, standardProvenance } from '../model/provenance'
import { evaluateConformance, issueBlockers } from '../model/conformance'

const KEY = 'pid-studio.revisions'

export interface RevisionSnapshot {
  id: string
  /** When the snapshot was written, not when the revision is dated. */
  ts: number
  doc: ProjectDoc
}

/**
 * Mirrors IndexedDB, and stands in for it entirely where there is none — node
 * tests, and a browser with site data blocked. The store degrades to
 * session-lived rather than throwing, and `snapshotId` on the revision is the
 * durable part either way.
 */
const memory = new Map<string, RevisionSnapshot>()

async function readAll(): Promise<Record<string, RevisionSnapshot>> {
  try {
    return ((await get(KEY)) as Record<string, RevisionSnapshot> | undefined) ?? {}
  } catch {
    return {}
  }
}

/**
 * Store one snapshot. The document is deep-copied on the way in, so nothing
 * that happens to the live document afterwards can reach back and alter a
 * revision that has already been issued.
 */
export async function putSnapshot(id: string, doc: ProjectDoc): Promise<void> {
  const snap: RevisionSnapshot = { id, ts: Date.now(), doc: structuredClone(doc) }
  memory.set(id, snap)
  try {
    await set(KEY, { ...(await readAll()), [id]: snap })
  } catch {
    // No IndexedDB here. The in-memory copy still serves this session, and the
    // revision row still records that an issue happened.
  }
}

/** The document as it stood at that issue, or undefined if this machine does
 *  not hold it. Callers must treat absence as "not available here", never as
 *  "the revision is invalid". */
export async function getSnapshot(id: string): Promise<ProjectDoc | undefined> {
  const local = memory.get(id)
  if (local) return structuredClone(local.doc)
  const stored = (await readAll())[id]
  if (!stored) return undefined
  memory.set(id, stored)
  return structuredClone(stored.doc)
}

export async function hasSnapshot(id: string): Promise<boolean> {
  return memory.has(id) || Boolean((await readAll())[id])
}

/** Test seam — the module-level mirror would otherwise leak between cases. */
export function __resetSnapshots(): void {
  memory.clear()
}

/**
 * Issue a revision: check the gate, capture the state, then stamp the row.
 *
 * Order matters. The QA report and the snapshot are both taken from the
 * document as it stands BEFORE the stamp, because that is the state being
 * issued; the stamp is the record that it happened. `qaAtIssue` is a copy of
 * the counts, never a pointer at the live report — fixing a finding tomorrow
 * must not rewrite what was true at issue.
 *
 * A failed snapshot write does not fail the issue. The revision is still a
 * real record with real metadata; it simply has no body to compare against
 * later, and `getSnapshot` says so honestly.
 */
export async function issueRevision(
  sheetId: string,
  revisionId: string,
): Promise<{ ok: boolean; snapshotId?: string; blockers: string[] }> {
  const { useStore } = await import('../store/store')
  const { qaFor } = await import('../validate/engine')

  /*
   * ONE POINT IN TIME.
   *
   * Everything captured below is derived from this single `doc` reference and
   * this single `issuedAt`. The store never mutates a document — it replaces
   * it — so holding `doc` holds the state as it was at this instant, for good.
   * That is what makes the capture coherent without a lock: the standard, the
   * QA report, the evidence and the snapshot cannot be from different moments
   * because they are all reads of the same immutable object.
   *
   * The only thing that happens after the await is stamping the row, and that
   * is a record that the issue occurred, not part of the captured state.
   */
  const doc = useStore.getState().doc
  const issuedAt = new Date().toISOString()
  const report = qaFor(doc)

  /*
   * THE GATE RUNS FIRST — before anything is written anywhere.
   *
   * This check is not the enforcement; `markIssued` is, and it re-evaluates
   * against the document at the moment of the write. This one exists so that a
   * refused issue leaves NO trace: no snapshot in IndexedDB, no orphaned
   * `snap-…` key, nothing to garbage-collect and nothing for a later reader to
   * mistake for a revision that happened. A blocked issue must be as if it was
   * never attempted, which is the same standard the P0 rename collision holds
   * itself to.
   */
  const sheet = doc.sheets.find((sh) => sh.id === sheetId)
  const row = sheet?.revisions?.find((r) => r.id === revisionId)
  if (!row) return { ok: false, blockers: ['That revision no longer exists.'] }
  if (row.issuedAt) return { ok: false, blockers: ['That revision has already been issued.'] }

  const gate = issueGateFor(doc.standard, row.status)
  const conformance = evaluateConformance(report, gate)
  const blocked = issueBlockers(row, gate, report, conformance)
  if (blocked.length) return { ok: false, blockers: blocked }

  const qaAtIssue = {
    critical: report.counts.critical,
    warning: report.counts.warning,
    info: report.counts.info,
    total: report.total,
  }
  // `standardOf` resolves an absent standard to the built-in default, so a
  // project that never opened the Standards page still records exactly what it
  // was checked against rather than recording nothing.
  const standard = standardProvenance(standardOf(doc))
  const qaEvidence = captureQaEvidence(report, issuedAt)

  const snapshotId = `snap-${revisionId}`
  await putSnapshot(snapshotId, doc)

  const { ok, blockers } = useStore.getState().markIssued(sheetId, revisionId, {
    issuedAt,
    snapshotId,
    qaAtIssue,
    standard,
    qaEvidence,
  })
  return ok ? { ok, snapshotId, blockers } : { ok, blockers }
}
