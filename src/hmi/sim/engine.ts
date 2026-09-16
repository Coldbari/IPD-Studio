// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiScreen } from '../model'
import type { Measures, TagDef } from './tags'
import { buildTagDefs } from './tags'
import type { Registry } from '../../model/registry'
import type { FlowNetwork } from './network'
import { buildNetwork } from './network'
import type { ProcessModel } from './hydraulic/model'
import { buildProcessModel } from './hydraulic/model'
import type { SolveResult } from './hydraulic/solver'
import { solveHydraulics } from './hydraulic/solver'
import type { ProcessFault } from './quality'
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
  outKind?: 'valve' | 'heater' | 'pump'
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
export function buildSimModel(screens: HmiScreen | HmiScreen[], registry?: Registry): SimModel {
  const list = Array.isArray(screens) ? screens : [screens]
  const defs = buildTagDefs(list, registry)
  const branches = list.flatMap((sc, i) =>
    buildNetwork(sc).branches.map((b) => ({ ...b, id: `S${i}:${b.id}` })),
  )
  const net: FlowNetwork = { branches }
  // the registry comes too: a TAGGED TERMINAL's boundary pressure is on its
  // engineering record, and the topology is where that becomes a fixed node
  const hydraulic = buildProcessModel(list, registry)
  const controllers = wirePumps(wireHeaters(wireControllers(defs), defs, net), defs, hydraulic)
    .map((c) => ({
      ...c,
      action: controllerAction(c, defs, net),
      ...outputRange(c, defs),
    }))
  return { defs, net, hydraulic, controllers }
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
      case 'controller': tags[d.name] = { PV: 0, SP: 50, OP: 0, MODE: 1, I: 0, SAT: 0 }; break
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
    pumpHead: (p) => model.defs.find((d) => d.name === p)?.head ?? DEFAULTS.pumpHeadBar,
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
    out = step(model, out.tags, dt / n, rng,
      out.hydraulic.converged ? { ...opts, warmStart: out.hydraulic.pressure } : opts)
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
  for (const c of model.controllers) {
    const t = tags[c.tag]
    if (!t) continue
    const pv = tags[c.pvTag]?.PV ?? 0
    t.PV = pv
    if (!c.outTag) continue // PV-only controller: nothing to drive
    const cd = defByName.get(c.tag)
    const span = Math.abs((cd?.max ?? 100) - (cd?.min ?? 0)) || 100
    // A SPEED loop is tuned as a speed loop. `TUNING` is indexed by what a
    // controller MEASURES; this one measures pressure like any other and
    // drives something else entirely. Nothing in `TUNING` changed.
    const tune = c.outKind === 'pump' ? SPEED_TUNING
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
      if (c.outKind === 'pump') { if (el.SPD !== undefined) el.SPD = v }
      else if (el.OP !== undefined) el.OP = v
    }

    if ((t.MODE ?? 0) < 0.5) {
      drive(clamp(t.OP ?? 0, lo, hi))
      // bumpless transfer: keep the integrator tracking the operator's OP
      // (I = OP − kp·e) so returning to AUTO resumes from here, no kick
      t.I = clamp((t.OP ?? 0) - tune.kp * errorOf(t.SP ?? 50), -100, 100)
      t.SAT = 0
      continue
    }
    const e = errorOf(t.SP ?? 50)
    // conditional integration (anti-windup): freeze I while the output is
    // saturated in the error's direction, else overshoot on big transitions
    let I = t.I ?? 0
    let op = clamp(tune.kp * e + I, lo, hi)
    if (!((op >= hi && e > 0) || (op <= lo && e < 0))) {
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
    t.SAT = op >= hi && e > 0 ? 1 : op <= lo && e < 0 ? -1 : 0
    drive(op)
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
      const cmd = t.OP ?? 0
      const pos = t.POS ?? cmd
      t.POS = (t.STUCK ?? 0) >= 0.5 ? pos : pos + clamp(cmd - pos, -STROKE_RATE * dt, STROKE_RATE * dt)
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
  const headOf = (p: string) => defByName.get(p)?.head ?? DEFAULTS.pumpHeadBar
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
  return { tags, branchFlows, pipePressures, hydraulic: hyd }
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
