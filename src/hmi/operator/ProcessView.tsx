// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE PROCESS VIEW.
 *
 * A picture of the plant laid out the way the fluid runs through it, with the
 * solved process state on it. Not a mimic: the mimic draws the P&ID's own
 * geometry, which is routed for drafting rather than for reading a process.
 *
 * EVERYTHING HERE IS READ. The layout comes from `sim/processView.ts`, built
 * once when the run was compiled; every number comes from the store's live
 * maps, which come from the hydraulic solve. This component computes no flow,
 * no pressure and no level, and it writes nothing back to the drawing.
 *
 * The three rules it exists to keep:
 *
 *  1. FLOW DIRECTION IS THE SIGN OF THE SOLVED FLOW, never the direction the
 *     line happens to be drawn. A reversed leg reverses here.
 *  2. NOTHING ANIMATES THAT IS NOT MOVING. A pipe is a pipe; a shut line is
 *     drawn still, and a solve that did not converge is drawn still as well,
 *     because motion on a screen reads as a healthy plant.
 *  3. AN INLINE INSTRUMENT SITS IN ITS RUN. Where a reading is taken is
 *     process information. A transmitter floated off to one side is a number
 *     with no place.
 */

import { useMemo } from 'react'
import { useSimStore } from '../simStore'
import { SHUT_LEAK_MAX } from '../sim/hydraulic/solver'
import { midpointOf } from '../sim/processView'
import type { ProcessViewModel, ViewEdge, ViewInstrument, ViewNode } from '../sim/processView'
import { equipmentState, EQUIP_LABEL } from '../sim/state'
import { QUALITY_GLYPH, hasNumber } from '../sim/quality'
import type { QualityState } from '../sim/quality'
import type { TagDef } from '../sim/tags'
import type { Tags } from '../sim/engine'
import { fmt } from '../widgets/shared'
import { worstByTag } from './summary'

/**
 * The flow below which a line is drawn STILL.
 *
 * `SHUT_LEAK_MAX` is the model's own ceiling on what a blocked element passes —
 * a shut valve and a stopped pump are steep finite conductances, not infinite
 * ones — so a dead line carries a fraction of a millilitre an hour. Animating
 * that would put a crawl on every shut line in the plant.
 */
const STILL = SHUT_LEAK_MAX

/** Dash travel time, seconds, from a flow in m³/h. Faster flow, faster dashes,
 *  clamped at both ends so a trickle still reads as moving and a large flow
 *  does not strobe. */
const dashSeconds = (q: number): number => Math.max(0.4, Math.min(3, 12 / Math.abs(q)))

interface Live {
  tags: Tags
  defs: Record<string, TagDef>
  pipeFlows: Record<string, number>
  pipePressures: Record<string, number>
  quality: Record<string, QualityState>
  oos: Record<string, true>
  worst: Map<string, string>
  /** False when the solve did not converge: nothing on screen is a reading. */
  solved: boolean
}

/** The signed flow in a view edge: the flow of the drawn pipe it carries. */
function edgeFlow(e: ViewEdge, live: Live): number {
  for (const p of e.pipeIds) {
    const q = live.pipeFlows[p]
    if (q !== undefined) return q
  }
  return 0
}

/** What an instrument reads, as text: the value with its unit, or dashes when
 *  the quality says there is no number to show. */
function readingText(inst: ViewInstrument, live: Live): { value: string; glyph: string } {
  const q = live.quality[inst.tag]
  const pv = live.tags[inst.tag]?.PV
  const def = live.defs[inst.tag]
  const show = hasNumber(q?.q) && pv !== undefined
  return {
    value: show ? `${fmt(pv, def?.unit === '%' ? 0 : 1)} ${def?.unit ?? ''}`.trim() : '- - -',
    glyph: QUALITY_GLYPH[q?.q ?? 'good'],
  }
}

/** A measurement beside the object it reads. One line, for a vessel or a
 *  device where there is room to the side. */
function Reading({ inst, live }: { inst: ViewInstrument; live: Live }) {
  const { value, glyph } = readingText(inst, live)
  return (
    <>
      <tspan className="pv-tag">{inst.tag}</tspan>
      <tspan className="pv-val" dx="6">{value}</tspan>
      {glyph && <tspan className="pv-q" dx="4">{glyph}</tspan>}
    </>
  )
}

/** Rough width of a string at the reading font size. SVG cannot measure text
 *  before it lays it out, and a chip that is too narrow is worse than one that
 *  is a little wide, so this errs generous. */
const CHIP_CHAR = 5.9
const chipWidth = (s: string) => Math.max(34, s.length * CHIP_CHAR + 10)

/**
 * An inline instrument, drawn ON its run at the point it is installed.
 *
 * As a CHIP — a small opaque plate carrying the tag over its reading — for two
 * reasons. A run between two boxes is short, and a tag and a value written
 * end to end on one line overhangs both of them; and a label that crosses
 * another line is unreadable exactly where an operator most needs to read it.
 * Two stacked lines halve the width, and the plate makes it legible over
 * whatever it happens to cross.
 *
 * The stem is what makes it an INLINE instrument rather than a caption: it is
 * visibly attached to the pipe it reads.
 */
const CHIP_H = 26
function InlineInstruments({ edge, live }: { edge: ViewEdge; live: Live }) {
  if (edge.instruments.length === 0) return null
  const mid = midpointOf(edge.points)
  const STEM = 10
  return (
    <g className="pv-inline" data-testid="pv-inline" data-edge={edge.id}>
      <line x1={mid.x} y1={mid.y} x2={mid.x} y2={mid.y - STEM} className="pv-tap" />
      {edge.instruments.map((inst, i) => {
        const { value, glyph } = readingText(inst, live)
        const w = Math.max(chipWidth(inst.tag), chipWidth(value + glyph))
        const top = mid.y - STEM - CHIP_H - i * (CHIP_H + 3)
        return (
          <g key={inst.tag} data-testid="pv-instrument" data-tag={inst.tag}>
            <rect x={mid.x - w / 2} y={top} width={w} height={CHIP_H} rx={3} className="pv-chip" />
            <text x={mid.x} y={top + 11} textAnchor="middle" className="pv-reading">
              <tspan className="pv-tag">{inst.tag}</tspan>
            </text>
            <text x={mid.x} y={top + 22} textAnchor="middle" className="pv-reading">
              <tspan className="pv-val">{value}</tspan>
              {glyph && <tspan className="pv-q" dx="3">{glyph}</tspan>}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * One process line.
 *
 * Drawn once as a static pipe, and a second time as a moving overlay ONLY when
 * the solve says something is passing through it. The overlay runs backwards
 * when the flow is negative, which is the whole point of carrying a sign.
 */
function Edge({ edge, live }: { edge: ViewEdge; live: Live }) {
  const q = edgeFlow(edge, live)
  const moving = live.solved && Math.abs(q) > STILL
  const d = edge.points.map((p) => `${p.x},${p.y}`).join(' ')
  const mid = midpointOf(edge.points)
  // arrowhead orientation: along the polyline when positive, against it when
  // the solved flow is negative
  const seg = edge.points.length >= 2
    ? (q < 0 ? [edge.points[1]!, edge.points[0]!] : [edge.points[edge.points.length - 2]!, edge.points[edge.points.length - 1]!])
    : undefined
  const angle = seg ? (Math.atan2(seg[1]!.y - seg[0]!.y, seg[1]!.x - seg[0]!.x) * 180) / Math.PI : 0
  return (
    <g className="pv-edge" data-testid="pv-edge" data-edge={edge.id}
      data-pipes={edge.pipeIds.join(' ')}
      data-flowing={moving ? 1 : 0}
      data-direction={!moving ? 'still' : q < 0 ? 'reverse' : 'forward'}>
      <polyline points={d} className="pv-pipe" fill="none" />
      {moving && (
        <polyline points={d} className="pv-pipe pv-flowing hmi-flow" fill="none"
          style={{
            animationDuration: `${dashSeconds(q)}s`,
            ...(q < 0 ? { animationDirection: 'reverse' as const } : {}),
          }} />
      )}
      {moving && (
        <g transform={`translate(${mid.x} ${mid.y}) rotate(${angle})`}>
          <path d="M -5 -4 L 4 0 L -5 4 Z" className="pv-arrow" data-testid="pv-arrow" />
        </g>
      )}
      <InlineInstruments edge={edge} live={live} />
    </g>
  )
}

const KIND_WORD: Record<string, string> = {
  boundary: 'BOUNDARY', junction: 'JUNCTION', fitting: 'TEE',
}

/** What a boundary is DOING: supplying the plant, or receiving from it. The
 *  drawing cannot say — the sign of the flow at its one line can. */
function boundaryRole(node: ViewNode, model: ProcessViewModel, live: Live): string {
  const e = model.edges.find((x) => x.from === node.id || x.to === node.id)
  if (!e || !live.solved) return 'BOUNDARY'
  const q = edgeFlow(e, live)
  if (Math.abs(q) <= STILL) return 'BOUNDARY'
  const outward = e.from === node.id ? q > 0 : q < 0
  return outward ? 'SUPPLY' : 'DESTINATION'
}

/** One object. A box with its tag, its state and the value that matters for
 *  what it is. */
function Node({ node, model, live, onOpen }: {
  node: ViewNode; model: ProcessViewModel; live: Live; onOpen(tag: string): void
}) {
  const t = node.tag ? live.tags[node.tag] : undefined
  const def = node.tag ? live.defs[node.tag] : undefined
  const state = node.tag && (node.kind === 'pump' || node.kind === 'heater')
    ? equipmentState(t, { oos: live.oos[node.tag] === true })
    : undefined
  // A device's own edge carries no drawn pipe, and the store publishes flow per
  // PIPE, so what a valve is passing is read off the runs at its faces. The
  // first run that is actually moving answers; a device between two dead runs
  // reports zero rather than nothing, because zero is the true answer there.
  const throughFlow = useMemo(() => {
    if (!node.edgeId) return undefined
    const touching = model.edges.filter((e) => e.from === node.id || e.to === node.id)
    for (const e of touching) {
      const q = edgeFlow(e, live)
      if (Math.abs(q) > STILL) return Math.abs(q)
    }
    return touching.length > 0 ? 0 : undefined
  }, [node, model, live])

  const lines: string[] = []
  if (node.kind === 'valve') {
    const pos = t?.POS ?? t?.OP ?? ((t?.OPEN ?? 0) >= 0.5 ? 100 : 0)
    lines.push(`POS ${fmt(pos, 0)} %`)
    // position and flow, side by side and never conflated: a valve at 100 %
    // does not mean 100 % flow, and the hydraulic solve is what decides
    if (throughFlow !== undefined) lines.push(`${fmt(throughFlow)} m³/h`)
  } else if (node.kind === 'pump') {
    if (t?.RAMP !== undefined) lines.push(`SPEED ${fmt(t.RAMP * 100, 0)} %`)
    if (throughFlow !== undefined) lines.push(`${fmt(throughFlow)} m³/h`)
  } else if (node.kind === 'vessel' && node.tag) {
    const pct = t?.PV
    const cap = def?.capacity
    if (pct !== undefined) lines.push(`${fmt(pct, 1)} %`)
    if (t?.V !== undefined && cap !== undefined) lines.push(`${fmt(t.V)} / ${fmt(cap, 0)} m³`)
    if (t?.T !== undefined) lines.push(`${fmt(t.T, 1)} °C`)
  } else if (node.kind === 'heater') {
    if (t?.OP !== undefined) lines.push(`DUTY ${fmt(t.OP, 0)} %`)
  }

  const level = node.kind === 'vessel' ? Math.max(0, Math.min(100, t?.PV ?? 0)) : 0
  const body = (
    <>
      {node.kind === 'fitting' || node.kind === 'junction'
        ? <circle cx={node.w / 2} cy={node.h / 2} r={node.w / 2 - 2} className="pv-box" />
        : <rect x={0} y={0} width={node.w} height={node.h} rx={4} className="pv-box" />}
      {node.kind === 'vessel' && (
        // the liquid is drawn from the INVENTORY-derived level and nothing
        // else: no independent animation, no easing towards a target
        <rect x={1} y={1 + ((100 - level) / 100) * (node.h - 2)} width={node.w - 2}
          height={(level / 100) * (node.h - 2)} className="pv-liquid" data-testid="pv-liquid" />
      )}
      {/* a fitting is too small to carry a tag inside it, so the tag sits
          under it — still attached, and legible */}
      {node.tag
        ? <text x={node.w / 2} y={node.kind === 'fitting' || node.kind === 'junction' ? node.h + 11 : 14}
            textAnchor="middle" className="pv-tag">{node.tag}</text>
        : <text x={node.w / 2} y={node.h / 2 + 4} textAnchor="middle" className="pv-term">
            {node.kind === 'boundary' ? boundaryRole(node, model, live) : (KIND_WORD[node.kind] ?? '')}
          </text>}
      {lines.map((l, i) => (
        <text key={i} x={node.w / 2} y={28 + i * 12} textAnchor="middle" className="pv-val">{l}</text>
      ))}
      {state && <text x={node.w / 2} y={node.h - 5} textAnchor="middle" className="pv-state">{EQUIP_LABEL[state]}</text>}
      {node.instruments.map((inst, i) => (
        <text key={inst.tag} x={node.w / 2} y={node.h + 13 + i * 13} textAnchor="middle"
          className="pv-reading" data-testid="pv-instrument" data-tag={inst.tag}>
          <Reading inst={inst} live={live} />
        </text>
      ))}
      {node.controllers.map((c, i) => (
        <text key={c} x={node.w / 2} y={node.h + 13 + (node.instruments.length + i) * 13}
          textAnchor="middle" className="pv-reading" data-testid="pv-controller" data-tag={c}>
          <tspan className="pv-tag">{c}</tspan>
          <tspan className="pv-val" dx="6">
            {(live.tags[c]?.MODE ?? 1) >= 0.5 ? 'AUTO' : 'MAN'} SP {fmt(live.tags[c]?.SP ?? 0, 1)}
          </tspan>
        </text>
      ))}
    </>
  )

  const q = node.tag ? live.quality[node.tag]?.q : undefined
  const attrs = {
    'data-testid': 'pv-node',
    'data-kind': node.kind,
    ...(node.tag ? { 'data-tag': node.tag } : {}),
    ...(state ? { 'data-state': state } : {}),
    ...(q && q !== 'good' ? { 'data-quality': q } : {}),
    ...(node.tag && live.worst.get(node.tag) ? { 'data-alarm': live.worst.get(node.tag) } : {}),
  }
  return node.tag ? (
    <g className="pv-node" transform={`translate(${node.x} ${node.y})`} {...attrs}
      role="button" tabIndex={0} aria-label={`${node.tag} faceplate`}
      onClick={() => onOpen(node.tag!)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(node.tag!) } }}>
      {body}
    </g>
  ) : (
    <g className="pv-node term" transform={`translate(${node.x} ${node.y})`} {...attrs}>{body}</g>
  )
}

/**
 * THE PAGE.
 *
 * `onOpen` hands a TAG back — the canonical engineering identity — so the
 * faceplate this opens is the same faceplate every other surface opens. No
 * runtime object here has an identity of its own.
 */
export default function ProcessView({ onOpen }: { onOpen(tag: string): void }) {
  const model = useSimStore((s) => s.processView)
  const tags = useSimStore((s) => s.tags)
  const defs = useSimStore((s) => s.defs)
  const pipeFlows = useSimStore((s) => s.pipeFlows)
  const pipePressures = useSimStore((s) => s.pipePressures)
  const quality = useSimStore((s) => s.quality)
  const oos = useSimStore((s) => s.oos)
  const alarms = useSimStore((s) => s.alarms)
  const hyd = useSimStore((s) => s.hydraulic)

  const worst = useMemo(() => worstByTag(alarms), [alarms])
  const live: Live = { tags, defs, pipeFlows, pipePressures, quality, oos, worst, solved: hyd.converged }

  if (!model || model.nodes.length === 0) {
    return (
      <div className="op-page" data-testid="op-process-view">
        <p className="op-empty">Nothing on this project connects into a process route yet.</p>
      </div>
    )
  }
  return (
    <div className="op-page pv-page" data-testid="op-process-view">
      {/* The banners carry the QUALITY glyph, not an alarm colour — see the
          note on `.pv-banner`. What they report is the state of the SOLVE. */}
      {!hyd.converged && (
        <div className="pv-banner" data-testid="pv-unsolved" role="status">
          <span className="pv-banner-glyph" aria-hidden>{QUALITY_GLYPH.bad}</span>
          <span>NO HYDRAULIC SOLUTION — mass is not balanced. Flows and pressures below are not readings.</span>
        </div>
      )}
      {(hyd.cavitating.length > 0 || hyd.undetermined.length > 0) && hyd.converged && (
        <div className="pv-banner" data-testid="pv-degraded" role="status">
          <span className="pv-banner-glyph" aria-hidden>{QUALITY_GLYPH.uncertain}</span>
          <span>
            {hyd.cavitating.length > 0 && 'Suction below absolute zero at some point in this plant. '}
            {hyd.undetermined.length > 0 && 'Part of this plant has no path to a pressure boundary. '}
            Values on the affected objects are marked uncertain.
          </span>
        </div>
      )}
      <svg className="pv-svg" data-testid="pv-svg"
        viewBox={`0 0 ${model.width} ${model.height}`} preserveAspectRatio="xMidYMid meet">
        {model.edges.map((e: ViewEdge) => <Edge key={e.id} edge={e} live={live} />)}
        {model.nodes.map((n: ViewNode) => <Node key={n.id} node={n} model={model} live={live} onOpen={onOpen} />)}
      </svg>
    </div>
  )
}
