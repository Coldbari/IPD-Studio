// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Draw what is on screen.
 *
 * Every symbol on the sheet is a group of a hit rect, the symbol geometry, two
 * tag texts, a label and two circles per connection point; every line is three
 * paths. A thousand-object sheet is therefore something like fifteen thousand
 * SVG nodes, and the browser pays for all of them on every style
 * recalculation, hit test and paint — whether or not they are anywhere near
 * the window. Profiling a drag on such a sheet put 1,240 ms of a 1,600 ms
 * window in `(program)`: not our code, and not JointJS's either, but the
 * renderer working through the document.
 *
 * So above a threshold the paper only mounts the cells whose geometry comes
 * near the visible area, and mounts the rest as they are panned into view.
 * Below it nothing changes at all — a normal sheet renders exactly as before,
 * which keeps the common case off this code path entirely.
 *
 * Two things must never see a partial drawing, and both are handled:
 *   - export and print, which clone the live SVG (see `withEveryCellRendered`)
 *   - `fitView`, which measures the GRAPH, not the DOM
 */

import type { dia } from '@joint/core'

/**
 * Cells on the sheet before virtualization starts. A drawing this size renders
 * whole in well under a frame, so the machinery would only add risk.
 */
const VIRTUALIZE_FROM = 400

/**
 * Margin around the visible area kept rendered, so a pan reveals finished
 * drawing rather than blank paper while the next check runs.
 *
 * Proportional to the window, not a fixed distance on the sheet: a fixed
 * 600 sheet px is a sensible half-screen at 1:1 and an absurd twenty-five
 * screens at 400%, which is how a zoomed-in sheet ended up mounting almost
 * everything it had just culled.
 */
const PAD_FRACTION = 0.5
const PAD_MIN = 120
const PAD_MAX = 600

/** Room for what a symbol draws OUTSIDE its box: the tag pair sits about 17px
 *  above it, the label about 12px below, and rotation swaps the axes. */
const CELL_BLEED = 64

interface Area { x: number; y: number; w: number; h: number }

/** Cell count without copying the collection. `graph.getCells()` returns a
 *  fresh array every call — asking it for a LENGTH once per cell per pass
 *  copied two thousand references two thousand times, which profiled as
 *  150 ms of `copyArray` on a 1,000-object drag. */
function cellCount(graph: dia.Graph): number {
  return (graph.get('cells') as { length?: number } | undefined)?.length ?? 0
}

interface State {
  area: Area | null
  /** Recomputed lazily; the paper transform only moves on these events. */
  dirty: boolean
  frame: number
}

const STATES = new WeakMap<dia.Paper, State>()

function stateFor(paper: dia.Paper): State {
  let st = STATES.get(paper)
  if (!st) {
    st = { area: null, dirty: true, frame: 0 }
    STATES.set(paper, st)
  }
  return st
}

function areaOf(paper: dia.Paper, st: State): Area {
  if (!st.dirty && st.area) return st.area
  const a = paper.getArea()
  const pad = Math.max(PAD_MIN, Math.min(PAD_MAX, PAD_FRACTION * Math.min(a.width, a.height)))
  st.area = { x: a.x - pad, y: a.y - pad, w: a.width + 2 * pad, h: a.height + 2 * pad }
  st.dirty = false
  return st.area
}

/**
 * Conservative sheet-space bounds for a cell, read straight off the model.
 *
 * Deliberately not `getBBox()`: this runs for every mounted view on every
 * visibility pass, and getBBox allocates rectangles, resolves link ends
 * through the graph and unions them. Position and size are already on the
 * cell; a quarter-turned symbol is covered by squaring its box rather than
 * by doing the rotation properly, because being generous here costs one
 * extra symbol at the edge of the window and being wrong costs a blank one.
 */
function elementBounds(cell: dia.Element): Area | null {
  const p = cell.get('position') as { x: number; y: number } | undefined
  const s = cell.get('size') as { width: number; height: number } | undefined
  if (!p || !s) return null
  const angle = (cell.get('angle') as number | undefined) ?? 0
  if (angle % 180 === 0) return { x: p.x, y: p.y, w: s.width, h: s.height }
  const m = Math.max(s.width, s.height)
  return { x: p.x + s.width / 2 - m / 2, y: p.y + s.height / 2 - m / 2, w: m, h: m }
}

function boundsOf(cell: dia.Cell, graph: dia.Graph): Area | null {
  if (cell.isElement()) {
    const b = elementBounds(cell as dia.Element)
    return b && { x: b.x - CELL_BLEED, y: b.y - CELL_BLEED, w: b.w + 2 * CELL_BLEED, h: b.h + 2 * CELL_BLEED }
  }
  const link = cell as dia.Link
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const grow = (x: number, y: number, w = 0, h = 0) => {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x + w > x1) x1 = x + w
    if (y + h > y1) y1 = y + h
  }
  for (const end of [link.get('source'), link.get('target')] as ({ id?: string; x?: number; y?: number } | undefined)[]) {
    if (!end) continue
    if (end.id !== undefined) {
      const node = graph.getCell(end.id)
      const b = node?.isElement() ? elementBounds(node as dia.Element) : null
      if (b) grow(b.x, b.y, b.w, b.h)
    } else if (typeof end.x === 'number' && typeof end.y === 'number') {
      grow(end.x, end.y)
    }
  }
  const verts = link.get('vertices') as { x: number; y: number }[] | undefined
  if (verts) for (const v of verts) grow(v.x, v.y)
  if (!Number.isFinite(x0)) return null
  // A manhattan route leaves its endpoints' box; the padding covers the detour.
  return { x: x0 - CELL_BLEED, y: y0 - CELL_BLEED, w: x1 - x0 + 2 * CELL_BLEED, h: y1 - y0 + 2 * CELL_BLEED }
}

/**
 * The paper's `viewport` callback: is this cell worth having in the DOM?
 *
 * Answering "yes" for everything is exactly the old behaviour, which is what
 * small drawings get.
 */
export function cellInViewport(view: { model?: dia.Cell }, _isMounted: boolean, paper: dia.Paper): boolean {
  const cell = view?.model
  if (!cell) return true
  const graph = paper.model
  if (cellCount(graph) < VIRTUALIZE_FROM) return true
  const b = boundsOf(cell, graph)
  if (!b) return true
  // `areaOf` already carries the padding.
  const a = areaOf(paper, stateFor(paper))
  return b.x <= a.x + a.w && b.x + b.w >= a.x && b.y <= a.y + a.h && b.y + b.h >= a.y
}

/**
 * Keep the mounted set honest while the user pans and zooms — once per frame,
 * not once per wheel notch or pointermove.
 */
export function watchViewport(paper: dia.Paper): () => void {
  const st = stateFor(paper)
  const recheck = () => {
    st.dirty = true
    if (st.frame) return
    st.frame = requestAnimationFrame(() => {
      st.frame = 0
      if (cellCount(paper.model) < VIRTUALIZE_FROM) return
      paper.checkViewport()
    })
  }
  paper.on('translate', recheck)
  paper.on('scale', recheck)
  paper.on('resize', recheck)
  return () => {
    if (st.frame) cancelAnimationFrame(st.frame)
    st.frame = 0
    paper.off('translate', recheck)
    paper.off('scale', recheck)
    paper.off('resize', recheck)
  }
}

/**
 * Run `fn` with EVERY cell mounted and rendered.
 *
 * Export and print clone the live SVG, so they must never see a virtualized
 * paper: whatever is off screen would be missing from the file. The mounted
 * set is restored afterwards.
 */
export function withEveryCellRendered<T>(paper: dia.Paper, fn: () => T): T {
  const st = stateFor(paper)
  paper.dumpViews()
  paper.updateViews()
  try {
    return fn()
  } finally {
    st.dirty = true
    paper.checkViewport()
    paper.updateViews()
  }
}
