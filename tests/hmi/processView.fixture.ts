// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE K4 PROCESS-VIEW FIXTURE — the plant §20 of the brief describes.
 *
 *   SOURCE A -a1- P-101 -a2-(FT-101)- FV-101 -a3-(PT-101, PG-101)- TEE -a4- TK-A
 *   SOURCE B -b1- HV-102 ------------------------------------------ TEE
 *                                                            TEE -a5- TK-B
 *
 * Everything the brief asks the view to prove is drawn here and nothing else:
 * two independent inputs that must not collapse into one, an inline FT and an
 * inline PT on OPPOSITE sides of a control valve, a gauge, a junction with two
 * feeds and two destinations, two vessels with their own LTs, and LIC-101 closing a level loop on
 * TK-A through LV-101 — the ISA loop number is what pairs them.
 *
 * The P&ID geometry is deliberately AWKWARD — the second source enters from
 * below and to the right of the tee, and TK-B sits above TK-A — so that a view
 * which merely repainted these coordinates would look obviously wrong.
 */

import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

export const plant: HmiScreen = {
  id: 'k4', name: 'Unit 4', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 180, y: 380, w: 56, h: 56, tag: 'P-101' },
    { id: 'fv', type: 'valve', x: 460, y: 392, w: 48, h: 32, tag: 'FV-101', props: { throttle: true } },
    { id: 'hv', type: 'valve', x: 460, y: 700, w: 48, h: 32, tag: 'HV-102', props: { throttle: true } },
    { id: 'tee', type: 'symbol', x: 700, y: 400, w: 16, h: 16, tag: 'T-101', props: { symbolId: 'fit.junction' } },
    { id: 'ta', type: 'tank', x: 900, y: 520, w: 96, h: 128, tag: 'TK-A', props: { level0: 30 } },
    { id: 'tb', type: 'tank', x: 900, y: 180, w: 96, h: 128, tag: 'TK-B', props: { level0: 10 } },
    { id: 'lv', type: 'valve', x: 1120, y: 620, w: 48, h: 32, tag: 'LV-101', props: { throttle: true } },
    // instruments — drawn far from the lines they read, the way a P&ID does
    { id: 'ft', type: 'display', x: 1300, y: 60, w: 96, h: 40, tag: 'FT-101', props: { bindPipe: 'a2' } },
    { id: 'pt', type: 'display', x: 1300, y: 110, w: 96, h: 40, tag: 'PT-101', props: { bindPipe: 'a3' } },
    { id: 'pg', type: 'display', x: 1300, y: 160, w: 96, h: 40, tag: 'PG-101', props: { bindPipe: 'a3' } },
    // on the SUCTION, so a starved machine has an instrument that can say so
    { id: 'pg2', type: 'display', x: 1300, y: 360, w: 96, h: 40, tag: 'PG-102', props: { bindPipe: 'a1' } },
    { id: 'lt1', type: 'display', x: 1300, y: 210, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-A' } },
    { id: 'lt2', type: 'display', x: 1300, y: 260, w: 96, h: 40, tag: 'LT-102', props: { bindTank: 'TK-B' } },
    { id: 'lic', type: 'display', x: 1300, y: 310, w: 96, h: 40, tag: 'LIC-101', props: { controller: true } },
  ],
  pipes: [
    // TWO SERVICES, stated by the drawing on the two inlets. They stay
    // distinct up to T-101 and the stream beyond it reads MIXED.
    { id: 'a1', points: [{ x: 40, y: 408 }, { x: 176, y: 408 }], bId: 'p', bPort: 'suction', fluidId: 'fl-water' },
    { id: 'a2', points: [{ x: 240, y: 408 }, { x: 456, y: 408 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 512, y: 408 }, { x: 696, y: 408 }], aId: 'fv', aPort: 'out', bId: 'tee' },
    { id: 'b1', points: [{ x: 40, y: 716 }, { x: 456, y: 716 }], bId: 'hv', bPort: 'in', fluidId: 'fl-oil' },
    { id: 'b2', points: [{ x: 512, y: 716 }, { x: 708, y: 716 }, { x: 708, y: 420 }], aId: 'hv', aPort: 'out', bId: 'tee' },
    // TK-A is filled through a BOTTOM nozzle and TK-B through a top one, so
    // the two destinations are genuinely different hydraulic loads: what is
    // already in TK-A pushes back on the line filling it, and TK-B's vapour
    // space does not. Without that the two branches would carry identical
    // flows and a view that showed one total on both would pass unnoticed.
    { id: 'a4', points: [{ x: 712, y: 412 }, { x: 896, y: 580 }], aId: 'tee', bId: 'ta', bPort: 'bottom' },
    { id: 'a5', points: [{ x: 708, y: 400 }, { x: 896, y: 240 }], aId: 'tee', bId: 'tb', bPort: 'top' },
    { id: 'c1', points: [{ x: 1000, y: 636 }, { x: 1116, y: 636 }], aId: 'ta', aPort: 'bottom', bId: 'lv', bPort: 'in' },
    { id: 'c2', points: [{ x: 1172, y: 636 }, { x: 1320, y: 636 }], aId: 'lv', aPort: 'out' },
  ],
}

/** Real engineering data, so nothing in the view runs on an assumed number. */
/** The same plant with a machine specified past what its suction can supply.
 *  Used only to reach a cavitating state — the topology is untouched. */
export const starvedRegistry: Registry = {
  'P-101': { key: 'P-101', kind: 'equipment', fields: { 'duty.capacity': '400 m³/h', 'duty.head': '90 m' } },
  'TK-A': { key: 'TK-A', kind: 'equipment', fields: { 'construction.volume': '150 m³' } },
  'TK-B': { key: 'TK-B', kind: 'equipment', fields: { 'construction.volume': '150 m³' } },
}

export const registry: Registry = {
  'P-101': { key: 'P-101', kind: 'equipment', fields: { 'duty.capacity': '40 m³/h', 'duty.head': '35 m' } },
  'TK-A': { key: 'TK-A', kind: 'equipment', fields: { 'construction.volume': '150 m³' } },
  'TK-B': { key: 'TK-B', kind: 'equipment', fields: { 'construction.volume': '150 m³' } },
}
