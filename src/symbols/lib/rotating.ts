// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`
const circle = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${S}"/>`
const text = (x: number, y: number, t: string, size = 10) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

export const rotating: SymbolDef[] = [
  {
    id: 'pump.centrifugal',
    name: 'Centrifugal Pump',
    category: 'rotating',
    gridSize: { w: 6, h: 6 },
    render: () =>
      circle(20, 28, 14) +
      path('M28 16 H44 M28 24 H44 M44 16 V24') +
      path('M0 28 H6'),
    ports: [
      // Named because this definition says so — the id is the word. The other
      // eight pumps in this file use w/e and are left unnamed: nothing in
      // their definitions decides which side draws and which delivers.
      { id: 'suction', x: 0, y: 28, kind: 'process', name: 'Suction' },
      { id: 'discharge', x: 44, y: 20, kind: 'process', name: 'Discharge' },
    ],
    tagRule: 'equipment',
    keywords: ['pump', 'centrifugal'],
  },
  {
    id: 'pump.gear',
    name: 'PD Pump (Gear/Screw)',
    category: 'rotating',
    gridSize: { w: 4, h: 4 },
    render: () => circle(16, 16, 14) + circle(16, 11, 5) + circle(16, 21, 5) + path('M0 16 H2 M30 16 H32'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['pump', 'gear', 'screw', 'positive displacement', 'pd'],
  },
  {
    id: 'pump.diaphragm',
    name: 'Diaphragm/Metering Pump',
    category: 'rotating',
    gridSize: { w: 4, h: 4 },
    render: () => circle(16, 16, 14) + path('M6 16 a10 10 0 0 1 20 0') + path('M16 6 V2') + path('M0 16 H2 M30 16 H32'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['pump', 'diaphragm', 'metering', 'dosing'],
  },
  {
    id: 'ejector',
    name: 'Ejector / Eductor',
    category: 'rotating',
    gridSize: { w: 6, h: 2 },
    render: () => path('M0 4 L20 7 L48 2 M0 12 L20 9 L48 14 M12 0 V6'),
    ports: [
      { id: 'w', x: 0, y: 8, kind: 'process' },
      { id: 'e', x: 48, y: 8, kind: 'process' },
      { id: 'n', x: 12, y: 0, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['ejector', 'eductor', 'jet', 'vacuum'],
  },
  {
    id: 'comp.centrifugal',
    name: 'Compressor',
    category: 'rotating',
    gridSize: { w: 6, h: 4 },
    render: () => path('M4 12 L44 4 L44 28 L4 20 Z'),
    ports: [
      { id: 'w', x: 4, y: 16, kind: 'process' },
      { id: 'e', x: 44, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['compressor', 'centrifugal', 'gas'],
  },
  {
    id: 'blower',
    name: 'Blower / Fan',
    category: 'rotating',
    gridSize: { w: 4, h: 4 },
    render: () =>
      circle(16, 16, 14) +
      path('M16 16 L26 8 M16 16 L26 24 M16 16 L6 16') +
      path('M0 16 H2 M30 16 H32'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['blower', 'fan', 'air'],
  },
  {
    id: 'motor',
    name: 'Motor',
    category: 'rotating',
    gridSize: { w: 4, h: 4 },
    render: () => circle(16, 16, 12) + text(16, 20, 'M'),
    ports: [
      { id: 'n', x: 16, y: 4, kind: 'both' },
      { id: 's', x: 16, y: 28, kind: 'both' },
    ],
    tagRule: 'equipment',
    keywords: ['motor', 'electric', 'driver'],
  },
  {
    id: 'agitator',
    name: 'Agitator / Mixer',
    category: 'rotating',
    gridSize: { w: 4, h: 6 },
    render: () =>
      path('M10 0 h12 v10 h-12 Z') +
      path('M16 10 V40') +
      path('M8 44 L16 36 L24 44'),
    ports: [{ id: 'n', x: 16, y: 0, kind: 'signal' }],
    tagRule: 'equipment',
    keywords: ['agitator', 'mixer', 'stirrer', 'impeller'],
  },
]

export const rotating2: SymbolDef[] = [
  {
    id: 'pump.peristaltic',
    name: 'Peristaltic Pump',
    category: 'rotating',
    gridSize: { w: 4, h: 4 },
    render: () =>
      circle(16, 16, 14) + circle(16, 8, 3) + circle(9, 21, 3) + circle(23, 21, 3) +
      path('M0 16 H2 M30 16 H32'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['pump', 'peristaltic', 'hose', 'dosing'],
  },
  {
    id: 'pump.plunger',
    name: 'Plunger Pump',
    category: 'rotating',
    gridSize: { w: 6, h: 3 },
    render: () => path('M0 4 h32 v16 h-32 Z') + path('M32 12 H40') + circle(42, 12, 6) + path('M0 12 H0'),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'process' },
      { id: 'n', x: 16, y: 4, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['pump', 'plunger', 'piston', 'reciprocating'],
  },
  {
    id: 'pump.submersible',
    name: 'Submersible Pump',
    category: 'rotating',
    gridSize: { w: 3, h: 5 },
    render: () =>
      path('M4 8 a8 6 0 0 1 16 0 V34 a8 6 0 0 1 -16 0 Z') +
      circle(12, 24, 7) + path('M12 0 V4'),
    ports: [
      { id: 'n', x: 12, y: 0, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['pump', 'submersible', 'sump', 'well'],
  },
  {
    id: 'pump.vacuum',
    name: 'Vacuum Pump',
    category: 'rotating',
    gridSize: { w: 4, h: 4 },
    render: () =>
      circle(16, 16, 14) +
      path('M4 16 H12 M9 13 L12 16 L9 19') +
      path('M28 16 H20 M23 13 L20 16 L23 19') +
      path('M0 16 H2 M30 16 H32'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['vacuum', 'pump'],
  },
  {
    id: 'comp.recip',
    name: 'Reciprocating Compressor',
    category: 'rotating',
    gridSize: { w: 6, h: 3 },
    render: () =>
      path('M0 4 h28 v16 h-28 Z') + path('M8 12 H20 M14 8 V16') + path('M28 12 H36') + circle(40, 12, 6),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'process' },
      { id: 'n', x: 12, y: 4, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['compressor', 'reciprocating', 'piston'],
  },
  {
    id: 'comp.screw',
    name: 'Screw Compressor',
    category: 'rotating',
    gridSize: { w: 5, h: 3 },
    render: () => path('M0 0 h40 v24 h-40 Z') + circle(15, 12, 7) + circle(25, 12, 7),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'process' },
      { id: 'e', x: 40, y: 12, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['compressor', 'screw', 'rotary'],
  },
  {
    id: 'turbine.steam',
    name: 'Turbine Driver',
    category: 'rotating',
    gridSize: { w: 6, h: 4 },
    render: () => path('M4 12 L44 4 V28 L4 20 Z'),
    ports: [
      { id: 'w', x: 4, y: 16, kind: 'process' },
      { id: 'e', x: 44, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['turbine', 'steam', 'driver', 'expander'],
  },
  {
    id: 'vfd',
    name: 'VFD',
    category: 'rotating',
    gridSize: { w: 3, h: 3 },
    render: () => path('M0 0 h24 v24 h-24 Z') + text(12, 15, 'VFD', 7),
    ports: [
      { id: 'n', x: 12, y: 0, kind: 'signal' },
      { id: 's', x: 12, y: 24, kind: 'signal' },
    ],
    tagRule: 'isa-instrument',
    keywords: ['vfd', 'drive', 'variable frequency', 'sc'],
  },
]
