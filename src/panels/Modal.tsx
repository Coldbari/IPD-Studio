// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled),' +
  ' textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'

/**
 * The one modal: backdrop + white card, Esc or backdrop click closes. Extracted
 * from the pattern HistoryDialog / DatasheetEditor / SymbolImportDialog each
 * hand-rolled — new dialogs (HMI included) use this instead of window.confirm.
 */
export default function Modal({ title, onClose, children, width = 380, busy = false }: {
  title: string
  onClose(): void
  children: React.ReactNode
  width?: number
  /** While true, Esc, the backdrop and × are all inert. A dialog must not
   *  vanish out from under a request that is still in flight — the one thing
   *  worse than a slow send is not knowing whether it went. */
  busy?: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  // Opening a dialog without moving focus leaves a keyboard or screen-reader
  // user standing in the toolbar, tabbing through the page *behind* the
  // backdrop. Focus the card rather than the first field, so the title is
  // announced before the form — and hand focus back on close, or closing drops
  // the user at the top of the document to re-find the control they came from.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cardRef.current?.focus()
    return () => opener?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!busy) onClose()
        return
      }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === card)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  return (
    // mousedown, and only when the press STARTED on the backdrop. Select text
    // in a textarea, drag past the card edge, release: the click lands on the
    // overlay and a half-written report is gone. Invisible in every dialog that
    // existed before this one, because none of them held typing worth losing.
    <div
      className="search-overlay"
      onMouseDown={(e) => { if (!busy && e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={cardRef}
        className="datasheet-box"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width, maxWidth: '92vw' }}
      >
        <div className="datasheet-head">
          <strong>{title}</strong>
          <button onClick={onClose} disabled={busy} title="Close" style={{ marginLeft: 'auto' }}>×</button>
        </div>
        <div className="datasheet-body">{children}</div>
      </div>
    </div>
  )
}
