// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { dia, g } from '@joint/core'
import type { LineClass } from '../model/types'
import { GLYPHS, glyphPointsForRoute } from './glyphs'

/**
 * Ride ISA glyphs (pneumatic slashes, data circles, ...) along every link's
 * resolved route, and pin the pending-device tag next to any free line end
 * that is waiting for a device not drawn yet. Idempotent: re-running with an
 * unchanged route is a no-op, and label writes are flagged so callers can
 * ignore the resulting events.
 */
export function decorateLinks(paper: dia.Paper): void {
  for (const link of paper.model.getLinks()) {
    decorateLink(paper, link)
  }
}

/** Small italic tag at a free line end that waits for a not-yet-drawn device.
 *  Distinct from symbol tags: teal + italic + a little off the end of the run. */
const PENDING_MARKUP = [{ tagName: 'text', selector: 'text' }]
const PENDING_ATTRS = {
  text: {
    fill: '#0e6e7a',
    fontFamily: 'sans-serif',
    fontSize: 10,
    fontStyle: 'italic',
    fontWeight: 600,
    textAnchor: 'start',
    stroke: '#fff',
    strokeWidth: 3,
    paintOrder: 'stroke',
    'pointer-events': 'none',
  },
}

function decorateLink(paper: dia.Paper, link: dia.Link): void {
  const data = link.get('data') as
    | { lineClass?: LineClass; pending?: { source?: string; target?: string } }
    | undefined
  const spec = data?.lineClass ? GLYPHS[data.lineClass] : null
  const view = link.findView(paper) as dia.LinkView | null
  if (!view) return
  const connection = view.getConnection()
  if (!connection) return
  const labels: dia.Link.Label[] = []
  if (spec) {
    const polylines = connection.toPolylines()
    if (polylines) {
      const route = polylines
        .flatMap((poly: g.Polyline) => poly.points)
        .map((p: g.Point) => ({ x: p.x, y: p.y }))
      labels.push(...glyphPointsForRoute(route, spec.spacing).map((s) => ({
        markup: spec.markup,
        position: { distance: s.distance, args: { keepGradient: true, absoluteDistance: true } },
      })))
    }
  }
  const pending = data?.pending
  if (pending?.source) {
    labels.push({
      markup: PENDING_MARKUP,
      attrs: { ...PENDING_ATTRS, text: { ...PENDING_ATTRS.text, text: pending.source } },
      // Place at the link end, but keep this annotation horizontal regardless
      // of the link tangent or endpoint direction.
      position: {
        distance: 0.02,
        offset: { x: 6, y: -14 },
        angle: 0,
        args: { keepGradient: false, ensureLegibility: false },
      },
    })
  }
  if (pending?.target) {
    labels.push({
      markup: PENDING_MARKUP,
      attrs: { ...PENDING_ATTRS, text: { ...PENDING_ATTRS.text, text: pending.target } },
      position: {
        distance: 0.98,
        offset: { x: 6, y: -14 },
        angle: 0,
        args: { keepGradient: false, ensureLegibility: false },
      },
    })
  }
  const current = link.labels()
  const key = (l: dia.Link.Label): string => JSON.stringify([l.markup, l.attrs, l.position])
  if (current.length === labels.length && current.every((l, i) => key(l) === key(labels[i]!))) return
  link.labels(labels, { decoration: true })
}
