// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The PROCESS engineering data of a tag, read from the registry.
 *
 * The sibling of `signalData.ts`, and it exists for the same reason. That
 * module took alarm limits and ranges away from HMI widget props because an
 * operator screen must not be an engineering database by accident. This one
 * takes the remaining physical quantities away from something worse: before
 * it, a tank's CAPACITY defaulted to its widget's pixel area divided by 40, so
 * dragging a vessel's resize handle changed the process model.
 *
 * A physical quantity is a property of the plant. It comes from the record or
 * it comes from a stated default — never from how big something is drawn.
 *
 * The fields read here already existed in `model/fields.ts`; nothing new was
 * invented for the simulator to consume.
 *
 * Everything here is pure and DOM-free.
 */

import type { Registry } from './registry'

/** Internal units, matching `hmi/sim/units.ts`. Every getter converts INTO
 *  these, so a caller never has to ask what unit it just received. */
export interface ProcessEngineering {
  /** Vessel capacity, m³ (`construction.volume`). */
  volumeM3?: number
  /** Rated flow, m³/h (`duty.capacity`). */
  ratedFlowM3h?: number
  /** Rated head, bar (`duty.head` — metres of liquid unless it says otherwise). */
  headBar?: number
  /** Shaft or element power, kW (`duty.power`). */
  powerKw?: number
  /** Design pressure, bar (`design.pressure`, else `duty.designPressure`). */
  designPressureBar?: number
  /** Operating temperature, °C (`design.operatingTemperature`, else `design.temperature`). */
  operatingTempC?: number
}

const EMPTY: ProcessEngineering = {}

/**
 * Read "100 m³", "50", "3.5 bar", "-10 degC" as a number plus whatever unit
 * was written after it.
 *
 * Deliberately strict about the NUMBER and relaxed about the unit: an engineer
 * writes a capacity a dozen ways, but a field that does not start with a
 * number is not a quantity and guessing at one would put an invented value
 * into the process model. Unreadable returns null, and the caller falls back
 * to a stated default that the QA report discloses.
 */
export function parseQuantity(text: string | undefined): { value: number; unit: string } | null {
  if (!text) return null
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(.*)$/.exec(text)
  if (!m) return null
  const value = Number(m[1]!.replace(',', '.'))
  if (!Number.isFinite(value)) return null
  return { value, unit: m[2]!.trim().toLowerCase() }
}

/** Normalise the ways people write a cubic metre or a degree. */
const canon = (u: string) =>
  u.replace(/\^/g, '').replace(/³/g, '3').replace(/²/g, '2').replace(/\s+/g, '').replace(/°/g, 'deg')

type Factors = Record<string, number | ((v: number) => number)>

function convert(q: { value: number; unit: string } | null, table: Factors, dflt: number): number | undefined {
  if (!q) return undefined
  const u = canon(q.unit)
  const f = u === '' ? dflt : table[u]
  if (f === undefined) return undefined // a unit we cannot read is not a guess
  return typeof f === 'function' ? f(q.value) : q.value * f
}

/** Volume -> m³. */
const VOLUME: Factors = { m3: 1, cbm: 1, l: 1e-3, litre: 1e-3, liter: 1e-3, ltr: 1e-3, ft3: 0.0283168, gal: 3.78541e-3 }
/** Flow -> m³/h. */
const FLOW: Factors = { 'm3/h': 1, m3h: 1, cmh: 1, 'm3/hr': 1, 'l/s': 3.6, lps: 3.6, 'l/min': 0.06, lpm: 0.06, 'm3/s': 3600, gpm: 0.2271247 }
/** Head -> bar. Bare numbers are METRES of liquid, which is how a pump curve
 *  is written; 1 bar ≈ 10.197 m of water. */
const HEAD: Factors = { m: 1 / 10.197, mlc: 1 / 10.197, bar: 1, kpa: 1 / 100, pa: 1e-5, psi: 1 / 14.5038, mwc: 1 / 10.197 }
/** Power -> kW. */
const POWER: Factors = { kw: 1, w: 1e-3, mw: 1e3, hp: 0.7457, ps: 0.7355 }
/** Pressure -> bar (gauge; this model does not distinguish gauge from absolute). */
const PRESSURE: Factors = { bar: 1, barg: 1, bara: 1, kpa: 1 / 100, mpa: 10, pa: 1e-5, psi: 1 / 14.5038, psig: 1 / 14.5038, atm: 1.01325 }
/** Temperature -> °C. */
const TEMPERATURE: Factors = { degc: 1, c: 1, degk: (v: number) => v - 273.15, k: (v: number) => v - 273.15, degf: (v: number) => (v - 32) / 1.8, f: (v: number) => (v - 32) / 1.8 }

/**
 * What the registry knows about a tag's physical duty. Empty when there is no
 * record, which is normal rather than an error — most drawings carry equipment
 * nobody has specified yet, and the simulator states its own defaults for
 * exactly that case (and says so: see the `tank-capacity-defaulted` check).
 *
 * O(1): one keyed lookup in the registry the caller already holds.
 */
export function processFor(registry: Registry | undefined, tag: string | undefined): ProcessEngineering {
  if (!registry || !tag) return EMPTY
  const f = registry[tag]?.fields
  if (!f) return EMPTY
  const q = (key: string) => parseQuantity(f[key])
  return {
    volumeM3: convert(q('construction.volume'), VOLUME, 1),
    ratedFlowM3h: convert(q('duty.capacity'), FLOW, 1),
    headBar: convert(q('duty.head'), HEAD, 1 / 10.197),
    powerKw: convert(q('duty.power'), POWER, 1),
    designPressureBar: convert(q('design.pressure') ?? q('duty.designPressure'), PRESSURE, 1),
    operatingTempC: convert(q('design.operatingTemperature') ?? q('design.temperature'), TEMPERATURE, 1),
  }
}
