// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { dia, g } from '@joint/core'
import type { LineClass } from '../model/types'
import { GLYPHS, glyphPointsForRoute } from './glyphs'

/**
 * Ride ISA glyphs (pneumatic slashes, data circles, ...) along every link's
 * resolved route. Idempotent: re-running with an unchanged route is a no-op,
 * and label writes are flagged so callers can ignore the resulting events.
 */
/**
 * The route a link's glyphs were last laid out against.
 *
 * `decorateLinks` runs on every `render:done`, which during a drag is once per
 * painted frame. Resolving each link's path and walking it costs real time, so
 * links whose view has not been updated since the last pass are skipped: a
 * LinkView builds a fresh route array and fresh end points whenever it
 * re-renders, which makes object identity an exact "did this line move?".
 */
const LAID_OUT = new WeakMap<dia.Link, { route: unknown; src: unknown; tgt: unknown }>()

export function decorateLinks(paper: dia.Paper): void {
  for (const link of paper.model.getLinks()) {
    decorateLink(paper, link)
  }
}

function decorateLink(paper: dia.Paper, link: dia.Link): void {
  const lineClass = (link.get('data') as { lineClass?: LineClass } | undefined)?.lineClass
  const spec = lineClass ? GLYPHS[lineClass] : null
  const current = link.labels()
  if (!spec) {
    if (current.length > 0) link.labels([], { decoration: true })
    return
  }
  const view = link.findView(paper) as dia.LinkView | null
  if (!view) return
  const laid = LAID_OUT.get(link)
  if (laid && laid.route === view.route && laid.src === view.sourcePoint && laid.tgt === view.targetPoint) return
  LAID_OUT.set(link, { route: view.route, src: view.sourcePoint, tgt: view.targetPoint })
  const connection = view.getConnection()
  if (!connection) return
  const polylines = connection.toPolylines()
  if (!polylines) return
  const route = polylines
    .flatMap((poly: g.Polyline) => poly.points)
    .map((p: g.Point) => ({ x: p.x, y: p.y }))
  const stations = glyphPointsForRoute(route, spec.spacing)
  if (
    current.length === stations.length &&
    current.every((l, i) => {
      const pos = l.position as { distance?: number } | undefined
      return typeof pos === 'object' && pos?.distance === stations[i]!.distance
    })
  ) {
    return
  }
  link.labels(
    stations.map((s) => ({
      markup: spec.markup,
      position: { distance: s.distance, args: { keepGradient: true, absoluteDistance: true } },
    })),
    { decoration: true },
  )
}
