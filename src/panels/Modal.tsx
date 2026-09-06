// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect } from 'react'
import { useT } from '../i18n'

/**
 * The one modal: backdrop + white card, Esc or backdrop click closes. Extracted
 * from the pattern HistoryDialog / DatasheetEditor / SymbolImportDialog each
 * hand-rolled — new dialogs (HMI included) use this instead of window.confirm.
 */
export default function Modal({ title, onClose, children, width = 380 }: {
  title: string
  onClose(): void
  children: React.ReactNode
  width?: number
}) {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="search-overlay" role="dialog" aria-label={title} onClick={onClose}>
      <div className="datasheet-box" style={{ width, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="datasheet-head">
          <strong>{title}</strong>
          <button onClick={onClose} title={t('Close')} style={{ marginLeft: 'auto' }}>×</button>
        </div>
        <div className="datasheet-body">{children}</div>
      </div>
    </div>
  )
}
