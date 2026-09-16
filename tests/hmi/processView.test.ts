// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K4 — THE PROCESS VIEW IS A PRESENTATION, NOT A SECOND MODEL.
 *
 * The view exists because a P&ID is routed for drafting: long runs to keep a
 * sheet tidy, crossings, instrument bubbles floated out to where they fit.
 * None of that says anything about the order the fluid passes through things,
 * which is the one thing an operator needs.
 *
 * So these tests are about two properties and nothing else:
 *
 *  1. The view says the same thing the canonical topology says — every node
 *     and edge points back at an id in the `ProcessModel`, nothing is invented,
 *     and nothing is dropped. Above all NOTHING IS LOST: not an inline
 *     instrument, not a second input, not a branch.
 *  2. The layout reads as a process — sources on the left, the things the
 *     fluid meets in the order it meets them, destinations on the right.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { buildProcessView, midpointOf } from '../../src/hmi/sim/processView'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { plant, registry } from './processView.fixture'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadDoc } from '../../src/model/migrate'
import { importSheet } from '../../src/hmi/importFromPid'
import type { HmiScreen } from '../../src/hmi/model'

const sim = buildSimModel(plant, registry)
const view = buildProcessView(sim.hydraulic, sim.defs, sim.controllers)
const node = (tag: string) => view.nodes.find((n) => n.tag === tag)
const edgeWithPipe = (pipe: string) => view.edges.find((e) => e.pipeIds.includes(pipe))

// ── It is a projection, not a model ─────────────────────────────────────────

describe('every part of the view points back at the canonical topology', () => {
  it('every view node is made of real ProcessModel nodes, each claimed once', () => {
    const claimed = view.nodes.flatMap((n) => n.nodeIds)
    const known = new Set(sim.hydraulic.nodes.map((n) => n.id))
    for (const id of claimed) expect(known, id).toContain(id)
    // exactly once: a node absorbed by two boxes would be a connection drawn
    // in two places, which is how a diagram starts to disagree with its plant
    expect(new Set(claimed).size).toBe(claimed.length)
    // and ALL of them: a node nothing claimed would be an object the operator
    // cannot see
    expect(new Set(claimed).size).toBe(known.size)
  })

  it('every view edge is a real ProcessModel edge, and every pipe appears exactly once', () => {
    const byId = new Map(sim.hydraulic.edges.map((e) => [e.id, e]))
    for (const e of view.edges) {
      const canonical = byId.get(e.id)
      expect(canonical, e.id).toBeDefined()
      expect(e.pipeIds).toEqual(canonical!.pipeIds)
    }
    const drawn = plant.pipes.map((p) => p.id).sort()
    const shown = view.edges.flatMap((e) => e.pipeIds).sort()
    expect(shown).toEqual(drawn)
  })

  it('every device in the topology becomes exactly one object on the view', () => {
    const devices = sim.hydraulic.edges.filter((e) => e.kind !== 'pipe')
    for (const d of devices) {
      const box = view.nodes.filter((n) => n.edgeId === d.id)
      expect(box, `${d.tag ?? d.id}`).toHaveLength(1)
      expect(box[0]!.tag).toBe(d.tag)
    }
    // a pump is ONE box, not the two pressure nodes the solver sees
    expect(node('P-101')!.nodeIds).toHaveLength(2)
  })

  it('a vessel is ONE object however many nozzles it has', () => {
    const a = node('TK-A')!
    expect(a.kind).toBe('vessel')
    expect(a.nodeIds.sort()).toEqual([...sim.hydraulic.vesselNodes.get('TK-A')!].sort())
    expect(view.nodes.filter((n) => n.tag === 'TK-A')).toHaveLength(1)
  })

  it('a tee is ONE object, not two nodes with a gap between them', () => {
    const tee = node('T-101')!
    expect(tee.kind).toBe('fitting')
    expect(tee.nodeIds).toHaveLength(2) // it absorbed both its port nodes
    // and both feeds and both destinations land on that one object
    expect(edgeWithPipe('a3')!.to).toBe(tee.id)
    expect(edgeWithPipe('b2')!.to).toBe(tee.id)
    expect(edgeWithPipe('a4')!.from).toBe(tee.id)
    expect(edgeWithPipe('a5')!.from).toBe(tee.id)
  })
})

// ── Inline instruments ──────────────────────────────────────────────────────

describe('an inline instrument keeps its place in the run', () => {
  it('FT-101 is ON the pipe between the pump and the control valve', () => {
    const e = edgeWithPipe('a2')!
    expect(e.instruments.map((i) => i.tag)).toEqual(['FT-101'])
    expect(e.from).toBe(node('P-101')!.id)
    expect(e.to).toBe(node('FV-101')!.id)
  })

  it('PT-101 and the gauge are on the run AFTER the valve, not before it', () => {
    const e = edgeWithPipe('a3')!
    expect(e.instruments.map((i) => i.tag).sort()).toEqual(['PG-101', 'PT-101'])
    expect(e.from).toBe(node('FV-101')!.id)
    // the sequence the brief asks for, read off the view:
    // PIPE -> FT -> VALVE -> PT -> PIPE
    expect(edgeWithPipe('a2')!.to).toBe(node('FV-101')!.id)
  })

  it('NOT ONE of them is dropped for being "only a measurement"', () => {
    const placed = new Set([
      ...view.edges.flatMap((e) => e.instruments.map((i) => i.tag)),
      ...view.nodes.flatMap((n) => [...n.instruments.map((i) => i.tag), ...n.controllers]),
    ])
    for (const d of sim.defs) {
      if (d.kind !== 'display' && d.kind !== 'controller') continue
      // a display with no binding has no process location, and the view does
      // not invent one — `sim/quality.ts` already reports it as having no model
      if (d.kind === 'display' && d.bindPipe === undefined && d.bindTank === undefined) continue
      expect(placed, d.name).toContain(d.name)
    }
    expect(placed).toContain('FT-101')
    expect(placed).toContain('PT-101')
    expect(placed).toContain('PG-101')
  })

  it('a level transmitter belongs to its vessel, and a controller to its final element', () => {
    expect(node('TK-A')!.instruments.map((i) => i.tag)).toEqual(['LT-101'])
    expect(node('TK-B')!.instruments.map((i) => i.tag)).toEqual(['LT-102'])
    expect(node('LV-101')!.controllers).toEqual(['LIC-101'])
  })

  it('an inline instrument is drawn ON its line, at a point of it', () => {
    const e = edgeWithPipe('a2')!
    const mid = midpointOf(e.points)
    const xs = e.points.map((p) => p.x)
    const ys = e.points.map((p) => p.y)
    expect(mid.x).toBeGreaterThanOrEqual(Math.min(...xs))
    expect(mid.x).toBeLessThanOrEqual(Math.max(...xs))
    expect(mid.y).toBeGreaterThanOrEqual(Math.min(...ys))
    expect(mid.y).toBeLessThanOrEqual(Math.max(...ys))
  })
})

// ── Multiple inputs and branches ────────────────────────────────────────────

describe('two inputs stay two inputs', () => {
  it('each source keeps its own boundary object and its own line', () => {
    const boundaries = view.nodes.filter((n) => n.kind === 'boundary')
    // two supplies and one destination, each drawn separately
    expect(boundaries.length).toBeGreaterThanOrEqual(3)
    const a = edgeWithPipe('a1')!
    const b = edgeWithPipe('b1')!
    expect(a.from).not.toBe(b.from) // NOT collapsed into one generic input
    expect(a.id).not.toBe(b.id)
  })

  it('the two feeds reach the junction by different routes', () => {
    const tee = node('T-101')!.id
    const viaA = view.edges.filter((e) => e.to === tee && e.pipeIds.includes('a3'))
    const viaB = view.edges.filter((e) => e.to === tee && e.pipeIds.includes('b2'))
    expect(viaA).toHaveLength(1)
    expect(viaB).toHaveLength(1)
    // and the pump is on one of them and not the other
    expect(viaA[0]!.from).toBe(node('FV-101')!.id)
    expect(viaB[0]!.from).toBe(node('HV-102')!.id)
  })

  it('the branch to each vessel is its own edge, with its own pipe', () => {
    expect(edgeWithPipe('a4')!.to).toBe(node('TK-A')!.id)
    expect(edgeWithPipe('a5')!.to).toBe(node('TK-B')!.id)
    expect(edgeWithPipe('a4')!.id).not.toBe(edgeWithPipe('a5')!.id)
  })
})

// ── Layout ──────────────────────────────────────────────────────────────────

describe('the layout reads as a process, not as the drawing', () => {
  it('it is NOT the P&ID geometry', () => {
    // the fixture puts TK-B ABOVE TK-A and brings the second source in from
    // below and to the right. A view that repainted those coordinates would
    // agree with them; this one must not.
    const drawn = new Map(plant.widgets.map((w) => [w.tag, { x: w.x, y: w.y }]))
    let same = 0
    for (const n of view.nodes) {
      if (!n.tag) continue
      const d = drawn.get(n.tag)
      if (d && d.x === n.x && d.y === n.y) same++
    }
    expect(same).toBe(0)
  })

  it('the fluid runs left to right: every object is downstream of what feeds it', () => {
    for (const e of view.edges) {
      const a = view.nodes[view.indexOf.get(e.from)!]!
      const b = view.nodes[view.indexOf.get(e.to)!]!
      expect(b.x, `${e.id}: ${a.tag ?? a.kind} -> ${b.tag ?? b.kind}`).toBeGreaterThan(a.x)
    }
  })

  it('the sequence is the process sequence', () => {
    const x = (t: string) => node(t)!.x
    expect(x('P-101')).toBeLessThan(x('FV-101'))
    expect(x('FV-101')).toBeLessThan(x('T-101'))
    expect(x('T-101')).toBeLessThan(x('TK-A'))
    expect(x('TK-A')).toBeLessThan(x('LV-101'))
    // the junction sits after BOTH its feeders, not beside one of them
    expect(x('T-101')).toBeGreaterThan(x('HV-102'))
  })

  it('the two branches are drawn apart, so a reader can tell them apart', () => {
    expect(Math.abs(node('TK-A')!.y - node('TK-B')!.y)).toBeGreaterThan(40)
    expect(node('P-101')!.y).not.toBe(node('HV-102')!.y)
  })

  it('no two objects overlap', () => {
    for (let i = 0; i < view.nodes.length; i++) {
      for (let j = i + 1; j < view.nodes.length; j++) {
        const a = view.nodes[i]!
        const b = view.nodes[j]!
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart, `${a.tag ?? a.id} overlaps ${b.tag ?? b.id}`).toBe(true)
      }
    }
  })

  it('every object is inside the stated extent', () => {
    for (const n of view.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.x + n.w).toBeLessThanOrEqual(view.width)
      expect(n.y + n.h).toBeLessThanOrEqual(view.height)
    }
  })

  it('every line is routed, and starts and ends on the objects it joins', () => {
    for (const e of view.edges) {
      expect(e.points.length, e.id).toBeGreaterThanOrEqual(2)
      const a = view.nodes[view.indexOf.get(e.from)!]!
      const b = view.nodes[view.indexOf.get(e.to)!]!
      const first = e.points[0]!
      const last = e.points[e.points.length - 1]!
      // touching the box it leaves and the box it enters: no gap for an
      // operator to wonder about
      expect(first.x, e.id).toBeCloseTo(a.x + a.w, 6)
      expect(last.x, e.id).toBeCloseTo(b.x, 6)
      expect(first.y).toBeGreaterThanOrEqual(a.y)
      expect(first.y).toBeLessThanOrEqual(a.y + a.h)
      expect(last.y).toBeGreaterThanOrEqual(b.y)
      expect(last.y).toBeLessThanOrEqual(b.y + b.h)
    }
  })
})

// ── §22 Preservation ────────────────────────────────────────────────────────

describe('building the view changes nothing about the engineering model', () => {
  const census = (screens: HmiScreen[]) => {
    const m = buildProcessModel(screens)
    const s = buildSimModel(screens)
    return {
      widgets: screens.reduce((n, sc) => n + sc.widgets.length, 0),
      tags: new Set(screens.flatMap((sc) => sc.widgets.map((w) => w.tag).filter(Boolean))).size,
      pipes: screens.reduce((n, sc) => n + sc.pipes.length, 0),
      ports: m.nodes.reduce((n, x) => n + x.ports.length, 0),
      nodes: m.nodes.length,
      edges: m.edges.length,
      branches: s.net.branches.length,
      edgeOfPipe: m.edgeOfPipe.size,
      vessels: m.vesselNodes.size,
      equipment: m.equipment.size,
      bindPipe: s.defs.filter((d) => d.bindPipe).map((d) => `${d.name}:${d.bindPipe}`).sort(),
      bindTank: s.defs.filter((d) => d.bindTank).map((d) => `${d.name}:${d.bindTank}`).sort(),
      controllers: s.controllers.map((c) => `${c.tag}->${c.outTag}`).sort(),
      issues: m.issues.length,
    }
  }

  const samples = (): [string, HmiScreen[]][] => {
    const out: [string, HmiScreen[]][] = [['K4 fixture', [plant]]]
    for (const f of ['sample-plant.pnid.json', 'sample-refinery-unit.pnid.json', 'template-hmi-demo.pnid.json']) {
      const doc = loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples', f), 'utf8')))
      const screens = doc.hmiScreens.length > 0 ? doc.hmiScreens : doc.sheets.map((sh) => importSheet(doc, sh.id))
      out.push([f, Array.isArray(screens) ? screens : [screens]])
    }
    return out
  }

  for (const [name, screens] of samples()) {
    it(`${name}: the census before and after are identical`, () => {
      const before = census(screens)
      const s = buildSimModel(screens)
      const v = buildProcessView(s.hydraulic, s.defs, s.controllers)
      const after = census(screens)
      expect(after).toEqual(before)
      // and the view actually described that plant rather than quietly
      // producing nothing
      if (before.nodes > 0) {
        expect(v.nodes.length).toBeGreaterThan(0)
        expect(v.edges.flatMap((e) => e.pipeIds).sort())
          .toEqual(screens.flatMap((sc) => sc.pipes.map((p) => p.id)).sort())
      }
    })
  }

  it('the view holds no engineering data of its own — only ids into the model', () => {
    // Every tag on the view is a tag the canonical model already carries —
    // either as a simulated tag or as a piece of equipment. A fitting like
    // T-101 is the second kind: it is real equipment on the drawing and has no
    // signals of its own, so it has no `TagDef` and correctly should not.
    const signals = new Set(sim.defs.map((d) => d.name))
    const equipment = new Set(sim.hydraulic.equipment.keys())
    for (const n of view.nodes) {
      if (n.tag) expect(signals.has(n.tag) || equipment.has(n.tag), n.tag).toBe(true)
      // an instrument or a controller, though, must be a SIGNAL: it is drawn
      // with a value beside it, and a value needs a def to scale and qualify it
      for (const i of n.instruments) expect(signals, i.tag).toContain(i.tag)
      for (const c of n.controllers) expect(signals, c).toContain(c)
    }
    for (const e of view.edges) for (const i of e.instruments) expect(signals, i.tag).toContain(i.tag)
  })
})
