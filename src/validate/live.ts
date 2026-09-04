// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The QA report, delivered off the drawing's critical path.
 *
 * Four always-mounted pieces of the editor read the report — the status bar,
 * the rail badge, the issues drawer, and the Checks workspace — and each of
 * them used to call `qaFor(doc)` straight out of `render`. `qaFor` is cached
 * per document, so they shared one run; but `touched()` mints a new document
 * on every single edit, which meant every edit re-indexed the whole project
 * and re-ran all 21 rules SYNCHRONOUSLY, inside React's render, before the
 * canvas could paint the change. Measured: 0.9 ms at 500 objects, 2.8 ms at
 * 1,000, 5.7 ms at 2,000 — per edit, and a docking drag writes mid-gesture.
 *
 * Validation is advice about the drawing, not part of drawing it. So the doc
 * is watched here and the report is recomputed when the browser is idle; the
 * panels subscribe to the result. Findings land a moment after the edit
 * instead of in front of it, and the drag never waits for the rule engine.
 */

import { useSyncExternalStore } from 'react'
import { useStore } from '../store/store'
import { qaFor, type QaReport } from './engine'

/** Upper bound on how stale a badge may be. Long enough that a burst of
 *  dragging produces one run, short enough to feel live while typing a tag. */
const IDLE_TIMEOUT_MS = 300

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opt?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

const listeners = new Set<() => void>()
let report: QaReport | null = null
let pending: number | null = null
let usingIdle = false
let started = false

function cancelPending(): void {
  if (pending === null) return
  const w = window as IdleWindow
  if (usingIdle && w.cancelIdleCallback) w.cancelIdleCallback(pending)
  else clearTimeout(pending)
  pending = null
}

function recompute(): void {
  pending = null
  const next = qaFor(useStore.getState().doc)
  if (next === report) return
  report = next
  for (const l of listeners) l()
}

function schedule(): void {
  if (pending !== null) return
  const w = window as IdleWindow
  if (w.requestIdleCallback) {
    usingIdle = true
    pending = w.requestIdleCallback(recompute, { timeout: IDLE_TIMEOUT_MS })
  } else {
    usingIdle = false
    pending = window.setTimeout(recompute, IDLE_TIMEOUT_MS) as unknown as number
  }
}

function start(): void {
  if (started) return
  started = true
  report = qaFor(useStore.getState().doc)
  let prev = useStore.getState().doc
  useStore.subscribe((s) => {
    if (s.doc === prev) return
    prev = s.doc
    schedule()
  })
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): QaReport {
  if (!report) {
    started = false
    start()
  }
  return report!
}

/** The current QA report. Recomputed when the browser is idle after an edit,
 *  never during one. For a report that is exact as of *this* instant — an
 *  export, a test — call `qaFor(doc)` directly. */
export function useQa(): QaReport {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Test seam: drop the watcher and its cached report. */
export function resetQaLive(): void {
  cancelPending()
  listeners.clear()
  report = null
  started = false
}
