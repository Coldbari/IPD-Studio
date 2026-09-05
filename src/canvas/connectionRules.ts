// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { LineClass } from '../model/types'
import type { PortKind } from '../symbols/types'
import { isProcessClass } from './lineStyle'

const processOk = (k: PortKind) => k === 'process' || k === 'both'
const signalOk = (k: PortKind) => k === 'signal' || k === 'both'

export function canConnect(source: PortKind, target: PortKind, lineClass: LineClass): boolean {
  if (isProcessClass(lineClass)) return processOk(source) && processOk(target)
  return signalOk(source) && signalOk(target)
}

/** True when SOME line class could legally join these two port kinds. */
export function compatibleKinds(source: PortKind, target: PortKind): boolean {
  return (processOk(source) && processOk(target)) || (signalOk(source) && signalOk(target))
}

/**
 * Why a connection was refused — the same decision `compatibleKinds` makes,
 * but carrying the reason out with it.
 *
 * The rule itself is unchanged. What changed is that the answer used to be a
 * bare `false`, and a bare `false` cannot be explained to anybody: the drag
 * simply ended and the drawing was left with a line pointing at the nozzle
 * that had refused it. Everything the UI says about a refusal is built from
 * this, so it can never say more than the check actually knows.
 */
export type RefusalCode = 'same-symbol' | 'kind-mismatch'

export interface ConnectionRefusal {
  code: RefusalCode
  /** What happened. */
  title: string
  /** Why — only ever from the check itself. */
  body: string
  /** What to do instead. */
  hint?: string
}

/**
 * Which two things were being joined, in the words an engineer uses.
 *
 * Optional, and all-or-nothing on purpose. A refusal can only name the points
 * it can actually identify: the tag or catalogue name of each symbol, and a
 * port label that is either the catalogue's own word for that connection or a
 * plain statement of where it sits. Where either end cannot be identified —
 * a user-added pin, a symbol the catalogue has lost — the caller passes
 * nothing and the generic explanation stands, which is still true.
 */
export interface ConnectionEnd {
  /** What the symbol is called: its tag, or the catalogue name. */
  symbol: string
  /** What the connection point is called. */
  port: string
}

/** Port labels are written to start a line ("Top connection"); mid-sentence
 *  they need to start lower. Only the first letter, so "I/P" survives. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

const KIND_WORDS: Record<PortKind, string> = {
  process: 'process material',
  signal: 'an instrument signal',
  both: 'either',
}

/**
 * `null` when the pair is joinable. Otherwise the refusal, in the engineer's
 * words rather than the type system's.
 */
export function explainConnection(
  source: PortKind,
  target: PortKind,
  sameSymbol: boolean,
  ends?: { source: ConnectionEnd; target: ConnectionEnd },
): ConnectionRefusal | null {
  if (sameSymbol) {
    return {
      code: 'same-symbol',
      title: 'A line cannot join a symbol to itself',
      body: ends
        ? `Both ends of this line landed on ${ends.source.symbol}.`
        : 'Both ends of this line landed on the same symbol.',
      hint: 'Drop the second end on a different symbol.',
    }
  }
  if (compatibleKinds(source, target)) return null
  return {
    code: 'kind-mismatch',
    title: 'These two connection points cannot be joined',
    // Both kinds are known here, so naming them is a fact and not a guess.
    // The same goes for the two points when the caller could identify them:
    // it is the difference between "one carries a signal" and being told
    // which one, which is the difference between reading the message and
    // acting on it.
    body: ends
      ? `${ends.source.symbol} ${lower(ends.source.port)} carries ${KIND_WORDS[source]}; ` +
        `${ends.target.symbol} ${lower(ends.target.port)} carries ${KIND_WORDS[target]}. ` +
        'A line is one or the other, never both.'
      : `One carries ${KIND_WORDS[source]} and the other ${KIND_WORDS[target]}. A line is one or the other, never both.`,
    hint: 'Instrument bubbles take either kind — route the signal through one, or pick a point on this symbol that matches.',
  }
}

/**
 * Line class for a freshly drawn connection. Honors the toolbar's active class
 * when it fits the ports; otherwise falls back to the obvious family default so
 * a controller-to-valve drag "just works" without touching the line picker.
 * Ends without a port (free ends) pass null and put no constraint on the pick.
 */
export function pickLineClass(
  source: PortKind | null,
  target: PortKind | null,
  active: LineClass,
): LineClass {
  const kinds = [source, target].filter((k): k is PortKind => k !== null)
  const allProcess = kinds.every(processOk)
  const allSignal = kinds.every(signalOk)
  if (isProcessClass(active) ? allProcess : allSignal) return active
  // A strictly-signal port forces the signal family; otherwise prefer process.
  if (allSignal && kinds.some((k) => k === 'signal')) return 'signal.electric'
  if (allProcess) return 'process.major'
  return allSignal ? 'signal.electric' : active
}
