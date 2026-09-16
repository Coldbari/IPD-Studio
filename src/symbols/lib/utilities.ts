// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`
const circle = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="${S}"/>`
const text = (x: number, y: number, t: string, size = 8) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

const eq = (
  id: string,
  name: string,
  gw: number,
  gh: number,
  render: SymbolDef['render'],
  ports: SymbolDef['ports'],
  keywords: string[],
  tagRule: SymbolDef['tagRule'] = 'equipment',
): SymbolDef => ({ id, name, category: 'inline', gridSize: { w: gw, h: gh }, render, ports, tagRule, keywords })

const sig = (x: number, y: number, id = 'e'): SymbolDef['ports'][number] => ({ id, x, y, kind: 'signal' })

export const utilities: SymbolDef[] = [
  /**
   * BATTERY LIMIT / TERMINAL — where the drawing stops and a stated condition
   * begins.
   *
   * A standard P&ID object, and the one thing the process model had no way to
   * say: a free pipe end is an open connection to the air and nothing more,
   * because it has no tag and therefore no engineering record. This DOES have
   * one. Tag it, give its record an operating pressure, and the hydraulic
   * model holds that connection at that pressure.
   *
   * ONE process port, because a terminal terminates. It is not a pass-through
   * and it is not a vessel: it has no volume, no level and no inventory. What
   * it has is a pressure.
   *
   * It says nothing about DIRECTION. Whether it supplies or receives is the
   * sign of the solved flow, exactly as for every other boundary.
   */
  eq('bl.terminal', 'Battery Limit / Terminal', 6, 3,
    () => path('M0 4 H28 L44 12 L28 20 H0 Z') + path('M0 0 V24'),
    [{ id: 'w', x: 0, y: 12, kind: 'process' }],
    ['battery limit', 'terminal', 'boundary', 'off-page', 'tie-in', 'header',
     'utility connection', 'feed', 'outlet', 'b/l', 'OSBL']),

  eq('deaerator', 'Deaerator', 10, 6,
    () =>
      path('M16 16 H64 a10 14 0 0 1 0 28 H16 a10 14 0 0 1 0 -28 Z') +
      path('M32 16 V4 h16 v12') + path('M36 8 H44'),
    [{ id: 'n', x: 40, y: 4, kind: 'process' }, { id: 'w', x: 4, y: 32, kind: 'process' }, { id: 's', x: 40, y: 44, kind: 'process' }, { id: 'e', x: 76, y: 32, kind: 'process' }],
    ['deaerator', 'bfw', 'boiler feedwater']),

  eq('chiller', 'Chiller Package', 8, 5,
    () => path('M0 0 h64 v40 h-64 Z') + path('M8 20 l6 -8 l8 16 l8 -16 l8 16 l8 -16 l6 8') + text(32, 36, 'CH'),
    [{ id: 'w', x: 0, y: 20, kind: 'process' }, { id: 'e', x: 64, y: 20, kind: 'process' }, { id: 'n', x: 32, y: 0, kind: 'process' }, { id: 's', x: 32, y: 40, kind: 'process' }],
    ['chiller', 'refrigeration', 'chw']),

  {
    id: 'package-unit',
    name: 'Package Unit',
    category: 'inline',
    gridSize: { w: 12, h: 8 },
    render: () =>
      `<rect x="1" y="1" width="94" height="62" fill="none" stroke="currentColor" stroke-width="${S}" stroke-dasharray="8 4"/>`,
    ports: [
      { id: 'w', x: 0, y: 32, kind: 'both' },
      { id: 'e', x: 96, y: 32, kind: 'both' },
      { id: 'n', x: 48, y: 0, kind: 'both' },
      { id: 's', x: 48, y: 64, kind: 'both' },
    ],
    tagRule: 'equipment',
    keywords: ['package', 'unit', 'skid', 'vendor', 'boundary'],
  },

  eq('boiler', 'Boiler', 8, 7,
    () => path('M0 16 h64 v40 h-64 Z') + circle(32, 16, 12) + path('M26 50 L32 40 L38 50 Z'),
    [{ id: 'w', x: 0, y: 32, kind: 'process' }, { id: 'n', x: 32, y: 4, kind: 'process' }, { id: 's', x: 32, y: 56, kind: 'process' }],
    ['boiler', 'steam', 'generator']),

  eq('stack', 'Stack', 2, 8,
    () => path('M4 64 L6 0 H10 L12 64 Z') + path('M2 64 H14'),
    [{ id: 's', x: 8, y: 64, kind: 'process' }],
    ['stack', 'chimney', 'vent']),

  eq('flare', 'Flare', 3, 9,
    () =>
      path('M10 72 V16 H14 V72 Z') +
      path('M6 16 H18') +
      path('M8 12 Q10 4 12 10 Q14 2 16 10 Q18 6 19 12'),
    [{ id: 's', x: 12, y: 72, kind: 'process' }],
    ['flare', 'tip', 'relief']),

  eq('air-dryer', 'Instrument Air Dryer', 6, 6,
    () => path('M4 8 h12 v40 h-12 Z M32 8 h12 v40 h-12 Z') + path('M16 16 H32 M16 40 H32') + path('M0 28 H4 M44 28 H48'),
    [{ id: 'w', x: 0, y: 28, kind: 'process' }, { id: 'e', x: 48, y: 28, kind: 'process' }],
    ['air dryer', 'desiccant', 'instrument air']),

  eq('filter-sep', 'Filter Separator', 6, 9,
    () =>
      path('M8 16 a16 12 0 0 1 32 0 V56 a16 12 0 0 1 -32 0 Z') +
      path('M8 28 H40 M8 34 H40') +
      path('M18 60 h12 v8 h-12 Z'),
    [{ id: 'w', x: 8, y: 44, kind: 'process' }, { id: 'n', x: 24, y: 4, kind: 'process' }, { id: 's', x: 24, y: 68, kind: 'process' }],
    ['filter separator', 'gas', 'coalescing']),

  eq('elec.mcc', 'MCC', 6, 4,
    () => path('M0 0 h48 v32 h-48 Z') + path('M12 0 V20 M24 0 V20 M36 0 V20') + text(24, 28, 'MCC'),
    [sig(48, 16)],
    ['mcc', 'motor control center', 'electrical'], 'none'),

  eq('elec.ups', 'UPS', 4, 3,
    () => path('M0 0 h32 v24 h-32 Z') + path('M8 8 V16 M6 10 H10 M24 8 V16') + text(16, 21, 'UPS', 7),
    [sig(0, 12, 'w'), sig(32, 12)],
    ['ups', 'battery', 'power'], 'none'),

  eq('elec.barrier', 'IS Barrier', 3, 2,
    () => path('M0 0 h24 v16 h-24 Z') + path('M6 12 l6 -8 l-2 4 l6 -4') + text(18, 13, 'IS', 6),
    [sig(0, 8, 'w'), sig(24, 8)],
    ['barrier', 'intrinsically safe', 'zener'], 'none'),

  eq('elec.transformer', 'Transformer', 4, 3,
    () => circle(12, 12, 9) + circle(20, 12, 9),
    [sig(0, 12, 'w'), sig(32, 12)],
    ['transformer', 'electrical'], 'none'),

  eq('fit.union', 'Union', 2, 2,
    () => path('M0 8 H16') + path('M5 2 V14 M8 0 V16 M11 2 V14'),
    [{ id: 'w', x: 0, y: 8, kind: 'process' }, { id: 'e', x: 16, y: 8, kind: 'process' }],
    ['union', 'joint'], 'none'),

  eq('fit.coupling', 'Quick Coupling', 3, 2,
    () => path('M0 8 H8 M16 8 H24') + path('M8 2 a6 6 0 0 0 0 12 M16 2 a6 6 0 0 1 0 12'),
    [{ id: 'w', x: 0, y: 8, kind: 'process' }, { id: 'e', x: 24, y: 8, kind: 'process' }],
    ['coupling', 'quick connect', 'camlock'], 'none'),

  eq('fit.exhaust-head', 'Exhaust Head', 3, 4,
    () => path('M12 32 V12') + path('M4 12 h16 v-6 h-16 Z') + path('M4 12 L0 18 M20 12 L24 18'),
    [{ id: 's', x: 12, y: 32, kind: 'process' }],
    ['exhaust head', 'vent', 'steam'], 'none'),

  eq('fit.mixing-tee', 'Mixing Tee', 4, 3,
    () => path('M0 16 H32 M16 0 V16') + path('M10 12 L16 16 L10 20 M16 8 L20 12'),
    [{ id: 'w', x: 0, y: 16, kind: 'process' }, { id: 'e', x: 32, y: 16, kind: 'process' }, { id: 'n', x: 16, y: 0, kind: 'process' }],
    ['mixing tee', 'injection'], 'none'),

  eq('fit.hose-station', 'Utility Hose Station', 4, 3,
    () =>
      path('M0 8 L0 24 L12 16 Z M24 8 L24 24 L12 16 Z') +
      path('M24 16 q4 -6 8 0') + text(16, 6, 'HS', 6),
    [{ id: 'w', x: 0, y: 16, kind: 'process' }],
    ['hose station', 'utility'], 'valve'),

  eq('fit.rupture-pin', 'Rupture Pin Valve', 4, 3,
    () => path('M0 8 L0 24 L16 16 Z M32 8 L32 24 L16 16 Z') + path('M16 16 V2 M12 2 H20'),
    [{ id: 'w', x: 0, y: 16, kind: 'process' }, { id: 'e', x: 32, y: 16, kind: 'process' }],
    ['rupture pin', 'relief'], 'valve'),

  eq('fit.trap-float', 'Float Steam Trap', 3, 3,
    () => circle(12, 12, 10) + circle(12, 15, 4) + path('M0 12 H2 M22 12 H24'),
    [{ id: 'w', x: 0, y: 12, kind: 'process' }, { id: 'e', x: 24, y: 12, kind: 'process' }],
    ['steam trap', 'float'], 'none'),

  eq('fit.trap-bucket', 'Inverted Bucket Trap', 3, 3,
    () => circle(12, 12, 10) + path('M8 16 V9 h8 v7') + path('M0 12 H2 M22 12 H24'),
    [{ id: 'w', x: 0, y: 12, kind: 'process' }, { id: 'e', x: 24, y: 12, kind: 'process' }],
    ['steam trap', 'inverted bucket'], 'none'),

  eq('fit.trap-thermo', 'Thermodynamic Trap', 3, 3,
    () => circle(12, 12, 10) + path('M6 10 H18 M6 14 H18') + path('M0 12 H2 M22 12 H24'),
    [{ id: 'w', x: 0, y: 12, kind: 'process' }, { id: 'e', x: 24, y: 12, kind: 'process' }],
    ['steam trap', 'thermodynamic', 'disc'], 'none'),

  eq('sample.cooler', 'Sample Cooler', 4, 3,
    () => path('M0 0 h32 v24 h-32 Z') + path('M6 12 q4 -8 8 0 q4 8 8 0 q2 -4 4 0') + text(16, 22, 'SC', 6),
    [{ id: 'w', x: 0, y: 12, kind: 'process' }, { id: 'e', x: 32, y: 12, kind: 'process' }],
    ['sample cooler', 'sc'], 'none'),

  {
    id: 'ann.matchline',
    name: 'Match Line',
    category: 'annotation',
    gridSize: { w: 1, h: 12 },
    render: () =>
      `<path d="M4 0 V96" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="12 4 3 4"/>` +
      `<text x="-40" y="-4" font-size="8" font-family="sans-serif" fill="currentColor" stroke="none" transform="rotate(90 4 48) translate(4 48)">MATCH LINE</text>`,
    ports: [],
    tagRule: 'none',
    keywords: ['match line', 'boundary'],
  },
  {
    id: 'ann.detail-flag',
    name: 'Detail Flag',
    category: 'annotation',
    gridSize: { w: 3, h: 3 },
    render: () => circle(12, 12, 11) + path('M1 12 H23') + text(12, 10, 'A', 7) + text(12, 21, '01', 7),
    ports: [],
    tagRule: 'none',
    keywords: ['detail', 'callout', 'reference'],
  },
  {
    id: 'ann.holds',
    name: 'HOLD Flag',
    category: 'annotation',
    gridSize: { w: 4, h: 4 },
    render: () =>
      `<polygon points="10,0 22,0 32,10 32,22 22,32 10,32 0,22 0,10" fill="none" stroke="currentColor" stroke-width="${S}"/>` +
      text(16, 19, 'HOLD', 7),
    ports: [],
    tagRule: 'none',
    keywords: ['hold', 'pending', 'markup'],
  },
]
