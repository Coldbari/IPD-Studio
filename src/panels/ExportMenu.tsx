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
import { notify } from '../feedback/notices'

interface Item {
  label: string
  hint?: string
  run: () => void | Promise<void>
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

/**
 * Run an export and say what happened if it does not finish.
 *
 * There was no error handling on any of the nine: a throw in the SVG
 * serializer or the PDF print window left the menu closing and nothing
 * happening, which is indistinguishable from a browser that silently blocked
 * the download.
 *
 * The message leads with the fact that matters most and that a failing export
 * makes people doubt — the drawing is fine. An export reads the document; it
 * never writes to it. Retry is offered because the common causes (a blocked
 * pop-up for the PDF, a transient out-of-memory on a huge PNG) genuinely do
 * succeed on a second attempt.
 */
async function runExport(item: Item): Promise<void> {
  try {
    await item.run()
  } catch (err) {
    notify({
      kind: 'error',
      title: `${item.label} could not be exported`,
      hint: 'Your drawing is open and unchanged — an export only ever reads it. Trying again often works, and the other formats are unaffected.',
      details: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      actions: [{ label: 'Try again', primary: true, run: () => item.run() }],
    })
  }
}

/** All exports and reports behind one toolbar button, so the bar stays tidy. */
export default function ExportMenu() {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)


  return (
    <div className="tb-menu">
      <button ref={btnRef} className={open ? 'on' : ''} data-testid="tb-export" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        Export ▾
      </button>
      {open && (
        <Popover anchor={btnRef} onClose={() => setOpen(false)} className="export-pop" testId="export-pop">
          {SECTIONS.map((sec) => (
            <section key={sec.title}>
              <div className="export-title">{sec.title}</div>
              {sec.items.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  className="export-item"
                  onClick={() => {
                    setOpen(false)
                    void runExport(item)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </section>
          ))}
        </Popover>
      )}
    </div>
  )
}
