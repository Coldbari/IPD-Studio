import { describe, expect, it } from 'vitest'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { makeRng } from '../../src/hmi/sim/noise'
import type { HmiScreen } from '../../src/hmi/model'

// source -> P-101 -> LV-101 -> TK-101 -> HV-101 -> sink, LT-101 bound to the tank, LIC-101 controller
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { capacity: 100, level0: 30 } },
    { id: 'h', type: 'valve', x: 650, y: 150, w: 48, h: 32, tag: 'HV-101' },
    { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-101' } },
    { id: 'lic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'LIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
    { id: 'e4', points: [{ x: 590, y: 160 }, { x: 660, y: 166 }] },
    { id: 'e5', points: [{ x: 692, y: 166 }, { x: 800, y: 166 }] },
  ],
}

/**
  * Horizons are in PROCESS SECONDS and they are long, because the physics is
  * now dimensional: a 100 m³ vessel on a 50 m³/h pump moves about 0.014 %/s, so
  * a level loop settles over process-hours rather than the process-seconds the
  * old dimensionless model implied. `tick` sub-steps anything over a second,
  * so a 2 s step integrates exactly as 0.2 s did and simply takes fewer calls.
  */
const runFor = (seconds: number, mut?: (t: ReturnType<typeof initTags>) => void) => {
  const model = buildSimModel(screen)
  let tags = initTags(model)
  tags['P-101']!.RUN = 1
  tags['HV-101']!.OPEN = 1 // operator lines up the drain (calm start ships it closed)
  if (mut) mut(tags)
  const rng = makeRng(2)
  const dt = 2
  for (let i = 0; i < Math.round(seconds / dt); i++) tags = tick(model, tags, dt, rng).tags
  return { tags, model }
}

describe('auto-wired control loops', () => {
  it('wires LIC-101 to LT-101 (PV) and LV-101 (OP)', () => {
    const { model } = runFor(1)
    expect(model.controllers).toEqual([
      { tag: 'LIC-101', pvTag: 'LT-101', outTag: 'LV-101', outKind: 'valve', action: 1 },
    ])
  })
  it('holds level at SP against a constant drain (AUTO)', () => {
    // 100 m³ from 30 % to 50 % is 20 m³; at a net 30 m³/h that is ~40 minutes
    // of filling before the loop even reaches setpoint.
    const { tags } = runFor(3 * 3600)
    expect(Math.abs(tags['TK-101']!.PV! - 50)).toBeLessThan(4)
  })
  it('tracks an SP change', () => {
    const { tags } = runFor(5 * 3600, (t) => { t['LIC-101']!.SP = 70 })
    expect(Math.abs(tags['TK-101']!.PV! - 70)).toBeLessThan(5)
  })
  it('outlet-valve level loops are direct-acting: drain modulates to hold level against inflow', () => {
    // source -> P-201 -> FV-201 (fixed 30%) -> TK-201 -> LV-201 -> sink
    // LIC-201 controls the OUTLET, so its action must invert (level low -> close drain)
    const outlet: HmiScreen = {
      id: 'o', name: 'O', theme: 'classic',
      widgets: [
        { id: 'p', type: 'pump', x: 0, y: 130, w: 56, h: 56, tag: 'P-201' },
        { id: 'fv', type: 'valve', x: 150, y: 140, w: 48, h: 32, tag: 'FV-201', props: { throttle: true } },
        { id: 't', type: 'tank', x: 300, y: 40, w: 96, h: 128, tag: 'TK-201', props: { capacity: 100, level0: 30 } },
        { id: 'v', type: 'valve', x: 500, y: 150, w: 48, h: 32, tag: 'LV-201', props: { throttle: true } },
        { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-201', props: { bindTank: 'TK-201' } },
        { id: 'lic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'LIC-201', props: { controller: true } },
      ],
      pipes: [
        { id: 'i0', points: [{ x: -40, y: 158 }, { x: 10, y: 158 }] },
        { id: 'i1', points: [{ x: 60, y: 158 }, { x: 160, y: 156 }] },
        { id: 'i2', points: [{ x: 200, y: 156 }, { x: 310, y: 100 }] },
        { id: 'a', points: [{ x: 360, y: 160 }, { x: 510, y: 166 }] },
        { id: 'b', points: [{ x: 540, y: 166 }, { x: 700, y: 300 }] },
      ],
    }
    const model = buildSimModel(outlet)
    const lic = model.controllers.find((c) => c.tag === 'LIC-201')!
    expect(lic.action).toBe(-1)
    let tags = initTags(model)
    tags['P-201']!.RUN = 1
    tags['FV-201']!.OP = 30   // fixed 3 u/s inflow < max 4 u/s gravity drain
    const rng = makeRng(4)
    for (let i = 0; i < Math.round((4 * 3600) / 2); i++) tags = tick(model, tags, 2, rng).tags
    expect(Math.abs(tags['TK-201']!.PV! - 50)).toBeLessThan(4)
  })
  it('MAN mode passes operator OP through to the valve', () => {
    const { tags } = runFor(2, (t) => { t['LIC-101']!.MODE = 0; t['LIC-101']!.OP = 77 })
    expect(tags['LV-101']!.OP).toBe(77)
  })
})
