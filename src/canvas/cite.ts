// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { dia, highlighters } from '@joint/core'
import { useHighlight } from '../store/highlight'

const CITE = 'pid-cite'

/**
 * Draw the assistant's citations on the canvas.
 *
 * Deliberately a second channel next to `pid-selection` rather than a reuse of
 * it. Hovering a chip in an answer must show you the object without taking the
 * selection away from you — the selection is what the answer was about, and
 * stealing it mid-sentence is how the panel would lose its own context.
 *
 * Dashed amber, wider padding than the selection stroke so the two read
 * clearly when they land on the same cell. No link tools: this is a pointer,
 * not an edit affordance.
 */
export function attachCiteHighlight(paper: dia.Paper, graph: dia.Graph): () => void {
  const sync = () => {
    const { ids, tone } = useHighlight.getState()
    const lit = new Set(ids)
    for (const cell of graph.getCells()) {
      const view = cell.findView(paper)
      if (!view) continue
      const has = highlighters.stroke.get(view, CITE)
      if (lit.has(String(cell.id)) && !has) {
        highlighters.stroke.add(view, cell.isLink() ? { selector: 'line' } : { selector: 'root' }, CITE, {
          padding: 7,
          attrs: {
            stroke: tone === 'warn' ? '#b7791f' : '#dd6b20',
            'stroke-width': 2,
            'stroke-dasharray': '4,3',
            'stroke-opacity': 0.95,
          },
        })
      } else if (!lit.has(String(cell.id)) && has) {
        highlighters.stroke.remove(view, CITE)
      }
    }
  }
  sync()
  return useHighlight.subscribe(sync)
}
