// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * PRESSURE AND TEMPERATURE — a deterministic simplified process model.
 *
 * WHAT THIS IS NOT. It is not a hydraulic network solve and not a thermodynamic
 * one. It does not conserve energy across a branch, it does not iterate to a
 * consistent pressure field, and it knows about exactly one fluid. Claiming
 * otherwise would be the same mistake the audit found in the version before
 * it, which dressed a random walk up as a pressure transmitter.
 *
 * WHAT IT IS. A pressure and temperature PROFILE layered on top of the flows
 * the existing network solver already produces, chosen so that every value an
 * operator can see moves for a real reason:
 *
 *   - close a valve  -> flow falls -> the pump rides up its curve -> discharge
 *                       pressure RISES, downstream pressure falls
 *   - stop the pump  -> no head    -> discharge pressure falls to suction
 *   - fill a vessel  -> static head rises -> suction pressure rises
 *   - run a heater   -> duty into the vessel's held volume -> temperature rises
 *   - feed cold      -> mixing with the inlet stream pulls temperature down
 *
 * That causal chain is the point, and it is what the tests assert. The
 * NUMBERS are a plausible engineering approximation for training, nothing more.
 *
 * Pure and DOM-free, like the rest of `sim/`.
 */

import type { FlowNetwork } from './network'
import { BOUNDS, DEFAULTS, LIQUID_CP_KJ_PER_M3_K, SECONDS_PER_HOUR, clamp } from './units'

// ── Pressure ────────────────────────────────────────────────────────────────

/**
 * Line loss coefficient, bar per (m³/h)².
 *
 * Sized so a default pump (50 m³/h, 4 bar shutoff) running into a fully open
 * path loses about 1 bar to friction. Quadratic in flow, which is the right
 * shape for turbulent pipe loss even though the coefficient is a choice.
 */
export const LOSS_K = 4e-4

/**
 * The static head a vessel's contents put on its outlet, in bar.
 *
 * Proportional to level, so a filling tank raises the suction pressure of
 * anything drawing off it. `DEFAULTS.tankFullHeadBar` is roughly three metres
 * of liquid — a vessel's height is not on the drawing, so one figure stands
 * for all of them and is documented as such.
 */
export const tankPressureBar = (levelPct: number): number =>
  (clamp(levelPct, 0, 100) / 100) * DEFAULTS.tankFullHeadBar

/** Pressure at the three points of a branch that an instrument can sit at. */
export interface BranchPressure {
  /** Suction side: supply header, or the static head of the source vessel. */
  pIn: number
  /** Between the pump and the throttling element — the pump's discharge. This
   *  is the one that RISES as a valve closes, and the one a pressure loop
   *  normally controls. */
  pHigh: number
  /** Downstream of the throttling element: the destination's pressure plus
   *  whatever friction the flow into it costs. */
  pOut: number
}

export interface HydraulicCtx {
  /** Branch flow, m³/h, from solveFlows. */
  flow(branchId: string): number
  /** Pump shaft fraction 0..1 (RAMP). */
  ramp(pumpTag: string): number
  /** Pump rated flow, m³/h at full speed. */
  rated(pumpTag: string): number
  /** Pump shutoff head, bar at full speed. */
  head(pumpTag: string): number
  /** Vessel level, %. */
  level(tankTag: string): number
}

/**
 * Head a pump delivers at a given flow.
 *
 * A quadratic curve falling from shutoff head to zero at rated flow, scaled by
 * the affinity laws: head goes as speed², capacity as speed. It is the
 * textbook SHAPE of a centrifugal characteristic rather than any particular
 * pump's curve, and that is all the model claims.
 */
export function pumpHeadBar(headAtRated: number, ratedFlow: number, ramp: number, flow: number): number {
  const r = clamp(ramp, 0, 1)
  if (r <= 0) return 0
  const shutoff = headAtRated * r * r
  const runout = Math.max(1e-6, ratedFlow * r)
  return shutoff * Math.max(0, 1 - (flow / runout) ** 2)
}

/** Pressure at every branch, and the one pressure each pipe sits at. */
export function solvePressures(
  net: FlowNetwork,
  ctx: HydraulicCtx,
): { byBranch: Record<string, BranchPressure>; byPipe: Record<string, number> } {
  const byBranch: Record<string, BranchPressure> = {}
  const byPipe: Record<string, number> = {}
  const bar = (v: number) => clamp(v, BOUNDS.pressureBar.min, BOUNDS.pressureBar.max)

  for (const b of net.branches) {
    const q = ctx.flow(b.id)
    const pIn = bar(b.from.kind === 'tank' ? tankPressureBar(ctx.level(b.from.tag)) : DEFAULTS.supplyPressureBar)
    let head = 0
    for (const p of b.pumps) head += pumpHeadBar(ctx.head(p), ctx.rated(p), ctx.ramp(p), q)
    const pHigh = bar(pIn + head)
    const pDest = b.to.kind === 'tank' ? tankPressureBar(ctx.level(b.to.tag)) : 0
    const pOut = bar(pDest + LOSS_K * q * q)
    byBranch[b.id] = { pIn, pHigh, pOut }

    // Assign each pipe the pressure of the section it belongs to: suction up
    // to the pump, discharge up to the throttling element, downstream after.
    //
    // `pumpIndex` is the index of the pipe whose HEAD is the pump — so that
    // pipe LEAVES the pump and is already discharge. Only strictly earlier
    // pipes are suction, and the same reading applies to the valve.
    const pumpAt = b.pumpIndex ?? -1
    const valveAt = b.valveIndex ?? Number.POSITIVE_INFINITY
    b.pipeIds.forEach((id, i) => {
      const p = i < pumpAt ? pIn : i < valveAt ? pHigh : pOut
      // a header shared by several branches reads the highest section it is
      // part of; pressures do not add the way flows do
      byPipe[id] = Math.max(byPipe[id] ?? 0, p)
    })
  }
  return { byBranch, byPipe }
}

// ── Temperature ─────────────────────────────────────────────────────────────

/**
 * Heat-loss time constant of a vessel, seconds.
 *
 * A first-order pull towards ambient with a four-hour time constant — an
 * insulated process vessel. One figure for every vessel, because insulation
 * is not on the drawing either.
 */
export const LOSS_TAU_S = 4 * SECONDS_PER_HOUR

/** A nearly empty vessel still has SOME thermal mass. Without a floor the
 *  temperature rate divides by a vanishing volume and the model explodes as a
 *  tank drains, which is a numerical artefact and not a process. */
const MIN_HELD_FRACTION = 0.02

export interface ThermalCtx {
  flow(branchId: string): number
  tankTemp(tankTag: string): number
  tankLevel(tankTag: string): number
  /** Vessel capacity, m³. */
  capacity(tankTag: string): number
  /** Heater duty ALREADY scaled by its run state and output, kW. */
  heaterDutyKw(heaterTag: string): number
}

/**
 * Rate of change of a vessel's temperature, °C per second.
 *
 *   dT/dt = Σ q_in (T_in − T) / V_held   mixing with what is coming in
 *         + Q̇ / (V_held · ρ·cp)          heater duty into the contents
 *         − (T − T_ambient) / τ_loss     first-order loss to ambient
 *
 * Well-mixed: the vessel is one temperature throughout, and liquid leaving
 * takes that temperature with it, so an outflow moves no heat relative to the
 * contents and does not appear. No phase change, no reaction, one fluid.
 */
export function tankTempRate(net: FlowNetwork, tankTag: string, ctx: ThermalCtx): number {
  const cap = Math.max(1e-6, ctx.capacity(tankTag))
  const held = Math.max(cap * MIN_HELD_FRACTION, (cap * clamp(ctx.tankLevel(tankTag), 0, 100)) / 100)
  const T = ctx.tankTemp(tankTag)

  let mixing = 0 // m³/s · °C
  let dutyKw = 0
  for (const b of net.branches) {
    const intoThis = b.to.kind === 'tank' && b.to.tag === tankTag
    // a stub off this vessel that carries a heater is a recirculation heating
    // loop: the duty lands back in the vessel it came from
    const loopOnThis = b.from.kind === 'tank' && b.from.tag === tankTag && b.to.kind !== 'tank'
    if (!intoThis && !loopOnThis) continue
    if (intoThis) {
      const q = ctx.flow(b.id)
      const tIn = b.from.kind === 'tank' ? ctx.tankTemp(b.from.tag) : DEFAULTS.supplyTempC
      mixing += (q / SECONDS_PER_HOUR) * (tIn - T)
    }
    for (const h of b.heaters) dutyKw += ctx.heaterDutyKw(h)
  }

  const heat = dutyKw / (held * LIQUID_CP_KJ_PER_M3_K) // kJ/s ÷ (m³ · kJ/m³K) = K/s
  const loss = (T - DEFAULTS.ambientC) / LOSS_TAU_S
  return mixing / held + heat - loss
}

/** The temperature of the liquid in each pipe: whatever its branch is
 *  carrying — its source vessel's contents, or the supply temperature. */
export function pipeTemperatures(net: FlowNetwork, tankTemp: (tag: string) => number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of net.branches) {
    const t = b.from.kind === 'tank' ? tankTemp(b.from.tag) : DEFAULTS.supplyTempC
    for (const id of b.pipeIds) out[id] ??= t
  }
  return out
}
