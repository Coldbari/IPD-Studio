// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import { useStore } from '../store/store'
import { saveNow } from '../cloud/autosave'
import { canvasRef, fitView, onCanvasChange, zoomActual, zoomCenter } from '../canvas/paperSetup'
import { LINE_CLASS_LABELS } from '../canvas/lineStyle'
import type { LineClass } from '../model/types'
import ExportMenu from './ExportMenu'
import AccountMenu from './AccountMenu'
import FileMenu from './FileMenu'
import FluidsDialog from './FluidsDialog'
import { BudgetChip } from './BudgetDialog'
import { hint } from '../shortcuts/registry'
import { activeSheet } from '../store/store'

/** Live zoom readout, so the scale is never a mystery. */
function ZoomCluster() {
  const sheetSize = useStore((s) => activeSheet(s).sheetSize)
  const [pct, setPct] = useState(100)
  useEffect(() => {
    const tick = () => {
      const sx = canvasRef.paper?.scale().sx
      if (sx) setPct(Math.round(sx * 100))
    }
    // The paper announces its own zoom, and the canvas announces the paper.
    // The toolbar mounts before the canvas does, so this waits to be told
    // rather than looking once a second for the rest of the session — the
    // reference changes exactly twice, on mount and on teardown.
    let paper: { on(e: string, cb: () => void): void; off(e: string, cb: () => void): void } | undefined
    const attach = () => {
      const current = canvasRef.paper
      if (current === paper) return
      paper?.off('scale', tick)
      paper = current
      paper?.on('scale', tick)
      tick()
    }
    attach()
    const off = onCanvasChange(attach)
    return () => {
      off()
      paper?.off('scale', tick)
    }
  }, [])
  const fit = () => {
    const { paper, graph } = canvasRef
    if (paper && graph) fitView(paper, graph, sheetSize)
  }
  return (
    <span className="tb-zoom" role="group" aria-label="Zoom">
      <button data-testid="tb-zoom-out" title="Zoom out"
        onClick={() => canvasRef.paper && zoomCenter(canvasRef.paper, 1 / 1.2)}>−</button>
      <button className="tb-zoom-pct" data-testid="tb-zoom-pct" title={hint('Reset to 100%', 'view.actual')}
        onClick={() => canvasRef.paper && zoomActual(canvasRef.paper)}>{pct}%</button>
      <button data-testid="tb-zoom-in" title="Zoom in"
        onClick={() => canvasRef.paper && zoomCenter(canvasRef.paper, 1.2)}>+</button>
      <button data-testid="tb-fit" title={hint('Fit the whole sheet in the visible canvas', 'view.fit')}
        onClick={fit}>Fit</button>
    </span>
  )
}

export default function Toolbar() {
  const dirty = useStore((s) => s.dirty)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const activeLineClass = useStore((s) => s.activeLineClass)
  const setActiveLineClass = useStore((s) => s.setActiveLineClass)
  const name = useStore((s) => s.doc.meta.name)
  const [fluidsOpen, setFluidsOpen] = useState(false)

  useEffect(() => {
    const onSave = () => void saveNow()
    window.addEventListener('pid:save', onSave)
    return () => window.removeEventListener('pid:save', onSave)
  }, [])

  return (
    <header className="toolbar">
      {/* Left of the divider scrolls when the window is narrow; Export and the
          account control sit in .tb-fixed on the right and never do. They used
          to be last in one scrolling row, which is why they were the two that
          disappeared on a 13" laptop — the two you cannot finish without. */}
      <div className="tb-scroll">
        <strong className="app-name">IPD Studio</strong>
        <span className="doc-name">{name}{dirty ? ' •' : ''}</span>
        <span className="tb-sep" />
        <FileMenu />
        <button data-testid="tb-save" onClick={() => void saveNow()}
          title={hint('Save — stores this drawing in your account when you are signed in', 'app.save')}>
          Save
        </button>
        <span className="tb-sep" />
        <button className="tb-icon" onClick={undo} title={hint('Undo', 'edit.undo')}>↩</button>
        <button className="tb-icon" onClick={redo} title={hint('Redo', 'edit.redo')}>↪</button>
        <span className="tb-sep" />
        <label className="tb-line">
          <span className="tb-line-label">Draw:</span>
          <select
            value={activeLineClass}
            aria-label="Line type for the next line drawn"
            title="The class of the next line you draw. Port-to-port connections pick their own class where the ports imply one."
            onChange={(e) => setActiveLineClass(e.target.value as LineClass)}
          >
            {Object.entries(LINE_CLASS_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>
        <button data-testid="tb-fluids" onClick={() => setFluidsOpen(true)}
          title="Define fluids/services (Water, Steam…) — assign them to lines in the line's properties">
          Fluids
        </button>
        {fluidsOpen && <FluidsDialog onClose={() => setFluidsOpen(false)} />}
        <BudgetChip />
        <span className="tb-sep" />
        <ZoomCluster />
      </div>
      <div className="tb-fixed">
        <ExportMenu />
        <AccountMenu />
      </div>
    </header>
  )
}
