// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The I/O list, DERIVED from the drawing and the engineering registry.
 *
 * There is no I/O database. Every row is computed from objects that already
 * exist — a tagged instrument, its ISA letters, the signal lines it touches,
 * and the record filed under its tag — so an I/O list cannot drift from the
 * P&ID the way a maintained spreadsheet does. Change the drawing and the list
 * changes; there is nothing to keep in step.
 *
 * IDENTITY is the engineering tag, the same key the registry files a record
 * under. One instrument is one row however many HMI widgets display it and
 * however many sheets it appears on — an operator screen is a consumer of
 * engineering data, never evidence that an I/O point exists.
 *
 * The hard part is the signal type, and the rule there is that a wrong answer
 * is worse than no answer. An I/O list is what a control-system vendor cards
 * a cabinet from; an AI that should have been a DI is a wiring change on site.
 * So classification uses only what the model actually states, and says
 * `unknown` — with the reason — whenever that is not enough.
 */

import type { PlantNode } from './types'
import type { ProjectIndex } from './projectIndex'
import { edgesOf } from './projectIndex'
import { expandLetters, formatTag, validateLetters } from '../isa/tag'
import { getSymbol } from '../symbols/registry'
import { engineeringFor } from './signalData'
import type { IoType } from './signalData'
import { areaCodeOf, unitCodeOf } from './hierarchy'

/** `none` = determinably not an I/O point. `unknown` = it may be one, and the
 *  model does not say enough to classify it. The two are very different and
 *  the list must not blur them. */
export type IoVerdict = IoType | 'none' | 'unknown'

export interface IoClassification {
  type: IoVerdict
  /** Why, in the words an engineer would use. Shown in the table. */
  basis: string
}

export interface IoRow {
  /** Engineering identity — the tag, and the registry key. */
  key: string
  /** First node wearing this tag, for navigation. */
  nodeId: string
  sheetId: string
  sheetName: string
  drawingNumber: string
  /** ISA letters expanded: "Flow Indicating Controller". */
  description: string
  /** `L-101` from the tag itself; never manufactured. */
  loopRef: string
  /** True when nothing else shares the loop number — no relationship derived. */
  loopIsAlone: boolean
  /** More than one symbol carries this tag (shown twice, or a duplicate). */
  occurrences: number
  type: IoVerdict
  typeBasis: string
  /** Whether the type was stated in the registry or worked out from the model. */
  typeSource: 'registry' | 'derived'
  /**
   * Plant hierarchy, resolved from the record's Unit assignment. Empty when
   * the object is not assigned — and an unassigned instrument STAYS IN THE
   * LIST. An I/O list that quietly dropped every point nobody had filed under
   * a unit would under-report the cabinet it exists to size, which is the one
   * thing it must never do.
   */
  areaCode: string
  unitCode: string
}

/**
 * EVIDENCE FOR A FINAL ELEMENT'S I/O TYPE.
 *
 * Whether a valve takes a discrete output or an analogue one is a fact about
 * its ACTUATOR, so that is what is read — the symbol where the symbol IS the
 * device, and the placed node's own actuator/positioner config otherwise.
 *
 * What is deliberately NOT evidence: `node.kind === 'valve'`. That used to
 * mean AO, which made a hand valve, a check valve and a relief valve all
 * report as modulating analogue outputs the moment anything signal-shaped
 * touched them. An I/O list is what a vendor cards a cabinet from; a confident
 * wrong answer there is a wiring change on site, and "valve" on its own says
 * nothing about how it is driven.
 */

/** Symbols that ARE an on/off device — the symbol states the actuator. */
const DISCRETE_DRIVERS = new Set(['valve.solenoid', 'valve.mov'])
/** A converter is the point an analogue output actually lands on. */
const ANALOGUE_DRIVERS = new Set(['instr.converter'])
/** `config.actuator` values that are on/off by construction. */
const DISCRETE_ACTUATORS = new Set(['solenoid'])
/** Hand-operated: nothing drives it, whatever is drawn to it. */
const MANUAL_ACTUATORS = new Set(['manual'])

/** The catalogue category of a placed symbol, or null when it is not
 *  registered — a custom symbol, or one from a newer build. Never throws: a
 *  deliverable must not fall over because a definition is missing. */
function categoryOf(symbolId: string): string | null {
  try {
    return getSymbol(symbolId).category
  } catch {
    return null
  }
}

/**
 * ISA-5.1 display class. `discrete` is a physical instrument; the others place
 * the function INSIDE the control system, where it is software and has no
 * field wiring of its own — the AI belongs to the transmitter feeding it and
 * the AO to the element it drives.
 */
const SYSTEM_RESIDENT = new Set(['shared', 'computer', 'plc'])

const functionLetters = (letters: string): string[] =>
  validateLetters(letters).parts.filter((p) => p.role === 'function').map((p) => p.letter)

/**
 * Classify one tagged object.
 *
 * Uses the STRUCTURED letter parse rather than string matching, which is what
 * keeps `PSV` out of the discrete-input bucket: the parser knows the S in a
 * safety valve is a modifier and the S in `LSH` is a Switch function.
 */
export function classifyIo(node: PlantNode, ix: ProjectIndex): IoClassification {
  const letters = node.tag?.letters
  if (!letters) return { type: 'none', basis: 'No tag' }

  const parsed = validateLetters(letters)
  if (!parsed.ok) return { type: 'unknown', basis: `Tag letters "${letters}" are not valid ISA` }

  const display = node.config?.display
  if (display && SYSTEM_RESIDENT.has(display)) {
    return { type: 'none', basis: 'Shown as a control-system function, so it is software rather than field wiring' }
  }

  const signalEdges = edgesOf(ix, node.id).filter(
    (e) => e.lineClass.startsWith('signal') || e.lineClass === 'link.internal',
  )
  if (signalEdges.length === 0) {
    return { type: 'none', basis: 'No signal line, so nothing is wired to a control system' }
  }

  // A pneumatic-only device exchanges air, not an electrical I/O point. The
  // I/O is on whatever converts to it.
  const kinds = new Set(signalEdges.map((e) => e.lineClass))
  if (kinds.size > 0 && [...kinds].every((k) => k === 'signal.pneumatic' || k === 'signal.hydraulic' || k === 'signal.capillary')) {
    return { type: 'none', basis: 'Only pneumatic/hydraulic signals — the electrical point is on the converter' }
  }
  if ([...kinds].every((k) => k === 'signal.data' || k === 'signal.software')) {
    return {
      type: 'unknown',
      basis: kinds.has('signal.software')
        ? 'Software link only — an internal system function, not field wiring'
        : 'Digital bus signal — a fieldbus point, which this list does not classify',
    }
  }

  const fns = functionLetters(letters)
  const terminal = fns[fns.length - 1]

  // Sends to the system.
  if (fns.includes('T')) return { type: 'AI', basis: 'Transmitter (T) — an analogue measurement into the system' }
  if (fns.includes('S')) return { type: 'DI', basis: 'Switch (S) — a contact into the system' }

  // Driven by the system. Which WAY depends on the actuator, so every branch
  // below names the evidence it used — and the last one names what is missing.
  if (terminal === 'V' || terminal === 'Z' || fns.includes('Y')) {
    const actuator = node.config?.actuator
    const category = categoryOf(node.symbolId)

    if (DISCRETE_DRIVERS.has(node.symbolId)) {
      return { type: 'DO', basis: 'On/off driver — a discrete output from the system' }
    }
    if (actuator && DISCRETE_ACTUATORS.has(actuator)) {
      return { type: 'DO', basis: `${actuator} actuator — on/off by construction, so a discrete output` }
    }
    if (actuator && MANUAL_ACTUATORS.has(actuator)) {
      return {
        type: 'unknown',
        basis: 'A hand-operated actuator with a signal line — nothing here says what the system drives',
      }
    }
    // A positioner exists to hold an intermediate position. Nothing else does.
    if (node.config?.positioner === 'yes') {
      return { type: 'AO', basis: 'Positioner fitted — a modulating element, so an analogue output' }
    }
    if (ANALOGUE_DRIVERS.has(node.symbolId)) {
      return { type: 'AO', basis: 'Modulating final element — an analogue output from the system' }
    }
    // The catalogue's control-valve bodies carry a modulating actuator by
    // default, and the category is the symbol stating what it is. That is
    // evidence; being drawn as some valve is not.
    if (category === 'control-valves') {
      return { type: 'AO', basis: 'Control-valve body with a modulating actuator — an analogue output' }
    }
    return {
      type: 'unknown',
      basis: 'A final element, but nothing states the actuator — set the I/O type on the record, or pick a symbol that says how it is driven',
    }
  }

  return {
    type: 'unknown',
    basis: `Letters ${letters} do not say which way the signal travels — no transmitter, switch or final element`,
  }
}

/**
 * The whole list, one row per engineering tag, in a stable order.
 *
 * Computed ONCE from the index the rest of the application already builds. No
 * second index, and no per-cell topology walk.
 */
export function deriveIoList(ix: ProjectIndex): IoRow[] {
  const rows: IoRow[] = []
  const loopSize = new Map<string, number>()
  for (const loop of ix.loops) loopSize.set(`${loop.family}-${loop.loop}`, loop.members.length)

  for (const [key, group] of ix.nodesByKey) {
    // One row per KEY. A tag shown on two sheets, or displayed by four HMI
    // widgets, is one engineering point.
    const first = group[0]!
    const node = first.node
    if (node.kind !== 'instrument' && node.kind !== 'valve') continue

    const verdict = classifyIo(node, ix)
    // `none` is a decision, not an omission: a local gauge or a relief valve
    // genuinely has no I/O. `countNonIo` counts them off the same index and
    // the I/O tab prints the number, so a row that is absent is absent for a
    // reason the reader can see.
    if (verdict.type === 'none') continue

    const stated = engineeringFor(ix.doc.registry, key).type
    const loopRef = node.tag ? `${node.tag.letters[0]}-${node.tag.loop}` : ''
    // One map lookup off the index built with the rest of the walk — never a
    // scan of the unit array per row.
    const unitId = ix.records[key]?.unitId

    rows.push({
      key,
      nodeId: node.id,
      sheetId: first.sheet.id,
      sheetName: first.sheet.name,
      drawingNumber: first.sheet.drawingNumber,
      description: node.tag ? expandLetters(node.tag.letters) : '',
      loopRef,
      loopIsAlone: (loopSize.get(loopRef) ?? 0) < 2,
      occurrences: group.length,
      // The registry is authoritative: a stated type is the answer, and the
      // derivation becomes a second opinion nobody has to act on.
      type: stated ?? verdict.type,
      typeBasis: stated ? 'Stated on the engineering record' : verdict.basis,
      typeSource: stated ? 'registry' : 'derived',
      areaCode: areaCodeOf(ix.hierarchy, unitId),
      unitCode: unitCodeOf(ix.hierarchy, unitId),
    })
  }

  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

/** Rows the list deliberately set aside, for the count the workspace shows. */
export function countNonIo(ix: ProjectIndex): number {
  let n = 0
  for (const [, group] of ix.nodesByKey) {
    const node = group[0]!.node
    if (node.kind !== 'instrument' && node.kind !== 'valve') continue
    if (classifyIo(node, ix).type === 'none') n += 1
  }
  return n
}

export const tagOf = (node: PlantNode): string => (node.tag ? formatTag(node.tag, '-') : '')
