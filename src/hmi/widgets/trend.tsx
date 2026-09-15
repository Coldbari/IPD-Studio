// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import type { WidgetView } from './shared'
import { fmt, measureOf, num } from './shared'
import type { SeriesWindow } from '../sim/history'
import { EMPTY_WINDOW } from '../sim/history'
import { THEMES } from '../theme'

/** The pen palette now lives in the design system (`ThemeTokens.pens`) so both
 *  themes get curves that read against their own ground. Re-exported from the
 *  dark theme for callers that have no theme to hand. */
export const PEN_COLORS = THEMES.classic.pens

/** Default span when a screen predates the span property. */
export const DEFAULT_SPAN_S = 300

/** `'LIC-101.OP'` -> `['LIC-101', 'OP']`. */
export function splitRef(ref: string): { tag: string; signal: string } {
  const i = ref.lastIndexOf('.')
  return i <= 0 ? { tag: ref, signal: 'PV' } : { tag: ref.slice(0, i), signal: ref.slice(i + 1) }
}

/**
 * Axis label. A one-minute trend wants seconds; an hour-long one does not.
 * Both read as elapsed PROCESS time, which is what the samples are stamped in.
 */
export function axisLabel(t: number, spanS: number): string {
  const s = Math.max(0, Math.floor(t))
  const pad = (n: number) => String(n).padStart(2, '0')
  if (spanS > 900) return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}`
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

/**
 * Multi-pen trend: a real process-time axis, limit/SP lines, and a hover
 * cursor that freezes the window and reads out every pen at that instant.
 *
 * The widget owns the WINDOW it wants — its span, ending at the newest sample
 * — and history owns which stored samples answer that window and at what
 * resolution. There is no span-specific code here, and nothing in this file
 * knows a ring buffer exists.
 */
export default function Trend({ widget, theme, sim, hist, eng, defs }: WidgetView) {
  const [hover, setHover] = useState<{ fx: number; endT: number } | null>(null)
  const { w, h } = widget
  const { min, max, limits, unit } = measureOf(widget, eng)
  const span = max - min || 1
  const spanS = num(widget.props?.span) ?? DEFAULT_SPAN_S
  const px0 = 4, px1 = w - 30
  const py0 = 16, py1 = h - 14
  const yOf = (v: number) => py1 - (py1 - py0) * Math.max(0, Math.min(1, (v - min) / span))

  const primary = widget.tag ? `${widget.tag}.PV` : 'PV'
  const palette = theme.pens
  const pens = [
    { ref: primary, color: palette[0]! },
    ...(widget.pens ?? []).slice(0, 3).map((p, i) => ({ ref: p.ref, color: p.color ?? palette[i + 1]! })),
  ]

  // The right edge holds still while the cursor is down, so a readout does not
  // scroll out from under the operator reading it.
  const endT = hover?.endT ?? hist?.latestT ?? 0
  const t0 = endT - spanS
  const xOf = (t: number) => px0 + (px1 - px0) * Math.max(0, Math.min(1, (t - t0) / spanS))
  // one point per pixel of plot width is all a chart this size can show; asking
  // for more is what makes a 60-minute trend try to draw thousands of them
  const maxPoints = Math.max(2, Math.round(px1 - px0))

  const windows = new Map<string, SeriesWindow>()
  for (const p of pens) {
    windows.set(p.ref, hist ? hist.getSeries(p.ref, t0, endT, maxPoints) : EMPTY_WINDOW)
  }

  const penPath = (ref: string): string => {
    const win = windows.get(ref)!
    const pts: string[] = []
    for (let i = 0; i < win.v.length; i++) {
      pts.push(`${xOf(win.t[i]!).toFixed(1)},${yOf(win.v[i]!).toFixed(1)}`)
    }
    return pts.join(' ')
  }

  /** Pen value at the cursor (newest sample at or before it), else the live
   *  value for the widget's own tag and the newest sample for the others. */
  const readout = (ref: string): number | undefined => {
    const win = windows.get(ref)!
    if (hover && win.v.length > 0) {
      const tc = t0 + hover.fx * spanS
      let idx = -1
      for (let i = 0; i < win.t.length; i++) if (win.t[i]! <= tc) idx = i
      return idx >= 0 ? win.v[idx] : undefined
    }
    if (ref === primary) return sim.PV
    return win.v[win.v.length - 1]
  }

  /**
   * The unit for a pen, from the canonical engineering metadata and nowhere
   * else. A controller's OUTPUT is a valve position in per cent whatever its
   * PV measures — that is the model's definition of OP, not a guess made here.
   */
  const unitOf = (ref: string): string => {
    const { tag, signal } = splitRef(ref)
    if (signal === 'OP') return '%'
    if (ref === primary) return unit
    return defs?.[tag]?.unit ?? ''
  }

  const limitLines: { v: number | undefined; color: string }[] = [
    { v: limits.HH, color: theme.alarm }, { v: limits.H, color: theme.warn },
    { v: limits.L, color: theme.warn }, { v: limits.LL, color: theme.alarm },
  ]

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0) return
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    setHover((prev) => ({ fx, endT: prev?.endT ?? endT }))
  }

  return (
    <g data-span={spanS}>
      <rect x={1} y={1} width={w - 2} height={h - 2} fill={theme.panel} stroke={theme.equipStroke} strokeWidth={1.5} />
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={px0} x2={px1} y1={py0 + (py1 - py0) * f} y2={py0 + (py1 - py0) * f}
          stroke={theme.grid} strokeWidth={1} />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={px0 + (px1 - px0) * f} x2={px0 + (px1 - px0) * f} y1={py0} y2={py1}
          stroke={theme.grid} strokeWidth={1} />
      ))}
      {limitLines.map(({ v, color }, i) =>
        v === undefined ? null : (
          <line key={i} x1={px0} x2={px1} y1={yOf(v)} y2={yOf(v)} stroke={color} strokeWidth={1} strokeDasharray="4 4" opacity={0.8} />
        ),
      )}
      {sim.SP !== undefined && (
        <line x1={px0} x2={px1} y1={yOf(sim.SP)} y2={yOf(sim.SP)} stroke={theme.sp} strokeWidth={1} strokeDasharray="8 3" />
      )}
      {pens.map((p) => {
        const d = penPath(p.ref)
        if (!d) return null
        // a period that was forced, stale or bad is drawn dashed: it is history,
        // but it is not normal live data and must not read as though it were
        const degraded = !windows.get(p.ref)!.allGood
        return (
          <polyline key={p.ref} points={d} fill="none" stroke={p.color} strokeWidth={1.6}
            {...(degraded ? { strokeDasharray: '3 2', 'data-degraded': true } : {})} />
        )
      })}
      {/* legend: tag, value and its engineering unit (cursor value while hovering) */}
      {pens.map((p, i) => (
        <text key={p.ref} x={px0 + 2 + i * ((px1 - px0) / Math.max(2, pens.length))} y={11}
          fontSize={8} fill={p.color}>
          {p.ref.replace(/\.PV$/, '')} {fmt(readout(p.ref))}{unitOf(p.ref) ? ` ${unitOf(p.ref)}` : ''}
        </text>
      ))}
      {/* value scale (right gutter) + time axis */}
      <text x={w - 4} y={py0 + 6} textAnchor="end" fill={theme.textDim} fontSize={8}>{max}</text>
      <text x={w - 4} y={py1} textAnchor="end" fill={theme.textDim} fontSize={8}>{min}</text>
      {[0, 0.5, 1].map((f) => {
        const tt = t0 + f * spanS
        if (endT <= 0 || tt < 0) return null
        return (
          <text key={f} x={xOf(tt)} y={h - 4} fontSize={7} fill={theme.textDim}
            textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{axisLabel(tt, spanS)}</text>
        )
      })}
      {hover && (
        <>
          <line x1={px0 + hover.fx * (px1 - px0)} x2={px0 + hover.fx * (px1 - px0)} y1={py0} y2={py1}
            stroke={theme.text} strokeWidth={1} strokeDasharray="2 2" />
          <text data-cursor-time x={px0 + hover.fx * (px1 - px0)} y={py0 - 6} fontSize={7}
            textAnchor="middle" fill={theme.text}>{axisLabel(t0 + hover.fx * spanS, spanS)}</text>
        </>
      )}
      {/* hover surface (run mode value cursor; freezes the window) */}
      <rect x={px0} y={py0} width={px1 - px0} height={py1 - py0} fill="transparent"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
    </g>
  )
}
