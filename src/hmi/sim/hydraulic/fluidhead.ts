// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE ONE PLACE FLUID DENSITY ENTERS THE HYDRAULIC SOLVE — K31.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PHYSICAL CONTRACT, stated before anything is computed.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A centrifugal pump imparts ENERGY PER UNIT WEIGHT. That is what a head in
 * metres is: a length, and the same length for every liquid, because the
 * impeller does not know what it is throwing. The PRESSURE that length becomes
 * is what changes:
 *
 *      ΔP [Pa]  =  ρ · g · H            ΔP [bar] = ρ · g · H / 1e5
 *
 * with ρ the density of the liquid actually in the casing, g standard gravity
 * and H the head the datasheet states. Mercury and petrol leave the same pump
 * at the same 35 m and at pressures differing by a factor of eighteen.
 *
 * SO THE UNIT THE RECORD USED IS THE WHOLE QUESTION, and `duty.head` accepts
 * both kinds:
 *
 *   - "35 m", "35 mlc", "35 mwc", or a bare "35" — a HEAD, a length. Density
 *     belongs in the conversion, and K31 puts it there.
 *   - "3.5 bar", "350 kPa", "50 psi" — a DIFFERENTIAL PRESSURE. The engineer
 *     has already done the conversion against whatever fluid they meant, and
 *     multiplying by density a second time would be a second conversion, not a
 *     correction. These pass through untouched, at every density.
 *
 * That distinction is preserved from the record all the way to the solve by
 * `ProcessEngineering.headM` / `TagDef.headM`, which exist for no other reason.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT DO.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * IT DOES NOT TOUCH RESISTANCE. `VALVE_K`, `PIPE_K` and `FITTING_K` are
 * CALIBRATED numbers — they were chosen so that a drawn plant moves a sensible
 * flow, against the pump heads this model was already producing. Their units
 * are bar/(m³/h)² and they absorb geometry, roughness and fluid together. A
 * genuine ΔP = f·(L/D)·ρv²/2 would make ρ appear there too, but it would also
 * need length, bore and roughness, NONE of which this repository stores (K29).
 * Multiplying a calibrated K by ρ without those is not physics; it is scaling a
 * fitted constant by a number that happens to be lying around, and it would
 * silently change every existing plant's flow by the density ratio. K31 §E
 * forbids it and this module does not do it.
 *
 * The consequence is stated plainly rather than hidden: after K31 the model is
 * fluid-coupled ON THE SOURCE TERM and fluid-independent ON THE RESISTANCE.
 * A denser liquid makes more pressure and therefore more flow; it does not yet
 * make more friction. That is a partial coupling, it is the half that has the
 * engineering data to stand on, and `capability.ts` records it as such.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND THERE IS NO HIDDEN WATER FALLBACK.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Most drawings name no service, and those runs must still simulate. They do —
 * but on a basis that is NAMED, exported and asserted by tests rather than
 * buried in a magic number. See `LEGACY_HEAD_DENSITY_KGM3`: the 1/10.197 this
 * project has always used IS a density, it has simply never been written as
 * one, and `unresolved` says so to anything that asks.
 */

import type { Fluid } from '../../../model/types'
import type { ProcessModel } from './model'
import { deriveFluids } from '../fluids'

/** Standard gravity, m/s². The CGPM figure, not a rounded 9.81. */
export const G = 9.80665

/**
 * The density the project's historic head conversion has ALWAYS meant.
 *
 * `processData.ts` converts a head in metres at 1 bar = 10.197 m. Read as
 * physics that factor is ρ·g/1e5, so it pins a density:
 *
 *      ρ = 1e5 / (10.197 · g) = 1000.016 kg/m³
 *
 * which is pure water at 4 °C to five figures. That was never stated anywhere —
 * K30 found it baked into a unit table — and stating it here is the point. It
 * is the DECLARED BASIS for a stream whose service nobody has named, and a test
 * asserts the identity so it cannot drift back into being a coincidence.
 */
export const LEGACY_HEAD_DENSITY_KGM3 = 1e5 / (10.197 * G)

/** Where the density used for a pump's head came from. Never inferred by a
 *  caller — this module says, and diagnostics repeat it. */
export type DensityBasis =
  /** A service is stated on the pump's own stream and that service states a
   *  density. This is the only case where K31 changes a number. */
  | 'fluid'
  /** No service reaches the pump, or the drawing contradicts itself there, or
   *  the service that does reach it states no density. The head converts on
   *  `LEGACY_HEAD_DENSITY_KGM3`, which is disclosed, not assumed. */
  | 'unresolved'
  /** The record stated a PRESSURE, not a head. Density is not part of the
   *  conversion at all and no density was used. */
  | 'stated-pressure'

export interface PumpFluid {
  basis: DensityBasis
  /** Only for `fluid`. The density actually used, kg/m³. */
  densityKgM3?: number
  /** Only for `fluid`. Which service it came from, so a diagnostic can name it. */
  fluidId?: string
  /** Why it is `unresolved`, for the QA report. Absent otherwise. */
  why?: 'no-service' | 'mixed' | 'no-density'
}

const UNRESOLVED_NO_SERVICE: PumpFluid = { basis: 'unresolved', why: 'no-service' }

/**
 * Head → pressure, the contract at the top of this file.
 *
 * Total, and finite for every finite input: a caller upstream has already
 * decided that a density applies, and a NaN reaching the solver would poison a
 * Newton iteration in a way that is very hard to read back. Anything that is
 * not a usable positive density falls to the declared basis rather than
 * propagating — see `pumpFluids`, which is where that decision is taken and
 * recorded.
 */
export function headBar(headMetres: number, densityKgM3: number): number {
  return (densityKgM3 * G * headMetres) / 1e5
}

/** A density a solve may actually use: stated, finite and physical. */
export function usableDensity(d: number | undefined): d is number {
  return d !== undefined && Number.isFinite(d) && d > 0
}

/**
 * WHICH LIQUID IS IN EACH PUMP.
 *
 * A pump is ONE edge in the hydraulic model, suction node to discharge node,
 * so the question "suction or discharge?" does not arise as a choice: the
 * stream the pump edge carries IS the liquid passing through the impeller, and
 * `deriveFluids` already assigns it by the same run rule the P&ID uses. A
 * drawing that states different services on the two sides contradicts itself
 * across that run and comes back `mixed` — which is reported as unresolved
 * here, never averaged and never resolved by preferring one end. K31 §A: an
 * ambiguous topology is documented, not silently decided.
 *
 * Keyed by TAG, because that is what the solve's `pumpHead` callback is given.
 */
export function pumpFluids(
  model: ProcessModel,
  fluids: readonly Fluid[] = [],
): Map<string, PumpFluid> {
  const byId = new Map(fluids.map((f) => [f.id, f]))
  const streams = deriveFluids(model, fluids)
  const out = new Map<string, PumpFluid>()
  for (const edge of model.edges) {
    if (edge.kind !== 'pump' || !edge.tag) continue
    const s = streams.byEdge.get(edge.id)
    if (!s || s.state === 'unknown') { out.set(edge.tag, UNRESOLVED_NO_SERVICE); continue }
    if (s.state === 'mixed') { out.set(edge.tag, { basis: 'unresolved', why: 'mixed' }); continue }
    const d = s.fluidId !== undefined ? byId.get(s.fluidId)?.densityKgM3 : undefined
    if (!usableDensity(d)) { out.set(edge.tag, { basis: 'unresolved', why: 'no-density' }); continue }
    out.set(edge.tag, { basis: 'fluid', densityKgM3: d, fluidId: s.fluidId })
  }
  return out
}

/**
 * The number the solver gets, and the reason for it.
 *
 * `headMetres` absent means the record stated a pressure (or nothing, and a
 * default in bar stood in): `statedBar` is already the answer and density has
 * no part in it. Present, it is converted — against the stream's density when
 * one resolved, otherwise against the declared legacy basis, which reproduces
 * the pre-K31 number to the last digit.
 */
export function resolvePumpHeadBar(
  statedBar: number,
  headMetres: number | undefined,
  fluid: PumpFluid | undefined,
): { bar: number; basis: DensityBasis; densityKgM3?: number } {
  if (headMetres === undefined || !Number.isFinite(headMetres)) {
    return { bar: statedBar, basis: 'stated-pressure' }
  }
  if (fluid?.basis === 'fluid' && usableDensity(fluid.densityKgM3)) {
    return {
      bar: headBar(headMetres, fluid.densityKgM3),
      basis: 'fluid',
      densityKgM3: fluid.densityKgM3,
    }
  }
  return { bar: statedBar, basis: 'unresolved', densityKgM3: undefined }
}
