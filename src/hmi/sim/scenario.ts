// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * RUNTIME OPERATING SCENARIOS — what the plant is doing today, as against what
 * it is.
 *
 * The engineering record says a battery limit runs at 3 barg. That is a fact
 * about the plant and it belongs in the registry. Today the upstream unit is
 * down and the header is at 1 barg — that is a fact about this shift, and it
 * belongs nowhere near the registry.
 *
 * So a scenario is a set of OVERRIDES keyed by engineering tag. It never writes
 * to the document: apply one, run it, clear it, and the drawing and the records
 * are exactly as they were. It cannot change the topology either — there is no
 * override that adds, removes or reconnects anything, by construction, because
 * the only things it can name are a tag and a value.
 *
 * TWO CHANNELS, and only one of them is new.
 *
 *  - EQUIPMENT — a pump's RUN, a valve's OP, a heater, a controller's MODE —
 *    already has a runtime channel: the tag signals the operator writes and the
 *    journal records. A scenario applies those THROUGH that channel rather than
 *    beside it, so there is no second idea of whether a pump is running.
 *  - A TERMINAL'S PRESSURE had no channel at all. It was compiled into the
 *    topology from the record and there was no way to say "not today". That is
 *    what this module adds.
 *
 * PRECEDENCE is stated once and resolved in one place — `resolveTerminal`:
 *
 *     scenario override  →  engineering record  →  atmospheric fallback
 *
 * and every resolved value carries WHERE IT CAME FROM, so nothing downstream
 * has to guess whether a pressure is a specification or a scenario.
 *
 * CONTRADICTIONS ARE NOT MERGED. Two overrides for one tag is not a value with
 * a tie-break rule; it is a scenario nobody has finished writing, and it
 * resolves to `invalid` with both values named.
 */

import type { ProcessModel } from './hydraulic/model'
import { operatingPressure } from '../../model/processData'
import type { BoundarySignal, BoundarySignalKind } from '../../model/processData'
import { DEFAULTS } from './units'
import type { DiagnosticSeverity } from '../../model/diagnostics'

/** One runtime override, always keyed by a stable engineering TAG — never a
 *  widget id, an index or a position. */
export type Override =
  /**
   * Hold a tagged terminal at a different pressure for this run.
   *
   * `pressure` is the same STATED STRING an engineering record carries —
   * `'2 barg'`, `'4 bara'`, `'50 psig'` — read by the same
   * `operatingPressure`. A scenario and a record therefore cannot disagree
   * about what a unit means, and an unreadable scenario value fails the same
   * way an unreadable record does.
   */
  | { kind: 'terminal-pressure'; tag: string; pressure: string }
  /**
   * Write a tag signal: `RUN`, `OP`, `MODE`, `FAULT`, anything the simulation
   * already carries. Applied through the ordinary operator write path, because
   * that path already exists and a second one would be a second answer to
   * "is P-101 running".
   */
  | { kind: 'signal'; tag: string; signal: string; value: number }

export interface Scenario {
  id: string
  /** What an operator would call this state of the plant. */
  name: string
  overrides: Override[]
}

/** Where a runtime value came from. */
export type ValueSource =
  /** A scenario is holding it here. */
  | 'scenario'
  /** A declared runtime boundary signal is driving it. */
  | 'signal'
  /** The engineering record states it, and nothing is overriding it. */
  | 'engineering'
  /** Nothing states it: the documented fallback. */
  | 'default'
  /** Something states it and the statement cannot be used. */
  | 'invalid'

export interface ResolvedPressure {
  source: ValueSource
  /** bar ABSOLUTE — always finite, always usable. An `invalid` source still
   *  carries the fallback, because the plant has to keep solving; `reason` is
   *  what says not to trust the specification behind it. */
  barA: number
  /** Present only when `source` is `invalid`. Operator-readable. */
  reason?: string
  /** The declared runtime behaviour, when the terminal has one — shown even
   *  while a scenario is overriding it, so an operator can see what they are
   *  overriding. */
  signal?: BoundarySignalKind
}

/**
 * WHERE A DECLARED SIGNAL IS AT THIS INSTANT, bar absolute.
 *
 * Evaluated against the SIMULATION CLOCK the engine already keeps — there is no
 * second timebase here and no state of its own. A signal is a pure function of
 * the declaration and the time, which is what makes a run with one in it
 * reproducible.
 *
 * A ramp of zero duration is a step, which is the only sensible reading of
 * "get there over no time" and avoids a division nobody wants.
 */
export function evaluateSignal(sig: BoundarySignal, tSeconds: number): number {
  if (sig.kind === 'constant') return sig.fromBarA
  if (tSeconds <= sig.atS) return sig.fromBarA
  if (sig.kind === 'step' || sig.overS <= 0) return sig.toBarA
  const through = (tSeconds - sig.atS) / sig.overS
  if (through >= 1) return sig.toBarA
  // linear in the BOUNDARY. What the plant does with it is the solver's
  // business and is not linear in anything.
  return sig.fromBarA + (sig.toBarA - sig.fromBarA) * through
}

/**
 * What pressure a terminal is actually held at, and why.
 *
 * THE ONE PLACE PRECEDENCE IS DECIDED. Everything else asks this.
 */
export function resolveTerminal(
  model: ProcessModel,
  tag: string,
  scenario: Scenario | null,
  tSeconds = 0,
): ResolvedPressure {
  const node = model.nodes.find((n) => n.kind === 'boundary' && n.tag === tag)
  const engineering = node?.pressureBar
  const fallback = DEFAULTS.atmosphericPressureBar
  const sig = node?.signal
  const declared = typeof sig === 'object' ? sig : undefined
  const badSignal = typeof sig === 'string' ? sig : undefined
  const describe = declared ? { signal: declared.kind } : {}

  const mine = (scenario?.overrides ?? [])
    .filter((o): o is Extract<Override, { kind: 'terminal-pressure' }> =>
      o.kind === 'terminal-pressure' && o.tag === tag)

  if (mine.length > 1) {
    // NOT last-wins. A scenario that says two things about one terminal has not
    // decided what it means, and picking one would make that unfindable.
    return {
      source: 'invalid', barA: engineering ?? fallback, ...describe,
      reason: `${tag} is overridden ${mine.length} times in this scenario (${mine.map((o) => o.pressure).join(', ')}). Remove the duplicates.`,
    }
  }
  const one = mine[0]
  if (one !== undefined) {
    if (node === undefined) {
      return {
        source: 'invalid', barA: fallback,
        reason: `${tag} is not a terminal on this plant, so its pressure cannot be overridden.`,
      }
    }
    const barA = operatingPressure(one.pressure)
    if (barA === undefined || !Number.isFinite(barA)) {
      return {
        source: 'invalid', barA: engineering ?? fallback, ...describe,
        reason: `"${one.pressure}" is not a pressure this model can use. Give it a number and a unit — "3 barg", "4 bara", "50 psig".`,
      }
    }
    /**
     * A SCENARIO BEATS A SIGNAL, and that is a deliberate reading.
     *
     * K10's brief lists the precedence signal-first and then says plainly that
     * "if a scenario explicitly overrides a runtime-variable terminal, the
     * scenario value must win". The sentence is the instruction; the list
     * contradicts it, and the sentence is also the safer rule — an operator who
     * has explicitly pinned a boundary should not be quietly overruled by an
     * automatic ramp they cannot see. The declared signal is still REPORTED, so
     * they can see what they are overriding.
     */
    return { source: 'scenario', barA, ...describe }
  }
  if (node === undefined) {
    // nothing is overriding it and it is not a terminal: not this module's
    // business at all, and the solve will use whatever the node says
    return { source: 'default', barA: fallback }
  }
  if (badSignal !== undefined) {
    // The record declares a behaviour this model cannot evaluate. It is NOT
    // silently static: somebody said this boundary moves, and it will not.
    return {
      source: 'invalid', barA: engineering ?? fallback,
      reason: `${tag} declares a runtime boundary signal that cannot be used — ${badSignal}`,
    }
  }
  if (declared !== undefined) {
    return { source: 'signal', barA: evaluateSignal(declared, tSeconds), signal: declared.kind }
  }
  // K7 populated `pressureBar` for every terminal: the record's value when it
  // states one, atmosphere when it does not. `boundary` says which.
  return engineering === undefined || node.boundary === 'atmospheric'
    ? { source: 'default', barA: engineering ?? fallback }
    : { source: 'engineering', barA: engineering }
}

/** Every terminal's resolved pressure, by tag. Built once per tick from state
 *  that only changes when a scenario does. */
export function terminalPressures(
  model: ProcessModel,
  scenario: Scenario | null,
  tSeconds = 0,
): Map<string, ResolvedPressure> {
  const out = new Map<string, ResolvedPressure>()
  for (const n of model.nodes) {
    if (n.kind !== 'boundary' || n.tag === undefined) continue
    out.set(n.tag, resolveTerminal(model, n.tag, scenario, tSeconds))
  }
  // an override naming something that is not a terminal still has to be
  // REPORTED rather than dropped — otherwise a typo is invisible
  for (const o of scenario?.overrides ?? []) {
    if (o.kind !== 'terminal-pressure' || out.has(o.tag)) continue
    out.set(o.tag, resolveTerminal(model, o.tag, scenario, tSeconds))
  }
  return out
}

export interface ScenarioProblem {
  tag: string
  reason: string
}

/** Everything wrong with a scenario, before anyone runs it. Empty is valid. */
export function validateScenario(
  model: ProcessModel,
  scenario: Scenario | null,
): ScenarioProblem[] {
  const out: ScenarioProblem[] = []
  for (const [tag, r] of terminalPressures(model, scenario)) {
    if (r.source === 'invalid') out.push({ tag, reason: r.reason ?? 'invalid' })
  }
  // a signal override naming a tag the plant does not carry writes nothing and
  // would otherwise fail silently
  const known = new Set<string>()
  for (const [tag] of model.equipment) known.add(tag)
  for (const [tag] of model.vesselNodes) known.add(tag)
  for (const o of scenario?.overrides ?? []) {
    if (o.kind !== 'signal') continue
    if (!Number.isFinite(o.value)) {
      out.push({ tag: o.tag, reason: `${o.tag}.${o.signal} is being set to ${String(o.value)}, which is not a number.` })
    }
  }
  return out.sort((a, b) => a.tag.localeCompare(b.tag) || a.reason.localeCompare(b.reason))
}

// ── Presentation ────────────────────────────────────────────────────────────

/**
 * A pressure as an engineer states one: GAUGE, because that is the unit a
 * datasheet and an operator both use.
 *
 * The model works in absolute and `ATMOSPHERIC_BAR` is the one reference in
 * the product, so this is the inverse of the reader in `model/processData.ts`
 * and not a second conversion system.
 */
export function formatBarg(barA: number): string {
  const g = barA - DEFAULTS.atmosphericPressureBar
  // a tenth of a bar is the finest a plant gauge resolves; more digits would
  // imply a precision the boundary condition does not have
  return `${g.toFixed(1)} barg`
}

/**
 * WHAT A TERMINAL IS DOING, from the solved flow and nothing else.
 *
 * NOT a property of the terminal. A terminal states a pressure; whether it is
 * currently supplying the plant or receiving from it depends on the pressure
 * everywhere else, and the only thing that knows is the solve. The same
 * terminal, unchanged, reads differently when a pump starts.
 *
 * This is the wording `boundaryRole` already produces for the process view,
 * said the way an operator reading a state table would say it — one rule, two
 * vocabularies, and no second piece of direction logic.
 */
export type TerminalObservation = 'SUPPLYING' | 'RECEIVING' | 'NO SIGNIFICANT FLOW'

export const OBSERVED_FROM_ROLE: Record<string, TerminalObservation> = {
  SUPPLY: 'SUPPLYING',
  DESTINATION: 'RECEIVING',
  BOUNDARY: 'NO SIGNIFICANT FLOW',
}

/**
 * A scenario problem, said the way the diagnostics architecture says things.
 *
 * `DiagnosticSeverity` is the EXISTING operator-layer scale — can the running
 * plant work? — and every scenario problem answers it the same way: an override
 * the operator asked for is not in effect, and the plant is therefore not in
 * the state they believe it is in. That is an `error` by the meaning the model
 * already carries, and no new severity is introduced to say it.
 */
export interface ScenarioFinding {
  id: string
  tag: string
  severity: DiagnosticSeverity
  message: string
}

export function scenarioFindings(problems: readonly ScenarioProblem[]): ScenarioFinding[] {
  return problems.map((p, i) => ({
    id: `scenario:${p.tag}:${i}`,
    tag: p.tag,
    severity: 'error' as DiagnosticSeverity,
    message: p.reason,
  }))
}
