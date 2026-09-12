// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectDoc, Tag } from '../model/types'
import { deriveLoops } from '../store/selectors'
import { formatTag } from '../isa/tag'
import { expandLetters } from '../isa/tag'
import { classifyMember, type MemberRole } from '../model/loop'
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

export function loopDiagramSvg(doc: ProjectDoc, family: string, loop: string): string {
  const loops = deriveLoops(doc)
  const target = loops.find((l) => l.family === family && l.loop === loop)
  if (!target) throw new Error(`No loop ${family}-${loop} in this project`)

  const nodeById = new Map(doc.sheets.flatMap((sh) => sh.nodes.map((n) => [n.id, n] as const)))

  // place members into columns
  let fieldY = TOP
  let controlY = TOP
  const placed: Placed[] = target.members.map((m) => {
    const node = nodeById.get(m.nodeId)
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
  text(W - 32, H - 40, `LOOP ${family}-${loop}`, 20, 'end', 'bold')
  text(32, H - 40, `${doc.meta.name} — generated loop diagram`, 11, 'start')
  text(32, H - 60, `Members: ${target.members.map((m) => formatTag(m.tag, '-')).join(', ')}`, 11, 'start')

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
  const svg = loopDiagramSvg(doc, family, loop)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const idoc = iframe.contentDocument
  if (!idoc) return
  idoc.open()
  idoc.write(
    `<!doctype html><html><head><title>Loop ${family}-${loop}</title><style>` +
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
