// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { WidgetView } from './shared'
import { fmtQ, measureOf } from './shared'
import { SCALE } from '../theme'
import { hasNumber } from '../sim/quality'

/**
 * Vessel widget. `props.shape` (set by the P&ID import) keeps the source
 * symbol's silhouette so operators recognize the equipment:
 *  - vertical (default): dished drum, rounded corners
 *  - horizontal: lying capsule
 *  - cone: storage tank with a peaked roof
 *  - agitated: stirred reactor — motor, shaft, impeller
 */
export default function Tank({ widget, theme, sim, eng, quality }: WidgetView) {
  const { w, h } = widget
  // Percent-full is what the simulator models for a vessel, so the scale is
  // fixed; the LIMITS and the unit come from the one resolver.
  const { unit, limits } = measureOf(widget, eng)
  const shape = typeof widget.props?.shape === 'string' ? widget.props.shape : 'vertical'
  // a vessel whose level nothing is producing shows an empty shell, not the
  // last level it happened to hold
  const level = hasNumber(quality) ? Math.max(0, Math.min(100, sim.PV ?? 0)) : 0
  // roof/motor band above the level-holding body
  const roofH = shape === 'cone' ? Math.min(16, h * 0.22) : shape === 'agitated' ? 10 : 0
  const bodyTop = 2 + roofH
  const innerTop = bodyTop + 2
  const innerBot = h - 4
  const span = innerBot - innerTop
  const liquidH = (span * level) / 100
  const r = shape === 'horizontal' ? (h - 4) / 2 : shape === 'cone' ? 2 : Math.min(12, w / 4)
  const shaftY = h * 0.68

  const outline = shape === 'cone'
    ? <path d={`M2 ${bodyTop} L${w / 2} 2 L${w - 2} ${bodyTop} V${h - 2} H2 Z`} fill={theme.equipFill} stroke={theme.equipStroke} strokeWidth={2} strokeLinejoin="round" />
    : <rect x={2} y={bodyTop} width={w - 4} height={h - 2 - bodyTop} rx={r} fill={theme.equipFill} stroke={theme.equipStroke} strokeWidth={2} />

  return (
    <g data-shape={shape}>
      {outline}
      <clipPath id={`clip-${widget.id}`}>
        <rect x={4} y={innerTop} width={w - 8} height={span} rx={Math.max(0, r - 2)} />
      </clipPath>
      {/* A flat fill, not a gradient. The level IS the information; a
          three-stop gradient adds nothing an operator can read and makes the
          top edge — the only part that matters — harder to place. */}
      <rect x={4} y={innerBot - liquidH} width={w - 8} height={liquidH}
        fill={theme.liquid} clipPath={`url(#clip-${widget.id})`} />
      {/* the surface line: where the level actually is, crisply */}
      {liquidH > 0 && (
        <line x1={4} x2={w - 4} y1={innerBot - liquidH} y2={innerBot - liquidH}
          stroke={theme.liquid} strokeWidth={2} />
      )}
      {shape === 'agitated' && (
        <g data-agitator stroke={theme.equipStroke} fill={theme.equipFill}>
          <rect x={w / 2 - 8} y={1} width={16} height={10} strokeWidth={2} />
          <line x1={w / 2} y1={11} x2={w / 2} y2={shaftY} strokeWidth={2} />
          <path d={`M${w / 2 - 9} ${shaftY} L${w / 2} ${shaftY - 8} L${w / 2 + 9} ${shaftY}`} fill="none" strokeWidth={2} strokeLinejoin="round" />
        </g>
      )}
      {/* level ticks at 25/50/75% */}
      {[25, 50, 75].map((tk) => (
        <line key={tk} x1={w - 12} x2={w - 5} y1={innerTop + span * (1 - tk / 100)} y2={innerTop + span * (1 - tk / 100)}
          stroke={theme.equipStroke} strokeWidth={1.5} opacity={0.8} />
      ))}
      {/* alarm-limit markers — whatever the tag's compiled definition says.
          An untagged vessel has no definition and therefore no markers, which
          is the honest answer: it has no alarms either. */}
      {([['LL', theme.alarm], ['L', theme.warn], ['H', theme.warn], ['HH', theme.alarm]] as const).map(([key, color]) => {
        const v = limits[key]
        if (v === undefined) return null
        const y = innerTop + span * (1 - Math.max(0, Math.min(100, v)) / 100)
        return (
          <g key={key}>
            <line x1={2} x2={10} y1={y} y2={y} stroke={color} strokeWidth={1.5} />
            <text x={12} y={y + 2.5} fill={color} fontSize={SCALE.font.xs - 2} fontWeight={SCALE.weight.bold}>{key}</text>
          </g>
        )
      })}
      {/* the level, sized as a PROCESS VALUE — the most important thing here */}
      <text x={w / 2} y={(bodyTop + h) / 2 + 5} textAnchor="middle" fill={theme.text}
        fontSize={SCALE.font.lg} fontWeight={SCALE.weight.bold}
        stroke={theme.bg} strokeWidth={3} paintOrder="stroke">
        {fmtQ(sim.PV, quality, 0)}
        <tspan fontSize={SCALE.font.sm} fontWeight={SCALE.weight.normal}>{unit || '%'}</tspan>
      </text>
      <text x={w / 2} y={h + 12} textAnchor="middle" fill={theme.text}
        fontSize={SCALE.font.sm} fontWeight={SCALE.weight.medium}
        stroke={theme.bg} strokeWidth={3} paintOrder="stroke">{widget.tag ?? widget.label ?? ''}</text>
    </g>
  )
}
