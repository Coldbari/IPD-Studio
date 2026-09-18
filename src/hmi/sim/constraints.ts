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
    // On a MASTER only, as `dsFloorPct`: its output is the slave's setpoint,
    // so a floor under that setpoint is a stop under its output (K18, widened
    // by K24 to carry the slave's `spLow` and `spHigh` as well).
    antiWindup: 'observes',
  },
  {
    id: 'sp-limits',
    layer: 'setpoint',
    what: 'the band this loop may be operated over — what it may be ASKED for',
    owner: 'engine: the controller stage, where the setpoint is READ, so every path meets it once',
    source: 'signal.spLow / signal.spHigh',
    unit: 'the loop’s own setpoint unit',
    absent: 'no engineering limit on that side — never zero, never the end of the calibrated range, and never the other limit mirrored',
    /**
     * A SETPOINT constraint creates no windup of its own: the loop controls to
     * the limited setpoint and reaches it normally, so the output is never
     * against a stop. The ONE case where it would is a cascade master whose
     * slave caps the setpoint it is being sent — see `CASCADE_SP_CEILING_GAP`.
     */
    antiWindup: 'n/a',
  },
  {
    id: 'calibrated-range',
    layer: 'setpoint',
    what: 'nothing, as a control constraint — it bounds an entry widget and scales a cascade map',
    owner: 'the faceplate’s entry field, and K17’s cascade map. NOT the engine.',
    source: 'signal.range',
    unit: 'the loop’s own setpoint unit',
    absent: 'the tag falls back to its measure’s default span; either way this is a CAPABILITY statement about an instrument and never an operating limit',
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
 * THE FOUR THINGS THAT ARE NOT EACH OTHER — K23 finished what K22 found.
 *
 * K22 recorded that this product had NO engineering setpoint limits and that
 * three separate things were being made to stand in for them. K23 introduced
 * the real one, so the statement now reads:
 *
 *   1. `signal.spLow` / `signal.spHigh` — the OPERATING LIMITS. An AUTHORITY
 *      statement: what this loop may be ASKED for. Enforced in the engine
 *      where the setpoint is read, so an operator, a scenario, a direct write
 *      and a cascade master all meet it exactly once.
 *   2. `signal.range` — the CALIBRATED RANGE. A CAPABILITY statement about the
 *      INSTRUMENT: what it can MEASURE. It bounds the faceplate's entry widget
 *      and is the span K17 scales a master's output onto. It is not, and after
 *      K23 is not mistaken for, a control constraint.
 *   3. `signal.setpoint` — where the loop STARTS (K15). Not a bound, and a
 *      starting value outside the operating limits starts where the record
 *      says and is then held, rather than being silently normalised.
 *   4. `duty.minFlow` — a requirement of the MACHINE, which raises the
 *      setpoint after the operating limits have bounded it (K18).
 *
 * A transmitter's range is a statement about an instrument. Treating it as a
 * controller's permitted span would be the same category error as treating
 * `duty.minFlow` as a VSD minimum speed.
 *
 * WITH NO LIMITS STATED nothing changed: a loop asked for more than the plant
 * can make still runs its output to the top of its travel and reports `SAT +1`,
 * telling the operator the setpoint is unreachable. That is K22's behaviour and
 * K23 preserved it exactly — only a CONFIGURED limit constrains anything.
 */
export const SETPOINT_CONCEPTS_ARE_DISTINCT = true

/**
 * THE GAP K23 MEASURED AND K24 CLOSED — and the rule that came out of it.
 *
 * A cascade master's output IS its slave's setpoint, so anything that stops
 * the slave ACCEPTING that setpoint is a stop on the master's output. K18
 * built that projection for one such constraint, `duty.minFlow`; K23 added two
 * more, `signal.spLow` and `signal.spHigh`, and did not project them.
 *
 * MEASURED on the K15 cascade, identical plant and identical demand, with only
 * the slave's constraint differing:
 *
 *     slave floored at 30 by…      master came to rest at
 *     nothing                       OP  0.00   I  8.35   SAT -1
 *     duty.minFlow  (projected)     OP 48.99   I 62.37   SAT  0
 *     signal.spLow  (NOT)           OP  0.00   I 12.06   SAT -1
 *
 * The same fact about the slave produced opposite master behaviour, and on
 * release the unprojected case cost 50 s of dead time before the setpoint
 * moved at all. `dsFloorPct` and `dsCeilPct` now carry all three.
 *
 * ── AND THE RULE ──────────────────────────────────────────────────────────
 *
 * ONLY CONSTRAINTS THAT STOP THE SETPOINT BEING ACCEPTED COUNT. Three others
 * were measured and are deliberately excluded:
 *
 *   - A SATURATED SLAVE ACTUATOR. The setpoint was accepted in full and the
 *     plant cannot reach it, so the master's demand is genuine and it should
 *     wind to its own ceiling.
 *   - A RATE-LIMITED SLAVE OUTPUT. The setpoint was accepted in full and the
 *     slave is moving toward it; stopping the master through every ordinary
 *     transient would be the windup cure causing the disease.
 *   - A SLAVE WITH NO AUTHORITY. K16 and K17 already make the master's own
 *     authority `downstream` and HOLD its integrator, which is stronger than
 *     a stop and must not be duplicated.
 *
 * It is NOT saturation, and `SAT` does not report it — a master resting at
 * 50 % because its slave will not take more has half its travel left. The
 * condition is published as `downstreamLimited` and explained by the
 * `cascade-downstream-limited` finding.
 */
export const DOWNSTREAM_SETPOINT_STOPS_ARE_PROJECTED = true

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

/**
 * THE THREE WAYS A CASCADE'S DOWNSTREAM CAN FAIL TO DELIVER — K25.
 *
 * They arrive from three different phases, mean three different things, and a
 * master must respond to each differently. K25 audited them for accidental
 * coupling and found none; this records the taxonomy so a fourth condition
 * cannot quietly be folded into one of them.
 *
 * ── A. DOWNSTREAM UNAVAILABLE ─────────────────────────────────────────────
 *
 *   The slave cannot act at all: it is in MANUAL, or it has lost its own
 *   authority (de-energised, stuck, unsolved).
 *
 *   PRODUCED BY  K16/K17, in the AUTHORITY stage, before the algorithm runs.
 *                `authorityOf` returns `downstream` when `downstreamFollowing`
 *                is false.
 *   MASTER DOES  takes the `authority !== 'available'` branch: output and
 *                integrator are HELD outright, `SAT` cleared.
 *   REPORTED AS  `authority: 'downstream'` and K16's info row.
 *
 * ── B. DOWNSTREAM SETPOINT LIMITED ────────────────────────────────────────
 *
 *   The slave is working, and REFUSES part of the setpoint: `signal.spLow`,
 *   `signal.spHigh` (K23) or `duty.minFlow` (K18).
 *
 *   PRODUCED BY  K18/K24, projected onto the master's own output scale at
 *                wiring time as `dsFloorPct`/`dsCeilPct`.
 *   MASTER DOES  stops integrating at the projection — the existing predicate,
 *                with those as its stops.
 *   REPORTED AS  `downstreamLimited` and `cascade-downstream-limited`.
 *
 * ── C. DOWNSTREAM PHYSICALLY LIMITED ──────────────────────────────────────
 *
 *   The slave ACCEPTED the setpoint in full and cannot realise it: its own
 *   output is saturated, its actuator is lagging, or the process simply will
 *   not reach the value.
 *
 *   PRODUCED BY  nothing upstream, deliberately.
 *   MASTER DOES  goes on integrating to its own ceiling, because its demand is
 *                genuine — this is the case where winding up is CORRECT.
 *   REPORTED AS  the slave's own `SAT`, and the master's own `SAT` when it
 *                reaches its travel.
 *
 * ── PRECEDENCE, ENFORCED BY CONTROL FLOW RATHER THAN BY A RULE ────────────
 *
 *     A  >  B  >  C
 *
 * and it is structural: the authority branch `continue`s before the algorithm
 * runs, so a master whose slave is unavailable never computes `dsLimited` at
 * all — `downstreamLimited` is simply absent that tick rather than competing
 * with the authority verdict. MEASURED: a slave both de-energised AND
 * setpoint-limited reports `authority: downstream` with no `downstreamLimited`,
 * and the operator gets one row naming the real problem.
 *
 * B and C COMPOSE rather than compete: a slave can refuse part of a setpoint
 * AND be saturated at what it accepted, and both are published — the master's
 * `downstreamLimited` and the slave's own `SAT`. Measured together and kept
 * apart.
 *
 * ── THE DISTINCTION THAT MATTERS MOST ─────────────────────────────────────
 *
 * B and C look identical from the plant and are opposite in the control room:
 *
 *     setpoint limited   slave `spLimit.limiting` true, requested != effective
 *                        master `downstreamLimited` true, `SAT` 0
 *     physically limited slave `spLimit` absent, requested == effective
 *                        master `downstreamLimited` absent, `SAT` 1
 *
 * An actuator that has not reached its command is NEVER evidence that a
 * setpoint was refused. A lagging actuator has `requested == effective` and
 * `actual != requested`; a refused setpoint has `requested != effective`. The
 * two are read from different fields and must never be inferred from one
 * another.
 */
export const DOWNSTREAM_CONDITIONS_ARE_THREE = true

/**
 * WHERE THE ONE-LEVEL PROJECTION STOPS — K25's architectural boundary.
 *
 * `dsFloorPct` and `dsCeilPct` are computed at WIRING TIME from the slave's
 * STATICALLY CONFIGURED record fields. That is exactly right for one level and
 * does not compose to two, for a reason worth writing down before anybody
 * tries.
 *
 * In a chain A → B → C, A would need B's EFFECTIVE ACCEPTED INTERVAL — which
 * is narrower than B's configured one whenever C is constraining B, and which
 * changes as C's state changes. A wiring-time projection of static record
 * fields cannot express a runtime quantity; composing would need the interval
 * derived each tick and propagated up the chain, which is a different
 * mechanism rather than a wider version of this one.
 *
 * NONE OF THIS IS REACHABLE TODAY, and not by accident: `cascadeProblem`
 * refuses any slave whose `outKind` is not `pump`, so a middle controller —
 * which would drive another controller's setpoint and therefore be `cascade` —
 * is rejected at wiring time with a stated reason. K17 ships one topology and
 * says so.
 *
 * So the boundary is clean: the representation is correct and complete for the
 * architecture that exists, and a three-level cascade is a new mechanism and
 * not an extension of this one. K25 deliberately did not generalise it.
 */
export const PROJECTION_IS_ONE_LEVEL = true

/** The constraints the PI anti-windup predicate must observe, by id. Pinned by
 *  test against the predicate's actual behaviour rather than its source. */
export const WINDUP_OBSERVED: readonly string[] =
  CONSTRAINTS.filter((c) => c.antiWindup === 'observes').map((c) => c.id)

/** Every constraint that comes from an engineering record, with its field. */
export const ENGINEERING_SOURCED: readonly { id: string; source: string }[] =
  CONSTRAINTS.flatMap((c) => (c.source === null ? [] : [{ id: c.id, source: c.source }]))
