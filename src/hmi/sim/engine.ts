// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiScreen } from '../model'
import type { Measures, TagDef } from './tags'
import { buildTagDefs } from './tags'
import type { Registry } from '../../model/registry'
import type { FlowNetwork } from './network'
import { buildNetwork } from './network'
import type { ProcessEdge, ProcessModel } from './hydraulic/model'
import { buildProcessModel } from './hydraulic/model'
import type { SolveResult } from './hydraulic/solver'
import { solveHydraulics } from './hydraulic/solver'
import type { Fluid } from '../../model/types'
import type { PumpFluid } from './hydraulic/fluidhead'
import { pumpFluids, resolvePumpHeadBar } from './hydraulic/fluidhead'
import type { ProcessFault } from './quality'
import type { ControlAuthority, LoopState } from './authority'
import { authorityOf } from './authority'
import type { MinFlowDemand } from './minflow'
import type { SetpointLimit } from './authority'
import { BOUNDS, DEFAULTS, SECONDS_PER_HOUR, clamp, volumeMoved } from './units'
import { pipeTemperatures, tankPressureBar, tankTempRate } from './process'

export interface ControllerSpec {
  tag: string
  pvTag: string
  outTag?: string
  /**
   * What the output drives.
   *
   * A temperature loop with no valve in its family modulates the heater that
   * warms the vessel it measures. A PRESSURE loop with no valve in its family
   * commands the SPEED of the machine that makes the pressure it measures —
   * `pump`, K14 — and writes `SPD`, never `RAMP`: the drive remains
   * responsible for turning a command into a shaft, exactly as K12 left it.
   */
  outKind?: 'valve' | 'heater' | 'pump' | 'cascade'
  /**
   * CASCADE — K17.
   *
   * `cascadeTo` is the SLAVE whose setpoint this controller's output sets;
   * `cascadeFrom` is the MASTER on the other end of that link. A master's
   * `outKind` is `cascade` and its `outTag` is the slave, so the ONE place
   * that writes a final element never sees a master at all: the slave is the
   * sole writer of the drive, exactly as §3 requires.
   *
   * `cascadeProblem` is why a DECLARED cascade could not be built. A refused
   * cascade leaves the master driving NOTHING rather than quietly falling back
   * to the drive — the fallback would be the direct master → VSD shortcut the
   * whole phase exists to prevent.
   */
  cascadeTo?: string
  cascadeFrom?: string
  cascadeProblem?: string
  /**
   * MINIMUM-FLOW PROTECTION — K18. All three are STATIC: they come from the
   * wiring and the engineering records, neither of which changes while the
   * plant runs, so `wireMinFlow` decides them once and the tick only applies
   * them.
   *
   * `minFlow` is the declared minimum, in THIS loop's own setpoint units, on a
   * FLOW loop that drives a machine whose record states one. It is the floor
   * the setpoint is raised to and nothing else: no controller, no gain, no
   * hysteresis. See `sim/minflow.ts`.
   *
   * The floor expressed on a CASCADE MASTER's output scale is `dsFloorPct`;
   * see it below, where K24 widened it past minimum flow.
   *
   * `minFlowProblem` is a DECLARED minimum that could not be applied to this
   * loop. Like `cascadeProblem`, a refusal is carried rather than silently
   * turned into an approximation.
   */
  minFlow?: number
  minFlowProblem?: string
  /**
   * THE SLAVE'S SETPOINT CONSTRAINTS, ON THIS MASTER'S OUTPUT SCALE — K24.
   *
   * A cascade master's output IS its slave's setpoint, so anything that stops
   * the slave accepting that setpoint is a stop on the master's output. The
   * inverse of the map `drive()` applies, and the same number in the master's
   * own units.
   *
   * K18 built this for ONE such constraint, `duty.minFlow`, and called it
   * `minFlowFloorPct`. K23 then added two more — `signal.spLow` and
   * `signal.spHigh` on the slave — and did not project them, so a master
   * wound across the whole unusable part of its range against them. MEASURED
   * on the K15 cascade, same plant and same demand: with the slave floored by
   * `minFlow` the master came to rest at OP 49 with its integrator at 62;
   * with the slave floored identically by `spLow` it ran to OP 0 and 12, and
   * took 50 s of dead time to recover. Two constraints that are the same fact
   * from the master's point of view behaved oppositely, purely because one
   * predated the mechanism.
   *
   * `dsFloorPct` is the HIGHEST floor any of them imposes and `dsCeilPct` the
   * LOWEST ceiling, because a master must respect all of them at once.
   *
   * They are used for ONE thing — deciding whether the integrator may keep
   * winding — and NEVER to clamp the output, exactly as K18 established: `op`
   * stays the master's genuine request so `commandedSp` keeps saying what the
   * master wanted while `effectiveSp` says what the slave is carrying.
   */
  dsFloorPct?: number
  dsCeilPct?: number
  /**
   * OUTPUT RATE LIMIT — K21, %/s, from THIS controller's own record
   * (`signal.outputRateLimit`). Static for a run, like everything above.
   *
   * A CONTROL-layer constraint on how fast the COMMAND may change, applied
   * between the algorithm and the final element. It is not the actuator's own
   * dynamics: K12's drive still takes `RAMP_S` to move the shaft and a valve
   * still strokes at `STROKE_RATE`, and both happen underneath this to
   * whatever command comes out of it.
   *
   * Absent means unconstrained, and then every line below is byte-for-byte the
   * line K14 through K20 already executed.
   */
  outputRatePctPerS?: number
  /**
   * ENGINEERING SETPOINT LIMITS — K23, in this loop's own setpoint unit, from
   * its own record (`signal.spLow` / `signal.spHigh`). Static for a run.
   *
   * An AUTHORITY constraint on what the loop may be ASKED for, applied where
   * the setpoint is READ so that every path reaching it — an operator, a
   * scenario, a direct write, a cascade master — meets the same limit once.
   * That single point is the whole of K23: before it, the operator's path was
   * bounded by a widget and every other path by nothing.
   *
   * Either side may be absent, and absent means no limit on that side.
   */
  spLow?: number
  spHigh?: number
  /**
   * OUTPUT RANGE, per cent. Defaults 0 and 100, which is every loop that
   * existed before K14 and is what a valve's travel is.
   *
   * A speed loop's floor is the turndown the machine's record STATES, so the
   * controller's own saturation limit is the same number the drive will
   * enforce. With the two apart, the algorithm would wind down against a limit
   * it could not see and its output would stop meaning the speed of the pump.
   * With none stated, the floor is 0 and no limit is invented — K12's rule.
   */
  outMin?: number
  outMax?: number
  /**
   * THE MACHINE THIS LOOP'S MEASUREMENT DEPENDS ON — K16.
   *
   * A pressure or flow transmitter sitting on one machine's own stream reads
   * what that machine is making, and a STOPPED PUMP BLOCKS in this model. So
   * with this machine de-energised there is nothing the loop's output can do
   * about that reading, whatever its own actuator is capable of.
   *
   * The same answer `speedLoopCandidate` and `flowLoopCandidate` already give,
   * carried here rather than asked for a second time. Absent for a level, a
   * temperature, or a transmitter no single machine owns — and often the same
   * tag as `outTag`, which is harmless: it is one question asked once.
   */
  pvDriver?: string
  /** +1 = reverse-acting (open the valve to raise the PV); -1 = direct
   *  (close it to raise the PV). Derived from the flow network — a drain valve
   *  on the measured tank, or a pressure tap on the pump's discharge side,
   *  both invert the loop. */
  action?: 1 | -1
}
export interface SimModel {
  defs: TagDef[]
  /**
   * The branch projection. Still built, and still what answers questions about
   * ROUTES — which vessel a path serves for the thermal model, what the
   * Overview flowsheet draws, which way a controller must act. It decides no
   * number: every flow and every pressure now comes from `hydraulic`.
   */
  net: FlowNetwork
  /** The pressure-node / flow-edge topology the hydraulic solve runs on.
   *  Compiled ONCE with the model; never rebuilt per tick. */
  hydraulic: ProcessModel
  controllers: ControllerSpec[]
  /**
   * K31 — which liquid each pump is passing, by tag, and therefore which
   * density converts its head.
   *
   * Compiled once with the model, exactly like the topology, because a service
   * comes from the DRAWING and not from the flow: an operator watching a line
   * reverse should see the arrows turn, not the pressure change. Empty when the
   * caller passed no service list, which is every path that has not been given
   * one — and that is why `resolvePumpHeadBar` treats a missing entry and an
   * unresolvable one identically.
   */
  pumpFluid: Map<string, PumpFluid>
}

/**
 * The head a pump's record actually promises, bar — K31.
 *
 * One helper because there are two solves (the calm start and the tick) and
 * they must agree to the last digit: a seeded plant that disagreed with its own
 * first tick would drift on frame one for reasons no test could read back.
 */
export function pumpHeadBar(def: TagDef | undefined, fluid: PumpFluid | undefined): number {
  return resolvePumpHeadBar(def?.head ?? DEFAULTS.pumpHeadBar, def?.headM, fluid).bar
}
export type Tags = Record<string, Record<string, number>>

/**
 * CONTROLLER TUNING, per measured quantity.
 *
 * `kp` is dimensionless — per cent of output per cent of PV SPAN — because the
 * error is normalised by the instrument's range before it reaches the
 * algorithm. That is what lets one set of numbers serve a 0-100 % level and a
 * 0-10 bar pressure without a gain that silently means something different in
 * each. `ti` is the integral time in seconds.
 *
 * The values are sized to the process time constants that came with real
 * units: a 100 m³ vessel on a 50 m³/h pump moves about 0.014 %/s, so a level
 * loop that used to be tuned for a tank filling in thirty seconds is now far
 * too slow to be left as it was. Flow and pressure are fast loops; temperature
 * is the slow one. They are starting points for a training simulation, not a
 * claim about any real plant's tuning.
 */
const TUNING: Record<Measures, { kp: number; ti: number }> = {
  // Level and temperature are INTEGRATING processes — the valve sets a RATE of
  // change, not a value — so they take a large proportional gain and a long
  // integral time without going unstable.
  level: { kp: 6, ti: 600 },
  temperature: { kp: 5, ti: 900 },
  // Flow and pressure are self-regulating and fast, and the loop gain has to
  // respect that. Over a default instrument span, full valve travel moves
  // pressure about a third of the range and flow about half of it, so gains
  // of 3 and 1.5 put the loop gain above one and the loop oscillates at the
  // sample rate. These were measured against the model, not guessed: a
  // two-tick limit cycle is invisible to any test that samples on even ticks,
  // which is why `pressure.test.ts` checks the SPREAD of the settled value.
  pressure: { kp: 1, ti: 60 },
  flow: { kp: 0.8, ti: 30 },
}
/** A controller whose ISA letter names nothing this model simulates. */
const DEFAULT_TUNING = { kp: 2, ti: 120 }

/**
 * THE SPEED LOOP'S OWN TUNING — K14.
 *
 * SEPARATE FROM `TUNING.pressure` ABOVE, AND NOTHING ABOVE WAS TOUCHED. That
 * table is indexed by what a loop MEASURES, and this loop measures pressure
 * like any other; what differs is what it DRIVES. A valve's travel and a
 * drive's speed are not the same actuator and one number cannot mean both.
 *
 * ── THE BASIS: MEASURED, NOT CHOSEN ───────────────────────────────────────
 *
 * Tuned against the fixture in `tests/hmi/speedControl.test.ts` — a 40 m³/h,
 * 35 m machine between two stated boundaries, discharge transmitter on a
 * 0-10 bar span — by finding where the loop goes unstable and backing off.
 *
 *   PROCESS GAIN, measured: 15 % of output moved the transmitter 0.62 bar,
 *   so about 0.4 % of span per % of output.
 *
 *   kp   ti    step 2.6→3.2 bar        step 2.3→3.6 bar
 *   ───────────────────────────────────────────────────────────────────
 *   1.2  25    188 s,  no overshoot    234 s,  no overshoot    sluggish
 *   1.8  12     64 s,  9 % overshoot   102 s,  5 % overshoot   ← chosen
 *   2.5   8     42 s, 17 % overshoot   209 s, 12 % overshoot   degrading
 *   3.5   6     never settles, 116 % overshoot, 1.46 bar swing UNSTABLE
 *
 * 3.5 is the limit cycle at the sample rate that the `pressure` entry above
 * warns about, reached here rather than assumed. 1.8 sits at roughly HALF the
 * gain that produces it — an ordinary gain margin — and the settled spread it
 * leaves, 0.11 bar, is the transmitter's own 0.8 %-of-span noise rather than
 * anything the loop is doing.
 *
 * `ti` is an order above the drive's `RAMP_S` lag of 2 s on purpose: an
 * integrator faster than the actuator chases a shaft that has not arrived.
 *
 * Checked at dt = 0.2 s as well as dt = 1 s (64 s and 63 s to settle), so the
 * numbers are not an artefact of the step the tests integrate at.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * A STARTING POINT FOR A TRAINING SIMULATION, NOT A CLAIM ABOUT ANY PLANT.
 * Loop gain here depends on the duty point, the valve resistance, the boundary
 * pressures and the vessel configuration, and a different plant needs
 * different numbers. The tuning TARGET is written down in the test file —
 * stable, bounded overshoot, no sustained oscillation, settled inside the
 * measurement noise — so it can be re-measured rather than taken on trust.
 */
const SPEED_TUNING = { kp: 1.8, ti: 12 }

/**
 * THE FLOW LOOP'S OWN TUNING — K15.
 *
 * A THIRD ENTRY, not a reuse of either neighbour. `TUNING.flow` is a flow loop
 * driving a VALVE; `SPEED_TUNING` is a PRESSURE loop driving a drive. Neither
 * describes flow driving a drive, and the measurement below is why that
 * matters rather than being tidiness.
 *
 * ── PROCESS GAIN, MEASURED OPEN-LOOP ──────────────────────────────────────
 *
 * The loop in MANUAL, the output walked across its range, the transmitter read
 * at each step on `tests/hmi/flowControl.test.ts`'s fixture (0-60 m³/h span):
 *
 *   output   20 %    40 %    60 %    80 %   100 %
 *   FT      8.82   17.31   26.00   34.39   43.05  m³/h
 *
 * 0.71 % of span per % of output — nearly TWICE the pressure loop's 0.4 %, and
 * very nearly a straight line, because capacity goes as speed where head goes
 * as speed squared. Reusing K14's 1.8 would put the loop gain at 1.28 and it
 * does exactly what a loop gain above one does: 112 % overshoot and a 22 m³/h
 * swing that never settles. That was measured too, not feared.
 *
 *   kp   ti    step 20→30 m³/h            step 15→38 m³/h
 *   ─────────────────────────────────────────────────────────────────────
 *   1.8  12    never settles, 112 % overshoot, 22 m³/h swing   UNSTABLE
 *   1.3  12    299 s, 17 % overshoot      299 s, 6 % overshoot  degrading
 *   1.0  12    102 s,  5 % overshoot      112 s, 2 % overshoot  ← chosen
 *   0.8  12    102 s,  3 % overshoot      112 s, 1 % overshoot  fine, slower
 *   0.7  16    131 s,  3 % overshoot      188 s, 1 % overshoot  sluggish
 *
 * 1.0 puts the loop gain at 0.71 — the same margin K14 settled on, and 1.8×
 * below where this fixture goes unstable. Checked at dt = 0.2 s as well as
 * dt = 1 s (94 s and 102 s to settle).
 *
 * `ti` is shared with `SPEED_TUNING` and for the same reason: the dominant lag
 * is the DRIVE's, not the process's — the hydraulics are quasi-steady, so both
 * loops are waiting on the same 2 s ramp.
 *
 * NOT UNIVERSAL, and this loop's gain is even more plant-dependent than K14's:
 * it is set by the machine's rated capacity and by how much resistance stands
 * in front of it. A 400 m³/h machine on the same instrument span would need a
 * tenth of this. See the limitation recorded in `docs/HMI-AUDIT.md`.
 */
const FLOW_SPEED_TUNING = { kp: 1.0, ti: 12 }

/**
 * THE CASCADE MASTER'S OWN TUNING — K17.
 *
 * A FOURTH entry, and a fourth kind of output. `TUNING` is indexed by what a
 * loop MEASURES; `SPEED_TUNING` and `FLOW_SPEED_TUNING` by what it DRIVES. A
 * cascade master drives neither an actuator nor a machine — it drives ANOTHER
 * CONTROLLER. Nothing above describes that, and nothing above was touched.
 *
 * ── PROCESS GAIN, MEASURED OPEN-LOOP ──────────────────────────────────────
 *
 * The master in MANUAL, its output walked, the slave holding each setpoint it
 * was given, the discharge transmitter read once settled:
 *
 *   master OP   20 %    35 %    50 %    65 %    80 %   100 %
 *   slave SP    12.0    21.0    30.0    39.0    48.0    60.0  m³/h
 *   FT          12.0    21.2    29.9    39.0    43.3    43.4  m³/h
 *   PT         2.144   2.435   2.901   3.523   3.856   3.864  bar
 *
 * 0.31 % of the pressure span per % of master output over the controllable
 * part, and the slave tracks its setpoint exactly — which is the cascade
 * working. Above about 72 % the machine runs out and the SLAVE reports `SAT`;
 * nothing is invented to hide that ceiling.
 *
 * ── WHAT ACTUALLY CONSTRAINS THIS LOOP ────────────────────────────────────
 *
 * Not the usual cascade rule. The received wisdom is "make the master several
 * times slower than the slave", and it does not bind here, because THE INNER
 * LOOP CONTRIBUTES ALMOST NO LAG: the hydraulics are quasi-steady and the
 * drive covers its whole travel in two seconds, so the slave settles within a
 * couple of ticks of being given a setpoint. What binds instead is the
 * MASTER'S PROPORTIONAL PATH, which with no inner lag between it and the plant
 * closes a second loop at the sample rate:
 *
 *   kp   ti    step 2.5→3.2 bar          step 2.3→3.5 bar
 *   ─────────────────────────────────────────────────────────────────────
 *   1.2  10    never settles, 100 % overshoot, 1.39 bar swing   UNSTABLE
 *   0.8  10    never settles, 100 % overshoot, 1.37 bar swing   UNSTABLE
 *   0.5   5     53 s, 12 % overshoot      60 s,  9 % overshoot  fast
 *   0.5  10     99 s, 12 % overshoot     123 s,  8 % overshoot  ← chosen
 *   0.5  20    214 s, 12 % overshoot     266 s,  7 % overshoot  slower
 *   0.3  10    166 s, 11 % overshoot     214 s,  7 % overshoot  slower
 *
 * `ti` moves the speed and barely touches the stability; `kp` decides it, and
 * the boundary is between 0.5 and 0.8. 0.5 keeps a gain margin of about 1.6
 * against a limit cycle that was REACHED rather than assumed, and leaves a
 * settled spread of 0.09-0.13 bar, which is the transmitter's own noise.
 *
 * The resulting loop gain is 0.16 — far below the 0.7 K14 and K15 chose, and
 * the table above is why: those two had an actuator's lag between them and
 * their plant, and this one has none.
 *
 * Checked at dt = 0.2 s as well as dt = 1 s (105 s and 99 s to settle).
 *
 * NOT UNIVERSAL. Like every other entry here it is a starting point measured
 * against one fixture, and a plant whose inner loop is genuinely slow would
 * want the opposite treatment.
 */
const CASCADE_TUNING = { kp: 0.5, ti: 10 }

/** Equipment dynamics: pump spin-up seconds, coast-down seconds, valve
 *  stroke %/s, and the deviation band+delay that raises a valve DEV alarm. */
const RAMP_S = 2
/** A commanded stop coasts; a TRIP does not (the breaker opens). That is the
 *  difference between STOPPING and TRIPPED, and it is why the state machine
 *  in sim/state.ts can tell them apart. */
const COAST_S = 3
const STROKE_RATE = 25
const DEV_LIMIT = 10

/**
 * Measurement noise, as a fraction of the instrument's span.
 *
 * NOISE ON A MEASUREMENT, never a process. It is added to a value the process
 * actually produced, at the last moment, where a real transmitter adds it.
 * The audit found the opposite arrangement — a random walk WAS the pressure —
 * which is why a pressure controller could drive a valve for ever without the
 * pressure responding.
 */
const NOISE_FRACTION = 0.008

/**
 * Longest integration step, seconds.
 *
 * `tick` sub-steps anything longer, so a 300× training speed integrates the
 * same equations at the same resolution as 1× and only the CLOCK moves faster.
 * Without this, a 60-second step would stroke a valve through its whole travel
 * in one go and integrate a tank as a single rectangle.
 */
const MAX_STEP_S = 1

/** Compile one screen — or the whole plant (every screen) so RUN keeps
 *  simulating while the operator navigates between pages. Tag defs merge
 *  globally; flow networks stay per-screen (pipe coordinates are page-local),
 *  branch ids are re-namespaced so concatenation cannot collide. */
export function buildSimModel(
  screens: HmiScreen | HmiScreen[],
  registry?: Registry,
  /**
   * K31 — the project's service list. OPTIONAL, and absent is the honest
   * default rather than a gap: most callers here are validators and diagnostic
   * passes that ask topological questions, and a plant with no stated service
   * converts its heads on the declared legacy basis exactly as it always has.
   * Only a RUN needs this, and `simStore.enterRun` passes it.
   */
  fluids?: readonly Fluid[],
): SimModel {
  const list = Array.isArray(screens) ? screens : [screens]
  const defs = buildTagDefs(list, registry)
  const branches = list.flatMap((sc, i) =>
    buildNetwork(sc).branches.map((b) => ({ ...b, id: `S${i}:${b.id}` })),
  )
  const net: FlowNetwork = { branches }
  // the registry comes too: a TAGGED TERMINAL's boundary pressure is on its
  // engineering record, and the topology is where that becomes a fixed node
  const hydraulic = buildProcessModel(list, registry)
  /**
   * CASCADE FIRST — K17. A master's output is the slave's setpoint, so its
   * `outTag` is already set before `wirePumps` and `wireFlowPumps` run, and
   * they leave it alone by the rule they already have. That ordering is what
   * makes the direct master → VSD shortcut impossible by construction rather
   * than by a check.
   */
  /**
   * CASCADE LAST, and that is not an accident either.
   *
   * A cascade can only be validated once the SLAVE is wired — the checks are
   * "does it have a measurement, does it drive something, is that a variable
   * speed drive" — so `wireCascade` runs after the two passes that answer
   * them. The master is nonetheless kept away from the drive throughout,
   * because both of those passes skip a controller whose record declares a
   * cascade. Order decides when the link is made; the skip decides that the
   * master can never be the drive's writer.
   */
  /**
   * MINIMUM-FLOW LAST — K18, and for the same kind of reason cascade is.
   *
   * The protection belongs to whichever loop ends up driving the machine, and
   * `resolveContention` can still take that drive away: two loops fighting
   * over one `SPD` are BOTH unwired, and an unwired loop protects nothing. So
   * the pass that reads the records runs after the pass that decides who is
   * actually driving.
   */
  const controllers = wireOutputRate(wireDownstreamStops(wireMinFlow(wireSpLimits(resolveContention(wireCascade(
    wireFlowPumps(wirePumps(wireHeaters(wireControllers(defs), defs, net), defs, hydraulic),
      defs, hydraulic), defs)), defs), defs), defs), defs)
    .map((c) => {
      const pvDef = defs.find((d) => d.name === c.pvTag)
      const driver = pvDef
        ? (speedLoopCandidate(pvDef, defs, hydraulic) ?? flowLoopCandidate(pvDef, defs, hydraulic))
        : undefined
      return {
        ...c,
        /**
         * A CASCADE MASTER'S DIRECTION is the same question K14 answers for a
         * speed loop — which side of the machine its transmitter is on —
         * because the machine at the end of the cascade IS that machine. The
         * answer is already in hand from `driver`; asking a second time would
         * be a second opinion about one fact.
         */
        action: c.outKind === 'cascade' ? (driver?.action ?? 1) : controllerAction(c, defs, net),
        ...outputRange(c, defs),
        ...(driver ? { pvDriver: driver.pump } : {}),
      }
    })
  return {
    defs, net, hydraulic,
    controllers: inCascadeOrder(controllers),
    pumpFluid: pumpFluids(hydraulic, fluids ?? []),
  }
}

/**
 * Which way the output has to move to raise the PV.
 *
 * Three cases the network can answer:
 *  - a valve on the measured tank's OUTLET drains it, so closing raises level;
 *  - a pressure tap on the pump's DISCHARGE side rises as the valve shuts,
 *    because the pump rides up its curve towards shutoff head;
 *  - everything else opens to raise.
 *
 * Getting this wrong does not merely detune a loop, it reverses it: the
 * controller drives the PV away from setpoint until it saturates.
 */
function controllerAction(c: ControllerSpec, defs: TagDef[], net: FlowNetwork): 1 | -1 {
  if (!c.outTag || c.outKind === 'heater') return 1
  const pvDef = defs.find((d) => d.name === c.pvTag)
  if (!pvDef) return 1
  // A SPEED loop's direction is decided by which side of the machine the
  // transmitter is on, and `speedLoopCandidate` is the one place that asks.
  if (c.outKind === 'pump') return c.action ?? 1
  const br = net.branches.find((b) => b.valves.includes(c.outTag!))

  if (pvDef.measures === 'pressure' && pvDef.bindPipe && br) {
    const at = br.pipeIds.indexOf(pvDef.bindPipe)
    // upstream of the throttling element: shutting the valve builds pressure
    if (at >= 0 && at < (br.valveIndex ?? Number.POSITIVE_INFINITY)) return -1
    return 1
  }

  const tank = pvDef.kind === 'tank' ? pvDef.name : pvDef.bindTank
  if (!tank) return 1
  return br && br.from.kind === 'tank' && br.from.tag === tank ? -1 : 1
}

/**
 * Family+loop matching: LIC-101 pairs with LT-101 (PV) and LV-101 (OP target).
 *
 * The PV partner must also MEASURE what the controller controls. Family+loop
 * alone is not enough, because an equipment tag can collide with an instrument
 * one: `TK-101` and `TIC-101` both parse to family T loop 101, so a
 * temperature controller on a sheet with a tank numbered 101 would quietly
 * take its PV from that vessel's LEVEL and regulate the wrong variable
 * entirely. A controller with no recognisable quantity keeps the old
 * behaviour and accepts any partner.
 */
export function wireControllers(defs: TagDef[]): ControllerSpec[] {
  const out: ControllerSpec[] = []
  const parse = (name: string) => /^([A-Z])[A-Z]*-?(\w+)$/.exec(name)
  for (const c of defs) {
    if (c.kind !== 'controller') continue
    const m = parse(c.name)
    if (!m) continue
    const [, family, loop] = m
    const partner = (pred: (d: TagDef) => boolean) =>
      defs.find((d) => {
        const pm = parse(d.name)
        return !!pm && pm[1] === family && pm[2] === loop && pred(d)
      })
    const measuresMatch = (d: TagDef) =>
      c.measures === undefined || d.measures === undefined || d.measures === c.measures
    const pv = partner((d) => (d.kind === 'display' || d.kind === 'tank') && measuresMatch(d))
    const valve = partner((d) => d.kind === 'valve')
    // PV-only wiring is valid: the controller tracks its measurement even
    // when no throttling valve shares the loop (its PI just has no output).
    if (pv) {
      out.push(valve
        ? { tag: c.name, pvTag: pv.name, outTag: valve.name, outKind: 'valve' }
        : { tag: c.name, pvTag: pv.name })
    }
  }
  return out
}

/**
 * Give a temperature controller with no valve in its loop the heater that
 * warms the vessel it measures.
 *
 * Association by the NETWORK rather than by tag family, because a heater does
 * not share a loop number with the controller the way `TIC-101` and `TV-101`
 * do — an electric heater is `EH-` or `E-` and would never match. What makes
 * it the right heater is that its duty lands in the vessel being measured,
 * which is a question the flow network can answer.
 */
function wireHeaters(controllers: ControllerSpec[], defs: TagDef[], net: FlowNetwork): ControllerSpec[] {
  return controllers.map((c) => {
    if (c.outTag) return c
    const pvDef = defs.find((d) => d.name === c.pvTag)
    if (pvDef?.measures !== 'temperature') return c
    const tank = pvDef.kind === 'tank' ? pvDef.name : pvDef.bindTank
    if (!tank) return c
    for (const b of net.branches) {
      const intoThis = b.to.kind === 'tank' && b.to.tag === tank
      const loopOnThis = b.from.kind === 'tank' && b.from.tag === tank && b.to.kind !== 'tank'
      if (!intoThis && !loopOnThis) continue
      const heater = b.heaters[0]
      if (heater) return { ...c, outTag: heater, outKind: 'heater' as const }
    }
    return c
  })
}

/**
 * THE MACHINE A PRESSURE CONTROLLER WOULD COMMAND THE SPEED OF, and whether
 * its record lets it.
 *
 * ONE question, asked in ONE place, by both callers that need it: `wirePumps`
 * below, which connects the loop, and the `pump-speed-no-drive` check, which
 * reports the case where it cannot. Two implementations would eventually
 * disagree about which pump a loop belongs to.
 *
 * ASSOCIATION BY THE TOPOLOGY, not by tag family — the same reasoning
 * `wireHeaters` is built on. A pump does not share a loop number with the
 * controller the way `PIC-101` and `PV-101` do, and `P-101` would collide with
 * `PIC-101` on family+loop anyway, which is exactly the kind of accidental
 * pairing `wireControllers` already guards against. What makes it the right
 * machine is that it produces the pressure being measured.
 *
 * ASKED OF THE HYDRAULIC MODEL, not the branch projection. The branch model
 * predates K7 and still counts a battery-limit terminal among a path's
 * `pumps`; the K7 topology knows a terminal from a machine. The question is
 * answered by walking OUT from the measured pipe WITHOUT CROSSING A PUMP,
 * which gives exactly the pressure zone the transmitter sits in — and then
 * asking which machine's discharge is in that zone.
 *
 * CAPABILITY IS STILL DECLARED. This finds the machine; `duty.vsd` decides
 * whether it may be driven. A fixed-speed pump is reported and left alone.
 */
export interface SpeedLoopCandidate {
  /** The machine whose pressure this controller measures. */
  pump: string
  /** True when its record declares a drive. False means the loop is REFUSED. */
  vsd: boolean
  /** +1 when raising the speed raises the PV — the transmitter is on the
   *  discharge side. -1 on the suction side, where a faster machine pulls the
   *  pressure down. */
  action: 1 | -1
}

export function speedLoopCandidate(
  pvDef: TagDef, defs: TagDef[], model: ProcessModel,
): SpeedLoopCandidate | undefined {
  if (pvDef.measures !== 'pressure' || pvDef.bindPipe === undefined) return undefined
  const edgeId = model.edgeOfPipe.get(pvDef.bindPipe)
  const edge = model.edges.find((e) => e.id === edgeId)
  if (!edge) return undefined
  const pumps = model.edges.filter((e) => e.kind === 'pump' && e.tag !== undefined)
  if (pumps.length === 0) return undefined

  const zone = pressureZone(model, edge.from, edge.to)
  const found = (tag: string, action: 1 | -1): SpeedLoopCandidate =>
    ({ pump: tag, vsd: defs.find((d) => d.name === tag)?.vsd === true, action })
  // DISCHARGE FIRST. A transmitter between two machines in series is reading
  // the discharge of the upstream one, and that is the machine whose speed
  // changes what it reads.
  for (const p of pumps) if (zone.has(p.to)) return found(p.tag!, 1)
  for (const p of pumps) if (zone.has(p.from)) return found(p.tag!, -1)
  return undefined
}

/**
 * Every node reachable from a starting pair WITHOUT CROSSING A PUMP.
 *
 * A pump is the boundary between two pressure zones — that is what it is for —
 * so not crossing one is what makes this answer "which side of which machine
 * is this transmitter on". Breadth-first over tens of edges, ONCE at model
 * build time; nothing here runs on the tick.
 */
function pressureZone(model: ProcessModel, ...from: string[]): Set<string> {
  const seen = new Set(from)
  const queue = [...from]
  while (queue.length > 0) {
    const n = queue.shift()!
    for (const e of model.edges) {
      if (e.kind === 'pump') continue
      const other = e.from === n ? e.to : e.to === n ? e.from : undefined
      if (other === undefined || seen.has(other)) continue
      seen.add(other)
      queue.push(other)
    }
  }
  return seen
}

/**
 * Give a pressure controller with no valve in its loop the VARIABLE-SPEED
 * machine that makes the pressure it measures.
 *
 * A valve in the loop still wins: a plant that has drawn `PIC-101` with
 * `PV-101` is controlling pressure by throttling, and K14 does not take that
 * away. This is for the loop that has a transmitter, a machine, and nothing to
 * throttle — which before K14 was a controller with no output at all.
 */
function wirePumps(controllers: ControllerSpec[], defs: TagDef[], model: ProcessModel): ControllerSpec[] {
  return controllers.map((c) => {
    if (c.outTag) return c
    /**
     * A DECLARED CASCADE MASTER IS NEVER GIVEN A DRIVE — K17.
     *
     * Its output is a setpoint; `wireCascade` connects it once the slave below
     * is wired. Skipping it HERE is what makes `PIC-1 → P-101.SPD` impossible
     * by construction rather than by a check somewhere downstream — and it
     * holds even when the declaration turns out to be unusable, because a
     * refused cascade must not silently become the shortcut it replaced.
     */
    if (defs.find((d) => d.name === c.tag)?.cascadeTo !== undefined) return c
    const pvDef = defs.find((d) => d.name === c.pvTag)
    if (!pvDef) return c
    const cand = speedLoopCandidate(pvDef, defs, model)
    // NOT VSD IS NOT WIRED. The controller keeps tracking its measurement and
    // drives nothing, which is what a loop with no final element does — and
    // `pump-speed-no-drive` says so rather than leaving it silent.
    if (!cand || !cand.vsd) return c
    // the direction comes from the SAME answer that chose the machine, so
    // `controllerAction` has nothing left to decide for a speed loop
    return { ...c, outTag: cand.pump, outKind: 'pump' as const, action: cand.action }
  })
}

/**
 * THE MACHINE WHOSE FLOW A FLOW TRANSMITTER IS MEASURING.
 *
 * ── A DIFFERENT QUESTION FROM K14'S, ASKED DIFFERENTLY ────────────────────
 *
 * `speedLoopCandidate` above walks a PRESSURE ZONE: everywhere reachable
 * without crossing a pump, because a pump is the boundary between two
 * pressures and every node on one side of it sees what the machine is making.
 * That is exactly the wrong question for flow. Pressure is shared across a
 * junction; FLOW DIVIDES AT ONE. A transmitter on the far side of a tee is not
 * measuring the machine's flow, it is measuring part of it, and a loop built
 * on that would be controlling a fraction it cannot see the rest of.
 *
 * So this walks THE MACHINE'S OWN STREAM: out from its discharge (and back
 * from its suction) node by node, stopping at the first thing that makes the
 * flow no longer the pump's — a branch, a vessel, a battery limit. If the
 * transmitter's edge is on that walk, it is carrying every cubic metre the
 * machine is passing and nothing else.
 *
 * Nothing here reads a coordinate, a widget position or a drawing order. Move
 * the whole P&ID and the answer is the same, because the answer is the
 * connectivity.
 *
 * ── ORIENTATION, AND THE GAP ──────────────────────────────────────────────
 *
 * `sense` is the sign a FORWARD-pumping machine puts on the transmitter's
 * edge, and it comes out of the walk for free: each step knows whether it left
 * the node by the edge's `from` end or its `to` end.
 *
 * It is NOT the instrument's installed orientation. This model does not have
 * one — `measurementOf` takes the magnitude and says why: a flow element does
 * not know which way round it was fitted, and no engineering record here
 * states it. That gap is real and is reported rather than papered over. What
 * `sense` gives is the sign of the CONTROLLED STREAM, derived from the
 * topology, which is what tells the loop whether the magnitude it is reading
 * is the flow it is trying to control or the same number flowing backwards.
 */
export interface FlowLoopCandidate {
  pump: string
  /** True when the machine's record declares a drive. */
  vsd: boolean
  /** The sign forward pumping puts on the measured edge. */
  sense: 1 | -1
  /** +1: more speed, more measured flow. Measured, not assumed — see the
   *  tuning notes and `tests/hmi/flowControl.test.ts`. */
  action: 1 | -1
  /** More than one machine's stream contains this transmitter. */
  ambiguous: boolean
}

export function flowLoopCandidate(
  pvDef: TagDef, defs: TagDef[], model: ProcessModel,
): FlowLoopCandidate | undefined {
  if (pvDef.measures !== 'flow' || pvDef.bindPipe === undefined) return undefined
  const ftEdge = model.edgeOfPipe.get(pvDef.bindPipe)
  if (ftEdge === undefined) return undefined

  const hits: { pump: string; sense: 1 | -1 }[] = []
  for (const p of model.edges) {
    if (p.kind !== 'pump' || p.tag === undefined) continue
    const down = walkStream(model, p, p.to, ftEdge)
    const up = down ?? walkStream(model, p, p.from, ftEdge)
    if (up !== undefined) hits.push({ pump: p.tag, sense: up })
  }
  const first = hits[0]
  if (!first) return undefined
  return {
    pump: first.pump,
    vsd: defs.find((d) => d.name === first.pump)?.vsd === true,
    sense: first.sense,
    // Raising the speed raises the flow through the machine's OWN stream, and
    // the transmitter reads that stream's magnitude either side of the
    // machine. Confirmed against the fixture rather than inherited from K14.
    action: 1,
    ambiguous: hits.length > 1,
  }
}

/**
 * Follow one machine's stream from `start`, and report the sign forward
 * pumping puts on `target` if the stream reaches it.
 *
 * Stops where the flow stops being the machine's: a node with anything other
 * than exactly one onward edge is a branch or a dead end, and a vessel or
 * boundary node is where the stream ends. `undefined` means the transmitter is
 * not on this machine's stream.
 */
function walkStream(
  model: ProcessModel, pumpEdge: ProcessEdge, start: string, target: string,
): 1 | -1 | undefined {
  /** Leaving the discharge, forward flow runs away from the node; arriving at
   *  the suction, it runs towards it. */
  const outward = start === pumpEdge.to
  let node = start
  let via = pumpEdge.id
  const seen = new Set<string>([pumpEdge.id])
  for (let step = 0; step < 64; step++) {
    if (model.nodes.find((n) => n.id === node)?.kind !== 'junction') return undefined
    const onward = model.edges.filter((e) => e.id !== via && (e.from === node || e.to === node))
    if (onward.length !== 1) return undefined     // a branch: the flow divides
    const e = onward[0]!
    if (seen.has(e.id)) return undefined
    seen.add(e.id)
    const leavesByFrom = e.from === node
    if (e.id === target) {
      // forward flow runs along `e` in its own `from → to` sense when it
      // leaves a discharge node by `from`, or arrives at a suction node by `to`
      return (outward ? leavesByFrom : !leavesByFrom) ? 1 : -1
    }
    if (e.kind === 'pump') return undefined       // another machine: not ours
    node = leavesByFrom ? e.to : e.from
    via = e.id
  }
  return undefined
}

/**
 * Give a FLOW controller with no valve in its loop the variable-speed machine
 * whose flow it measures.
 *
 * Same shape as `wirePumps`, same refusals: a valve in the loop still wins,
 * and a machine that has not declared a drive is left alone and reported.
 */
function wireFlowPumps(controllers: ControllerSpec[], defs: TagDef[], model: ProcessModel): ControllerSpec[] {
  return controllers.map((c) => {
    if (c.outTag) return c
    /**
     * A DECLARED CASCADE MASTER IS NEVER GIVEN A DRIVE — K17.
     *
     * Its output is a setpoint; `wireCascade` connects it once the slave below
     * is wired. Skipping it HERE is what makes `PIC-1 → P-101.SPD` impossible
     * by construction rather than by a check somewhere downstream — and it
     * holds even when the declaration turns out to be unusable, because a
     * refused cascade must not silently become the shortcut it replaced.
     */
    if (defs.find((d) => d.name === c.tag)?.cascadeTo !== undefined) return c
    const pvDef = defs.find((d) => d.name === c.pvTag)
    if (!pvDef) return c
    const cand = flowLoopCandidate(pvDef, defs, model)
    if (!cand || !cand.vsd || cand.ambiguous) return c
    return { ...c, outTag: cand.pump, outKind: 'pump' as const, action: cand.action }
  })
}

/**
 * ONE CONTROLLER PER DRIVE.
 *
 * Two loops writing one machine's `SPD` every tick is not control, it is a
 * race decided by iteration order — and the second one would silently undo the
 * first. K15 does not resolve it by picking a winner, because there is no
 * defensible rule for which loop should own a machine; it UNWIRES BOTH and
 * `pump-speed-contended` reports the configuration. Cascade — one loop trimming
 * another's setpoint — is the real answer and is deliberately not this phase.
 */
function resolveContention(controllers: ControllerSpec[]): ControllerSpec[] {
  const count = new Map<string, number>()
  for (const c of controllers) {
    if (c.outKind !== 'pump' || c.outTag === undefined) continue
    count.set(c.outTag, (count.get(c.outTag) ?? 0) + 1)
  }
  if ([...count.values()].every((n) => n < 2)) return controllers
  return controllers.map((c) =>
    c.outKind === 'pump' && c.outTag !== undefined && (count.get(c.outTag) ?? 0) > 1
      ? { tag: c.tag, pvTag: c.pvTag }
      : c)
}

/**
 * MASTERS BEFORE SLAVES.
 *
 * The cascade dependency is explicit and therefore has an explicit order: a
 * master's output IS its slave's setpoint, so the master has to execute first
 * or the slave spends a tick chasing yesterday's demand. One stable pass, and
 * a cycle cannot get here — `cascadeProblem` refuses those before wiring.
 *
 * Nothing else about the runtime order moves. This is a sort of ONE list, not
 * a scheduler: there is still exactly one pass over the controllers, inside
 * the one simulation step, on the one clock.
 */
function inCascadeOrder(controllers: ControllerSpec[]): ControllerSpec[] {
  if (!controllers.some((c) => c.outKind === 'cascade')) return controllers
  const out: ControllerSpec[] = []
  const placed = new Set<string>()
  const place = (c: ControllerSpec, depth: number): void => {
    if (placed.has(c.tag) || depth > controllers.length) return
    placed.add(c.tag)
    out.push(c)
    const slave = c.outKind === 'cascade' ? controllers.find((x) => x.tag === c.outTag) : undefined
    if (slave) place(slave, depth + 1)
  }
  // every master first, each dragging its own slave in behind it
  for (const c of controllers) if (c.outKind === 'cascade') place(c, 0)
  for (const c of controllers) if (!placed.has(c.tag)) { placed.add(c.tag); out.push(c) }
  return out
}

/**
 * CASCADE — a master whose output is another loop's SETPOINT.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────
 *
 *     PIC-1 → FIC-1.SP     and     FIC-1 → P-101.SPD
 *     never  PIC-1 → P-101.SPD
 *
 * The master does not touch the drive. The slave is the sole writer of the
 * final element, which is why this pass runs BEFORE `wirePumps` and
 * `wireFlowPumps`: once a master's `outTag` is the slave, those passes skip it
 * by the rule they already have ("a loop that already drives something is
 * left alone").
 *
 * ── DECLARED, NEVER INFERRED ──────────────────────────────────────────────
 *
 * A cascade comes from `signal.cascadeTo` on the master's record and from
 * nowhere else. Two loops that happen to measure the same plant and reach the
 * same machine are a CONTENTION — which K15 already reports — and not a
 * hierarchy to be guessed at.
 *
 * ── A REFUSED CASCADE DRIVES NOTHING ──────────────────────────────────────
 *
 * When the declaration cannot be honoured the master keeps `cascadeProblem`
 * and no output at all. It deliberately does NOT fall back to driving the
 * drive itself: that fallback is exactly the shortcut this phase forbids, and
 * it would also put two writers on one machine.
 */
function wireCascade(controllers: ControllerSpec[], defs: TagDef[]): ControllerSpec[] {
  const byTag = new Map(controllers.map((c) => [c.tag, c]))
  const declared = new Map<string, string>()
  for (const c of controllers) {
    const to = defs.find((d) => d.name === c.tag)?.cascadeTo
    if (to !== undefined) declared.set(c.tag, to)
  }
  if (declared.size === 0) return controllers

  const problems = new Map<string, string>()
  for (const [master, slave] of declared) {
    const problem = cascadeProblem(master, slave, declared, byTag, defs)
    if (problem !== undefined) problems.set(master, problem)
  }

  return controllers.map((c) => {
    const slave = declared.get(c.tag)
    if (slave !== undefined) {
      const problem = problems.get(c.tag)
      return problem !== undefined
        // declared and unusable: no output, and the reason travels with it
        ? { tag: c.tag, pvTag: c.pvTag, cascadeTo: slave, cascadeProblem: problem }
        : { ...c, outTag: slave, outKind: 'cascade' as const, cascadeTo: slave }
    }
    // the other end of a WORKING link: the slave learns who owns its setpoint
    const master = [...declared].find(([m, sl]) => sl === c.tag && !problems.has(m))?.[0]
    return master !== undefined ? { ...c, cascadeFrom: master } : c
  })
}

/**
 * Why a declared cascade cannot be built, or `undefined` when it can.
 *
 * The eight checks §4 asks for, in the order that makes each message useful:
 * a missing slave is not also usefully described as having no measurement.
 */
function cascadeProblem(
  master: string, slave: string,
  declared: Map<string, string>, byTag: Map<string, ControllerSpec>, defs: TagDef[],
): string | undefined {
  if (slave === master) return `${master} names itself as its own slave.`
  const s = byTag.get(slave)
  if (!s) {
    const known = defs.some((d) => d.name === slave)
    return known
      ? `${slave} is not a control loop, so it has no setpoint to cascade onto.`
      : `${slave} is not on this plant.`
  }
  // 8. a cycle: follow the declarations and see whether we come back
  const seen = new Set([master])
  for (let next: string | undefined = slave; next !== undefined; next = declared.get(next)) {
    if (seen.has(next)) return `the cascade ${[...seen, next].join(' → ')} is a loop.`
    seen.add(next)
  }
  // 4, 5, 6. the slave must be a complete, VSD-driving loop of its own
  if (!defs.some((d) => d.name === s.pvTag)) return `${slave} has no measurement to control.`
  if (s.outTag === undefined) {
    return `${slave} drives nothing, so a setpoint sent to it would go nowhere.`
  }
  if (s.outKind !== 'pump') {
    return `${slave} drives ${s.outTag}, which is not a variable speed drive.`
  }
  // 3. the slave's setpoint range is what the master's output is scaled onto
  const sd = defs.find((d) => d.name === slave)
  if (sd === undefined || !(sd.max > sd.min)) {
    return `${slave} has no usable setpoint range for a master output to be scaled onto.`
  }
  return undefined
}

/**
 * Flow units a `duty.minFlow` in m³/h can be compared against directly.
 *
 * A flow tag nobody has given units inherits `UNITS.flow`, which IS m³/h, so
 * this is a guard against a record that states something else rather than a
 * restriction on ordinary drawings. There is no unit conversion for controller
 * RANGES anywhere in this product, and applying a number in m³/h to a setpoint
 * in L/s would be exactly the invented engineering this programme exists to
 * avoid — so the protection refuses the loop and says why.
 */
const MIN_FLOW_UNITS = new Set(['m³/h', 'm3/h'])

/**
 * MINIMUM-FLOW PROTECTION — K18: which loop carries it, and what floor it puts
 * under a master.
 *
 * ── WHICH LOOP ────────────────────────────────────────────────────────────
 *
 * The one that MEASURES FLOW and DRIVES THE MACHINE. Both halves are load-
 * bearing. It has to drive the machine because the protection's whole job is
 * to stop that machine being commanded below its minimum, and the driving loop
 * is the only thing with a setpoint in the path. It has to measure flow
 * because the limit is a flow and a setpoint is only comparable with it if it
 * is in the same quantity: a pressure loop driving the same drive has a
 * setpoint in bar, and `max(3.2 bar, 20 m³/h)` is not arithmetic, it is
 * nonsense.
 *
 * Nothing is inferred. The machine is the one this loop already drives —
 * `wireFlowPumps` established that link from the topology in K15 — and the
 * limit is that machine's own `duty.minFlow`. No second opinion is formed
 * about which pump a limit belongs to.
 *
 * ── AND THE FLOOR UNDER ITS MASTER ────────────────────────────────────────
 *
 * A cascade master's output is scaled onto the slave's configured setpoint
 * range by `drive()`. The floor is that map run backwards: the percentage at
 * which the master would be asking for exactly the minimum. It is used for ONE
 * thing — deciding whether the integrator may keep winding down — and never to
 * clamp the master's output, because the master's request has to stay
 * observable for §8's requested-versus-effective distinction to mean anything.
 *
 * A floor at or below the bottom of the master's travel is not a stop at all
 * and is not carried, so the ordinary path stays byte-for-byte the ordinary
 * path.
 */
function wireMinFlow(controllers: ControllerSpec[], defs: TagDef[]): ControllerSpec[] {
  const byTag = new Map(defs.map((d) => [d.name, d]))
  const protectedLoops = controllers.map((c) => {
    if (c.outKind !== 'pump' || c.outTag === undefined) return c
    const cd = byTag.get(c.tag)
    if (cd?.measures !== 'flow') return c
    /**
     * READ, NEVER DERIVED. `TagDef.minFlowM3h` is the one field in this model
     * that falls back to nothing rather than to a default — see its own note —
     * and absent here means the record states no minimum, which is a complete
     * answer and not a gap to fill.
     */
    const limit = byTag.get(c.outTag)?.minFlowM3h
    if (limit === undefined || !Number.isFinite(limit)) return c
    const unit = cd.unit?.trim().toLowerCase()
    if (unit !== undefined && !MIN_FLOW_UNITS.has(unit)) {
      return { ...c, minFlowProblem: `the limit is stated in m³/h and ${c.tag} is ranged in `
        + `${cd.unit}, which this model converts nothing between.` }
    }
    /**
     * A MINIMUM THE LOOP IS FORBIDDEN TO CARRY — K23, §8.
     *
     * `duty.minFlow` is a requirement of the MACHINE; `signal.spHigh` is a
     * limit on what the LOOP may be asked for. A record stating a minimum
     * above that maximum is asking for two incompatible things, and there is
     * no defensible way to pick one: letting the protection through makes a
     * configured maximum not a maximum, and capping the protection silently
     * weakens a machine-protection function to satisfy an operating limit.
     *
     * So NEITHER wins and the contradiction is reported, which is exactly what
     * this function already does with a limit stated in units it cannot
     * convert. The protection is not in service on this loop, nothing is
     * assumed in its place, and K13 goes on detecting the machine's envelope
     * independently — the record is not wrong about the machine, it is wrong
     * about this pair.
     */
    if (c.spHigh !== undefined && limit > c.spHigh) {
      return { ...c, minFlowProblem: `${c.outTag}'s minimum flow of ${limit} m³/h is above `
        + `${c.tag}'s configured setpoint maximum of ${c.spHigh}, so the loop cannot be asked `
        + `for it.` }
    }
    return { ...c, minFlow: limit }
  })

  return protectedLoops
}

/**
 * THE SLAVE'S SETPOINT CONSTRAINTS, PROJECTED ONTO ITS MASTER'S OUTPUT — K24.
 *
 * `drive()` maps a master's per cent onto its slave's configured range; this
 * runs that map BACKWARDS, so a bound on the slave's setpoint becomes a bound
 * on the master's output in the master's own units.
 *
 * ── WHY A MASTER NEEDS TO KNOW ────────────────────────────────────────────
 *
 * A cascade master's output IS the slave's setpoint. When the slave refuses
 * part of it the master is asking for something nobody is applying, and left
 * alone it winds across the whole unusable part of its range and then needs
 * every point of that back before the plant responds again.
 *
 * MEASURED on the K15 cascade, identical plant and identical demand: a slave
 * floored at 30 of its 0-60 range by `duty.minFlow` — which K18 DID project —
 * left the master at rest at OP 49 with its integrator at 62. The same slave
 * floored at 30 by `signal.spLow`, which K23 did not project, ran the master
 * to OP 0 and an integrator of 12, and cost 50 s of dead time on release.
 *
 * ── AND WHICH CONSTRAINTS COUNT ───────────────────────────────────────────
 *
 * Only the ones that stop the SETPOINT BEING ACCEPTED. Deliberately NOT:
 *
 *   - a SATURATED SLAVE ACTUATOR. The setpoint was accepted in full and the
 *     plant simply cannot reach it, so the master's demand is genuine and it
 *     SHOULD wind to its own ceiling. Measured: identical master behaviour
 *     with and without a reachable setpoint, which is correct.
 *   - a RATE-LIMITED SLAVE OUTPUT. The setpoint was accepted in full and the
 *     slave is actively moving toward it; freezing the master through every
 *     ordinary transient would be the windup cure causing the disease.
 *   - a SLAVE WITH NO AUTHORITY. K16 and K17 already handle that: the master's
 *     own authority becomes `downstream` and its integrator is HELD, which is
 *     a stronger response than a stop and is not duplicated here.
 *
 * Nothing new is invented: the projection is K18's formula, the composition is
 * K18's `Math.max`, and the predicate it feeds is unchanged.
 */
function wireDownstreamStops(controllers: ControllerSpec[], defs: TagDef[]): ControllerSpec[] {
  const byTag = new Map(defs.map((d) => [d.name, d]))
  const byCtl = new Map(controllers.map((c) => [c.tag, c]))
  return controllers.map((c) => {
    if (c.outKind !== 'cascade' || c.outTag === undefined) return c
    const slave = byCtl.get(c.outTag)
    const sd = byTag.get(c.outTag)
    if (slave === undefined || sd === undefined || !(sd.max > sd.min)) return c
    /** The slave's own setpoint units, run back through `drive()`'s map. */
    const pctOf = (sp: number) => clamp(((sp - sd.min) / (sd.max - sd.min)) * 100, 0, 100)
    /**
     * EVERY floor the slave imposes, and the highest of them wins: a master
     * must respect all of its slave's constraints at once, and the binding one
     * is whichever sits highest. `spHigh` can never be below `minFlow` —
     * `wireMinFlow` refuses that pair outright — so the two can never cross.
     */
    const floors = [slave.minFlow, slave.spLow]
      .filter((v): v is number => v !== undefined && Number.isFinite(v))
      .map(pctOf)
      .filter((pct) => pct > (c.outMin ?? 0))
    const ceils = [slave.spHigh]
      .filter((v): v is number => v !== undefined && Number.isFinite(v))
      .map(pctOf)
      .filter((pct) => pct < (c.outMax ?? 100))
    if (floors.length === 0 && ceils.length === 0) return c
    return {
      ...c,
      ...(floors.length > 0 ? { dsFloorPct: Math.max(...floors) } : {}),
      ...(ceils.length > 0 ? { dsCeilPct: Math.min(...ceils) } : {}),
    }
  })
}

/**
 * OUTPUT RATE LIMITING — K21: which loops carry one, and how fast.
 *
 * Read from the CONTROLLER'S OWN record and applied to the CONTROLLER'S OWN
 * output. That sentence is the whole of §12: a master with a limit rate-limits
 * its own output — which happens to be its slave's setpoint — and a slave with
 * one rate-limits the speed command it writes. Two limits exist only where two
 * records state two, and neither is inferred from the other.
 *
 * NOTHING IS DERIVED. Not from the drive's `RAMP_S`, not from a valve's
 * `STROKE_RATE`, not from the sample time, not from the rated speed. Those
 * describe what an ACTUATOR does with a command; this describes how fast the
 * command itself may change, and confusing the two would make the drive's
 * physical lag look like an engineering decision somebody made.
 *
 * Runs LAST in the wiring pipeline because it constrains the output, and
 * everything before it decides what the output is for: an unwired loop drives
 * nothing and a rate limit on nothing is not worth carrying.
 */
function wireOutputRate(controllers: ControllerSpec[], defs: TagDef[]): ControllerSpec[] {
  const byTag = new Map(defs.map((d) => [d.name, d]))
  return controllers.map((c) => {
    // a loop with no final element has no output path for a rate to constrain
    if (c.outTag === undefined) return c
    const rate = byTag.get(c.tag)?.outputRateLimitPctPerS
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) return c
    return { ...c, outputRatePctPerS: rate }
  })
}

/**
 * ENGINEERING SETPOINT LIMITS — K23: which loops carry one, and how wide.
 *
 * Read from the LOOP'S OWN record and applied to the LOOP'S OWN setpoint. A
 * master's limits bound what the master may be asked for; a slave's bound what
 * the slave may be given, including by its master. Neither is inferred from
 * the other and neither is inferred from a calibrated range.
 *
 * A PAIR THAT CROSSES IS NOT A RANGE. A record stating a low above its own
 * high describes no operable band at all, and picking one of them would be
 * inventing the engineer's intent. Both are refused and the loop runs
 * unlimited, which is what it did before anybody typed them.
 *
 * Runs before `wireMinFlow`, because the minimum-flow protection has to know
 * whether the limit it is about to impose is one this loop may carry.
 */
function wireSpLimits(controllers: ControllerSpec[], defs: TagDef[]): ControllerSpec[] {
  const byTag = new Map(defs.map((d) => [d.name, d]))
  return controllers.map((c) => {
    const d = byTag.get(c.tag)
    const low = Number.isFinite(d?.spLow) ? d!.spLow : undefined
    const high = Number.isFinite(d?.spHigh) ? d!.spHigh : undefined
    if (low === undefined && high === undefined) return c
    if (low !== undefined && high !== undefined && low > high) return c
    return {
      ...c,
      ...(low !== undefined ? { spLow: low } : {}),
      ...(high !== undefined ? { spHigh: high } : {}),
    }
  })
}

/**
 * The output range this loop may use.
 *
 * Only a speed loop has one that is not 0-100. Its ceiling is 100 % because
 * that is where the pump curve is defined — `H₀` is the shutoff head AT RATED
 * SPEED, so asking for more would extrapolate a curve the record does not
 * describe. Its floor is the turndown the record STATES, and nothing is
 * invented when it states none.
 */
function outputRange(c: ControllerSpec, defs: TagDef[]): { outMin: number; outMax: number } | Record<string, never> {
  if (c.outKind !== 'pump' || c.outTag === undefined) return {}
  const d = defs.find((x) => x.name === c.outTag)
  const floor = d?.minSpeedPct !== undefined && Number.isFinite(d.minSpeedPct)
    ? clamp(d.minSpeedPct, 0, 100) : 0
  return { outMin: floor, outMax: 100 }
}

export function initTags(model: SimModel): Tags {
  // Calm start: a professional screen comes up with nothing moving and no
  // alarms until an operator (or a live control loop) acts. Every hand valve
  // that actually sits in a flow path starts CLOSED (lining up the valves IS
  // the operator's job — and an open drain stub or transfer line would
  // silently empty its tank before anyone touched a thing); EVERY throttling
  // valve starts at 0%, whether a controller drives it or not. Unpiped
  // decorative valves stay open so they don't read as faults.
  const piped = new Set(model.net.branches.flatMap((b) => b.valves))
  const tags: Tags = {}
  for (const d of model.defs) {
    switch (d.kind) {
      case 'tank': {
        const level = d.level0 ?? 40
        // A vessel carries its own three process variables: what it holds, the
        // head that puts on its outlet, and how hot its contents are. A PT or
        // TT bound to it reads these rather than a number of its own.
        tags[d.name] = { PV: level, P: tankPressureBar(level), T: d.temp0 ?? DEFAULTS.ambientC }
        break
      }
      case 'motor':
        // A heater also carries an OUTPUT: an operator starts it, and a
        // temperature controller modulates its duty between 0 and 100 %.
        tags[d.name] = d.heaterKw !== undefined
          ? { RUN: 0, RAMP: 0, OP: 100 }
          // SPD is the speed COMMAND, %, and exists only on a machine whose
          // record declares a drive. 100 % is not an invented limit: it is
          // where the pump curve's rated duty is defined, so it is where a
          // machine runs unless something asks for less — which is exactly
          // what a fixed-speed one has always done.
          : d.vsd === true ? { RUN: 0, RAMP: 0, SPD: 100 } : { RUN: 0, RAMP: 0 }
        break
      case 'valve': {
        /**
         * EVERY throttling valve comes up SHUT, controller or no controller.
         *
         * A controller-driven one used to be seeded at 40 % to match the
         * placeholder in the `controller` case below — but that 40 was never a
         * controller output. No controller has executed at this point; the
         * number was a default sitting in a field the first tick overwrites.
         *
         * The cost was not cosmetic. `initTags` solves the network, so a level
         * valve seeded at 40 % was genuinely open: the solve gave it flow, the
         * inventory integrated that flow, and the vessel lost liquid during the
         * ~1.6 s its actuator took to stroke shut once the controller finally
         * ran. Measured on a 200 m³ vessel that is 5e-5 % — small, and entirely
         * fictitious, because nothing had asked the valve to be open.
         *
         * Closed is also the right REST position. A final element with no
         * command holds its fail-safe state, and for every throttling valve in
         * this model that is shut: an outlet valve cannot drain a vessel nobody
         * has lined up, and an inlet valve cannot fill one. The first tick then
         * computes a real output and the actuator STROKES towards it at its
         * real rate, which is what an actuator does.
         */
        tags[d.name] = { OP: 0, POS: 0, DEVT: 0 }
        break
      }
      case 'valveOnOff': tags[d.name] = { OPEN: piped.has(d.name) ? 0 : 1 }; break
      case 'display': tags[d.name] = { PV: d.base ?? (d.min + d.max) / 2 }; break // reseeded below if bound
      // OP 0, not a placeholder: a controller that has not executed has no
      // output, and whatever sits in this field is what drives a final element
      // on the very first solve. The first tick computes the real one.
      /**
       * NO `SP: 50` ANY MORE — see the calm-start pass below.
       *
       * Fifty was never anybody's setpoint. It was the middle of the 0-100
       * span every tag used to inherit, left in place after ranges became real
       * engineering data; on a 0-10 bar loop it asks for five times the
       * highest pressure the instrument can read, and a K14 speed loop obeys
       * it by slamming the machine to 100 % and sitting there. `PV` and `SP`
       * are filled in below, from the plant, once the network has been solved.
       */
      case 'controller': tags[d.name] = { PV: 0, OP: 0, MODE: 1, I: 0, SAT: 0 }; break
    }
  }

  /**
   * A SPEED LOOP STARTS FROM THE SPEED THE MACHINE IS ALREADY AT.
   *
   * `OP: 0` above is right for a valve — a controller that has not executed
   * has no output, and a final element with no command holds its fail-safe
   * state, which for a throttling valve is shut. A DRIVE's rest state is not
   * zero: K12 brings a VSD machine up at rated, because that is where the
   * curve's duty point is defined and what a fixed-speed machine has always
   * done. Seeding the loop at 0 instead would hand the first MANUAL frame a
   * command to stop a machine nobody has asked to slow down.
   *
   * Seeding `I` to the same number is what makes the first AUTO execution
   * BUMPLESS: `op = kp·e + I` then starts from the speed the plant is at and
   * moves off it by the proportional term, rather than jumping from zero.
   */
  for (const c of model.controllers) {
    if (c.outKind !== 'pump' || c.outTag === undefined) continue
    const seed = clamp(tags[c.outTag]?.SPD ?? 100, c.outMin ?? 0, c.outMax ?? 100)
    const t = tags[c.tag]
    if (t) { t.OP = seed; t.I = seed }
  }

  // A BOUND transmitter reads its process from the very first frame.
  //
  // Without this every bound instrument comes up at the middle of its range —
  // a level transmitter on a vessel starting at 20 % would show 50 % until the
  // first tick corrected it. Brief, but it is a wrong number on an operator
  // screen, and RESET made it visible every time.
  //
  // The calm-start plant is stationary, so the seed is exact rather than an
  // approximation: no flow anywhere, and the pressure profile is whatever
  // static head and the supply header give with every pump stopped.
  /**
   * INITIALISATION IS A HYDRAULIC SOLVE, not an assumption of stillness.
   *
   * The previous version asserted zero flow everywhere and painted a pressure
   * profile on top. True for the calm start it was designed around, false the
   * moment anything could move on its own — a vessel standing above a
   * boundary, two vessels at different levels. Solving instead means the plant
   * comes up in a state that satisfies its own equations, so the first tick
   * continues the process rather than correcting a fiction.
   *
   * The equipment states above are the deterministic part: pumps stopped,
   * piped hand valves shut, an undriven throttling valve at 0 %. What the
   * network does with those is physics, and every bound transmitter is seeded
   * from it.
   */
  const hyd = solveHydraulics(model.hydraulic, {
    valveOpen: (v) => {
      const t = tags[v]
      if (!t) return 1
      if (t.POS !== undefined) return clamp(t.POS / 100, 0, 1)
      if (t.OP !== undefined) return clamp(t.OP / 100, 0, 1)
      return (t.OPEN ?? 1) >= 0.5 ? 1 : 0
    },
    pumpSpeed: () => 0, // calm start: nothing is turning yet
    pumpRated: (p) => model.defs.find((d) => d.name === p)?.ratedFlow ?? DEFAULTS.pumpFlowM3h,
    pumpHead: (p) => pumpHeadBar(model.defs.find((d) => d.name === p), model.pumpFluid.get(p)),
    vesselLevel: (tag) => tags[tag]?.PV ?? 0,
    vesselPressure: (t) =>
      model.defs.find((d) => d.name === t)?.vesselPressureBarA ?? DEFAULTS.atmosphericPressureBar,
  })
  const byPipe = pipePressureMap(model, hyd)
  const pipeTemps = pipeTemperatures(model.net, (tag) => tags[tag]?.T ?? DEFAULTS.ambientC)
  for (const d of model.defs) {
    if (d.kind === 'tank') {
      // Inventory is the state from the very first frame, not derived later.
      const capacity = Math.max(1e-6, d.capacity ?? DEFAULTS.tankVolumeM3)
      tags[d.name]!.V = (capacity * clamp(tags[d.name]!.PV ?? 0, 0, 100)) / 100
      continue
    }
    if (d.kind !== 'display') continue
    const seeded = measurementOf(d, tags, byPipe, pipeTemps, model, hyd)
    if (seeded !== undefined) tags[d.name]!.PV = clamp(seeded, d.min, d.max)
  }

  /**
   * CALM START FOR A CONTROLLER — K15.
   *
   * The same doctrine the bound transmitters above follow: a screen comes up
   * showing what the plant is doing, and nothing is asked to move until an
   * operator asks. A controller that comes up demanding a setpoint nobody
   * configured is asking the plant to move.
   *
   * SETPOINT PRECEDENCE, and the order is the existing architecture's rather
   * than a new policy:
   *
   *  1. A RUNTIME WRITE — an operator on the faceplate, or a scenario, which
   *     K8 deliberately routes through the same write path. Last write wins,
   *     which is what a DCS does. Nothing here can reach it: this runs at RUN
   *     and at RESET, before anybody has written anything.
   *  2. `signal.setpoint` ON THE ENGINEERING RECORD. An explicitly configured
   *     setpoint, and it is NEVER replaced by the plant's current state — a
   *     record that says 3.5 bar means 3.5 bar at every start.
   *  3. CALM START FROM THE MEASUREMENT. No configured setpoint, so the loop
   *     starts where the plant already is and asks for no change. Error is
   *     zero, output holds, and the first thing that moves is whatever an
   *     operator does next.
   *  4. NOTHING. A loop whose PV is not bound to anything this simulation
   *     produces has no reading to start from and no record to obey, so its
   *     setpoint is UNAVAILABLE rather than invented. `step` will not run the
   *     algorithm without one, and the faceplate says so.
   *
   * Step 3 reads the PV tag AFTER the seeding loop above, so it is the solved
   * value and not the span midpoint the tag was created with.
   */
  for (const c of model.controllers) {
    const t = tags[c.tag]
    const cd = model.defs.find((d) => d.name === c.tag)
    if (!t || !cd) continue
    const pvDef = model.defs.find((d) => d.name === c.pvTag)
    // BOUND means the simulation actually produces this reading. An unbound
    // display sits at its own span midpoint, and starting a setpoint from a
    // midpoint would be inventing one with extra steps.
    const bound = pvDef !== undefined && (pvDef.kind === 'tank'
      || pvDef.bindTank !== undefined || pvDef.bindPipe !== undefined)
    const pv = tags[c.pvTag]?.PV
    if (bound && pv !== undefined) t.PV = pv
    if (cd.setpoint !== undefined) t.SP = cd.setpoint
    else if (bound && pv !== undefined) t.SP = pv
    // else: left UNSET. Absent is not zero and is not fifty.
  }

  return tags
}

/**
 * Net flow into a vessel, m³/h, positive INTO it.
 *
 * Asks the vessel's own port nodes what crossed them. An edge LEAVING a nozzle
 * contributes negatively and one ARRIVING contributes positively, so the SIGN
 * of the solved flow decides the direction rather than the drawing's arrow. A
 * vessel's two nozzle nodes are joined by the liquid and not by an edge, so
 * nothing double-counts.
 */
function vesselNetFlow(model: SimModel, hyd: SolveResult, tag: string): number {
  const mine = new Set(model.hydraulic.vesselNodes.get(tag) ?? [])
  if (mine.size === 0) return 0
  let net = 0
  for (const e of model.hydraulic.edges) {
    const q = hyd.flow[e.id] ?? 0
    if (q === 0) continue
    const leaves = mine.has(e.from)
    const arrives = mine.has(e.to)
    if (leaves === arrives) continue
    net += arrives ? q : -q
  }
  return net
}

/** The pressure each drawn pipe sits at: the mean of its edge's two nodes.
 *  ONE map, read by PT, by gauges, by the HMI and by a controller's PV. */
function pipePressureMap(model: SimModel, hyd: SolveResult): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of model.hydraulic.edges) {
    if (e.pipeIds.length === 0) continue
    const a = hyd.pressure[e.from] ?? DEFAULTS.atmosphericPressureBar
    const b = hyd.pressure[e.to] ?? DEFAULTS.atmosphericPressureBar
    for (const id of e.pipeIds) out[id] = (a + b) / 2
  }
  return out
}

/**
 * The shaft fraction a running machine is aiming at, 0..1.
 *
 * A machine with no declared drive aims at rated speed, which is what it has
 * always done. One with a drive aims at its command, held inside the turndown
 * its record states — and a command the record cannot honour is CLAMPED here
 * and REPORTED by `pump-speed-out-of-range`, rather than being obeyed into a
 * region the machine does not have.
 */
/**
 * WHERE A VALVE IS BEING TOLD TO GO, within the travel it actually has — K22.
 *
 * The sibling of `speedTarget`, and deliberately shaped like it: the actuator
 * decides what it can do with a command, and the command itself is left alone
 * so the clamp stays visible.
 *
 * A command that is absent or unreadable is NOT a position. The valve holds
 * its fail-safe state, which for a throttling valve is SHUT — the same answer
 * `initTags` gives one that has never been commanded, and the same `?? 0` this
 * line has always had.
 */
function travelTarget(t: Record<string, number>): number {
  const asked = t.OP
  if (asked === undefined || !Number.isFinite(asked)) return 0
  return clamp(asked, 0, 100)
}

function speedTarget(t: Record<string, number>, d: TagDef): number {
  if (d.vsd !== true) return 1
  const asked = t.SPD
  if (asked === undefined || !Number.isFinite(asked)) return 1
  const floor = d.minSpeedPct !== undefined && Number.isFinite(d.minSpeedPct)
    ? clamp(d.minSpeedPct / 100, 0, 1)
    : 0
  return clamp(asked / 100, floor, 1)
}

export interface TickOptions {
  /** Scenario: a restriction multiplier on a drawn pipe, 1 = unrestricted. */
  pipeFactor?(pipeId: string): number
  /** Scenario: a tagged terminal held somewhere other than its record says,
   *  bar absolute. `undefined` for a tag means "as the record states". */
  boundaryPressure?(tag: string): number | undefined
  /**
   * A previous CONVERGED pressure field to start the solve from.
   *
   * An optimisation only — it halves the Newton iterations. It does not change
   * the answer beyond the precision a converged solve is defined to: two
   * converged solves of the same network agree to within `MASS_TOL`, and the
   * measured difference is 6e-5 m³/h. The caller must never pass an
   * unconverged field; `simStore` only carries one forward when `converged`
   * was true.
   */
  warmStart?: Record<string, number>
  /**
   * THE PREVIOUS TICK'S SOLVE — K16.
   *
   * Not an optimisation: it is the solve that PRODUCED the readings the
   * controllers are about to act on, and the only thing that can say whether
   * those readings are worth acting on. Passing this tick's would break the
   * one-tick measurement latency K11 established, which is the whole reason it
   * arrives from the caller rather than being computed here.
   *
   * Absent on the very first tick of a run, which is correct: nothing has yet
   * failed to solve.
   */
  prevSolve?: SolveResult
}

export interface TickResult {
  tags: Tags
  /** m³/h per branch, magnitude, for the thermal model and the flowsheet. */
  branchFlows: Record<string, number>
  /** The hydraulic solve this tick ran on: SIGNED per-pipe flows for the
   *  operator screen, and the validity flags quality degrades on. */
  hydraulic: SolveResult
  /** bar per pipe — what a PT bound to that line reads. */
  pipePressures: Record<string, number>
  /**
   * WHAT EACH CONTROL LOOP IS ABLE TO DO — K16 authority, mode, the output it
   * asked for and the one the actuator actually reached.
   *
   * A derivation of the tags and the previous solve; nothing in it is a store.
   */
  loops: Record<string, LoopState>
}

/**
 * One simulation step over `dt` SECONDS of process time. Pure: never mutates
 * its inputs.
 *
 * Sub-steps anything longer than `MAX_STEP_S` so that the training speed
 * multiplier changes how fast the clock runs and nothing else. The physics is
 * identical at 1× and at 300×.
 */
export function tick(
  model: SimModel,
  prev: Tags,
  dt: number,
  rng: () => number,
  opts?: TickOptions,
): TickResult {
  const n = Math.max(1, Math.ceil(dt / MAX_STEP_S))
  if (n === 1) return step(model, prev, dt, rng, opts)
  let out = step(model, prev, dt / n, rng, opts)
  for (let i = 1; i < n; i++) {
    // Each sub-step starts from the one before it rather than from the field
    // the caller handed in. At 300× that is sixty sub-steps, and the plant
    // moves very little across any one of them, so the previous answer is a
    // far better guess than a sixty-sub-steps-old one. Still an optimisation
    // and nothing more: a converged field is a converged field whatever it
    // started from, and an unconverged one is never carried forward.
    // and the solve the NEXT sub-step's controllers judge is the one this
    // sub-step just produced — the same one-tick relationship, sub-stepped
    out = step(model, out.tags, dt / n, rng,
      out.hydraulic.converged
        ? { ...opts, warmStart: out.hydraulic.pressure, prevSolve: out.hydraulic }
        : { ...opts, prevSolve: out.hydraulic })
  }
  return out
}

/**
 * Why the hydraulic solve cannot stand behind the value this tag carries, if
 * it cannot.
 *
 * The solve reports its own limits — see `SolveResult` — and this is the join
 * between those limits and the tags that depend on them. A measurement bound
 * to a line reads that line's edge; a level reads its vessel's nozzles; the
 * vessel itself is included because its inventory was integrated from flows
 * across those same nozzles.
 *
 * `undefined` means the solve stands behind it, NOT that nothing was checked.
 */
export function processFaultOf(
  model: SimModel,
  hyd: SolveResult,
  d: { name: string; kind: string; bindTank?: string; bindPipe?: string },
): ProcessFault | undefined {
  const nodes = hydraulicNodesOf(model, d)
  if (nodes === undefined) return undefined // nothing hydraulic behind this tag
  return faultOfNodes(hyd, nodes)
}

/**
 * The same question asked of NODES rather than of a tag's binding.
 *
 * Split out so that anything standing on a piece of the pressure field asks it
 * ONCE, the same way — a measurement through `processFaultOf` above, a pump's
 * own two nozzles through `sim/envelope.ts`. One rule, several bindings; the
 * alternative is two places that decide when a number can be trusted and
 * eventually disagree.
 *
 * Worst first. A solve that did not converge invalidates every node in it, so
 * there is no point asking which one is also cavitating.
 */
export function faultOfNodes(hyd: SolveResult, nodes: Set<string>): ProcessFault | undefined {
  if (!hyd.converged) return 'unconverged'
  if (hyd.cavitating.some((n) => nodes.has(n))) return 'cavitating'
  if (hyd.undetermined.some((n) => nodes.has(n))) return 'undetermined'
  return undefined
}

/** The hydraulic nodes a tag's value depends on, or `undefined` when it
 *  depends on none — an unbound display, a motor, a controller. */
function hydraulicNodesOf(
  model: SimModel,
  d: { name: string; kind: string; bindTank?: string; bindPipe?: string },
): Set<string> | undefined {
  if (d.bindPipe !== undefined) {
    const edgeId = model.hydraulic.edgeOfPipe.get(d.bindPipe)
    const e = model.hydraulic.edges.find((x) => x.id === edgeId)
    return e ? new Set([e.from, e.to]) : undefined
  }
  const vessel = d.kind === 'tank' ? d.name : d.bindTank
  if (vessel === undefined) return undefined
  const nodes = model.hydraulic.vesselNodes.get(vessel)
  return nodes ? new Set(nodes) : undefined
}

function step(
  model: SimModel,
  prev: Tags,
  dt: number,
  rng: () => number,
  opts?: TickOptions,
): TickResult {
  const tags: Tags = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v }]))
  const defByName = new Map(model.defs.map((d) => [d.name, d]))

  // 1) controllers drive their final element: PI in AUTO, operator OP
  // pass-through in MAN. The error is normalised by the PV's SPAN, so a gain
  // means the same thing on a 0-10 bar loop as on a 0-100 % one.
  /**
   * WHY each loop can or cannot reach its process, decided HERE because the
   * algorithm below is gated on it — and turned into the published snapshot at
   * the END of the step, where the actuators have moved and the numbers are
   * the ones the tick actually finished with.
   */
  const verdict = new Map<string, { authority: ControlAuthority; blockedBy?: string }>()
  /**
   * WHAT THE MINIMUM-FLOW PROTECTION DID TO EACH SETPOINT — K18.
   *
   * Recorded here, where the override is applied, and published at the END of
   * the step with everything else the tick decided. A master reads its slave's
   * entry from this map: masters run first, so by the time the snapshot is
   * built the slave has already run and its effective setpoint is the one that
   * was actually in force this tick.
   */
  const demands = new Map<string, MinFlowDemand>()
  /**
   * K23: and what the ENGINEERING SETPOINT LIMITS did, recorded here for the
   * same reason and published at the same moment. Carried rather than
   * recomputed at the end: the snapshot must report the value the algorithm
   * ACTUALLY used this tick, not one derived a second time from state that has
   * since moved on.
   */
  const spLimits = new Map<string, SetpointLimit>()
  /** K24: masters currently held by a constraint of their slave's. */
  const dsLimited = new Map<string, boolean>()
  for (const c of model.controllers) {
    const t = tags[c.tag]
    if (!t) continue
    const pv = tags[c.pvTag]?.PV ?? 0
    t.PV = pv
    /**
     * CAN THIS LOOP REACH THE PROCESS? — K16.
     *
     * Judged against the PREVIOUS solve, because that is the one that produced
     * the reading being acted on. `processFaultOf` is the single place that
     * decides whether a solve stands behind a tag's value; this asks it about
     * the loop's own measurement rather than inventing a second rule.
     */
    const pvDef = defByName.get(c.pvTag)
    const { authority, blockedBy } = authorityOf({
      ...(c.outTag !== undefined ? { outTag: c.outTag } : {}),
      ...(c.outKind !== undefined ? { outKind: c.outKind } : {}),
      ...(c.outTag !== undefined && tags[c.outTag] ? { element: tags[c.outTag]! } : {}),
      ...(c.pvDriver !== undefined && tags[c.pvDriver]
        ? { driverTag: c.pvDriver, driver: tags[c.pvDriver]! } : {}),
      ...(opts?.prevSolve && pvDef
        ? (() => {
            const f = processFaultOf(model, opts.prevSolve!, pvDef)
            return f !== undefined ? { pvFault: f } : {}
          })()
        : {}),
      /**
       * K17: IS THE SLAVE FOLLOWING? A master whose slave is in MANUAL, or
       * whose slave cannot reach its own process, is talking to nobody — so it
       * holds rather than integrating against a path that cannot respond.
       *
       * The slave's verdict is the SLAVE's, computed when it ran a moment ago
       * (masters execute first, so a slave's verdict from this same tick is
       * not yet in `verdict` — its PREVIOUS tick's is, which is the same
       * one-tick relationship every other input here has).
       */
      ...(c.outKind === 'cascade' && c.outTag !== undefined
        ? { downstreamFollowing:
            (tags[c.outTag]?.MODE ?? 0) >= 0.5 && (tags[c.outTag]?.AUTH ?? 1) >= 0.5 }
        : {}),
    })
    t.AUTH = authority === 'available' ? 1 : 0
    verdict.set(c.tag, { authority, ...(blockedBy !== undefined ? { blockedBy } : {}) })
    if (!c.outTag) continue // PV-only controller: nothing to drive
    const cd = defByName.get(c.tag)
    const span = Math.abs((cd?.max ?? 100) - (cd?.min ?? 0)) || 100
    // A SPEED loop is tuned as a speed loop. `TUNING` is indexed by what a
    // controller MEASURES; this one measures pressure like any other and
    // drives something else entirely. Nothing in `TUNING` changed.
    const tune = c.outKind === 'cascade' ? CASCADE_TUNING
      : c.outKind === 'pump'
      ? (cd?.measures === 'flow' ? FLOW_SPEED_TUNING : SPEED_TUNING)
      : cd?.measures ? TUNING[cd.measures] : DEFAULT_TUNING
    const ki = tune.kp / tune.ti
    const errorOf = (sp: number) => (((sp - pv) * (c.action ?? 1)) / span) * 100
    /** The travel this loop actually has. 0-100 for everything before K14. */
    const lo = c.outMin ?? 0
    const hi = c.outMax ?? 100
    /**
     * WHERE THE OUTPUT GOES.
     *
     * A valve and a heater take `OP`; a drive takes `SPD`, which is the SPEED
     * COMMAND K12 created and NOT the shaft. The actuator still owns the step
     * from command to `RAMP`, so command and actual stay two different things
     * with a controller in the loop exactly as they are without one.
     */
    const drive = (v: number) => {
      const el = tags[c.outTag!]
      if (!el) return
      /**
       * A CASCADE MASTER WRITES A SETPOINT, NOT AN ACTUATOR — K17.
       *
       * Its output is a per cent, as every controller's is, and the slave's
       * setpoint is in the slave's own engineering units. The map between them
       * is the SLAVE'S OWN CONFIGURED RANGE and nothing else: no limit is
       * invented, and the master's gain keeps meaning what K14 measured it to
       * mean because the algorithm still works in per cent throughout.
       *
       * This is the one and only place a master's output goes. It never
       * reaches `SPD`.
       */
      if (c.outKind === 'cascade') {
        const sd = defByName.get(c.outTag!)
        if (sd && sd.max > sd.min) el.SP = sd.min + (clamp(v, 0, 100) / 100) * (sd.max - sd.min)
        return
      }
      if (c.outKind === 'pump') { if (el.SPD !== undefined) el.SPD = v }
      else if (el.OP !== undefined) el.OP = v
    }

    /**
     * OUTPUT RATE LIMITING — K21. THE CONTROL LAYER'S OWN CONSTRAINT.
     *
     *   algorithm ──► requested OP ──► RATE LIMIT ──► commanded OP
     *                                                      │
     *                                            SPD ──► physical ramp ──► shaft
     *
     * `OP` is what was ASKED FOR and `OPC` is what was COMMANDED. They are two
     * different numbers and K21 exists to stop them being one: an operator
     * looking at an output of 90 while the drive is being told 50 is entitled
     * to see both, and a plant where those differ silently is one where nobody
     * can explain why the machine is not where the screen says.
     *
     * `OPC` IS ONLY WRITTEN WHEN A LIMIT IS CONFIGURED. With none, every line
     * below is byte-for-byte the line K14 through K20 already executed, there
     * is no second signal on the tag, and nothing new reaches history.
     *
     * THE TIMESTEP IS THE SIMULATION'S. `rate * dt` and nothing else — no
     * wall clock, no elapsed browser time, no timer, no accumulator. Two
     * identical ticks produce two identical commands.
     */
    const rate = c.outputRatePctPerS
    /** The command the element is on, before this tick decides anything. */
    const prevCmd = clamp(t.OPC ?? t.OP ?? 0, lo, hi)
    const maxDelta = rate !== undefined ? rate * dt : Infinity
    /**
     * Send a request to the element THROUGH the limiter.
     *
     * Every path out of the controller stage goes through this — AUTO, MANUAL,
     * held, and the no-setpoint hold — because a constraint on the output path
     * that some paths bypass is not a constraint on the output path.
     */
    const send = (requested: number) => {
      const v = rate === undefined ? requested
        : clamp(requested, prevCmd - maxDelta, prevCmd + maxDelta)
      if (rate !== undefined) t.OPC = v
      drive(v)
      return v
    }

    /**
     * MINIMUM-FLOW PROTECTION — K18. THE ENTIRE OVERRIDE IS THIS LINE.
     *
     *     effective = max(requested, declared minimum)
     *
     * A constraint on the setpoint, evaluated from the setpoint and the record
     * alone. It reads no measurement, so it cannot look ahead and cannot be
     * confused by a bad one; it is continuous in the requested setpoint, so
     * there is nothing for a threshold to chatter on and no hysteresis had to
     * be invented; and it has no state, so two identical ticks produce two
     * identical answers.
     *
     * It is applied to the setpoint the ALGORITHM uses and never written back
     * to `SP`. That matters twice over: an operator's own entry is not
     * destroyed — K15's rule — and a master's request stays visible beside the
     * protected value it is being held to, which is what §5 asks for.
     *
     * `c.minFlow` is only ever set on a FLOW loop driving a machine whose
     * record declares a minimum, so with none declared `effSp` IS `t.SP` and
     * every path below is the path K14, K15 and K17 already took.
     */
    /**
     * ENGINEERING SETPOINT LIMITS — K23, and this is the ONE place they act.
     *
     *     whoever wrote SP ──► [spLow..spHigh] ──► limited ──► [minFlow] ──► effective
     *
     * Applied where the setpoint is READ rather than where it is written, so
     * an operator, a scenario, a direct write and a cascade master all meet
     * the same limit exactly once. K22 found the opposite: the operator's path
     * was bounded by the faceplate widget and every other path by nothing, so
     * the same loop could be driven to different setpoints depending on who
     * asked. That widget clamp is now cosmetic; this is the constraint.
     *
     * `SP` ITSELF IS NOT REWRITTEN. The operator's entry survives exactly as
     * K15 requires and exactly as K18 leaves it alone — what is limited is the
     * value the ALGORITHM uses, and both numbers are published so the plate
     * can show what was asked beside what is being held.
     *
     * With neither limit configured this is `t.SP` and every line below is
     * byte-for-byte what K14 through K22 executed.
     */
    const limitedSp = t.SP === undefined ? undefined
      : clamp(t.SP, c.spLow ?? -Infinity, c.spHigh ?? Infinity)
    /**
     * ...AND THEN THE MINIMUM-FLOW PROTECTION, on the LIMITED value.
     *
     * The order is forced rather than chosen: a setpoint limit says what the
     * loop may be ASKED for, and the protection then raises what it is asked
     * for to what the machine requires. Running them the other way would let
     * the limit cut the protection back down, which is the silent weakening
     * §8 refuses. It cannot arise anyway — `wireMinFlow` refuses a minimum
     * above `spHigh` outright — and this ordering is why that refusal is
     * sufficient.
     */
    if (c.spLow !== undefined || c.spHigh !== undefined) {
      spLimits.set(c.tag, {
        ...(c.spLow !== undefined ? { low: c.spLow } : {}),
        ...(c.spHigh !== undefined ? { high: c.spHigh } : {}),
        ...(t.SP !== undefined ? { requested: t.SP } : {}),
        ...(limitedSp !== undefined ? { limited: limitedSp } : {}),
        limiting: t.SP !== undefined && limitedSp !== undefined
          && Math.abs(t.SP - limitedSp) > 1e-9,
      })
    }
    const effSp = c.minFlow !== undefined && limitedSp !== undefined
      ? Math.max(limitedSp, c.minFlow) : limitedSp
    if (c.minFlow !== undefined || c.minFlowProblem !== undefined) {
      demands.set(c.tag, {
        pump: c.outTag,
        ...(c.minFlow !== undefined ? { limitM3h: c.minFlow } : {}),
        ...(c.minFlowProblem !== undefined ? { problem: c.minFlowProblem } : {}),
        // the setpoint the PROTECTION was handed, which is the limited one —
        // the raw entry is published separately as the SP-limit's own pair
        ...(limitedSp !== undefined ? { requestedSp: limitedSp } : {}),
        ...(effSp !== undefined ? { effectiveSp: effSp } : {}),
        overriding: limitedSp !== undefined && effSp !== undefined && effSp > limitedSp,
        /**
         * K19: AND WHETHER THAT RAISE REACHES ANYTHING.
         *
         * The `continue` a dozen lines below is the whole answer — in MANUAL
         * the algorithm does not run and `effSp` reaches nothing but the
         * bumpless-transfer tracking. K18 already behaved exactly this way and
         * published `overriding: true` beside it, so the faceplate told an
         * operator in hand control that their setpoint was being held up while
         * their own output drove the machine. This reports the branch that was
         * always there; it does not add one.
         */
        inForce: (t.MODE ?? 0) >= 0.5,
      })
    }

    if ((t.MODE ?? 0) < 0.5) {
      /**
       * MANUAL AND THE RATE LIMIT — K21, §8, and it is a DIFFERENT answer from
       * K19's for the minimum-flow override, for a reason that is not
       * arbitrary.
       *
       * The override acts on the SETPOINT, and in MANUAL this runtime does not
       * use the setpoint, so it has no path. The rate limit acts on the OUTPUT
       * PATH, and in MANUAL the output path is exactly what the operator's
       * hand is driving — so it does have one. The precedent is already in
       * this line: `lo` and `hi`, the controller's other configured output
       * constraints, have always clamped a hand command here.
       *
       * The operator's own entry survives in `OP`, the way K15 requires and
       * the way the minimum-flow override leaves `SP` alone. The faceplate
       * shows the slider's value against the value actually being commanded.
       */
      const cmd = send(clamp(t.OP ?? 0, lo, hi))
      // bumpless transfer: keep the integrator tracking the operator's OP
      // (I = OP − kp·e) so returning to AUTO resumes from here, no kick. With
      // no setpoint there is no error to track, so the integrator simply holds
      // the operator's output.
      /**
       * MANUAL AND THE PROTECTION — K18, the explicit policy.
       *
       * The protection acts on the SETPOINT, and in MANUAL this runtime does
       * not use the setpoint: the operator's `OP` goes to the element and the
       * algorithm does not run. There is therefore nothing for a setpoint
       * override to act on, and it does not act — it is not "bypassed by
       * policy", it has no path. Making it act in MANUAL would mean overriding
       * the operator's OUTPUT instead, which is a different mechanism, is not
       * what §4 defines, and would silently reinterpret a hand command.
       *
       * The one place the effective setpoint is still used here is the line
       * below, and it must be: this is the bumpless-transfer tracking, and it
       * has to track against the setpoint AUTO will resume on. Tracking the
       * requested value and then controlling to the protected one would put a
       * kick in the transfer — which is the single thing this line exists to
       * prevent.
       *
       * K13's `pump-below-min-flow` continues to report the physical condition
       * throughout, from the machine rather than from the loop.
       */
      // ...and the bumpless transfer tracks the COMMANDED output, because that
      // is where the plant actually is and therefore what AUTO must resume
      // from. Tracking the slider instead would kick by the whole rate-limited
      // difference on the transfer.
      t.I = clamp(cmd - (effSp === undefined ? 0 : tune.kp * errorOf(effSp)), -100, 100)
      t.SAT = 0
      continue
    }
    /**
     * NO SETPOINT, NO ALGORITHM — K15.
     *
     * `?? 50` used to stand here, and fifty was the middle of the 0-100 span
     * every tag once inherited. On a ranged loop it is not a setpoint, it is a
     * number; acting on it makes a plant move for a reason nobody chose. A
     * loop with nothing to aim at holds its output, and the faceplate says the
     * setpoint is unavailable rather than showing a figure nobody set.
     */
    if (effSp === undefined) { t.SAT = 0; send(clamp(t.OP ?? 0, lo, hi)); continue }
    /**
     * NO AUTHORITY, NO INTEGRATION — K16.
     *
     * The output and the integrator are HELD, exactly where the plant left
     * them. Not reset, not zeroed, not decayed: held, so that when authority
     * returns the loop resumes from the state it had rather than from a number
     * manufactured while it was blind.
     *
     * This is the smallest transition that fixes the defect. Everything else
     * is untouched — the PV still updates above, the one-tick measurement
     * latency is unchanged, the output limits still apply, the tuning is the
     * same, and there is no deadband anywhere.
     *
     * `SAT` is CLEARED rather than set. An output resting at a limit it was
     * never allowed to leave is not a saturated output, and conflating the two
     * would tell an operator the setpoint is unreachable when the truth is
     * that nothing is running.
     */
    if (authority !== 'available') {
      t.SAT = 0
      /**
       * K21: the HOLD holds the COMMAND, which is where the plant was left.
       *
       * With no rate limit configured `prevCmd` IS `clamp(t.OP, lo, hi)` and
       * this is K16's line unchanged. With one, holding the request instead
       * would let the limiter walk the command toward a stale number while the
       * loop is blind — which is the opposite of a hold.
       *
       * A rate-limited loop still HAS authority; this branch is about not
       * having it, and the two are never conflated. See §9.
       */
      send(prevCmd)
      continue
    }
    const e = errorOf(effSp)
    // conditional integration (anti-windup): freeze I while the output is
    // saturated in the error's direction, else overshoot on big transitions
    let I = t.I ?? 0
    let op = clamp(tune.kp * e + I, lo, hi)
    /**
     * A MASTER MUST NOT INTEGRATE AGAINST A REQUEST NOBODY IS APPLYING — K18.
     *
     * When the minimum-flow protection is holding the slave's setpoint above
     * what this master asked for, the master's output has stopped reaching the
     * process in the downward direction: it can ask for less and less and the
     * plant will keep making the minimum. Left alone it would wind all the way
     * to its bottom stop and then need the whole of that travel back before
     * the plant responded again.
     *
     * NO NEW MECHANISM. The existing anti-windup already asks exactly the
     * right question — "is the output against a stop that the error is pushing
     * it further into?" — and the only thing K18 changes is WHICH stop. The
     * configured bottom of the travel is one; the minimum-flow floor, the same
     * number expressed on this master's output scale, is another. Both are
     * places the output cannot usefully go below, and the predicate is
     * unchanged in every other respect.
     *
     * The output itself is NOT clamped to the floor. `op` remains the master's
     * genuine request, so `commandedSp` keeps saying what the master wanted
     * while `effectiveSp` says what the slave is carrying — and an operator can
     * see the override rather than infer it. With no floor, `stop` IS `lo`.
     */
    const stop = c.dsFloorPct !== undefined ? Math.max(lo, c.dsFloorPct) : lo
    /**
     * ...AND THE SAME THING ON THE WAY UP — K24.
     *
     * K18 wrote the floor and its rationale; the ceiling is that rationale
     * read in the other direction. A master whose slave caps the setpoint it
     * is being sent is asking for something nobody is applying, and the fact
     * that the master would EVENTUALLY be caught by its own travel stop is not
     * a defence: it has to cross everything in between first, and cross back.
     *
     * Not a new mechanism and not a new direction for the predicate, which has
     * always had two stops. Only WHICH ceiling changed, from `hi` to
     * `min(hi, dsCeilPct)` — exactly the move K18 made for `lo`.
     */
    const cap = c.dsCeilPct !== undefined ? Math.min(hi, c.dsCeilPct) : hi
    /**
     * ...AND NEITHER MAY IT INTEGRATE AGAINST A MOVE THE RATE LIMIT IS NOT
     * LETTING IT MAKE — K21, §15.
     *
     * NO NEW ANTI-WINDUP. The existing predicate already asks exactly the
     * right question — "is the output against a stop that the error is pushing
     * it further into?" — and K18 already established that the answer is to
     * change WHICH STOP rather than to add a mechanism. This is the same move
     * a third time.
     *
     * The difference is that these stops are DYNAMIC: the furthest the command
     * can go this tick is one `rate * dt` either side of where it already is,
     * intersected with the configured travel. A loop asking for 90 whose
     * command may only reach 50 is against a stop in exactly the sense the
     * predicate means, and winding the integrator while it crawls there is
     * precisely the windup this clause has always existed to prevent.
     *
     * With no rate limit `maxDelta` is Infinity, `reachHi` IS `hi`, `reachLo`
     * IS `stop`, and the predicate is character-for-character K18's.
     *
     * NOTHING WAS RETUNED. `kp`, `ti` and `ki` are untouched, and so is the
     * integrator's own clamp.
     */
    const reachHi = Math.min(cap, prevCmd + maxDelta)
    const reachLo = Math.max(stop, prevCmd - maxDelta)
    if (!((op >= reachHi && e > 0) || (op <= reachLo && e < 0))) {
      I = clamp(I + ki * e * dt, -100, 100)
      op = clamp(tune.kp * e + I, lo, hi)
    }
    t.I = I
    t.OP = op
    /**
     * SATURATION, PUBLISHED RATHER THAN IMPLIED.
     *
     * +1 at the top of its travel, -1 at the bottom, 0 in between. An operator
     * looking at an output sitting at 100 % cannot otherwise tell whether the
     * loop is satisfied there or has run out of machine, and those are very
     * different things: the second means the setpoint is not reachable.
     */
    /**
     * SATURATION IS STILL SATURATION — K21, §14.
     *
     * Judged against `hi` and `lo`, the CONFIGURED travel, and deliberately
     * not against the rate window. A loop crawling to 90 % at its configured
     * rate is not saturated; it has plenty of machine left and simply is not
     * allowed to get there yet. Reusing `SAT` for that would tell an operator
     * the setpoint is unreachable when the truth is that it is merely not
     * reachable this second, and K16 already fought this exact conflation once
     * for authority.
     *
     * RATE LIMITED, SATURATED and NO AUTHORITY are three states, and a loop
     * can be in any combination of them.
     */
    /**
     * K24: THE MASTER IS BEING HELD BY ITS SLAVE, which is NOT saturation.
     *
     * Recorded separately and never folded into `SAT`, which keeps its K22
     * meaning — the controller's own configured travel. A master resting at 50
     * % because its slave will not take more has half its travel left and is
     * not saturated by any reading of the word; saying so would tell an
     * operator the master has run out of range when it has run out of SLAVE.
     */
    if ((c.dsFloorPct !== undefined || c.dsCeilPct !== undefined)) {
      dsLimited.set(c.tag, (op >= cap && e > 0) || (op <= stop && e < 0))
    }
    t.SAT = op >= hi && e > 0 ? 1 : op <= lo && e < 0 ? -1 : 0
    send(op)
  }

  // 1.5) equipment dynamics: pumps spin up and coast down, valves stroke
  // toward command, deviation time accumulates (a stuck valve stops chasing)
  for (const d of model.defs) {
    const t = tags[d.name]
    if (!t) continue
    if (d.kind === 'motor') {
      if ((t.FAULT ?? 0) >= 0.5 && (t.RUN ?? 0) >= 0.5) t.RUN = 0 // a trip opens the breaker
      const commanded = (t.RUN ?? 0) >= 0.5 && (t.FAULT ?? 0) < 0.5
      /**
       * THE SHAFT CHASES A TARGET, and the only thing K12 changed is what that
       * target is.
       *
       * A fixed-speed machine's target is 1 when it is told to run — exactly
       * what this did before, and what every drawing without a declared drive
       * still gets. A VSD's target is its speed COMMAND, clamped to the
       * turndown its record states.
       *
       * Two rates, and the distinction is physical rather than convenient.
       * `RAMP_S` is the DRIVE changing the shaft, so it governs any commanded
       * change while the machine is energised — up or down. `COAST_S` is
       * nothing driving it: a de-energised shaft freewheeling down. Using the
       * drive rate for a commanded slow-down is a STATED ASSUMPTION, not a
       * manufacturer figure; no record in this model carries a deceleration
       * time.
       */
      const target = commanded ? speedTarget(t, d) : 0
      const cur = t.RAMP ?? 0
      const rate = commanded ? dt / RAMP_S : dt / COAST_S
      t.RAMP = (t.FAULT ?? 0) >= 0.5 ? 0
        : cur < target ? Math.min(target, cur + rate)
        : Math.max(target, cur - rate)
    }
    if (d.kind === 'valve') {
      /**
       * THE ACTUATOR OWNS ITS OWN TRAVEL — K22.
       *
       * A valve's position is defined between SHUT and FULLY OPEN, and this is
       * the counterpart of `speedTarget`, which has owned the drive's turndown
       * since K12. Before K22 the clamp existed only at the SOLVER boundary,
       * where `frac` takes `clamp(POS / 100, 0, 1)` — so the hydraulics were
       * safe and the PUBLISHED state was not. Measured: an operator writing
       * `OP = 150` read back a position of 150 %, and `OP = -50` drove it
       * negative, both of which reached the faceplate, `LoopState.actual` and
       * the DEV alarm's own comparison.
       *
       * NOT AN INVENTED LIMIT. 0 % shut and 100 % open is what a valve
       * POSITION MEANS; every consumer in the runtime already assumes it, and
       * `outputRange` hands a valve loop exactly this travel. A controller
       * could never produce a command outside it — only a direct write could,
       * and that path had no owner.
       *
       * THE COMMAND IS LEFT READING WHAT WAS ASKED, exactly as K12 leaves
       * `SPD` reading a speed the drive is refusing, so the clamp is visible
       * rather than silent. What changes is the POSITION, which is physical.
       */
      const cmd = travelTarget(t)
      const pos = t.POS ?? cmd
      t.POS = (t.STUCK ?? 0) >= 0.5 ? pos : pos + clamp(cmd - pos, -STROKE_RATE * dt, STROKE_RATE * dt)
      /**
       * ...and the deviation is judged against the ACHIEVABLE command. A valve
       * held at 100 % by its own travel while something asks for 150 is
       * FOLLOWING, and raising `valve not following` for it would blame the
       * actuator for a command it obeyed as far as it physically goes.
       */
      t.DEVT = Math.abs(cmd - t.POS) > DEV_LIMIT ? (t.DEVT ?? 0) + dt : 0
    }
  }

  // 2) THE HYDRAULIC SOLVE — the one place a flow or a pressure is decided.
  //
  //    Quasi-steady: given where every valve sits, how fast every pump turns
  //    and what every vessel holds, this answers what the pressure field is
  //    and therefore what is moving. The dynamics are what those flows then do
  //    to the inventories, below. The causal order is the point:
  //
  //        valve position -> resistance -> pressure field -> flow -> inventory
  //
  //    and not the conductance heuristic it replaced, which multiplied a
  //    pump's rating by the valve fractions on a path and painted pressure on
  //    afterwards. There is no second flow calculation left in the runtime.
  const level = (tag: string) => prev[tag]?.PV ?? 0
  /** Valve opening 0..1: actual POSITION where the actuator has one, else the
   *  command, else an on/off valve's state. The solver turns this into a
   *  resistance — it is never multiplied into a flow. */
  const frac = (v: string) => {
    const t = tags[v]
    if (!t) return 1
    if (t.POS !== undefined) return clamp(t.POS / 100, 0, 1)
    if (t.OP !== undefined) return clamp(t.OP / 100, 0, 1)
    return (t.OPEN ?? 1) >= 0.5 ? 1 : 0
  }
  /** Delivery follows the SHAFT, not the command: a coasting pump is still
   *  moving liquid, and a tripped one is not — its breaker is open. */
  const ramp = (p: string) => {
    const t = tags[p]
    if (!t || (t.FAULT ?? 0) >= 0.5) return 0
    return clamp(t.RAMP ?? ((t.RUN ?? 0) >= 0.5 ? 1 : 0), 0, 1)
  }
  const ratedOf = (p: string) => defByName.get(p)?.ratedFlow ?? DEFAULTS.pumpFlowM3h
  const headOf = (p: string) => pumpHeadBar(defByName.get(p), model.pumpFluid.get(p))
  /** A vessel is CLOSED at the operating pressure its record states, and VENTED
   *  when it states none. Silence means vented; it never means unknown. */
  const vapourOf = (t: string) =>
    defByName.get(t)?.vesselPressureBarA ?? DEFAULTS.atmosphericPressureBar
  const hyd = solveHydraulics(model.hydraulic, {
    valveOpen: frac,
    pumpSpeed: ramp,
    pumpRated: ratedOf,
    pumpHead: headOf,
    vesselLevel: level,
    vesselPressure: vapourOf,
    ...(opts?.boundaryPressure ? { boundaryPressure: opts.boundaryPressure } : {}),
    ...(opts?.pipeFactor ? { pipeFactor: opts.pipeFactor } : {}),
  }, opts?.warmStart ? { warmStart: opts.warmStart } : {})

  //    Branch flow, for the consumers that still ask in branch terms — the
  //    thermal model and the Overview flowsheet. DERIVED from the solve rather
  //    than computed a second way: a branch carries what its pipes carry.
  const branchFlows: Record<string, number> = {}
  for (const b of model.net.branches) {
    const first = b.pipeIds[0]
    branchFlows[b.id] = first === undefined ? 0 : Math.abs(hyd.pipeFlow[first] ?? 0)
  }

  // 3) integrate vessel inventories. THE conversion the audit was about:
  // m³ = m³/h × s / 3600, then level is that volume over the vessel's real
  // capacity in m³ — a number that comes from the engineering record and has
  // nothing to do with how large the widget is drawn.
  for (const d of model.defs) {
    if (d.kind !== 'tank') continue
    const capacity = Math.max(1e-6, d.capacity ?? DEFAULTS.tankVolumeM3)
    const t = tags[d.name]!
    // INVENTORY, m³, is the state; level is derived from it. The vessel's own
    // port nodes are asked what crossed them, SIGNED, so a line that reverses
    // drains a vessel it was filling a moment ago — which the branch model,
    // whose flows were non-negative, could not express at all.
    const netFlow = vesselNetFlow(model, hyd, d.name) // m³/h, + into the vessel
    const held = t.V ?? (capacity * clamp(t.PV ?? 0, 0, 100)) / 100
    const next = clamp(held + volumeMoved(netFlow, dt), 0, capacity)
    t.V = next
    t.PV = clamp((next / capacity) * 100, BOUNDS.levelPct.min, BOUNDS.levelPct.max)
  }

  // 4) the pressure a line actually sits at, straight out of the solve. A PT
  //    bound to a pipe reads the mean of its edge's two node pressures, which
  //    is the pressure at the middle of that run. Gauges read the same map.
  const pipePressures = pipePressureMap(model, hyd)
  for (const d of model.defs) {
    if (d.kind !== 'tank') continue
    tags[d.name]!.P = tankPressureBar(tags[d.name]!.PV ?? 0)
  }

  // 5) thermal: heater duty into each vessel, mixing with what flows in,
  // first-order loss to ambient
  const heaterDutyKw = (h: string) => {
    const kw = defByName.get(h)?.heaterKw
    if (kw === undefined) return 0
    const t = tags[h]
    if (!t) return 0
    return kw * ramp(h) * clamp((t.OP ?? 100) / 100, 0, 1)
  }
  const thermal = {
    flow: (id: string) => branchFlows[id] ?? 0,
    tankTemp: (tag: string) => prev[tag]?.T ?? DEFAULTS.ambientC,
    tankLevel: (tag: string) => tags[tag]?.PV ?? 0,
    capacity: (tag: string) => defByName.get(tag)?.capacity ?? DEFAULTS.tankVolumeM3,
    heaterDutyKw,
  }
  for (const d of model.defs) {
    if (d.kind !== 'tank') continue
    const t = tags[d.name]!
    const rate = tankTempRate(model.net, d.name, thermal)
    t.T = clamp((t.T ?? DEFAULTS.ambientC) + rate * dt, BOUNDS.temperatureC.min, BOUNDS.temperatureC.max)
  }
  const pipeTemps = pipeTemperatures(model.net, (tag) => tags[tag]?.T ?? DEFAULTS.ambientC)

  // 6) measurements. Each transmitter reads the process variable its ISA
  // letter says it measures, at the place it is bound to, plus measurement
  // noise. A tag with no binding has no process behind it and keeps its idle
  // wander — sim/quality.ts reports that as UNCERTAIN rather than hiding it.
  for (const d of model.defs) {
    if (d.kind !== 'display') continue
    const t = tags[d.name]!
    // A frozen or hand-forced input stops tracking the process. Both keep
    // their last number on purpose — `sim/quality.ts` turns each into a
    // visible badge, because a held value that reads as live is worse than
    // no value at all.
    if ((t.FROZEN ?? 0) >= 0.5 || (t.FORCED ?? 0) >= 0.5) continue
    const noise = (rng() - 0.5) * (d.max - d.min) * NOISE_FRACTION
    const read = (v: number) => clamp(v + noise, d.min, d.max)
    const measured = measurementOf(d, tags, pipePressures, pipeTemps, model, hyd)
    if (measured !== undefined) {
      t.PV = read(measured)
      continue
    }
    const base = d.base ?? (d.min + d.max) / 2
    const wander = (rng() - 0.5) * (d.max - d.min) * 0.01
    t.PV = clamp((t.PV ?? base) + wander + (base - (t.PV ?? base)) * 0.02, d.min, d.max)
  }
  /**
   * WHAT EACH LOOP ENDED THE TICK ABLE TO DO — K16.
   *
   * Built HERE, after the actuators have stroked and the measurements have
   * been taken, so `actual` is the state the actuator finished at rather than
   * the one the controller saw when it looked. `requested` is the controller's
   * output, which is exactly what it asked for; the gap between them is the
   * thing §6 exists to keep visible.
   */
  const loops: Record<string, LoopState> = {}
  for (const c of model.controllers) {
    const v = verdict.get(c.tag)
    const t = tags[c.tag]
    if (!v || !t) continue
    const el = c.outTag !== undefined ? tags[c.outTag] : undefined
    /**
     * A valve's stroked `POS`, a drive's shaft. Never the command: the whole
     * K12 distinction is that an actuator takes time to arrive and a stuck one
     * never does. A heater has no dynamics in this model, so its actual IS its
     * command, and saying so is more honest than leaving the field empty.
     */
    const actual = el === undefined ? undefined
      : c.outKind === 'pump' ? (el.RAMP ?? 0) * 100
      : c.outKind === 'cascade' ? t.OP          // a setpoint has no actuator of its own
      : el.POS ?? el.OP
    /**
     * K17: the cascade's own requested-versus-actual. The master ASKS for a
     * setpoint, in the slave's units; the slave CARRIES one. They are the same
     * number while the link is working and are still two different things.
     */
    const sd = c.outKind === 'cascade' && c.outTag !== undefined
      ? defByName.get(c.outTag) : undefined
    const commandedSp = sd && sd.max > sd.min && t.OP !== undefined
      ? sd.min + (clamp(t.OP, 0, 100) / 100) * (sd.max - sd.min) : undefined
    /**
     * K21: THE COMMAND, not the request. `OPC` exists only where a rate limit
     * is configured, so with none this is `t.OP` exactly as it always was.
     */
    const requested = c.outTag !== undefined ? (t.OPC ?? t.OP) : undefined
    const requestedOp = c.outputRatePctPerS !== undefined ? t.OP : undefined
    loops[c.tag] = {
      tag: c.tag,
      mode: (t.MODE ?? 0) >= 0.5 ? 'AUTO' : 'MANUAL',
      authority: v.authority,
      ...(v.blockedBy !== undefined ? { blockedBy: v.blockedBy } : {}),
      ...(c.outTag !== undefined ? { actuator: c.outTag } : {}),
      ...(requested !== undefined ? { requested } : {}),
      ...(requestedOp !== undefined ? { requestedOp } : {}),
      ...(actual !== undefined ? { actual } : {}),
      ...(c.outputRatePctPerS !== undefined
        ? {
            outputRatePctPerS: c.outputRatePctPerS,
            /**
             * BINDING, not merely configured. The limit is in force all the
             * time; this says whether it is currently costing the loop
             * anything, which is the only part an operator needs to react to.
             */
            rateLimited: requestedOp !== undefined && requested !== undefined
              && Math.abs(requestedOp - requested) > 1e-9,
          }
        : {}),
      // the SAME deviation limit a stuck valve's DEV alarm already uses; no new
      // threshold was introduced for this
      tracking: requested !== undefined && actual !== undefined
        && Math.abs(requested - actual) > DEV_LIMIT,
      saturated: (t.SAT ?? 0) > 0 ? 1 : (t.SAT ?? 0) < 0 ? -1 : 0,
      ...(c.cascadeTo !== undefined ? { cascadeTo: c.cascadeTo } : {}),
      ...(c.cascadeFrom !== undefined ? { cascadeFrom: c.cascadeFrom } : {}),
      ...(c.cascadeProblem !== undefined ? { cascadeProblem: c.cascadeProblem } : {}),
      ...(commandedSp !== undefined ? { commandedSp } : {}),
      /**
       * THE SETPOINT THE SLAVE IS ACTUALLY CARRYING.
       *
       * `SP` is what the master wrote. Where the minimum-flow protection has
       * raised it, the slave controlled to the raised value and THAT is the
       * setpoint in force — which is precisely what this field has always
       * claimed to be, and what lets a master's plate show 12 asked for beside
       * 20 being held without either number being invented. The slave ran
       * earlier in this same tick, so its entry is this tick's.
       *
       * K24 ADDED THE MIDDLE CASE. K23 gave the slave its own engineering
       * setpoint limits, and a slave whose setpoint was limited went on
       * reporting the RAW value the master wrote — which is the one thing this
       * field has always promised not to do. The min-flow demand already
       * accounts for the limit (K23 hands it the limited setpoint), so only
       * the fallback needed widening: a slave with limits and no minimum flow
       * now reports what it is carrying rather than what it was sent.
       */
      ...(c.outKind === 'cascade' && c.outTag !== undefined
        ? (() => {
            const sp = demands.get(c.outTag)?.effectiveSp
              ?? spLimits.get(c.outTag)?.limited
              ?? tags[c.outTag]?.SP
            return sp !== undefined ? { effectiveSp: sp } : {}
          })()
        : {}),
      ...(demands.get(c.tag) !== undefined ? { minFlow: demands.get(c.tag)! } : {}),
      ...(spLimits.get(c.tag) !== undefined ? { spLimit: spLimits.get(c.tag)! } : {}),
      ...(dsLimited.get(c.tag) !== undefined
        ? { downstreamLimited: dsLimited.get(c.tag)! } : {}),
    }
  }
  return { tags, branchFlows, pipePressures, hydraulic: hyd, loops }
}

/**
 * The process variable a bound transmitter is reading, before noise.
 *
 * `undefined` means "nothing is bound", which is the only case left that falls
 * back to an idle wander. Note that WHAT is read depends on the tag's ISA
 * letter and not on what it is bound to: a PT and an LT both bound to the same
 * vessel read its head and its level respectively.
 */
function measurementOf(
  d: TagDef,
  tags: Tags,
  pipePressures: Record<string, number>,
  pipeTemps: Record<string, number>,
  model: SimModel,
  hyd: SolveResult,
): number | undefined {
  const measures: Measures = d.measures ?? (d.bindPipe ? 'flow' : 'level')
  if (d.bindTank !== undefined) {
    const tank = tags[d.bindTank]
    if (!tank) return undefined
    if (measures === 'pressure') return tank.P ?? 0
    if (measures === 'temperature') return tank.T ?? DEFAULTS.ambientC
    return tank.PV ?? 0
  }
  if (d.bindPipe !== undefined) {
    if (measures === 'pressure') return pipePressures[d.bindPipe] ?? 0
    if (measures === 'temperature') return pipeTemps[d.bindPipe] ?? DEFAULTS.supplyTempC
    /**
     * FLOW IS THE SOLVED STREAM, not a sum over paths.
     *
     * The pipe the instrument is installed in belongs to exactly one hydraulic
     * edge, and that edge's flow IS what crosses the instrument. The branch
     * model had to add up every path through the pipe because a branch was a
     * route rather than a conductor; an edge is a conductor.
     *
     * The transmitter reads the MAGNITUDE — a flow element does not know which
     * way round it was installed — and the SIGN is preserved in `pipeFlows`,
     * so the runtime keeps the direction even where the reading does not.
     */
    const edgeId = model.hydraulic.edgeOfPipe.get(d.bindPipe)
    if (edgeId === undefined) return undefined
    return Math.abs(hyd.flow[edgeId] ?? 0)
  }
  return undefined
}

export { SECONDS_PER_HOUR }
