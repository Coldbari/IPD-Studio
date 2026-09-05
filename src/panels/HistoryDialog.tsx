// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import { listHistory, restoreSnapshot, type Snapshot } from '../persist/autosave'
import { useStore } from '../store/store'
import { confirmAction, notify } from '../feedback/notices'

/** Automatic snapshots (one per ~2 min of editing, last 10 kept) to go back to. */
export default function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null)
  const dirty = useStore((s) => s.dirty)

  useEffect(() => {
    void listHistory().then(setSnaps)
  }, [])

  const restore = async (snap: Snapshot) => {
    // Replacing the document is outside Undo's reach, so it is asked about —
    // and the question names the snapshot, because "this snapshot" in a list
    // of ten is not an identification.
    if (dirty) {
      const ok = await confirmAction({
        title: 'Restore this snapshot?',
        body: `The drawing open now has unsaved changes, and restoring “${snap.name}” from ${new Date(snap.ts).toLocaleString()} replaces it. This cannot be undone.`,
        confirmLabel: 'Restore it',
        danger: true,
      })
      if (!ok) return
    }
    try {
      restoreSnapshot(snap)
      onClose()
    } catch (err) {
      notify({
        kind: 'error',
        title: 'That snapshot could not be restored',
        body: 'It was saved by an older version of IPD Studio, or the stored copy is incomplete.',
        hint: 'Your current drawing is untouched. The other snapshots in this list are unaffected — try an adjacent one.',
        details: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="datasheet-box" onClick={(e) => e.stopPropagation()}>
        <div className="datasheet-head">
          <b>File history</b>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="datasheet-body">
          <p className="prop-hint">Automatic snapshots of your work, newest first.</p>
          {snaps === null && <div className="drawer-empty">Loading…</div>}
          {snaps?.length === 0 && <div className="drawer-empty">No snapshots yet — they appear as you draw.</div>}
          {snaps?.map((s) => (
            <button key={s.ts} className="history-row" onClick={() => void restore(s)}>
              <b>{s.name}</b>
              <span>{new Date(s.ts).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
