// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STATIC HEAD AND TEMPERATURE.
 *
 * WHAT THIS IS NOT, ANY MORE. It used to be a pressure PROFILE laid over the
 * flows a conductance model produced — a second calculation that nothing
 * constrained to agree with the first. Both are gone. Pressure and flow now
 * come from the coupled solve in `sim/hydraulic/`, which is the only place
 * either is computed.
 *
 * WHAT IS LEFT HERE is the thermal model and the one static-head relation the
 * solver asks this module for:
 *
 *   - fill a vessel  -> static head rises -> suction pressure rises
 *   - run a heater   -> duty into the vessel's held volume -> temperature rises
 *   - feed cold      -> mixing with the inlet stream pulls temperature down
 *
 * The energy balance is a well-mixed one per vessel and does not conserve
 * energy across a branch. That causal chain is the point, and it is what the
 * tests assert. The NUMBERS are a plausible engineering approximation for
 * training, nothing more.
 *
 * Pure and DOM-free, like the rest of `sim/`.
 */

import type { FlowNetwork } from './network'
import { DEFAULTS, LIQUID_CP_KJ_PER_M3_K, SECONDS_PER_HOUR, clamp } from './units'

// ── Static head ─────────────────────────────────────────────────────────────

/**
 * The static head a vessel's contents put on its outlet, in bar.
 *
 * Proportional to level, so a filling tank raises the suction pressure of
 * anything drawing off it. `DEFAULTS.tankFullHeadBar` is a CALIBRATED PRESSURE
 * and not a height: a vessel's height is on no drawing and in no record, so one
 * figure stands for every vessel. K34 decided that formally — the quantity is a
 * pressure, it is fluid-independent, and no density is applied to it. Unlike a
 * pump's `duty.head`, which an engineer states in metres and which K31
 * therefore converts against the real service, nobody states this one.
 */
export const tankPressureBar = (levelPct: number): number =>
  (clamp(levelPct, 0, 100) / 100) * DEFAULTS.tankFullHeadBar

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
