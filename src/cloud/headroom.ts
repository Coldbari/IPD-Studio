// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * How much room is left in the cloud copy of this drawing.
 *
 * A cloud drawing is ONE Firestore document holding the whole project as a
 * JSON string, and the deployed rules reject it over `MAX_DOC_BYTES`. That is
 * a server-side check, so a project that grows past it fails at SAVE time, as
 * an opaque permission error, with the work already done. The point of this
 * module is that nobody should ever meet that error without warning.
 *
 * Measured the way it is stored: `serializeDoc(doc, { pretty: false })`, the
 * exact call `buildPayload` makes, then byte length rather than string length
 * so non-ASCII tag text does not under-measure. It is an approximation only in
 * that the record carries a little metadata beside the drawing (name, counts,
 * timestamps) — a few hundred bytes against a 900 kB budget.
 *
 * COMPUTED WHEN THE BROWSER IS IDLE, never in render and never during a
 * gesture. Serializing the whole document costs a few milliseconds at a few
 * thousand objects, and `touched()` mints a new document on every single edit,
 * so doing this eagerly would put a full JSON stringify in front of every
 * keystroke and every drag frame. This is the same shape as
 * `validate/live.ts`, for the same reason.
 */

import { useSyncExternalStore } from 'react'
import { useStore } from '../store/store'
import { serializeDoc } from '../persist/file'
import { MAX_DOC_BYTES, formatBytes } from './sync'

/**
 * How stale the reading may be. Longer than the QA report's 300 ms: a size
 * bar is a slow-moving number that nobody watches while typing, and the work
 * behind it (stringify the entire project) is the most expensive thing on this
 * schedule. One reading per second of editing is ample warning of a ceiling
 * that takes hours of drawing to approach.
 */
const IDLE_TIMEOUT_MS = 1_000

export type HeadroomState = 'healthy' | 'getting-large' | 'near-limit' | 'critical'

export interface Headroom {
  bytes: number
  /** 0–1 of the cap. Can exceed 1 — an over-size document is a real state, and
   *  saying "104%" is more use than pinning the bar at full. */
  fraction: number
  remaining: number
  state: HeadroomState
}

/**
 * Thresholds as fractions of the cap.
 *
 * Deliberately early. The interesting thing about this limit is that the last
 * stretch fills fast — a DXF underlay or a few hundred records can add a
 * hundred kilobytes in one action — so a warning at 95% is a warning that
 * arrives too late to do anything cheap about. "Getting large" at 60% is not
 * an alarm; it is the first point at which someone might reasonably plan.
 */
export const HEADROOM_THRESHOLDS: Record<Exclude<HeadroomState, 'healthy'>, number> = {
  'getting-large': 0.6,
  'near-limit': 0.8,
  critical: 0.95,
}

export function headroomState(fraction: number): HeadroomState {
  if (fraction >= HEADROOM_THRESHOLDS.critical) return 'critical'
  if (fraction >= HEADROOM_THRESHOLDS['near-limit']) return 'near-limit'
  if (fraction >= HEADROOM_THRESHOLDS['getting-large']) return 'getting-large'
  return 'healthy'
}

/** Size one document exactly as the cloud would store it. Pure — no store, no
 *  network — so the thresholds can be tested against a real document. */
export function measureDoc(doc: Parameters<typeof serializeDoc>[0]): Headroom {
  const bytes = new TextEncoder().encode(serializeDoc(doc, { pretty: false })).length
  const fraction = bytes / MAX_DOC_BYTES
  return {
    bytes,
    fraction,
    remaining: Math.max(0, MAX_DOC_BYTES - bytes),
    state: headroomState(fraction),
  }
}

const LABELS: Record<HeadroomState, string> = {
  healthy: 'Healthy',
  'getting-large': 'Getting large',
  'near-limit': 'Near limit',
  critical: 'Critical',
}

export function headroomLabel(state: HeadroomState): string {
  return LABELS[state]
}

/** One sentence an engineer can act on, not a percentage restated. */
export function headroomAdvice(h: Headroom): string {
  const size = `${formatBytes(h.bytes)} of ${formatBytes(MAX_DOC_BYTES)}`
  switch (h.state) {
    case 'healthy':
      return `${size} used in your account's copy of this drawing. Plenty of room.`
    case 'getting-large':
      return `${size} used. Still fine to keep working — worth knowing a cloud drawing has a ceiling.`
    case 'near-limit':
      return `${size} used, ${formatBytes(h.remaining)} left. A DXF underlay is usually the bulk of a large drawing; splitting sheets into separate projects also helps.`
    case 'critical':
      return (
        `${size} used. Saving to your account will start failing near this size. ` +
        'Remove a DXF underlay if one is loaded, or keep this project as a .pnid file on your computer.'
      )
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opt?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

const listeners = new Set<() => void>()
let current: Headroom | null = null
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
  const next = measureDoc(useStore.getState().doc)
  // Byte-identical readings are the common case between two small edits; not
  // publishing them keeps the status bar from re-rendering for nothing.
  if (current && current.bytes === next.bytes) return
  current = next
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
  current = measureDoc(useStore.getState().doc)
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

function snapshot(): Headroom {
  if (!current) {
    started = false
    start()
  }
  return current!
}

/** The current cloud-storage headroom. Recomputed when the browser is idle
 *  after an edit, never during one. */
export function useHeadroom(): Headroom {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Test seam: drop the watcher and its cached reading. */
export function resetHeadroom(): void {
  cancelPending()
  listeners.clear()
  current = null
  started = false
}
