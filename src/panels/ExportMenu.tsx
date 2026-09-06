// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useRef, useState } from 'react'
import Popover from './Popover'
import { exportSvgFile } from '../export/svg'
import { printPdf } from '../export/printPdf'
import { printAllSheets } from '../export/printAll'
import { exportPng } from '../export/png'
import { downloadDexpi } from '../export/dexpi'
import { downloadDxf } from '../export/dxf'
import { downloadDatasheetMatrix, downloadInstrumentIndex, downloadLineList } from '../export/csv'
import { useT } from '../i18n'

interface Item {
  label: string
  hint?: string
  run: () => void
}

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: 'Drawing',
    items: [
      { label: 'SVG image', run: () => exportSvgFile() },
      { label: 'PDF — this sheet', run: () => printPdf() },
      { label: 'PDF — all sheets', run: () => void printAllSheets() },
      { label: 'PNG image', run: () => exportPng() },
    ],
  },
  {
    title: 'CAD / data exchange',
    items: [
      { label: 'DXF (AutoCAD)', run: () => downloadDxf() },
      { label: 'DEXPI XML', run: () => downloadDexpi() },
    ],
  },
  {
    title: 'Reports (CSV)',
    items: [
      { label: 'Instrument index', run: () => downloadInstrumentIndex() },
      { label: 'Line list', run: () => downloadLineList() },
      { label: 'Datasheet matrix', run: () => downloadDatasheetMatrix() },
    ],
  },
]

/** All exports and reports behind one toolbar button, so the bar stays tidy. */
export default function ExportMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)


  return (
    <div className="export-menu">
      <button ref={btnRef} className={open ? 'on' : ''} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        {t('Export ▾')}
      </button>
      {open && (
        <Popover anchor={btnRef} onClose={() => setOpen(false)} className="export-pop" testId="export-pop">
          {SECTIONS.map((sec) => (
            <section key={sec.title}>
              <div className="export-title">{t(sec.title)}</div>
              {sec.items.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  className="export-item"
                  onClick={() => {
                    item.run()
                    setOpen(false)
                  }}
                >
                  {t(item.label)}
                </button>
              ))}
            </section>
          ))}
        </Popover>
      )}
    </div>
  )
}
