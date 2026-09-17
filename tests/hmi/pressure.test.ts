// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP E — pressure.
 *
 * The audit's most serious finding: `PT.PV` was a seeded random walk, so a
 * `PIC` could drive its valve for ever while the pressure it was "controlling"
 * never responded. The loop was open and looked closed.
 *
 * These tests refuse to accept a moving number as evidence. Each one asserts
 * the CAUSAL step it is about — the flow changed, therefore the pump rode up
 * its curve, therefore the discharge pressure rose, therefore the transmitter
 * read it — so that a pressure that merely wobbled convincingly would fail.
 */

import { describe, expect, it } from 'vitest'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { tankPressureBar } from '../../src/hmi/sim/process'
import { buildProcessModel } from '../../src/hmi/sim/hydraulic/model'
import { pumpHead, shutoffFromDuty, solveHydraulics } from '../../src/hmi/sim/hydraulic/solver'
import { makeRng } from '../../src/hmi/sim/noise'
import { BOUNDS, DEFAULTS } from '../../src/hmi/sim/units'
import type { HmiScreen } from '../../src/hmi/model'

/**
 * source -> P-101 -> [e2 = discharge] -> PV-101 (throttling) -> [e3] -> TK-101
 * PT-101 reads e2, the discharge header. PIC-101 pairs with both by ISA family.
 */
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'PV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { capacity: 500, level0: 40 } },
    { id: 'pt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'PT-101', props: { bindPipe: 'e2' } },
    { id: 'pic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'PIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
}

const rng = () => 0.5 // no measurement noise: 0.5 - 0.5 = 0
const model = buildSimModel(screen)

const run = (mut: (t: ReturnType<typeof initTags>) => void, seconds: number, dt = 1) => {
  let tags = initTags(model)
  mut(tags)
  let out = { tags, branchFlows: {} as Record<string, number>, pipePressures: {} as Record<string, number> }
  for (let i = 0; i < Math.round(seconds / dt); i++) out = tick(model, out.tags, dt, rng)
  return out
}

/** Pump running, valve at a given opening, held until steady. */
const atOpening = (pct: number) =>
  run((t) => {
    t['P-101']!.RUN = 1
    t['PIC-101']!.MODE = 0 // MANUAL: the operator sets the valve, not the loop
    t['PIC-101']!.OP = pct
  }, 120)

describe('the pump curve', () => {
  /**
   * `duty.head` IS THE HEAD AT THE RATED FLOW, the way a datasheet states it.
   *
   * The curve these two tests used to check read it as the SHUTOFF head, so a
   * 4 bar / 50 m³/h machine delivered 4 bar at no flow and nothing at all at
   * its own duty point — which is not a pump, and is why every setpoint in
   * this file had to move when the hydraulic solver landed. Shutoff is now
   * derived from the duty: `H₀ = duty.head / (1 − 1/1.5²)` = 1.8 × duty.head.
   */
  it('passes THROUGH its duty point, and rises to shutoff at no flow', () => {
    expect(pumpHead(4, 50, 1, 50)).toBeCloseTo(4)              // at rated: the stated head
    expect(pumpHead(4, 50, 1, 0)).toBeCloseTo(shutoffFromDuty(4)) // at no flow: shutoff
    expect(shutoffFromDuty(4)).toBeCloseTo(7.2, 2)
    expect(pumpHead(4, 50, 1, 25)).toBeGreaterThan(4)          // and falls monotonically between
    expect(pumpHead(4, 50, 1, 25)).toBeLessThan(shutoffFromDuty(4))
  })
  it('obeys the affinity laws: head goes as speed squared', () => {
    expect(pumpHead(4, 50, 0.5, 0)).toBeCloseTo(shutoffFromDuty(4) * 0.25)
    expect(pumpHead(4, 50, 0, 0)).toBe(0) // a stopped pump makes no head
  })
})

describe('static head', () => {
  it('a vessel puts its contents on its outlet, in proportion to level', () => {
    expect(tankPressureBar(0)).toBe(0)
    expect(tankPressureBar(100)).toBeCloseTo(DEFAULTS.tankFullHeadBar)
    expect(tankPressureBar(50)).toBeCloseTo(DEFAULTS.tankFullHeadBar / 2)
  })
})

describe('pressure responds to the plant, and the transmitter reads it', () => {
  it('a stopped pump makes no head: discharge sits at suction pressure', () => {
    const { pipePressures, tags } = run((t) => { t['PIC-101']!.MODE = 0; t['PIC-101']!.OP = 100 }, 60)
    expect(pipePressures.e2).toBeCloseTo(DEFAULTS.atmosphericPressureBar)
    expect(tags['PT-101']!.PV).toBeCloseTo(DEFAULTS.atmosphericPressureBar)
  })

  it('starting the pump raises the discharge pressure the transmitter reads', () => {
    const stopped = run((t) => { t['PIC-101']!.MODE = 0; t['PIC-101']!.OP = 50 }, 60)
    const running = atOpening(50)
    expect(running.pipePressures.e2).toBeGreaterThan(stopped.pipePressures.e2!)
    expect(running.tags['PT-101']!.PV).toBeCloseTo(running.pipePressures.e2!)
  })

  it('CLOSING the valve raises discharge pressure — because the flow falls and the pump rides up its curve', () => {
    const open = atOpening(100)
    const shut = atOpening(10)
    // the causal chain, asserted step by step rather than assumed
    const flowOpen = Math.max(...Object.values(open.branchFlows))
    const flowShut = Math.max(...Object.values(shut.branchFlows))
    expect(flowShut).toBeLessThan(flowOpen)                     // 1. less flow
    expect(shut.pipePressures.e2!).toBeGreaterThan(open.pipePressures.e2!) // 2. more head
    expect(shut.tags['PT-101']!.PV).toBeCloseTo(shut.pipePressures.e2!)    // 3. PT reads it
  })

  it('and lowers it DOWNSTREAM of the valve at the same time', () => {
    const open = atOpening(100)
    const shut = atOpening(10)
    expect(shut.pipePressures.e3!).toBeLessThan(open.pipePressures.e3!)
  })

  it('pressure is monotonic in valve opening across the whole range', () => {
    const ps = [10, 30, 50, 70, 100].map((v) => atOpening(v).pipePressures.e2!)
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeLessThan(ps[i - 1]!)
  })

  it('suction pressure follows the SOURCE vessel’s level', () => {
    // TK-S gravity-feeds P-S. Through the real solve, on the real topology:
    // the vessel's contents are what the machine has to draw from, so the
    // suction node's pressure IS its static head above the boundary.
    const fed: HmiScreen = {
      id: 'f', name: 'F', theme: 'classic',
      widgets: [
        { id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-S' },
        { id: 'p', type: 'pump', x: 300, y: 90, w: 56, h: 56, tag: 'P-S' },
      ],
      pipes: [
        { id: 'a', points: [{ x: 48, y: 120 }, { x: 296, y: 118 }], aId: 't', aPort: 'bottom', bId: 'p', bPort: 'suction' },
        { id: 'b', points: [{ x: 360, y: 118 }, { x: 600, y: 118 }], aId: 'p', aPort: 'discharge' },
      ],
    }
    const m = buildProcessModel(fed)
    const suction = m.nodes.find((n) => n.id.endsWith(':suction'))!.id
    const at = (lvl: number) => solveHydraulics(m, {
      valveOpen: () => 1, pumpSpeed: () => 0, pumpRated: () => 50,
      pumpHead: () => 4, vesselLevel: () => lvl,
    }).pressure[suction]!
    expect(at(90)).toBeGreaterThan(at(10))
    expect(at(10)).toBeGreaterThan(DEFAULTS.atmosphericPressureBar) // a vessel above it always helps
  })

  it('stays inside its physical bounds however hard it is driven', () => {
    const { pipePressures } = run((t) => {
      t['P-101']!.RUN = 1
      t['PIC-101']!.MODE = 0
      t['PIC-101']!.OP = 0 // dead-headed against a shut valve
    }, 600)
    for (const p of Object.values(pipePressures)) {
      expect(p).toBeGreaterThanOrEqual(BOUNDS.pressureBar.min)
      expect(p).toBeLessThanOrEqual(BOUNDS.pressureBar.max)
    }
  })
})

describe('the pressure loop closes', () => {
  it('is wired, and knows it must CLOSE the valve to raise a discharge pressure', () => {
    expect(model.controllers).toHaveLength(1)
    // `toMatchObject` rather than `toEqual`: K16 added `pvDriver`, the machine
    // this transmitter's reading depends on, and a wiring test should pin the
    // wiring rather than the exact shape of the record that carries it.
    expect(model.controllers[0]).toMatchObject(
      { tag: 'PIC-101', pvTag: 'PT-101', outTag: 'PV-101', outKind: 'valve', action: -1 })
    expect(model.controllers[0]!.pvDriver).toBe('P-101')
  })

  it('holds setpoint, and does not rail the way an open loop does', () => {
    // 6 bar, not the 3 bar this test used before the hydraulic solver landed.
    // Sweeping the valve end to end on THIS plant (P-101: 50 m³/h at 4 bar,
    // into a 1 bar boundary) gives 3.50 bar wide open and 8.20 bar shut, so a
    // 3 bar setpoint was half a bar below anything the machine can produce and
    // the loop had no choice but to sit on its stop. 6 bar is inside the range
    // and lands where the process gain is steepest — about 0.09 bar per % of
    // travel, against 0.03 near either end — so the valve has real authority.
    const sp = 6
    const { tags } = run((t) => { t['P-101']!.RUN = 1; t['PIC-101']!.SP = sp }, 900)
    expect(Math.abs(tags['PT-101']!.PV! - sp)).toBeLessThan(0.3)
    // the defect this whole step exists to fix: a disconnected PV saturates
    expect(tags['PIC-101']!.OP).toBeGreaterThan(0)
    expect(tags['PIC-101']!.OP).toBeLessThan(100)
  })

  it('settles STILL — no limit cycle hiding behind a convenient sample point', () => {
    // A loop whose gain is too high oscillates with a two-tick period. Sampling
    // every hundredth tick sees one phase of that and reads as rock steady,
    // which is exactly how the first tuning of this loop passed its tests.
    const m = buildSimModel(screen)
    let tags = initTags(m)
    tags['P-101']!.RUN = 1
    tags['PIC-101']!.SP = 6 // inside the 3.50-8.20 bar range; see above
    for (let i = 0; i < 900; i++) tags = tick(m, tags, 1, rng).tags
    const tail: number[] = []
    for (let i = 0; i < 20; i++) {
      tags = tick(m, tags, 1, rng).tags
      tail.push(tags['PT-101']!.PV!)
    }
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.02)
  })

  it('rejects a setpoint change by moving the valve the right way', () => {
    // Both setpoints inside the range, and both far enough off the stops that
    // the comparison is between two CONTROLLED states. The old pair was 2 and
    // 4 bar: 2 is below the 3.50 bar floor, so the low case was the valve
    // pinned wide open, and the assertion below held for the wrong reason.
    const low = run((t) => { t['P-101']!.RUN = 1; t['PIC-101']!.SP = 4.5 }, 900)
    const high = run((t) => { t['P-101']!.RUN = 1; t['PIC-101']!.SP = 7 }, 900)
    expect(high.tags['PT-101']!.PV!).toBeGreaterThan(low.tags['PT-101']!.PV!)
    // a higher pressure setpoint needs a TIGHTER valve
    expect(high.tags['PV-101']!.POS!).toBeLessThan(low.tags['PV-101']!.POS!)
  })

  it('recovers from a disturbance: trip the pump, restart it, pressure comes back', () => {
    const model2 = buildSimModel(screen)
    let tags = initTags(model2)
    tags['P-101']!.RUN = 1
    tags['PIC-101']!.SP = 6 // inside the 3.50-8.20 bar range; see above
    const step = (secs: number) => { for (let i = 0; i < secs; i++) tags = tick(model2, tags, 1, rng).tags }
    step(900)
    const settled = tags['PT-101']!.PV!
    expect(Math.abs(settled - 6)).toBeLessThan(0.3)

    tags['P-101']!.FAULT = 1
    step(30)
    expect(tags['PT-101']!.PV!).toBeLessThan(settled) // no pump, no head

    tags['P-101']!.FAULT = 0
    tags['P-101']!.RUN = 1
    step(900)
    expect(Math.abs(tags['PT-101']!.PV! - 6)).toBeLessThan(0.3)
  })
})

describe('measurement noise is only measurement noise', () => {
  it('a PT with the process held still does not wander off on its own', () => {
    const noisy = makeRng(11)
    let tags = initTags(model)
    tags['PIC-101']!.MODE = 0
    tags['PIC-101']!.OP = 60
    // pump stopped: the true pressure is the supply header and cannot change
    const seen: number[] = []
    for (let i = 0; i < 300; i++) {
      tags = tick(model, tags, 1, noisy).tags
      seen.push(tags['PT-101']!.PV!)
    }
    const span = Math.max(...seen) - Math.min(...seen)
    // it jitters about the true value, and never drifts away from it
    expect(span).toBeLessThan(0.2)
    for (const v of seen) expect(Math.abs(v - DEFAULTS.atmosphericPressureBar)).toBeLessThan(0.2)
  })
})
