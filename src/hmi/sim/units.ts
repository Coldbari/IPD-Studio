// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE simulator's internal units, stated once.
 *
 * Before this module the flow solver was dimensionless while the P&ID importer
 * labelled its output `m³/h`, and a tank's capacity was its widget's pixel
 * area divided by forty. The numbers moved convincingly and meant nothing.
 *
 * Everything inside `sim/` is now in these units and nothing else. A value
 * that arrives in another unit is converted at the boundary — in
 * `model/processData.ts` when it is read out of an engineering record — and
 * never mixed silently.
 */
export const UNITS = {
  flow: 'm³/h',
  volume: 'm³',
  pressure: 'bar',
  temperature: '°C',
  level: '%',
  position: '%',
  speed: '%',
  power: 'kW',
  /** The simulation clock. `dt` is always seconds of PROCESS time. */
  time: 's',
} as const

export const SECONDS_PER_HOUR = 3600

/**
 * Volume moved by a flow over an interval. THE conversion that was missing.
 *
 *   m³ = (m³/h) × s / 3600
 *
 * Every place that turns a flow into an inventory goes through here, so the
 * factor exists once and can be tested once.
 */
export const volumeMoved = (flowM3h: number, dtSeconds: number): number =>
  (flowM3h * dtSeconds) / SECONDS_PER_HOUR

/**
 * ENGINEERING DEFAULTS.
 *
 * These are fallbacks for equipment nobody has specified, not engineering
 * data, and the distinction is enforced: a defaulted tank capacity raises the
 * `tank-capacity-defaulted` check so the report says which vessels are running
 * on an assumption. They are sized as ordinary process plant so that a
 * drawing with no records still behaves plausibly rather than absurdly.
 */
export const DEFAULTS = {
  /** A mid-size process vessel. */
  tankVolumeM3: 100,
  /** A modest centrifugal transfer pump. */
  pumpFlowM3h: 50,
  /** Shutoff head at rated speed. ≈ 40 m of water. */
  pumpHeadBar: 4,
  /** Gravity/battery-limit supply through an open hand valve. */
  gravityFlowM3h: 20,
  /**
   * ONE STANDARD ATMOSPHERE, bar absolute.
   *
   * This is the pressure of the air, and K6 renamed it to say so. It used to be
   * `supplyPressureBar`, which implied a battery-limit supply header and led to
   * the reasonable-sounding but wrong expectation that a free pipe end could
   * PUSH — it cannot, any more than the atmosphere can fill a vented tank.
   *
   * WHERE IT IS USED, and why each is atmosphere rather than a supply:
   *
   *  - A FREE PIPE END. The drawing says nothing about what is beyond it, so
   *    the honest reading is an open connection to the air. It is not a
   *    reservoir and is not pretended to be one.
   *  - A VENTED VESSEL'S VAPOUR SPACE, when its record states no operating
   *    pressure. A vessel whose record DOES state one is closed at that
   *    pressure — see `TagDef.vesselPressureBarA`.
   *  - The initial guess for a free node, and the hold for an undetermined one.
   *
   * `model/processData.ts` states the same figure as `ATMOSPHERIC_BAR` for the
   * engineering side, which must not import the simulator; a test pins them
   * together.
   */
  atmosphericPressureBar: 1,
  /** A full vessel's static head at its outlet. ≈ 3 m of liquid. */
  tankFullHeadBar: 0.3,
  /** Electric process heater. */
  heaterKw: 500,
  /** Ambient, and the temperature of anything entering from outside. */
  ambientC: 20,
  supplyTempC: 20,
} as const

/** Physical bounds. A simplified model must stay inside the envelope it can
 *  honestly claim; a runaway number is worse than a coarse one. */
export const BOUNDS = {
  pressureBar: { min: 0, max: 64 },
  temperatureC: { min: -50, max: 300 },
  levelPct: { min: 0, max: 100 },
} as const

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/**
 * Volumetric heat capacity of the process liquid, kJ/(m³·K).
 *
 * Water: 4.186 kJ/(kg·K) × 1000 kg/m³ — and those two numbers are not written
 * twice. They are the canonical water definition in `model/doc.ts`
 * (`DEFAULT_FLUIDS`), whose `heatCapacityKJkgK × densityKgM3` is exactly this
 * figure; `tests/hmi/fluids.test.ts` fails if they ever part company.
 *
 * ONE FLUID, stated here rather than assumed in the equations. K5 gave streams
 * an explicit IDENTITY, and that identity is informational: the thermal model
 * and the hydraulic solver still run on this single liquid, and neither reads a
 * density or a viscosity off the service. Making them do so is a physics change
 * and would have to be validated as one.
 */
export const LIQUID_CP_KJ_PER_M3_K = 4186

/** Seconds of simulated time per real second. Accelerates the CLOCK; the
 *  equations are untouched, which is what `tick`'s sub-stepping guarantees. */
export type SimSpeed = 1 | 10 | 60 | 300
export const SIM_SPEEDS: readonly SimSpeed[] = [1, 10, 60, 300]

/** h:mm:ss — a process that runs for hours needs an hours field. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(ss)}`
}
