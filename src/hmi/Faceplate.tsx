// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import { useSimStore } from './simStore'
import type { HmiWidget } from './model'
import type { AlarmLevel } from './sim/alarms'
import { useT } from '../i18n'

/** Remembered for the session so the plate reopens where the operator put it. */
let fpPos: { left: number; top: number } | null = null

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type Limits = Partial<Record<AlarmLevel, number>>

/** Vertical scale bar with embedded limit ticks and an optional SP caret —
 *  the classic DCS faceplate element. */
function VBar({ label, value, min, max, unit, limits, sp, color }: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  limits?: Limits
  sp?: number
  color: string
}) {
  const H = 108, W = 30, X = 28, Y = 12
  const frac = (v: number) => clamp((v - min) / (max - min || 1), 0, 1)
  const y = (v: number) => Y + (1 - frac(v)) * H
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={X + W + 26} height={H + 24}>
        <rect x={X} y={Y} width={W} height={H} fill="#0006" rx={3} />
        <rect x={X} y={y(value)} width={W} height={Y + H - y(value)} fill={color} opacity={0.9} rx={2} />
        {(['LL', 'L', 'H', 'HH'] as const).map((k) => {
          const lim = limits?.[k]
          if (lim === undefined) return null
          const crit = k === 'HH' || k === 'LL'
          return (
            <g key={k}>
              <line x1={X - 5} x2={X + W + 5} y1={y(lim)} y2={y(lim)}
                stroke={crit ? '#ff4d4d' : '#ffb020'} strokeWidth={1.4} />
              <text x={X + W + 7} y={y(lim) + 3} fontSize={8}
                fill={crit ? '#ff8f8f' : '#ffcf70'}>{k}</text>
            </g>
          )
        })}
        {sp !== undefined && <path d={`M${X - 4} ${y(sp)} l-8 -5 v10 Z`} fill="#ffd166" />}
        <text x={X - 8} y={Y + 6} fontSize={8} fill="#9db4cc" textAnchor="end">{Math.round(max)}</text>
        <text x={X - 8} y={Y + H} fontSize={8} fill="#9db4cc" textAnchor="end">{Math.round(min)}</text>
      </svg>
      <div style={{ fontSize: 10, opacity: 0.8 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        {value.toFixed(1)}{unit && <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  )
}

/** 60-sample mini-trend from the live history buffer. */
function Spark({ history, min, max }: { history: number[]; min: number; max: number }) {
  const recent = history.slice(-60)
  if (recent.length < 2) return null
  const W = 216, H = 36
  const pts = recent.map((v, i) => {
    const x = (i / (recent.length - 1)) * W
    const yv = 2 + (H - 4) * (1 - clamp((v - min) / (max - min || 1), 0, 1))
    return `${x.toFixed(1)},${yv.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block', margin: '6px auto 0', background: '#0004', borderRadius: 4 }}>
      <polyline points={pts} fill="none" stroke="#38a8e8" strokeWidth={1.5} />
    </svg>
  )
}

/** DCS-style operate popup — draggable, complete for every bindable widget. */
export default function Faceplate({ widget, onClose }: { widget: HmiWidget; onClose(): void }) {
  const tr = useT()
  const tag = widget.tag ?? ''
  const t = useSimStore((s) => s.tags[tag]) ?? {}
  const alarms = useSimStore((s) => s.alarms)
  const history = useSimStore((s) => s.history[`${tag}.PV`])
  const flow = useSimStore((s) => s.equipFlows[tag])
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
  const min = num(props.min) ?? 0
  const max = num(props.max) ?? 100
  const unit = typeof props.unit === 'string' ? props.unit : widget.type === 'tank' ? '%' : undefined
  const tankDefaults: Limits | undefined = widget.type === 'tank' ? { LL: 5, L: 10, H: 90, HH: 95 } : undefined
  const own: Limits = { LL: num(props.LL), L: num(props.L), H: num(props.H), HH: num(props.HH) }
  const limits: Limits | undefined =
    Object.values(own).some((v) => v !== undefined) ? own : tankDefaults

  // dispatch on the signals the tag actually serves — no widget type gets an
  // empty body (the audit found bar/symbol faceplates rendered header-only)
  const kind = isController ? 'controller'
    : t.RUN !== undefined ? 'motor'
    : t.OPEN !== undefined ? 'onoff'
    : t.OP !== undefined ? 'throttle'
    : 'measure'
  const auto = (t.MODE ?? 1) >= 0.5
  const myAlarms = alarms.filter((a) => a.tag === tag && !a.sup && a.phase !== 'pending')
  const nSup = alarms.filter((a) => a.tag === tag && a.sup).length

  return (
    <div className="hmi-faceplate" data-testid="faceplate" ref={boxRef}
      style={pos ? { left: pos.left, top: pos.top, right: 'auto' } : undefined}>
      <header onPointerDown={onHeaderDown} style={{ cursor: 'grab', touchAction: 'none' }}>
        <strong>{tag}</strong> <span style={{ opacity: 0.7 }}>{widget.label ?? tr(widget.type)}</span>
        <button data-testid="fp-close" onClick={onClose} style={{ marginLeft: 'auto', flex: '0 0 auto' }}>×</button>
      </header>

      {kind === 'motor' && (
        <>
          <p className="fp-state" style={(t.FAULT ?? 0) >= 0.5 ? { color: '#ff6b6b' } : undefined}>
            {(t.FAULT ?? 0) >= 0.5 ? tr('FAULT')
              : (t.RUN ?? 0) >= 0.5 ? ((t.RAMP ?? 1) < 1 ? tr('STARTING') : tr('RUNNING')) : tr('STOPPED')}
          </p>
          <div className="fp-row">
            <button data-testid="fp-start" onClick={() => write(tag, 'RUN', 1)}>{tr('Start')}</button>
            <button data-testid="fp-stop" onClick={() => write(tag, 'RUN', 0)}>{tr('Stop')}</button>
            {(t.FAULT ?? 0) >= 0.5 && (
              <button data-testid="fp-fault-reset" onClick={() => write(tag, 'FAULT', 0)}>{tr('Reset fault')}</button>
            )}
          </div>
        </>
      )}

      {kind === 'onoff' && (
        <>
          <p className="fp-state">{(t.OPEN ?? 0) >= 0.5 ? tr('OPEN') : tr('CLOSED')}</p>
          <div className="fp-row">
            <button data-testid="fp-open" onClick={() => write(tag, 'OPEN', 1)}>{tr('Open')}</button>
            <button data-testid="fp-shut" onClick={() => write(tag, 'OPEN', 0)}>{tr('Close')}</button>
          </div>
        </>
      )}

      {kind === 'throttle' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
            <VBar label={tr('Position')} value={t.POS ?? t.OP ?? 0} min={0} max={100} unit="%" color="#26c281" />
            {t.POS !== undefined && Math.abs((t.OP ?? 0) - t.POS) > 1 && (
              <VBar label={tr('Command')} value={t.OP ?? 0} min={0} max={100} unit="%" color="#9b8cff" />
            )}
          </div>
          <input data-testid="fp-op" type="range" min={0} max={100} value={t.OP ?? 0}
            onChange={(e) => write(tag, 'OP', Number(e.target.value))} style={{ width: '100%' }} />
          <div className="fp-row">
            <button onClick={() => write(tag, 'OP', 100)}>{tr('Open')}</button>
            <button onClick={() => write(tag, 'OP', 0)}>{tr('Close')}</button>
          </div>
        </>
      )}

      {kind === 'controller' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            <VBar label="PV" value={t.PV ?? 0} min={min} max={max} unit={unit} limits={limits} sp={t.SP} color="#38a8e8" />
            <VBar label="SP" value={t.SP ?? 0} min={min} max={max} unit={unit} color="#ffd166" />
            <VBar label="OUT" value={t.OP ?? 0} min={0} max={100} unit="%" color="#9b8cff" />
          </div>
          <div className="fp-row">
            <button data-testid="fp-auto" className={auto ? 'active' : ''} onClick={() => write(tag, 'MODE', 1)}>{tr('AUTO')}</button>
            <button data-testid="fp-man" className={auto ? '' : 'active'} onClick={() => write(tag, 'MODE', 0)}>{tr('MAN')}</button>
          </div>
          <div className="fp-row" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 11, flex: '0 0 auto' }}>SP</span>
            <button style={{ flex: '0 0 auto' }} onClick={() => write(tag, 'SP', clamp((t.SP ?? 50) - 1, min, max))}>−</button>
            <input data-testid="fp-sp" type="number" style={{ width: 64 }} value={Math.round((t.SP ?? 50) * 10) / 10}
              onChange={(e) => write(tag, 'SP', clamp(Number(e.target.value), min, max))} />
            <button style={{ flex: '0 0 auto' }} onClick={() => write(tag, 'SP', clamp((t.SP ?? 50) + 1, min, max))}>+</button>
          </div>
          <input data-testid="fp-op" type="range" min={0} max={100} value={t.OP ?? 0} disabled={auto}
            title={auto ? tr('Output entry needs MAN mode') : tr('Output %')}
            onChange={(e) => write(tag, 'OP', Number(e.target.value))} style={{ width: '100%' }} />
        </>
      )}

      {kind === 'measure' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <VBar label="PV" value={t.PV ?? 0} min={min} max={max} unit={unit} limits={limits} color="#38a8e8" />
          </div>
          {history && <Spark history={history} min={min} max={max} />}
        </>
      )}

      {flow !== undefined && kind !== 'measure' && kind !== 'controller' && (
        <p style={{ fontSize: 11, margin: '8px 0 0', opacity: 0.85 }}>{tr('Flow through')}: <strong>{flow.toFixed(1)}</strong></p>
      )}

      {nSup > 0 && <p style={{ fontSize: 10, margin: '6px 0 0', opacity: 0.7 }}>⊘ {nSup} {tr(nSup === 1 ? 'alarm suppressed' : 'alarms suppressed')}</p>}
      {myAlarms.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid #35567c', paddingTop: 6 }} data-testid="fp-alarms">
          {myAlarms.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, padding: '1px 0' }}>
              <span className={`al-prio al-prio-${a.priority}`}>
                {a.priority === 'high' ? '■' : a.priority === 'medium' ? '▲' : '●'}
              </span>
              <span>{a.level}</span>
              <span style={{ opacity: 0.8 }}>{tr(a.phase.toUpperCase())}</span>
              <span style={{ flex: 1 }} />
              {a.phase !== 'acked' && <button style={{ flex: '0 0 auto' }} onClick={() => ack(a.id)}>{tr('Ack')}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
