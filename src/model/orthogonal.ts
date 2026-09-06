// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

export interface OrthogonalPoint {
  x: number
  y: number
}

/** Insert a right-angle corner for every diagonal leg in a stored route. */
export function orthogonalizeVertices(
  vertices: readonly OrthogonalPoint[] | undefined,
  source?: OrthogonalPoint | null,
  target?: OrthogonalPoint | null,
): OrthogonalPoint[] | undefined {
  // A missing vertex list means the link is a direct connection. Its endpoint
  // geometry is handled by the canvas router; do not materialize a new bend,
  // since that changes the line's editing/undo semantics.
  if (!vertices?.length) return undefined
  const points = [
    ...(source ? [{ x: source.x, y: source.y }] : []),
    ...(vertices ?? []).map((point) => ({ x: point.x, y: point.y })),
    ...(target ? [{ x: target.x, y: target.y }] : []),
  ]
  if (points.length < 2) return vertices?.map((point) => ({ ...point }))

  const route: OrthogonalPoint[] = [points[0]!]
  for (let index = 1; index < points.length; index++) {
    const previous = route.at(-1)!
    const next = points[index]!
    if (previous.x !== next.x && previous.y !== next.y) {
      // Continue the direction of the preceding leg when possible. This keeps
      // an existing horizontal/vertical run intact while adding a corner.
      const before = route.at(-2)
      const previousLegWasHorizontal = before && before.y === previous.y
      route.push(previousLegWasHorizontal
        ? { x: previous.x, y: next.y }
        : { x: next.x, y: previous.y })
    }
    route.push(next)
  }

  const first = source ? 1 : 0
  const last = route.length - (target ? 1 : 0)
  const result: OrthogonalPoint[] = []
  for (let index = first; index < last; index++) {
    const point = route[index]!
    const previous = route[index - 1]
    if (!previous || point.x !== previous.x || point.y !== previous.y) result.push({ ...point })
  }
  return result.length ? result : undefined
}
