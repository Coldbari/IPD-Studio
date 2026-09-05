// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5

export const controlHardware: SymbolDef[] = [
  {
    id: 'ctl.interlock',
    name: 'Interlock',
    category: 'control',
    gridSize: { w: 3, h: 3 },
    render: () =>
      `<polygon points="12,0 24,12 12,24 0,12" fill="none" stroke="currentColor" stroke-width="${S}"/>` +
      `<text x="12" y="16" font-size="10" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">I</text>`,
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'signal' },
      { id: 'e', x: 24, y: 12, kind: 'signal' },
      { id: 'n', x: 12, y: 0, kind: 'signal' },
      { id: 's', x: 12, y: 24, kind: 'signal' },
    ],
    tagRule: 'none',
    keywords: ['interlock', 'trip', 'logic', 'sis'],
  },
]

const path5 = (d: string, w = 1.5) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linejoin="round"/>`
const text5 = (x: number, y: number, t: string, size = 8) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

function gate(id: string, name: string, label: string, extra = ''): SymbolDef {
  return {
    id,
    name,
    category: 'control',
    gridSize: { w: 4, h: 3 },
    render: () => path5('M0 0 h32 v24 h-32 Z') + text5(16, 15, label) + extra,
    ports: [
      // A gate's left side is its inputs and its right side is its result:
      // that is what the symbol is, not where the ports happen to be. The two
      // inputs share a name and are told apart by position.
      { id: 'w1', x: 0, y: 8, kind: 'signal', name: 'Input' },
      { id: 'w2', x: 0, y: 16, kind: 'signal', name: 'Input' },
      { id: 'e', x: 32, y: 12, kind: 'signal', name: 'Output' },
    ],
    tagRule: 'none',
    keywords: ['logic', 'isa-5.2', label.toLowerCase(), 'interlock'],
  }
}

function systemBox(id: string, name: string, label: string, outerWidth = 1.5): SymbolDef {
  return {
    id,
    name,
    category: 'control',
    gridSize: { w: 5, h: 3 },
    render: () =>
      path5('M0 0 h40 v24 h-40 Z', outerWidth) + path5('M4 4 h32 v16 h-32 Z') + text5(20, 15, label),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'signal' },
      { id: 'e', x: 40, y: 12, kind: 'signal' },
      { id: 'n', x: 20, y: 0, kind: 'signal' },
      { id: 's', x: 20, y: 24, kind: 'signal' },
    ],
    tagRule: 'none',
    keywords: ['system', label.toLowerCase(), 'control system'],
  }
}

export const controlHardware2: SymbolDef[] = [
  gate('logic.and', 'AND Gate', 'AND'),
  gate('logic.or', 'OR Gate', 'OR'),
  {
    ...gate('logic.not', 'NOT Gate', 'NOT'),
    render: () =>
      path5('M0 0 h32 v24 h-32 Z') + text5(15, 15, 'NOT') +
      `<circle cx="32" cy="12" r="2.5" fill="#fff" stroke="currentColor" stroke-width="1.5"/>`,
  },
  systemBox('ctl.dcs', 'DCS', 'DCS'),
  systemBox('ctl.plc', 'PLC System', 'PLC'),
  systemBox('ctl.sis', 'SIS', 'SIS', 2.5),
  {
    id: 'ctl.jb',
    name: 'Junction Box',
    category: 'control',
    gridSize: { w: 3, h: 3 },
    render: () => path5('M0 0 h24 v24 h-24 Z') + text5(12, 15, 'JB'),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'signal' },
      { id: 'e', x: 24, y: 12, kind: 'signal' },
      { id: 's', x: 12, y: 24, kind: 'signal' },
    ],
    tagRule: 'none',
    keywords: ['junction box', 'jb', 'wiring'],
  },
  {
    id: 'ctl.panel',
    name: 'Local Panel',
    category: 'control',
    gridSize: { w: 5, h: 3 },
    render: () => path5('M0 0 h40 v24 h-40 Z') + text5(20, 15, 'LP'),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'signal' },
      { id: 'e', x: 40, y: 12, kind: 'signal' },
    ],
    tagRule: 'none',
    keywords: ['local panel', 'lp', 'control panel'],
  },
]
