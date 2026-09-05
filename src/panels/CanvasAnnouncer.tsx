// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import { activeSheet, useStore } from '../store/store'
import { describeSelection } from '../canvas/keyboardNav'

/**
 * What the drawing tells a screen reader.
 *
 * TWO DOM nodes for the entire canvas, whatever is on it. The alternative —
 * an accessible node per symbol — was never on the table: one symbol renders
 * 69 elements, a thousand-object sheet is already ~69,000, and the paper
 * virtualizes above 400 cells precisely so the browser does not have to hold
 * them all. Mirroring that into an accessibility tree would undo the work and
 * hand a screen-reader user a list of a thousand items to walk.
 *
 * So the drawing is announced the way a person describes one: not as an
 * inventory, but as "here is what you have hold of now". The selection is the
 * cursor, and this says what the cursor is on — "FIC-101, Instrument Bubble,
 * 4 of 17" — as it moves.
 *
 * `polite`, so it waits for a gap rather than interrupting; and it only ever
 * replaces its own text, so a fast Tab through a drawing produces one final
 * announcement rather than a queue of them.
 */
export default function CanvasAnnouncer() {
  // Subscribed to the SELECTION only, never to the document. This component is
  // mounted for the life of the session, and reading the sheet reactively
  // would re-render it — and re-describe the drawing — on every keystroke of a
  // tag edit and every write a docking drag makes.
  const selection = useStore((s) => s.selection)
  const [text, setText] = useState('')
  const last = useRef('')

  useEffect(() => {
    const next = describeSelection(activeSheet(useStore.getState()), selection)
    // Identical text set twice is not re-announced by most screen readers, so
    // only speak when it really changed.
    if (next === last.current) return
    last.current = next
    setText(next)
  }, [selection])

  return (
    <>
      <p className="sr-only" id="canvas-help">
        Drawing. Press Tab to step through the symbols and lines on this sheet,
        Enter to open the selected object’s properties, Shift+F10 for its
        actions, and Escape to clear the selection and move on.
      </p>
      <p className="sr-only" role="status" aria-live="polite" data-testid="canvas-announcer">
        {text}
      </p>
    </>
  )
}
