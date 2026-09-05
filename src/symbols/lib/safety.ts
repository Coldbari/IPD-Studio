// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`

export const safetyDevices: SymbolDef[] = [
  {
    id: 'psv',
    name: 'Pressure Safety Valve',
    category: 'safety',
    gridSize: { w: 3, h: 5 },
    // Angle body: bottom inlet triangle, right outlet triangle, spring above the seat.
    render: () =>
      path('M4 40 L20 40 L12 24 Z') +
      path('M24 8 L24 24 L12 24 Z') +
      path('M12 22 l5 -3 l-10 -3 l10 -3 l-10 -3 l5 -3'),
    ports: [
      { id: 'in', x: 12, y: 40, kind: 'process', name: 'Inlet' },
      { id: 'out', x: 24, y: 16, kind: 'process', name: 'Outlet' },
    ],
    tagRule: 'valve',
    keywords: ['psv', 'relief', 'safety', 'prv', 'pressure'],
  },
  {
    id: 'pse',
    name: 'Rupture Disc',
    category: 'safety',
    gridSize: { w: 3, h: 2 },
    render: () => path('M0 12 H24 M8 4 V12 M16 4 V12') + path('M8 8 Q12 2 16 8'),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'process' },
      { id: 'e', x: 24, y: 12, kind: 'process' },
    ],
    tagRule: 'valve',
    keywords: ['rupture', 'disc', 'burst', 'pse'],
  },
  {
    id: 'pcv.self',
    name: 'Self-Acting Regulator',
    category: 'safety',
    gridSize: { w: 4, h: 5 },
    // Globe body with integral diaphragm and downstream sensing tap.
    render: () =>
      path('M6 8 a10 8 0 0 1 20 0 Z') +
      path('M16 8 V24') +
      `<g transform="translate(0 24)">` +
      path('M0 0 L0 16 L16 8 Z M32 0 L32 16 L16 8 Z') +
      `<circle cx="16" cy="8" r="4" fill="currentColor" stroke="none"/>` +
      `</g>` +
      path('M28 32 V12 H22'),
    ports: [
      { id: 'w', x: 0, y: 32, kind: 'process' },
      { id: 'e', x: 32, y: 32, kind: 'process' },
    ],
    tagRule: 'valve',
    keywords: ['regulator', 'pcv', 'self-acting', 'pressure reducing'],
  },
]

const path2 = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`
const text2 = (x: number, y: number, t: string) =>
  `<text x="${x}" y="${y}" font-size="8" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

export const safetyDevices2: SymbolDef[] = [
  {
    id: 'psv.pilot',
    name: 'Pilot-Operated PSV',
    category: 'safety',
    gridSize: { w: 3, h: 5 },
    render: () =>
      path2('M4 40 L20 40 L12 24 Z') +
      path2('M24 8 L24 24 L12 24 Z') +
      path2('M12 22 l5 -3 l-10 -3 l10 -3 l-10 -3 l5 -3') +
      path2('M0 4 h8 v8 h-8 Z') +
      path2('M8 8 H12'),
    ports: [
      { id: 'in', x: 12, y: 40, kind: 'process', name: 'Inlet' },
      { id: 'out', x: 24, y: 16, kind: 'process', name: 'Outlet' },
    ],
    tagRule: 'valve',
    keywords: ['psv', 'pilot', 'relief'],
  },
  {
    id: 'pvsv',
    name: 'Pressure/Vacuum Relief Valve',
    category: 'safety',
    gridSize: { w: 3, h: 5 },
    render: () =>
      path2('M4 40 L20 40 L12 24 Z') +
      path2('M24 8 L24 24 L12 24 Z') +
      path2('M6 20 Q12 12 18 20') +
      text2(12, 10, 'PV'),
    ports: [
      { id: 'in', x: 12, y: 40, kind: 'process', name: 'Inlet' },
      { id: 'out', x: 24, y: 16, kind: 'process', name: 'Outlet' },
    ],
    tagRule: 'valve',
    keywords: ['pvsv', 'vacuum', 'conservation', 'breather valve'],
  },
  {
    id: 'vacuum-breaker',
    name: 'Vacuum Breaker',
    category: 'safety',
    gridSize: { w: 2, h: 4 },
    render: () =>
      path2('M8 32 V18') +
      `<circle cx="8" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      path2('M2 2 H14 M2 2 L8 8 L14 2'),
    ports: [{ id: 's', x: 8, y: 32, kind: 'process' }],
    tagRule: 'valve',
    keywords: ['vacuum', 'breaker'],
  },
  {
    id: 'flame-arrestor',
    name: 'Flame Arrestor',
    category: 'safety',
    gridSize: { w: 4, h: 2 },
    render: () => path2('M0 8 H4 M28 8 H32') + path2('M4 0 h24 v16 h-24 Z') + path2('M10 0 V16 M16 0 V16 M22 0 V16'),
    ports: [
      { id: 'w', x: 0, y: 8, kind: 'process' },
      { id: 'e', x: 32, y: 8, kind: 'process' },
    ],
    tagRule: 'none',
    keywords: ['flame', 'arrestor', 'detonation'],
  },
  {
    id: 'breather',
    name: 'Breather Vent',
    category: 'safety',
    gridSize: { w: 3, h: 3 },
    render: () =>
      path2('M12 24 V14') +
      path2('M2 14 H10 M2 14 L6 8 L10 14') +
      path2('M14 14 H22 M14 8 L18 14 L22 8'),
    ports: [{ id: 's', x: 12, y: 24, kind: 'process' }],
    tagRule: 'none',
    keywords: ['breather', 'vent', 'tank'],
  },
  {
    id: 'bpcv',
    name: 'Back-Pressure Regulator',
    category: 'safety',
    gridSize: { w: 4, h: 5 },
    render: () =>
      path2('M6 8 a10 8 0 0 1 20 0 Z') +
      path2('M16 8 V24') +
      `<g transform="translate(0 24)">` +
      path2('M0 0 L0 16 L16 8 Z M32 0 L32 16 L16 8 Z') +
      `<circle cx="16" cy="8" r="4" fill="currentColor" stroke="none"/>` +
      `</g>` +
      path2('M4 32 V12 H10'),
    ports: [
      { id: 'w', x: 0, y: 32, kind: 'process' },
      { id: 'e', x: 32, y: 32, kind: 'process' },
    ],
    tagRule: 'valve',
    keywords: ['back-pressure', 'regulator', 'bpr'],
  },
  {
    id: 'tcv.self',
    name: 'Self-Acting Temperature Regulator',
    category: 'safety',
    gridSize: { w: 4, h: 5 },
    render: () =>
      path2('M6 8 a10 8 0 0 1 20 0 Z') +
      path2('M16 8 V24') +
      `<g transform="translate(0 24)">` +
      path2('M0 0 L0 16 L16 8 Z M32 0 L32 16 L16 8 Z') +
      `<circle cx="16" cy="8" r="4" fill="currentColor" stroke="none"/>` +
      `</g>` +
      path2('M26 6 q4 4 8 0 q4 -4 6 0') +
      `<circle cx="42" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
    ports: [
      { id: 'w', x: 0, y: 32, kind: 'process' },
      { id: 'e', x: 32, y: 32, kind: 'process' },
    ],
    tagRule: 'valve',
    keywords: ['temperature', 'regulator', 'self-acting', 'tcv'],
  },
]
