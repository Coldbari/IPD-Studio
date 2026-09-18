// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * CONTROL AUTHORITY — can this loop's output reach the process at all?
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * K15 gave every unconfigured loop a calm-start setpoint at its own
 * measurement, and that exposed something that had always been there: a PI
 * loop sitting ON setpoint with a noisy transmitter and nothing it can do
 * about the process INTEGRATES THE NOISE. Conditional integration freezes the
 * integrator at a stop only when the error pushes further into it, so at the
 * lower stop the downward half of the noise is blocked and the upward half is
 * not. The integrator ratchets: measured at 0.3 % of output after twenty
 * seconds and 21 % after thirty-six minutes, on a plant whose pump was
 * stopped the whole time. A calm screen slowly opens its own valves.
 *
 * ── WHAT IS AND IS NOT DERIVABLE ──────────────────────────────────────────
 *
 * The honest question — "would moving this actuator change this measurement?"
 * — cannot be answered from runtime state and topology. Answering it properly
 * means solving a hypothetical network, and a hypothetical network is invented
 * physics. So this module answers the narrower question the runtime DOES
 * state, in five parts:
 *
 *   1. is there an actuator at all?
 *   2. is the actuator's element in the runtime?
 *   3. if the actuator is DRIVEN — a pump, a heater — is it energised?
 *   4. if it is an actuated valve, is it stuck?
 *   5. can the solve stand behind the measurement the loop is reading?
 *
 * ...plus one more that is sound rather than inferential:
 *
 *   6. THE MACHINE THE MEASUREMENT DEPENDS ON. A pressure or flow transmitter
 *      on a machine's own stream reads what that machine is making. A STOPPED
 *      PUMP BLOCKS in this model — that is the check-valve assumption K3.3
 *      wrote down, not a new claim — so with it de-energised nothing on its
 *      stream can move and no output can change what that transmitter reads.
 *      `speedLoopCandidate` and `flowLoopCandidate` already answer "which
 *      machine does this transmitter belong to"; this reuses their answer
 *      rather than asking a second time.
 *
 * ── WHAT HAPPENS WHEN THERE IS NONE ───────────────────────────────────────
 *
 * The integrator HOLDS, and so does the output. Not reset, not zeroed, not
 * decayed: held, exactly where the plant left it, so that when authority comes
 * back the loop resumes from the state it had rather than from a number
 * manufactured while it was blind. The PV keeps updating, the one-tick
 * measurement latency is untouched, the output limits still apply, and nothing
 * about the tuning changes.
 *
 * NO DEADBAND. A measurement deadband would stop the noise integrating and
 * would also stop the loop responding to a real error of the same size, which
 * is a control-design decision with its own consequences and is not what this
 * defect calls for.
 *
 * ── AUTHORITY IS NOT SATURATION ───────────────────────────────────────────
 *
 * A saturated loop is working and has run out of range. A loop with no
 * authority is not working at all. They are reported apart and `SAT` is
 * deliberately cleared while authority is unavailable: an output resting at a
 * limit it was never allowed to leave is not a saturated output.
 *
 * Pure, DOM-free, deterministic.
 */

import type { DiagnosticSeverity } from '../../model/diagnostics'
import type { MinFlowDemand } from './minflow'
import type { ProcessFault } from './quality'
import type { ScenarioFinding } from './scenario'

/**
 * WHY a loop's output cannot reach the process, or that it can.
 *
 * Ordered as the derivation applies them: a loop with no actuator cannot be
 * de-energised, and one whose machine is stopped is not also usefully
 * described as un-solved.
 */
export type ControlAuthority =
  /** The output reaches the process, as far as the runtime can state. */
  | 'available'
  /** No final element is bound, or its tag is not in the runtime. */
  | 'no-actuator'
  /** The driven actuator — or the machine the measurement depends on — is
   *  stopped or tripped. */
  | 'de-energised'
  /** An actuated valve that is not following its command at all. */
  | 'stuck'
  /** The solve behind the measurement cannot be trusted. */
  | 'unsolved'
  /**
   * A CASCADE MASTER whose slave is not following it — K17.
   *
   * The slave is in MANUAL, or has lost its own authority. Either way the
   * master's output is not reaching an actuator, so it must not go on
   * integrating against a path that cannot respond. Not a physics question and
   * not a new kind of authority: the same STATED fact as every other entry
   * here, and the same HOLD.
   */
  | 'downstream'

/** Operator-language for each, the vocabulary the diagnostics page uses. */
export const AUTHORITY_LABEL: Record<ControlAuthority, string> = {
  available: 'CONTROL AUTHORITY AVAILABLE',
  'no-actuator': 'CONTROL AUTHORITY UNAVAILABLE',
  'de-energised': 'CONTROL AUTHORITY UNAVAILABLE',
  stuck: 'CONTROL AUTHORITY UNAVAILABLE',
  unsolved: 'CONTROL AUTHORITY UNAVAILABLE',
  downstream: 'CONTROL AUTHORITY UNAVAILABLE',
}

/**
 * HOW SERIOUS, on the scale `model/diagnostics.ts` already defines. Stated
 * once so the faceplate and the diagnostics list cannot disagree.
 *
 * A DE-ENERGISED machine is a NORMAL PLANT STATE — a stopped pump on a calm
 * screen is not a fault, and colouring it as one would teach an operator to
 * ignore the colour. A STUCK actuator, an UNSOLVED measurement and a MISSING
 * binding are all things somebody has to do something about.
 */
export const AUTHORITY_SEVERITY: Record<ControlAuthority, DiagnosticSeverity | undefined> = {
  available: undefined,
  'de-energised': 'info',
  stuck: 'warning',
  unsolved: 'warning',
  'no-actuator': 'warning',
  /** A slave in MANUAL, or on a stopped machine, is a NORMAL operating state
   *  in exactly the way a stopped pump is. */
  downstream: 'info',
}

/** What the runtime knows about one control loop, this instant. */
export interface LoopState {
  tag: string
  mode: 'AUTO' | 'MANUAL'
  authority: ControlAuthority
  /** The final element, when the loop has one. */
  actuator?: string
  /**
   * What the controller asked the ACTUATOR for, %.
   *
   * K21: this is the COMMANDED output — the value after any configured output
   * rate limit, because that is what the element was actually told. It is the
   * right side of the `tracking` comparison for the same reason: an actuator
   * is following, or failing to follow, the command it was given and not a
   * number the algorithm kept to itself.
   */
  requested?: number
  /**
   * What the actuator ACTUALLY is — a valve's stroked `POS`, a drive's shaft
   * as a percentage. Never the command: an actuator takes time, and a stuck
   * one never arrives.
   */
  actual?: number
  /** True while the two differ by more than the existing deviation limit. */
  tracking: boolean
  /**
   * K21 — WHAT THE ALGORITHM ASKED FOR, before the output rate limit.
   *
   * Present ONLY on a loop whose record configures a rate limit; with none
   * there is nothing for it to differ from and publishing a duplicate of
   * `requested` would invite somebody to compare them and find them always
   * equal. Three values, kept apart:
   *
   *     requestedOp  90 %   the algorithm (or the operator's hand) asked
   *     requested    60 %   the rate limit allowed, and the element was told
   *     actual       45 %   the shaft has reached so far
   */
  requestedOp?: number
  /**
   * K21 — true while the rate limit is actually HOLDING THE OUTPUT BACK.
   *
   * NOT the same as `saturated`, which is the configured travel, and NOT the
   * same as an unavailable `authority`. A rate-limited loop is working: it has
   * authority, it has machine left, and it is moving as fast as its record
   * permits. That is why it carries no severity anywhere and produces no
   * diagnostic row — see the K21 report.
   */
  rateLimited?: boolean
  /** K21 — the configured limit itself, %/s, so the faceplate can show what is
   *  constraining the loop without deriving it a second time. Absent means the
   *  record states none and the plate shows nothing rather than a zero. */
  outputRatePctPerS?: number
  /**
   * WHICH machine is de-energised, when that is why authority is gone.
   *
   * Not always the actuator: a loop may drive a perfectly healthy valve and
   * still have no authority because the machine its MEASUREMENT depends on is
   * stopped, and naming the valve there would send an operator to the wrong
   * piece of equipment.
   */
  blockedBy?: string
  /** +1 at the top of the loop's travel, -1 at the bottom, 0 between. */
  saturated: -1 | 0 | 1
  /** K17: the slave this loop's output sets the setpoint of. */
  cascadeTo?: string
  /** K17: the master that owns this loop's setpoint. */
  cascadeFrom?: string
  /** K17, a master only: the setpoint its output asks for, in the SLAVE's
   *  units — and the one the slave is actually carrying. They are two things:
   *  see `requested` and `actual`, of which these are the cascade form. */
  commandedSp?: number
  effectiveSp?: number
  /** K17: a DECLARED cascade that could not be built, and why. */
  cascadeProblem?: string
  /**
   * K18: what the minimum-flow protection did to this loop's setpoint —
   * present only on a loop that carries a declared minimum, or a declared one
   * it could not be protected to. The COMMAND side only: see
   * `sim/minflow.ts`, which joins it to what the machine actually passed.
   */
  minFlow?: MinFlowDemand
  /**
   * K23: what this loop's configured setpoint limits did to its setpoint.
   * Present only where the record states one; absent everywhere else, so a
   * loop with no limits publishes nothing new at all.
   */
  spLimit?: SetpointLimit
  /**
   * K24, a CASCADE MASTER only: its output is currently being held by a
   * constraint of its SLAVE'S, not by one of its own.
   *
   * Present only on a master whose slave actually carries such a constraint,
   * and DISTINCT from `saturated` — which keeps its K22 meaning, the
   * controller's own configured travel. A master resting at 50 % because its
   * slave will not take more has half its travel left; reporting that as
   * saturation would tell an operator the master has run out of range when it
   * has run out of slave.
   */
  downstreamLimited?: boolean
}

/**
 * K23 — WHAT THE ENGINEERING SETPOINT LIMITS DID TO THIS LOOP'S SETPOINT.
 *
 * Published only on a loop whose record configures one, and shaped like
 * `MinFlowDemand` beside it for the same reason: a constraint that rewrites a
 * value must publish both numbers, or the screen stops being able to explain
 * itself.
 *
 * THE THREE RANGES THIS IS NOT. It is not the CALIBRATED RANGE, which says
 * what the instrument can measure; it is not the cascade MAP, which expresses
 * a master's per cent in its slave's units; and it is not `signal.setpoint`,
 * which is where the loop starts. K23 exists because those three were being
 * treated as one.
 */
export interface SetpointLimit {
  /** The configured bounds, in the loop's own unit. Either may be absent, and
   *  absent means no engineering limit on that side. */
  low?: number
  high?: number
  /** The setpoint as WRITTEN — an operator's, a scenario's, or a master's. */
  requested?: number
  /** The setpoint the ALGORITHM was given, after the limits. */
  limited?: number
  /** True while the two differ: the limit is actually holding the loop. */
  limiting: boolean
}

/** A runtime finding, in the one shape this product publishes. See
 *  `sim/envelope.ts` for why it is the same type rather than a parallel one. */
export type LoopFinding = ScenarioFinding

/** What a loop drives, in the terms `ControllerSpec` uses. */
export type ActuatorKind = 'valve' | 'heater' | 'pump' | 'cascade'

/**
 * Whether this loop's output can reach the process.
 *
 * `pvFault` is what the SOLVE says about the measurement — the caller computes
 * it with `processFaultOf`, which is the one place that question is answered,
 * so this module does not need to know the topology or import the engine.
 *
 * `driver` is the machine the measurement depends on, where the transmitter
 * sits on one machine's own stream. Absent for a level, a temperature, or a
 * transmitter no machine owns.
 */
export function authorityOf(input: {
  outTag?: string
  outKind?: ActuatorKind
  element?: Record<string, number>
  driverTag?: string
  driver?: Record<string, number>
  pvFault?: ProcessFault
  /** K17, cascade masters only: is the slave in AUTO and able to act? */
  downstreamFollowing?: boolean
}): { authority: ControlAuthority; blockedBy?: string } {
  const { outTag, outKind, element, driverTag, driver, pvFault } = input
  if (outTag === undefined || element === undefined) return { authority: 'no-actuator' }
  // 3. a driven actuator that is not energised cannot act at all. This is the
  //    same test stage 1.5 uses to decide whether a shaft chases a target.
  if ((outKind === 'pump' || outKind === 'heater') && !energised(element)) {
    return { authority: 'de-energised', blockedBy: outTag }
  }
  // 4. a stuck valve is not following its command, whatever that command is —
  //    including a command it happens to already be at.
  if (outKind === 'valve' && (element.STUCK ?? 0) >= 0.5) return { authority: 'stuck' }
  /**
   * K17: a CASCADE master whose slave is not following it. The caller has
   * already decided what "following" means — the slave in AUTO with authority
   * of its own — because that is the slave's verdict, not a second one.
   */
  if (outKind === 'cascade' && input.downstreamFollowing === false) {
    return { authority: 'downstream', ...(outTag !== undefined ? { blockedBy: outTag } : {}) }
  }
  // 6. the machine the MEASUREMENT depends on. A stopped pump blocks, so
  //    nothing on its stream can move.
  if (driver !== undefined && !energised(driver)) {
    return { authority: 'de-energised', ...(driverTag !== undefined ? { blockedBy: driverTag } : {}) }
  }
  // 5. and finally, whether the reading is worth acting on at all
  if (pvFault !== undefined) return { authority: 'unsolved' }
  return { authority: 'available' }
}

/** Running and not tripped — the exact test the shaft dynamics use. */
const energised = (t: Record<string, number>): boolean =>
  (t.RUN ?? 0) >= 0.5 && (t.FAULT ?? 0) < 0.5

/**
 * THE LOOPS, SAID OUT LOUD — through the existing diagnostics architecture
 * rather than beside it.
 *
 * `available` produces nothing: a loop doing its job is not a finding. Nor is
 * MANUAL — an operator holding an output is not a fault, and saying so on a
 * diagnostics page would train people to ignore it. TRACKING produces nothing
 * either: a drive on its way to a new speed is a ramp.
 */
export function loopFindings(loops: Record<string, LoopState>): LoopFinding[] {
  const out: LoopFinding[] = []
  for (const l of Object.values(loops).sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true }))) {
    const severity = AUTHORITY_SEVERITY[l.authority]
    if (severity !== undefined) {
      out.push({
        id: `authority:${l.tag}:${l.authority}`,
        tag: l.tag,
        severity,
        message: reason(l),
      })
    }
    /**
     * K17: A MASTER ASKING FOR A SETPOINT ITS SLAVE CANNOT BE GIVEN.
     *
     * The master's output is scaled onto the slave's CONFIGURED range and
     * nothing else, so "limited" means it is sitting at an end of that range —
     * which is `SAT`, already computed, said in cascade terms. Distinct from
     * unavailability: the link is working, and the range is the limit.
     */
    /**
     * K24: A MASTER HELD BY ITS SLAVE'S OWN SETPOINT LIMIT.
     *
     * Before K24 this condition reached the operator by accident: the master
     * wound all the way to its own travel stop, so the row below fired and
     * said "saturated". Now the master stops where the slave's limit projects
     * onto its output, `SAT` is correctly 0, and that row no longer fires —
     * which would have left an operator watching a master sit at 50 % with
     * nothing on the screen explaining why.
     *
     * INFORMATION, not a fault. A cascade respecting a configured limit is the
     * system working; it carries the same severity K16 gives a de-energised
     * machine and K17 gives a setpoint at the end of its range.
     */
    if (l.downstreamLimited === true && l.cascadeTo !== undefined) {
      out.push({
        id: `cascade-downstream-limited:${l.tag}`,
        tag: l.tag,
        severity: 'info',
        message: `is being held by ${l.cascadeTo}'s own setpoint limit, not by its own output `
          + `range — it has travel left and cannot usefully use it. Its integrator is held `
          + `where the limit stops it, so it responds as soon as ${l.cascadeTo} can take more.`,
      })
    }
    if (l.cascadeTo !== undefined && l.saturated !== 0 && l.commandedSp !== undefined) {
      out.push({
        id: `cascade-setpoint-limited:${l.tag}`,
        tag: l.tag,
        severity: 'info',
        message: `is asking ${l.cascadeTo} for ${l.commandedSp.toFixed(1)}, which is the `
          + `${l.saturated > 0 ? 'top' : 'bottom'} of ${l.cascadeTo}'s configured setpoint range. `
          + `It cannot ask for more; nothing here invents a wider one.`,
      })
    }
  }
  return out
}

function reason(l: LoopState): string {
  const held = l.mode === 'AUTO'
    ? ' Its output and integrator are held where the plant left them.'
    : ''
  switch (l.authority) {
    case 'no-actuator':
      return 'has no final element to drive, so nothing it computes reaches the plant.'
        + ' It tracks its measurement and controls nothing.'
    case 'de-energised':
      return `cannot reach the process: ${l.blockedBy ?? l.actuator ?? 'the machine it depends on'}`
        + ` is stopped or tripped, and a stopped machine blocks its own line.${held}`
    case 'stuck':
      return `cannot reach the process: ${l.actuator ?? 'its final element'} is stuck and is `
        + `not following its command.${held}`
    case 'downstream':
      return `is cascaded onto ${l.blockedBy ?? 'its slave'}, which is not following it — the`
        + ` slave is in MANUAL or cannot reach its own process.${held}`
    case 'unsolved':
      return 'cannot act on its measurement: the hydraulic solve behind it did not converge,'
        + ` or the network cannot determine it.${held}`
    default:
      return ''
  }
}
