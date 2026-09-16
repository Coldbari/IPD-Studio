// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP B — real engineering units.
 *
 * The audit found flow dimensionless while the importer labelled it m³/h, and
 * a tank's capacity taken from its widget's pixel area divided by forty. These
 * tests pin the conversion, the source of capacity, and the rule that the
 * training-speed multiplier moves the clock and nothing else.
 */

import { describe, expect, it } from 'vitest'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { buildTagDefs } from '../../src/hmi/sim/tags'
import { makeRng } from '../../src/hmi/sim/noise'
import { SHUT_LEAK_MAX } from '../../src/hmi/sim/hydraulic/solver'
import { DEFAULTS, SECONDS_PER_HOUR, UNITS, clockText, volumeMoved } from '../../src/hmi/sim/units'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

/** source -> P-1 -> HV-1 (throttling) -> TK-1 */
const plant = (tank: Partial<HmiWidget['props']> = {}, w = 96, h = 128): HmiScreen => ({
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w, h, tag: 'TK-1', props: { level0: 0, ...tank } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
})

const runPlant = (screen: HmiScreen, seconds: number, dt: number, registry?: Registry) => {
  const model = buildSimModel(screen, registry)
  let tags = initTags(model)
  tags['P-1']!.RUN = 1
  tags['P-1']!.RAMP = 1 // at rated duty from the first step, so the maths is exact
  tags['HV-1']!.OP = 100
  tags['HV-1']!.POS = 100
  const rng = makeRng(1)
  let out = { tags, branchFlows: {} as Record<string, number> }
  for (let i = 0; i < Math.round(seconds / dt); i++) out = tick(model, out.tags, dt, rng)
  return out
}

describe('the conversion the audit was about', () => {
  it('m³ = m³/h × s / 3600', () => {
    expect(volumeMoved(50, SECONDS_PER_HOUR)).toBeCloseTo(50)
    expect(volumeMoved(50, 3600 / 2)).toBeCloseTo(25)
    expect(volumeMoved(36, 100)).toBeCloseTo(1)
    expect(volumeMoved(0, 9999)).toBe(0)
  })

  it('the declared internal units are the ones the model actually uses', () => {
    expect(UNITS).toMatchObject({ flow: 'm³/h', volume: 'm³', pressure: 'bar', temperature: '°C', time: 's' })
  })
})

describe('tank level is volume over capacity', () => {
  it('a 100 m³ vessel on a 50 m³/h pump fills at 50 %/h, not in thirty seconds', () => {
    const { tags } = runPlant(plant({ capacity: 100 }), SECONDS_PER_HOUR, 10)
    // one hour at 50 m³/h into 100 m³, from empty
    expect(tags['TK-1']!.PV).toBeCloseTo(50, 0)
  })

  it('halving the capacity doubles the rate — level really is volume over capacity', () => {
    const big = runPlant(plant({ capacity: 100 }), 1800, 10).tags['TK-1']!.PV!
    const small = runPlant(plant({ capacity: 50 }), 1800, 10).tags['TK-1']!.PV!
    expect(small).toBeCloseTo(big * 2, 0)
  })

  it('level never leaves 0-100 however long it runs', () => {
    const { tags, branchFlows } = runPlant(plant({ capacity: 10 }), 6 * SECONDS_PER_HOUR, 60)
    // A FULL VESSEL REFUSES INFLOW, and it does so as a constitutive rule on
    // the edges at its nozzles rather than as a clamp on the number afterwards.
    //
    // The old model shut the branch at 99.5 % of capacity, so the level crept
    // up to something just short of the top and the pump went on delivering
    // 50 m³/h into a clamp that quietly deleted it. Now the tank fills to
    // exactly 100 % in twelve minutes — 10 m³ at 50 m³/h — and the flow
    // collapses with it, so nothing is destroyed to keep the level in range.
    expect(tags['TK-1']!.PV).toBeCloseTo(100, 6)
    expect(tags['TK-1']!.PV).toBeLessThanOrEqual(100)
    // Not exact zero: the gate is a steep FINITE conductance, because a hard
    // zero has a zero derivative and traps the solve (see `GATE_LEAK`). What
    // is left is 1.34e-4 m³/h — a seventh of a millilitre an hour, six orders
    // below the 50 m³/h that was arriving a minute earlier.
    for (const f of Object.values(branchFlows)) expect(Math.abs(f)).toBeLessThan(SHUT_LEAK_MAX)
  })

  it('flow is reported in m³/h, at the pump’s rated duty', () => {
    const { branchFlows } = runPlant(plant({ capacity: 1e6 }), 10, 0.2)
    expect(Object.values(branchFlows)[0]).toBeCloseTo(DEFAULTS.pumpFlowM3h)
  })
})

describe('capacity is engineering data, not geometry', () => {
  const capOf = (s: HmiScreen, registry?: Registry) =>
    buildTagDefs([s], registry).find((d) => d.name === 'TK-1')!

  it('the widget’s size has no influence whatsoever', () => {
    // the old model derived capacity from (w x h) / 40 — a 4x area was a 4x tank
    const small = capOf(plant({}, 96, 128))
    const huge = capOf(plant({}, 400, 400))
    expect(small.capacity).toBe(huge.capacity)
    expect(small.capacity).toBe(DEFAULTS.tankVolumeM3)
  })

  it('and resizing it changes nothing about how fast it fills', () => {
    const a = runPlant(plant({}, 96, 128), 1800, 10).tags['TK-1']!.PV!
    const b = runPlant(plant({}, 400, 400), 1800, 10).tags['TK-1']!.PV!
    expect(a).toBe(b)
  })

  it('the engineering record states it, in whatever unit an engineer wrote', () => {
    const reg = (volume: string): Registry => ({ 'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': volume } } })
    expect(capOf(plant({}), reg('250 m³')).capacity).toBe(250)
    expect(capOf(plant({}), reg('250')).capacity).toBe(250)
    expect(capOf(plant({}), reg('5000 L')).capacity).toBeCloseTo(5)
  })

  it('a record beats the legacy widget prop, and both beat the default', () => {
    const reg: Registry = { 'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '300 m3' } } }
    expect(capOf(plant({ capacity: 80 }), reg).capacity).toBe(300)
    expect(capOf(plant({ capacity: 80 })).capacity).toBe(80)
    expect(capOf(plant({})).capacity).toBe(DEFAULTS.tankVolumeM3)
  })

  it('a defaulted capacity is FLAGGED, never silently assumed', () => {
    expect(capOf(plant({})).capacityDefaulted).toBe(true)
    expect(capOf(plant({ capacity: 80 })).capacityDefaulted).toBe(false)
  })
})

describe('training speed moves the clock, not the physics', () => {
  it('the same process time integrates to the same state at every step size', () => {
    // 1x takes 0.2 s steps; 300x hands tick a 60 s step, which it sub-steps
    const fine = runPlant(plant({ capacity: 100 }), 1800, 0.5).tags['TK-1']!.PV!
    const coarse = runPlant(plant({ capacity: 100 }), 1800, 60).tags['TK-1']!.PV!
    expect(coarse).toBeCloseTo(fine, 1)
  })

  it('a valve still takes its real stroke time inside one coarse step', () => {
    // 25 %/s: a 60 s step must not teleport the valve, it must stroke 4 s worth
    const model = buildSimModel(plant({ capacity: 100 }))
    let tags = initTags(model)
    tags['HV-1']!.OP = 100
    tags['HV-1']!.POS = 0
    tags = tick(model, tags, 4, () => 0.5).tags
    expect(tags['HV-1']!.POS).toBeCloseTo(100, 0)
  })

  it('the clock reads h:mm:ss, because a process runs for hours', () => {
    expect(clockText(0)).toBe('0:00:00')
    expect(clockText(65)).toBe('0:01:05')
    expect(clockText(3 * 3600 + 25 * 60 + 9)).toBe('3:25:09')
  })
})
