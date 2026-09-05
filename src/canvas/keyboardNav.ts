// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { dia } from '@joint/core'
import type { PlantEdge, PlantNode, Sheet } from '../model/types'
import { isPortEnd } from '../model/types'
import { getSymbol } from '../symbols/registry'
import { connectionRef } from '../symbols/portLabels'
import { LINE_CLASS_LABELS } from './lineStyle'
import { portWorld } from './alignment'
import { matches } from '../shortcuts/registry'
import { activeSheet, useStore } from '../store/store'
import { canvasRef } from './paperSetup'

/**
 * Working a drawing without a pointer.
 *
 * The canvas was outside the keyboard model entirely: `.canvas-host` was a
 * plain `<div>` with `tabIndex -1`, no role and no name, and the tab order ran
 * rail → toolbar → palette and stopped. Every shortcut the app has — delete,
 * nudge, rotate, duplicate — needed a selection, and a selection needed a
 * mouse. The shortcuts were reachable; the objects they act on were not.
 *
 * What this is NOT: a thousand tab stops. A symbol renders 69 DOM nodes, so a
 * 1,000-object drawing is ~69,000 already and the paper virtualizes for
 * exactly that reason. Putting every cell in the tab order would be worse than
 * no keyboard support — it would be a keyboard trap with a progress bar.
 *
 * So the canvas is ONE stop that owns a small key model while it has focus:
 *
 *   Tab / Shift+Tab   move the selection to the next / previous object
 *   Escape            clear the selection; Tab then leaves normally
 *   Enter             open the selected object's properties
 *   Shift+F10 / ≣     the same context menu the right mouse button opens
 *   arrows            nudge, exactly as before
 *
 * Tab is captured only while stepping through objects, and Escape always
 * releases — so this is a documented exit, not a trap (WCAG 2.1.2).
 */

/**
 * Every selectable object on the sheet, in the order a person reads a drawing:
 * top to bottom, then left to right. Rebuilt per keystroke, not per frame —
 * a Tab press is not a hot path, and a cached order would go stale on every
 * edit.
 *
 * Banded rather than sorted purely by y: symbols that sit on the same run of
 * pipe are rarely on exactly the same pixel, and a strict y-sort would walk
 * them in an order that looks arbitrary on screen. One grid square of
 * tolerance makes a row of instruments read left-to-right the way it looks.
 */
const BAND = 24

export function navOrder(sheet: Sheet): string[] {
  // Positions resolved ONCE, then sorted. Looking each one up inside the
  // comparator would be a linear scan per comparison — O(n² log n), which at
  // a thousand objects is millions of array walks for a single Tab press.
  const byId = new Map<string, PlantNode>()
  for (const n of sheet.nodes) byId.set(n.id, n)

  const rows: { id: string; x: number; y: number }[] = []
  for (const n of sheet.nodes) rows.push({ id: n.id, x: n.x, y: n.y })
  for (const e of sheet.edges) {
    const at = edgeAnchor(e, byId)
    rows.push({ id: e.id, x: at?.x ?? 0, y: at?.y ?? 0 })
  }

  rows.sort((a, b) => {
    const band = Math.floor(a.y / BAND) - Math.floor(b.y / BAND)
    if (band !== 0) return band
    if (a.x !== b.x) return a.x - b.x
    return a.id < b.id ? -1 : 1 // stable for two objects at the same point
  })
  return rows.map((r) => r.id)
}

/** Cached order, keyed on the arrays it was built from. The store is
 *  immutable, so identity is a complete change signal — the same trick the
 *  drag loop's dock and snap indexes use. */
let cached: { nodes: PlantNode[]; edges: PlantEdge[]; order: string[] } | null = null

function orderFor(sheet: Sheet): string[] {
  if (!cached || cached.nodes !== sheet.nodes || cached.edges !== sheet.edges) {
    cached = { nodes: sheet.nodes, edges: sheet.edges, order: navOrder(sheet) }
  }
  return cached.order
}

/** Where a line "is", for ordering: its source end. */
function edgeAnchor(edge: PlantEdge, byId: Map<string, PlantNode>): { x: number; y: number } | null {
  const end = edge.source
  if (!isPortEnd(end)) return { x: end.x, y: end.y }
  const node = byId.get(end.nodeId)
  return node ? portWorld(node, end.portId) : null
}

/**
 * What to say about the selected object.
 *
 * Written for someone who cannot see it, so it leads with the engineering
 * identity — the tag is what an engineer calls the thing — and falls back to
 * the symbol's catalogue name when there is no tag yet.
 */
export function describeCell(sheet: Sheet, id: string): string {
  const node = sheet.nodes.find((n) => n.id === id)
  if (node) {
    let name: string
    try {
      name = getSymbol(node.symbolId).name
    } catch {
      name = 'Symbol'
    }
    const tag = node.tag ? `${node.tag.letters}-${node.tag.loop}${node.tag.suffix ?? ''}` : ''
    const label = node.label?.trim()
    const parts = [tag || label || '', name].filter(Boolean)
    const where = node.rotation ? `, rotated ${node.rotation} degrees` : ''
    return `${parts.join(', ')}${where}`
  }
  const edge = sheet.edges.find((e) => e.id === id)
  if (edge) {
    const cls = LINE_CLASS_LABELS[edge.lineClass] ?? 'Line'
    const ln = edge.lineNumber
    const number = ln && (ln.size || ln.service || ln.seq)
      ? `, ${[ln.size, ln.spec, ln.service, ln.seq].filter(Boolean).join('-')}`
      : ''
    return `${cls} line${number}${runs(sheet, edge)}`
  }
  return 'Object'
}

/**
 * Where a line goes, for someone who cannot see it.
 *
 * This is the ONE place a port belongs in an announcement: a line IS its two
 * ends, and "process line" alone leaves a listener no way to tell one from
 * the eleven others on the sheet. A symbol's own ports are deliberately not
 * announced when it is selected — a vessel has eleven, the listener asked for
 * the vessel, and reading out its nozzles would bury the answer.
 */
function runs(sheet: Sheet, edge: PlantEdge): string {
  const both = [edge.source, edge.target].map((end) => {
    if (!isPortEnd(end)) return 'an open end'
    const node = sheet.nodes.find((n) => n.id === end.nodeId)
    return node ? connectionRef(node, end.portId) : null
  })
  // Nothing at all rather than half a sentence: a line whose ends the app
  // cannot name is described by its class and number, as it always was.
  if (both.some((w) => !w)) return ''
  if (both[0] === 'an open end' && both[1] === 'an open end') return ''
  return `, from ${both[0]} to ${both[1]}`
}

/** The announcement for a selection, including where it sits in the walk. */
export function describeSelection(sheet: Sheet, selection: readonly string[]): string {
  if (selection.length === 0) return 'Nothing selected'
  if (selection.length > 1) return `${selection.length} objects selected`
  const id = selection[0]!
  const order = orderFor(sheet)
  const at = order.indexOf(id)
  const position = at >= 0 ? `, ${at + 1} of ${order.length}` : ''
  return `${describeCell(sheet, id)}${position}`
}

/** Step the selection through the reading order. Wraps; Escape is the exit. */
export function stepSelection(dir: 1 | -1): void {
  const s = useStore.getState()
  const sheet = activeSheet(s)
  const order = orderFor(sheet)
  if (order.length === 0) return
  // From no selection — or a selection made by a marquee, which has no single
  // "current" — Tab enters at the start of the drawing and Shift+Tab at the end.
  const current = s.selection.length === 1 ? order.indexOf(s.selection[0]!) : -1
  const next = current < 0
    ? (dir === 1 ? 0 : order.length - 1)
    : (current + dir + order.length) % order.length
  s.setSelection([order[next]!])
  scrollIntoView(order[next]!)
}

/**
 * Bring the selected object into view if it is off screen.
 *
 * Only when it is actually outside — panning the sheet under someone who can
 * see it perfectly well is disorienting, and on a virtualized drawing it would
 * also churn the mounted set on every Tab.
 */
export function scrollIntoView(id: string): void {
  const { paper, graph } = canvasRef
  if (!paper || !graph) return
  const cell = graph.getCell(id)
  if (!cell) return
  let box: { x: number; y: number; width: number; height: number }
  try {
    box = cell.getBBox()
  } catch {
    return
  }
  const area = paper.getArea()
  const margin = 48
  const inside =
    box.x >= area.x + margin && box.x + box.width <= area.x + area.width - margin &&
    box.y >= area.y + margin && box.y + box.height <= area.y + area.height - margin
  if (inside) return
  const size = paper.getComputedSize()
  const scale = paper.scale().sx
  paper.translate(
    size.width / 2 - (box.x + box.width / 2) * scale,
    size.height / 2 - (box.y + box.height / 2) * scale,
  )
}

/** Put the keyboard on the drawing. Used after placing a symbol, and by the
 *  inspector and palette when they hand focus back. */
export function focusCanvas(): void {
  const host = document.querySelector<HTMLElement>('.canvas-host')
  host?.focus()
}

/** Screen position of the selection, for opening the context menu on it. */
function selectionScreenPoint(): { x: number; y: number } | null {
  const { paper, graph } = canvasRef
  const s = useStore.getState()
  const id = s.selection[0]
  if (!paper || !graph || !id) return null
  const cell = graph.getCell(id)
  if (!cell) return null
  try {
    const b = cell.getBBox()
    const p = paper.localToClientPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
    return { x: p.x, y: p.y }
  } catch {
    return null
  }
}

/**
 * Keys that only apply while the drawing itself has focus.
 *
 * Kept apart from the global handler in interactions.ts on purpose: those are
 * application shortcuts that work wherever you are, and these are the ones
 * that would steal Tab and Enter from every other control on the page if they
 * were not scoped to this element.
 */
export function attachKeyboardNav(host: HTMLElement, _paper: dia.Paper): () => void {
  /**
   * Has the user asked to be let go of?
   *
   * Without this, the exit is a loop rather than an exit: Escape clears the
   * selection, Tab selects the first object again, Escape clears… A surface
   * that captures Tab has to have a way past it (WCAG 2.1.2), and "press
   * Escape, then Tab" is that way — but only if Escape is remembered until
   * the next time the drawing is entered.
   */
  let released = false
  const onFocus = () => { released = false }
  host.addEventListener('focus', onFocus)

  const onKeyDown = (e: KeyboardEvent) => {
    // Only when the drawing itself has focus, never when a panel does.
    if (document.activeElement !== host) return
    const s = useStore.getState()

    if (matches(e, 'select.next') || matches(e, 'select.prev')) {
      // Escape has been pressed and nothing is selected: this Tab is the
      // user leaving, so let the browser have it.
      if (released && s.selection.length === 0) return
      e.preventDefault()
      stepSelection(matches(e, 'select.next') ? 1 : -1)
      return
    }
    // Escape clears the selection (interactions.ts does that) and, here,
    // arms the exit.
    if (e.key === 'Escape') {
      released = true
      return
    }
    if (matches(e, 'select.properties') && s.selection.length) {
      e.preventDefault()
      window.dispatchEvent(new Event('pid:show-props'))
      window.dispatchEvent(new Event('pid:focus-props'))
      return
    }
    if (matches(e, 'select.menu') && s.selection.length) {
      const at = selectionScreenPoint()
      if (!at) return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('pid:contextmenu', { detail: at }))
      return
    }
    // Arrows with nothing selected are the gentle way in: there is nothing to
    // nudge, so they mean "give me something to work with" instead.
    if (!s.selection.length && matches(e, 'draw.nudge')) {
      e.preventDefault()
      stepSelection(1)
    }
  }

  host.addEventListener('keydown', onKeyDown)
  return () => {
    host.removeEventListener('keydown', onKeyDown)
    host.removeEventListener('focus', onFocus)
  }
}
