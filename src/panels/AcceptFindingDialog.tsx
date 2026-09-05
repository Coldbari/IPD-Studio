// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import Modal from './Modal'

export interface AcceptTarget {
  /** Stable rule + entity key the acceptance is filed under. */
  key: string
  /** The rule's title — what class of thing is being accepted. */
  rule: string
  /** The finding itself, in full. */
  message: string
  /** Why the rule exists, where the rule says so. */
  why?: string
}

/**
 * Accepting a QA finding, with a reason.
 *
 * This was a `window.prompt`. A browser prompt collecting a permanent
 * engineering record is wrong in four separate ways: the finding it concerns
 * is crammed into the prompt's title with `\n\n` and scrolls away on some
 * platforms, an empty string is indistinguishable from Cancel, there is no
 * validation, and the record it writes outlives the drawing revision while
 * looking like a throwaway.
 *
 * So: the finding stays on screen the whole time it is being typed about, the
 * consequence is stated rather than implied, and an empty reason cannot be
 * submitted — an acceptance with no reason is exactly the acceptance the next
 * reviewer cannot evaluate.
 */
export default function AcceptFindingDialog({
  target, onAccept, onClose,
}: {
  target: AcceptTarget
  onAccept(reason: string): void
  onClose(): void
}) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const invalid = touched && trimmed.length === 0

  const submit = () => {
    setTouched(true)
    if (!trimmed) return
    onAccept(trimmed)
    onClose()
  }

  return (
    <Modal title="Accept this finding" onClose={onClose} width={480}>
      <div className="af">
        {/* Never out of sight while the reason is being written. */}
        <div className="af-finding" data-testid="accept-finding-context">
          <span className="af-rule">{target.rule}</span>
          <p className="af-msg">{target.message}</p>
          {target.why && <p className="af-why">{target.why}</p>}
        </div>

        <label className="af-field">
          <span className="af-label">
            Why is this acceptable? <span className="af-req">required</span>
          </span>
          <textarea
            data-testid="accept-reason"
            value={reason}
            autoFocus
            aria-invalid={invalid || undefined}
            aria-describedby="af-consequence"
            placeholder="e.g. Relief is provided by PSV-104 on the common header — see P&ID-002."
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              // Ctrl/⌘+Enter submits; plain Enter is a newline, because these
              // reasons run to a sentence or two and often carry a reference.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
            }}
          />
          {invalid && (
            <span className="af-err" role="alert">
              An acceptance without a reason is the one the next reviewer cannot judge.
            </span>
          )}
        </label>

        <p className="af-consequence" id="af-consequence">
          This is recorded on the drawing and travels with it. The finding stays
          visible in its own section with your reason beside it — accepting does
          not hide it. It survives deleting and redrawing the symbol, and you
          can reopen it at any time.
        </p>

        <div className="nx-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="nx-primary" data-testid="accept-go" disabled={!trimmed} onClick={submit}>
            Accept finding
          </button>
        </div>
      </div>
    </Modal>
  )
}
