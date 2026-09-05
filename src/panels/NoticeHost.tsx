// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import Modal from './Modal'
import {
  dismissNotice, useNotices, usePendingConfirm,
  type Notice, type NoticeAction,
} from '../feedback/notices'

/**
 * Where a failure appears.
 *
 * One implementation for all of them, rather than the nineteen hand-written
 * `window.alert` strings this replaces. Built on the existing `Modal`, so the
 * focus trap, the focus restore, Escape and the press-started-on-the-backdrop
 * rule all come for free and cannot drift from the dialogs that already have
 * them.
 *
 * Only ONE notice is on screen at a time even when several are raised: a stack
 * of error dialogs is a thing to dismiss, not a thing to read.
 */
function NoticeDialog({ notice }: { notice: Notice }) {
  const [busy, setBusy] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const close = () => dismissNotice(notice.id)

  const run = async (action: NoticeAction) => {
    setBusy(true)
    try {
      await action.run()
      close()
    } catch {
      // The action failed too. Leave the dialog up rather than closing on a
      // second failure — the user would be left with no sign either happened.
      setBusy(false)
    }
  }

  return (
    <Modal title={notice.title} onClose={close} width={440} busy={busy}>
      <div className="nx">
        {/* Omitted entirely when the app does not know why. An invented cause
            reads exactly like a real one. */}
        {notice.body && <p className="nx-body">{notice.body}</p>}
        {notice.hint && <p className="nx-hint">{notice.hint}</p>}

        {notice.details && (
          <details className="nx-details" open={showDetails} onToggle={(e) => setShowDetails((e.target as HTMLDetailsElement).open)}>
            <summary>Details</summary>
            <pre>{notice.details}</pre>
          </details>
        )}

        <div className="nx-actions">
          {notice.actions?.map((a) => (
            <button
              key={a.label}
              className={a.primary ? 'nx-primary' : undefined}
              disabled={busy}
              onClick={() => void run(a)}
            >
              {a.label}
            </button>
          ))}
          <button className={notice.actions?.length ? undefined : 'nx-primary'} disabled={busy} onClick={close}>
            {notice.actions?.length ? 'Close' : 'OK'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Ask before something Undo cannot take back.
 *
 * The affirmative button says what it does — "Discard changes", "Delete
 * sheet" — never "OK". A confirmation whose buttons are OK and Cancel makes
 * the user re-read the question to work out which way round it is.
 */
function ConfirmDialog() {
  const req = usePendingConfirm()
  if (!req) return null
  return (
    <Modal title={req.title} onClose={() => req.resolve(false)} width={420}>
      <div className="nx">
        <p className="nx-body">{req.body}</p>
        <div className="nx-actions">
          <button onClick={() => req.resolve(false)}>Cancel</button>
          <button
            className={req.danger ? 'nx-danger' : 'nx-primary'}
            data-testid="confirm-go"
            onClick={() => req.resolve(true)}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function NoticeHost() {
  const notices = useNotices()
  const top = notices[0]
  return (
    <>
      {top && <NoticeDialog key={top.id} notice={top} />}
      <ConfirmDialog />
    </>
  )
}
