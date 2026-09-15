// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { WidgetView } from './shared'
import { fmt, fmtQ, measureOf } from './shared'
import { hasNumber } from '../sim/quality'

/** Two-row layout: tag (and SP) on the top line, value+unit on the bottom —
 *  rows never collide however long the number gets. An optional sparkline
 *  (ISA-101's "which way is it heading") sits bottom-left. */
export default function Display({ widget, theme, sim, alarm, hist, eng, quality }: WidgetView) {
  /** The sparkline's window: the last minute, at one point per pixel of the
   *  strip it is drawn in. History decides which samples answer. */
  const SPARK_SPAN_S = 60
  const { w, h } = widget
  const { unit, min: lo, max: hi } = measureOf(widget, eng)
  const border = alarm === 'unacked' ? theme.alarm : alarm === 'acked' ? theme.alarmAck : theme.equipStroke
  const showSp = widget.props?.controller === true && sim.SP !== undefined
  const spark = (() => {
    if (widget.props?.spark !== true || !hasNumber(quality) || !hist) return null
    const x0 = 8, x1 = Math.max(x0 + 24, w * 0.45), yTop = h - 17, yBot = h - 6
    const end = hist.latestT
    const win = hist.getSeries(widget.tag ? `${widget.tag}.PV` : 'PV', end - SPARK_SPAN_S, end, Math.round(x1 - x0))
    if (win.v.length < 2) return null
    const t0 = win.t[0]!
    const tSpan = win.t[win.t.length - 1]! - t0 || 1
    return win.v.map((v, i) => {
      const x = x0 + ((win.t[i]! - t0) / tSpan) * (x1 - x0)
      const y = yBot - Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))) * (yBot - yTop)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  })()
  return (
    <g>
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={4} fill={theme.panel} stroke={border} strokeWidth={alarm && alarm !== 'none' ? 3 : 1.5} />
      <text x={8} y={14} fill={theme.textDim} fontSize={10}>{widget.tag ?? ''}</text>
      {showSp && (
        <text x={w - 8} y={14} textAnchor="end" fill={theme.sp} fontSize={9}>SP {fmt(sim.SP, 0)}</text>
      )}
      {spark && <polyline points={spark} fill="none" stroke={theme.textDim} strokeWidth={1.2} data-spark />}
      <text x={w - 8} y={h - 8} textAnchor="end" fill={theme.text} fontSize={15} fontWeight={700}>
        {fmtQ(sim.PV, quality)}{unit ? ` ${unit}` : ''}
      </text>
    </g>
  )
}
