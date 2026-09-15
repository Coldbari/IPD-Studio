import { describe, expect, it } from 'vitest'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { makeRng } from '../../src/hmi/sim/noise'
import type { HmiScreen } from '../../src/hmi/model'

// source -> pump P-1 -> throttling valve LV-1 -> tank TK-1, plus TK-1 -> on/off valve HV-1 -> sink
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 100, level0: 40 } },
    { id: 'h', type: 'valve', x: 650, y: 150, w: 48, h: 32, tag: 'HV-1' },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
    { id: 'e4', points: [{ x: 590, y: 160 }, { x: 660, y: 166 }] },
    { id: 'e5', points: [{ x: 692, y: 166 }, { x: 800, y: 166 }] },
  ],
}

/** Horizons are PROCESS SECONDS. `tick` sub-steps anything over a second, so
 *  a coarse `dt` integrates identically and just takes fewer calls. */
const run = (mut?: (tags: ReturnType<typeof initTags>) => void, seconds = 10, dt = 0.2) => {
  const model = buildSimModel(screen)
  let tags = initTags(model)
  if (mut) mut(tags)
  let flows: Record<string, number> = {}
  const rng = makeRng(1)
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const r = tick(model, tags, dt, rng)
    tags = r.tags
    flows = r.branchFlows
  }
  return { tags, flows, model }
}

describe('engine tick', () => {
  it('initTags seeds a CALM plant: pumps off, undriven valves shut, drains closed', () => {
    const model = buildSimModel(screen)
    const tags = initTags(model)
    expect(tags['TK-1']!.PV).toBe(40)
    expect(tags['P-1']!.RUN).toBe(0)
    // no controller drives LV-1 here, so it must not leak at 40%
    expect(tags['LV-1']!.OP).toBe(0)
    // HV-1's only branch dead-ends (a drain): starts closed so the tank
    // doesn't silently empty itself at RUN start
    expect(tags['HV-1']!.OPEN).toBe(0)
  })
  it('a calm start moves nothing at all', () => {
    const { tags, flows } = run(undefined, 5)
    expect(Object.values(flows).every((f) => f === 0)).toBe(true)
    expect(tags['TK-1']!.PV).toBe(40)
  })
  it('an unvalved stub off a tank bottom never drains it (no way to stop it)', () => {
    const stubbed: HmiScreen = {
      id: 's3', name: 'S3', theme: 'classic',
      widgets: [{ id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-9', props: { level0: 40 } }],
      pipes: [{ id: 'p', points: [{ x: 48, y: 120 }, { x: 300, y: 300 }] }],
    }
    const model = buildSimModel(stubbed)
    let tags = initTags(model)
    const rng = makeRng(1)
    for (let i = 0; i < 25; i++) tags = tick(model, tags, 0.2, rng).tags
    expect(tags['TK-9']!.PV).toBe(40)
  })
  it('opening the drain valve empties the tank by gravity', () => {
    // 20 m³/h of gravity drain out of a 100 m³ vessel is 20 %/h, so half an
    // hour takes 40 % down to about 30 % — real units, real timescales.
    const { tags, flows } = run((t) => { t['HV-1']!.OPEN = 1 }, 1800, 2)
    expect(Object.values(flows).some((f) => f > 0)).toBe(true)
    expect(tags['TK-1']!.PV).toBeLessThan(40)
  })
  it('running pump with open valves fills the tank; closed HV holds level up', () => {
    // 50 m³/h into 100 m³ is 50 %/h: half an hour takes 40 % past 60 %.
    const { tags } = run((t) => { t['P-1']!.RUN = 1; t['LV-1']!.OP = 100; t['HV-1']!.OPEN = 0 }, 1800, 2)
    expect(tags['TK-1']!.PV).toBeGreaterThan(55)
  })
  it('closed throttling valve blocks the fill branch', () => {
    const { tags } = run((t) => { t['P-1']!.RUN = 1; t['LV-1']!.OP = 0; t['HV-1']!.OPEN = 0 })
    expect(tags['TK-1']!.PV).toBeCloseTo(40, 0)
  })
  it('a supply header feeds through its hand valve; valveless stubs stay passive', () => {
    // screen: source -> on/off valve -> tank (a battery-limit header), plus a
    // bare source -> tank stub with no valve (impulse-like, must stay dead)
    const header: HmiScreen = {
      id: 's2', name: 'S2', theme: 'classic',
      widgets: [
        { id: 'v', type: 'valve', x: 200, y: 95, w: 48, h: 32, tag: 'HV-2' },
        { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-2', props: { capacity: 100, level0: 40 } },
      ],
      pipes: [
        { id: 'a', points: [{ x: 0, y: 111 }, { x: 210, y: 111 }] },
        { id: 'b', points: [{ x: 240, y: 111 }, { x: 510, y: 100 }] },
        { id: 'stub', points: [{ x: 0, y: 60 }, { x: 510, y: 60 }] },
      ],
    }
    const model = buildSimModel(header)
    const rng = makeRng(1)
    // calm start: HV-2 comes up closed, nothing moves
    let tags = initTags(model)
    let flows: Record<string, number> = {}
    for (let i = 0; i < 25; i++) { const r = tick(model, tags, 0.2, rng); tags = r.tags; flows = r.branchFlows }
    expect(Object.values(flows).every((f) => f === 0)).toBe(true)
    expect(tags['TK-2']!.PV).toBe(40)
    // operator opens the hand valve: the header supplies, the tank fills
    tags = initTags(model)
    tags['HV-2']!.OPEN = 1
    for (let i = 0; i < 25; i++) { const r = tick(model, tags, 0.2, rng); tags = r.tags; flows = r.branchFlows }
    expect(Object.values(flows).some((f) => f > 0)).toBe(true)
    expect(tags['TK-2']!.PV).toBeGreaterThan(40)
    // the valveless stub branch never flows even then
    const stubBranch = model.net.branches.find((b) => b.pipeIds.includes('stub'))!
    expect(flows[stubBranch.id]).toBe(0)
  })
  it('tank clamps at 0 and never goes negative', () => {
    const { tags } = run((t) => { t['TK-1']!.PV = 1 }, 60)
    expect(tags['TK-1']!.PV).toBeGreaterThanOrEqual(0)
  })
  it('tick does not mutate its input tags object', () => {
    const model = buildSimModel(screen)
    const tags = initTags(model)
    const snapshot = JSON.parse(JSON.stringify(tags))
    tick(model, tags, 0.2, makeRng(1))
    expect(tags).toEqual(snapshot)
  })
  it('is deterministic for a fixed seed', () => {
    expect(run().tags['TK-1']!.PV).toBe(run().tags['TK-1']!.PV)
  })
})
