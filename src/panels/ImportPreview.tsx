// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import Modal from './Modal'
import { useStore } from '../store/store'
import type { ChangeSet } from '../model/bulkEdit'
import { labelForField } from '../model/fields'

/**
 * What a spreadsheet is about to do to the engineering records, before it does
 * any of it.
 *
 * The refusal is deliberately all-or-nothing and the reasons are itemised: a
 * dialog that offered to apply the good rows would leave a project half
 * updated with no way to tell which half.
 */
export default function ImportPreview({
  changes, source, onClose,
}: { changes: ChangeSet; source: string; onClose(): void }) {
  const apply = () => {
    useStore.getState().applyRecordEdits(
      changes.modified.map((c) => ({
        key: c.key,
        kind: 'instrument' as const,
        field: c.field,
        value: c.after,
        // A Unit assignment carries the id the change set already resolved.
        // The code in `after` is what the dialog shows; it is never what gets
        // written, so a later rename of that unit cannot reinterpret the
        // import after the fact.
        ...(c.unitId !== undefined ? { unitId: c.unitId } : {}),
      })),
    )
    onClose()
  }

  const nothingToDo = changes.ok && changes.modified.length === 0

  return (
    <Modal title={`Import — ${source}`} onClose={onClose} width={620}>
      <div className="imp" data-testid="import-preview">
        <div className="imp-summary" data-testid="imp-summary">
          <span><b>{changes.modified.length}</b> to change</span>
          <span><b>{changes.unchanged}</b> unchanged</span>
          <span className={changes.problems.length ? 'imp-bad' : ''}>
            <b>{changes.problems.length}</b> problem{changes.problems.length === 1 ? '' : 's'}
          </span>
        </div>

        {changes.problems.length > 0 && (
          <div className="imp-problems" data-testid="imp-problems">
            <div className="imp-label">Nothing will be applied until these are fixed</div>
            <table>
              <thead><tr><th>Row</th><th>Tag</th><th>Field</th><th>Problem</th></tr></thead>
              <tbody>
                {changes.problems.slice(0, 50).map((p, i) => (
                  <tr key={i}>
                    <td>{p.row || '—'}</td><td>{p.key ?? '—'}</td>
                    <td>{p.field ?? '—'}</td><td>{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {changes.problems.length > 50 && (
              <p className="imp-note">…and {changes.problems.length - 50} more.</p>
            )}
          </div>
        )}

        {changes.ok && changes.modified.length > 0 && (
          <div className="imp-changes" data-testid="imp-changes">
            <div className="imp-label">Will change</div>
            <table>
              <thead><tr><th>Tag</th><th>Field</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                {changes.modified.map((c, i) => (
                  <tr key={`${c.key}-${c.field}-${i}`}>
                    <td>{c.key}</td><td>{labelForField(c.field)}</td>
                    <td className="imp-before">{c.before || '—'}</td>
                    <td className="imp-after">{c.after || '(cleared)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nothingToDo && <p className="imp-note" data-testid="imp-nothing">Every row matches what is already recorded.</p>}

        {changes.notIncluded.length > 0 && (
          <p className="imp-note" data-testid="imp-not-included">
            {changes.notIncluded.length} record{changes.notIncluded.length === 1 ? '' : 's'} in the project
            {changes.notIncluded.length === 1 ? ' was' : ' were'} not in this file. Nothing will be deleted —
            an absent row means the file did not mention it.
          </p>
        )}

        <div className="imp-actions">
          <button
            className="imp-apply"
            data-testid="imp-apply"
            disabled={!changes.ok || changes.modified.length === 0}
            onClick={apply}
          >
            Apply {changes.modified.length} change{changes.modified.length === 1 ? '' : 's'}
          </button>
          <button data-testid="imp-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  )
}
