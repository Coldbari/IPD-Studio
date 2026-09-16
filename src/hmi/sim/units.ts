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
   * Pressure at a process BOUNDARY — a free pipe end, bar.
   *
   * ONE constant for every boundary, and that is a stated limitation rather
   * than an oversight. An unterminated line carries no information about what
   * is beyond it, and the model cannot tell a supply header from a discharge
   * to atmosphere. Splitting them was tried: a header at 3 bar lets a supply
   * fill a vented vessel, and in the same move puts 3 bar of backpressure on
   * every gravity drain, which then runs backwards. One atmosphere is the
   * self-consistent choice, and its cost is that a boundary cannot fill a
   * vented vessel unaided — that needs a pump, which is how a plant does it.
   */
  supplyPressureBar: 1,
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
 * Water: 4.186 kJ/(kg·K) × 1000 kg/m³. One fluid, stated here rather than
 * assumed in the equations. A multi-fluid model would read this off the
 * service, which this simulation does not attempt.
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
