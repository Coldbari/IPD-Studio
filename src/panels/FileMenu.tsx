// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useRef, useState } from 'react'
import Popover from './Popover'
import HistoryDialog from './HistoryDialog'
import { openFile, saveFile } from '../persist/file'
import { createEmptyDoc } from '../model/doc'
import { loadDoc } from '../model/migrate'
import { pickUnderlay } from '../persist/underlay'
import { confirmAction, showStatus } from '../feedback/notices'
import { display } from '../shortcuts/registry'
import { activeSheet, useStore } from '../store/store'
import templateBlank from '../../examples/template-blank-a3.pnid.json'
import templateUtility from '../../examples/template-utility-a1.pnid.json'
import templateHmiDemo from '../../examples/template-hmi-demo.pnid.json'
import samplePlant from '../../examples/sample-plant.pnid.json'
import sampleRefinery from '../../examples/sample-refinery-unit.pnid.json'

const TEMPLATES: { id: string; label: string; doc: unknown }[] = [
  { id: 'sample', label: 'Sample plant', doc: samplePlant },
  { id: 'refinery', label: 'Refinery unit (3 sheets)', doc: sampleRefinery },
  { id: 'hmi-demo', label: 'HMI demo (tank level loop)', doc: templateHmiDemo },
  { id: 'blank', label: 'Blank A3 drawing', doc: templateBlank },
  { id: 'utility', label: 'Utility headers (A1)', doc: templateUtility },
]

/**
 * Everything you do to the document as a whole, behind one button.
 *
 * These six controls — New, Open, Download, history, Templates, Underlay —
 * used to sit loose in the toolbar as peers of Save, Undo and the zoom
 * cluster: twenty controls in one non-wrapping row that had already given up
 * three sets of labels to responsive breakpoints and still overflowed. At
 * 1152px the row was 42px wider than its container, and what fell off the end
 * was Export — the way a drawing leaves the application — and the account
 * menu. macOS draws no scrollbar until you scroll, so the row simply ended.
 *
 * Frequency is what sorts them: you save constantly, undo constantly, zoom
 * constantly. You start a new drawing once. Putting the once-a-drawing actions
 * one click deeper buys back ~360px and lets the row read as file / edit /
 * draw / view instead of as twenty equals.
 *
 * Templates become real menu items rather than a <select> labelled
 * "Templates…", which was a control that had to be operated to find out what
 * it offered.
 */
export default function FileMenu() {
  const [open, setOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dirty = useStore((s) => s.dirty)

  /**
   * Anything that REPLACES the whole document asks first when there is unsaved
   * work — this is one of the few actions Undo genuinely cannot recover, so it
   * earns a question where a delete does not.
   *
   * The affirmative button says what it does, and the body says where the work
   * that is about to disappear can still be found. "Discard unsaved changes?
   * [OK] [Cancel]" said neither.
   */
  const guard = async (what: string) => {
    if (!dirty) return true
    return confirmAction({
      title: `${what} without saving?`,
      body: 'The changes in this drawing have not been saved to your account. They are autosaved locally and can be recovered from Version history, but this drawing will close.',
      confirmLabel: what,
      danger: true,
    })
  }

  const run = (fn: () => void | Promise<void>) => {
    setOpen(false)
    void fn()
  }

  const loadUnderlay = () => {
    const state = useStore.getState()
    if (activeSheet(state).underlay) {
      // Undoable, so it just happens — and the status line says how to put it
      // back. A confirmation here would be asking permission for something the
      // user can already reverse with one key.
      state.setUnderlay(undefined)
      showStatus(`Underlay removed. ${display('edit.undo')} puts it back.`)
      return
    }
    pickUnderlay()
  }

  const hasUnderlay = useStore((s) => Boolean(activeSheet(s).underlay))

  return (
    <div className="tb-menu">
      <button
        ref={btnRef}
        className={open ? 'on' : ''}
        data-testid="tb-file"
        aria-haspopup="menu"
        aria-expanded={open}
        title="New, open, download, templates and the DXF underlay"
        onClick={() => setOpen((v) => !v)}
      >
        File ▾
      </button>
      {open && (
        <Popover anchor={btnRef} onClose={() => setOpen(false)} className="export-pop" testId="file-pop">
          <section>
            <div className="export-title">Drawing</div>
            <button className="export-item" role="menuitem"
              onClick={() => run(async () => {
                if (await guard('Start a new drawing')) useStore.getState().loadIntoStore(createEmptyDoc())
              })}>
              New drawing
            </button>
            <button className="export-item" role="menuitem" onClick={() => run(() => void openFile())}>
              Open a file…
            </button>
            <button className="export-item" role="menuitem" data-testid="tb-download"
              onClick={() => run(() => void saveFile())}>
              Download a .pnid
            </button>
            <button className="export-item" role="menuitem" onClick={() => run(() => setHistoryOpen(true))}>
              Version history…
            </button>
          </section>
          <section>
            <div className="export-title">Start from a template</div>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="export-item"
                role="menuitem"
                data-testid={`tpl-${t.id}`}
                onClick={() => run(async () => {
                  if (await guard(`Open ${t.label}`)) useStore.getState().loadIntoStore(loadDoc(t.doc))
                })}
              >
                {t.label}
              </button>
            ))}
          </section>
          <section>
            <div className="export-title">Background</div>
            <button className="export-item" role="menuitem" onClick={() => run(loadUnderlay)}
              title="A DXF laid under the sheet to trace over. It is locked and never exported as geometry.">
              {hasUnderlay ? 'Remove the DXF underlay' : 'Load a DXF underlay…'}
            </button>
          </section>
        </Popover>
      )}
      {historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
