// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { SymbolDef } from '../types'

const S = 1.5
const path = (d: string, fill = 'none') =>
  `<path d="${d}" fill="${fill}" stroke="currentColor" stroke-width="${S}" stroke-linejoin="round"/>`

export const annotations: SymbolDef[] = [
  {
    id: 'ann.offpage',
    name: 'Off-Page Connector',
    category: 'annotation',
    gridSize: { w: 6, h: 3 },
    render: () => path('M0 0 H36 L48 12 L36 24 H0 Z'),
    ports: [{ id: 'w', x: 0, y: 12, kind: 'both' }],
    tagRule: 'none',
    keywords: ['off-page', 'connector', 'continuation', 'to sheet'],
  },
  {
    id: 'ann.arrow',
    name: 'Flow Arrow',
    category: 'annotation',
    gridSize: { w: 3, h: 2 },
    render: () => path('M0 2 L20 8 L0 14 Z', 'currentColor'),
    ports: [
      { id: 'w', x: 0, y: 8, kind: 'both' },
      { id: 'e', x: 24, y: 8, kind: 'both' },
    ],
    tagRule: 'none',
    keywords: ['arrow', 'flow', 'direction'],
  },
  {
    id: 'ann.text',
    name: 'Text Note',
    category: 'annotation',
    gridSize: { w: 8, h: 2 },
    render: () => '',
    ports: [],
    tagRule: 'none',
    keywords: ['text', 'note', 'label', 'comment'],
  },
  {
    id: 'ann.noteflag',
    name: 'Note Flag',
    category: 'annotation',
    gridSize: { w: 3, h: 3 },
    render: () => `<polygon points="12,0 22,6 22,18 12,24 2,18 2,6" fill="none" stroke="currentColor" stroke-width="${S}"/>`,
    ports: [],
    tagRule: 'none',
    keywords: ['note', 'flag', 'reference'],
  },
  {
    id: 'ann.cloud',
    name: 'Revision Cloud',
    category: 'annotation',
    gridSize: { w: 8, h: 4 },
    render: () =>
      path(
        'M8 24 a8 6 0 1 1 6 -14 a8 6 0 1 1 14 -4 a8 6 0 1 1 14 4 a8 6 0 1 1 6 14 a8 6 0 1 1 -10 6 a8 6 0 1 1 -20 0 a8 6 0 1 1 -10 -6 Z',
      ),
    ports: [],
    tagRule: 'none',
    keywords: ['revision', 'cloud', 'markup', 'change'],
  },
]

const text4 = (x: number, y: number, t: string, size = 8) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`

/**
 * A path drawn at an explicit line weight, for the symbols whose meaning IS
 * the weight — `path` above fixes every stroke at 1.5, which is right for
 * outlines and wrong wherever thin-against-heavy is the thing being said.
 */
const atWidth = (d: string, w: number) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}"/>`

export const annotations2: SymbolDef[] = [
  {
    id: 'ann.insulation',
    name: 'Insulation Mark',
    category: 'annotation',
    gridSize: { w: 3, h: 3 },
    render: () => path('M4 8 a8 8 0 0 1 16 0 M4 14 a8 8 0 0 1 16 0') + text4(12, 23, 'INS'),
    ports: [],
    tagRule: 'none',
    keywords: ['insulation', 'lagging'],
  },
  {
    id: 'ann.slope',
    name: 'Slope Mark',
    category: 'annotation',
    gridSize: { w: 4, h: 2 },
    render: () => path('M0 12 H32 M0 12 L32 4'),
    ports: [],
    tagRule: 'none',
    keywords: ['slope', 'fall', 'gradient'],
  },
  {
    id: 'ann.tiein',
    /**
     * A tie-in is the point where new pipe joins existing pipe, so it is
     * drawn as what it is — the STEP IN LINE WEIGHT at the joint, with a
     * heavy bar on the joint itself. It used to be a triangle flag hanging
     * off the run, which said "something is here" and left the reader to
     * find out what from the tag.
     *
     * The weights are the ones the line classes already use, so the symbol
     * and the lines either side of it read as one convention: 0.75 is
     * `pipe.existing`, 2.5 is `process.major` — thin is what was there,
     * heavy is what is being added. Draw the run in as `pipe.existing` and
     * out as a process class and the step carries straight through the node.
     *
     * Nothing is carried by colour. That matters twice over: the colours in
     * this editor are already spoken for by media/process service, and a
     * tie-in has to survive a black-and-white plot and a red-is-new /
     * black-is-existing markup without either of them being available to it.
     * Weight and geometry are all that is used, so all three read the same.
     *
     * Rotate the node 180 degrees where the existing side is to the east.
     * The run sits on the box centre line so that turn pivots about the pipe
     * — put it anywhere else and flipping which side is new would step the
     * whole line sideways, since a node rotates about its box, not its port.
     */
    name: 'Tie-In Point',
    category: 'annotation',
    gridSize: { w: 4, h: 4 },
    render: () =>
      atWidth('M0 16 H16', 0.75) +
      atWidth('M16 16 H32', 2.5) +
      atWidth('M16 8 V24', 3) +
      text4(16, 6, 'TP'),
    ports: [
      { id: 'w', x: 0, y: 16, kind: 'both', name: 'Existing' },
      { id: 'e', x: 32, y: 16, kind: 'both', name: 'New' },
      // The flag's original single port, kept at the foot of the bar. Port
      // ids are addresses written into every saved document (see
      // symbols/types.ts), so this one keeps its id and its side: a drawing
      // made against the triangle still holds the line it had.
      { id: 's', x: 16, y: 24, kind: 'both' },
    ],
    tagRule: 'none',
    keywords: ['tie-in', 'tp', 'connection point', 'existing', 'new work', 'hot tap'],
  },
  {
    id: 'ann.bl-flag',
    name: 'Battery Limit Flag',
    category: 'annotation',
    gridSize: { w: 3, h: 3 },
    render: () => `<polygon points="12,0 24,12 12,24 0,12" fill="none" stroke="currentColor" stroke-width="1.5"/>` + text4(12, 15, 'BL'),
    ports: [
      { id: 'w', x: 0, y: 12, kind: 'both' },
      { id: 'e', x: 24, y: 12, kind: 'both' },
    ],
    tagRule: 'none',
    keywords: ['battery limit', 'bl', 'boundary'],
  },
  {
    id: 'ann.onpage',
    name: 'On-Page Reference',
    category: 'annotation',
    gridSize: { w: 3, h: 3 },
    render: () => `<circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/>` + path('M1 12 H23'),
    ports: [{ id: 'w', x: 0, y: 12, kind: 'both' }],
    tagRule: 'none',
    keywords: ['on-page', 'reference', 'continuation'],
  },
  {
    id: 'ann.revtriangle',
    name: 'Revision Triangle',
    category: 'annotation',
    gridSize: { w: 3, h: 3 },
    render: () => path('M12 2 L22 20 H2 Z'),
    ports: [],
    tagRule: 'none',
    keywords: ['revision', 'rev', 'triangle', 'delta'],
  },
  {
    id: 'ann.equipstrip',
    name: 'Equipment Title Strip',
    category: 'annotation',
    gridSize: { w: 8, h: 3 },
    render: () => path('M0 0 h64 v24 h-64 Z M0 12 H64'),
    ports: [],
    tagRule: 'equipment',
    keywords: ['equipment', 'title', 'strip', 'header'],
  },
]
