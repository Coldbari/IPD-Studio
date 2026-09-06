// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import { useStore } from '../store/store'
import { openFile, saveFile } from '../persist/file'
import { saveNow } from '../cloud/autosave'
import HistoryDialog from './HistoryDialog'
import { createEmptyDoc } from '../model/doc'
import { canvasRef, fitView, zoomActual, zoomCenter } from '../canvas/paperSetup'
import { LINE_CLASS_LABELS } from '../canvas/lineStyle'
import type { LineClass } from '../model/types'
import ExportMenu from './ExportMenu'
import AccountMenu from './AccountMenu'
import FluidsDialog from './FluidsDialog'
import { BudgetChip } from './BudgetDialog'
import templateBlank from '../../examples/template-blank-a3.pnid.json'
import templateUtility from '../../examples/template-utility-a1.pnid.json'
import { loadDoc } from '../model/migrate'
import { parseDxfUnderlay } from '../import/dxfUnderlay'
import { sheetPx } from '../model/doc'
import { activeSheet } from '../store/store'
import samplePlant from '../../examples/sample-plant.pnid.json'
import sampleRefinery from '../../examples/sample-refinery-unit.pnid.json'
import templateHmiDemo from '../../examples/template-hmi-demo.pnid.json'
import { setLanguage, useLanguage, useT } from '../i18n'

/** Live zoom readout, so the scale is never a mystery. */
function ZoomCluster() {
  const t = useT()
  const sheetSize = useStore((s) => activeSheet(s).sheetSize)
  const [pct, setPct] = useState(100)
  useEffect(() => {
    const tick = () => {
      const sx = canvasRef.paper?.scale().sx
      if (sx) setPct(Math.round(sx * 100))
    }
    tick()
    const id = window.setInterval(tick, 220)
    return () => window.clearInterval(id)
  }, [])
  const fit = () => {
    const { paper, graph } = canvasRef
    if (paper && graph) fitView(paper, graph, sheetSize)
  }
  return (
    <span className="tb-zoom" role="group" aria-label={t('Zoom')}>
      <button data-testid="tb-zoom-out" title={t('Zoom out')}
        onClick={() => canvasRef.paper && zoomCenter(canvasRef.paper, 1 / 1.2)}>−</button>
      <button className="tb-zoom-pct" data-testid="tb-zoom-pct" title={t('Reset to 100%')}
        onClick={() => canvasRef.paper && zoomActual(canvasRef.paper)}>{pct}%</button>
      <button data-testid="tb-zoom-in" title={t('Zoom in')}
        onClick={() => canvasRef.paper && zoomCenter(canvasRef.paper, 1.2)}>+</button>
      <button data-testid="tb-fit" title={t('Fit the whole sheet in the visible canvas (Shift+F)')}
        onClick={fit}>{t('Fit')}</button>
    </span>
  )
}

export default function Toolbar() {
  const t = useT()
  const lang = useLanguage()
  const dirty = useStore((s) => s.dirty)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const activeLineClass = useStore((s) => s.activeLineClass)
  const setActiveLineClass = useStore((s) => s.setActiveLineClass)
  const name = useStore((s) => s.doc.meta.name)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [fluidsOpen, setFluidsOpen] = useState(false)

  useEffect(() => {
    const onSave = () => void saveNow()
    window.addEventListener('pid:save', onSave)
    return () => window.removeEventListener('pid:save', onSave)
  }, [])

  const newDoc = () => {
    if (dirty && !window.confirm(t('Discard unsaved changes?'))) return
    useStore.getState().loadIntoStore(createEmptyDoc())
  }

  return (
    <header className="toolbar">
      <strong className="app-name">IPD Studio</strong>
      <span className="doc-name">{name}{dirty ? ' •' : ''}</span>
      <span className="tb-sep" />
      <button onClick={newDoc}>{t('New')}</button>
      <button onClick={() => void openFile()}>{t('Open')}</button>
      <button data-testid="tb-save" onClick={() => void saveNow()}
        title={t('Save (Ctrl+S) — stores this drawing in your account when you are signed in')}>
        {t('Save')}
      </button>
      <button data-testid="tb-download" onClick={() => void saveFile({ saveAs: true, rememberHandle: false })}
        title={t('Download a .pnid file to this computer')}>
        {t('Download')}
      </button>
      <button className="tb-icon" onClick={() => setHistoryOpen(true)} title={t('Restore an earlier snapshot')}>⏱</button>
      {historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}
      <select
        className="tb-template"
        value=""
        onChange={(e) => {
          const pick = e.target.value
          if (!pick) return
          if (dirty && !window.confirm(t('Discard unsaved changes?'))) return
          const source = pick === 'sample' ? samplePlant : pick === 'refinery' ? sampleRefinery : pick === 'hmi-demo' ? templateHmiDemo : pick === 'blank' ? templateBlank : templateUtility
          useStore.getState().loadIntoStore(loadDoc(source))
        }}
      >
        <option value="">{t('Templates…')}</option>
        <option value="sample">{t('Sample plant')}</option>
        <option value="refinery">{t('Refinery unit (3 sheets)')}</option>
        <option value="hmi-demo">{t('HMI demo (tank level loop)')}</option>
        <option value="blank">{t('Blank A3 drawing')}</option>
        <option value="utility">{t('Utility headers (A1)')}</option>
      </select>
      <span className="tb-sep" />
      <button
        onClick={() => {
          const state = useStore.getState()
          const sheet = activeSheet(state)
          if (sheet.underlay) {
            if (window.confirm(t('Remove the DXF underlay from this sheet?'))) state.setUnderlay(undefined)
            return
          }
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.dxf'
          input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            try {
              const px = sheetPx(sheet.sheetSize)
              const { polylines, warnings } = parseDxfUnderlay(await file.text(), px)
              state.setUnderlay({ name: file.name, polylines })
              if (warnings.length) window.alert(t('Underlay loaded with notes:') + '\n' + warnings.join('\n'))
            } catch (err) {
              window.alert(t('Could not read DXF:') + ' ' + (err as Error).message)
            }
          }
          input.click()
        }}
        title={t('Load a DXF as a locked trace-over background')}
      >
        {t('Underlay')}
      </button>
      <span className="tb-sep" />
      <button className="tb-icon" onClick={undo} title={t('Undo (Ctrl+Z)')}>↩</button>
      <button className="tb-icon" onClick={redo} title={t('Redo (Ctrl+Y)')}>↪</button>
      <span className="tb-sep" />
      <label className="tb-line">
        <span className="tb-line-label">{t('Draw:')}</span>
        <select value={activeLineClass} onChange={(e) => setActiveLineClass(e.target.value as LineClass)}>
          {Object.entries(LINE_CLASS_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{t(label)}</option>
          ))}
        </select>
      </label>
      <button data-testid="tb-fluids" onClick={() => setFluidsOpen(true)}
        title={t("Define fluids/services (Water, Steam…) — assign them to lines in the line's properties")}>
        {t('Fluids')}
      </button>
      {fluidsOpen && <FluidsDialog onClose={() => setFluidsOpen(false)} />}
      <BudgetChip />
      <span className="tb-sep" />
      <ZoomCluster />
      <span className="tb-grow" />
      <ExportMenu />
      <button className="tb-lang" data-testid="language-toggle" title={lang === 'zh-CN' ? 'Switch to English' : '切换为中文'}
        onClick={() => setLanguage(lang === 'zh-CN' ? 'en' : 'zh-CN')}>{lang === 'zh-CN' ? 'EN' : '中'}</button>
      <AccountMenu />
    </header>
  )
}
