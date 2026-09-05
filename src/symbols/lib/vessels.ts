// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`

/** Vertical capsule x8..40, heads 12 high: body y16..64, apexes y4 / y76. */
const VERTICAL_SHELL = 'M8 16 a16 12 0 0 1 32 0 V64 a16 12 0 0 1 -32 0 Z'

export const vessels: SymbolDef[] = [
  {
    id: 'vessel.vertical',
    name: 'Vertical Vessel',
    category: 'vessels',
    gridSize: { w: 6, h: 10 },
    render: () => path(VERTICAL_SHELL),
    ports: [
      { id: 'n', x: 24, y: 4, kind: 'process' },
      { id: 'n1', x: 12, y: 8, kind: 'process' },
      { id: 'n2', x: 36, y: 8, kind: 'process' },
      { id: 's', x: 24, y: 76, kind: 'process' },
      { id: 's1', x: 36, y: 72, kind: 'process' },
      { id: 'e', x: 40, y: 40, kind: 'process' },
      { id: 'e1', x: 40, y: 24, kind: 'process' },
      { id: 'e2', x: 40, y: 56, kind: 'process' },
      { id: 'w', x: 8, y: 40, kind: 'process' },
      { id: 'w1', x: 8, y: 24, kind: 'process' },
      { id: 'w2', x: 8, y: 56, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['vessel', 'drum', 'vertical', 'separator'],
  },
  {
    id: 'vessel.horizontal',
    name: 'Horizontal Vessel',
    category: 'vessels',
    gridSize: { w: 10, h: 6 },
    render: () => path('M16 8 H64 a12 16 0 0 1 0 32 H16 a12 16 0 0 1 0 -32 Z'),
    ports: [
      { id: 'n', x: 40, y: 8, kind: 'process' },
      { id: 'n1', x: 24, y: 8, kind: 'process' },
      { id: 'n2', x: 56, y: 8, kind: 'process' },
      { id: 's', x: 40, y: 40, kind: 'process' },
      { id: 's1', x: 24, y: 40, kind: 'process' },
      { id: 's2', x: 56, y: 40, kind: 'process' },
      { id: 'w', x: 4, y: 24, kind: 'process' },
      { id: 'e', x: 76, y: 24, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['vessel', 'drum', 'horizontal', 'accumulator'],
  },
  {
    id: 'vessel.tank',
    name: 'Storage Tank',
    category: 'vessels',
    gridSize: { w: 8, h: 7 },
    render: () => path('M0 8 V56 H64 V8 M0 8 L32 0 L64 8'),
    ports: [
      { id: 'n', x: 32, y: 0, kind: 'process' },
      { id: 'n1', x: 16, y: 4, kind: 'process' },
      { id: 'n2', x: 48, y: 4, kind: 'process' },
      { id: 'w', x: 0, y: 32, kind: 'process' },
      { id: 'w1', x: 0, y: 16, kind: 'process' },
      { id: 'w2', x: 0, y: 44, kind: 'process' },
      { id: 'e', x: 64, y: 32, kind: 'process' },
      { id: 'e1', x: 64, y: 16, kind: 'process' },
      { id: 'e2', x: 64, y: 44, kind: 'process' },
      { id: 's', x: 32, y: 56, kind: 'process' },
      { id: 's1', x: 12, y: 56, kind: 'process' },
      { id: 's2', x: 52, y: 56, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['tank', 'storage', 'atmospheric'],
  },
  {
    id: 'vessel.column-tray',
    name: 'Tray Column',
    category: 'vessels',
    gridSize: { w: 5, h: 14 },
    render: () =>
      path('M4 16 a16 12 0 0 1 32 0 V96 a16 12 0 0 1 -32 0 Z') +
      path('M4 36 H36 M4 52 H36 M4 68 H36 M4 84 H36'),
    ports: [
      { id: 'n', x: 20, y: 4, kind: 'process' },
      { id: 's', x: 20, y: 108, kind: 'process' },
      { id: 'e', x: 36, y: 48, kind: 'process' },
      { id: 'e1', x: 36, y: 24, kind: 'process' },
      { id: 'e2', x: 36, y: 72, kind: 'process' },
      { id: 'e3', x: 36, y: 88, kind: 'process' },
      { id: 'w', x: 4, y: 64, kind: 'process' },
      { id: 'w1', x: 4, y: 24, kind: 'process' },
      { id: 'w2', x: 4, y: 40, kind: 'process' },
      { id: 'w3', x: 4, y: 88, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['column', 'tower', 'distillation', 'tray', 'absorber'],
  },
  {
    id: 'vessel.cstr',
    name: 'Jacketed Reactor (CSTR)',
    category: 'vessels',
    gridSize: { w: 6, h: 10 },
    render: () =>
      path(VERTICAL_SHELL) +
      path('M4 28 V56 M44 28 V56') +
      path('M18 0 h12 v6 h-12 Z') +
      path('M24 6 V52') +
      path('M16 52 L24 44 L32 52'),
    ports: [
      { id: 'e', x: 40, y: 24, kind: 'process' },
      { id: 'w', x: 8, y: 56, kind: 'process' },
      { id: 's', x: 24, y: 76, kind: 'process' },
      { id: 'n1', x: 12, y: 8, kind: 'process' },
      { id: 'n2', x: 36, y: 8, kind: 'process' },
      // On the jacket walls the render draws at x=4 and x=44 — which is what
      // makes these jacket connections rather than vessel nozzles. Which one
      // is the service supply and which the return is the drawing's to say.
      { id: 'jn', x: 44, y: 32, kind: 'process', name: 'Jacket connection' },
      { id: 'js', x: 4, y: 52, kind: 'process', name: 'Jacket connection' },
    ],
    tagRule: 'equipment',
    keywords: ['reactor', 'cstr', 'jacketed', 'stirred'],
  },
  {
    id: 'vessel.ko-drum',
    name: 'KO Drum / 2-Phase Separator',
    category: 'vessels',
    gridSize: { w: 6, h: 10 },
    render: () =>
      path(VERTICAL_SHELL) +
      path('M8 24 H40 M8 32 H40') +
      path('M12 32 L16 24 M20 32 L24 24 M28 32 L32 24 M36 32 L40 24'),
    ports: [
      { id: 'w', x: 8, y: 56, kind: 'process' },
      { id: 'w2', x: 8, y: 24, kind: 'process' },
      { id: 'n', x: 24, y: 4, kind: 'process' },
      { id: 'n1', x: 12, y: 8, kind: 'process' },
      { id: 's', x: 24, y: 76, kind: 'process' },
      { id: 'e', x: 40, y: 40, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['knockout', 'ko drum', 'separator', 'demister'],
  },
]

export const vessels2: SymbolDef[] = [
  {
    id: 'vessel.floating-roof',
    name: 'Floating-Roof Tank',
    category: 'vessels',
    gridSize: { w: 8, h: 7 },
    render: () => path('M0 0 V56 H64 V0') + path('M4 20 H60 M4 14 V26 M60 14 V26'),
    ports: [
      { id: 's', x: 32, y: 56, kind: 'process' },
      { id: 's1', x: 12, y: 56, kind: 'process' },
      { id: 's2', x: 52, y: 56, kind: 'process' },
      { id: 'w', x: 0, y: 40, kind: 'process' },
      { id: 'w1', x: 0, y: 16, kind: 'process' },
      { id: 'e', x: 64, y: 40, kind: 'process' },
      { id: 'e1', x: 64, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['tank', 'floating roof', 'storage'],
  },
  {
    id: 'vessel.sphere',
    name: 'Sphere',
    category: 'vessels',
    gridSize: { w: 8, h: 8 },
    render: () =>
      `<circle cx="32" cy="28" r="28" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      path('M14 52 L8 64 M50 52 L56 64'),
    ports: [
      { id: 'n', x: 32, y: 0, kind: 'process' },
      { id: 's', x: 32, y: 56, kind: 'process' },
      { id: 'e', x: 60, y: 28, kind: 'process' },
      { id: 'w', x: 4, y: 28, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['sphere', 'lpg', 'pressure storage'],
  },
  {
    id: 'vessel.bullet',
    name: 'Bullet',
    category: 'vessels',
    gridSize: { w: 10, h: 5 },
    render: () =>
      path('M16 4 H64 a12 12 0 0 1 0 24 H16 a12 12 0 0 1 0 -24 Z') +
      path('M20 28 V40 M60 28 V40'),
    ports: [
      { id: 'n', x: 40, y: 4, kind: 'process' },
      { id: 'n1', x: 24, y: 4, kind: 'process' },
      { id: 'n2', x: 56, y: 4, kind: 'process' },
      { id: 's', x: 40, y: 28, kind: 'process' },
      { id: 's1', x: 24, y: 28, kind: 'process' },
      { id: 'w', x: 4, y: 16, kind: 'process' },
      { id: 'e', x: 76, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['bullet', 'lpg', 'horizontal storage'],
  },
  {
    id: 'vessel.open',
    name: 'Open Tank / Pit',
    category: 'vessels',
    gridSize: { w: 8, h: 5 },
    render: () => path('M0 0 V40 H64 V0'),
    ports: [
      { id: 's', x: 32, y: 40, kind: 'process' },
      { id: 's1', x: 12, y: 40, kind: 'process' },
      { id: 's2', x: 52, y: 40, kind: 'process' },
      { id: 'w', x: 0, y: 24, kind: 'process' },
      { id: 'w1', x: 0, y: 8, kind: 'process' },
      { id: 'e', x: 64, y: 24, kind: 'process' },
      { id: 'e1', x: 64, y: 8, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['open tank', 'pit', 'sump', 'basin'],
  },
  {
    id: 'vessel.silo',
    name: 'Silo / Hopper',
    category: 'vessels',
    gridSize: { w: 6, h: 8 },
    render: () => path('M0 0 h48 v40 L24 64 L0 40 Z'),
    ports: [
      { id: 'n', x: 24, y: 0, kind: 'process' },
      { id: 'n1', x: 8, y: 0, kind: 'process' },
      { id: 'n2', x: 40, y: 0, kind: 'process' },
      { id: 's', x: 24, y: 64, kind: 'process' },
      { id: 'e', x: 48, y: 16, kind: 'process' },
      { id: 'w', x: 0, y: 16, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['silo', 'hopper', 'bin', 'solids'],
  },
  {
    id: 'vessel.column-packed',
    name: 'Packed Column',
    category: 'vessels',
    gridSize: { w: 5, h: 14 },
    render: () =>
      path('M4 16 a16 12 0 0 1 32 0 V96 a16 12 0 0 1 -32 0 Z') +
      path('M4 32 H36 M4 48 H36 M8 36 L14 44 M18 36 L24 44 M28 36 L34 44') +
      path('M4 64 H36 M4 80 H36 M8 68 L14 76 M18 68 L24 76 M28 68 L34 76'),
    ports: [
      { id: 'n', x: 20, y: 4, kind: 'process' },
      { id: 's', x: 20, y: 108, kind: 'process' },
      { id: 'e', x: 36, y: 56, kind: 'process' },
      { id: 'e1', x: 36, y: 24, kind: 'process' },
      { id: 'e2', x: 36, y: 88, kind: 'process' },
      { id: 'w', x: 4, y: 56, kind: 'process' },
      { id: 'w1', x: 4, y: 24, kind: 'process' },
      { id: 'w2', x: 4, y: 88, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['column', 'packed', 'absorber', 'scrubber'],
  },
  {
    id: 'vessel.fixedbed',
    name: 'Fixed-Bed Reactor',
    category: 'vessels',
    gridSize: { w: 6, h: 10 },
    render: () =>
      path(VERTICAL_SHELL) +
      path('M8 32 H40 M8 48 H40 M12 36 L18 44 M22 36 L28 44 M32 36 L38 44'),
    ports: [
      { id: 'n', x: 24, y: 4, kind: 'process' },
      { id: 'n1', x: 12, y: 8, kind: 'process' },
      { id: 'n2', x: 36, y: 8, kind: 'process' },
      { id: 's', x: 24, y: 76, kind: 'process' },
      { id: 'e', x: 40, y: 24, kind: 'process' },
      { id: 'e1', x: 40, y: 56, kind: 'process' },
      { id: 'w', x: 8, y: 24, kind: 'process' },
      { id: 'w1', x: 8, y: 56, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['reactor', 'fixed bed', 'catalyst'],
  },
  {
    id: 'vessel.sep3',
    name: '3-Phase Separator',
    category: 'vessels',
    gridSize: { w: 10, h: 8 },
    render: () =>
      path('M16 8 H64 a12 16 0 0 1 0 32 H16 a12 16 0 0 1 0 -32 Z') +
      path('M56 24 V40') +
      path('M28 40 h12 v10 h-12 Z'),
    ports: [
      { id: 'w', x: 4, y: 24, kind: 'process' },
      { id: 'n', x: 40, y: 8, kind: 'process' },
      { id: 'n1', x: 24, y: 8, kind: 'process' },
      { id: 'n2', x: 56, y: 8, kind: 'process' },
      { id: 's', x: 32, y: 48, kind: 'process' },
      { id: 's1', x: 56, y: 40, kind: 'process' },
      { id: 's2', x: 20, y: 40, kind: 'process' },
      { id: 'e', x: 76, y: 24, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['separator', '3-phase', 'boot', 'weir'],
  },
  {
    id: 'cyclone',
    name: 'Cyclone',
    category: 'vessels',
    gridSize: { w: 5, h: 8 },
    render: () =>
      path('M4 8 h32 v12 L20 56 L4 20 Z') +
      path('M0 0 h12 v8 h-12 Z') +
      path('M20 8 V0'),
    ports: [
      { id: 'w', x: 0, y: 4, kind: 'process' },
      { id: 'n', x: 20, y: 0, kind: 'process' },
      { id: 's', x: 20, y: 56, kind: 'process' },
    ],
    tagRule: 'equipment',
    keywords: ['cyclone', 'dust', 'separator'],
  },
]
