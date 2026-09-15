import { describe, expect, it } from 'vitest'
import type { HmiScreen } from '../../src/hmi/model'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import type { Tags } from '../../src/hmi/sim/engine'
import { deviceAlarms } from '../../src/hmi/sim/alarms'
import { makeRng } from '../../src/hmi/sim/noise'
import { DEFAULTS } from '../../src/hmi/sim/units'

/** P-1 has no engineering record, so it runs on the stated default duty.
 *  Asserting against THAT rather than a literal keeps these tests about the
 *  ramp shape instead of about one particular pump rating. */
const RATED = DEFAULTS.pumpFlowM3h

// source -> pump -> valve -> tank
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v', type: 'valve', x: 260, y: 100, w: 48, h: 32, tag: 'HV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 1e9, level0: 40 } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 270, y: 116 }] },
    { id: 'e3', points: [{ x: 300, y: 116 }, { x: 510, y: 100 }] },
  ],
}

const model = buildSimModel(screen)
const rng = () => 0.5

const run = (tags: Tags, seconds: number, dt = 0.2) => {
  let out = { tags, branchFlows: {} as Record<string, number> }
  for (let i = 0; i < Math.round(seconds / dt); i++) out = tick(model, out.tags, dt, rng)
  return out
}

describe('pump spin-up', () => {
  it('flow ramps over ~2s instead of stepping', () => {
    let tags = initTags(model)
    tags['P-1']!.RUN = 1
    tags['HV-1']!.OP = 100
    tags['HV-1']!.POS = 100
    const early = run(tags, 0.4)
    const earlyFlow = Object.values(early.branchFlows)[0]!
    expect(earlyFlow).toBeGreaterThan(0)
    expect(earlyFlow).toBeLessThan(RATED / 2) // still spinning up
    const late = run(early.tags, 2.5)
    expect(Object.values(late.branchFlows)[0]).toBeCloseTo(RATED) // at rated duty
  })
})

describe('valve stroke + deviation', () => {
  it('position chases the command at stroke rate', () => {
    let tags = initTags(model)
    tags['HV-1']!.OP = 100 // commanded open from 0
    const t1 = run(tags, 1).tags
    expect(t1['HV-1']!.POS).toBeCloseTo(25, 0)
    const t4 = run(t1, 3.2).tags
    expect(t4['HV-1']!.POS).toBe(100)
  })

  it('a stuck valve stops chasing and raises a DEV alarm after 5s', () => {
    let tags = initTags(model)
    tags['HV-1']!.STUCK = 1
    tags['HV-1']!.OP = 80 // command moves, position cannot
    const t6 = run(tags, 6).tags
    expect(t6['HV-1']!.POS).toBe(0)
    expect(t6['HV-1']!.DEVT).toBeGreaterThan(5)
    const recs = deviceAlarms(model.defs, t6, [], 10)
    expect(recs).toEqual([expect.objectContaining({ id: 'HV-1:DEV', level: 'DEV', phase: 'active', priority: 'medium' })])
    // freed again: it strokes home and the alarm clears
    t6['HV-1']!.STUCK = 0
    const t10 = run(t6, 5).tags
    expect(t10['HV-1']!.POS).toBe(80)
    expect(t10['HV-1']!.DEVT).toBe(0)
    const cleared = deviceAlarms(model.defs, t10, recs, 20)
    expect(cleared[0]!.phase).toBe('cleared')
  })
})

describe('pump trip', () => {
  it('FAULT opens the breaker and kills the flow until reset', () => {
    let tags = initTags(model)
    tags['P-1']!.RUN = 1
    tags['HV-1']!.OP = 100
    tags['HV-1']!.POS = 100
    let out = run(tags, 3)
    expect(Object.values(out.branchFlows)[0]).toBeCloseTo(RATED)
    out.tags['P-1']!.FAULT = 1
    out = run(out.tags, 0.4)
    expect(out.tags['P-1']!.RUN).toBe(0) // breaker opened
    expect(Object.values(out.branchFlows)[0]).toBe(0)
    // restart attempt while faulted stays dead
    out.tags['P-1']!.RUN = 1
    out = run(out.tags, 0.4)
    expect(out.tags['P-1']!.RUN).toBe(0)
    // reset + start works again (and ramps)
    out.tags['P-1']!.FAULT = 0
    out.tags['P-1']!.RUN = 1
    out = run(out.tags, 2.5)
    expect(Object.values(out.branchFlows)[0]).toBeCloseTo(RATED)
  })
})

describe('frozen transmitter', () => {
  it('a FROZEN display stops updating', () => {
    const frozenScreen: HmiScreen = {
      ...screen,
      widgets: [...screen.widgets, { id: 'd', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-1', props: { bindTank: 'TK-1' } }],
    }
    const m2 = buildSimModel(frozenScreen)
    const wob = makeRng(7)
    let tags = initTags(m2)
    for (let i = 0; i < 5; i++) tags = tick(m2, tags, 0.2, wob).tags
    tags['LT-1']!.FROZEN = 1
    const pv = tags['LT-1']!.PV
    for (let i = 0; i < 10; i++) tags = tick(m2, tags, 0.2, wob).tags
    expect(tags['LT-1']!.PV).toBe(pv)
  })
})
