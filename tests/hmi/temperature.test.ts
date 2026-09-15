// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP E — temperature.
 *
 * Same defect as pressure and the same standard of proof: a `TT` was a random
 * walk, so a `TIC` could modulate a heater for ever without the contents
 * getting any warmer. Every test here asserts the causal step, so a
 * temperature that merely drifted plausibly would fail.
 */

import { describe, expect, it } from 'vitest'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { tankTempRate, LOSS_TAU_S } from '../../src/hmi/sim/process'
import { makeRng } from '../../src/hmi/sim/noise'
import { BOUNDS, DEFAULTS, LIQUID_CP_KJ_PER_M3_K } from '../../src/hmi/sim/units'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

const rng = () => 0.5 // no measurement noise

/**
 * source -> P-101 -> EH-101 (electric heater, in the line) -> TK-101
 * TT-101 reads the vessel; TIC-101 has no valve in its loop, so it must find
 * the heater through the network.
 */
const heated = (extra: HmiWidget[] = []): HmiScreen => ({
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'h', type: 'equip', x: 300, y: 95, w: 48, h: 48, tag: 'EH-101', props: { symbolId: 'heater.electric' } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { capacity: 20, level0: 80 } },
    { id: 'tt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'TT-101', props: { bindTank: 'TK-101' } },
    ...extra,
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 118 }] },
    { id: 'e3', points: [{ x: 340, y: 118 }, { x: 510, y: 100 }] },
  ],
})

const TIC: HmiWidget = { id: 'tic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'TIC-101', props: { controller: true } }

const run = (screen: HmiScreen, mut: (t: ReturnType<typeof initTags>) => void, seconds: number, dt = 5, registry?: Registry) => {
  const model = buildSimModel(screen, registry)
  let tags = initTags(model)
  mut(tags)
  let out = { tags, branchFlows: {} as Record<string, number>, pipePressures: {} as Record<string, number> }
  for (let i = 0; i < Math.round(seconds / dt); i++) out = tick(model, out.tags, dt, rng)
  return { ...out, model }
}

describe('the energy balance', () => {
  const net = {
    branches: [{
      id: 'b', from: { kind: 'source' as const }, to: { kind: 'tank' as const, tag: 'TK' },
      pumps: [], heaters: ['EH'], valves: [], devices: [], pipeIds: ['p1'],
    }],
  }
  const ctx = (over: Partial<Parameters<typeof tankTempRate>[2]> = {}) => ({
    flow: () => 0, tankTemp: () => 20, tankLevel: () => 100, capacity: () => 10,
    heaterDutyKw: () => 0, ...over,
  })

  it('duty into a held volume raises temperature at Q / (V · ρcp)', () => {
    // 100 kW into 10 m³ of water: 100 / (10 × 4186) K/s
    const rate = tankTempRate(net, 'TK', ctx({ heaterDutyKw: () => 100 }))
    expect(rate).toBeCloseTo(100 / (10 * LIQUID_CP_KJ_PER_M3_K), 8)
  })

  it('a colder inlet stream pulls the contents down in proportion to its flow', () => {
    const cold = tankTempRate(net, 'TK', ctx({ tankTemp: () => 60, flow: () => 36 }))
    // 36 m³/h = 0.01 m³/s of 20 °C into 10 m³ at 60 °C
    expect(cold).toBeCloseTo((0.01 * (DEFAULTS.supplyTempC - 60)) / 10 - (60 - 20) / LOSS_TAU_S, 8)
    expect(cold).toBeLessThan(0)
  })

  it('doubling the inflow doubles the mixing term', () => {
    const one = tankTempRate(net, 'TK', ctx({ tankTemp: () => 60, flow: () => 36, heaterDutyKw: () => 0 }))
    const two = tankTempRate(net, 'TK', ctx({ tankTemp: () => 60, flow: () => 72, heaterDutyKw: () => 0 }))
    const loss = (60 - 20) / LOSS_TAU_S
    expect(two + loss).toBeCloseTo(2 * (one + loss), 8)
  })

  it('hot contents lose heat to ambient, and contents AT ambient do not', () => {
    expect(tankTempRate(net, 'TK', ctx({ tankTemp: () => 80 }))).toBeLessThan(0)
    expect(tankTempRate(net, 'TK', ctx({ tankTemp: () => DEFAULTS.ambientC }))).toBeCloseTo(0, 10)
  })

  it('a nearly empty vessel does not blow the rate up', () => {
    const rate = tankTempRate(net, 'TK', ctx({ tankLevel: () => 0, heaterDutyKw: () => 500 }))
    expect(Number.isFinite(rate)).toBe(true)
    expect(rate).toBeLessThan(1) // °C/s — fast, but not a singularity
  })
})

describe('the heater actually heats', () => {
  it('OFF does nothing — the contents just drift towards ambient', () => {
    const { tags } = run(heated(), (t) => { t['TK-101']!.T = 60 }, 3600, 30)
    expect(tags['TK-101']!.T!).toBeLessThan(60)
    expect(tags['TK-101']!.T!).toBeGreaterThan(DEFAULTS.ambientC)
  })

  it('ON raises the temperature, and the transmitter reads it', () => {
    const { tags } = run(heated(), (t) => { t['EH-101']!.RUN = 1; t['EH-101']!.RAMP = 1 }, 1800, 10)
    expect(tags['TK-101']!.T!).toBeGreaterThan(DEFAULTS.ambientC + 5)
    expect(tags['TT-101']!.PV!).toBeCloseTo(tags['TK-101']!.T!, 3)
  })

  it('half the duty gives half the rise — it is a duty, not an animation', () => {
    const full = run(heated(), (t) => { t['EH-101']!.RUN = 1; t['EH-101']!.RAMP = 1; t['EH-101']!.OP = 100 }, 600, 10)
    const half = run(heated(), (t) => { t['EH-101']!.RUN = 1; t['EH-101']!.RAMP = 1; t['EH-101']!.OP = 50 }, 600, 10)
    const riseFull = full.tags['TK-101']!.T! - DEFAULTS.ambientC
    const riseHalf = half.tags['TK-101']!.T! - DEFAULTS.ambientC
    expect(riseHalf).toBeCloseTo(riseFull / 2, 1)
  })

  it('the duty comes from the engineering record when one states it', () => {
    const reg: Registry = { 'EH-101': { key: 'EH-101', kind: 'equipment', fields: { 'duty.power': '1 MW' } } }
    const model = buildSimModel(heated(), reg)
    expect(model.defs.find((d) => d.name === 'EH-101')!.heaterKw).toBe(1000)
    const big = run(heated(), (t) => { t['EH-101']!.RUN = 1; t['EH-101']!.RAMP = 1 }, 600, 10, reg)
    const dflt = run(heated(), (t) => { t['EH-101']!.RUN = 1; t['EH-101']!.RAMP = 1 }, 600, 10)
    expect(big.tags['TK-101']!.T!).toBeGreaterThan(dflt.tags['TK-101']!.T!)
  })

  it('a heater is NOT a pump: dropping one into a line does not make it flow', () => {
    const { model, branchFlows } = run(heated(), (t) => { t['EH-101']!.RUN = 1; t['EH-101']!.RAMP = 1 }, 60, 5)
    const b = model.net.branches[0]!
    expect(b.heaters).toContain('EH-101')
    expect(b.pumps).not.toContain('EH-101')
    expect(Object.values(branchFlows).every((f) => f === 0)).toBe(true)
  })

  it('cold feed cools a hot vessel — mixing works in the live model too', () => {
    const { tags } = run(heated(), (t) => {
      t['TK-101']!.T = 80
      t['P-101']!.RUN = 1
      t['P-101']!.RAMP = 1
    }, 600, 5)
    expect(tags['TK-101']!.T!).toBeLessThan(80)
    expect(tags['TK-101']!.T!).toBeGreaterThan(DEFAULTS.supplyTempC)
  })

  it('temperature stays inside its physical bounds', () => {
    const reg: Registry = { 'EH-101': { key: 'EH-101', kind: 'equipment', fields: { 'duty.power': '50 MW' } } }
    const { tags } = run(heated(), (t) => { t['EH-101']!.RUN = 1; t['EH-101']!.RAMP = 1 }, 7200, 30, reg)
    expect(tags['TK-101']!.T!).toBeLessThanOrEqual(BOUNDS.temperatureC.max)
    expect(tags['TK-101']!.T!).toBeGreaterThanOrEqual(BOUNDS.temperatureC.min)
  })
})

describe('the temperature loop closes', () => {
  it('a TIC with no valve in its loop finds the heater through the network', () => {
    const model = buildSimModel(heated([TIC]))
    expect(model.controllers).toEqual([
      { tag: 'TIC-101', pvTag: 'TT-101', outTag: 'EH-101', outKind: 'heater', action: 1 },
    ])
  })

  it('holds setpoint by modulating duty, without railing', () => {
    const sp = 45
    const { tags } = run(heated([TIC]), (t) => {
      t['EH-101']!.RUN = 1
      t['EH-101']!.RAMP = 1
      t['TIC-101']!.SP = sp
    }, 4 * 3600, 20)
    expect(Math.abs(tags['TT-101']!.PV! - sp)).toBeLessThan(2)
    expect(tags['TIC-101']!.OP!).toBeGreaterThan(0)
    expect(tags['TIC-101']!.OP!).toBeLessThan(100)
  })

  it('a higher setpoint settles hotter and calls for more duty', () => {
    const go = (sp: number) => run(heated([TIC]), (t) => {
      t['EH-101']!.RUN = 1
      t['EH-101']!.RAMP = 1
      t['TIC-101']!.SP = sp
    }, 4 * 3600, 20).tags
    const warm = go(35)
    const hot = go(55)
    expect(hot['TT-101']!.PV!).toBeGreaterThan(warm['TT-101']!.PV!)
    expect(hot['TIC-101']!.OP!).toBeGreaterThan(warm['TIC-101']!.OP!)
  })

  it('a stopped heater delivers nothing however hard the controller asks', () => {
    const { tags } = run(heated([TIC]), (t) => { t['TIC-101']!.SP = 60 }, 3600, 30)
    expect(tags['TIC-101']!.OP!).toBeCloseTo(100, 0) // calling for full duty
    expect(tags['TK-101']!.T!).toBeLessThanOrEqual(DEFAULTS.ambientC) // and getting none
  })
})

describe('measurement noise is only measurement noise', () => {
  it('a TT on a vessel nobody is heating does not wander off on its own', () => {
    const noisy = makeRng(5)
    const model = buildSimModel(heated())
    let tags = initTags(model)
    tags['TK-101']!.T = DEFAULTS.ambientC // exactly at ambient: the true value cannot move
    const seen: number[] = []
    for (let i = 0; i < 300; i++) {
      tags = tick(model, tags, 1, noisy).tags
      seen.push(tags['TT-101']!.PV!)
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(2)
    for (const v of seen) expect(Math.abs(v - DEFAULTS.ambientC)).toBeLessThan(2)
  })
})
