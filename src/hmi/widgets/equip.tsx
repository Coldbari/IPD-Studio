// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { getSymbol } from '../../symbols/registry'
import type { WidgetView } from './shared'
import { EQUIP_LABEL, equipmentState, isTurning } from '../sim/state'

/** Motor-driven equipment (compressor, blower, agitator, conveyor, heater…):
 *  any P&ID glyph + the pump's motor state model. RUN/RAMP/FAULT come from
 *  the existing motor TagKind, so faceplate Start/Stop, trip events, and the
 *  flow network all treat it like a driver. */
export default function Equip({ widget, theme, sim, oos }: WidgetView) {
  const id = typeof widget.props?.symbolId === 'string' ? widget.props.symbolId : ''
  let inner = '', sw = 8, sh = 8
  try {
    const def = getSymbol(id)
    inner = def.render((widget.props as Record<string, string>) ?? {})
    sw = def.gridSize.w * 8
    sh = def.gridSize.h * 8
  } catch {
    inner = '<rect x="1" y="1" width="30" height="30" fill="none" stroke="currentColor"/>'
    sw = sh = 32
  }
  // same one state machine as the pump widget and the faceplate
  const state = equipmentState(sim, { oos })
  const faulted = state === 'tripped'
  const turning = isTurning(state)
  const color = faulted ? theme.alarm : turning ? theme.running : theme.equipStroke
  const rot = widget.rotation ?? 0
  const swapped = rot === 90 || rot === 270
  const scale = Math.min(widget.w / (swapped ? sh : sw), widget.h / (swapped ? sw : sh))
  const transform = rot === 0
    ? `scale(${scale})`
    : `translate(${widget.w / 2} ${widget.h / 2}) rotate(${rot}) scale(${scale}) translate(${-sw / 2} ${-sh / 2})`
  const bx = widget.w - 8, by = widget.h - 8 // status badge center
  return (
    <g data-hmi-equip={id} data-state={state}>
      <g color={color} transform={transform} className={faulted ? 'hmi-blink' : undefined}
        data-fault={faulted || undefined} dangerouslySetInnerHTML={{ __html: inner }} />
      <circle cx={bx} cy={by} r={7} fill={theme.bg} stroke={color} strokeWidth={1.5} />
      <g className={turning ? (state === 'running' ? 'hmi-spin' : 'hmi-spin hmi-blink') : undefined}
        style={{ transformOrigin: `${bx}px ${by}px` }}>
        <path d={`M ${bx} ${by - 4.5} A 4.5 4.5 0 1 1 ${bx - 4.5} ${by}`} fill="none"
          stroke={turning ? theme.running : theme.equipStroke} strokeWidth={2} strokeLinecap="round" />
      </g>
      <text x={widget.w / 2} y={widget.h + 14} textAnchor="middle" fill={theme.text} fontSize={11} fontWeight={600}
        stroke={theme.bg} strokeWidth={3} paintOrder="stroke">{widget.tag ?? widget.label ?? ''}</text>
      <text x={widget.w / 2} y={widget.h + 25} textAnchor="middle" fontSize={8} fontWeight={700}
        fill={faulted ? theme.alarm : theme.textDim}
        stroke={theme.bg} strokeWidth={2.5} paintOrder="stroke">{EQUIP_LABEL[state]}</text>
    </g>
  )
}
