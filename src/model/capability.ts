// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE MODEL-TRUTH BOUNDARY — what the engineering record can actually say, and
 * what this simulator knows only because somebody chose a number.
 *
 * ── THE QUESTION THIS ANSWERS ─────────────────────────────────────────────
 *
 * By K26 the runtime had accumulated engineering fields, simulator assumptions
 * and normalised software domains side by side, each correct in its own place
 * and none of them written down together. The danger that creates is specific
 * and one-directional: a convenient constant quietly becoming "what the
 * datasheet says". K27 audited all eighty-one declared fields against what the
 * runtime actually reads, and this is the result.
 *
 * ── THE FOUR CLASSES ──────────────────────────────────────────────────────
 *
 *   ENGINEERING   A record states it and the runtime reads it. The plant
 *                 behaves differently because an engineer typed something.
 *   DECLARED      A record can state it and NOTHING reads it. Legitimate —
 *                 a datasheet carries far more than a simulator needs — but it
 *                 must never be mistaken for the first class.
 *   ASSUMPTION    The runtime needs a number, no record carries one, and the
 *                 model states its own. Honest only while it says so.
 *   DOMAIN        Not a value at all: the range a quantity is defined on,
 *                 like 0-100 % for a valve position.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * AN ITEM MAY NEVER MOVE FROM `ASSUMPTION` TO `ENGINEERING` BECAUSE A
 * CONVENIENT DEFAULT EXISTS. Wiring a datasheet field into physics is a
 * modelling decision with a stated physical relationship behind it, not a
 * matter of noticing that a field with a plausible name is going spare.
 * `tests/model/capability.test.ts` proves, behaviourally, that everything
 * marked `DECLARED` really does leave the simulation untouched — so promoting
 * one without saying so breaks a test rather than a plant.
 *
 * Nothing here is consumed by the runtime. It is a record, checked against the
 * runtime, and deliberately not a source of truth for it.
 */

export type TruthClass =
  /** A record states it; the runtime reads it. */
  | 'ENGINEERING'
  /** A record may state it; nothing reads it. */
  | 'DECLARED'
  /** The model states it, because no record does. */
  | 'ASSUMPTION'
  /** The range a quantity is defined on, not a value anybody chose. */
  | 'DOMAIN'

export interface CapabilityFact {
  /** The field key, the constant's name, or the domain's description. */
  id: string
  cls: TruthClass
  /** What it means — never inferred from the name. */
  meaning: string
  /** The unit it is held in, or `null` for a domain or a non-quantity. */
  unit: string | null
  /** What absence means. `null` where absence is not a possible state. */
  absent: string | null
}

/**
 * THE EQUIPMENT SIDE, which is where K26 and K27 concentrated.
 *
 * The instrument side is not repeated here: `signal.*` and `alarm.*` are
 * covered field by field in `signalData.ts` and `sim/alarms.ts`, and every one
 * of them that the runtime reads is already pinned by its own phase's tests.
 * What was missing, and what this records, is the MACHINE.
 */
export const EQUIPMENT_CAPABILITY: readonly CapabilityFact[] = [
  // ── What an engineer states and the plant obeys ──────────────────────────
  {
    id: 'duty.capacity',
    cls: 'ENGINEERING',
    meaning: 'rated flow — the duty point the pump curve is built around',
    unit: 'm³/h',
    absent: 'DEFAULTS.pumpFlowM3h stands in, and the QA report discloses it',
  },
  {
    id: 'duty.head',
    cls: 'ENGINEERING',
    meaning: 'rated head at that duty; the curve’s shutoff is derived from it',
    unit: 'bar',
    absent: 'DEFAULTS.pumpHeadBar stands in, and the QA report discloses it',
  },
  {
    id: 'duty.vsd',
    cls: 'ENGINEERING',
    meaning: 'whether this driver is on a variable speed drive — a declared capability',
    unit: null,
    absent: 'fixed speed, which is what every machine drawn before K12 is',
  },
  {
    id: 'duty.minSpeed',
    cls: 'ENGINEERING',
    meaning: 'the drive’s turndown: the lowest fraction of rated speed it will run at. '
      + 'The ONE equipment rate or limit in this product with a real owner, enforced twice '
      + 'on purpose — see `sim/constraints.ts`',
    unit: '% of rated',
    absent: 'no turndown imposed; a value outside 0-100 is refused, not clamped',
  },
  {
    id: 'duty.minFlow',
    cls: 'ENGINEERING',
    meaning: 'minimum continuous flow — a manufacturer’s figure about the impeller',
    unit: 'm³/h',
    absent: 'no limit, no protection, and K13 reports LIMIT UNKNOWN',
  },
  {
    id: 'duty.power',
    cls: 'ENGINEERING',
    meaning: 'shaft or element power; a heater’s duty comes from it',
    unit: 'kW',
    absent: 'DEFAULTS.heaterKw for a heater; nothing for a pump',
  },

  // ── What an engineer may state and nothing reads ─────────────────────────
  {
    id: 'duty.speed',
    cls: 'DECLARED',
    meaning: 'RATED SPEED, in rpm. Not a percentage and not a maximum. The pump curve is '
      + 'parameterised by FRACTION of rated speed and never by rpm, so there is no '
      + 'relationship through which this could enter the physics — and none is invented. '
      + 'It would become necessary only if a maximum speed in rpm ever arrived, which is '
      + 'what it would be converted against',
    unit: 'rpm',
    absent: 'nothing changes, because nothing reads it',
  },
  {
    id: 'duty.designTemperature',
    cls: 'DECLARED',
    meaning: 'a RATING — what the machine is built to withstand. Deliberately not read as '
      + 'an operating temperature, which is a different quantity and has its own field',
    unit: '°C',
    absent: 'nothing changes',
  },
  {
    id: 'element.cv',
    cls: 'DECLARED',
    meaning: 'a valve’s flow coefficient — the parameter that WOULD set its hydraulic '
      + 'resistance. The solver uses `VALVE_K`, one constant for every valve, and says so '
      + 'in its own comment. Wiring this in is a modelling decision, not a spare field',
    unit: 'Cv / Kv',
    absent: 'nothing changes',
  },
  {
    id: 'element.characteristic',
    cls: 'DECLARED',
    meaning: 'the valve’s installed characteristic. The solver’s `R = K/f⁴` is '
      + 'equal-percentage-ish for every valve, so a record stating LINEAR is not '
      + 'contradicted by the model — it is simply not read by it',
    unit: null,
    absent: 'nothing changes',
  },
  {
    id: 'actuation.actuator',
    cls: 'DECLARED',
    meaning: 'actuator type. Nothing in the runtime varies with it; the stroke dynamics '
      + 'are one constant for every valve',
    unit: null,
    absent: 'nothing changes',
  },

  // ── What the model states because no record does ─────────────────────────
  {
    id: 'RAMP_S',
    cls: 'ASSUMPTION',
    meaning: 'how long a drive takes to cover full travel — 50 points of speed a second, '
      + 'and it governs any COMMANDED change while the machine is energised, up or down. '
      + 'Using the drive’s own rate for a commanded slow-down is itself a stated '
      + 'assumption: no record carries a deceleration time',
    unit: 's for full travel',
    absent: null,
  },
  {
    id: 'COAST_S',
    cls: 'ASSUMPTION',
    meaning: 'a de-energised shaft freewheeling down — 33 points a second, deliberately '
      + 'asymmetric with RAMP_S because it is a different physical event',
    unit: 's for full travel',
    absent: null,
  },
  {
    id: 'STROKE_RATE',
    cls: 'ASSUMPTION',
    meaning: 'how fast a valve moves, symmetric opening and closing. The valve datasheet '
      + 'carries actuator type, fail position, signal, positioner and air supply — and no '
      + 'stroke time at all',
    unit: '%/s',
    absent: null,
  },
  {
    id: 'VALVE_K',
    cls: 'ASSUMPTION',
    meaning: 'one resistance coefficient for every valve, sized so a default machine '
      + 'settles at its rated duty. `element.cv` would replace it if the relationship were '
      + 'ever modelled',
    unit: 'bar / (m³/h)²',
    absent: null,
  },
  {
    id: 'PIPE_K',
    cls: 'ASSUMPTION',
    meaning: 'line loss for one pipe run. Its own comment already records that diameter '
      + 'would enter if the engineering record ever held one',
    unit: 'bar / (m³/h)²',
    absent: null,
  },

  // ── What is not a value at all ───────────────────────────────────────────
  {
    id: 'speed 0-100 %',
    cls: 'DOMAIN',
    meaning: 'the pump curve is defined AT rated speed and nothing above it, so 100 % is '
      + 'the curve’s domain. THERE IS NO MAXIMUM-SPEED FIELD IN THIS PRODUCT and K27 '
      + 'searched the whole model for one — no rated-speed limit, no overspeed, no drive '
      + 'or motor maximum. Rated speed is not an engineering maximum unless a record says '
      + 'so, and none can',
    unit: '% of rated',
    absent: null,
  },
  {
    id: 'valve position 0-100 %',
    cls: 'DOMAIN',
    meaning: 'what a valve POSITION means — shut to fully open. Not a travel limit '
      + 'anybody declared, and there is no field for one',
    unit: '% open',
    absent: null,
  },
  {
    id: 'controller output 0-100 %',
    cls: 'DOMAIN',
    meaning: 'the normalised domain a controller output is defined on. A speed loop’s '
      + 'FLOOR is `duty.minSpeed`, which is engineering; the ceiling is this',
    unit: '%',
    absent: null,
  },
]

/** Every equipment field a record can state that nothing in the runtime reads. */
export const DECLARED_ONLY: readonly string[] =
  EQUIPMENT_CAPABILITY.filter((f) => f.cls === 'DECLARED').map((f) => f.id)

/**
 * NO MAXIMUM SPEED EXISTS, AND K27 DID NOT ADD ONE.
 *
 * The audit searched every catalogue and every parser for a concept that could
 * mean "the fastest this machine may be run" — a maximum, an overspeed, a
 * motor or drive limit, a rated-speed ceiling. There is none.
 *
 * `duty.speed` is the near miss and is not it: a RATED SPEED is the speed a
 * machine is designed to run AT, not a limit it may not pass, and a drive
 * commanded above rated is a real thing a real plant does. Treating one as the
 * other would be the same category error as treating `duty.minFlow` as a
 * minimum speed.
 *
 * So the 100 % ceiling stays what it is: the domain the pump curve is defined
 * on. A machine that genuinely cannot reach rated still has no way to say so,
 * and that is recorded as a gap rather than filled with a number.
 */
export const NO_ENGINEERING_MAX_SPEED = true
