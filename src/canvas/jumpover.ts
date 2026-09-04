// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Crossing hops that stay affordable on a real drawing.
 *
 * P&IDs draw a little arc where one line crosses another, and JointJS ships
 * exactly that as its `jumpover` connector. What it does not ship is a way to
 * make it scale: for every link it takes EVERY other link in the graph, builds
 * a `g.Line` per segment of each, and intersects them all against its own
 * segments. It then registers a `batch:stop` handler that re-runs that for
 * every jumpover link in the paper after any graph change. Moving one symbol
 * on a 1,000-line drawing therefore costs L x L segment intersections.
 *
 * Measured on this repo (Chromium, 1,000 nodes / 999 lines): letting go of a
 * dragged symbol produced a 1,014 ms main-thread task, of which ~590 ms was
 * inside the connector (intersectionWithLine 152 ms, sortPointsAscending
 * 122 ms, Point 78 ms, createLines 78 ms, overlapExists 40 ms...). Swapping
 * the connector out for 'normal' cut the post-drop freeze to 144 ms — so this
 * one connector WAS the lag.
 *
 * The hops themselves are correct and non-negotiable: a P&ID without them is
 * ambiguous about which lines connect. So the geometry is left to JointJS —
 * this module only answers "which links could possibly cross this one?" from a
 * uniform grid, and hands the connector that shortlist instead of the whole
 * graph. Output is byte-identical because it IS the same code; only the
 * candidate set shrinks, from L to the handful of lines actually nearby.
 */

import { connectors, dia } from '@joint/core'

/** Grid cell in sheet px. A P&ID line is mostly axis-aligned, so a segment's
 *  bounding box is the segment: cells stay tight and buckets stay small. */
const CELL = 128

/** Segments are indexed slightly fat, so a route that shifts a few px between
 *  the index being built and the connector asking still finds its crossings. */
const MARGIN = 16

/**
 * Below this many lines the whole-graph scan is already cheap, and skipping
 * the index keeps the common small drawing on JointJS's own code path.
 */
const INDEX_FROM = 24

interface JumpIndex {
  /** Grid cell key -> the links whose route passes through it. */
  grid: Map<number, Set<dia.Link>>
  /** Link -> the cells it occupies, sorted. Diffed between passes to find
   *  which lines actually moved, and therefore whose hops need redrawing. */
  cellsOf: Map<dia.Link, number[]>
  /** Link id -> its position in graph order, for restoring z-order in the
   *  shortlist (jumpover only hops over links drawn before it). */
  order: Map<string, number>
  fresh: boolean
  linkCount: number
  /** Consecutive re-jump passes without an intervening graph change; a
   *  backstop against a render loop if geometry ever fails to settle. */
  passes: number
}

const INDEXES = new WeakMap<dia.Paper, JumpIndex>()

/** Grid coordinates pack into one number so the buckets key on a primitive. */
const key = (cx: number, cy: number) => cx * 100_000 + cy

/** Everything that can move a route, and so invalidate the index. */
const INVALIDATING =
  'add remove reset change:source change:target change:vertices change:router ' +
  'change:connector change:position change:size change:angle'

function indexFor(paper: dia.Paper): JumpIndex {
  let ix = INDEXES.get(paper)
  if (!ix) {
    ix = { grid: new Map(), cellsOf: new Map(), order: new Map(), fresh: false, linkCount: 0, passes: 0 }
    INDEXES.set(paper, ix)
    paper.model.on(INVALIDATING, () => {
      ix!.fresh = false
      ix!.passes = 0
    })
    // Routes settle during a render pass, so the pass that follows must not
    // read the routes this one started from — and it is the only moment at
    // which "which lines actually moved" can be answered. See refreshJumps.
    paper.on('render:done', () => refreshJumps(paper))
  }
  if (!ix.fresh) build(paper, ix)
  return ix
}

/**
 * Redraw the hops on the lines a change could have affected — and only those.
 *
 * JointJS keeps every jumpover link in `paper._jumpOverUpdateList` and asks ALL
 * of them to re-run their connector after any graph batch. Measured on a
 * 1,000-line drawing, letting go of one symbol produced 999 connector runs and
 * 999 path rewrites in a single task. But a symbol moving changes the hops on
 * its own lines and on whatever those lines now cross or no longer cross — a
 * handful, not the drawing.
 *
 * Both index builds are compared cell by cell: a line whose occupied cells
 * changed has moved, and every line sharing one of those cells (before or
 * after) may have gained or lost a crossing. That set gets the update.
 *
 * It runs on `render:done` rather than `batch:stop` because at batch:stop the
 * link views have not re-routed yet — their geometry is still the previous
 * frame's, so nothing would look changed. After the render the routes are
 * settled, and the extra pass this schedules converges immediately: re-running
 * a connector rewrites a path, never a route.
 */
function refreshJumps(paper: dia.Paper): void {
  const ix = INDEXES.get(paper)
  if (!ix) return
  if (ix.passes > 3) return
  const prevGrid = ix.grid
  const prevCells = ix.cellsOf
  ix.passes++
  build(paper, ix)

  const changed = new Set<number>()
  for (const [link, before] of prevCells) {
    const after = ix.cellsOf.get(link)
    if (sameCells(before, after)) continue
    for (const c of before) changed.add(c)
    if (after) for (const c of after) changed.add(c)
  }
  for (const [link, after] of ix.cellsOf) {
    if (prevCells.has(link)) continue
    for (const c of after) changed.add(c)
  }
  if (!changed.size) return

  const affected = new Set<dia.Link>()
  for (const c of changed) {
    const a = prevGrid.get(c)
    if (a) for (const l of a) affected.add(l)
    const b = ix.grid.get(c)
    if (b) for (const l of b) affected.add(l)
  }
  for (const link of affected) {
    const view = paper.findViewByModel(link) as unknown as {
      getFlag(label: string): number
      requestUpdate(flag: number): void
      constructor: { Flags?: { CONNECTOR?: string } }
    } | null
    const label = view?.constructor?.Flags?.CONNECTOR
    if (!view || !label) continue
    view.requestUpdate(view.getFlag(label))
  }
}

function sameCells(a: number[], b: number[] | undefined): boolean {
  if (!b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Add `link` to every cell the segment a->b touches. */
function insert(grid: JumpIndex['grid'], cells: number[], link: dia.Link, a: Point, b: Point): void {
  const x0 = Math.floor((Math.min(a.x, b.x) - MARGIN) / CELL)
  const x1 = Math.floor((Math.max(a.x, b.x) + MARGIN) / CELL)
  const y0 = Math.floor((Math.min(a.y, b.y) - MARGIN) / CELL)
  const y1 = Math.floor((Math.max(a.y, b.y) + MARGIN) / CELL)
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const k = key(cx, cy)
      const bucket = grid.get(k)
      if (bucket) {
        if (!bucket.has(link)) { bucket.add(link); cells.push(k) }
      } else {
        grid.set(k, new Set([link]))
        cells.push(k)
      }
    }
  }
}

interface Point { x: number; y: number }

/** The points a link view's path actually runs through, or null if it has no
 *  rendered geometry yet (a link added this tick, or one outside the
 *  viewport). Such a link cannot be crossed on screen, so it is not indexed. */
function pointsOf(view: dia.LinkView | null): Point[] | null {
  if (!view) return null
  const src = view.sourcePoint
  const tgt = view.targetPoint
  if (!src || !tgt) return null
  return [src, ...(view.route ?? []), tgt]
}

function build(paper: dia.Paper, ix: JumpIndex): void {
  // New maps, not cleared ones: refreshJumps diffs this build against the
  // previous one and needs both to survive the call.
  const grid = new Map<number, Set<dia.Link>>()
  const cellsOf = new Map<dia.Link, number[]>()
  const order = new Map<string, number>()
  const links = paper.model.getLinks()
  for (let i = 0; i < links.length; i++) {
    const link = links[i]!
    order.set(String(link.id), i)
    const pts = pointsOf(paper.findViewByModel(link) as dia.LinkView | null)
    if (!pts) continue
    const cells: number[] = []
    for (let p = 0; p + 1 < pts.length; p++) insert(grid, cells, link, pts[p]!, pts[p + 1]!)
    cells.sort((a, b) => a - b)
    cellsOf.set(link, cells)
  }
  ix.grid = grid
  ix.cellsOf = cellsOf
  ix.order = order
  ix.linkCount = links.length
  ix.fresh = true
}

/** Links sharing a grid cell with any segment of `pts`, in graph order. */
function shortlist(ix: JumpIndex, pts: Point[], self: dia.Link): dia.Link[] {
  const found = new Set<dia.Link>([self])
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const x0 = Math.floor((Math.min(a.x, b.x) - MARGIN) / CELL)
    const x1 = Math.floor((Math.max(a.x, b.x) + MARGIN) / CELL)
    const y0 = Math.floor((Math.min(a.y, b.y) - MARGIN) / CELL)
    const y1 = Math.floor((Math.max(a.y, b.y) + MARGIN) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = ix.grid.get(key(cx, cy))
        if (bucket) for (const l of bucket) found.add(l)
      }
    }
  }
  // Graph order decides which of a crossing pair draws the hop, so the
  // shortlist has to keep it — otherwise a hop would move to the other line.
  return [...found].sort(
    (a, b) => (ix.order.get(String(a.id)) ?? 0) - (ix.order.get(String(b.id)) ?? 0),
  )
}

type ConnectorFn = (
  this: unknown,
  sourcePoint: Point,
  targetPoint: Point,
  route: Point[],
  opt: Record<string, unknown>,
  linkView: dia.LinkView,
) => string

/**
 * `jumpover`, restricted to the lines that could actually cross this one.
 *
 * The shortlist is handed over by swapping `graph.getLinks` for the duration
 * of the call — the one line of JointJS's connector that decides how much work
 * it does. It is restored in a `finally`, and the connector calls it exactly
 * once, synchronously, before doing anything else.
 */
export const jumpoverNear: ConnectorFn = function (sourcePoint, targetPoint, route, opt, linkView) {
  const base = connectors.jumpover as unknown as ConnectorFn
  const paper = linkView?.paper
  const graph = paper?.model
  if (!paper || !graph) return base.call(this, sourcePoint, targetPoint, route, opt, linkView)

  // graph.getLinks() filters and allocates over every cell, so it is asked
  // once per index build, not once per link per pass.
  const ix = indexFor(paper)
  if (ix.linkCount < INDEX_FROM) return base.call(this, sourcePoint, targetPoint, route, opt, linkView)

  const near = shortlist(ix, [sourcePoint, ...(route ?? []), targetPoint], linkView.model as dia.Link)
  const original = graph.getLinks
  ;(graph as unknown as { getLinks: () => dia.Link[] }).getLinks = () => near
  try {
    return base.call(this, sourcePoint, targetPoint, route, opt, linkView)
  } finally {
    ;(graph as unknown as { getLinks?: () => dia.Link[] }).getLinks = original
  }
}

/**
 * Take ownership of JointJS's jumpover bookkeeping before any link can.
 *
 * `setupUpdating` installs a `batch:stop` handler the first time the stock
 * connector runs, and that handler asks EVERY jumpover link in the paper to
 * re-run its connector after any graph change. Handing it a list up front
 * makes it skip that install; `refreshJumps` does the same job on render:done,
 * for the lines that actually moved. Call this immediately after creating a
 * paper.
 */
export function claimJumpoverUpdates(paper: dia.Paper): void {
  const p = paper as unknown as { _jumpOverUpdateList?: unknown[] }
  p._jumpOverUpdateList ??= []
  indexFor(paper)
}

/**
 * The connector table the paper resolves names against (`connectorNamespace`).
 *
 * `jumpover` is REPLACED rather than added under a new name on purpose: the
 * connector's own candidate filter reads `link.get('connector').name` and
 * keeps links drawn after this one only when they are NOT jumpover — the rule
 * that stops a crossing pair drawing two hops, one on each line. Registering
 * under a new name would make every link fail that test and double every hop.
 */
export const PID_CONNECTORS: Record<string, unknown> = {
  ...(connectors as unknown as Record<string, unknown>),
  jumpover: jumpoverNear,
}
