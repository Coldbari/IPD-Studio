// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { formatTag } from '../isa/tag'
import type { PlantNode } from '../model/types'
import type { PortDef, PortSide, SymbolDef } from './types'
import { SYMBOLS } from './registry'

/**
 * What to call a connection point.
 *
 * The drawing model identifies ports by short stable ids — `n`, `n1`, `w2`,
 * `sig` — and it has to keep doing that: those strings are written into every
 * saved document, every DEXPI export and every edge end in the store. They
 * are addresses, though, not language. Everything the software said out loud
 * about a connection was therefore either silent about which one it meant, or
 * had to say "w2", which tells an engineer nothing.
 *
 * So the id stays exactly as it is and the words are computed beside it, from
 * two sources and in this order:
 *
 *   1. `PortDef.name`, where the catalogue definition actually establishes
 *      the meaning — a centrifugal pump's `suction` and `discharge`, a PSV's
 *      `in` and `out`, a control valve's `sig`. Authoritative.
 *
 *   2. Otherwise, where the point sits on the symbol — "Top connection",
 *      "Left connection (upper)". True of every symbol, and says nothing
 *      about what the connection is FOR.
 *
 * The second kind is deliberately mute about function. A nozzle at the top of
 * a vessel is not an inlet because it is at the top; a drawing decides that,
 * and this file has no way to know. Consumers that must not overstate — the
 * refusal message a user reads when a connection is rejected — check
 * `authoritative` before putting the words in a sentence.
 */
export interface PortLabel {
  /** What to call it. */
  text: string
  /** true only when the CATALOGUE names this port, rather than the text
   *  being a description of where the point sits. */
  authoritative: boolean
}

/**
 * Which face of the symbol a port sits on, or null when it sits too far
 * inside the frame to belong to any face.
 *
 * THE one rule: `portDirection` in canvas/shapes.ts — which decides which way
 * a link leaves a port, and therefore how every elbow in the drawing is
 * routed — calls this. Router geometry and the words a user reads can never
 * disagree about which side a nozzle is on, because there is one answer.
 */
export function portSide(
  port: { x: number; y: number; dir?: PortSide },
  w: number,
  h: number,
): PortSide | null {
  if (port.dir) return port.dir
  const candidates: [PortSide, number][] = [
    ['left', port.x],
    ['right', w - port.x],
    ['top', port.y],
    ['bottom', h - port.y],
  ]
  candidates.sort((a, b) => a[1] - b[1])
  const [side, distance] = candidates[0]!
  // 10px slack covers nozzle ports that sit slightly inside a dished head.
  return distance <= 10 ? side : null
}

const CLOCKWISE: Record<PortSide, PortSide> = {
  top: 'right', right: 'bottom', bottom: 'left', left: 'top',
}

/** The side a face turns into when the symbol is rotated. */
export function rotateSide(side: PortSide, rotation: number): PortSide {
  let s = side
  for (let i = 0; i < turnsOf(rotation); i++) s = CLOCKWISE[s]
  return s
}

function turnsOf(rotation: number): number {
  return (((rotation % 360) + 360) % 360) / 90
}

const SIDE_WORD: Record<PortSide, string> = {
  top: 'Top connection',
  bottom: 'Bottom connection',
  left: 'Left connection',
  right: 'Right connection',
}

/** A port with no face — deep inside the frame. The stable id is still the
 *  identity; there is simply nothing true to say about where it is. */
const NO_SIDE = 'Connection point'

// Words for telling apart several points that would otherwise read alike:
// three nozzles across the top of a vessel, or the three bosses down a
// positioner. Beyond three there is no honest short word, so they number.
const ACROSS: Record<number, string[]> = {
  2: ['left', 'right'],
  3: ['left', 'centre', 'right'],
}
const DOWN: Record<number, string[]> = {
  2: ['upper', 'lower'],
  3: ['upper', 'middle', 'lower'],
}

interface Row {
  port: PortDef
  base: string
  authoritative: boolean
  /** Offset from the symbol's centre, in the ROTATED frame. */
  dx: number
  dy: number
}

function build(def: SymbolDef, rotation: number): Map<string, PortLabel> {
  const w = def.gridSize.w * 8
  const h = def.gridSize.h * 8
  const turns = turnsOf(rotation)

  const rows: Row[] = def.ports.map((port) => {
    // Same transform as portWorld's, so "upper" here means upper on screen.
    let dx = port.x - w / 2
    let dy = port.y - h / 2
    for (let i = 0; i < turns; i++) {
      const t = -dy
      dy = dx
      dx = t
    }
    const side = portSide(port, w, h)
    const base = port.name ?? (side ? SIDE_WORD[rotateSide(side, rotation)] : NO_SIDE)
    return { port, base, authoritative: port.name !== undefined, dx, dy }
  })

  // Points that would read identically are grouped and told apart by how
  // they are arranged — which is a fact about the drawing, so it is safe to
  // say even for an authoritative name ("Positioner connection (upper)").
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const list = groups.get(r.base) ?? []
    list.push(r)
    groups.set(r.base, list)
  }

  const out = new Map<string, PortLabel>()
  for (const [base, group] of groups) {
    if (group.length === 1) {
      const r = group[0]!
      out.set(r.port.id, { text: base, authoritative: r.authoritative })
      continue
    }
    const spreadX = Math.max(...group.map((r) => r.dx)) - Math.min(...group.map((r) => r.dx))
    const spreadY = Math.max(...group.map((r) => r.dy)) - Math.min(...group.map((r) => r.dy))
    const horizontal = spreadX >= spreadY
    const sorted = [...group].sort((a, b) => {
      const d = horizontal ? a.dx - b.dx : a.dy - b.dy
      return d !== 0 ? d : a.port.id < b.port.id ? -1 : 1
    })
    const words = (horizontal ? ACROSS : DOWN)[sorted.length]
    sorted.forEach((r, i) => {
      out.set(r.port.id, {
        text: words ? `${base} (${words[i]!})` : `${base} ${i + 1}`,
        authoritative: r.authoritative,
      })
    })
  }
  return out
}

/**
 * Resolved statically, once per symbol and rotation, and held.
 *
 * Nothing on the drag path asks for a label — the docking loop matches ports
 * by geometry and never by name — but the property panel asks for a whole
 * symbol's worth every time a selection changes, and a rotated vessel is one
 * of at most four answers. Building them costs a pass over eleven ports; the
 * cache means it happens once per shape, not once per click.
 */
const cache = new Map<string, Map<string, PortLabel>>()

/** Custom symbols are re-registered from the document whenever one is opened,
 *  so their labels have to go with them. */
export function resetPortLabels(): void {
  cache.clear()
}

/** Every port of a symbol, by port id. Empty for a symbol the catalogue does
 *  not have. */
export function portLabels(symbolId: string, rotation = 0): Map<string, PortLabel> {
  const key = `${symbolId}|${turnsOf(rotation)}`
  const hit = cache.get(key)
  if (hit) return hit
  const def = SYMBOLS.get(symbolId)
  const built = def ? build(def, rotation) : new Map<string, PortLabel>()
  cache.set(key, built)
  return built
}

/** One port. `null` for an unknown symbol, and for a user-added pin — the
 *  app did not put those there and has nothing to say about them. */
export function portLabel(symbolId: string, portId: string, rotation = 0): PortLabel | null {
  return portLabels(symbolId, rotation).get(portId) ?? null
}

/** The same, for a placed symbol: its rotation is part of what the words
 *  mean, since a turned symbol's top nozzle is no longer at the top. */
export function labelOfPort(
  node: { symbolId: string; rotation: number },
  portId: string,
): PortLabel | null {
  return portLabel(node.symbolId, portId, node.rotation)
}

/**
 * What to call a symbol in a sentence: the tag an engineer would use, and the
 * catalogue's name for it until it has one. `null` for a symbol the catalogue
 * no longer has — there is then nothing to call it but its id, which means
 * nothing to a reader.
 */
export function nodeRef(node: PlantNode): string | null {
  if (node.tag) return formatTag(node.tag, '-')
  return SYMBOLS.get(node.symbolId)?.name ?? null
}

/**
 * "PU-101 discharge" — a symbol and one of its connection points, the way an
 * engineer says it out loud.
 *
 * `null` when either half is unknown, which is the honest answer for a
 * user-added pin: the app did not put it there and has no word for it.
 * Callers fall back to whatever they said before rather than guessing.
 */
export function connectionRef(node: PlantNode, portId: string): string | null {
  const who = nodeRef(node)
  const label = labelOfPort(node, portId)
  if (!who || !label) return null
  return `${who} ${label.text.charAt(0).toLowerCase()}${label.text.slice(1)}`
}
