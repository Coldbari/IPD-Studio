// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useMemo } from 'react'
import { deriveLoops } from '../store/selectors'
import { formatTag } from '../isa/tag'
import { printLoopDiagram } from '../export/loopDiagram'
import { useStore } from '../store/store'
import { useT } from '../i18n'

export default function LoopPanel() {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const setSelection = useStore((s) => s.setSelection)
  const loops = useMemo(() => deriveLoops(doc), [doc])
  if (loops.length === 0) return <div className="drawer-empty">{t('No tagged instruments yet.')}</div>
  return (
    <div className="drawer-list">
      {loops.map((loop) => (
        <div key={`${loop.family}-${loop.loop}`} className="loop-row">
          <button
            className="drawer-item"
            onClick={() => setSelection(loop.members.map((m) => m.nodeId))}
          >
            <b>{t('Loop')} {loop.family}-{loop.loop}</b>{' '}
            {loop.members.map((m) => formatTag(m.tag, '-')).join(', ')}
            {loop.hint && <span className="loop-hint"> — {t(loop.hint)}</span>}
          </button>
          <button
            className="loop-diagram-btn"
            title={t('Generate ISA-5.4-style loop diagram')}
            onClick={() => printLoopDiagram(doc, loop.family, loop.loop)}
          >
            {t('Diagram')}
          </button>
        </div>
      ))}
    </div>
  )
}
