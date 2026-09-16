// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * ISA-5.1 SYMBOL PRIMITIVES, DRAWN THE WAY THE EDITOR DRAWS THEM.
 *
 * These are small hand-authored reproductions of the geometry in
 * src/symbols/lib/ — a bubble is a circle with two lines of tag text, a
 * control valve is a bowtie under an actuator, a centrifugal pump is a circle
 * with a tangential discharge. They exist so the homepage can show real
 * linework at any size without shipping a screenshot, and so the marketing
 * page and the product cannot drift into drawing different symbols.
 *
 * They are NOT the product's symbol registry. Importing that would pull the
 * whole catalogue and its renderer into the marketing chunk, which is the one
 * thing the route split at src/main.tsx exists to prevent.
 */

/** An instrument bubble: letters over loop number, per ISA-5.1. */
export function Bubble({ cx, cy, letters, loop, r = 15 }: {
  cx: number
  cy: number
  letters: string
  loop: string
  r?: number
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} className="ink" fill="var(--sheet)" />
      <text className="ink-text" x={cx} y={cy - 1} textAnchor="middle">{letters}</text>
      <text className="ink-text" x={cx} y={cy + 9} textAnchor="middle">{loop}</text>
    </g>
  )
}

/** A bowtie valve body. The shared geometry of every two-port valve. */
function bowtie(cx: number, cy: number, w: number, h: number): string {
  const hw = w / 2
  const hh = h / 2
  return `M${cx - hw} ${cy - hh} L${cx} ${cy} L${cx - hw} ${cy + hh} Z M${cx + hw} ${cy - hh} L${cx} ${cy} L${cx + hw} ${cy + hh} Z`
}

/** A manual gate valve — bowtie, no actuator. */
export function GateValve({ cx, cy, w = 24, h = 18 }: { cx: number; cy: number; w?: number; h?: number }) {
  return <path d={bowtie(cx, cy, w, h)} className="ink" fill="var(--sheet)" />
}

/**
 * A control valve: bowtie body, stem, and a diaphragm actuator.
 * `fail` prints the fail-action mark (FC / FO) the way a P&ID does.
 */
export function ControlValve({ cx, cy, w = 26, h = 19, fail }: {
  cx: number
  cy: number
  w?: number
  h?: number
  fail?: string
}) {
  const stemTop = cy - h / 2 - 11
  return (
    <g>
      <path d={bowtie(cx, cy, w, h)} className="ink" fill="var(--sheet)" />
      <line x1={cx} y1={cy - h / 2} x2={cx} y2={stemTop} className="ink" />
      {/* diaphragm: a half-capsule sitting on the stem */}
      <path d={`M${cx - 10} ${stemTop} a10 7 0 0 1 20 0 Z`} className="ink" fill="var(--sheet)" />
      {fail && <text className="ink-text" x={cx + 15} y={cy + 3}>{fail}</text>}
    </g>
  )
}

/** A centrifugal pump: circle with a tangential discharge nozzle. */
export function Pump({ cx, cy, r = 14 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} className="ink" fill="var(--sheet)" />
      <path d={`M${cx - r} ${cy} L${cx + r * 0.55} ${cy - r * 0.78} L${cx + r * 0.55} ${cy + r * 0.78} Z`} className="ink" fill="none" />
    </g>
  )
}

/** A vertical vessel / tank with dished ends. */
export function Vessel({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={w * 0.22} className="ink" fill="var(--sheet)" />
}

/** An orifice plate flow element: two ticks across the line. */
export function Orifice({ cx, cy, h = 16 }: { cx: number; cy: number; h?: number }) {
  return (
    <g className="ink">
      <line x1={cx - 3} y1={cy - h / 2} x2={cx - 3} y2={cy + h / 2} />
      <line x1={cx + 3} y1={cy - h / 2} x2={cx + 3} y2={cy + h / 2} />
    </g>
  )
}

/** A process line. `flow` turns on the same dash drift the HMI uses for a
 *  line that is actually passing something. */
export function Line({ d, flow, soft }: { d: string; flow?: boolean; soft?: boolean }) {
  return <path d={d} className={`${soft ? 'ink-soft' : 'ink'}${flow ? ' flowline' : ''}`} />
}

/** An instrument signal line — dashed, per ISA-5.1. */
export function Signal({ d }: { d: string }) {
  return <path d={d} className="ink-dash" />
}

/** A tag label set beside a symbol, the way the editor annotates one. */
export function Label({ x, y, children, anchor = 'middle' }: {
  x: number
  y: number
  children: string
  anchor?: 'start' | 'middle' | 'end'
}) {
  return <text className="ink-text" x={x} y={y} textAnchor={anchor}>{children}</text>
}
