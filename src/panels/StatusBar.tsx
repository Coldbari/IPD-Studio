// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { activeSheet, useStore } from '../store/store'
import { qaFor } from '../validate/engine'
import { useCloudStatus } from '../cloud/autosave'
import { VersionChip } from './VersionNote'
import { useT } from '../i18n'

// PWA update prompting lives in panels/UpdateToast.tsx (both workspaces).
// The budget chip moved to the toolbar (panels/BudgetDialog.tsx) — the running
// cost is something you steer by while drawing, not a status readout.

export default function StatusBar() {
  const t = useT()
  const dirty = useStore((s) => s.dirty)
  const selection = useStore((s) => s.selection)
  const nodes = useStore((s) => activeSheet(s).nodes.length)
  const qa = qaFor(useStore((s) => s.doc))
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
        <span className={`status-dot${dirty || cloud.state === 'saving' ? ' on' : ''}`}>●</span> {t(saveLabel)}
      </span>
      <span>{nodes} {t(nodes === 1 ? 'symbol' : 'symbols')}</span>
      {selection.length > 0 && <span>{selection.length} {t('selected')}</span>}
      <span className="sp" />
      <VersionChip />
      <span className={qa.counts.critical ? 'status-warn' : ''}>
        {qa.counts.critical
          ? `⚠ ${qa.counts.critical} ${t('critical')}`
          : qa.total
            ? `${qa.total} ${t(qa.total > 1 ? 'findings' : 'finding')}`
            : `✓ ${t('No findings')}`}
      </span>
    </footer>
  )
}
