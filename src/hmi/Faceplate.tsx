// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import { useSimStore } from './simStore'
import { vesselFlows } from './sim/processView'
import type { HmiWidget } from './model'
import type { AlarmLevel } from './sim/alarms'
import { alarmMessage } from './sim/alarms'
import { fmtQ, measureOf } from './widgets/shared'
import type { SeriesWindow } from './sim/history'
import { QUALITY_LABEL, hasNumber } from './sim/quality'
import type { Quality } from './sim/quality'
import { EQUIP_LABEL, equipmentState } from './sim/state'
import { ENVELOPE_SEVERITY } from './sim/envelope'
import type { ThemeTokens } from './theme'
import { SCALE, THEMES } from './theme'


/** Remembered for the session so the plate reopens where the operator put it. */
let fpPos: { left: number; top: number } | null = null

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
type Limits = Partial<Record<AlarmLevel, number>>

const SPARK_SPAN_S = 300

/**
 * THE FACEPLATE.
 *
 * One structure for every object — header (tag, description, state), the
 * process values that matter for THAT object, the controls, then status and
 * alarms — with the CONTENT adapted per type. A pump's plate does not carry a
 * setpoint and a transmitter's does not carry a start button, because a field
 * that is never relevant is a field an operator learns to ignore.
 *
 * Everything is drawn from the design system. This file previously held twenty
 * hardcoded colour literals and ignored the screen theme entirely, so a plate
 * stayed dark-blue on an ISA-101 grey screen.
 */

// ── Shared pieces ───────────────────────────────────────────────────────────

/** A labelled process value. The NUMBER is the important thing on the line;
 *  the unit rides with it, always, at a readable size. */
function Value({ label, value, unit, digits = 1, quality, tone }: {
  label: string
  value: number | undefined
  unit?: string
  digits?: number
  quality?: Quality
  tone?: string
}) {
  return (
    <div className="fp-kv" data-testid={`fp-v-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <span className="k">{label}</span>
      <span className="v" style={tone ? { color: tone } : undefined}>
        {fmtQ(value, quality, digits)}
        {unit && <span className="u">{unit}</span>}
      </span>
    </div>
  )
}

/** Vertical scale with the alarm limits drawn on it and the setpoint marked —
 *  the classic faceplate element, in theme colours. */
function VBar({ label, value, min, max, unit, limits, sp, color, quality, theme }: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  limits?: Limits
  sp?: number
  color: string
  quality?: Quality
  theme: ThemeTokens
}) {
  const H = 96, W = 26, X = 26, Y = 10
  const frac = (v: number) => clamp((v - min) / (max - min || 1), 0, 1)
  const y = (v: number) => Y + (1 - frac(v)) * H
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={X + W + 24} height={H + 22} aria-label={`${label} ${value.toFixed(1)}${unit ?? ''}`}>
        <rect x={X} y={Y} width={W} height={H} fill={theme.surfaceSunken} stroke={theme.border} />
        {hasNumber(quality) && (
          <rect x={X + 1} y={y(value)} width={W - 2} height={Y + H - y(value)} fill={color} />
        )}
        {(['LL', 'L', 'H', 'HH'] as const).map((k) => {
          const lim = limits?.[k]
          if (lim === undefined) return null
          const crit = k === 'HH' || k === 'LL'
          const c = crit ? theme.alarmHigh : theme.alarmMedium
          return (
            <g key={k}>
              <line x1={X - 4} x2={X + W + 4} y1={y(lim)} y2={y(lim)} stroke={c} strokeWidth={1.5} />
              <text x={X + W + 6} y={y(lim) + 3} fontSize={SCALE.font.xs - 2} fill={c}>{k}</text>
            </g>
          )
        })}
        {sp !== undefined && <path d={`M${X - 3} ${y(sp)} l-7 -4 v8 Z`} fill={theme.sp} />}
        <text x={X - 6} y={Y + 5} fontSize={SCALE.font.xs - 2} fill={theme.textMuted} textAnchor="end">{Math.round(max)}</text>
        <text x={X - 6} y={Y + H} fontSize={SCALE.font.xs - 2} fill={theme.textMuted} textAnchor="end">{Math.round(min)}</text>
      </svg>
      <div style={{ fontSize: SCALE.font.xs, color: theme.textMuted, letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: SCALE.font.md, fontWeight: SCALE.weight.bold, fontVariantNumeric: 'tabular-nums' }}>
        {fmtQ(value, quality)}
        {unit && <span style={{ fontSize: SCALE.font.sm, fontWeight: SCALE.weight.normal, color: theme.textMuted, marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  )
}

/** Five minutes of recorded history, on a real process-time axis. */
function Spark({ window: win, min, max, theme }: { window: SeriesWindow; min: number; max: number; theme: ThemeTokens }) {
  if (win.v.length < 2) return null
  const W = 216, H = 32
  const t0 = win.t[0]!
  const tSpan = win.t[win.t.length - 1]! - t0 || 1
  const pts = win.v.map((v, i) => {
    const x = ((win.t[i]! - t0) / tSpan) * W
    const yv = 2 + (H - 4) * (1 - clamp((v - min) / (max - min || 1), 0, 1))
    return `${x.toFixed(1)},${yv.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block', marginTop: SCALE.space.md, background: theme.surfaceSunken }}
      aria-hidden>
      <polyline points={pts} fill="none" stroke={theme.liquid} strokeWidth={1.5}
        {...(win.allGood ? {} : { strokeDasharray: '3 2' })} />
    </svg>
  )
}

/** Quality, as a compact badge that is absent when the value is simply live. */
function QualityBadge({ q, why, theme }: { q: Quality; why: string; theme: ThemeTokens }) {
  if (q === 'good') return null
  const tone = q === 'bad' ? theme.bad : q === 'forced' ? theme.forced : theme.stale
  return (
    <span className="op-badge" data-testid="fp-quality" data-quality={q}
      style={{ color: tone }} title={why}>{QUALITY_LABEL[q]}</span>
  )
}

function Section({ title, children, testId }: { title?: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="fp-sec" data-testid={testId}>
      {title && <h6>{title}</h6>}
      {children}
    </div>
  )
}

// ── The plate ───────────────────────────────────────────────────────────────

export default function Faceplate({ widget, onClose, theme: themeName = 'classic' }: {
  widget: HmiWidget
  onClose(): void
  theme?: 'classic' | 'hp'
}) {
  const theme = THEMES[themeName]
  const tag = widget.tag ?? ''
  const t = useSimStore((s) => s.tags[tag]) ?? {}
  const eng = useSimStore((s) => s.defs[tag])
  const qual = useSimStore((s) => s.quality[tag])
  const oos = useSimStore((s) => tag in s.oos)
  const alarms = useSimStore((s) => s.alarms)
  const history = useSimStore((s) => s.history)
  useSimStore((s) => s.historyVersion)
  const flow = useSimStore((s) => s.equipFlows[tag])
  /** K13: where this machine is being run, straight off the solve. */
  const envelope = useSimStore((s) => s.pumpEnvelopes[tag])
  const processView = useSimStore((s) => s.processView)
  const pipeFlows = useSimStore((s) => s.pipeFlows)
  const write = useSimStore((s) => s.writeTag)
  const ack = useSimStore((s) => s.ack)
  const [pos, setPos] = useState(fpPos)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Drag by the header; position lives in offsetParent (.hmi-center) space. */
  const onHeaderDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return
    const box = boxRef.current
    const parent = box?.offsetParent as HTMLElement | null
    if (!box || !parent) return
    const r = box.getBoundingClientRect()
    const pr = parent.getBoundingClientRect()
    const grab = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    const onMove = (ev: PointerEvent) => {
      const next = {
        left: clamp(ev.clientX - pr.left - grab.dx, 0, Math.max(0, pr.width - r.width)),
        top: clamp(ev.clientY - pr.top - grab.dy, 0, Math.max(0, pr.height - 60)),
      }
      fpPos = next
      setPos(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const props = widget.props ?? {}
  const isController = props.controller === true
  const { min, max, unit: engUnit, limits } = measureOf(widget, eng)
  const unit = engUnit || (widget.type === 'tank' ? '%' : undefined)
  const q = qual?.q ?? 'good'

  /** Which plate this is — decided by the SIGNALS the tag actually serves, so
   *  a symbol standing in for a pump still gets a pump's controls. */
  const kind = isController ? 'controller'
    : t.RUN !== undefined ? 'motor'
    : t.OPEN !== undefined ? 'onoff'
    : t.OP !== undefined ? 'throttle'
    : 'measure'
  const auto = (t.MODE ?? 1) >= 0.5
  const myAlarms = alarms.filter((a) => a.tag === tag && !a.sup && a.phase !== 'pending')
  const nSup = alarms.filter((a) => a.tag === tag && a.sup).length
  const state = equipmentState(t, { oos })
  const isTank = widget.type === 'tank'
  const description = widget.label ?? (isTank ? 'Vessel' : kind === 'motor' ? 'Driver' : kind === 'controller' ? 'Controller' : kind === 'measure' ? 'Transmitter' : 'Valve')

  /** Header banner tone: abnormal is the only thing that gets a colour. */
  const stateTone = state === 'tripped' ? theme.alarmHigh
    : state === 'disabled' ? theme.textMuted
    : state === 'running' || state === 'starting' || state === 'stopping' ? theme.processActive
    : theme.textSecondary

  return (
    <div className="hmi-faceplate" data-testid="faceplate" data-kind={kind} ref={boxRef}
      role="dialog" aria-label={`${tag} faceplate`}
      style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}>

      {/* HEADER — identity first, then what it is, then what it is doing. */}
      <header className="fp-head" onPointerDown={onHeaderDown}>
        <span className="fp-tag">{tag}</span>
        <span className="fp-desc">{description}</span>
        <button className="fp-x" data-testid="fp-close" aria-label="Close faceplate" onClick={onClose}>×</button>
      </header>

      {(kind === 'motor' || kind === 'onoff' || kind === 'throttle') && (
        <div className="fp-band">
          <span className="fp-state" data-state={state} style={{ color: stateTone }}>
            {kind === 'motor' ? EQUIP_LABEL[state]
              : kind === 'onoff' ? ((t.OPEN ?? 0) >= 0.5 ? 'OPEN' : 'CLOSED')
              : `${(t.POS ?? t.OP ?? 0).toFixed(0)} % OPEN`}
          </span>
          {oos && <span className="op-badge" data-testid="fp-oos" style={{ color: theme.textMuted }}>OUT OF SERVICE</span>}
        </div>
      )}

      {/* PUMP / DRIVER */}
      {kind === 'motor' && (
        <>
          <Section title="Process" testId="fp-values">
            {/* THE SHAFT, always — this is what the pump curve reads and what
                the plant is actually doing. A command is shown beside it and
                never in place of it. */}
            <Value label="Actual speed" value={(t.RAMP ?? 0) * 100} unit="%" digits={0} />
            {t.SPD !== undefined && (
              <Value label="Speed command" value={t.SPD} unit="%" digits={0} />
            )}
            {/* THE MACHINE'S OWN SIGNED FLOW where the solve has one, in
                preference to the branch magnitude: a pump running backwards
                must not read as one running forwards. */}
            {(envelope?.flowM3h ?? flow) !== undefined && (
              <Value label="Flow" value={envelope?.flowM3h ?? flow} unit="m³/h" />
            )}
            {/* THE OPERATING ENVELOPE. Not a new page and not a new engine —
                one line saying whether the solved operating point is somewhere
                the engineering record can stand behind, and LIMIT UNKNOWN when
                the record states no minimum rather than a verdict with no data
                behind it. A drive on its way somewhere is a ramp, not a fault,
                and carries no tone. */}
            {envelope && (
              <div className="fp-kv" data-testid="fp-envelope"
                data-state={envelope.state} data-severity={ENVELOPE_SEVERITY[envelope.state] ?? 'none'}>
                <span className="k">Operating envelope</span>
                <span className="v" style={{
                  color: ENVELOPE_SEVERITY[envelope.state] === 'error' ? theme.alarmHigh
                    : ENVELOPE_SEVERITY[envelope.state] === 'warning' ? theme.alarmMedium
                    : ENVELOPE_SEVERITY[envelope.state] === 'info' ? theme.textMuted
                    : theme.textSecondary,
                }}>{envelope.state}</span>
              </div>
            )}
            {envelope?.minFlowM3h !== undefined && (
              <Value label="Minimum flow" value={envelope.minFlowM3h} unit="m³/h" />
            )}
          </Section>
          <Section title="Command">
            <div className="fp-row">
              <button className={`fp-btn${state === 'running' || state === 'starting' ? ' on' : ''}`}
                data-testid="fp-start" onClick={() => write(tag, 'RUN', 1)}>START</button>
              <button className={`fp-btn${state === 'stopped' || state === 'stopping' ? ' on' : ''}`}
                data-testid="fp-stop" onClick={() => write(tag, 'RUN', 0)}>STOP</button>
            </div>
            {state === 'tripped' && (
              <div className="fp-row">
                <button className="fp-btn danger" data-testid="fp-fault-reset"
                  onClick={() => write(tag, 'FAULT', 0)}>RESET TRIP</button>
              </div>
            )}
          </Section>
          {/* A DRIVE, only where the record declares one. A machine without a
              VSD gets no speed control here, because it has none. The command
              and the shaft are shown apart above: a drive taking time to get
              somewhere is a ramp, not a deviation, and carries no alarm. */}
          {t.SPD !== undefined && (
            <Section title="Speed">
              <input data-testid="fp-speed" type="range" min={0} max={100} value={t.SPD}
                aria-label="Pump speed command per cent"
                onChange={(e) => write(tag, 'SPD', Number(e.target.value))} style={{ width: '100%' }} />
              <div className="fp-row">
                {[100, 75, 50].map((v) => (
                  <button key={v} className="fp-btn" data-testid={`fp-speed-${v}`}
                    onClick={() => write(tag, 'SPD', v)}>{v} %</button>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {/* HAND VALVE */}
      {kind === 'onoff' && (
        <Section title="Command">
          <div className="fp-row">
            <button className={`fp-btn${(t.OPEN ?? 0) >= 0.5 ? ' on' : ''}`}
              data-testid="fp-open" onClick={() => write(tag, 'OPEN', 1)}>OPEN</button>
            <button className={`fp-btn${(t.OPEN ?? 0) < 0.5 ? ' on' : ''}`}
              data-testid="fp-shut" onClick={() => write(tag, 'OPEN', 0)}>CLOSE</button>
          </div>
        </Section>
      )}

      {/* CONTROL VALVE — command, position and the gap between them. */}
      {kind === 'throttle' && (
        <>
          <Section title="Process" testId="fp-values">
            <Value label="Command" value={t.OP} unit="%" digits={0} />
            <Value label="Position" value={t.POS ?? t.OP} unit="%" digits={0} />
            {t.POS !== undefined && Math.abs((t.OP ?? 0) - t.POS) > 1 && (
              <Value label="Deviation" value={Math.abs((t.OP ?? 0) - t.POS)} unit="%" digits={0}
                tone={(t.DEVT ?? 0) > 0 ? theme.alarmMedium : undefined} />
            )}
            {flow !== undefined && <Value label="Flow" value={flow} unit="m³/h" />}
          </Section>
          <Section title="Output">
            <input data-testid="fp-op" type="range" min={0} max={100} value={t.OP ?? 0}
              aria-label="Valve output per cent"
              onChange={(e) => write(tag, 'OP', Number(e.target.value))} style={{ width: '100%' }} />
            <div className="fp-row">
              <button className="fp-btn" onClick={() => write(tag, 'OP', 100)}>OPEN</button>
              <button className="fp-btn" onClick={() => write(tag, 'OP', 0)}>CLOSE</button>
            </div>
          </Section>
        </>
      )}

      {/* CONTROLLER — PV, SP, OUT, and a mode nobody can misread. */}
      {kind === 'controller' && (
        <>
          <Section testId="fp-values">
            <div style={{ display: 'flex', justifyContent: 'space-around' }}>
              <VBar label="PV" value={t.PV ?? 0} min={min} max={max} unit={unit} limits={limits}
                sp={t.SP} color={theme.liquid} quality={q} theme={theme} />
              <VBar label="SP" value={t.SP ?? 0} min={min} max={max} unit={unit} color={theme.sp} theme={theme} />
              <VBar label="OUT" value={t.OP ?? 0} min={0} max={100} unit="%" color={theme.op} theme={theme} />
            </div>
          </Section>
          <Section title="Mode">
            <div className="fp-row" role="group" aria-label="Controller mode">
              <button className={`fp-btn${auto ? ' on' : ''}`} data-testid="fp-auto"
                aria-pressed={auto} onClick={() => write(tag, 'MODE', 1)}>AUTO</button>
              <button className={`fp-btn${auto ? '' : ' on'}`} data-testid="fp-man"
                aria-pressed={!auto} onClick={() => write(tag, 'MODE', 0)}>MANUAL</button>
            </div>
          </Section>
          <Section title="Setpoint and output">
            <div className="fp-row" style={{ alignItems: 'center' }}>
              <span className="k" style={{ flex: '0 0 auto', fontSize: SCALE.font.sm }}>SP</span>
              <button className="fp-btn" style={{ flex: '0 0 auto', width: 30 }} aria-label="Decrease setpoint"
                onClick={() => write(tag, 'SP', clamp((t.SP ?? 50) - 1, min, max))}>−</button>
              <input data-testid="fp-sp" type="number" aria-label="Setpoint" style={{ width: 64 }}
                value={Math.round((t.SP ?? 50) * 10) / 10}
                onChange={(e) => write(tag, 'SP', clamp(Number(e.target.value), min, max))} />
              <button className="fp-btn" style={{ flex: '0 0 auto', width: 30 }} aria-label="Increase setpoint"
                onClick={() => write(tag, 'SP', clamp((t.SP ?? 50) + 1, min, max))}>+</button>
            </div>
            <input data-testid="fp-op" type="range" min={0} max={100} value={t.OP ?? 0} disabled={auto}
              aria-label="Controller output per cent"
              title={auto ? 'Output entry needs MANUAL mode' : 'Output %'}
              onChange={(e) => write(tag, 'OP', Number(e.target.value))} style={{ width: '100%', marginTop: SCALE.space.md }} />
            <div className="fp-kv"><span className="k">Output</span>
              <span className="v">{(t.OP ?? 0).toFixed(1)}<span className="u">%</span></span></div>
          </Section>
        </>
      )}

      {/* TANK — what it holds and the conditions inside it. */}
      {kind === 'measure' && isTank && (() => {
        const cap = eng?.capacity
        const level = t.PV ?? 0
        const flows = processView ? vesselFlows(processView, pipeFlows, tag) : { inlet: 0, outlet: 0 }
        return (
          <Section title="Process" testId="fp-values">
            <Value label="Level" value={level} unit={unit} quality={q} />
            {cap !== undefined && <Value label="Volume" value={(cap * level) / 100} unit="m³" />}
            {t.P !== undefined && <Value label="Pressure" value={t.P} unit="bar" digits={2} />}
            {t.T !== undefined && <Value label="Temperature" value={t.T} unit="°C" />}
            {flows.inlet > 0 && <Value label="Inlet flow" value={flows.inlet} unit="m³/h" />}
            {flows.outlet > 0 && <Value label="Outlet flow" value={flows.outlet} unit="m³/h" />}
          </Section>
        )
      })()}

      {/* TRANSMITTER — the reading, what it means, and whether to trust it. */}
      {kind === 'measure' && !isTank && (
        <>
          <Section testId="fp-values">
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <VBar label="PV" value={t.PV ?? 0} min={min} max={max} unit={unit} limits={limits}
                color={theme.liquid} quality={q} theme={theme} />
            </div>
            <Spark window={history.getSeries(`${tag}.PV`, history.latestT - SPARK_SPAN_S, history.latestT, 216)}
              min={min} max={max} theme={theme} />
          </Section>
          <Section title="Signal">
            <div className="fp-kv" data-testid="fp-range">
              <span className="k">Range</span>
              <span className="v">{min}–{max}{unit && <span className="u">{unit}</span>}</span>
            </div>
            <div className="fp-kv">
              <span className="k">Quality</span>
              <span className="v" style={{ fontSize: SCALE.font.sm }}>
                {QUALITY_LABEL[q]}{qual && qual.q !== 'good' && <> <QualityBadge q={q} why={qual.why} theme={theme} /></>}
              </span>
            </div>
            <div className="fp-kv">
              <span className="k">Source</span>
              <span className="v" style={{ fontSize: SCALE.font.sm }}>{q === 'forced' ? 'OPERATOR' : 'SIMULATION'}</span>
            </div>
          </Section>
        </>
      )}

      {/* STATUS — quality for anything that reads a value, then alarms. */}
      {(kind === 'controller' || (kind === 'measure' && isTank)) && qual && qual.q !== 'good' && (
        <Section>
          <div className="fp-kv">
            <span className="k">Quality</span>
            <span className="v"><QualityBadge q={q} why={qual.why} theme={theme} /></span>
          </div>
        </Section>
      )}

      <Section title="Alarms" testId="fp-alarm-section">
        {myAlarms.length === 0 && (
          <div className="fp-kv"><span className="k">Status</span><span className="v" style={{ fontSize: SCALE.font.sm }}>NONE</span></div>
        )}
        {myAlarms.length > 0 && (
          <div data-testid="fp-alarms">
            {myAlarms.map((a) => (
              <div key={a.id} className="fp-kv" style={{ alignItems: 'center' }}>
                <span className="k" style={{ display: 'flex', gap: SCALE.space.sm, alignItems: 'baseline' }}>
                  <span className={`al-prio al-prio-${a.priority}`}>
                    {a.priority === 'high' ? '■' : a.priority === 'medium' ? '▲' : '●'}
                  </span>
                  <strong>{a.level}</strong>
                  <span style={{ color: theme.textMuted }}>{alarmMessage(a)}</span>
                </span>
                {a.phase !== 'acked'
                  ? <button className="fp-btn" style={{ flex: '0 0 auto', width: 52 }} onClick={() => ack(a.id)}>ACK</button>
                  : <span style={{ fontSize: SCALE.font.xs, color: theme.textMuted }}>ACKED</span>}
              </div>
            ))}
          </div>
        )}
        {nSup > 0 && (
          <div className="fp-kv"><span className="k">Suppressed</span>
            <span className="v" style={{ fontSize: SCALE.font.sm }}>{nSup}</span></div>
        )}
      </Section>
    </div>
  )
}

