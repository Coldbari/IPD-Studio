// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`
const circle = (cx: number, cy: number, r: number, fill = 'none') =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="currentColor" stroke-width="${S}"/>`
const text = (x: number, y: number, t: string, size = 8) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

function inline(
  id: string,
  name: string,
  w: number,
  h: number,
  y: number,
  render: SymbolDef['render'],
  keywords: string[],
  extraPorts: SymbolDef['ports'] = [],
): SymbolDef {
  return {
    id,
    name,
    category: 'flow-elements',
    gridSize: { w: w / 8, h: h / 8 },
    render,
    ports: [
      { id: 'w', x: 0, y, kind: 'process' },
      { id: 'e', x: w, y, kind: 'process' },
      ...extraPorts,
    ],
    tagRule: 'isa-instrument',
    keywords: ['flow', ...keywords],
  }
}

export const flowElements: SymbolDef[] = [
  inline('fe.orifice', 'Orifice Plate', 32, 16, 8,
    () => path('M0 8 H32') + path('M14 0 V16') + path('M18 0 V16'),
    ['orifice', 'dp', 'fe', 'plate'],
    // "Tap" is what the catalogue calls it and all it establishes: a real
    // plate is tapped upstream AND downstream, and this symbol has one port.
    [{ id: 'tap', x: 16, y: 0, kind: 'both', name: 'Tap' }]),

  inline('fe.venturi', 'Venturi Tube', 48, 16, 8,
    () => path('M0 0 L20 5 L48 0 M0 16 L20 11 L48 16'),
    ['venturi', 'dp']),

  inline('fe.magmeter', 'Magnetic Flowmeter', 32, 16, 8,
    () => path('M0 8 H8 M24 8 H32') + circle(16, 8, 8) + text(16, 11, 'M'),
    ['magnetic', 'magmeter', 'electromagnetic']),

  inline('fe.coriolis', 'Coriolis Meter', 32, 24, 4,
    () =>
      path('M0 4 H8 M24 4 H32') +
      path('M8 4 V14 a8 6 0 0 0 16 0 V4') +
      path('M12 4 V13 a4 3 0 0 0 8 0 V4'),
    ['coriolis', 'mass']),

  inline('fe.vortex', 'Vortex Meter', 32, 16, 8,
    () => path('M0 8 H8 M24 8 H32') + circle(16, 8, 8) + path('M12 5 L12 11 L17 8 Z', 'currentColor'),
    ['vortex', 'shedding']),

  inline('fe.turbine', 'Turbine Meter', 32, 16, 8,
    () => path('M0 8 H8 M24 8 H32') + circle(16, 8, 8) + path('M11 3 L21 13 M21 3 L11 13'),
    ['turbine', 'rotor']),

  {
    id: 'fe.rotameter',
    name: 'Rotameter',
    category: 'flow-elements',
    gridSize: { w: 2, h: 4 },
    render: () =>
      path('M4 0 L2 32 M12 0 L14 32 M2 32 H14 M4 0 H12') +
      `<circle cx="8" cy="20" r="3" fill="currentColor" stroke="none"/>`,
    ports: [
      { id: 's', x: 8, y: 32, kind: 'process' },
      { id: 'n', x: 8, y: 0, kind: 'process' },
    ],
    tagRule: 'isa-instrument',
    keywords: ['flow', 'rotameter', 'variable area', 'purge'],
  },

  inline('fe.ro', 'Restriction Orifice', 32, 16, 8,
    () => path('M0 8 H32') + path('M16 0 V16') + text(25, 5, 'RO'),
    ['restriction', 'ro']),
]

export const flowElements2: SymbolDef[] = [
  inline('fe.nozzle', 'Flow Nozzle', 32, 16, 8,
    () => path('M0 8 H32') + path('M14 0 Q18 8 14 16') + path('M14 0 V4 M14 12 V16'),
    ['nozzle', 'dp']),
  inline('fe.pitot', 'Pitot Tube', 32, 16, 8,
    () => path('M0 8 H32') + path('M16 8 V0 H24'),
    ['pitot', 'velocity']),
  inline('fe.avgpitot', 'Averaging Pitot', 32, 16, 8,
    () =>
      path('M0 8 H32') + path('M16 12 V0 H24') +
      `<circle cx="16" cy="4" r="1" fill="currentColor" stroke="none"/>` +
      `<circle cx="16" cy="8" r="1" fill="currentColor" stroke="none"/>` +
      `<circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/>`,
    ['annubar', 'averaging', 'pitot']),
  inline('fe.ultrasonic', 'Ultrasonic Flowmeter', 32, 24, 12,
    () =>
      path('M0 12 H32') +
      path('M4 0 L12 0 L9 6 L1 6 Z') +
      path('M20 18 L28 18 L31 24 L23 24 Z') +
      path('M8 6 L24 18'),
    ['ultrasonic', 'clamp-on', 'transit']),
  inline('fe.thermal', 'Thermal Mass Flowmeter', 32, 16, 8,
    () => path('M0 8 H8 M24 8 H32') + circle(16, 8, 8) + text(16, 11, 'T'),
    ['thermal', 'mass']),
  inline('fe.pd', 'PD Meter', 32, 16, 8,
    () =>
      path('M0 8 H8 M24 8 H32') + circle(16, 8, 8) +
      circle(13, 8, 3) + circle(19, 8, 3),
    ['positive displacement', 'oval gear']),
]
