// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

export interface Pt { x: number; y: number }

export interface StraightenedRoute {
  source: Pt
  target: Pt
  vertices: Pt[]
}

const snap8 = (v: number) => Math.round(v / 8) * 8 || 0

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
}

/**
 * Tidy a link's dragged vertices at gesture end:
 *  - snap to the 8px grid,
 *  - then ADOPT a neighbor's axis when within tolerance — ports sit off-grid
 *    (a 40px bubble and 48px vessel can never share a grid center), so pure
 *    grid snapping would leave every run 1–4px kinked forever,
 *  - drop vertices that no longer bend the line (drag a bend back onto the
 *    axis and the line heals straight),
 *  - drop duplicates and vertices sitting on an anchor.
 * Neighbors are the link's end anchors and the adjacent vertices.
 */
export function cleanVertices(
  raw: Pt[],
  src: Pt | null,
  tgt: Pt | null,
  axisTol = 6,
  lineTol = 3,
): Pt[] {
  let pts = raw.map((p) => ({ x: snap8(p.x), y: snap8(p.y) }))

  // A very short first/last leg is usually an accidental axis mismatch from
  // dragging a segment near an off-grid port. Pull that vertex onto the
  // anchor's dominant axis so the route can collapse back to a straight run.
  if (src && pts[0]) {
    const first = pts[0]
    if (Math.abs(first.x - src.x) <= axisTol) first.x = src.x
    if (Math.abs(first.y - src.y) <= axisTol) first.y = src.y
  }
  if (tgt && pts.at(-1)) {
    const last = pts.at(-1)!
    if (Math.abs(last.x - tgt.x) <= axisTol) last.x = tgt.x
    if (Math.abs(last.y - tgt.y) <= axisTol) last.y = tgt.y
  }

  // two passes so adoption can chain along a run of vertices
  for (let pass = 0; pass < 2; pass++) {
    pts = pts.map((p, i) => {
      const refs = [i === 0 ? src : pts[i - 1]!, i === pts.length - 1 ? tgt : pts[i + 1]!]
      let { x, y } = p
      for (const r of refs) {
        if (!r) continue
        if (Math.abs(x - r.x) <= axisTol) x = r.x
        if (Math.abs(y - r.y) <= axisTol) y = r.y
      }
      return { x, y }
    })
  }

  // remove anything that stopped being a bend
  let removed = true
  while (removed) {
    removed = false
    for (let i = 0; i < pts.length; i++) {
      const prev = i === 0 ? src : pts[i - 1]!
      const next = i === pts.length - 1 ? tgt : pts[i + 1]!
      const v = pts[i]!
      const onAnchor =
        (prev && prev.x === v.x && prev.y === v.y) || (next && next.x === v.x && next.y === v.y)
      const collinear = prev && next && segDist(v, prev, next) <= lineTol
      if (onAnchor || collinear) {
        pts.splice(i, 1)
        removed = true
        break
      }
    }
  }
  return pts
}

/**
 * Let a dangling endpoint follow the route axis when it is only a short
 * cross-axis offset away. This collapses the small two-elbow hook that cannot
 * be healed by moving vertices alone because the free endpoint itself is the
 * remaining off-axis point.
 */
export function straightenDanglingRoute(
  raw: Pt[],
  source: Pt,
  target: Pt,
  free: 'source' | 'target',
  maxOffset = 32,
): StraightenedRoute {
  const nextSource = { ...source }
  const nextTarget = { ...target }
  const dx = target.x - source.x
  const dy = target.y - source.y
  const moving = free === 'source' ? nextSource : nextTarget
  const fixed = free === 'source' ? nextTarget : nextSource
  let projected = raw.map((point) => ({ ...point }))
  if (Math.abs(dx) <= maxOffset && Math.abs(dy) >= Math.max(48, Math.abs(dx) * 2)) {
    moving.x = fixed.x
    projected = projected.map((point) => Math.abs(point.x - fixed.x) <= maxOffset
      ? { ...point, x: fixed.x }
      : point)
  } else if (Math.abs(dy) <= maxOffset && Math.abs(dx) >= Math.max(48, Math.abs(dy) * 2)) {
    moving.y = fixed.y
    projected = projected.map((point) => Math.abs(point.y - fixed.y) <= maxOffset
      ? { ...point, y: fixed.y }
      : point)
  }
  return {
    source: nextSource,
    target: nextTarget,
    vertices: cleanVertices(projected, nextSource, nextTarget),
  }
}
