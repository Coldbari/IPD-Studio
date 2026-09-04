// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { activeSheet, useStore } from '../store/store'
import { useQa } from '../validate/live'
import { useCloudStatus } from '../cloud/autosave'
import { VersionChip } from './VersionNote'
import { FeedbackChip } from './FeedbackDialog'

// PWA update prompting lives in panels/UpdateToast.tsx (both workspaces).
// The budget chip moved to the toolbar (panels/BudgetDialog.tsx) — the running
// cost is something you steer by while drawing, not a status readout.

export default function StatusBar() {
  const dirty = useStore((s) => s.dirty)
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => activeSheet(s).nodes.length)
  const qa = useQa()
  const cloud = useCloudStatus()

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
      <span className="sp" />
      {/* The two app-level chips travel together, left of the QA readout —
          which stays pinned right, where people already track it. */}
      <FeedbackChip />
      <VersionChip />
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
