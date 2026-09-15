// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE HYDRAULIC SOLVE — pressure and flow, together.
 *
 * ── WHAT THIS REPLACES, AND WHY ───────────────────────────────────────────
 *
 * The previous solver decided flow first and painted pressure on afterwards:
 *
 *     Q = pump rating × speed × ∏(valve fraction)      then     P = f(Q)
 *
 * Three consequences that no amount of tuning fixes. Flow was LINEAR in valve
 * position, which is not what a valve does. Junctions never balanced, because
 * each source-to-destination path was solved on its own and a tee was two
 * unrelated paths. And pressure could not cause anything, because it was
 * computed after the thing it was supposed to cause.
 *
 * Here the arrow runs the right way:
 *
 *     valve position → resistance → pressure field → flow → inventory
 *
 * ── THE MODEL ─────────────────────────────────────────────────────────────
 *
 * A nodal network. Every node has a pressure; every edge carries a flow
 * determined by the pressures at its ends.
 *
 *   resistive edge   ΔP = R · Q|Q|        ⇒  Q = sign(ΔP)·√(|ΔP| / R)
 *   pump edge        ΔP = −H(Q)           ⇒  Q from the pump curve
 *   vessel node      P = P_atm + ρgh      fixed for the instant by its level
 *   boundary node    P = P_supply         fixed
 *
 * `R` is quadratic because turbulent pipe loss is quadratic. A valve's `R`
 * comes from its position every tick — that single fact is the coupling the
 * old model lacked.
 *
 * Unknowns are the pressures at junction nodes. The residual at each is mass
 * balance:
 *
 *     Σ Q_in − Σ Q_out = 0
 *
 * which is solved by damped Newton–Raphson with a numerical Jacobian. The
 * networks here are tens of nodes, so a dense solve is far cheaper than the
 * bookkeeping to avoid one, and it is easy to reason about.
 *
 * ── THE ONE NUMERICAL COMPROMISE, STATED ──────────────────────────────────
 *
 * `Q = √(ΔP/R)` has infinite slope at ΔP = 0, which Newton cannot use. Below
 * `LINEAR_DP` the relationship is replaced by the straight line through the
 * origin that meets the square root at that point, so the derivative stays
 * finite and the two agree where they meet. This is the standard treatment in
 * pipe-network solvers, it only alters behaviour in the last thousandth of a
 * bar, and it is why a "closed" system settles at exactly zero rather than
 * oscillating around it.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * One incompressible fluid at one density. No vapour, no phase change, no
 * compressibility, no elevation except a vessel's own liquid head, no
 * transient acoustics — the solve is quasi-steady, re-run each tick against
 * the current inventories and positions. Those are the model's limits and it
 * does not pretend otherwise; when it cannot answer, it says so rather than
 * returning a plausible number.
 *
 * Pure, DOM-free and deterministic: same inputs, same output, every time.
 */

import type { ProcessEdge, ProcessModel } from './model'
import { valveResistance } from './model'
import { DEFAULTS } from '../units'

/**
 * Below this pressure difference an edge is treated as linear. bar.
 *
 * Comfortably wider than the Jacobian's perturbation `h` below, and that is
 * not a coincidence: when the two were equal, every numerical derivative was
 * taken straight across the kink where the linear piece meets the square root,
 * and a network with a shut valve in it would not converge. A ten-thousandth
 * of a bar is far below anything an instrument in this model can read.
 */
const LINEAR_DP = 1e-4
/**
 * How close to its shutoff point a pump's curve is treated as linear, as a
 * fraction of shutoff head.
 *
 * Same reason as `LINEAR_DP`: `√` has infinite slope where it meets zero, and
 * shutoff is exactly where a pump sits when the path in front of it is shut —
 * so it is the one operating point the solver is guaranteed to have to land
 * on. Without this the network converged to the right answer and the residual
 * never fell, because the Jacobian at that point is unbounded.
 */
const PUMP_EPS = 1e-4

/** Newton iteration limits. Small networks converge in a handful. */
const MAX_ITER = 250
/**
 * A flow below this is reported as exactly zero, m³/h.
 *
 * The linearisation near ΔP = 0 leaves a residue of order 1e-12 on a line that
 * is genuinely shut. That is not a flow — it is a millionth of a millilitre an
 * hour — and left in place it makes a dead pipe animate and "nothing is
 * moving" impossible to state. Snapping it is what lets zero mean zero.
 */
export const ZERO_FLOW = 1e-9

/** Mass-balance residual that counts as converged, m³/h. */
export const MASS_TOL = 1e-7
/** Smallest line-search factor tried before the solve declares failure. */
const MIN_LAMBDA = 1 / 1024
/** Armijo slack: a step must reduce the residual norm by at least this
 *  fraction of λ to be accepted. Small, because the square-root law makes
 *  early steps modest. */
const ARMIJO = 1e-4
/** Jacobian perturbation, bar. Well inside LINEAR_DP and PUMP_EPS, so a
 *  derivative is never taken across the kink where a linearised piece meets
 *  its square root. */
const JAC_H = 1e-6

export interface SolveInputs {
  /** Valve opening 0..1 for a tag. 0 shuts the path. */
  valveOpen(tag: string): number
  /** Pump shaft fraction 0..1. 0 means no head at all. */
  pumpSpeed(tag: string): number
  /** Pump rated flow, m³/h at full speed. */
  pumpRated(tag: string): number
  /** Pump shutoff head, bar at full speed. */
  pumpHead(tag: string): number
  /** Vessel level, %. Sets the pressure at its bottom nozzles. */
  vesselLevel(tag: string): number
  /** Extra resistance multiplier on a drawn pipe — the plugged-line scenario.
   *  1 is unrestricted. */
  pipeFactor?(pipeId: string): number
}

/**
 * Per-iteration diagnostics. Requested explicitly by a test or a debug path
 * and NEVER allocated by a production solve — `solveHydraulics` only writes
 * here when a caller hands it a sink.
 */
export interface SolveTrace {
  iteration: number
  /** L-infinity residual before this step, m³/h. */
  worst: number
  /** L2 residual norm before this step. */
  norm: number
  /** Which free node carries `worst`. */
  worstNode: string
  /** L-infinity Newton step before damping, bar. */
  stepNorm: number
  /** Line-search factor actually accepted. */
  lambda: number
  /** Candidate steps rejected by the line search at this iteration. */
  rejected: number
  /** Node pressures after the accepted step, bar. */
  pressure: Record<string, number>
  /** Edge flows after the accepted step, m³/h. */
  flow: Record<string, number>
  /** Edges whose flow sign differs from the previous iteration. */
  reversed: string[]
  /** True when the dense solve reported a singular Jacobian. */
  singular: boolean
}

export interface SolveResult {
  /** Node id -> pressure, bar. */
  pressure: Record<string, number>
  /** Edge id -> flow, m³/h. SIGNED: positive runs `from` → `to`. */
  flow: Record<string, number>
  /** Drawn pipe id -> signed flow, for the operator screen. */
  pipeFlow: Record<string, number>
  /** True when Newton reached `MASS_TOL`. False means the numbers below are
   *  the best available and the caller must present them as uncertain rather
   *  than as a reading. */
  converged: boolean
  iterations: number
  /** Worst mass-balance residual at any junction, m³/h. */
  residual: number
  /** The free node carrying the worst residual, for an honest failure report. */
  worstNode?: string
  /** Why the solve stopped, when it did not converge. */
  reason?: 'max-iterations' | 'singular-jacobian' | 'line-search-stalled' | 'no-free-nodes'
  /**
   * Nodes the solve put BELOW absolute zero, which this model cannot
   * represent: real liquid cavitates there.
   *
   * Reported rather than clamped. Clamping was the bug this phase fixed — it
   * removed the root and made a branched network unsolvable — and quietly
   * returning a negative absolute pressure would be just as dishonest in the
   * other direction. A caller must present these as INVALID rather than as a
   * reading; the surrounding flows are the mathematical answer to the network
   * as posed, and the network as posed asks for more suction than exists.
   */
  cavitating: string[]
  /** Nodes with no path to any boundary or vessel. Their pressure level is
   *  undetermined by the network, so they are held at the supply pressure and
   *  named here rather than being allowed to make the whole solve singular. */
  undetermined: string[]
  /** Filled only when the caller asked for it. */
  trace?: SolveTrace[]
}

/** Static head a vessel's contents put on a bottom nozzle, bar. */
export const vesselHeadBar = (levelPct: number): number =>
  (Math.max(0, Math.min(100, levelPct)) / 100) * DEFAULTS.tankFullHeadBar

/**
 * Head a pump delivers at a flow, bar.
 *
 * A quadratic characteristic falling from shutoff head at no flow to zero head
 * at RUNOUT, scaled by the affinity laws — head as speed², capacity as speed.
 * The SHAPE of a centrifugal curve, which is all the model claims.
 *
 * `duty.head` is read as the head AT THE RATED FLOW, which is what a pump
 * datasheet states, and runout sits at `RUNOUT_FACTOR` times that flow. Both
 * are load-bearing. An earlier version read `duty.head` as shutoff and put
 * runout AT the rated flow, which makes the rated flow unreachable by
 * construction: the machine makes no head there, so it could only deliver it
 * into a path with no resistance at all. A 50 m³/h pump could never move
 * 50 m³/h. Beyond runout the
 * head goes negative, which is correct: the machine resists flow being pushed
 * through it faster than it can deliver.
 */
export const RUNOUT_FACTOR = 1.5

/** Shutoff head implied by a stated duty point, bar. `duty.head` on a pump
 *  datasheet is the head AT the rated flow; the curve through that point and
 *  out to runout starts here. */
export const shutoffFromDuty = (headAtRated: number): number =>
  headAtRated / (1 - 1 / RUNOUT_FACTOR ** 2)

export function pumpHead(headAtRated: number, ratedFlow: number, speed: number, flow: number): number {
  const r = Math.max(0, Math.min(1, speed))
  if (r <= 0) return 0
  const shutoff = shutoffFromDuty(headAtRated) * r * r
  const runout = Math.max(1e-6, ratedFlow * RUNOUT_FACTOR * r)
  return shutoff * (1 - (flow / runout) ** 2)
}

/**
 * Flow through a resistive edge for a given pressure difference.
 *
 * `ΔP = R·Q|Q|` inverted, with the linearisation above near zero. An infinite
 * resistance — a shut valve — carries nothing, which is how a closed valve
 * blocks flow in this model rather than by a separate rule.
 */
function resistiveFlow(dp: number, r: number): number {
  // An infinite resistance is a shut path and carries nothing. A zero or
  // negative one is not physical; the floor keeps the square root finite
  // rather than letting a modelling slip become an infinite flow.
  if (!Number.isFinite(r)) return 0
  if (r <= 0) r = 1e-9
  const a = Math.abs(dp)
  if (a < LINEAR_DP) {
    // the straight line through the origin meeting √ at LINEAR_DP
    const slope = Math.sqrt(LINEAR_DP / r) / LINEAR_DP
    return dp * slope
  }
  return Math.sign(dp) * Math.sqrt(a / r)
}

/**
 * Flow through a pump edge for a given pressure difference.
 *
 * The pump raises pressure, so the balance is `P_to − P_from = H(Q)`. With the
 * quadratic curve that inverts in closed form:
 *
 *     rise = H0·r²·(1 − (Q/Qr·r)²)   ⇒   Q = Qr·r·√(1 − rise/(H0·r²))
 *
 * Beyond shutoff the branch continues NEGATIVE rather than stopping at zero,
 * because a centrifugal pump asked to hold more head than it has does not sit
 * there — the fluid pushes back through it. That is physically right, and it
 * is also what makes the root unique: an earlier version clamped to zero above
 * shutoff, which gave the solver a flat plateau of equally valid answers, and
 * Newton settled wherever it happened to land. A shut valve then reported a
 * discharge pressure of 5.6 bar on a 4 bar pump.
 */
function pumpFlow(dp: number, e: ProcessEdge, s: SolveInputs): number {
  const tag = e.tag
  if (!tag) return 0
  const speed = Math.max(0, Math.min(1, s.pumpSpeed(tag)))
  // A STOPPED PUMP BLOCKS. A pumped system carries a check valve on the
  // discharge — it is there to stop the machine spinning backwards when it
  // trips — and this model assumes one rather than modelling it separately.
  // Without that assumption a vessel siphons out through an idle pump the
  // moment it has any head, which is not what a plant does and is not what
  // the calm-start doctrine promises the operator.
  if (speed <= 0) return 0
  const h0 = shutoffFromDuty(Math.max(1e-9, s.pumpHead(tag))) * speed * speed
  const qr = Math.max(1e-9, s.pumpRated(tag)) * RUNOUT_FACTOR * speed
  // `dp` is P_from − P_to, so the rise the network demands of the pump is −dp.
  const rise = -dp
  const ratio = 1 - rise / h0
  // `√|ratio|`, linearised through the origin so the derivative stays finite
  // at shutoff. The two pieces meet at PUMP_EPS, where the line's slope is
  // 1/√ε, so the curve is continuous and monotone everywhere.
  const shape = Math.abs(ratio) < PUMP_EPS
    ? ratio / Math.sqrt(PUMP_EPS)
    : Math.sign(ratio) * Math.sqrt(Math.abs(ratio))
  return qr * shape
}

/** Flow through one edge given the pressures at its ends. */
function edgeFlow(e: ProcessEdge, pFrom: number, pTo: number, s: SolveInputs): number {
  const dp = pFrom - pTo
  if (e.kind === 'pump') return pumpFlow(dp, e, s)
  let r = e.resistance
  if (e.kind === 'valve' && e.tag) r = valveResistance(s.valveOpen(e.tag))
  if (s.pipeFactor) for (const id of e.pipeIds) {
    const f = Math.max(0, Math.min(1, s.pipeFactor(id)))
    // A restriction multiplies resistance: a quarter of the opening is
    // sixteen times the resistance, the same law the valve uses.
    r = f <= 1e-3 ? Number.POSITIVE_INFINITY : r / f ** 4
  }
  return resistiveFlow(dp, r)
}

/**
 * Solve the network for the pressures and flows its current state implies.
 *
 * Quasi-steady: called once per tick with the inventories and positions as
 * they stand, and it answers what is flowing NOW. The dynamics live in what
 * those flows then do to the inventories, which is `engine.ts`'s job.
 */
export interface SolveOptions {
  /** Collect per-iteration diagnostics. Test and debug paths only. */
  trace?: boolean
  /** A previous converged pressure field to start from. Ignored when the node
   *  set does not match, so it can never change the answer — only how quickly it
   *  gets there. */
  warmStart?: Record<string, number>
}

export function solveHydraulics(model: ProcessModel, s: SolveInputs, opts: SolveOptions = {}): SolveResult {
  const n = model.nodes.length
  const pressure = new Float64Array(n)
  const fixed = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    const node = model.nodes[i]!
    if (node.kind === 'vessel') {
      // A bottom nozzle sees the liquid head; a top one sees the vapour space,
      // which this model holds at the supply boundary pressure.
      pressure[i] = node.liquid
        ? DEFAULTS.supplyPressureBar + vesselHeadBar(s.vesselLevel(node.tag ?? ''))
        : DEFAULTS.supplyPressureBar
      fixed[i] = 1
    } else if (node.kind === 'boundary') {
      pressure[i] = node.pressureBar ?? DEFAULTS.supplyPressureBar
      fixed[i] = 1
    } else {
      /**
       * INITIAL GUESS.
       *
       * Cold: every free node at the supply pressure. Deterministic, and close
       * enough that a series network converges in a handful of steps.
       *
       * Warm: a previous CONVERGED pressure field, used only when it names
       * this node — a field from a different topology is ignored outright
       * rather than partially applied, so a warm start can change how quickly
       * the solve gets there and never where it arrives. A test pins that the
       * warm and cold answers agree.
       */
      const warm = opts.warmStart?.[node.id]
      pressure[i] = warm !== undefined && Number.isFinite(warm) ? warm : DEFAULTS.supplyPressureBar
    }
  }

  const edgeFrom = model.edges.map((e) => model.indexOf.get(e.from) ?? -1)
  const edgeTo = model.edges.map((e) => model.indexOf.get(e.to) ?? -1)

  /**
   * FREEZE THE UNDETERMINED.
   *
   * A free node with no path to any fixed node has no pressure LEVEL: every
   * pressure field that satisfies its mass balance is equally valid, shifted
   * by a constant, and the Jacobian for that block is singular. One such
   * subgraph — an unpiped stub, a fragment of an import — made the whole
   * refinery sample fail at iteration zero with a singular Jacobian, taking
   * nineteen perfectly determined nodes down with it.
   *
   * So they are frozen at the supply pressure and removed from the unknowns.
   * Their edges then carry whatever their own difference implies, which for an
   * isolated fragment is nothing, and the determined part of the plant solves
   * normally. Connectivity here ignores resistance on purpose: a node reached
   * only through a SHUT valve is still determined, and its balance is met by
   * carrying zero.
   *
   * `undetermined` is reported, because a fragment that cannot have a pressure
   * is a topology problem and not a solver one.
   */
  const reached = new Uint8Array(n)
  const queue: number[] = []
  for (let i = 0; i < n; i++) if (fixed[i]) { reached[i] = 1; queue.push(i) }
  const incident = new Map<number, number[]>()
  for (let k = 0; k < model.edges.length; k++) {
    for (const v of [edgeFrom[k]!, edgeTo[k]!]) {
      if (v < 0) continue
      incident.set(v, [...(incident.get(v) ?? []), k])
    }
  }
  while (queue.length > 0) {
    const v = queue.pop()!
    for (const k of incident.get(v) ?? []) {
      const other = edgeFrom[k]! === v ? edgeTo[k]! : edgeFrom[k]!
      if (other < 0 || reached[other]) continue
      reached[other] = 1
      queue.push(other)
    }
  }
  const undetermined: string[] = []
  for (let i = 0; i < n; i++) {
    if (fixed[i] || reached[i]) continue
    fixed[i] = 1
    pressure[i] = DEFAULTS.supplyPressureBar
    undetermined.push(model.nodes[i]!.id)
  }

  const free: number[] = []
  for (let i = 0; i < n; i++) if (!fixed[i]) free.push(i)

  /** Mass-balance residual at every free node, m³/h. */
  const residuals = (p: Float64Array): Float64Array => {
    const r = new Float64Array(free.length)
    const byNode = new Float64Array(n)
    for (let k = 0; k < model.edges.length; k++) {
      const a = edgeFrom[k]!, b = edgeTo[k]!
      if (a < 0 || b < 0) continue
      const q = edgeFlow(model.edges[k]!, p[a]!, p[b]!, s)
      if (!Number.isFinite(q)) continue
      byNode[a]! -= q
      byNode[b]! += q
    }
    for (let i = 0; i < free.length; i++) r[i] = byNode[free[i]!]!
    return r
  }

  // ── Newton with a backtracking line search ────────────────────────────
  //
  // THE BUG THIS REPLACED. The previous loop clamped every iterate into
  // [0, 64] bar. That is not a Newton safeguard, it is a truncation of the
  // search space, and on a branched network it removed the root: two legs of a
  // tee draw more than one leg, the suction pipe needs more than the boundary
  // pressure to deliver it, the true suction pressure is therefore BELOW the
  // supply, and the clamp pinned the iterate at zero where no step could
  // improve the residual. The solve sat at a residual of 8.25 for 250
  // iterations. A sub-atmospheric suction is a real operating condition — it
  // is what NPSH is about — and the solver has to be allowed to find it.
  //
  // In its place: accept a step only if it reduces the residual norm, and
  // otherwise halve it. That is the standard Armijo-style safeguard, it cannot
  // remove a root, and it makes divergence visible instead of silent.
  let iterations = 0
  let worst = Infinity
  let worstNode = ''
  let reason: SolveResult['reason'] | undefined
  const trace: SolveTrace[] | undefined = opts.trace ? [] : undefined

  const norm = (r: Float64Array): number => {
    let sum = 0
    for (const v of r) sum += v * v
    return Math.sqrt(sum)
  }
  const worstOf = (r: Float64Array): { value: number; at: number } => {
    let value = 0
    let at = 0
    for (let i = 0; i < r.length; i++) {
      const a = Math.abs(r[i]!)
      if (a > value) { value = a; at = i }
    }
    return { value, at }
  }
  const flowsNow = (p: Float64Array): Record<string, number> => {
    const out: Record<string, number> = {}
    for (let k = 0; k < model.edges.length; k++) {
      const a = edgeFrom[k]!, b = edgeTo[k]!
      out[model.edges[k]!.id] = a < 0 || b < 0 ? 0 : edgeFlow(model.edges[k]!, p[a]!, p[b]!, s)
    }
    return out
  }

  if (free.length === 0) {
    worst = 0
    reason = undefined
  } else {
    const m = free.length
    const J = new Float64Array(m * m)
    const candidate = new Float64Array(n)
    let prevFlow = opts.trace ? flowsNow(pressure) : {}

    for (; iterations < MAX_ITER; iterations++) {
      const r0 = residuals(pressure)
      const w0 = worstOf(r0)
      worst = w0.value
      worstNode = model.nodes[free[w0.at]!]!.id
      if (worst < MASS_TOL) break
      const n0 = norm(r0)

      // Numerical Jacobian. `h` sits well inside every linearised region, so a
      // derivative is never taken across a kink — see LINEAR_DP and PUMP_EPS.
      for (let c = 0; c < m; c++) {
        const idx = free[c]!
        const keep = pressure[idx]!
        pressure[idx] = keep + JAC_H
        const r1 = residuals(pressure)
        pressure[idx] = keep
        for (let rI = 0; rI < m; rI++) J[rI * m + c] = (r1[rI]! - r0[rI]!) / JAC_H
      }

      const step = solveDense(J, r0, m)
      if (!step) {
        reason = 'singular-jacobian'
        if (trace) trace.push({ iteration: iterations, worst, norm: n0, worstNode, stepNorm: 0, lambda: 0, rejected: 0, pressure: named(model, pressure), flow: flowsNow(pressure), reversed: [], singular: true })
        break
      }

      let stepNorm = 0
      for (let i = 0; i < m; i++) stepNorm = Math.max(stepNorm, Math.abs(step[i]!))

      // Backtracking: start at the full Newton step and halve until the
      // residual norm actually improves. A step is never accepted merely for
      // being finite.
      let lambda = 1
      let rejected = 0
      let accepted = false
      for (; lambda >= MIN_LAMBDA; lambda /= 2) {
        candidate.set(pressure)
        for (let i = 0; i < m; i++) candidate[free[i]!] = pressure[free[i]!]! - step[i]! * lambda
        let ok = true
        for (const i of free) if (!Number.isFinite(candidate[i]!)) { ok = false; break }
        if (ok) {
          const n1 = norm(residuals(candidate))
          // Armijo with a slack factor: require a real reduction, not just a
          // non-increase, or the search can inch along forever.
          if (n1 < n0 * (1 - ARMIJO * lambda)) { accepted = true; break }
        }
        rejected += 1
      }

      if (!accepted) {
        reason = 'line-search-stalled'
        if (trace) trace.push({ iteration: iterations, worst, norm: n0, worstNode, stepNorm, lambda: 0, rejected, pressure: named(model, pressure), flow: flowsNow(pressure), reversed: [], singular: false })
        break
      }
      pressure.set(candidate)

      if (trace) {
        const now = flowsNow(pressure)
        const reversed = Object.keys(now).filter((id) => Math.sign(now[id]!) !== Math.sign(prevFlow[id] ?? 0) && Math.abs(now[id]!) > ZERO_FLOW)
        trace.push({ iteration: iterations, worst, norm: n0, worstNode, stepNorm, lambda, rejected, pressure: named(model, pressure), flow: now, reversed, singular: false })
        prevFlow = now
      }
    }
    if (iterations >= MAX_ITER && reason === undefined) reason = 'max-iterations'
    const rf = residuals(pressure)
    const wf = worstOf(rf)
    worst = wf.value
    worstNode = model.nodes[free[wf.at]!]!.id
  }

  const outP: Record<string, number> = {}
  const cavitating: string[] = []
  for (let i = 0; i < n; i++) {
    outP[model.nodes[i]!.id] = pressure[i]!
    if (pressure[i]! < 0) cavitating.push(model.nodes[i]!.id)
  }
  const flow: Record<string, number> = {}
  const pipeFlow: Record<string, number> = {}
  for (let k = 0; k < model.edges.length; k++) {
    const e = model.edges[k]!
    const a = edgeFrom[k]!, b = edgeTo[k]!
    const q = a < 0 || b < 0 ? 0 : edgeFlow(e, pressure[a]!, pressure[b]!, s)
    const safe = Number.isFinite(q) && Math.abs(q) > ZERO_FLOW ? q : 0
    flow[e.id] = safe
    for (const id of e.pipeIds) pipeFlow[id] = safe
  }

  const converged = worst < MASS_TOL
  return {
    pressure: outP, flow, pipeFlow, converged, iterations, residual: worst, undetermined, cavitating,
    ...(converged ? {} : { worstNode, ...(reason ? { reason } : {}) }),
    ...(trace ? { trace } : {}),
  }
}

/** Node pressures keyed by id, for a trace record. */
function named(model: ProcessModel, p: Float64Array): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < model.nodes.length; i++) out[model.nodes[i]!.id] = p[i]!
  return out
}

// `clampBar` is gone deliberately: clamping a Newton iterate removes roots.
// See the note above the iteration loop.

/**
 * Dense Gaussian elimination with partial pivoting. Returns null when the
 * matrix is singular, which happens for a node with no path to any boundary —
 * a genuinely undetermined pressure, and the caller reports it rather than
 * inventing one.
 */
function solveDense(A: Float64Array, b: Float64Array, m: number): Float64Array | null {
  const a = Float64Array.from(A)
  const x = Float64Array.from(b)
  for (let col = 0; col < m; col++) {
    let piv = col
    let best = Math.abs(a[col * m + col]!)
    for (let r = col + 1; r < m; r++) {
      const v = Math.abs(a[r * m + col]!)
      if (v > best) { best = v; piv = r }
    }
    if (best < 1e-14) return null
    if (piv !== col) {
      for (let c = 0; c < m; c++) {
        const t = a[col * m + c]!; a[col * m + c] = a[piv * m + c]!; a[piv * m + c] = t
      }
      const t = x[col]!; x[col] = x[piv]!; x[piv] = t
    }
    const d = a[col * m + col]!
    for (let r = col + 1; r < m; r++) {
      const f = a[r * m + col]! / d
      if (f === 0) continue
      for (let c = col; c < m; c++) a[r * m + c] = a[r * m + c]! - f * a[col * m + c]!
      x[r] = x[r]! - f * x[col]!
    }
  }
  for (let r = m - 1; r >= 0; r--) {
    let sum = x[r]!
    for (let c = r + 1; c < m; c++) sum -= a[r * m + c]! * x[c]!
    x[r] = sum / a[r * m + r]!
  }
  for (const v of x) if (!Number.isFinite(v)) return null
  return x
}
