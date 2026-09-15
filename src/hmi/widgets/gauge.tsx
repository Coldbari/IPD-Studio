// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { WidgetView } from './shared'
import { fmt, fmtQ, measureOf } from './shared'
import { hasNumber } from '../sim/quality'

/** Radial gauge: needle sweeps -120°..+120° over props.min..props.max, with
 *  warn/alarm zone arcs when H/HH (or L/LL) limits are set. */
export default function Gauge({ widget, theme, sim, eng, quality }: WidgetView) {
  const { w, h } = widget
  const { min, max, unit, limits } = measureOf(widget, eng)
  const pv = sim.PV ?? min
  const span = max - min || 1
  const angOf = (v: number) => -120 + 240 * Math.max(0, Math.min(1, (v - min) / span))
  const cx = w / 2, cy = h * 0.58, r = Math.min(w, h) * 0.42
  const at = (a: number, rr = r) => {
    const rad = ((a - 90) * Math.PI) / 180
    return { x: cx + rr * Math.cos(rad), y: cy + rr * Math.sin(rad) }
  }
  const arcPath = (a0: number, a1: number, rr = r) => {
    const s = at(a0, rr), e = at(a1, rr)
    return `M ${s.x} ${s.y} A ${rr} ${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${e.x} ${e.y}`
  }
  const zones: { from: number | undefined; to: number | undefined; color: string }[] = [
    { from: limits.H, to: limits.HH ?? max, color: theme.warn },
    { from: limits.HH, to: max, color: theme.alarm },
    { from: min, to: limits.L, color: theme.warn },
    { from: min, to: limits.LL, color: theme.alarm },
  ]
  return (
    <g>
      <path d={arcPath(-120, 120)} fill="none" stroke={theme.equipStroke} strokeWidth={4} strokeLinecap="round" />
      {zones.map(({ from, to, color }, i) => {
        if (from === undefined || to === undefined || to <= from) return null
        return <path key={i} d={arcPath(angOf(from), angOf(to))} fill="none" stroke={color} strokeWidth={4} />
      })}
      {/* no needle for a bad reading: a parked pointer still reads as a value */}
      {hasNumber(quality) && (
        <g transform={`rotate(${angOf(pv)} ${cx} ${cy})`}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 6} stroke={theme.text} strokeWidth={2.5} />
        </g>
      )}
      <circle cx={cx} cy={cy} r={3.5} fill={theme.text} />
      <text x={at(-120).x} y={at(-120).y + 12} textAnchor="middle" fill={theme.textDim} fontSize={8}>{fmt(min, 0)}</text>
      <text x={at(120).x} y={at(120).y + 12} textAnchor="middle" fill={theme.textDim} fontSize={8}>{fmt(max, 0)}</text>
      <text x={cx} y={cy + r * 0.7} textAnchor="middle" fill={theme.text} fontSize={12} fontWeight={600}>{fmtQ(pv, quality, 0)}{unit ? ` ${unit}` : ''}</text>
      <text x={cx} y={h + 12} textAnchor="middle" fill={theme.textDim} fontSize={10}>{widget.tag ?? widget.label ?? ''}</text>
    </g>
  )
}
