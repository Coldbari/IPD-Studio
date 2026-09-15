// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { WidgetView } from './shared'
import { EQUIP_LABEL, equipmentState, isTurning } from '../sim/state'
import { SCALE } from '../theme'

/**
 * A pump, drawn so its state reads without opening anything.
 *
 * RESTRAINT IS THE POINT. A stopped pump is the normal case on most screens,
 * so it recedes into the equipment tones and carries no colour at all — it used
 * to be painted RED, which made a correctly shut-down plant look like an
 * emergency. Running is a quiet active tone and a slow rotation. Only a TRIP
 * gets alarm colour, and it gets a heavier outline and a bold word with it, so
 * it is recognisable at a glance and without relying on colour vision.
 */
export default function Pump({ widget, theme, sim, oos }: WidgetView) {
  const { w, h } = widget
  const r = Math.min(w, h) / 2 - 6
  const cx = w / 2, cy = h / 2 - 2
  const state = equipmentState(sim, { oos })
  const tripped = state === 'tripped'
  const turning = isTurning(state)

  const fill = tripped ? theme.alarmHigh
    : state === 'disabled' ? theme.disabled
    : turning ? theme.processActive
    : theme.processInactive
  const stroke = tripped ? theme.alarmHigh : theme.equipStroke
  const label = tripped ? theme.alarmHigh : state === 'disabled' ? theme.textMuted : theme.textSecondary

  return (
    <g data-state={state}>
      {/* plinth */}
      <rect x={cx - r - 2} y={cy + r - 1} width={2 * r + 4} height={5} fill={theme.equipStroke} opacity={0.7} />
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={tripped ? 2.5 : 1.5}
        className={tripped ? 'hmi-blink' : undefined} data-fault={tripped || undefined} />
      {/* impeller: turns only while the shaft is actually turning, and slowly */}
      <g className={turning ? (state === 'running' ? 'hmi-spin' : 'hmi-spin hmi-blink') : undefined}
        style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <path d={`M ${cx} ${cy} L ${cx + r * 0.72} ${cy - r * 0.4} L ${cx + r * 0.72} ${cy + r * 0.4} Z`}
          fill={turning ? theme.bg : theme.equipStroke} opacity={turning ? 0.9 : 0.55} />
      </g>
      {/* out of service is hatched: a disabled drive must not read as a healthy
          stopped one, and the texture says so without any colour */}
      {state === 'disabled' && (
        <g stroke={theme.textMuted} strokeWidth={1} opacity={0.8}>
          <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} />
          <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} />
        </g>
      )}
      <text x={cx} y={h + 12} textAnchor="middle" fill={theme.text}
        fontSize={SCALE.font.sm} fontWeight={SCALE.weight.medium}
        stroke={theme.bg} strokeWidth={3} paintOrder="stroke">{widget.tag ?? ''}</text>
      {/* the state in WORDS as well as colour — ISA-101 is explicit that colour
          must never be the sole carrier of a state */}
      <text x={cx} y={h + 22} textAnchor="middle" fill={label}
        fontSize={SCALE.font.xs} fontWeight={tripped ? SCALE.weight.bold : SCALE.weight.normal}
        letterSpacing="0.04em" stroke={theme.bg} strokeWidth={2.5} paintOrder="stroke">
        {EQUIP_LABEL[state]}
      </text>
    </g>
  )
}
