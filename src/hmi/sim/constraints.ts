// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE CONSTRAINT INVENTORY — who owns each limit, and in what order they act.
 *
 * By K21 this runtime had eight independent things that can stop a controller
 * getting what it asked for, added one phase at a time over K12-K21. Each was
 * correct on its own; what nobody had written down was the ORDER, the
 * OWNERSHIP, and which of them the anti-windup can see. K22 is that audit, and
 * this file is its result.
 *
 * ── WHY IT IS CODE AND NOT A COMMENT ──────────────────────────────────────
 *
 * A prose description of a constraint chain rots the moment somebody adds a
 * ninth constraint. The rows below are asserted against the RUNNING PLANT by
 * `tests/hmi/constraints.test.ts`: every `source` must still exist in the
 * engineering field catalogue, every `absent` claim is exercised, and the
 * precedence is checked by driving a loop into each limit in turn. Nothing
 * here decides anything — the limits live where they always did. This is an
 * index that cannot silently disagree with them.
 *
 * ── THE CHAIN ─────────────────────────────────────────────────────────────
 *
 *   operator / master ──► SP ──► [min-flow override] ──► effective SP
 *                                                             │
 *                                                        PI algorithm
 *                                                             │
 *                          requested OP ──► [OP travel] ──► [output rate]
 *                                                             │
 *                                                       commanded OP
 *                                                             │
 *                                 ┌───────────────────────────┴────────┐
 *                            VSD: SPD                             valve: OP
 *                            [turndown]                          [travel]
 *                                 │                                   │
 *                            [RAMP_S]                          [STROKE_RATE]
 *                                 │                                   │
 *                              shaft                                 POS
 *                                 └───────────────┬───────────────────┘
 *                                          hydraulic solve
 *
 * ── THE ONE RULE THAT MATTERS ─────────────────────────────────────────────
 *
 * A CONSTRAINT IS ENFORCED BY THE LAYER THAT OWNS IT, AND NOWHERE ELSE — with
 * one deliberate exception, `vsd-turndown`, which is enforced twice on purpose
 * and says so in its own row. Everything else has exactly one owner, and the
 * tests prove a direct write cannot slip past it.
 */

/**
 * WHERE in the chain a constraint acts. Ordered as the signal travels, which
 * is also the order `CONSTRAINTS` is written in and the order the precedence
 * tests walk.
 */
export type ConstraintLayer =
  /** Acts on the SETPOINT, before the algorithm runs. */
  | 'setpoint'
  /** Acts on the algorithm's OUTPUT, before it leaves the controller. */
  | 'controller-output'
  /** Acts on the ACTUATOR's interpretation of a command it has been given. */
  | 'actuator'
  /** The actuator's own dynamics: how fast the hardware can physically move. */
  | 'physical'

/** Whether the PI anti-windup can see this constraint. */
export type WindupAwareness =
  /** The conditional-integration predicate includes it as a stop. */
  | 'observes'
  /**
   * Deliberately invisible to the integrator. A constraint the CONTROLLER'S
   * OUTPUT does not hit is not windup — see `PHYSICAL_LAG_IS_NOT_WINDUP`.
   */
  | 'outside'
  /** Not a controller constraint at all. */
  | 'n/a'

export interface ConstraintFact {
  /** Stable id, used by the tests and by nothing else. */
  id: string
  layer: ConstraintLayer
  /** What it stops, in one line. */
  what: string
  /** The module that ENFORCES it. One name, or the audit has failed. */
  owner: string
  /**
   * The engineering record field it comes from, or an explicit statement that
   * it has no engineering source. `null` is never "we could not find one" —
   * it means the quantity is a property of the MODEL, not of the plant, and
   * §21 of the K22 brief exists to keep those apart.
   */
  source: string | null
  /** The unit the value is held in, internally. */
  unit: string
  /** What an absent record means. Never "zero" unless zero is the physics. */
  absent: string
  antiWindup: WindupAwareness
}

/**
 * PHYSICAL LAG IS NOT WINDUP, and this is the single most load-bearing
 * conclusion of the K22 audit.
 *
 * A drive takes `RAMP_S` to move its shaft and a valve strokes at
 * `STROKE_RATE`. Neither is a stop the controller's OUTPUT is resting against:
 * the command was ACCEPTED IN FULL and the hardware is on its way. That lag is
 * part of the process the loop is controlling, and a PI controller's job is to
 * handle it — which it does, through the measurement, exactly as it handles
 * the pipe and the vessel beyond it.
 *
 * Feeding actuator lag into the anti-windup would freeze the integrator during
 * every ordinary move and turn a tuned loop into a proportional-only one. So
 * `RAMP_S`, `COAST_S` and `STROKE_RATE` are marked `outside`, and that is a
 * design statement rather than an omission.
 *
 * The contrast is `output-rate`: there the command itself is REFUSED, the
 * output genuinely cannot get where the algorithm is asking, and K21 added it
 * to the predicate for that reason.
 */
export const PHYSICAL_LAG_IS_NOT_WINDUP = true

/**
 * EVERY CONSTRAINT IN THE RUNTIME, in the order the signal meets them.
 *
 * Read `source: null` carefully. It marks a bound that belongs to the MODEL
 * rather than to an engineering record, and there are exactly five:
 *
 *   - `sp-domain`, which is not a constraint at all — see
 *     `NO_ENGINEERING_SP_LIMITS`;
 *   - `vsd-ceiling`'s 100 %, which is where the pump curve is DEFINED — `H₀`
 *     is the shutoff head at rated speed, so a command above it would
 *     extrapolate a curve no record describes;
 *   - `valve-travel`'s 0-100, which is what a valve POSITION means;
 *   - `vsd-ramp` and `valve-stroke`, which are stated modelling assumptions
 *     about how fast hardware moves. No record in this product carries a ramp
 *     time, a deceleration time or a stroke time.
 *
 * NONE of them is a claimed engineering limit and none may be reported to an
 * operator as one. In particular there is no `duty.maxSpeed` field anywhere in
 * this product, and `vsd-ceiling` must never be mistaken for one.
 *
 * `op-travel` is the one that looks like it belongs here and does not. Its
 * FLOOR is `duty.minSpeed`, a real engineering value; only its ceiling is the
 * curve's domain, and that ceiling is recorded separately as `vsd-ceiling`.
 */
export const CONSTRAINTS: readonly ConstraintFact[] = [
  {
    id: 'min-flow-override',
    layer: 'setpoint',
    what: 'raises the setpoint the algorithm controls to, up to the machine’s declared minimum continuous flow',
    owner: 'engine: the controller stage, before the algorithm runs',
    source: 'duty.minFlow',
    unit: 'the loop’s own setpoint unit (m³/h; other units are refused, not converted)',
    absent: 'no protection at all — nothing is assumed in its place, and K13 reports LIMIT UNKNOWN',
    // On a MASTER only, as `minFlowFloorPct`: its output is the slave's
    // setpoint, so a floor under that setpoint is a stop under its output.
    antiWindup: 'observes',
  },
  {
    id: 'sp-domain',
    layer: 'setpoint',
    what: 'nothing, in the engine — see `NO_ENGINEERING_SP_LIMITS`',
    owner: 'the faceplate’s entry field, and K17’s cascade map. NOT the engine.',
    source: null,
    unit: 'the loop’s own setpoint unit',
    absent: 'there is no engineering SP limit in this product; the calibrated range bounds an input widget and scales a master’s output, and neither is a control constraint',
    antiWindup: 'n/a',
  },
  {
    id: 'op-travel',
    layer: 'controller-output',
    what: 'the range the controller’s own output may occupy',
    owner: 'engine: `outputRange` decides it, the controller stage clamps to it',
    source: 'duty.minSpeed (a speed loop’s FLOOR only)',
    unit: '% of output',
    absent: 'floor 0 — and for a speed loop that means the drive declares no turndown, not that it has none',
    antiWindup: 'observes',
  },
  {
    id: 'output-rate',
    layer: 'controller-output',
    what: 'how fast the COMMAND may change, per simulation timestep',
    owner: 'engine: the controller stage’s `send`, on every path out of it',
    source: 'signal.outputRateLimit',
    unit: '%/s',
    absent: 'unconstrained — the command moves as fast as the algorithm asks',
    antiWindup: 'observes',
  },
  {
    id: 'vsd-turndown',
    layer: 'actuator',
    what: 'the lowest speed the drive will actually turn at, whatever it is commanded',
    owner: 'engine: `speedTarget`. ALSO the controller’s `op-travel` floor — the one deliberate double-enforcement in the runtime, because the algorithm has to be able to SEE the stop it is winding against, and a direct write to SPD must still be refused.',
    source: 'duty.minSpeed',
    unit: '% of rated speed',
    absent: 'no turndown imposed; the drive will follow a command to zero',
    antiWindup: 'observes',
  },
  {
    id: 'vsd-ceiling',
    layer: 'actuator',
    what: 'the highest speed the pump curve is defined at',
    owner: 'engine: `speedTarget`, and `outputRange` as the controller’s ceiling',
    source: null,
    unit: '% of rated speed',
    absent: 'not applicable — it is the curve’s domain, not a record’s value, and there is no duty.maxSpeed field',
    antiWindup: 'observes',
  },
  {
    id: 'valve-travel',
    layer: 'actuator',
    what: 'the positions a valve physically has, shut to fully open',
    owner: 'engine: `travelTarget` (K22). Before K22 this was enforced only at the solver boundary, so the PUBLISHED position could leave the travel.',
    source: null,
    unit: '% open',
    absent: 'not applicable — it is what a position means',
    antiWindup: 'outside',
  },
  {
    id: 'vsd-ramp',
    layer: 'physical',
    what: 'how fast the shaft can actually change speed',
    owner: 'engine: the equipment-dynamics stage (`RAMP_S`, and `COAST_S` de-energised)',
    source: null,
    unit: 's for full travel',
    absent: 'not applicable — a stated modelling assumption, and no record in this product carries a ramp or a deceleration time',
    antiWindup: 'outside',
  },
  {
    id: 'valve-stroke',
    layer: 'physical',
    what: 'how fast a valve can actually move',
    owner: 'engine: the equipment-dynamics stage (`STROKE_RATE`)',
    source: null,
    unit: '%/s',
    absent: 'not applicable — a stated modelling assumption, and no record carries a stroke time',
    antiWindup: 'outside',
  },
]

/**
 * THERE ARE NO ENGINEERING SETPOINT LIMITS IN THIS PRODUCT, and K22 declined
 * to invent any.
 *
 * The audit looked for them and found three things that are NOT them:
 *
 *   1. THE CALIBRATED RANGE (`signal.range`) bounds the faceplate's setpoint
 *      ENTRY FIELD. That is input hygiene on a widget, and the engine does not
 *      enforce it — a scenario or a test writing a setpoint beyond the range
 *      gets exactly what it asked for.
 *   2. THE SAME RANGE is what K17 scales a master's output onto, because a
 *      slave's setpoint has to be expressed in the slave's own units and the
 *      record states no other span. That is a MAP, not a limit.
 *   3. `signal.setpoint` is a CONFIGURED STARTING VALUE (K15), not a bound.
 *
 * A transmitter's range is a statement about an INSTRUMENT. Treating it as a
 * controller's permitted setpoint span would be the same category error as
 * treating `duty.minFlow` as a VSD minimum speed, and §7 of the K22 brief
 * exists to forbid it.
 *
 * WHAT HAPPENS INSTEAD is better than a clamp would be: a loop asked for more
 * than the plant can make runs its output to the top of its travel and reports
 * `SAT +1`. The operator is told the setpoint is unreachable, which is the
 * fact they need. Silently rewriting the entry to the top of a range would
 * hide it behind a number that looks achievable.
 */
export const NO_ENGINEERING_SP_LIMITS = true

/**
 * WHAT `SAT` MEANS, stated once so it cannot drift into "something limited me".
 *
 * `SAT` is the CONTROLLER'S OWN TRAVEL and nothing else: +1 when the output is
 * at the top of `op-travel` with the error still pushing up, -1 at the bottom
 * with it pushing down, 0 between. It deliberately excludes:
 *
 *   - the OUTPUT RATE LIMIT, which is `rateLimited` (K21). A loop crawling to
 *     90 % at its configured rate has plenty of machine and is not saturated.
 *   - LOST AUTHORITY, which is `authority` (K16) and which CLEARS `SAT`,
 *     because an output resting at a limit it was never allowed to leave is
 *     not a saturated output.
 *   - the PHYSICAL LAGS, which the controller's output never touches.
 *   - the MINIMUM-FLOW OVERRIDE, which acts on the setpoint.
 *
 * On a speed loop the bottom of `op-travel` IS the drive's declared turndown,
 * so `SAT -1` there means "at the turndown". That is not the actuator limit
 * leaking into `SAT`: it is the controller's own configured floor, which was
 * deliberately set to the same number so the algorithm can see the stop it is
 * winding against. `vsd-turndown` records that as the one intentional
 * double-enforcement in the runtime.
 */
export const SATURATION_IS_CONTROLLER_TRAVEL = true

/** The constraints the PI anti-windup predicate must observe, by id. Pinned by
 *  test against the predicate's actual behaviour rather than its source. */
export const WINDUP_OBSERVED: readonly string[] =
  CONSTRAINTS.filter((c) => c.antiWindup === 'observes').map((c) => c.id)

/** Every constraint that comes from an engineering record, with its field. */
export const ENGINEERING_SOURCED: readonly { id: string; source: string }[] =
  CONSTRAINTS.flatMap((c) => (c.source === null ? [] : [{ id: c.id, source: c.source }]))
