// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'
import { useStore } from '../store/store'
import { useAuthStore } from '../auth/authStore'
import { saveToCloud } from './sync'
import { notify } from '../feedback/notices'

/**
 * A save failure in the engineer's words.
 *
 * Firestore errors arrive as "FirebaseError: Missing or insufficient
 * permissions." and similar, which the status bar was showing verbatim. The
 * three that actually happen get a sentence; anything else says what happened
 * without guessing at why, and the raw text goes behind Details.
 */
export function cloudErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/offline|network|unavailable|failed to fetch/i.test(raw)) {
    return 'Your browser could not reach the server. This usually means the connection dropped.'
  }
  if (/permission|unauthenticated|insufficient/i.test(raw)) {
    return 'Your account is not allowed to write this drawing. Your sign-in may have expired.'
  }
  if (/quota|resource-exhausted|too large|exceeded/i.test(raw)) {
    return 'The drawing is too large for the storage this account has left.'
  }
  // Deliberately NOT falling back to the raw text. authErrorMessage returns
  // the exception's own message when it recognises nothing, which would have
  // put "FirebaseError: kaboom" in the position where the user reads an
  // explanation — the exact leak this phase exists to stop. The raw text is
  // still carried, behind Details, where it is evidence rather than a reason.
  return 'The server refused the write and did not say why.'
}

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

/**
 * Whether a failure gets a dialog.
 *
 * A background autosave that fails is already reported honestly: `markSaved`
 * is not called, so `dirty` stays true and the status bar reads "Not saved to
 * your account". Going offline for a minute must not stack up dialogs on top
 * of that. But someone who pressed Save is WAITING for an answer, and silence
 * plus a small grey status line is not one — so an explicit save that fails
 * says so, and offers the retry.
 */
async function write(explicit = false): Promise<void> {
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
    // markSaved() is deliberately NOT called: `dirty` stays true, so nothing
    // in the UI claims this drawing is stored when it is not.
    useCloudStatus.setState({ state: 'error', message: cloudErrorMessage(err) })
    if (explicit) {
      notify({
        kind: 'error',
        title: 'Your changes could not be saved to your account',
        body: cloudErrorMessage(err),
        hint: 'The drawing on screen is untouched and still has every change. It stays autosaved on this machine either way — you can also download a .pnid from the File menu.',
        details: err instanceof Error ? err.message : String(err),
        actions: [
          { label: 'Try saving again', primary: true, run: () => saveNow() },
          { label: 'Download a .pnid instead', run: async () => {
            const { saveFile } = await import('../persist/file')
            await saveFile()
          } },
        ],
      })
    }
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
    void write(false)
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
  await write(true)
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
