// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`
const circle = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${S}"/>`
const text = (x: number, y: number, t: string, size = 7) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

/** 32x16 bowtie shifted down to y8..24 so an actuator fits above the stem. */
const LOW_BOWTIE = 'M0 8 L0 24 L16 16 Z M32 8 L32 24 L16 16 Z'

/** Phase-4: the symbols working P&IDs reach for constantly that the first
 *  three phases skipped — actuated on/off valves, suction/drain hardware,
 *  instrument-air accessories, and utility equipment. */
export const frequentItems: SymbolDef[] = [
  {
    id: 'valve.solenoid',
    name: 'Solenoid Valve (XV)',
    category: 'valves',
    gridSize: { w: 4, h: 3 },
    render: () => path(LOW_BOWTIE) + path('M16 16 V8') + path('M10 0 H22 V8 H10 Z') + text(16, 6.5, 'S'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
      { id: 'sig', x: 16, y: 0, kind: 'signal', name: 'Signal' },
    ],
    tagRule: 'valve',
    keywords: ['valve', 'solenoid', 'xv', 'on-off', 'shutdown', 'esd', 'trip'],
  },
  {
    id: 'valve.mov',
    name: 'Motor-Operated Valve (MOV)',
    category: 'valves',
    gridSize: { w: 4, h: 3 },
    render: () => path(LOW_BOWTIE) + path('M16 16 V10') + circle(16, 5, 5) + text(16, 7.5, 'M'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
      { id: 'sig', x: 16, y: 0, kind: 'signal', name: 'Signal' },
    ],
    tagRule: 'valve',
    keywords: ['valve', 'motor', 'mov', 'motorized', 'electric', 'actuated'],
  },
  {
    id: 'valve.foot',
    name: 'Foot Valve',
    category: 'valves',
    gridSize: { w: 2, h: 3 },
    render: () =>
      path('M8 0 V6') + path('M2 6 H14') + path('M2 6 L14 6 L8 15 Z') +
      path('M1 18 H15 M3 21 H13 M5 24 H11'),
    ports: [{ id: 'n', x: 8, y: 0, kind: 'process' }],
    tagRule: 'valve',
    keywords: ['valve', 'foot', 'suction', 'strainer', 'check', 'pump intake'],
  },
  {
    id: 'valve.ballcheck',
    name: 'Ball Check Valve',
    category: 'valves',
    gridSize: { w: 4, h: 2 },
    render: () =>
      path('M4 2 L28 8 L4 14 Z') + circle(11, 8, 4) + path('M28 0 V16'),
    ports: [
      { id: 'w', x: 0, y: 8, kind: 'process' },
      { id: 'e', x: 32, y: 8, kind: 'process' },
    ],
    tagRule: 'valve',
    keywords: ['valve', 'ball check', 'check', 'non-return', 'nrv'],
  },
  {
    id: 'valve.float',
    name: 'Float Valve',
    category: 'valves',
    gridSize: { w: 4, h: 3 },
    render: () => path(LOW_BOWTIE) + path('M16 16 L26 6') + circle(28, 4, 3.5),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
    ],
    tagRule: 'valve',
    keywords: ['valve', 'float', 'level', 'ballcock', 'tank fill'],
  },
  {
    id: 'acc.afr',
    name: 'Air Filter Regulator',
    category: 'accessories',
    gridSize: { w: 2, h: 3 },
    render: () =>
      path('M2 0 H14 V12 H2 Z') + path('M2 12 L14 0') +
      path('M8 12 V24') + path('M5 16 L11 16 L8 21 Z'),
    ports: [{ id: 's', x: 8, y: 24, kind: 'both' }],
    tagRule: 'isa-instrument',
    keywords: ['afr', 'air set', 'filter regulator', 'instrument air', 'pneumatic', 'supply'],
  },
  {
    id: 'acc.siphon',
    name: 'Gauge Siphon (Pigtail)',
    category: 'accessories',
    gridSize: { w: 2, h: 3 },
    render: () => path('M8 0 V2') + circle(8, 7, 5) + path('M8 12 V24'),
    ports: [
      { id: 'n', x: 8, y: 0, kind: 'process' },
      { id: 's', x: 8, y: 24, kind: 'process' },
    ],
    tagRule: 'none',
    keywords: ['siphon', 'pigtail', 'gauge', 'steam', 'pressure'],
  },
  {
    id: 'fit.pulsation-dampener',
    name: 'Pulsation Dampener',
    category: 'inline',
    gridSize: { w: 3, h: 3 },
    render: () =>
      circle(12, 9, 8) +
      `<path d="M4 9 H20" fill="none" stroke="currentColor" stroke-width="${S}" stroke-dasharray="3 2"/>` +
      path('M12 17 V24'),
    ports: [{ id: 's', x: 12, y: 24, kind: 'process' }],
    tagRule: 'none',
    keywords: ['pulsation', 'dampener', 'damper', 'accumulator', 'dosing', 'reciprocating'],
  },
  {
    id: 'fit.funnel',
    name: 'Drain Funnel (Tundish)',
    category: 'inline',
    gridSize: { w: 2, h: 3 },
    render: () => path('M1 0 L8 10 M15 0 L8 10') + path('M8 10 V24'),
    ports: [{ id: 's', x: 8, y: 24, kind: 'process' }],
    tagRule: 'none',
    keywords: ['funnel', 'tundish', 'open drain', 'drain', 'sample'],
  },
  {
    id: 'fan',
    name: 'Fan (Axial)',
    category: 'rotating',
    gridSize: { w: 4, h: 4 },
    render: () =>
      circle(16, 16, 14) +
      path('M16 16 Q8 8 16 3 Q24 8 16 16 Q8 24 16 29 Q24 24 16 16') +
      `<circle cx="16" cy="16" r="2" fill="currentColor" stroke="none"/>`,
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 32, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['fan', 'axial', 'air', 'ventilation', 'hvac', 'draft'],
  },
  {
    id: 'hx.coil',
    name: 'Heating/Cooling Coil',
    category: 'heat',
    gridSize: { w: 6, h: 2 },
    render: () =>
      path('M0 8 H8') +
      path('M8 8 Q12 -2 16 8 Q20 18 24 8 Q28 -2 32 8 Q36 18 40 8') +
      path('M40 8 H48'),
    ports: [
      { id: 'w', x: 0, y: 8, kind: 'process' },
      { id: 'e', x: 48, y: 8, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['coil', 'heating', 'cooling', 'serpentine', 'tank coil', 'hvac'],
  },
]
