// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE PUMP OPERATING ENVELOPE — is this machine being run somewhere the model
 * can stand behind?
 *
 * ── THREE THINGS, KEPT APART ──────────────────────────────────────────────
 *
 *   A. the HYDRAULIC OPERATING POINT — Q, the pressures either side, the head
 *      the curve makes at the shaft speed the drive has reached. The solve
 *      decides all of it, and nothing here touches any of it.
 *   B. the ENGINEERING ENVELOPE — the region the RECORD says the machine may
 *      be run in. Today that is one number, `duty.minFlow`, and most records
 *      do not state it.
 *   C. PROTECTIVE ACTION — what the plant does about a violation.
 *
 * This module reads A, compares it against B, and does **no** C. Nothing here
 * writes a tag, stops a machine or changes a flow. K13 is DETECTION ONLY: a
 * minimum-flow trip is a real piece of plant equipment with a setting and a
 * time delay, and inventing one because real plants usually have one would be
 * exactly the fabrication this programme exists to avoid.
 *
 * ── NO INVENTED LIMITS ────────────────────────────────────────────────────
 *
 * `duty.minFlow` is read and never derived. A fraction of rated capacity is
 * the tempting substitute and it is wrong twice over: the fraction depends on
 * the impeller, and `ratedFlow` itself falls back to `DEFAULTS.pumpFlowM3h`
 * when nobody has specified the machine, so the "limit" would be a percentage
 * of a number the simulator made up. With no limit stated the answer is
 * `LIMIT UNKNOWN`, which is a true statement about what this model knows.
 *
 * ── NO INVENTED THRESHOLDS EITHER ─────────────────────────────────────────
 *
 * "Approximately zero flow" is `SHUT_LEAK_MAX`, the solver's own published
 * ceiling on what a BLOCKED element passes — the constant that exists so a
 * caller can say "nothing is moving" precisely. "Running" is `shaft > 0`,
 * which is the exact test `pumpFlow` itself uses to decide whether the machine
 * makes head or blocks. Both belong to the hydraulic model already.
 *
 * ── SIGNED, THROUGHOUT ────────────────────────────────────────────────────
 *
 * The pump edge runs suction → discharge, so a POSITIVE flow is the machine
 * doing its job and a negative one is fluid coming back through it. No
 * `Math.abs` stands between the solve and the verdict: reverse flow is its own
 * classification, not a small forward flow.
 *
 * Pure, DOM-free, deterministic: the same solve and the same records always
 * give the same envelope.
 */

import type { DiagnosticSeverity } from '../../model/diagnostics'
import type { ProcessModel } from './hydraulic/model'
import type { SolveResult } from './hydraulic/solver'
import { SHUT_LEAK_MAX } from './hydraulic/solver'
import { faultOfNodes } from './engine'
import type { TagDef } from './tags'
import type { ScenarioFinding } from './scenario'

/**
 * WHERE A MACHINE IS BEING RUN, in the vocabulary an operator reads.
 *
 * Ordered by the precedence the derivation applies, worst evidence first. A
 * solve nobody can trust outranks every verdict below it, because all of them
 * are read off that solve.
 */
export type EnvelopeState =
  /** The solve cannot stand behind the numbers — see `faultOfNodes`. */
  | 'UNKNOWN'
  /** The shaft is at rest. There is no operating point to be outside of. */
  | 'STOPPED'
  /** Fluid is coming back through a turning machine. */
  | 'REVERSE FLOW'
  /** Turning, making head, and passing nothing. */
  | 'DEAD-HEAD'
  /** Below the minimum the RECORD states. */
  | 'BELOW MINIMUM FLOW'
  /** Running forward, and the record states no minimum to compare against. */
  | 'LIMIT UNKNOWN'
  /** Running forward, at or above the stated minimum. */
  | 'NORMAL'

/**
 * HOW SERIOUS EACH STATE IS, on the scale `model/diagnostics.ts` already
 * defines — stated ONCE, here, so the faceplate and the diagnostics list
 * cannot colour the same condition differently.
 *
 * `undefined` means it is not a finding at all. A machine at rest, a healthy
 * one, and one whose solve nobody can trust are all things the surrounding
 * surfaces already say better: `STOPPED` is on the state band, and `UNKNOWN`
 * is the hydraulic banner and every measurement's quality flag at once.
 */
export const ENVELOPE_SEVERITY: Record<EnvelopeState, DiagnosticSeverity | undefined> = {
  UNKNOWN: undefined,
  STOPPED: undefined,
  'REVERSE FLOW': 'error',
  'DEAD-HEAD': 'error',
  'BELOW MINIMUM FLOW': 'warning',
  /** NOT a fault. A statement about what this simulator cannot determine. */
  'LIMIT UNKNOWN': 'info',
  NORMAL: undefined,
}

export interface PumpEnvelope {
  tag: string
  state: EnvelopeState
  /** Actual shaft fraction 0..1 — `RAMP`, never the command. */
  shaft: number
  /**
   * SIGNED flow through the machine's own edge, m³/h. Positive is suction →
   * discharge. `undefined` when the tag has no pump edge in the network, which
   * is a drawing with an unconnected machine on it.
   */
  flowM3h?: number
  /** Head across the machine, bar: discharge minus suction. Signed. */
  riseBar?: number
  /** The stated minimum flow, m³/h. Absent means the record states none. */
  minFlowM3h?: number
  /** The speed COMMAND, %, on a VSD machine. */
  speedCommandPct?: number
  /** The stated turndown, %, on a VSD machine. */
  minSpeedPct?: number
  /**
   * True when the speed COMMAND is outside the declared drive envelope while
   * the shaft is held at the nearest end of it. A statement about the command,
   * not about the hydraulics — which is why it sits beside `state` rather than
   * inside it.
   */
  speedOutOfEnvelope: boolean
}

/**
 * A runtime finding, in the shape `scenario.ts` already publishes and the
 * Diagnostics page already renders.
 *
 * Deliberately the SAME type rather than a parallel one with the same fields:
 * there is one runtime-finding shape in this product, and a second would be
 * how two lists that have to agree start to drift.
 */
export type EnvelopeFinding = ScenarioFinding

/** Pump tag -> the id of its own edge in the network. Static for a run. */
export function pumpEdgeMap(model: ProcessModel): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of model.edges) {
    if (e.kind !== 'pump' || e.tag === undefined) continue
    // first wins: a tag drawn twice is a duplicate-tag finding elsewhere, and
    // silently averaging two machines would be worse than picking one
    if (!out.has(e.tag)) out.set(e.tag, e.id)
  }
  return out
}

/**
 * Where every pump in the plant is being run, this instant.
 *
 * O(pumps). `edgeOf` is the map above, built once per run by the caller — the
 * topology does not change while the plant is running.
 */
export function pumpEnvelopes(
  model: ProcessModel,
  defs: readonly TagDef[],
  tags: Record<string, Record<string, number>>,
  hyd: SolveResult,
  edgeOf: Map<string, string>,
): Record<string, PumpEnvelope> {
  const out: Record<string, PumpEnvelope> = {}
  for (const d of defs) {
    // a heater is a driven tag and not a pump: it adds heat, makes no head,
    // and has no flow envelope this model can describe
    if (d.kind !== 'motor' || d.heaterKw !== undefined) continue
    const env = envelopeOf(model, d, tags[d.name], hyd, edgeOf.get(d.name))
    if (env) out[d.name] = env
  }
  return out
}

function envelopeOf(
  model: ProcessModel,
  d: TagDef,
  t: Record<string, number> | undefined,
  hyd: SolveResult,
  edgeId: string | undefined,
): PumpEnvelope | undefined {
  if (!t) return undefined

  /**
   * THE SHAFT, not the command. `resolveEquipment` says the same thing for the
   * equipment table and this says it for the envelope; both read `RAMP` and
   * both zero it on a trip, because a tripped machine's breaker is open
   * whatever the drive was last told.
   */
  const shaft = (t.FAULT ?? 0) >= 0.5 ? 0 : (t.RAMP ?? ((t.RUN ?? 0) >= 0.5 ? 1 : 0))

  const base = {
    tag: d.name,
    shaft,
    ...(d.minFlowM3h !== undefined ? { minFlowM3h: d.minFlowM3h } : {}),
    ...(t.SPD !== undefined ? { speedCommandPct: t.SPD } : {}),
    ...(d.minSpeedPct !== undefined ? { minSpeedPct: d.minSpeedPct } : {}),
    speedOutOfEnvelope: speedOutside(t, d),
  }

  const edge = edgeId === undefined ? undefined : model.edges.find((e) => e.id === edgeId)
  if (!edge) {
    // A machine with no edge is not connected to anything this model solves.
    // Stopped is still stopped; running, there is nothing to say about it.
    return { ...base, state: shaft > 0 ? 'UNKNOWN' : 'STOPPED' }
  }

  const flowM3h = hyd.flow[edge.id]
  const pFrom = hyd.pressure[edge.from]
  const pTo = hyd.pressure[edge.to]
  const riseBar = pFrom !== undefined && pTo !== undefined ? pTo - pFrom : undefined
  const full = {
    ...base,
    ...(flowM3h !== undefined ? { flowM3h } : {}),
    ...(riseBar !== undefined ? { riseBar } : {}),
  }

  // 1. Can the solve stand behind any of this? Exactly the test a measurement
  //    bound to these nodes would get.
  if (faultOfNodes(hyd, new Set([edge.from, edge.to])) !== undefined || flowM3h === undefined) {
    return { ...full, state: 'UNKNOWN' }
  }
  // 2. A machine at rest is not being operated outside anything.
  if (shaft <= 0) return { ...full, state: 'STOPPED' }
  // 3. Fluid coming BACK through a turning machine. Classified on its own,
  //    because it is a different fault from a small forward flow and taking
  //    the magnitude would hide it completely.
  if (flowM3h < -SHUT_LEAK_MAX) return { ...full, state: 'REVERSE FLOW' }
  // 4. Turning, making head, passing nothing. Detected from the SOLVED flow
  //    and the SOLVED head — never from "a valve downstream is shut", which is
  //    a cause and not the condition.
  if (flowM3h <= SHUT_LEAK_MAX && (riseBar ?? 0) > 0) return { ...full, state: 'DEAD-HEAD' }
  // 5. Against the record's own limit, if the record states one.
  if (d.minFlowM3h === undefined) return { ...full, state: 'LIMIT UNKNOWN' }
  return { ...full, state: flowM3h < d.minFlowM3h ? 'BELOW MINIMUM FLOW' : 'NORMAL' }
}

/**
 * Is the SPEED COMMAND outside the drive envelope the record declares?
 *
 * K12 clamps the shaft to the turndown and leaves `SPD` reading what was
 * actually asked, precisely so the clamp is visible rather than silent. This
 * is the thing that sees it. A machine with no drive has no `SPD` to be
 * outside anything, and an unreadable command is not a violation — it is
 * ignored, and K12's tests pin that.
 */
function speedOutside(t: Record<string, number>, d: TagDef): boolean {
  if (d.vsd !== true) return false
  const asked = t.SPD
  if (asked === undefined || !Number.isFinite(asked)) return false
  if (asked > 100) return true
  return d.minSpeedPct !== undefined && Number.isFinite(d.minSpeedPct) && asked < d.minSpeedPct
}

/** One decimal for a flow, the way the faceplate and the trend already say it. */
const q = (v: number): string => `${v.toFixed(1)} m³/h`

/**
 * THE ENVELOPE, SAID OUT LOUD — through the existing diagnostics architecture
 * rather than beside it.
 *
 * Severity uses the scale `model/diagnostics.ts` already defines, and the
 * question it answers is the one that scale asks: can the running plant work?
 *
 *   `error`   — dead-head and reverse flow. The machine is turning and the
 *               plant is not getting what the operator believes it is.
 *   `warning` — below the stated minimum, and a speed command the drive is
 *               refusing to follow. Running, delivering, and not somewhere it
 *               should be left.
 *   `info`    — no limit on the record. Not a fault at all: a statement about
 *               what this simulator cannot determine, which is the honest
 *               alternative to a verdict it has no data for.
 *
 * `STOPPED`, `NORMAL` and `UNKNOWN` produce nothing. A machine at rest is not
 * a finding, a healthy one is not a finding, and an unconverged solve is
 * already reported by the hydraulic status banner and by every measurement's
 * quality — saying it a third time here would be three rows for one problem.
 */
export function envelopeFindings(
  envelopes: Record<string, PumpEnvelope>,
): EnvelopeFinding[] {
  const out: EnvelopeFinding[] = []
  // sorted so the list is stable whatever order the tags were built in
  for (const e of Object.values(envelopes).sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true }))) {
    const add = (id: string, severity: DiagnosticSeverity, message: string) =>
      out.push({ id: `envelope:${e.tag}:${id}`, tag: e.tag, severity, message })

    if (e.speedOutOfEnvelope && e.speedCommandPct !== undefined) {
      const held = e.speedCommandPct > 100 ? 100 : e.minSpeedPct
      add('pump-speed-out-of-envelope', 'warning',
        `is commanded to ${e.speedCommandPct.toFixed(0)} % speed, outside the drive envelope its record declares`
        + `${e.minSpeedPct !== undefined ? ` (minimum ${e.minSpeedPct.toFixed(0)} %)` : ''}. `
        + `The drive is holding the shaft at ${held !== undefined ? `${held.toFixed(0)} %` : 'the nearest end of it'}.`)
    }

    const sev = ENVELOPE_SEVERITY[e.state]
    switch (e.state) {
      case 'DEAD-HEAD':
        add('pump-deadhead', sev ?? 'error',
          `is dead-headed. Running at ${(e.shaft * 100).toFixed(0)} % speed and making `
          + `${(e.riseBar ?? 0).toFixed(2)} bar of head, with nothing passing through it. `
          + `Source: solved hydraulic operating point.`)
        break
      case 'REVERSE FLOW':
        add('pump-reverse-flow', sev ?? 'error',
          `has reverse flow. ${q(Math.abs(e.flowM3h ?? 0))} is coming back through the machine `
          + `while it turns at ${(e.shaft * 100).toFixed(0)} % speed: the discharge is being held `
          + `above the head the pump can make. Source: solved hydraulic operating point.`)
        break
      case 'BELOW MINIMUM FLOW':
        add('pump-below-min-flow', sev ?? 'warning',
          `is below minimum flow. Actual ${q(e.flowM3h ?? 0)}, minimum ${q(e.minFlowM3h ?? 0)}. `
          + `Source: engineering record.`)
        break
      case 'LIMIT UNKNOWN':
        add('pump-min-flow-unknown', sev ?? 'info',
          `minimum-flow limit unavailable. The simulator cannot determine whether `
          + `${q(e.flowM3h ?? 0)} is below the manufacturer's minimum; no "Minimum flow" is stated `
          + `on its record.`)
        break
      default:
        break
    }
  }
  return out
}
