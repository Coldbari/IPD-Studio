// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { get, set } from 'idb-keyval'
import type { ProjectDoc } from '../model/types'
import { loadDoc } from '../model/migrate'
import { useStore } from '../store/store'

const KEY = 'pid-studio.autosave'
const HISTORY_KEY = 'pid-studio.history'
const HISTORY_MAX = 10
/** A new history slot no more often than every 2 minutes of editing. */
const HISTORY_BUCKET_MS = 2 * 60_000
/**
 * How often the CURRENT bucket is refreshed on disk.
 *
 * The bucket used to be rewritten on every autosave — every 500 ms of editing.
 * Each rewrite read all ten snapshots out of IndexedDB, deep-copied the whole
 * document, and wrote all ten back: ten full documents through the structured
 * clone algorithm, on the main thread, half a second after every drag. The
 * snapshots are a coarse safety net spanning twenty minutes or more; keeping
 * the newest one within twenty seconds of the screen is ample, and the
 * autosave key itself — the one that restores your work on reopen — is still
 * written every time.
 */
const HISTORY_REFRESH_MS = 20_000
let timer: ReturnType<typeof setTimeout> | null = null

export interface Snapshot {
  ts: number
  name: string
  doc: unknown
}

/** The snapshot list, kept in memory after the first read so a refresh does
 *  not have to pull ten documents back out of IndexedDB to append to them. */
let historyCache: Snapshot[] | null = null
let lastHistoryWrite = 0

async function history(): Promise<Snapshot[]> {
  if (!historyCache) historyCache = ((await get(HISTORY_KEY)) as Snapshot[] | undefined) ?? []
  return historyCache
}

async function pushHistory(doc: ProjectDoc, now: number): Promise<void> {
  try {
    const list = await history()
    const last = list[list.length - 1]
    const sameBucket = Boolean(last && now - last.ts < HISTORY_BUCKET_MS && last.name === (doc.meta.name || 'Untitled'))
    // Within a bucket the newest state simply replaces it, so there is nothing
    // to lose by letting that lag; a NEW bucket is a real event and is written
    // straight away.
    if (sameBucket && now - lastHistoryWrite < HISTORY_REFRESH_MS) return
    const snap: Snapshot = { ts: now, name: doc.meta.name || 'Untitled', doc }
    const next = sameBucket ? [...list.slice(0, -1), snap] : [...list.slice(-(HISTORY_MAX - 1)), snap]
    historyCache = next
    lastHistoryWrite = now
    await set(HISTORY_KEY, next)
  } catch {
    /* history is best-effort */
  }
}

export async function listHistory(): Promise<Snapshot[]> {
  try {
    return (await history()).slice().reverse()
  } catch {
    return []
  }
}

export function restoreSnapshot(snap: Snapshot): void {
  useStore.getState().loadIntoStore(loadDoc(snap.doc))
}

export function startAutosave(): () => void {
  let prev = useStore.getState().doc
  const unsub = useStore.subscribe((s) => {
    if (s.doc === prev) return
    prev = s.doc
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      // The document is immutable and plain data, and IndexedDB structured-
      // clones on write, so the JSON round-trip this used to do twice per
      // autosave (once here, once for the snapshot) bought nothing.
      const doc = useStore.getState().doc
      void set(KEY, doc)
      void pushHistory(doc, Date.now())
    }, 500)
  })
  return () => {
    unsub()
    if (timer) clearTimeout(timer)
  }
}

export async function restoreAutosave(): Promise<ProjectDoc | null> {
  try {
    const raw = await get(KEY)
    if (!raw) return null
    const doc = loadDoc(raw)
    const hasContent =
      doc.sheets.some((sh) => sh.nodes.length || sh.edges.length) ||
      doc.hmiScreens.some((sc) => sc.widgets.length || sc.pipes.length)
    return hasContent ? doc : null
  } catch {
    return null
  }
}
