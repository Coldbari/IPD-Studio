// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'
import { useStore } from '../store/store'
import { useAuthStore } from '../auth/authStore'
import { saveToCloud } from './sync'
import { tr } from '../i18n'

export type CloudState = 'off' | 'saving' | 'saved' | 'error'

interface CloudStatus {
  state: CloudState
  /** Set only when `state` is 'error' — shown to the user verbatim. */
  message: string | null
  savedAt: number | null
}

export const useCloudStatus = create<CloudStatus>()(() => ({ state: 'off', message: null, savedAt: null }))

/** Long enough that a burst of dragging is one write, short enough that a
 *  browser closed mid-thought has already lost nothing. */
const DEBOUNCE_MS = 2_000

let timer: ReturnType<typeof setTimeout> | null = null
let inflight = false
/** An edit that arrived while a write was in the air; replayed on completion
 *  so the cloud copy never settles one revision behind the screen. */
let queued = false

async function write(): Promise<void> {
  const user = useAuthStore.getState().user
  const { doc, cloudId, setCloudId, markSaved } = useStore.getState()
  if (!user) return

  inflight = true
  useCloudStatus.setState({ state: 'saving', message: null })
  try {
    const saved = await saveToCloud(user.uid, doc, { id: cloudId ?? undefined, name: doc.meta.name })
    setCloudId(saved.id)
    // Only clear the dirty flag if nothing was edited while the write was in
    // flight; otherwise the toolbar would claim "Saved" over unsaved edits.
    if (!queued) markSaved()
    useCloudStatus.setState({ state: 'saved', message: null, savedAt: Date.now() })
  } catch (err) {
    useCloudStatus.setState({
      state: 'error',
      message: err instanceof Error ? err.message : tr('Could not save to your account.'),
    })
  } finally {
    inflight = false
    if (queued) {
      queued = false
      schedule()
    }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    if (inflight) {
      queued = true
      return
    }
    void write()
  }, DEBOUNCE_MS)
}

/**
 * Ctrl/Cmd+S and the toolbar Save button. Signed in, this writes to Firebase —
 * it never downloads a file, because exporting is a separate deliberate act.
 * Signed out there is no account to write to, so it falls back to the .pnid
 * file save rather than leaving the shortcut dead.
 */
export async function saveNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!useAuthStore.getState().user) {
    const { saveFile } = await import('../persist/file')
    await saveFile()
    return
  }
  if (inflight) {
    queued = true
    return
  }
  await write()
}

/**
 * Keeps the cloud copy current once a drawing has one. A drawing only gets a
 * cloud record when the user asks for it (Ctrl+S, or Save to cloud) — silently
 * uploading every anonymous doodle the moment someone signs in would break the
 * local-first promise.
 */
export function startCloudAutosave(): () => void {
  let prevDoc = useStore.getState().doc

  const unsubDoc = useStore.subscribe((s) => {
    if (s.doc === prevDoc) return
    prevDoc = s.doc
    if (!s.cloudId) return
    if (!useAuthStore.getState().user) return
    schedule()
  })

  const unsubAuth = useAuthStore.subscribe((s) => {
    if (s.user) return
    // Signed out: stop pretending anything is syncing.
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    queued = false
    useCloudStatus.setState({ state: 'off', message: null, savedAt: null })
  })

  return () => {
    unsubDoc()
    unsubAuth()
    if (timer) clearTimeout(timer)
  }
}
