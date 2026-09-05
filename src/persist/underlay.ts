// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { parseDxfUnderlay } from '../import/dxfUnderlay'
import { sheetPx } from '../model/doc'
import { activeSheet, useStore } from '../store/store'
import { notify, showStatus } from '../feedback/notices'
import { underlayEmptyNotice, underlayFailureNotice } from './openErrors'

/**
 * Load a DXF as a trace-over background, and say what happened.
 *
 * One implementation for both ways in — the File menu and a DXF dropped on the
 * canvas — which previously had two, phrased differently, one of which dumped
 * a joined list of parser warnings into `window.alert`.
 *
 * Three outcomes, three different things to say:
 *   - it did not parse            → a dialog: nothing landed, here is the file
 *   - it parsed with nothing to draw → a dialog: what an underlay reads
 *   - it parsed with entities skipped → a status line: it worked, with a caveat
 */
export async function loadUnderlayText(fileName: string, text: string): Promise<void> {
  const store = useStore.getState()
  const sheet = activeSheet(store)
  let result: ReturnType<typeof parseDxfUnderlay>
  try {
    result = parseDxfUnderlay(text, sheetPx(sheet.sheetSize))
  } catch (err) {
    notify(underlayFailureNotice(fileName, err))
    return
  }

  if (result.polylines.length === 0) {
    notify(underlayEmptyNotice(fileName))
    return
  }

  store.setUnderlay({ name: fileName, polylines: result.polylines })

  // It worked. A caveat is a status line, not a dialog — there is no decision
  // to make and the drawing is already on screen behind it.
  if (result.warnings.length) {
    showStatus(
      `${fileName} loaded — ${result.warnings.length} entity type${result.warnings.length === 1 ? '' : 's'} could not be drawn.`,
      { kind: 'warning', details: result.warnings.join('\n') },
    )
  } else {
    showStatus(`${fileName} loaded as a background. It is locked and never exported as geometry.`)
  }
}

/** Ask for a .dxf and load it. Shared by the File menu. */
export function pickUnderlay(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.dxf'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    await loadUnderlayText(file.name, await file.text())
  }
  input.click()
}
