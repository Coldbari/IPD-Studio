// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * MINIMUM-FLOW PROTECTION — the PROTECTIVE ACTION K13 deliberately refused.
 *
 * K13 wrote down three things and kept them apart: the HYDRAULIC OPERATING
 * POINT (the solve's), the ENGINEERING ENVELOPE (`duty.minFlow`, the record's)
 * and PROTECTIVE ACTION (what the plant does about a violation). It did the
 * first two and none of the third, because a minimum-flow trip is a real piece
 * of equipment with a setting and a time delay and inventing one would have
 * been fabrication. K18 does the third — and only the part of it the record
 * and the architecture can actually support.
 *
 * ── IT IS A CONSTRAINT ON A SETPOINT. NOT A CONTROLLER ────────────────────
 *
 *      requested SP ──► max(requested, minFlow) ──► FIC ──► VSD ──► pump
 *
 * That is the whole algorithm. There is no second PI loop, no integrator, no
 * gain and no tuning constant anywhere in this file, because a constraint on a
 * setpoint does not need any of them. The FIC remains the controller and
 * remains the only writer of the drive.
 *
 * ── WHY NO HYSTERESIS IS NEEDED, RATHER THAN CHOSEN ───────────────────────
 *
 * `max` of two continuous quantities is continuous. As the requested setpoint
 * crosses the limit the EFFECTIVE setpoint does not jump — it is already equal
 * to the limit at the crossing — so there is no discontinuity in the control
 * action for a threshold to chatter on. Only the reported boolean flips, and a
 * boolean that flips does not move a machine. An override built as a switch
 * between two control laws WOULD need hysteresis; this one is built so that it
 * does not, and so no arbitrary width had to be invented for it.
 *
 * ── THE COMMAND IS PROTECTED. THE MEASUREMENT IS NEVER TOUCHED ────────────
 *
 * Raising a setpoint asks the plant for more flow. It does not produce any. If
 * the machine cannot make the minimum — shut in, dead-headed, stopped, held
 * back by the pressure in front of it — then the flow stays where the solver
 * puts it and this module says UNABLE. It never clamps a displayed PV, never
 * substitutes the limit for a reading, and never claims a demand succeeded.
 * That distinction is the entire point of having five states instead of a
 * boolean.
 *
 * ── SIGNED, AND READ FROM ONE PLACE ───────────────────────────────────────
 *
 * "What is this machine passing?" is answered by K13's `PumpEnvelope.flowM3h`
 * — the SIGNED flow through the pump's own edge — and not asked a second time
 * here. Two modules that derive the same fact are two modules that can
 * disagree about it. It also means no `Math.abs` stands anywhere between the
 * solve and the verdict: a machine running BACKWARDS is passing less than any
 * positive minimum, and the comparison says so because the number is negative.
 * The FT's own reading is a magnitude — an orifice plate does not know which
 * way round it was installed — which is exactly why the protection is not
 * judged on it.
 *
 * Pure, DOM-free, deterministic.
 */

import type { DiagnosticSeverity } from '../../model/diagnostics'
/** Type-only, and therefore erased: `authority.ts` imports `MinFlowDemand`
 *  from here, and a cycle that exists only in the type graph never reaches the
 *  emitted module. K16's verdict is REUSED rather than re-derived — see
 *  `stateOf` for why a second opinion about `RUN` and `FAULT` was refused. */
import type { ControlAuthority } from './authority'
import type { PumpEnvelope } from './envelope'
import type { ScenarioFinding } from './scenario'

/**
 * WHAT THE PROTECTION IS DOING, in the vocabulary an operator reads.
 *
 * The three that matter are ACTIVE, EFFECTIVE and UNABLE, and the distinction
 * between them is the one §5 of the brief exists to force: a raised setpoint
 * is a DEMAND, and a demand is not a result.
 */
export type MinFlowState =
  /** The record declares no minimum for this machine — or declares one this
   *  loop cannot be protected to. Nothing is imposed and nothing is invented. */
  | 'NOT_CONFIGURED'
  /** A minimum exists and the setpoint asked for already respects it. */
  | 'INACTIVE'
  /**
   * K19. THE DEMAND STANDS AND IS NOT REACHING THE PLANT — so there is no
   * outcome to judge, and judging one anyway is what K18 got wrong.
   *
   * Two causes, both of them facts the runtime already publishes and neither
   * of them a fault:
   *
   *   MANUAL — this runtime does not use the setpoint in MANUAL, so a
   *            constraint on the setpoint has no path. K18 established that
   *            policy in the engine and then published `overriding: true`
   *            anyway; K19 says out loud what the engine was already doing.
   *   DE-ENERGISED — the machine is stopped, tripped, or coasting down after a
   *            stop. K16 already calls this `de-energised` and grades it
   *            INFORMATION, and K13 already calls the machine STOPPED. A
   *            minimum nobody can meet because the plant is switched off is
   *            not a protection failure, and §12 exists to stop it being
   *            reported as one.
   *
   * MEASURED, on the K15 fixture with a 20 m³/h minimum: K18 read UNABLE — in
   * the WARNING colour — at simulation start with the pump never started, for
   * the whole of a commanded shutdown, and throughout a trip. Six of the
   * thirteen lifecycle points probed were a machine at rest being reported as
   * a protection that had failed.
   */
  | 'STANDING_BY'
  /** The setpoint has been raised to the minimum, and whether the machine is
   *  passing it cannot be determined — the solve behind the flow is not one
   *  anything should be read off. */
  | 'ACTIVE'
  /** The setpoint has been raised, and the machine IS passing the minimum. */
  | 'EFFECTIVE'
  /** The setpoint has been raised, the plant COULD have answered it, and the
   *  machine is NOT passing the minimum. Running, reversed or dead-headed —
   *  never merely switched off, which is `STANDING_BY`. */
  | 'UNABLE'

/**
 * HOW SERIOUS EACH STATE IS, on the scale `model/diagnostics.ts` already
 * defines — stated ONCE, here, so the faceplate and the diagnostics list
 * cannot colour the same condition differently.
 *
 * `undefined` means it is not a finding at all. A protection that is holding a
 * machine above its minimum IS THE SYSTEM WORKING, and a working system must
 * never be coloured as a fault: an operator who is shown red for success
 * learns to ignore red.
 *
 * UNABLE is a WARNING and not an alarm. No engineering alarm policy in this
 * product says a machine below its minimum flow is a critical condition, and
 * K13's existing `pump-below-min-flow` — which is the same physical fact, seen
 * from the machine rather than from the loop — is a warning too. Inventing a
 * priority here would make two surfaces disagree about one condition.
 */
export const MIN_FLOW_SEVERITY: Record<MinFlowState, DiagnosticSeverity | undefined> = {
  NOT_CONFIGURED: undefined,
  INACTIVE: undefined,
  /**
   * K19. NOT A FINDING, and deliberately not even INFORMATION.
   *
   * Both things that produce it are already reported by the module that owns
   * them: K16 publishes `de-energised` as info on the loop, and K13 publishes
   * STOPPED on the machine. A third row would be the duplicate §14 forbids,
   * and a MANUAL loop is an operator holding an output — K16 decided that is
   * not a finding either. The word still appears on the faceplate, in the
   * PLAIN tone, because that is where the operator asks what the protection is
   * doing rather than what is wrong.
   */
  STANDING_BY: undefined,
  /** A demand whose outcome the solve cannot report. Information, not a fault. */
  ACTIVE: 'info',
  EFFECTIVE: undefined,
  UNABLE: 'warning',
}

/**
 * OPERATOR LANGUAGE for each state — the vocabulary §17 writes them in.
 *
 * The identifiers carry underscores because they are identifiers; a plate does
 * not. `AUTHORITY_LABEL` already established that an operator surface renders
 * a label rather than an enum, and this is the same idea for the same reason.
 *
 * The `data-state` attribute on the faceplate deliberately keeps the RAW enum,
 * so tests and any automation reading the DOM see the state itself rather than
 * a string chosen for how it looks.
 */
export const MIN_FLOW_LABEL: Record<MinFlowState, string> = {
  NOT_CONFIGURED: 'NOT CONFIGURED',
  INACTIVE: 'INACTIVE',
  STANDING_BY: 'STANDING BY',
  ACTIVE: 'ACTIVE',
  EFFECTIVE: 'EFFECTIVE',
  UNABLE: 'UNABLE',
}

/**
 * THE DEMAND, as the controller stage computed it — the COMMAND side.
 *
 * Published on `LoopState` because that is where everything else the
 * controller decided about this tick is published. It contains no measurement:
 * the override is decided from the requested setpoint and the declared limit
 * alone, which is what makes it deterministic and free of any look-ahead.
 */
export interface MinFlowDemand {
  /** The machine whose record declares the limit, and whose drive this loop
   *  is the sole writer of. */
  pump: string
  /**
   * The declared minimum continuous flow, m³/h — `duty.minFlow`, read and
   * never derived. ABSENT here means a declared limit this loop cannot be
   * protected to; see `problem`. Absent everywhere means the record states
   * none, and then there is no demand at all.
   */
  limitM3h?: number
  /** Why a declared limit could not be applied to this loop. */
  problem?: string
  /** The setpoint the loop was GIVEN — the operator's, or its master's. */
  requestedSp?: number
  /** The setpoint the ALGORITHM controlled to. `max` of the two above. */
  effectiveSp?: number
  /**
   * True while the two differ: the requested setpoint is below the limit, so
   * the algorithm's setpoint has been raised.
   *
   * A statement about THE SETPOINT AND THE RECORD, and about nothing else. It
   * is deliberately independent of mode and of the plant: whether the raise
   * REACHES anything is `inForce`, and what the machine did about it is the
   * state. Collapsing the three is what K19 exists to undo.
   */
  overriding: boolean
  /**
   * K19. Whether the raise above has a PATH to the plant.
   *
   * False in MANUAL, where this runtime does not use the setpoint at all — the
   * operator's `OP` goes to the element and the algorithm does not run. K18
   * implemented exactly that and then published `overriding: true` beside it,
   * which told an operator in hand control that the protection was holding
   * their setpoint while their own output drove the machine.
   *
   * It is NOT a bypass and not a policy. Nothing here decides the protection
   * should stop acting; this reports that in MANUAL there is nothing for it to
   * act on. The bumpless-transfer tracking still uses `effectiveSp`, because
   * it must track the setpoint AUTO will resume on.
   */
  inForce: boolean
}

/** The demand joined to what the plant actually did about it. */
export interface MinFlowProtection extends MinFlowDemand {
  /** The flow loop that carries the protected setpoint. */
  tag: string
  state: MinFlowState
  /** SIGNED flow through the machine's own edge, m³/h. K13's number, not a
   *  second derivation of it, and never a magnitude. */
  actualM3h?: number
  /** K14's published saturation for the protecting loop, carried through
   *  because it is what separates a loop that has RUN OUT OF MACHINE from one
   *  that is simply controlling at the limit. See `minFlowFindings`. */
  saturated: -1 | 0 | 1
}

/**
 * The state of a loop, including one that carries no demand at all.
 *
 * An absent record IS `NOT_CONFIGURED`: there is nothing to publish for a loop
 * whose machine declares no minimum, and a caller asking about one should get
 * the word rather than `undefined`.
 */
export const minFlowStateOf = (p: MinFlowProtection | undefined): MinFlowState =>
  p?.state ?? 'NOT_CONFIGURED'

/**
 * WHAT THE PROTECTION ACHIEVED, this instant.
 *
 * A join and nothing more: the demand comes from the controller stage, the
 * flow comes from K13's envelope, and this decides which of the five words
 * describes the pair. Nothing here is a store and nothing here writes a tag.
 *
 * ── TIMING ────────────────────────────────────────────────────────────────
 *
 * Both inputs describe the TICK THAT HAS JUST FINISHED — `loops` and
 * `pumpEnvelopes` are built from the same tags and the same solve. The state
 * is therefore a REPORT, never an input: the override that produced it was
 * decided before the solve ran, from the setpoint and the limit alone. There
 * is no path by which this function's answer reaches a controller, and so no
 * look-ahead and no second clock.
 */
export function minFlowProtection(
  loops: Record<string, {
    tag: string
    authority?: ControlAuthority
    saturated?: -1 | 0 | 1
    minFlow?: MinFlowDemand
  }>,
  envelopes: Record<string, PumpEnvelope>,
): Record<string, MinFlowProtection> {
  const out: Record<string, MinFlowProtection> = {}
  for (const l of Object.values(loops)) {
    const d = l.minFlow
    if (!d) continue
    const env = envelopes[d.pump]
    out[l.tag] = {
      ...d,
      tag: l.tag,
      ...(env?.flowM3h !== undefined ? { actualM3h: env.flowM3h } : {}),
      saturated: l.saturated ?? 0,
      state: stateOf(d, env, l.authority ?? 'available'),
    }
  }
  return out
}

/**
 * THE TRANSITION TABLE, in one place and in one order.
 *
 * Ordered WORST EVIDENCE FIRST, the way `EnvelopeState` orders itself: a
 * demand that is not reaching the plant outranks every verdict below it,
 * because all of them are claims about what the plant did with a demand it
 * never received.
 *
 *   1. NOT_CONFIGURED  no limit in force — none stated, or one this loop
 *                      cannot carry. Nothing is assumed in its place.
 *   2. INACTIVE        a limit, and a requested setpoint that already respects
 *                      it. Nothing has been raised.
 *   3. STANDING_BY     the raise is called for and has NO PATH: the loop is in
 *                      MANUAL, or the machine is de-energised. §12.
 *   4. ACTIVE          the raise is in force and the SOLVE cannot say what
 *                      came of it.
 *   5. EFFECTIVE       the raise is in force and the machine IS passing the
 *                      minimum.
 *   6. UNABLE          the raise is in force, the plant could have answered
 *                      it, and the machine is NOT passing the minimum.
 *
 * Every input is a fact some other module already published — `overriding` and
 * `inForce` from the controller stage, the flow and the solve's trustworthiness
 * from K13's envelope, the authority from K16. Nothing is derived a second
 * time and no threshold, width or delay appears anywhere in it.
 */
function stateOf(
  d: MinFlowDemand,
  env: PumpEnvelope | undefined,
  authority: ControlAuthority,
): MinFlowState {
  // a declared limit this loop cannot be protected to is not a limit in force
  if (d.limitM3h === undefined) return 'NOT_CONFIGURED'
  if (!d.overriding) return 'INACTIVE'
  /**
   * K19. THE DEMAND EXISTS AND IS NOT REACHING THE PLANT.
   *
   * MANUAL first, because it is a statement about the CONTROL PATH and holds
   * whatever the machine is doing — a loop in hand on a healthy running pump
   * is still not being protected by a setpoint nothing is using.
   */
  if (!d.inForce) return 'STANDING_BY'
  /**
   * THE DEMAND IS IN FORCE. Did the plant meet it?
   *
   * With no solve worth reading there is no answer, and ACTIVE is the honest
   * word for "the protection is holding the setpoint up and this model cannot
   * tell you what came of it". Guessing EFFECTIVE there would be the exact
   * fabrication §5 forbids. Asked BEFORE authority because an unreadable solve
   * is also what makes K16 say `unsolved`, and "we cannot tell" is the more
   * useful of the two answers.
   */
  if (env === undefined || env.flowM3h === undefined || env.state === 'UNKNOWN') return 'ACTIVE'
  /**
   * K19, §11 and §12. A MACHINE THAT IS SWITCHED OFF IS NOT A FAILED
   * PROTECTION.
   *
   * K16's own verdict, reused rather than re-derived from `RUN` and `FAULT`
   * here — which would be a second opinion about the same fact. It covers the
   * stopped machine, the tripped one, and the whole of a coast-down, because
   * authority goes the instant the stop is commanded while the shaft is still
   * turning and still passing something less than the minimum.
   */
  if (authority !== 'available') return 'STANDING_BY'
  /**
   * SIGNED. A negative flow is fluid coming BACK through the machine and
   * cannot satisfy a positive minimum; taking the magnitude here would report
   * a machine running backwards as one comfortably above its limit.
   */
  return env.flowM3h >= d.limitM3h ? 'EFFECTIVE' : 'UNABLE'
}

/** One decimal for a flow, the way K13, the faceplate and the trend say it. */
const q = (v: number): string => `${v.toFixed(1)} m³/h`

/**
 * THE PROTECTION, SAID OUT LOUD — through the existing diagnostics
 * architecture rather than beside it.
 *
 *   `warning` — UNABLE. The protection is asking for the minimum and the plant
 *               is not making it. Somebody has to do something about it.
 *   `info`    — ACTIVE with no readable solve, and a declared limit that could
 *               not be applied to this loop. Neither is a fault; both are
 *               things the operator would otherwise have no way to know.
 *   nothing   — EFFECTIVE, INACTIVE and STANDING_BY. A protection doing its
 *               job, a protection with nothing to do, and a protection whose
 *               machine is switched off or whose loop is in hand, are not
 *               findings. The last of those is K19's: see `MIN_FLOW_SEVERITY`.
 *
 * NOT_CONFIGURED produces nothing HERE because K13 already produces it:
 * `pump-min-flow-unknown` says, on the machine, that no minimum is stated. A
 * second row for one gap is how two lists that must agree start to drift.
 *
 * ── AND WHY `pump-below-min-flow` IS NOT THE SAME ROW — K19, §13 ───────────
 *
 * K13's row and this one fire together whenever a running machine is short of
 * its minimum, and they are NOT duplicates: they are the two halves §4 insists
 * on keeping apart. K13 reports the MACHINE'S OPERATING POINT against the
 * record — it fires for a pump with no controller on it at all, which is
 * exactly why it cannot be gated on a loop's `SAT` the way this one is. This
 * row reports what the LOOP IS DOING ABOUT IT. One says the plant is outside
 * its envelope; the other says the protection has asked and been refused.
 *
 * They are worded so neither reads as a restatement of the other, and K13's
 * names the defending loop when there is one — see `envelopeFindings`.
 *
 * ── WHY UNABLE ALONE DOES NOT RAISE THE WARNING ───────────────────────────
 *
 * A loop CONTROLLING AT its minimum sits on it, which means half the time it
 * is a hair under it. Measured on the K15 fixture, held at a declared minimum
 * of 20 m³/h: mean 19.998, range 19.66-20.38, and the state crosses 140 times
 * in 200 seconds. K13's envelope crosses in exact lockstep — the same signed
 * flow against the same limit with the same test — so this is not a property
 * K18 introduced, it is a property K18 made reachable by putting a plant at
 * its limit for the first time.
 *
 * NO HYSTERESIS WAS INVENTED FOR IT, and none is needed for the OVERRIDE,
 * which is continuous and does not chatter at all. What the warning is gated
 * on instead is a fact the runtime already publishes: `SAT`. A loop that has
 * asked for everything and still cannot get there is saturated at its top
 * stop; a loop oscillating on setpoint is not saturated at all. Measured on
 * the same fixture: dead-headed, SAT = +1; asked for more than the plant can
 * make, SAT = +1; controlling at the limit, SAT = 0 throughout.
 *
 * That is a reuse of K14's published saturation and not a threshold, a
 * deadband or a delay. A STATE that does not chatter would need one of those,
 * and choosing its width is a control-design decision this phase deliberately
 * does not make — see the K18 report.
 *
 * A MACHINE AT REST therefore produces nothing either, and for the same
 * reason: K16 CLEARS `SAT` when a loop has no authority, so a stopped pump
 * cannot raise this warning. That is the right answer twice over — K13 already
 * decided a machine at rest is not a finding, and K16 already reports the lost
 * authority as information.
 */
export function minFlowFindings(
  protection: Record<string, MinFlowProtection>,
): ScenarioFinding[] {
  const out: ScenarioFinding[] = []
  for (const p of Object.values(protection).sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true }))) {
    const add = (id: string, severity: DiagnosticSeverity, message: string) =>
      out.push({ id: `min-flow:${p.tag}:${id}`, tag: p.tag, severity, message })

    if (p.problem !== undefined) {
      add('min-flow-not-configured', 'info',
        `cannot apply ${p.pump}'s minimum flow: ${p.problem} Minimum-flow protection is `
        + `not in service on this loop, and no limit has been assumed in its place.`)
      continue
    }
    switch (p.state) {
      case 'ACTIVE':
        add('min-flow-active', 'info',
          `is holding its setpoint at ${p.pump}'s minimum flow of ${q(p.limitM3h ?? 0)} — it was `
          + `asked for ${q(p.requestedSp ?? 0)}. Whether the machine is passing the minimum cannot `
          + `be determined: the hydraulic solve behind the flow did not converge.`)
        break
      case 'UNABLE':
        if (p.saturated <= 0) break
        add('min-flow-unable', 'warning',
          `is asking for ${p.pump}'s minimum flow of ${q(p.limitM3h ?? 0)} and the plant is not `
          + `making it. Actual ${q(p.actualM3h ?? 0)}, from the solved hydraulic operating point. `
          + `The setpoint has been raised and the flow has not followed it, with the output at `
          + `maximum — this is the LOOP's report; ${p.pump}'s own row says where the machine is `
          + `being run.`)
        break
      default:
        break
    }
  }
  return out
}
