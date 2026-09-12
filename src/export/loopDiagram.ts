// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantNode, ProjectDoc, Tag } from '../model/types'
import { deriveLoops } from '../store/selectors'
import { formatTag, parseTag } from '../isa/tag'
import { expandLetters } from '../isa/tag'
import { classifyMember, LOOP_TYPE_LABELS, type MemberRole } from '../model/loop'
import { loopViews } from '../model/loopIndex'
import { buildIndex } from '../model/projectIndex'
import { getSymbol } from '../symbols/registry'

/**
 * ISA-5.4-style loop diagram: a generated A4-landscape sheet showing the
 * loop's members in FIELD / MARSHALLING / CONTROL ROOM columns with numbered
 * terminal pairs. Pure function of the model; rendered for print on demand.
 *
 * `classifyMember` used to live HERE, which made an export module the owner of
 * the product's only role classifier — and the assistant imported it from here
 * to reason about loops. It is model/loop.ts's now; this file consumes it like
 * every other consumer.
 */

const W = 1123 // A4 landscape @ 96dpi-ish px
const H = 794
const FIELD_X = 120
const MARSHAL_X = 480
const CONTROL_X = 760
const TOP = 110
const PITCH = 110

const FIELD_ROLES: MemberRole[] = ['element', 'transmitter', 'final', 'switch', 'other']

interface Placed {
  tag: Tag
  role: MemberRole
  symbolId: string
  config?: Record<string, string>
  x: number
  y: number
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * WHAT THE DIAGRAM IS BEING DRAWN FROM.
 *
 * A projection, and only ever a projection: a list of members with their tags,
 * a title, and an optional line of explanatory text. There is deliberately no
 * topology in here. The columns and the terminal pairs below are laid out from
 * the ISA ROLE of each member — they are not read from the drawn signal edges
 * and they are not a claim about how anything is actually wired, which is why
 * every sheet says so in its footer.
 *
 * Both sources build one of these. Neither stores it: membership lives on the
 * engineering records, and a second copy inside the diagram is a second copy
 * to keep in step.
 */
interface LoopSource {
  /** Printed large, bottom right: 'LOOP F-101' or 'LOOP 101'. */
  title: string
  members: { tag: Tag; node?: PlantNode }[]
  /** Structural state and type, for a persistent loop. Absent on the derived
   *  path, which has neither. */
  state?: string
}

/**
 * The derived path, unchanged.
 *
 * Grouped on (first ISA letter, loop number), exactly as the drawer lists
 * them, for every project that has not declared persistent loops. Its output
 * is what it has always been.
 */
export function loopDiagramSvg(doc: ProjectDoc, family: string, loop: string): string {
  const loops = deriveLoops(doc)
  const target = loops.find((l) => l.family === family && l.loop === loop)
  if (!target) throw new Error(`No loop ${family}-${loop} in this project`)

  const nodeById = new Map(doc.sheets.flatMap((sh) => sh.nodes.map((n) => [n.id, n] as const)))
  return renderLoop(doc, {
    title: `LOOP ${family}-${loop}`,
    members: target.members.map((m) => {
      const node = nodeById.get(m.nodeId)
      return { tag: m.tag, ...(node ? { node } : {}) }
    }),
  })
}

/**
 * The persistent path: a declared Loop, by its stable id.
 *
 * Membership comes from the engineering records through `loopViews`, so a
 * member's tag is whatever the registry says it is now — a renamed object
 * shows its new tag here without the diagram knowing a rename happened, which
 * is the whole point of keying membership on the record.
 *
 * A member whose symbol is not on any sheet is still DRAWN on the diagram,
 * from its tag alone, because leaving it out would quietly shorten the loop.
 * The state line says the loop is broken.
 *
 * Nothing is persisted by producing this. It is a read.
 */
export function persistentLoopDiagramSvg(doc: ProjectDoc, loopId: string): string {
  const ix = buildIndex(doc)
  const view = loopViews(ix).find((v) => v.loop.id === loopId)
  if (!view) throw new Error(`No loop ${loopId} in this project`)

  const { loop, evaluation } = view
  const typeText = evaluation.type
    ? `${LOOP_TYPE_LABELS[evaluation.type]}${evaluation.typeSource === 'derived' ? ' (suggested)' : ''}`
    : 'Type not stated'
  const state = `${typeText} — ${STATE_TEXT[evaluation.completeness]}`

  return renderLoop(doc, {
    title: `LOOP ${loop.number}`,
    // Members come from the record keys; the tag is parsed back out of the
    // key, which IS the formatted tag. No second copy of membership.
    members: view.members.map((m) => {
      const node = ix.nodesByKey.get(m.key)?.[0]?.node
      const tag = node?.tag ?? parseTag(m.key)
      return { tag: tag ?? { letters: m.letters || 'XX', loop: '' }, ...(node ? { node } : {}) }
    }),
    state,
  })
}

/** Structural wording. Never "valid", "correct" or "approved" — this checks
 *  which roles a declared loop type needs, and nothing else. */
const STATE_TEXT: Record<string, string> = {
  complete: 'Structurally complete',
  incomplete: 'Structurally incomplete',
  broken: 'Broken membership',
  unknown: 'Type not stated',
  'not-applicable': 'Not applicable',
}

function renderLoop(doc: ProjectDoc, source: LoopSource): string {
  // place members into columns
  let fieldY = TOP
  let controlY = TOP
  const placed: Placed[] = source.members.map((m) => {
    const node = m.node
    const role = classifyMember(m.tag.letters)
    const field = FIELD_ROLES.includes(role)
    const y = field ? (fieldY += 0) : (controlY += 0)
    const p: Placed = {
      tag: m.tag,
      role,
      symbolId: node?.symbolId ?? 'instr.bubble',
      x: field ? FIELD_X : CONTROL_X,
      y,
      ...(node?.config ? { config: node.config } : {}),
    }
    if (field) fieldY += PITCH
    else controlY += PITCH
    return p
  })

  // signal pairs: every field transmitter/switch/element-with-signal to every control member,
  // and controller back to final elements — simplified as consecutive terminal pairs.
  const fieldSide = placed.filter((p) => FIELD_ROLES.includes(p.role))
  const controlSide = placed.filter((p) => !FIELD_ROLES.includes(p.role))
  const connections: [Placed, Placed][] = []
  for (const f of fieldSide) {
    if (f.role === 'transmitter' || f.role === 'switch') {
      const to = controlSide[0]
      if (to) connections.push([f, to])
    }
    if (f.role === 'final') {
      const from = controlSide.find((c) => c.role === 'controller') ?? controlSide[0]
      if (from) connections.push([from, f])
    }
  }

  const parts: string[] = []
  const line = (x1: number, y1: number, x2: number, y2: number, dash = '') =>
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
    )
  const text = (x: number, y: number, t: string, size = 11, anchor = 'middle', weight = 'normal') =>
    parts.push(
      `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" fill="#111">${esc(t)}</text>`,
    )

  // frame + column headers
  parts.push(`<rect x="16" y="16" width="${W - 32}" height="${H - 32}" fill="none" stroke="#111" stroke-width="1.5"/>`)
  line(MARSHAL_X - 90, 16, MARSHAL_X - 90, H - 96)
  line(MARSHAL_X + 90, 16, MARSHAL_X + 90, H - 96)
  line(16, H - 96, W - 16, H - 96)
  text((16 + MARSHAL_X - 90) / 2, 44, 'FIELD', 13, 'middle', 'bold')
  text(MARSHAL_X, 44, 'MARSHALLING / JB', 13, 'middle', 'bold')
  text((MARSHAL_X + 90 + W - 16) / 2, 44, 'CONTROL ROOM / DCS', 13, 'middle', 'bold')
  text(W - 32, H - 40, source.title, 20, 'end', 'bold')
  text(32, H - 40, `${doc.meta.name} — generated loop diagram`, 11, 'start')
  text(32, H - 60, `Members: ${source.members.map((m) => formatTag(m.tag, '-')).join(', ')}`, 11, 'start')
  if (source.state) text(32, H - 76, source.state, 11, 'start')
  // SAID ON EVERY SHEET. The columns and the terminal pairs are laid out from
  // the members' ISA roles; they are not read from the drawn signal lines and
  // they are not a statement about how anything is wired. A reader who takes
  // this for a verified wiring diagram would be taking it for something this
  // software has never claimed to produce.
  text(W - 32, H - 60, 'Loop projection — terminals are indicative, not a verified wiring diagram', 9, 'end')

  // members
  for (const p of placed) {
    let glyph = ''
    try {
      const def = getSymbol(p.symbolId)
      const w = def.gridSize.w * 8
      const cfg = p.config ?? def.defaultConfig ?? {}
      glyph = `<g transform="translate(${p.x - w / 2} ${p.y})" color="#111">${def.render(cfg)}</g>`
    } catch {
      glyph = `<circle cx="${p.x}" cy="${p.y + 20}" r="18" fill="none" stroke="#111" stroke-width="1.5"/>`
    }
    const tagText = formatTag(p.tag, '-')
    parts.push(`<g data-member="${esc(tagText)}" data-x="${p.x}" data-y="${p.y}">${glyph}</g>`)
    text(p.x, p.y - 8, tagText, 12, 'middle', 'bold')
    text(p.x, p.y + 78, expandLetters(p.tag.letters), 9)
  }

  // connections through numbered terminals
  let terminal = 1
  for (const [from, to] of connections) {
    const midY = (from.y + to.y) / 2 + 24
    const t1x = MARSHAL_X - 40
    const t2x = MARSHAL_X + 40
    line(from.x + 40, from.y + 24, t1x - 8, midY, '5 3')
    line(t2x + 8, midY, to.x - 40, to.y + 24, '5 3')
    line(t1x + 8, midY, t2x - 8, midY)
    for (const tx of [t1x, t2x]) {
      parts.push(`<circle cx="${tx}" cy="${midY}" r="8" fill="#fff" stroke="#111" stroke-width="1"/>`)
      parts.push(
        `<text x="${tx}" y="${midY + 3.5}" font-family="sans-serif" font-size="9" text-anchor="middle" fill="#111">${terminal}</text>`,
      )
      terminal++
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    parts.join('') +
    `</svg>`
  )
}

/** Open the loop diagram in the print pipeline. */
export function printLoopDiagram(doc: ProjectDoc, family: string, loop: string): void {
  printSvg(loopDiagramSvg(doc, family, loop), `Loop ${family}-${loop}`)
}

/** The same print pipeline, for a declared Loop. Printing reads the document;
 *  it never writes to it. */
export function printPersistentLoopDiagram(doc: ProjectDoc, loopId: string): void {
  const loop = (doc.loops ?? []).find((l) => l.id === loopId)
  printSvg(persistentLoopDiagramSvg(doc, loopId), `Loop ${loop?.number ?? loopId}`)
}

function printSvg(svg: string, title: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const idoc = iframe.contentDocument
  if (!idoc) return
  idoc.open()
  idoc.write(
    `<!doctype html><html><head><title>${title}</title><style>` +
      `@page { size: 297mm 210mm; margin: 0; } html, body { margin: 0; }` +
      `svg { display: block; width: 297mm; height: 210mm; }` +
      `</style></head><body>${svg}</body></html>`,
  )
  idoc.close()
  const win = iframe.contentWindow
  if (!win) return
  win.onafterprint = () => iframe.remove()
  setTimeout(() => {
    win.focus()
    win.print()
    setTimeout(() => iframe.remove(), 60_000)
  }, 100)
}
