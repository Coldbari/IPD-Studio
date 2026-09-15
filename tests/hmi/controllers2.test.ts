import { describe, expect, it } from 'vitest'
import type { HmiScreen } from '../../src/hmi/model'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { makeRng } from '../../src/hmi/sim/noise'

// LIC-1 pairs with LT-1 (tank, the PV) and LV-1 (valve, the output) by
// family+loop. No pipes: the loop still runs, PV just stays at level0.
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'LT-1', props: { level0: 40 } },
    { id: 'v', type: 'valve', x: 200, y: 0, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 'c', type: 'display', x: 400, y: 0, w: 96, h: 40, tag: 'LIC-1', props: { controller: true } },
  ],
  pipes: [],
}

describe('bumpless MAN → AUTO transfer', () => {
  it('AUTO resumes from the operator OP instead of kicking to the stale integrator', () => {
    const model = buildSimModel(screen)
    const rng = makeRng(1)
    let tags = initTags(model)
    // Long AUTO stretch with PV stuck below SP: the output winds to its rail.
    // It takes process-minutes now rather than process-seconds — a level loop's
    // integral time is 600 s, which is the point of retuning it for real units.
    for (let i = 0; i < 900; i++) tags = tick(model, tags, 1, rng).tags
    expect(tags['LIC-1']!.OP).toBe(100)

    // operator takes MANUAL and strokes the output down to 20
    tags['LIC-1'] = { ...tags['LIC-1']!, MODE: 0, OP: 20 }
    for (let i = 0; i < 5; i++) tags = tick(model, tags, 0.2, rng).tags
    expect(tags['LV-1']!.OP).toBe(20)  // MAN passes the operator's output straight through

    // back to AUTO: the very next tick must hold ~the operator's OP
    tags['LIC-1'] = { ...tags['LIC-1']!, MODE: 1 }
    tags = tick(model, tags, 0.2, rng).tags
    expect(tags['LIC-1']!.OP).toBeGreaterThan(15)
    expect(tags['LIC-1']!.OP).toBeLessThan(25)
  })
})
