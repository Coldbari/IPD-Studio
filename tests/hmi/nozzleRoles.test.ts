// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K3.3 — A NOZZLE'S PROCESS MEANING COMES FROM THE DRAWING, NOT THE PIXELS.
 *
 * A vessel's bottom nozzle sees the static head of what is in the vessel and
 * its top nozzle sees vapour space. That difference decides whether a line can
 * drain the vessel at all, so it is a process fact and the P&ID is where it is
 * stated. Before this file the stated role was read from a flat table that did
 * not know what kind of equipment the line had landed on, with two results:
 *
 *  1. `aPort: 'top'` on a tank was IGNORED whenever the line was drawn low on
 *     the shell — the geometry won, silently, and a vent became a drain.
 *  2. `aPort: 'outlet'` on a tank returned a role the vessel schema does not
 *     list, so the builder attached the edge to a node nothing ever created.
 *     The line carried ZERO FLOW, no issue was raised, and the solve still
 *     reported `converged`. An ordinary P&ID label disconnected a branch.
 *
 * The fallback is unchanged and still documented: where the drawing states
 * nothing this model can act on — a compass id like `n`, which points at the
 * floor on a vessel rotated 180° — the position decides and the attachment is
 * recorded as `anchored` rather than `declared`.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import type { HmiPipe, HmiScreen } from '../../src/hmi/model'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { PORT_SCHEMA, declaredRole } from '../../src/hmi/sim/hydraulic/ports'
import { solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS } from '../../src/hmi/sim/units'

/** A tank with one line on it, attached wherever the caller says. */
const oneLine = (port: string | undefined, endY: number): HmiScreen => ({
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-1' },
    { id: 'v', type: 'valve', x: 300, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
  ],
  pipes: [
    { id: 'p', points: [{ x: 48, y: endY }, { x: 296, y: 116 }], aId: 't', ...(port ? { aPort: port } : {}), bId: 'v', bPort: 'in' },
    { id: 'q', points: [{ x: 352, y: 116 }, { x: 600, y: 116 }], aId: 'v', aPort: 'out' },
  ],
})

/** Which vessel node the line `p` ends up on, and how that was decided. */
function attachment(screen: HmiScreen) {
  const m = buildProcessModel(screen)
  const edge = m.edges.find((e) => e.id === m.edgeOfPipe.get('p'))!
  const nodeId = [edge.from, edge.to].find((n) => n.includes(':t:'))!
  const node = m.nodes.find((n) => n.id === nodeId)!
  return { role: node.ports[0]!.role, resolution: node.ports[0]!.resolution, liquid: node.liquid === true, model: m }
}

const LOW = 120  // clearly in the lower part of the shell
const HIGH = 20  // clearly in the upper part

// ── The role the drawing states wins ────────────────────────────────────────

describe('an explicit nozzle role is honoured wherever the line is drawn', () => {
  it('an explicit TOP nozzle stays top, even drawn at the bottom of the shell', () => {
    const low = attachment(oneLine('top', LOW))
    expect(low.role).toBe('top')
    expect(low.resolution).toBe('declared')
    expect(low.liquid).toBe(false) // vapour space: no static head on this line
  })

  it('an explicit BOTTOM nozzle stays bottom, even drawn at the top of the shell', () => {
    const high = attachment(oneLine('bottom', HIGH))
    expect(high.role).toBe('bottom')
    expect(high.resolution).toBe('declared')
    expect(high.liquid).toBe(true) // sees the contents
  })

  it('MOVING THE LINE does not move the process role', () => {
    // the whole point, stated as an invariant: sweep the attachment point from
    // the top of the shell to the bottom and the declared role never budges
    for (const y of [0, 20, 40, 64, 70, 90, 120, 128]) {
      expect(attachment(oneLine('top', y)).role, `top @ y=${y}`).toBe('top')
      expect(attachment(oneLine('bottom', y)).role, `bottom @ y=${y}`).toBe('bottom')
    }
  })

  it('a VENT is a top nozzle and a DRAIN is a bottom one', () => {
    // not new roles — this model cannot tell a vent from any other opening, and
    // says so. What it can do is keep the P&ID's word about WHERE they are.
    expect(attachment(oneLine('vent', LOW)).role).toBe('top')
    expect(attachment(oneLine('drain', HIGH)).role).toBe('bottom')
  })
})

// ── Cross-kind roles ────────────────────────────────────────────────────────

describe('a role is only a role if the equipment offers it', () => {
  it('inlet/outlet on a VESSEL resolve to its own nozzles, and the line stays live', () => {
    const out = attachment(oneLine('outlet', HIGH))
    expect(out.role).toBe('bottom')     // a vessel's outlet IS its bottom nozzle
    expect(out.resolution).toBe('declared')
    const inn = attachment(oneLine('inlet', LOW))
    expect(inn.role).toBe('top')        // and its inlet enters above the liquid
    expect(inn.resolution).toBe('declared')
  })

  it('a MACHINE port name on a vessel is refused rather than reinterpreted', () => {
    // `suction` and `discharge` describe a pump. A line landing on a tank
    // carrying one of those is not a statement about the tank, so the model
    // declines to read it as one: the position answers and the drawing is told.
    expect(declaredRole('suction', 'vessel')).toBeUndefined()
    expect(declaredRole('discharge', 'vessel')).toBeUndefined()
    const a = attachment(oneLine('suction', HIGH))
    expect(a.role).toBe('top')            // from the position, not the word
    expect(a.resolution).toBe('anchored') // and recorded as inferred
    expect(buildProcessModel(oneLine('suction', HIGH)).issues
      .some((i) => i.kind === 'stream-to-missing-port')).toBe(true)
    // on a PUMP the same words are exactly right, and still are
    expect(declaredRole('suction', 'pump')).toBe('suction')
    expect(declaredRole('discharge', 'pump')).toBe('discharge')
  })

  it('a GENERIC side name asks the kind which of its ports that is', () => {
    expect(declaredRole('in', 'pump')).toBe('suction')     // used to be 'inlet',
    expect(declaredRole('out', 'pump')).toBe('discharge')  // which a pump has not got
    expect(declaredRole('in', 'valve')).toBe('inlet')
    expect(declaredRole('in', 'vessel')).toBe('top')
    expect(declaredRole('out', 'vessel')).toBe('bottom')
  })

  it('THE REGRESSION: a vessel port name never produces an edge with no node', () => {
    // This is the defect. `outlet` used to return a role the vessel schema does
    // not list, the edge pointed at `…:t:outlet`, and nothing created it.
    for (const port of ['outlet', 'inlet', 'suction', 'discharge', 'top', 'bottom', 'vent', 'drain', 'n', 's', 'nonsense']) {
      const m = buildProcessModel(oneLine(port, LOW))
      const ids = new Set(m.nodes.map((n) => n.id))
      const dangling = m.edges.flatMap((e) => [e.from, e.to]).filter((n) => !ids.has(n))
      expect(dangling, `aPort=${port}`).toEqual([])
      // and the line actually carries something rather than going quietly dead
      const r = solveHydraulics(m, {
        valveOpen: () => 1, pumpSpeed: () => 0,
        pumpRated: () => DEFAULTS.pumpFlowM3h, pumpHead: () => DEFAULTS.pumpHeadBar,
        vesselLevel: () => 60,
      })
      expect(r.converged, `aPort=${port}`).toBe(true)
      // a bottom nozzle drains the vessel; a top one sees vapour and does not
      // A bottom nozzle drains the vessel; a top one sees vapour and does not.
      // `suction`/`discharge`/`n`/`s`/`nonsense` are not roles on a vessel, so
      // the line's position decides — and it is drawn LOW, hence a drain.
      const drains = Math.abs(r.pipeFlow.p ?? 0) > 1
      const onTheTop = ['top', 'vent', 'inlet'].includes(port)
      expect(drains, `aPort=${port} should ${onTheTop ? 'NOT ' : ''}drain`).toBe(!onTheTop)
    }
  })

  it('a VESSEL nozzle name on a valve is refused, reported, and falls back', () => {
    const screen: HmiScreen = {
      id: 's', name: 'S', theme: 'classic',
      widgets: [{ id: 'v', type: 'valve', x: 300, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } }],
      pipes: [{ id: 'p', points: [{ x: 100, y: 116 }, { x: 296, y: 116 }], bId: 'v', bPort: 'bottom' }],
    }
    const m = buildProcessModel(screen)
    // a valve offers inlet/outlet and nothing else, so 'bottom' is not a role
    // here; the position answers instead and the drawing is told so
    expect(declaredRole('bottom', 'valve')).toBeUndefined()
    expect(m.issues.some((i) => i.kind === 'stream-to-missing-port')).toBe(true)
    const ids = new Set(m.nodes.map((n) => n.id))
    expect(m.edges.flatMap((e) => [e.from, e.to]).filter((n) => !ids.has(n))).toEqual([])
  })

  it('every role the table can return is one the kind actually offers', () => {
    // the invariant behind all of the above, checked exhaustively
    const ids = ['in', 'inlet', 'suction', 'out', 'outlet', 'discharge', 'top', 'bottom', 'vent', 'drain', 'n', 's', 'e', 'w', 'tap', 'sig', '']
    for (const kind of Object.keys(PORT_SCHEMA) as (keyof typeof PORT_SCHEMA)[]) {
      for (const id of ids) {
        const role = declaredRole(id, kind)
        if (role === undefined) continue
        expect(PORT_SCHEMA[kind] as readonly string[], `${kind}/${id}`).toContain(role)
      }
    }
  })
})

// ── Backward compatibility ──────────────────────────────────────────────────

describe('drawings that state nothing keep the documented fallback', () => {
  it('no port at all: position decides, and the attachment says it was inferred', () => {
    const low = attachment(oneLine(undefined, LOW))
    expect(low.role).toBe('bottom')
    expect(low.resolution).toBe('anchored') // the OBJECT is certain, the port inferred
    const high = attachment(oneLine(undefined, HIGH))
    expect(high.role).toBe('top')
  })

  it('a COMPASS id is positional, not a role — and is still reported as inferred', () => {
    // `n` on a vessel rotated 180° points at the floor, so a compass id cannot
    // be read as a process role. This is a decision, not an omission.
    expect(declaredRole('n', 'vessel')).toBeUndefined()
    expect(declaredRole('s', 'vessel')).toBeUndefined()
    const low = attachment(oneLine('s', LOW))
    expect(low.role).toBe('bottom')      // from the position, which agrees here
    expect(low.resolution).toBe('anchored')
    const wrong = attachment(oneLine('n', LOW)) // 'n' drawn low: position wins
    expect(wrong.role).toBe('bottom')
  })

  it('MULTIPLE nozzles on one vessel stay distinct', () => {
    const both: HmiScreen = {
      id: 's', name: 'S', theme: 'classic',
      widgets: [
        { id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-1' },
        { id: 'va', type: 'valve', x: 300, y: 20, w: 48, h: 32, tag: 'HV-A', props: { throttle: true } },
        { id: 'vb', type: 'valve', x: 300, y: 200, w: 48, h: 32, tag: 'HV-B', props: { throttle: true } },
      ],
      pipes: [
        // BOTH drawn low on the shell; only the stated role tells them apart
        { id: 'pv', points: [{ x: 48, y: 120 }, { x: 296, y: 36 }], aId: 't', aPort: 'vent', bId: 'va', bPort: 'in' },
        { id: 'pd', points: [{ x: 48, y: 124 }, { x: 296, y: 216 }], aId: 't', aPort: 'drain', bId: 'vb', bPort: 'in' },
        { id: 'qa', points: [{ x: 352, y: 36 }, { x: 600, y: 36 }], aId: 'va', aPort: 'out' },
        { id: 'qb', points: [{ x: 352, y: 216 }, { x: 600, y: 216 }], aId: 'vb', aPort: 'out' },
      ],
    } as HmiScreen & { pipes: HmiPipe[] }
    const m = buildProcessModel(both)
    const nodeOf = (pipe: string) => {
      const e = m.edges.find((x) => x.id === m.edgeOfPipe.get(pipe))!
      return [e.from, e.to].find((n) => n.includes(':t:'))!
    }
    expect(nodeOf('pv')).not.toBe(nodeOf('pd'))
    expect(nodeOf('pv')).toContain(':top')
    expect(nodeOf('pd')).toContain(':bottom')
    // and the vessel still owns exactly its two nozzles
    expect(m.vesselNodes.get('TK-1')).toHaveLength(2)

    // the process consequence: the drain runs, the vent does not
    const r = solveHydraulics(m, {
      valveOpen: () => 1, pumpSpeed: () => 0,
      pumpRated: () => DEFAULTS.pumpFlowM3h, pumpHead: () => DEFAULTS.pumpHeadBar,
      vesselLevel: () => 60,
    })
    expect(Math.abs(r.pipeFlow.pd!)).toBeGreaterThan(1)
    expect(Math.abs(r.pipeFlow.pv!)).toBeLessThan(1e-6)
  })
})
