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
    meaning: 'rated head at that duty; the curve’s shutoff is derived from it. THE UNIT IS '
      + 'PART OF THE DATA — K31. Stated as a LENGTH ("35 m", "mlc", "mwc", or a bare '
      + 'number) it is a head, energy per unit weight, the same length in every liquid, and '
      + 'it becomes ΔP = ρ·g·H against the density of the service on that pump’s stream. '
      + 'Stated as a PRESSURE ("3.5 bar", "350 kPa", "50 psi") it is a differential the '
      + 'engineer has already converted, and nothing scales it again',
    unit: 'metres of liquid, or bar',
    absent: 'DEFAULTS.pumpHeadBar stands in — declared in BAR, so a machine nobody specified '
      + 'is not density-scaled either — and the QA report discloses it',
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
    id: 'tankFullHeadBar',
    cls: 'ASSUMPTION',
    meaning: 'the static head a full vessel puts on its outlet, 0.3 bar, proportional to '
      + 'level. K34 DECIDED FORMALLY THAT THIS QUANTITY IS A CALIBRATED PRESSURE, not a '
      + 'physical hydrostatic head. It is stored in bar, scaled by level and by nothing '
      + 'else, derived from no height, and stated by no engineer on any record — there is '
      + 'no vessel height or elevation field in the catalogue, and a capacity in m³ cannot '
      + 'yield one without a diameter, an orientation and a head type that are equally '
      + 'absent. It is therefore FLUID-INDEPENDENT and no density is applied to it. The '
      + 'earlier “≈ 3 m of liquid” wording was scale intuition and has been corrected '
      + 'where it read as a geometry calculation: taken as physics it would imply ρ = '
      + '0.3e5/(3·g) = 1019.7 kg/m³, which nobody ever stated. The contrast with a pump’s '
      + '`duty.head` is the whole rule — an engineer states those metres, so K31 converts '
      + 'them against the real service; nobody states these, so converting them would be '
      + 'inventing an elevation',
    unit: 'bar at 100 % level',
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
    id: 'HEAD metres → bar',
    cls: 'ASSUMPTION',
    meaning: 'THE DENSITY USED WHEN NO SERVICE RESOLVES — all that is left of K30’s water '
      + 'basis after K31. A head in metres now converts as ΔP = ρ·g·H against the '
      + '`Fluid.densityKgM3` of the service on the pump’s own stream, which is engineering '
      + 'data and is recorded on `duty.head`. But most drawings name no service, and those '
      + 'still convert at 1 bar = 10.197 m. That factor IS a density — ρ = 1e5/(10.197·g) = '
      + '1000.016 kg/m³, pure water at 4 °C — and `LEGACY_HEAD_DENSITY_KGM3` now writes it '
      + 'as one. It remains an ASSUMPTION because nobody stated it; what changed is that it '
      + 'is NAMED, reported as `unresolved` with a reason, and no longer applied to streams '
      + 'whose density is actually known',
    unit: 'kg/m³, assumed',
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

/**
 * WHY `element.cv` STAYS DECLARED — K28, and the three definitions that are
 * missing before it could be anything else.
 *
 * ── WHAT THE SOLVER DOES TODAY ────────────────────────────────────────────
 *
 *     ΔP = R · Q²        R in bar / (m³/h)²
 *     valve             R = VALVE_K / f⁴     f = ACTUAL opening, 0..1
 *     pipe              R = PIPE_K
 *     fitting           R = PIPE_K / 10
 *     pump              R = 0, the curve carries it
 *
 * `VALVE_K` is one constant for every valve in the plant. MEASURED: a branch
 * whose two legs state Cv 40 and Cv 200 splits the flow exactly 50/50, to nine
 * decimal places. A record can describe two very different valves and the
 * model will not distinguish them.
 *
 * ── WHAT A Cv WOULD REPLACE IT WITH ───────────────────────────────────────
 *
 * The coefficient form is `ΔP = SG · (Q / Kv)²`, so `R = SG / Kv²`. Setting
 * that against the model's own `R` is the whole conversion, and it needs three
 * things this product does not have:
 *
 *   1. WHICH COEFFICIENT THE NUMBER IS. The field is labelled `Cv / Kv` and
 *      stores a free-form string. Cv is US gpm per √psi and Kv is m³/h per
 *      √bar; they differ by about 1.156, and nothing recorded says which one a
 *      given number is. A field that cannot distinguish two definitions cannot
 *      supply either.
 *   2. THE REFERENCE CONDITION. A coefficient is quoted against a stated fluid
 *      at a stated temperature — conventionally water, but conventionally is
 *      not the same as recorded. Nothing states it.
 *   3. THE SPECIFIC GRAVITY OF WHAT IS FLOWING. `SG` is in the equation, and
 *      `sim/hydraulic/solver.ts` still solves one incompressible fluid at one
 *      density through every RESISTANCE. K31 supplied a density to the pump
 *      head and to nothing else, so this prerequisite is met for the source
 *      term and unmet for the Cv equation it is listed under: a valve
 *      coefficient needs the density of what is passing THAT valve, which is
 *      available, but items 1 and 2 above still are not. `hasProperties`
 *      reports that most services state no density at all, which is why the
 *      coupling K31 did make has a declared unresolved path.
 *
 * ── AND THE CHARACTERISTIC IS NOT A CHARACTERISTIC ────────────────────────
 *
 * `element.characteristic` is a free-form string with no enumeration, no
 * parser and no validation. There is no set of supported characteristics to
 * choose from — the product stores whatever is typed. Meanwhile `R = K/f⁴`
 * makes every valve equal-percentage-ish, so a record saying LINEAR is not
 * contradicted by the model; it is simply not read by it.
 *
 * ── THE CONCLUSION ────────────────────────────────────────────────────────
 *
 * Three independent blockers, any one of which is sufficient: the unit is
 * ambiguous, the reference condition is absent, and the density the equation
 * needs is deliberately outside the solver. So Cv cannot enter the runtime
 * truthfully, and K28 did not make it. Assuming water at 15 °C to close the
 * gap would produce numbers that look right and are not attributable to
 * anything anybody recorded — which is the failure mode this programme exists
 * to avoid.
 *
 * WHAT WOULD UNBLOCK IT, precisely: a coefficient field that states its own
 * kind and unit, a stated reference condition, and a decision about whether
 * the hydraulic solve carries fluid density. The first two are datasheet
 * schema decisions; the third is a physics decision that reaches far beyond
 * valves.
 */
export const CV_CANNOT_ENTER_THE_SOLVE = true

/**
 * THE HYDRAULIC BASIS THIS PRODUCT SOLVES ON — K29, recorded before anything
 * is proposed against it.
 *
 *     pressure    bar absolute
 *     flow        m³/h, SIGNED along the element's own direction
 *     resistance  bar / (m³/h)²
 *
 *     ΔP = R · Q²
 *       valve    R = VALVE_K / f⁴,  f = ACTUAL opening clamped to
 *                [SHUT_FRACTION, 1]
 *       pipe     R = PIPE_K
 *       fitting  R = PIPE_K / 10
 *       pump     R = 0; the curve supplies head, falling with shaft speed
 *
 * ONE INCOMPRESSIBLE FLUID AT ONE DENSITY, and that density appears NOWHERE in
 * the equations above — there is no `ρ`, no `SG` and no viscosity term. The
 * resistances are calibrations in which any fluid effect is already baked, not
 * coefficients a fluid property could be applied to. That is the single most
 * important fact about introducing engineering coefficients: they would not be
 * added to this model, they would REPLACE part of it.
 */
export const HYDRAULIC_BASIS_IS_DENSITY_FREE = true

/**
 * WHAT EACH HYDRAULIC MODEL WOULD REQUIRE — K29's actual output.
 *
 * Three options, and what is missing from each. None is implemented, and §20
 * of the K29 brief forbids implementing any of them here.
 *
 * ── A. THE NORMALISED RESISTANCE MODEL (what exists) ──────────────────────
 *
 * Requires nothing further. Every element's resistance is a stated constant
 * and the position dependence is `1/f⁴`. It is honest, it is calibrated, and
 * it cannot distinguish two valves or two pipes.
 *
 * ── B. AN ENGINEERING Cv/Kv VALVE MODEL ───────────────────────────────────
 *
 * `ΔP = SG · (Q / Kv)²`, so `R = SG / Kv²`. FOUR prerequisites, none met:
 *
 *   1. WHICH COEFFICIENT. `element.cv` is labelled `Cv / Kv` and stores free
 *      text. Cv is US gpm/√psi, Kv is m³/h/√bar, and they differ by ~1.156.
 *      A field that cannot say which it holds can supply neither. NEEDS: a
 *      recorded coefficient KIND, not a guess from magnitude or locale.
 *   2. THE COEFFICIENT'S OWN REFERENCE CONDITION. A valve coefficient is
 *      quoted against a standard fluid at a standard condition. `Fluid`
 *      already carries `referenceCondition` — but that is the condition the
 *      FLUID's properties are quoted at, which is a different statement about
 *      a different object. NEEDS: a reference for the COEFFICIENT, and it is
 *      not the fluid's.
 *   3. SPECIFIC GRAVITY, IN THE SOLVE. `SG` is in the equation. `Fluid`
 *      carries `densityKgM3`, so the DATA can exist — but the solver does not
 *      read it, `sim/fluids.ts` states that wiring density in is a physics
 *      change to be validated as one, and `hasProperties` reports most
 *      services state no properties at all. NEEDS: a decision that the
 *      hydraulic solve carries fluid, which reaches far beyond valves.
 *   4. A COMPARABLE REFERENCE CONDITION. `Fluid.referenceCondition` is a
 *      free-form string, seeded `'20 °C, 1 atm'` and parsed nowhere. The
 *      type's own comment says a property with no basis is not data; that
 *      rule is stated and not enforced. NEEDS: a parsed condition, if any
 *      correction is ever to be applied against it.
 *
 * ── C. A GEOMETRY-BASED PIPE MODEL ────────────────────────────────────────
 *
 * Darcy-Weisbach needs length, inside diameter and roughness. NONE is
 * obtainable:
 *
 *   LENGTH        does not exist, in any record or on any drawn object. An
 *                 HMI pipe has screen coordinates; using pixel distance as
 *                 plant length would be exactly the defect `processData.ts`
 *                 was created to fix, where a tank's capacity came from its
 *                 widget's pixel area.
 *   DIAMETER      `spec.size` is a NOMINAL size. Nominal is not inside
 *                 diameter: 6" Sch 40 is 154.05 mm and 6" Sch 80 is 146.33 mm.
 *                 Converting needs the schedule AND a dimensional standard
 *                 table, and `spec.schedule` is free text.
 *   ROUGHNESS     no field. `spec.material` is free text and would need a
 *                 material-to-roughness table.
 *
 * So `PIPE_K` is not a placeholder waiting for two numbers. It stands in for
 * a calculation whose every input is absent.
 */
export const HYDRAULIC_MODEL_PREREQUISITES = true

/**
 * WHY NO SCHEMA FIELD WAS ADDED — K29 against its own §16 checklist.
 *
 * §16 permits a field only when ALL EIGHT of these are known. For a
 * hypothetical coefficient pair:
 *
 *     field owner            KNOWN    the valve's engineering record
 *     meaning                KNOWN    a flow coefficient
 *     unit                   KNOWN    once the KIND is decided
 *     valid domain           KNOWN    finite and positive
 *     absent semantics       KNOWN    no coefficient; the model's own R stands
 *     serialization          KNOWN    a free-form keyed map; nothing to migrate
 *     reference condition    UNKNOWN  see B.2 — not the fluid's, and undecided
 *     runtime relationship   UNKNOWN  see B.3 — needs fluid in the solve, which
 *                                     is a physics decision K29 may not make
 *
 * Two unknown is two too many, and the second is the one that matters: a field
 * added now could not become causal without a physics phase, so it would ship
 * as DECLARED and sit there looking like data that does something.
 *
 * THE SAME TEST APPLIES TO THE CHARACTERISTIC and fails earlier still. There
 * is no vocabulary: `element.characteristic` is free text with no enumeration,
 * no parser and no validation anywhere in the product, and a search for the
 * conventional terms finds them only in prose and in a cost estimator's
 * description string. Before a characteristic could mean anything the product
 * needs a set of characteristics it supports, a representation for each —
 * enum, curve, breakpoint table — and a defined map from position to effective
 * coefficient. None of the three exists.
 */
export const NO_SCHEMA_WITHOUT_A_RUNTIME_RELATIONSHIP = true

/**
 * WHERE THE HYDRAULIC MODEL IS FLUID-COUPLED, AND WHERE IT IS NOT — K31.
 *
 * ── K30 DECIDED, K31 REVERSED THE HALF THAT HAD DATA ──────────────────────
 *
 * K30 declared the hydraulics wholly fluid-independent and recorded the water
 * basis hiding in `duty.head` as an assumption, reasoning that correcting only
 * that would make the model PARTLY fluid-aware. K31 made exactly that partial
 * correction on purpose, and the reasoning changed with it: a half-applied
 * correction is dangerous when it is UNDISCLOSED, because the numbers still
 * look right. Disclosed, split along a line that follows the available
 * engineering data, and asserted by tests, it is simply an honest model.
 *
 * ── THE SOURCE TERM IS COUPLED ────────────────────────────────────────────
 *
 * A pump head stated in metres is a LENGTH — energy per unit weight, the same
 * length for every liquid — and becomes ΔP = ρ·g·H. The density comes from the
 * service the drawing paints on the pump's own stream. This is real physics
 * from real datasheet data: `duty.head` is a manufacturer's figure and
 * `Fluid.densityKgM3` is a stated property, neither inferred nor defaulted.
 *
 * ── THE RESISTANCES ARE NOT ───────────────────────────────────────────────
 *
 * `VALVE_K`, `PIPE_K` and `FITTING_K` remain CALIBRATED SIMULATOR
 * COEFFICIENTS in bar/(m³/h)², with any fluid effect already baked in. They
 * are not engineering pipe or valve coefficients and must never be described
 * as ones. A genuine friction term needs length, bore and roughness, and K29
 * established that this repository stores none of the three; multiplying a
 * fitted constant by a density without them is not a correction.
 *
 * ── SO THE CLAIM IS UNCHANGED ─────────────────────────────────────────────
 *
 * TRAINING AND DEMONSTRATION PROCESS SIMULATION: a plant that responds
 * causally and in the right direction, with the right shapes. K31 makes one
 * direction newly correct — a denser liquid genuinely makes more pressure —
 * without upgrading the product to an engineering hydraulic calculation. Seven
 * of K29's eight prerequisites are still missing and the list is unshortened.
 *
 * ── AND THE FALLBACK IS NAMED ─────────────────────────────────────────────
 *
 * Most drawings state no service. Those still convert at 1 bar = 10.197 m, but
 * that factor is now written as the density it always was — 1000.016 kg/m³,
 * `LEGACY_HEAD_DENSITY_KGM3` — and a stream that resolves to nothing says
 * `unresolved` rather than quietly claiming to be water.
 */
export const HYDRAULIC_HEAD_IS_FLUID_COUPLED = true
export const HYDRAULIC_RESISTANCE_IS_FLUID_INDEPENDENT = true

/**
 * THE REST OF THE BOUNDARY, decided with it — K30.
 *
 * PRESSURE BASIS. The solve works in BAR ABSOLUTE throughout. An engineering
 * record is read as GAUGE unless its unit says otherwise: `operatingPressure`
 * adds one atmosphere except for `bara`, `atm`, `kpa`, `mpa` and `pa`. K6/K7's
 * convention is unchanged and no second convention was introduced.
 *
 * MULTI-FLUID. `sim/fluids.ts` resolves a service PER EDGE and reports MIXED
 * where two meet, so the model already knows which stream is which. The
 * hydraulics do not distinguish their physics at all — every stream gets the
 * same calibrated resistances — and that limitation is stated rather than
 * papered over.
 *
 * MIXING. Not implemented and not designed. Were it ever wanted it would need
 * mass fractions, component properties, a mixture density and a mixture
 * viscosity rule, and an energy balance to go with them. None exists.
 *
 * THE PUMP CURVE is a HYBRID and is classified as such: two ENGINEERING inputs
 * — `duty.head` at the rated flow and `duty.capacity` — feeding a SHAPE the
 * model assumes. The quadratic fall from shutoff to runout, `RUNOUT_FACTOR`
 * = 1.5, and the affinity scaling are the model's, not a manufacturer's. It is
 * "the shape of a centrifugal curve, which is all the model claims", and it is
 * not vendor performance data.
 *
 * VALIDITY. One incompressible liquid, single phase, quasi-steady, re-solved
 * each tick. No vapour, no phase change, no compressibility, no elevation
 * except a vessel's own liquid head, no transient acoustics, no Reynolds
 * dependence and so no laminar/turbulent distinction. Gas and two-phase are
 * outside the model entirely. The solver says so in its own header and reports
 * when it cannot answer rather than returning a plausible number.
 */
export const HYDRAULIC_BOUNDARY_IS_DECLARED = true

/**
 * K32 — THE FLUID-COUPLING CONSISTENCY AUDIT, AND WHAT IT FOUND.
 *
 * K31 drew a boundary through the middle of the hydraulics: density couples the
 * pump head where a record states a LENGTH, and nothing else. A boundary is
 * only honest if it sits in the same place everywhere, so K32 searched for
 * every water-shaped constant and every density consumer in the product and
 * checked. It changed no equation.
 *
 * ── CONSISTENT ────────────────────────────────────────────────────────────
 *
 * RESISTANCE. Exactly two things modify `ProcessEdge.resistance` at solve time:
 * `valveResistance(openFraction)`, a function of POSITION, and `pipeFactor`,
 * the plugged-line scenario — a geometric restriction. Neither takes a density,
 * a fluid, a viscosity or a temperature, and nothing else writes R at all.
 *
 * DENSITY CONSUMERS. Two, and only one reads the value: `hydraulic/fluidhead.ts`
 * turns it into a pump head, and `sim/fluids.ts`'s `hasProperties` only asks
 * whether it is present. Viscosity and heat capacity are consumed nowhere.
 *
 * THE PUMP CURVE is in PRESSURE end to end. `duty.head` is the head AT the
 * rated flow, runout sits at 1.5× it, and the metres→bar conversion happens
 * ONCE, upstream of the curve — so the coupling cannot be applied twice, and
 * density commutes exactly with the speed² affinity law.
 *
 * THE SUCTION CHECK is not an NPSH calculation, says so in capitals, and reads
 * no density, no vapour pressure and no temperature. K31 did not change it and
 * could not have: it never consults the pump's head.
 *
 * PRESSURE BASIS. Bar absolute in the solve; gauge→absolute happens once, in
 * `operatingPressure`, on the engineering side. K6/K7 unchanged.
 *
 * ── TWO FINDINGS, RECORDED AND NOT FIXED ──────────────────────────────────
 *
 * 1. DECIDED BY K34 — see `VESSEL_HEAD_IS_CALIBRATED_PRESSURE` at the end of
 *    this file. The vessel static head is a CALIBRATED PRESSURE and stays one.
 *    K32 found that its “≈ 3 m” wording implied an unstated 1019.7 kg/m³, so
 *    that this product held three unequal water densities — 1019.7 in the
 *    vessel head, 1000.016 in the legacy pump-head basis, 1000 in
 *    `LIQUID_CP_KJ_PER_M3_K`. The wording was the defect, not the number: K34
 *    corrected the wording and applied no density to anything.
 *
 * 2. CLOSED BY K33. The suction check sourced a vessel at ATMOSPHERE plus its
 *    static head while the runtime solver sourced the same vessel at its
 *    STATED OPERATING PRESSURE plus the same head — and a boundary at the
 *    terminal's own `pressureBar` while the check used atmosphere there too.
 *    A closed vessel or a pressurised battery limit was checked as if open to
 *    the sky, understating `sourcePressure` and `maxFlow` and able to report
 *    `insufficient` on a suction that was amply supplied.
 *
 *    K33 changed ONE expression — the base the static head is added to — so
 *    the check now asks the node what it is held at, exactly as the solver
 *    does. The static head itself, the resistances, the law and the three-state
 *    vocabulary are untouched, and FINDING 1 above is unaffected: what moved
 *    was the base, never the head. `tests/model/suctionSourcePressure.test.ts`
 *    proves the two paths agree by running the real solver over the real model
 *    rather than re-deriving the formula.
 *
 *    ONE DIFFERENCE REMAINS AND IS INTENDED: the solver also consults a
 *    SCENARIO holding a tagged terminal for a run in progress. The static check
 *    does not, because there is no run — that is a difference in the question,
 *    not in the answer.
 *
 * Both are pinned by `tests/model/fluidConsistency.test.ts`, which asserts the
 * CURRENT behaviour so that changing either has to come past a test that says
 * what is being changed and why.
 */
export const FLUID_COUPLING_AUDITED = true

/**
 * K34 — THE VESSEL STATIC HEAD IS A CALIBRATED PRESSURE. DECIDED.
 *
 * ── THE QUESTION ──────────────────────────────────────────────────────────
 *
 * K31 made a pump head stated in METRES density-dependent. K32 then found that
 * `DEFAULTS.tankFullHeadBar = 0.3` was documented as "≈ 3 m of liquid", which
 * read as the same kind of quantity and would imply ρ = 1019.7 kg/m³. Are the
 * two the same thing, treated differently?
 *
 * ── THE ANSWER: NO, AND IT IS DECIDABLE FROM THE DATA MODEL ───────────────
 *
 * They are different KINDS of quantity, and the product contract already says
 * which is which. The test has been the same since K26 and it is not about
 * which reading sounds more physical:
 *
 *      A RECORD STATES IT  →  engineering data, and physics may act on it.
 *      NOBODY STATES IT    →  a simulator assumption, and nothing may.
 *
 * `duty.head` is stated by an engineer, in metres, on a pump datasheet. That is
 * why K31 converts it against the real service: there is a real quantity, in a
 * real unit, put there by somebody who meant it.
 *
 * `tankFullHeadBar` is stated by nobody. It is a constant in `sim/units.ts`,
 * typed as bar, scaled by level percent and by nothing else. There is NO vessel
 * height and NO elevation field anywhere in the 81-field catalogue, and
 * `construction.volume` cannot produce one without a diameter, an orientation
 * and a head type that are equally absent. There is no length here to convert.
 *
 * ── WHAT IS THEREFORE RECORDED ────────────────────────────────────────────
 *
 *   - the quantity IS a pressure, in bar, and is stored and used as one;
 *   - the "3 m" wording is scale intuition and must not be read as a geometry
 *     calculation — corrected in `sim/units.ts` and `sim/process.ts`;
 *   - it remains FLUID-INDEPENDENT;
 *   - 0.3 bar is an explicit simulator calibration, classified ASSUMPTION;
 *   - NO density correction is applied to it, now or by implication.
 *
 * ── WHAT PHYSICAL HYDROSTATIC MODELLING WOULD NEED ────────────────────────
 *
 * Recorded because it was asked for, NOT because it was chosen. Were a vessel
 * head ever to become ρgh, all of the following would have to exist first, and
 * none does:
 *
 *   vessel geometry        a liquid height, or a diameter plus orientation plus
 *                          head type that can produce one from a level
 *   reference elevation    a datum, and each nozzle's height above it — the
 *                          model today has no elevation of any kind
 *   pressure basis         which nozzle sees which head, already answered by
 *                          the K3.3 role and the only piece that exists
 *   fluid density source   `Fluid.densityKgM3` on the vessel's own service,
 *                          which the drawing assigns to LINES, not to vessels
 *   partial fill           the level→height map for a dished or horizontal
 *                          vessel, which is not linear in level percent
 *   multiple levels        an interface elevation and a density per phase
 *   static or dynamic      whether the head responds within a tick or is a
 *                          quasi-steady boundary as it is today
 *
 * Seven dependencies, of which one exists. K34 implemented none of them.
 */
export const VESSEL_HEAD_IS_CALIBRATED_PRESSURE = true
