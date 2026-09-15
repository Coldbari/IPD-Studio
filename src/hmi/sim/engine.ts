// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { HmiScreen } from '../model'
import type { Measures, TagDef } from './tags'
import { buildTagDefs } from './tags'
import type { Registry } from '../../model/registry'
import type { FlowNetwork } from './network'
import { buildNetwork, solveFlows } from './network'
import { BOUNDS, DEFAULTS, SECONDS_PER_HOUR, clamp, volumeMoved } from './units'
import { pipeTemperatures, solvePressures, tankPressureBar, tankTempRate } from './process'

export interface ControllerSpec {
  tag: string
  pvTag: string
  outTag?: string
  /** What the output drives. A temperature loop with no valve in its family
   *  modulates the heater that warms the vessel it measures instead. */
  outKind?: 'valve' | 'heater'
  /** +1 = reverse-acting (open the valve to raise the PV); -1 = direct
   *  (close it to raise the PV). Derived from the flow network — a drain valve
   *  on the measured tank, or a pressure tap on the pump's discharge side,
   *  both invert the loop. */
  action?: 1 | -1
}
export interface SimModel { defs: TagDef[]; net: FlowNetwork; controllers: ControllerSpec[] }
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
  const controllers = wireHeaters(wireControllers(defs), defs, net).map((c) => ({
    ...c,
    action: controllerAction(c, defs, net),
  }))
  return { defs, net, controllers }
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

export function initTags(model: SimModel): Tags {
  // Calm start: a professional screen comes up with nothing moving and no
  // alarms until an operator (or a live control loop) acts. Every hand valve
  // that actually sits in a flow path starts CLOSED (lining up the valves IS
  // the operator's job — and an open drain stub or transfer line would
  // silently empty its tank before anyone touched a thing); a throttling
  // valve no controller drives starts at 0%. Unpiped decorative valves stay
  // open so they don't read as faults.
  const piped = new Set(model.net.branches.flatMap((b) => b.valves))
  const driven = new Set(model.controllers.map((c) => c.outTag).filter(Boolean))
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
        tags[d.name] = d.heaterKw !== undefined ? { RUN: 0, RAMP: 0, OP: 100 } : { RUN: 0, RAMP: 0 }
        break
      case 'valve': {
        const op = driven.has(d.name) ? 40 : 0
        tags[d.name] = { OP: op, POS: op, DEVT: 0 }
        break
      }
      case 'valveOnOff': tags[d.name] = { OPEN: piped.has(d.name) ? 0 : 1 }; break
      case 'display': tags[d.name] = { PV: d.base ?? (d.min + d.max) / 2 }; break // reseeded below if bound
      case 'controller': tags[d.name] = { PV: 0, SP: 50, OP: 40, MODE: 1, I: 0 }; break
    }
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
  const zeroFlow = () => 0
  const { byPipe } = solvePressures(model.net, {
    flow: zeroFlow,
    ramp: zeroFlow,
    rated: (p) => model.defs.find((d) => d.name === p)?.ratedFlow ?? DEFAULTS.pumpFlowM3h,
    head: (p) => model.defs.find((d) => d.name === p)?.head ?? DEFAULTS.pumpHeadBar,
    level: (tag) => tags[tag]?.PV ?? 0,
  })
  const pipeTemps = pipeTemperatures(model.net, (tag) => tags[tag]?.T ?? DEFAULTS.ambientC)
  const fakeModel = { ...model }
  for (const d of model.defs) {
    if (d.kind !== 'display') continue
    const seeded = measurementOf(d, tags, {}, byPipe, pipeTemps, fakeModel)
    if (seeded !== undefined) tags[d.name]!.PV = clamp(seeded, d.min, d.max)
  }
  return tags
}

export interface TickResult {
  tags: Tags
  /** m³/h per branch. */
  branchFlows: Record<string, number>
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
  opts?: { pipeFactor?: (pipeId: string) => number },
): TickResult {
  const n = Math.max(1, Math.ceil(dt / MAX_STEP_S))
  if (n === 1) return step(model, prev, dt, rng, opts)
  let out = step(model, prev, dt / n, rng, opts)
  for (let i = 1; i < n; i++) out = step(model, out.tags, dt / n, rng, opts)
  return out
}

function step(
  model: SimModel,
  prev: Tags,
  dt: number,
  rng: () => number,
  opts?: { pipeFactor?: (pipeId: string) => number },
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
    const tune = cd?.measures ? TUNING[cd.measures] : DEFAULT_TUNING
    const ki = tune.kp / tune.ti
    const errorOf = (sp: number) => (((sp - pv) * (c.action ?? 1)) / span) * 100

    if ((t.MODE ?? 0) < 0.5) {
      const el = tags[c.outTag]
      if (el && el.OP !== undefined) el.OP = t.OP ?? el.OP
      // bumpless transfer: keep the integrator tracking the operator's OP
      // (I = OP − kp·e) so returning to AUTO resumes from here, no kick
      t.I = clamp((t.OP ?? 0) - tune.kp * errorOf(t.SP ?? 50), -100, 100)
      continue
    }
    const e = errorOf(t.SP ?? 50)
    // conditional integration (anti-windup): freeze I while the output is
    // saturated in the error's direction, else overshoot on big transitions
    let I = t.I ?? 0
    let op = clamp(tune.kp * e + I, 0, 100)
    if (!((op >= 100 && e > 0) || (op <= 0 && e < 0))) {
      I = clamp(I + ki * e * dt, -100, 100)
      op = clamp(tune.kp * e + I, 0, 100)
    }
    t.I = I
    t.OP = op
    const el = tags[c.outTag]
    if (el && el.OP !== undefined) el.OP = op
  }

  // 1.5) equipment dynamics: pumps spin up and coast down, valves stroke
  // toward command, deviation time accumulates (a stuck valve stops chasing)
  for (const d of model.defs) {
    const t = tags[d.name]
    if (!t) continue
    if (d.kind === 'motor') {
      if ((t.FAULT ?? 0) >= 0.5 && (t.RUN ?? 0) >= 0.5) t.RUN = 0 // a trip opens the breaker
      const commanded = (t.RUN ?? 0) >= 0.5 && (t.FAULT ?? 0) < 0.5
      t.RAMP = commanded ? Math.min(1, (t.RAMP ?? 0) + dt / RAMP_S)
        : (t.FAULT ?? 0) >= 0.5 ? 0
        : Math.max(0, (t.RAMP ?? 0) - dt / COAST_S)
    }
    if (d.kind === 'valve') {
      const cmd = t.OP ?? 0
      const pos = t.POS ?? cmd
      t.POS = (t.STUCK ?? 0) >= 0.5 ? pos : pos + clamp(cmd - pos, -STROKE_RATE * dt, STROKE_RATE * dt)
      t.DEVT = Math.abs(cmd - t.POS) > DEV_LIMIT ? (t.DEVT ?? 0) + dt : 0
    }
  }

  // 2) branch flows, m³/h. Calm-start doctrine lives in solveFlows: passive
  // free ends, gravity only from tank bottoms with a controllable path, pumps
  // split across their legs by conductance.
  const level = (tag: string) => prev[tag]?.PV ?? 0
  const frac = (v: string) => {
    const t = tags[v]
    if (!t) return 1
    if (t.POS !== undefined) return clamp(t.POS / 100, 0, 1)
    if (t.OP !== undefined) return clamp(t.OP / 100, 0, 1)
    return (t.OPEN ?? 1) >= 0.5 ? 1 : 0
  }
  // Delivery follows the SHAFT, not the command: a coasting pump is still
  // moving liquid, and a tripped one is not (its breaker is open).
  const ramp = (p: string) => {
    const t = tags[p]
    if (!t || (t.FAULT ?? 0) >= 0.5) return 0
    return clamp(t.RAMP ?? ((t.RUN ?? 0) >= 0.5 ? 1 : 0), 0, 1)
  }
  const ratedOf = (p: string) => defByName.get(p)?.ratedFlow ?? DEFAULTS.pumpFlowM3h
  const branchFlows = solveFlows(model.net, frac, ramp, level, opts?.pipeFactor, {
    rated: ratedOf,
    gravity: DEFAULTS.gravityFlowM3h,
  })

  // 3) integrate vessel inventories. THE conversion the audit was about:
  // m³ = m³/h × s / 3600, then level is that volume over the vessel's real
  // capacity in m³ — a number that comes from the engineering record and has
  // nothing to do with how large the widget is drawn.
  for (const d of model.defs) {
    if (d.kind !== 'tank') continue
    let netFlow = 0 // m³/h
    for (const b of model.net.branches) {
      // Same rule as `measurementOf` below: a branch with no computed flow
      // contributes nothing. Inside `step` every branch always has one; the
      // guard is what stops an absent key becoming a NaN inventory.
      if (b.to.kind === 'tank' && b.to.tag === d.name) netFlow += branchFlows[b.id] ?? 0
      if (b.from.kind === 'tank' && b.from.tag === d.name) netFlow -= branchFlows[b.id] ?? 0
    }
    const capacity = Math.max(1e-6, d.capacity ?? DEFAULTS.tankVolumeM3)
    const t = tags[d.name]!
    const deltaPct = (volumeMoved(netFlow, dt) / capacity) * 100
    t.PV = clamp((t.PV ?? 0) + deltaPct, BOUNDS.levelPct.min, BOUNDS.levelPct.max)
  }

  // 4) hydraulics: the pressure profile that the new levels and flows imply
  const { byPipe: pipePressures } = solvePressures(model.net, {
    flow: (id) => branchFlows[id] ?? 0,
    ramp,
    rated: ratedOf,
    head: (p) => defByName.get(p)?.head ?? DEFAULTS.pumpHeadBar,
    level: (tag) => tags[tag]?.PV ?? 0,
  })
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
    const measured = measurementOf(d, tags, branchFlows, pipePressures, pipeTemps, model)
    if (measured !== undefined) {
      t.PV = read(measured)
      continue
    }
    const base = d.base ?? (d.min + d.max) / 2
    const wander = (rng() - 0.5) * (d.max - d.min) * 0.01
    t.PV = clamp((t.PV ?? base) + wander + (base - (t.PV ?? base)) * 0.02, d.min, d.max)
  }
  return { tags, branchFlows, pipePressures }
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
  branchFlows: Record<string, number>,
  pipePressures: Record<string, number>,
  pipeTemps: Record<string, number>,
  model: SimModel,
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
    // flow (and level, which is meaningless on a line) sums the branches
    // crossing this pipe, in m³/h.
    //
    // `?? 0` IS LOad-BEARING, not defensive tidying. `initTags` calls this with
    // an EMPTY branchFlows to seed bound transmitters from the calm-start
    // state, where the honest answer is "nothing is flowing". A non-null
    // assertion there yielded `0 + undefined = NaN`, and that NaN was not
    // transient: a controller in AUTO copied it into its PV on the first tick,
    // clamp() carried it into the integrator, and from there it reached the
    // valve, the vessel, its level, pressure and temperature. Comparisons
    // against NaN are all false, so every alarm on those tags silently stopped
    // annunciating while quality still read GOOD. Two of the three bundled
    // samples did this on every RUN.
    let f = 0
    for (const br of model.net.branches) if (br.pipeIds.includes(d.bindPipe)) f += branchFlows[br.id] ?? 0
    return f
  }
  return undefined
}

export { SECONDS_PER_HOUR }
