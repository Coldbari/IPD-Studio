// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The quality of a live process value.
 *
 * Every value on an operator screen was produced by something, and an operator
 * has to be able to tell WHAT. Before this module a frozen transmitter, a
 * measurement with no process model behind it at all, and a genuine live
 * reading all rendered as the same confident number.
 *
 * There is deliberately no `SIMULATED` member. Everything this product
 * produces is simulated — that is stated once, in the header, not repeated
 * against every value where it would carry no information and crowd out the
 * qualities that do.
 */
export type Quality = 'good' | 'forced' | 'stale' | 'uncertain' | 'bad'

/**
 * A reason the HYDRAULIC SOLVE cannot stand behind the number it produced.
 *
 * These come out of `SolveResult`, and they are the whole point of the solver
 * returning flags instead of just numbers. A pressure field that did not
 * converge, a node the network cannot determine the level of, and a suction
 * the model has driven below absolute zero all still have a float attached to
 * them. Rendering that float as a live reading is exactly the failure this
 * programme exists to remove, so each one is carried through to the badge:
 *
 *  - `unconverged`  Newton did not reach `MASS_TOL`. Mass is not balanced, so
 *                   no value downstream of the solve is a reading. BAD.
 *  - `cavitating`   the node went below absolute zero, which this model cannot
 *                   represent — real liquid cavitates there and the equations
 *                   no longer describe it. UNCERTAIN, and the number is the
 *                   answer to a question the plant would not ask.
 *  - `undetermined` the node has no path to any boundary or vessel, so the
 *                   network fixes its pressure DIFFERENCES and not its level.
 *                   Held at supply pressure so the solve stays regular, and
 *                   reported here so nobody reads that hold as a measurement.
 */
export type ProcessFault = 'unconverged' | 'cavitating' | 'undetermined'

/** The signals that override a measurement. All are scenario/operator flags,
 *  absent (0) on a plant that nobody has interfered with. */
export const QUALITY_SIGNALS = ['FROZEN', 'FORCED', 'BAD'] as const

export interface QualityState {
  q: Quality
  /** Operator-language reason, shown beside the badge. */
  why: string
}

const GOOD: QualityState = { q: 'good', why: 'Live simulated value' }

/**
 * What a measurement's PV is worth this instant.
 *
 * Ordered, first match wins, worst first — a value that is both forced and
 * stale is reported as the more alarming of the two, never averaged into
 * something reassuring.
 *
 * `uncertain` for an unbound display is the honest one and the least
 * comfortable: those PVs are a seeded random walk around an idle value, with
 * no process behind them. Saying so in the UI is better than a confident
 * number, and the badge disappears by itself once the value gets a real model.
 */
export function qualityOf(
  def: { kind: string; bindTank?: string; bindPipe?: string },
  values: Record<string, number> | undefined,
  opts: { oos?: boolean; process?: ProcessFault } = {},
): QualityState {
  if (!values) return { q: 'bad', why: 'No value is being produced for this tag' }
  if ((values.BAD ?? 0) >= 0.5) return { q: 'bad', why: 'Instrument fault — reading is not valid' }
  // FORCED and FROZEN outrank the process faults below on purpose: the number
  // on the screen came from an operator's hand or from a held input, so what
  // the solver thinks of the plant behind it does not describe it either way.
  if ((values.FORCED ?? 0) >= 0.5) return { q: 'forced', why: 'Value forced by hand — not the process' }
  if ((values.FROZEN ?? 0) >= 0.5) return { q: 'stale', why: 'Input frozen — value is not updating' }
  if (opts.oos) return { q: 'uncertain', why: 'Tag is out of service' }
  if (opts.process !== undefined) return PROCESS_FAULT[opts.process]
  if (def.kind === 'display' && def.bindTank === undefined && def.bindPipe === undefined) {
    return { q: 'uncertain', why: 'No process model behind this measurement' }
  }
  return GOOD
}

/** What each solver flag means to an operator. BAD hides the number entirely
 *  (`hasNumber`); UNCERTAIN keeps it and says not to trust it. */
const PROCESS_FAULT: Record<ProcessFault, QualityState> = {
  unconverged: { q: 'bad', why: 'No hydraulic solution — mass is not balanced' },
  cavitating: { q: 'uncertain', why: 'Suction below absolute zero — the model cannot represent this' },
  undetermined: { q: 'uncertain', why: 'No path to a pressure boundary — pressure level is undetermined' },
}

/** Badge glyph. Shape first, so quality never depends on colour alone. */
export const QUALITY_GLYPH: Record<Quality, string> = {
  good: '', forced: 'F', stale: '⧖', uncertain: '?', bad: '✕',
}

/** Short word for a faceplate or a diagnostics table. */
export const QUALITY_LABEL: Record<Quality, string> = {
  good: 'GOOD', forced: 'FORCED', stale: 'STALE', uncertain: 'UNCERTAIN', bad: 'BAD',
}

/** A bad reading has no number to show. A DCS prints dashes rather than the
 *  last value it happened to hold, because a stale number is read as a live
 *  one. Forced and stale DO keep their number — the value is real, its
 *  provenance is what the badge qualifies. */
export const hasNumber = (q: Quality | undefined): boolean => q !== 'bad'
