// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useSimStore } from '../simStore'
import { fmt } from '../widgets/shared'
import { TREND_SPANS } from '../sim/history'
import type { HistoryReader, SeriesWindow } from '../sim/history'
import { axisLabel } from '../widgets/trend'
import { THEMES } from '../theme'
import type { ThemeTokens } from '../theme'
import { useStore, activeHmiScreen } from '../../store/store'
import { trendSignals } from './summary'
import type { SignalOption } from './summary'
import type { TagDef } from '../sim/tags'

const MAX_PENS = 4

const SPAN_LABEL = (s: number) => (s < 3600 ? `${s / 60} min` : `${s / 3600} hr`)

interface Pen {
  opt: SignalOption
  color: string
  win: SeriesWindow
  /** Each pen is drawn against its OWN engineering range. */
  lo: number
  hi: number
}

/**
 * Per-pen scaling.
 *
 * Putting bar, %, m³/h and °C on one shared axis makes a chart that is
 * confidently wrong — a 4 bar pressure would sit near the floor of a 0-150 °C
 * scale and read as "low". Each pen is therefore normalised to its own
 * compiled range and its own value and unit are printed in the legend, and the
 * chart says so when the selection spans more than one unit.
 */
function rangeOf(def: TagDef | undefined, win: SeriesWindow, signal: string): { lo: number; hi: number } {
  if (signal === 'OP') return { lo: 0, hi: 100 }
  if (def) return { lo: def.min, hi: def.max }
  if (win.v.length === 0) return { lo: 0, hi: 100 }
  const lo = Math.min(...win.v)
  const hi = Math.max(...win.v)
  return lo === hi ? { lo: lo - 1, hi: hi + 1 } : { lo, hi }
}

/** Multi-pen chart over the Step F history. It reads `getSeries` and keeps no
 *  samples of its own — there is one history, and this is a view of it. */
function TrendChart({ pens, spanS, endT, onCursor, cursor, theme }: {
  pens: Pen[]
  spanS: number
  endT: number
  onCursor(fx: number | null): void
  cursor: number | null
  theme: ThemeTokens
}) {
  const W = 760, H = 300
  const px0 = 48, px1 = W - 12, py0 = 14, py1 = H - 24
  const t0 = endT - spanS
  const xOf = (t: number) => px0 + (px1 - px0) * Math.max(0, Math.min(1, (t - t0) / spanS))

  return (
    <svg data-testid="op-trend-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Trend over ${SPAN_LABEL(spanS)}`}
      style={{ background: theme.surface, border: `1px solid ${theme.border}`, display: 'block' }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        if (r.width <= 0) return
        const fx = ((e.clientX - r.left) / r.width * W - px0) / (px1 - px0)
        onCursor(Math.max(0, Math.min(1, fx)))
      }}
      onMouseLeave={() => onCursor(null)}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={px0} x2={px1} y1={py0 + (py1 - py0) * f} y2={py0 + (py1 - py0) * f}
          stroke={theme.grid} strokeWidth={1} />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={`t${f}`} x={px0 - 6} y={py0 + (py1 - py0) * f + 3} textAnchor="end"
          fontSize={9} fill={theme.textMuted}>{Math.round((1 - f) * 100)}%</text>
      ))}
      {pens.map((p) => {
        const span = p.hi - p.lo || 1
        const yOf = (v: number) => py1 - (py1 - py0) * Math.max(0, Math.min(1, (v - p.lo) / span))
        const pts = p.win.v.map((v, i) => `${xOf(p.win.t[i]!).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
        if (!pts) return null
        return (
          <polyline key={p.opt.ref} points={pts} fill="none" stroke={p.color} strokeWidth={1.8}
            data-ref={p.opt.ref}
            {...(p.win.allGood ? {} : { strokeDasharray: '4 3', 'data-degraded': true })} />
        )
      })}
      {[0, 0.5, 1].map((f) => (
        <text key={`x${f}`} x={px0 + (px1 - px0) * f} y={H - 8} fontSize={9} fill={theme.textMuted}
          textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
          {axisLabel(t0 + f * spanS, spanS)}
        </text>
      ))}
      {cursor !== null && (
        <>
          <line x1={px0 + cursor * (px1 - px0)} x2={px0 + cursor * (px1 - px0)} y1={py0} y2={py1}
            stroke={theme.text} strokeWidth={1} strokeDasharray="2 2" />
          <text data-testid="op-trend-cursor-time" x={px0 + cursor * (px1 - px0)} y={py0 - 3}
            fontSize={9} fill={theme.text} textAnchor="middle">{axisLabel(t0 + cursor * spanS, spanS)}</text>
        </>
      )}
    </svg>
  )
}

/**
 * The operator TRENDS page.
 *
 * Signals come from the compiled model, spans from the one canonical
 * `TREND_SPANS`, samples from the Step F history — nothing is duplicated, and
 * selecting a signal changes only what is DRAWN.
 */
export default function TrendsPage() {
  const theme = THEMES[useStore(activeHmiScreen)?.theme ?? 'classic']
  const defs = useSimStore((s) => s.defs)
  const history = useSimStore((s) => s.history)
  useSimStore((s) => s.historyVersion) // in-place buffers: the version re-renders us
  const [spanS, setSpanS] = useState<number>(300)
  const [selected, setSelected] = useState<string[]>([])
  const [cursor, setCursor] = useState<number | null>(null)

  const options = trendSignals(defs)
  // default to the first process measurement, so the page is never blank when
  // the plant has something to show
  const active = selected.length > 0 ? selected : options.slice(0, 1).map((o) => o.ref)
  const endT = history.latestT
  const t0 = endT - spanS

  const pens: Pen[] = active.slice(0, MAX_PENS).map((ref, i) => {
    const opt = options.find((o) => o.ref === ref) ?? { ref, tag: ref, signal: 'PV', description: '', group: 'PROCESS' as const }
    const win = history.getSeries(ref, t0, endT, 740)
    const { lo, hi } = rangeOf(defs[opt.tag], win, opt.signal)
    return { opt, color: theme.pens[i % theme.pens.length]!, win, lo, hi }
  })

  const units = new Set(pens.map((p) => p.opt.unit ?? ''))
  const readout = (p: Pen): number | undefined => {
    if (cursor === null) return p.win.v[p.win.v.length - 1]
    const tc = t0 + cursor * spanS
    let idx = -1
    for (let i = 0; i < p.win.t.length; i++) if (p.win.t[i]! <= tc) idx = i
    return idx >= 0 ? p.win.v[idx] : undefined
  }

  const toggle = (ref: string) => {
    setSelected((cur) => {
      const base = cur.length > 0 ? cur : active
      if (base.includes(ref)) return base.filter((r) => r !== ref)
      return base.length >= MAX_PENS ? base : [...base, ref]
    })
  }

  const groups: SignalOption['group'][] = ['PROCESS', 'CONTROL']

  return (
    <div className="op-page" data-testid="op-trends">
      <div className="op-filters">
        <span className="lbl" style={{ marginLeft: 0 }}>Span</span>
        {TREND_SPANS.map((s) => (
          <button key={s} data-testid={`trend-span-${s}`} className={spanS === s ? 'on' : ''}
            aria-pressed={spanS === s} onClick={() => { setSpanS(s); setCursor(null) }}>
            {SPAN_LABEL(s)}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--hmi-text-muted)' }} data-testid="trend-pen-count">
          {pens.length} of {MAX_PENS} pens
        </span>
      </div>

      <div className="op-trend">
        <div className="picker" data-testid="trend-picker">
          {options.length === 0 && <p className="op-empty">No recorded signals.</p>}
          {groups.map((g) => {
            const list = options.filter((o) => o.group === g)
            if (list.length === 0) return null
            return (
              <div key={g}>
                <div className="grp">{g}</div>
                {list.map((o) => (
                  <label key={o.ref} data-testid="trend-signal" title={`${o.description}${o.unit ? ` · ${o.unit}` : ''}`}>
                    <input type="checkbox" data-testid={`trend-pick-${o.ref}`}
                      checked={active.includes(o.ref)}
                      disabled={!active.includes(o.ref) && active.length >= MAX_PENS}
                      onChange={() => toggle(o.ref)} />
                    <span>{o.ref}</span>
                    {o.unit && <span className="hint">{o.unit}</span>}
                  </label>
                ))}
              </div>
            )
          })}
        </div>

        <div className="plot">
          <TrendChart pens={pens} spanS={spanS} endT={endT} cursor={cursor} onCursor={setCursor} theme={theme} />
          <div className="op-legend" data-testid="trend-legend">
            {pens.map((p) => (
              <span key={p.opt.ref} className="pen" data-testid="trend-pen" data-ref={p.opt.ref}>
                <span className="sw" style={{ background: p.color }} aria-hidden />
                <strong>{p.opt.ref}</strong>
                <span style={{ color: theme.textMuted }}>{p.opt.description}</span>
                <span className="val">{fmt(readout(p))}{p.opt.unit ? ` ${p.opt.unit}` : ''}</span>
                {!p.win.allGood && (
                  <span className="op-badge" data-testid="trend-degraded"
                    title="Part of this window was forced, stale or not valid">NOT GOOD</span>
                )}
              </span>
            ))}
          </div>
          {units.size > 1 && (
            <p className="op-empty" data-testid="trend-mixed-units" style={{ marginTop: 6 }}>
              Pens use different engineering units, so each is drawn against <strong>its own range</strong> —
              the vertical axis is per cent of range, and every pen's real value is in the legend.
            </p>
          )}
          {pens.length > 0 && pens.every((p) => p.win.v.length === 0) && (
            <p className="op-empty" data-testid="trend-no-data">
              Nothing recorded in this window yet.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export type { HistoryReader }
