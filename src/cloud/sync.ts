// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import {
  addDoc,
  collection,
  deleteDoc,
  doc as fsDoc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import type { ProjectDoc } from '../model/types'
import { db } from './firestore'
import { deserializeDoc, serializeDoc } from '../persist/file'
import { tr } from '../i18n'

/** Firestore caps a whole document near 1 MiB; the deployed rules cap the
 *  drawing string below that so the rest of the record always fits. */
export const MAX_DOC_BYTES = 900_000

/** The rules reject a longer name, and a rules rejection reaches the user as
 *  an opaque permission error. */
const NAME_MAX = 200

export interface CloudDrawingMeta {
  id: string
  name: string
  sheetCount: number
  sizeBytes: number
  updatedAt: number
  createdAt: number
}

function drawings(uid: string) {
  return collection(db(), 'users', uid, 'drawings')
}

function cleanName(name: string): string {
  return (name.trim() || tr('Untitled')).slice(0, NAME_MAX)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Everything a cloud record holds, with no Firestore call inside — pure, so the
 * size rule can be tested without a network. The ProjectDoc goes up as ONE JSON
 * string: Firestore rejects nested arrays and `Sheet.underlay.polylines` is an
 * array of arrays.
 */
export function buildPayload(doc: ProjectDoc, name: string): { name: string; doc: string; sheetCount: number; sizeBytes: number } {
  // The same JSON the file format uses, minus the indentation — a cloud record
  // is parsed, never read by eye, and the whitespace was half the size cap.
  const json = serializeDoc(doc, { pretty: false })
  return {
    name: cleanName(name),
    doc: json,
    // byte length, not string length — a drawing full of non-ASCII tag text would under-measure
    sizeBytes: new TextEncoder().encode(json).length,
    sheetCount: doc.sheets.length,
  }
}

export function tooLargeMessage(sizeBytes: number): string {
  return (
    tr('This drawing is') + ' ' + formatBytes(sizeBytes) + tr('over the') + ' ' + formatBytes(MAX_DOC_BYTES) + tr('limit for a cloud drawing.') + ' ' +
    tr('A DXF underlay is almost always the reason — it carries every traced polyline of the original CAD file.') + ' ' +
    tr('Remove the underlay from its sheet and save again, or keep this one as a .pnid file on your computer.')
  )
}

/** A record read straight back from the local cache still has `null` where the
 *  server timestamp will land. */
function millis(value: unknown, fallback: number): number {
  if (value instanceof Timestamp) return value.toMillis()
  return typeof value === 'number' ? value : fallback
}

function metaFrom(id: string, data: Record<string, unknown>): CloudDrawingMeta {
  const updatedAt = millis(data.updatedAt, Date.now())
  return {
    id,
    name: typeof data.name === 'string' ? data.name : tr('Untitled'),
    sheetCount: typeof data.sheetCount === 'number' ? data.sheetCount : 0,
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : 0,
    updatedAt,
    createdAt: millis(data.createdAt, updatedAt),
  }
}

/** Firestore reports a rules rejection and a dead network with codes, never
 *  with anything a user can read — translate the few they can act on. */
function friendly(err: unknown, what: string): Error {
  const code = String((err as { code?: unknown } | null | undefined)?.code ?? '')
  const w = tr(what)
  if (code.includes('unauthenticated')) return new Error(w + ' ' + tr('needs you to be signed in.'))
  if (code.includes('permission-denied')) {
    return new Error(w + ' ' + tr('was refused. Cloud drawings only open for the account that saved them — sign in again, then retry.'))
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return new Error(w + ' ' + tr('could not reach the network. Check your connection and try again.'))
  }
  return err instanceof Error ? err : new Error(w + ' ' + tr('failed.'))
}

export async function listDrawings(uid: string): Promise<CloudDrawingMeta[]> {
  try {
    const snap = await getDocs(query(drawings(uid), orderBy('updatedAt', 'desc')))
    return snap.docs.map((d) => metaFrom(d.id, d.data()))
  } catch (err) {
    throw friendly(err, 'Loading your cloud drawings')
  }
}

/**
 * Writes the drawing under `opts.id`, or creates a record when there is none.
 * `name` is written on every save because the rules demand a valid one even
 * when an update recreates a record deleted from another device — so pass the
 * cloud record's current name when updating, or the local document name takes
 * over a rename made here.
 */
export async function saveToCloud(uid: string, doc: ProjectDoc, opts: { id?: string; name?: string }): Promise<{ id: string; updatedAt: number }> {
  const payload = buildPayload(doc, opts.name ?? doc.meta.name)
  if (payload.sizeBytes > MAX_DOC_BYTES) throw new Error(tooLargeMessage(payload.sizeBytes))
  try {
    if (opts.id) {
      // merge, so fields a newer build wrote survive a save from an older one
      await setDoc(fsDoc(drawings(uid), opts.id), { ...payload, updatedAt: serverTimestamp() }, { merge: true })
      return { id: opts.id, updatedAt: Date.now() }
    }
    const ref = await addDoc(drawings(uid), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return { id: ref.id, updatedAt: Date.now() }
  } catch (err) {
    throw friendly(err, 'Saving to your account')
  }
}

export async function loadFromCloud(uid: string, id: string): Promise<{ doc: ProjectDoc; meta: CloudDrawingMeta }> {
  let data: Record<string, unknown>
  try {
    const snap = await getDoc(fsDoc(drawings(uid), id))
    if (!snap.exists()) throw new Error(tr('That drawing is no longer in your account — it may have been deleted from another device.'))
    data = snap.data()
  } catch (err) {
    throw friendly(err, 'Opening this drawing')
  }
  const json = data.doc
  if (typeof json !== 'string' || !json) throw new Error(tr('That cloud record holds no drawing data.'))
  try {
    return { doc: deserializeDoc(json), meta: metaFrom(id, data) }
  } catch {
    throw new Error(tr('That drawing could not be read — it may have been saved by a newer version of IPD Studio.'))
  }
}

export async function renameDrawing(uid: string, id: string, name: string): Promise<void> {
  try {
    await updateDoc(fsDoc(drawings(uid), id), { name: cleanName(name), updatedAt: serverTimestamp() })
  } catch (err) {
    throw friendly(err, 'Renaming this drawing')
  }
}

export async function deleteDrawing(uid: string, id: string): Promise<void> {
  try {
    await deleteDoc(fsDoc(drawings(uid), id))
  } catch (err) {
    throw friendly(err, 'Deleting this drawing')
  }
}
