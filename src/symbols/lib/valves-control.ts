// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'
import { BOWTIE } from './valves-manual'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`
const text = (x: number, y: number, t: string) =>
  `<text x="${x}" y="${y}" font-size="10" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

/**
 * Control valve: 64x48 — long straight pipe stubs (16px each side) so the
 * symbol sits IN the line with proper spacing, and a tall middle zone so the
 * positioner box never touches the actuator or the body.
 * Zones: actuator y0..12 centered on x32, stem x32 y12..28, body y28..44
 * (32-wide bowtie centered at 16..48, stubs 0..16 and 48..64 at y36).
 * cfg.actuator: diaphragm | piston | motor | solenoid | manual | digital |
 * electro-hydraulic · cfg.fail: none | fc | fo | fl · cfg.positioner:
 * none | yes
 */
function actuatorGlyph(actuator: string): string {
  switch (actuator) {
    case 'piston':
      return path('M24 2 h16 v10 h-16 Z M24 7 h16')
    case 'motor':
      return `<circle cx="32" cy="6" r="6" fill="none" stroke="currentColor" stroke-width="${S}"/>` + text(32, 9.5, 'M')
    case 'solenoid':
      return path('M26 0 h12 v12 h-12 Z') + text(32, 9.5, 'S')
    case 'manual':
      return path('M22 4 H42 M32 4 V12')
    case 'digital':
      return path('M26 0 h12 v12 h-12 Z') + text(32, 9.5, 'D')
    case 'electro-hydraulic':
      return path('M22 0 h20 v12 h-20 Z') + text(32, 9.5, 'EH')
    default: // spring diaphragm
      return path('M22 12 a10 8 0 0 1 20 0 Z')
  }
}

/** Fail-action arrow beside the stem; shifts to the left flank when the
 *  positioner box occupies the right. */
function failMark(fail: string, x = 42): string {
  switch (fail) {
    case 'fc':
      return path(`M${x} 14 V22 M${x - 3} 19 L${x} 22 L${x + 3} 19`)
    case 'fo':
      return path(`M${x} 22 V14 M${x - 3} 17 L${x} 14 L${x + 3} 17`)
    case 'fl':
      return path(`M${x - 4} 18 H${x + 4}`)
    default:
      return ''
  }
}

/**
 * Valve positioner, per the user's reference drawing: the box hangs on the
 * RIGHT side of the stem (its left edge on the stem line, stem visible above
 * and below, running through to the body crossing), with three connection
 * bosses drawn as circles inside — the sw/se/sb ports sit on the box's right
 * edge in line with them, so signal/air lines land one per boss.
 */
function positionerGlyph(): string {
  const boss = (cy: number) =>
    `<circle cx="42" cy="${cy}" r="1.6" fill="none" stroke="currentColor" stroke-width="1.1"/>`
  return path('M32 14 h16 v12 h-16 Z') + boss(16) + boss(20) + boss(24)
}

function bodyAt(bodyMarkup: string): string {
  // 32-wide body drawn centered in the 64 frame, with long pipe stubs.
  return `<g transform="translate(16 28)">${bodyMarkup}</g>` + path('M0 36 H16 M48 36 H64')
}

const CV_BODIES: Record<string, { name: string; markup: string; keywords: string[] }> = {
  'cv.globe': {
    name: 'Control Valve (Globe)',
    markup: path(BOWTIE) + `<circle cx="16" cy="8" r="4" fill="currentColor" stroke="none"/>`,
    keywords: ['control valve', 'globe', 'fv', 'pv', 'tv', 'lv', 'throttling'],
  },
  'cv.butterfly': {
    name: 'Control Valve (Butterfly)',
    markup:
      path('M0 0 L0 16 M32 0 L32 16 M4 14 L28 2') +
      `<circle cx="16" cy="8" r="2" fill="currentColor" stroke="none"/>`,
    keywords: ['control valve', 'butterfly'],
  },
  'cv.ball': {
    name: 'Control Valve (Ball)',
    markup: path(BOWTIE) + `<circle cx="16" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="${S}"/>`,
    keywords: ['control valve', 'ball', 'on-off', 'xv'],
  },
}

export const controlValves: SymbolDef[] = Object.entries(CV_BODIES).map(([id, body]) => ({
  id,
  name: body.name,
  category: 'control-valves',
  gridSize: { w: 8, h: 6 },
  render: (cfg) => {
    const pos = cfg.positioner === 'yes'
    return (
      actuatorGlyph(cfg.actuator ?? 'diaphragm') +
      // with a positioner the stem runs through to the body crossing
      (pos ? path('M32 12 V36') + positionerGlyph() : path('M32 12 V28')) +
      failMark(cfg.fail ?? 'none', pos ? 22 : 42) +
      bodyAt(body.markup)
    )
  },
  ports: [
    { id: 'w', x: 0, y: 36, kind: 'process' },
    { id: 'e', x: 64, y: 36, kind: 'process' },
    { id: 'sig', x: 32, y: 0, kind: 'signal', name: 'Signal' },
    // Positioner bosses: one port per connection circle on the box's right
    // edge. Precision halos + an explicit direction: they sit too deep in the
    // frame for edge-distance direction detection, and their lines must
    // always leave rightward.
    //
    // They share one name on purpose. The drawing establishes that all three
    // belong to the positioner and NOT what each carries — supply, output and
    // feedback are a matter of the instrument, not the symbol — so they are
    // told apart by where they sit on the box, which is a fact.
    { id: 'sw', x: 48, y: 16, kind: 'signal', hit: 3, dir: 'right', name: 'Positioner connection' },
    { id: 'se', x: 48, y: 20, kind: 'signal', hit: 3, dir: 'right', name: 'Positioner connection' },
    { id: 'sb', x: 48, y: 24, kind: 'signal', hit: 3, dir: 'right', name: 'Positioner connection' },
  ],
  tagRule: 'valve',
  defaultConfig: { actuator: 'diaphragm', fail: 'none', positioner: 'none' },
  configOptions: {
    actuator: ['diaphragm', 'piston', 'motor', 'solenoid', 'manual', 'digital', 'electro-hydraulic'],
    fail: ['none', 'fc', 'fo', 'fl'],
    positioner: ['none', 'yes'],
  },
  keywords: body.keywords,
}))
