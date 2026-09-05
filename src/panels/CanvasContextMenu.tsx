// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { activeSheet, useStore } from '../store/store'
import {
  applyAlignment, copySelection, duplicateSelection, hasClipboard,
  pasteClipboard, reverseEdge, rotateSelection, selectAll, toggleFlowArrow,
} from '../canvas/interactions'
import { canvasRef, fitView } from '../canvas/paperSetup'
import { display } from '../shortcuts/registry'
import { focusCanvas } from '../canvas/keyboardNav'

/** Where the canvas asked for a menu, in client coordinates. */
export interface ContextRequest { x: number; y: number }

interface Item {
  label: string
  shortcut?: string
  run(): void
  disabled?: boolean
  danger?: boolean
}

const SEP = 'separator' as const
/** The eight alignment operations, as one compact block rather than eight
 *  rows — a menu you have to scroll is not faster than the panel. */
const ALIGN = 'align' as const
type Row = Item | typeof SEP | typeof ALIGN

const ALIGNMENTS: [Parameters<typeof applyAlignment>[0], string, string][] = [
  ['left', '⇤', 'Align left edges'],
  ['center-v', '⇹', 'Align vertical centres'],
  ['right', '⇥', 'Align right edges'],
  ['distribute-h', '↔', 'Space evenly across'],
  ['top', '⤒', 'Align top edges'],
  ['center-h', '⇳', 'Align horizontal centres'],
  ['bottom', '⤓', 'Align bottom edges'],
  ['distribute-v', '↕', 'Space evenly down'],
]

/**
 * Right-click on the drawing.
 *
 * There was no context menu anywhere in the application — not on the canvas,
 * not on a symbol, not on a line. Right-click is the first thing an engineer
 * arriving from AutoCAD, Visio or SmartPlant tries, and every contextual
 * action (rotate, duplicate, delete, align, reverse) could only be reached by
 * travelling to the right-hand column and back.
 *
 * Two jobs, not one. It is the fast path for people who know what they want,
 * and it is the app's main teaching surface for everyone else: every row that
 * has a keyboard shortcut prints it, so the seven bindings nothing documented
 * are learned in the course of using the mouse. That is why the rows call the
 * SAME exported functions the keyboard calls — a menu that did its own thing
 * would eventually do a different thing.
 *
 * What it offers follows the selection, because that is what the user is
 * asking about: blank paper, one symbol, several, or a line.
 */
export default function CanvasContextMenu() {
  const [at, setAt] = useState<ContextRequest | null>(null)
  const selection = useStore((s) => s.selection)
  const sheet = useStore((s) => (at ? activeSheet(s) : null))
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const open = (e: Event) => setAt((e as CustomEvent<ContextRequest>).detail)
    window.addEventListener('pid:contextmenu', open)
    return () => window.removeEventListener('pid:contextmenu', open)
  }, [])

  // Measured, then flipped: a menu opened near the right or bottom edge of the
  // window has to come back inside it, and how far depends on how tall the
  // menu turned out — which depends on what is selected.
  // Opened from the keyboard, the menu itself has to take focus, or Shift+F10
  // would put a menu on screen that only the mouse can reach.
  //
  // Waits for `pos`, not just for `at`: the menu renders hidden until it has
  // been measured and flipped inside the window, and a `visibility: hidden`
  // element cannot take focus — the call succeeds and nothing moves.
  useEffect(() => {
    if (!at || !pos) return
    const first = ref.current?.querySelector<HTMLElement>('button:not(:disabled)')
    first?.focus()
  }, [at, pos])

  useLayoutEffect(() => {
    if (!at) { setPos(null); return }
    const el = ref.current
    const w = el?.offsetWidth ?? 200
    const h = el?.offsetHeight ?? 240
    setPos({
      left: Math.max(6, Math.min(at.x, window.innerWidth - w - 6)),
      top: Math.max(6, Math.min(at.y, window.innerHeight - h - 6)),
    })
  }, [at, selection])

  useEffect(() => {
    if (!at) return
    const close = () => setAt(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    // pointerdown anywhere outside closes; the canvas fires its own
    // contextmenu again for a second right-click, which re-opens it
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      close()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [at])

  if (!at || !sheet) return null

  // Closing returns the keyboard to the drawing rather than dropping it on the
  // document body — which is where a keyboard user who opened this with
  // Shift+F10 would otherwise land, with no way back except Tab from the top.
  const close = () => {
    setAt(null)
    focusCanvas()
  }
  const go = (fn: () => void) => () => { close(); fn() }
  const s = useStore.getState()

  const nodeIds = selection.filter((id) => sheet.nodes.some((n) => n.id === id))
  const edge = selection.length === 1 ? sheet.edges.find((e) => e.id === selection[0]) : undefined
  const many = selection.length > 1

  const showProps = () => window.dispatchEvent(new Event('pid:show-props'))

  let rows: Row[]
  if (edge) {
    rows = [
      {
        label: edge.arrow === 'flow' ? 'Remove the flow arrow' : 'Add a flow arrow',
        run: () => toggleFlowArrow(edge.id),
      },
      { label: 'Reverse the direction', run: () => reverseEdge(edge.id) },
      SEP,
      { label: 'Line properties', run: showProps },
      { label: 'Delete line', shortcut: display('edit.delete'), danger: true, run: () => s.deleteIds([edge.id]) },
    ]
  } else if (many) {
    rows = [
      ...(nodeIds.length > 1 ? [ALIGN] : []),
      { label: 'Duplicate', shortcut: display('edit.duplicate'), run: duplicateSelection },
      { label: 'Copy', shortcut: display('edit.copy'), run: copySelection },
      SEP,
      { label: 'Rotate 90°', shortcut: display('draw.rotate'), run: rotateSelection, disabled: !nodeIds.length },
      SEP,
      { label: 'Delete', shortcut: display('edit.delete'), danger: true, run: () => s.deleteSelected() },
    ]
  } else if (nodeIds.length === 1) {
    rows = [
      { label: 'Rotate 90°', shortcut: display('draw.rotate'), run: rotateSelection },
      { label: 'Duplicate', shortcut: display('edit.duplicate'), run: duplicateSelection },
      { label: 'Copy', shortcut: display('edit.copy'), run: copySelection },
      SEP,
      { label: 'Add a connection pin', run: () => { s.setArmPin(nodeIds[0]!); showProps() } },
      { label: 'Properties', run: showProps },
      SEP,
      // Delete lives here for ONE symbol as well as for many. The inspector
      // offered it only for a multi-selection, so the same object could be
      // deleted or not depending on how many friends it had.
      { label: 'Delete', shortcut: display('edit.delete'), danger: true, run: () => s.deleteSelected() },
    ]
  } else {
    rows = [
      { label: 'Add a symbol…', run: () => window.dispatchEvent(new Event('pid:focus-symbols')) },
      { label: 'Paste', shortcut: display('edit.paste'), run: pasteClipboard, disabled: !hasClipboard() },
      SEP,
      { label: 'Select all', shortcut: display('select.all'), run: selectAll, disabled: !sheet.nodes.length },
      {
        label: 'Fit the sheet in the window',
        shortcut: display('view.fit'),
        run: () => {
          const { paper, graph } = canvasRef
          if (paper && graph) fitView(paper, graph, sheet.sheetSize)
        },
      },
    ]
  }

  return createPortal(
    <div
      ref={ref}
      className="ctx"
      role="menu"
      data-testid="canvas-context-menu"
      style={{
        position: 'fixed',
        left: pos?.left ?? at.x,
        top: pos?.top ?? at.y,
        // measured before it is placed; showing it mid-measure would flash it
        // in the wrong corner on every open
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // A role="menu" is expected to move on arrows, not Tab.
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
        e.preventDefault()
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const to = e.key === 'Home' ? 0
          : e.key === 'End' ? items.length - 1
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[Math.max(0, to)]!.focus()
      }}
    >
      {rows.map((row, i) =>
        row === SEP ? (
          <div key={`s${i}`} className="ctx-sep" role="separator" />
        ) : row === ALIGN ? (
          <div key="align" className="ctx-align">
            {ALIGNMENTS.map(([mode, glyph, title]) => (
              <button
                key={mode}
                type="button"
                role="menuitem"
                title={title}
                aria-label={title}
                onClick={go(() => applyAlignment(mode))}
              >
                {glyph}
              </button>
            ))}
          </div>
        ) : (
          <button
            key={row.label}
            type="button"
            role="menuitem"
            className={`ctx-item${row.danger ? ' ctx-danger' : ''}`}
            disabled={row.disabled}
            onClick={go(row.run)}
          >
            <span>{row.label}</span>
            {row.shortcut && <kbd className="ctx-key">{row.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
