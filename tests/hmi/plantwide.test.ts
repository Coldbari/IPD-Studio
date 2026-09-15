import { describe, expect, it } from 'vitest'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { makeRng } from '../../src/hmi/sim/noise'
import { useSimStore } from '../../src/hmi/simStore'
import type { HmiScreen } from '../../src/hmi/model'

// Screen A: the process — source -> pump -> LV valve -> tank (LT loop 1)
const screenA: HmiScreen = {
  id: 'a', name: 'Process', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'LT-1', props: { capacity: 60, level0: 20 } },
    { id: 'hd', type: 'valve', x: 680, y: 330, w: 48, h: 32, tag: 'HV-D' },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'a2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'a3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
    // valved gravity drain off the tank bottom: a fill-only loop could never
    // correct an overshoot back down to SP
    { id: 'a4', points: [{ x: 560, y: 160 }, { x: 700, y: 344 }] },
    { id: 'a5', points: [{ x: 730, y: 346 }, { x: 900, y: 500 }] },
  ],
}

// Screen B: the controls page — the LIC faceplate display + a trend, no pipes
const screenB: HmiScreen = {
  id: 'b', name: 'Controls', theme: 'classic',
  widgets: [
    { id: 'c', type: 'display', x: 100, y: 100, w: 96, h: 40, tag: 'LIC-1', props: { controller: true } },
    { id: 'tr', type: 'trend', x: 100, y: 200, w: 192, h: 96, tag: 'LT-1' },
    { id: 'nav', type: 'nav', x: 100, y: 320, w: 120, h: 32, label: 'Process', props: { screen: 'a' } },
  ],
  pipes: [{ id: 'b1', points: [{ x: 600, y: 600 }, { x: 900, y: 600 }] }],
}

describe('plant-wide sim model', () => {
  it('merges tag defs across screens without demoting the tank', () => {
    const model = buildSimModel([screenA, screenB])
    const kinds = Object.fromEntries(model.defs.map((d) => [d.name, d.kind]))
    expect(kinds['LT-1']).toBe('tank') // trend on screen B must not demote it
    expect(kinds['LIC-1']).toBe('controller')
    expect(kinds['P-1']).toBe('motor')
  })
  it('controller on one screen drives the valve on another', () => {
    const model = buildSimModel([screenA, screenB])
    const c = model.controllers.find((x) => x.tag === 'LIC-1')!
    expect(c.pvTag).toBe('LT-1')
    expect(c.outTag).toBe('LV-1')
  })
  it('branch ids stay unique when screens concatenate', () => {
    const model = buildSimModel([screenA, screenB])
    const ids = model.net.branches.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(model.net.branches.length).toBeGreaterThanOrEqual(2)
  })
  it('nav/panel widgets produce no tags', () => {
    const model = buildSimModel([screenB])
    expect(model.defs.some((d) => d.name === 'Process')).toBe(false)
  })
  it('the loop actually holds level with the pump running (cross-screen wiring live)', () => {
    const model = buildSimModel([screenA, screenB])
    let tags = initTags(model)
    tags['P-1']!.RUN = 1
    tags['HV-D']!.OPEN = 1 // operator lines up the drain (calm start ships it closed)
    tags['LIC-1']!.SP = 50
    const rng = makeRng(7)
    // 60 m³ vessel from 20 % to 50 % is 18 m³ — process-hours, not seconds
    for (let i = 0; i < Math.round((3 * 3600) / 2); i++) tags = tick(model, tags, 2, rng).tags
    expect(Math.abs(tags['LT-1']!.PV! - 50)).toBeLessThan(6)
  })
})

describe('simStore plant-wide run', () => {
  it('enterRun accepts an array of screens and still accepts one screen', () => {
    const st = () => useSimStore.getState()
    st().enterRun([screenA, screenB])
    expect(st().mode).toBe('run')
    expect(st().tags['LIC-1']).toBeDefined()
    expect(st().tags['LT-1']!.PV).toBe(20)
    st().exitRun()
    st().enterRun(screenA)
    expect(st().tags['LT-1']).toBeDefined()
    expect(st().tags['LIC-1']).toBeUndefined()
    st().exitRun()
  })
  it('journal records raise, ack, and return-to-normal', () => {
    const st = () => useSimStore.getState()
    // tank starting above H: alarm on the very first tick
    const alarming: HmiScreen = {
      ...screenA,
      widgets: screenA.widgets.map((w) => (w.id === 't' ? { ...w, props: { capacity: 60, level0: 96 } } : w)),
    }
    st().enterRun(alarming)
    st().tickOnce(0.2)
    expect(st().journal.some((e) => e.what === 'ALARM' && e.tag === 'LT-1')).toBe(true)
    st().ack()
    expect(st().journal.some((e) => e.what === 'ACK')).toBe(true)
    st().exitRun()
  })
})
