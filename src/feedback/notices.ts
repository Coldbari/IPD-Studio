// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useSyncExternalStore } from 'react'

/**
 * One way for the application to say something went wrong.
 *
 * There were nineteen `window.alert` / `confirm` / `prompt` call sites, each
 * writing its own sentence, and the sentences were mostly of the form "Could
 * not read X" — what failed, and nothing else. A browser alert also cannot
 * carry an action, so every one of them ended in a dead end with an OK button.
 *
 * Three surfaces, deliberately not one:
 *
 *   `status()`  a quiet line in the status bar that fades. For a thing that
 *               worked with a caveat, or a small recoverable problem. No
 *               decision to make, so it must not take the keyboard.
 *   `notify()`  a dialog with a title, a reason, a next step and buttons. For
 *               a failure the engineer has to understand or act on.
 *   `confirm()` a dialog that asks before something consequential. Only where
 *               undo genuinely cannot recover it.
 *
 * Canvas-local refusals are a fourth surface and do not live here — see
 * canvas/refusal.ts. A line that would not connect belongs at the point on the
 * drawing where the user was looking, not in a dialog.
 *
 * State is module-level with a subscriber set, the same shape validate/live.ts
 * uses, so only the host component re-renders. Putting this in the zustand
 * store would wake the whole Design Page on every notice.
 */

export type NoticeKind = 'error' | 'warning'

export interface NoticeAction {
  label: string
  /** Runs, then the notice closes. Throwing leaves it open. */
  run(): void | Promise<void>
  primary?: boolean
}

export interface Notice {
  id: number
  kind: NoticeKind
  /** What happened. A short sentence, not a category. */
  title: string
  /**
   * Why it happened — omitted entirely when the application does not know.
   *
   * This is the rule the old messages broke: an invented cause reads exactly
   * like a real one, and sends the engineer looking for a problem that is not
   * there. If the failure only produced `false`, say what happened and stop.
   */
  body?: string
  /** What to do next. */
  hint?: string
  /** Raw technical text — an exception message, a parser complaint. Behind a
   *  disclosure, because it is evidence, not an explanation. */
  details?: string
  actions?: NoticeAction[]
}

export interface StatusMessage {
  id: number
  text: string
  kind: 'info' | 'warning'
  /** Longer text the status line links out to, when there is more to say. */
  details?: string
}

type Listener = () => void

const listeners = new Set<Listener>()
let notices: Notice[] = []
let status: StatusMessage | null = null
let seq = 0

function emit(): void {
  for (const l of listeners) l()
}

export function subscribeNotices(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function noticeSnapshot(): Notice[] {
  return notices
}

export function statusSnapshot(): StatusMessage | null {
  return status
}

/** Raise a dialog-level failure. Returns its id so a caller can dismiss it. */
export function notify(n: Omit<Notice, 'id'>): number {
  const id = ++seq
  notices = [...notices, { ...n, id }]
  emit()
  return id
}

export function dismissNotice(id: number): void {
  notices = notices.filter((n) => n.id !== id)
  emit()
}

/** How long a status line stays before it fades. Long enough to read a
 *  sentence, short enough that it is gone before it becomes furniture. */
const STATUS_MS = 6000
let statusTimer: ReturnType<typeof setTimeout> | null = null

/** A quiet line in the status bar. Replaces whatever was there — two of these
 *  at once would be a notification stack, which this product does not want. */
export function showStatus(text: string, opts: { kind?: 'info' | 'warning'; details?: string } = {}): void {
  status = { id: ++seq, text, kind: opts.kind ?? 'info', details: opts.details }
  emit()
  if (statusTimer !== null) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    status = null
    statusTimer = null
    emit()
  }, STATUS_MS)
}

export function clearStatus(): void {
  if (statusTimer !== null) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
  status = null
  emit()
}

// ── confirmation ─────────────────────────────────────────────────────────

export interface ConfirmRequest {
  id: number
  title: string
  body: string
  /** The affirmative button. Named for what it does — never "OK". */
  confirmLabel: string
  /** Destructive styling, for the ones that really do throw work away. */
  danger?: boolean
  resolve(ok: boolean): void
}

let pendingConfirm: ConfirmRequest | null = null

export function confirmSnapshot(): ConfirmRequest | null {
  return pendingConfirm
}

/**
 * Ask before doing something undo cannot take back.
 *
 * Deliberately NOT a replacement for every `window.confirm`: an action that
 * Undo recovers should just happen. This is for the ones that replace the
 * whole document or leave the page.
 *
 * One at a time. A second request while one is open resolves false rather
 * than stacking, because two modal questions on screen is a bug either way.
 */
export function confirmAction(
  req: Omit<ConfirmRequest, 'id' | 'resolve'>,
): Promise<boolean> {
  if (pendingConfirm) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    pendingConfirm = {
      ...req,
      id: ++seq,
      resolve: (ok) => {
        pendingConfirm = null
        emit()
        resolve(ok)
      },
    }
    emit()
  })
}

// ── React bindings ───────────────────────────────────────────────────────
// In this file rather than a hook module, matching validate/live.ts: the
// external store and the hook that reads it belong together.

/** Dialog-level failures currently raised. */
export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribeNotices, noticeSnapshot, noticeSnapshot)
}

/** The one status line, or null. */
export function useStatusMessage(): StatusMessage | null {
  return useSyncExternalStore(subscribeNotices, statusSnapshot, statusSnapshot)
}

/** The confirmation waiting for an answer, or null. */
export function usePendingConfirm(): ConfirmRequest | null {
  return useSyncExternalStore(subscribeNotices, confirmSnapshot, confirmSnapshot)
}

/** Test seam. */
export function resetNotices(): void {
  if (statusTimer !== null) clearTimeout(statusTimer)
  statusTimer = null
  notices = []
  status = null
  pendingConfirm?.resolve(false)
  pendingConfirm = null
  emit()
}
