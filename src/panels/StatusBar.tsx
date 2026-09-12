// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { activeSheet, useStore } from '../store/store'
import { useQa } from '../validate/live'
import { useCloudStatus } from '../cloud/autosave'
import { VersionChip } from './VersionNote'
import { FeedbackChip } from './FeedbackDialog'
import { notify, useStatusMessage } from '../feedback/notices'
import { headroomAdvice, headroomLabel, useHeadroom } from '../cloud/headroom'

/**
 * How full the cloud copy of this drawing is.
 *
 * Quiet while there is room — a percentage nobody needs is noise — and it
 * takes on colour and words as the ceiling approaches. It never blocks an
 * edit: the drawing is the user's, and a big drawing is a fact about their
 * plant, not a mistake. What it prevents is meeting the server's size refusal
 * for the first time with the work already done.
 */
function HeadroomChip() {
  const h = useHeadroom()
  const pct = Math.round(h.fraction * 100)
  return (
    <span
      data-testid="headroom"
      data-state={h.state}
      className={`status-headroom he-${h.state}`}
      title={headroomAdvice(h)}
    >
      <span className="he-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      {h.state === 'healthy' ? `${pct}%` : `${headroomLabel(h.state)} · ${pct}%`}
    </span>
  )
}

// PWA update prompting lives in panels/UpdateToast.tsx (both workspaces).
// The budget chip moved to the toolbar (panels/BudgetDialog.tsx) — the running
// cost is something you steer by while drawing, not a status readout.

export default function StatusBar() {
  const dirty = useStore((s) => s.dirty)
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => activeSheet(s).nodes.length)
  const qa = useQa()
  const cloud = useCloudStatus()
  const message = useStatusMessage()

  // One line about where the work stands. Two indicators ("Saved" next to
  // "Saved to your account") read as two different facts and made people look
  // twice to find out whether anything had actually reached the cloud.
  const saveLabel =
    cloud.state === 'error' ? 'Not saved to your account'
    : cloud.state === 'saving' ? 'Saving…'
    : dirty ? 'Unsaved changes'
    : cloud.state === 'saved' ? 'Saved to your account'
    : 'Saved'

  return (
    <footer className="status">
      <span data-testid="save-state" className={cloud.state === 'error' ? 'status-warn' : undefined} title={cloud.message ?? undefined}>
        <span className={`status-dot${dirty || cloud.state === 'saving' ? ' on' : ''}`}>●</span> {saveLabel}
      </span>
      <span>{nodes} symbol{nodes === 1 ? '' : 's'}</span>
      {selection.length > 0 && <span>{selection.length} selected</span>}
      {/* Level 3 of the feedback ladder: something worth saying that carries no
          decision. It never takes focus and it fades on its own — the whole
          point of it not being a dialog. `aria-live` so it is not silent to a
          screen reader just because it is quiet on screen. */}
      {message && (
        <span
          className={`status-msg${message.kind === 'warning' ? ' status-warn' : ''}`}
          data-testid="status-message"
          role="status"
          aria-live="polite"
        >
          {message.text}
          {message.details && (
            <button
              className="status-more"
              onClick={() => notify({
                kind: 'warning',
                title: message.text,
                details: message.details,
              })}
            >
              details
            </button>
          )}
        </span>
      )}
      <span className="sp" />
      {/* The two app-level chips travel together, left of the QA readout —
          which stays pinned right, where people already track it. */}
      <FeedbackChip />
      <VersionChip />
      <HeadroomChip />
      <span className={qa.counts.critical ? 'status-warn' : ''}>
        {qa.counts.critical
          ? `⚠ ${qa.counts.critical} critical`
          : qa.total
            ? `${qa.total} finding${qa.total > 1 ? 's' : ''}`
            : '✓ No findings'}
      </span>
    </footer>
  )
}
