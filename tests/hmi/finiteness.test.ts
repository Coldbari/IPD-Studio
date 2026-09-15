// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * EVERY PROCESS VALUE IS A NUMBER.
 *
 * Written after the Step J audit found a `NaN` that two of the three bundled
 * samples produced on every RUN. The chain was: `initTags` seeds bound
 * transmitters with an EMPTY `branchFlows` map, `measurementOf` summed it with
 * a non-null assertion (`0 + undefined = NaN`), a controller in AUTO copied
 * that into its PV on the first tick, and the integrator latched it. From
 * there it reached the valve, the vessel, and the vessel's level, pressure and
 * temperature.
 *
 * WHY IT MATTERED MORE THAN A BLANK NUMBER. Every comparison against NaN is
 * false, so `evalAlarms` stopped annunciating on those tags entirely — a
 * vessel could sit at any level and raise nothing — while `sim/quality.ts`
 * still reported GOOD, because a NaN is not one of the conditions it tests
 * for. A silent alarm system is the one failure this product must not have.
 *
 * So this file asserts the invariant rather than the bug: no signal the
 * simulation publishes is ever non-finite. It checks the seed, the steady
 * state, and every bundled sample, because the defect was invisible in the one
 * sample whose instruments happen to bind to vessels rather than to lines.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import '../../src/symbols/lib/index'
import { loadDoc } from '../../src/model/migrate'
import { importSheet } from '../../src/hmi/importFromPid'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { makeRng } from '../../src/hmi/sim/noise'
import { useSimStore } from '../../src/hmi/simStore'
import type { HmiScreen } from '../../src/hmi/model'
import type { Tags } from '../../src/hmi/sim/engine'

/** Every `TAG.SIGNAL` that is not a finite number. */
export function nonFinite(tags: Tags): string[] {
  return Object.entries(tags)
    .flatMap(([tag, signals]) =>
      Object.entries(signals)
        .filter(([, v]) => !Number.isFinite(v))
        .map(([sig]) => `${tag}.${sig}`))
    .sort()
}

/** source -> P-101 -> FV-101 -> TK-101, with FT-101 reading the LINE and
 *  FIC-101 controlling it. The exact shape that produced the defect: a flow
 *  transmitter bound to a pipe, and a controller that starts in AUTO. */
const lineBound: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'FV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { capacity: 50, level0: 40 } },
    { id: 'ft', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'FT-101', props: { bindPipe: 'e2' } },
    { id: 'fic', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'FIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
}

describe('the seeded plant', () => {
  it('seeds a line-bound flow transmitter to a real zero, not to NaN', () => {
    const tags = initTags(buildSimModel(lineBound))
    // The calm-start plant is stationary, so this is exact rather than an
    // approximation: nothing is flowing, and the transmitter reads nothing.
    expect(tags['FT-101']!.PV).toBe(0)
    expect(nonFinite(tags)).toEqual([])
  })

  it('never lets a controller in AUTO latch a non-finite PV', () => {
    const model = buildSimModel(lineBound)
    let tags = initTags(model)
    tags['P-101']!.RUN = 1
    expect(tags['FIC-101']!.MODE).toBe(1) // AUTO on start-up, which is the case that broke
    const rng = makeRng(1)
    let out = { tags, branchFlows: {}, pipePressures: {} } as ReturnType<typeof tick>
    for (let i = 0; i < 120; i++) {
      out = tick(model, out.tags, 1, rng)
      expect(nonFinite(out.tags), `tick ${i}`).toEqual([])
    }
    // and the loop is alive rather than parked on a poisoned integrator
    expect(Number.isFinite(out.tags['FIC-101']!.I!)).toBe(true)
    expect(out.tags['TK-101']!.PV!).toBeGreaterThan(0)
  })
})

describe('every bundled sample runs on numbers', () => {
  for (const file of ['sample-plant.pnid.json', 'sample-refinery-unit.pnid.json', 'template-hmi-demo.pnid.json']) {
    it(file, () => {
      const doc = loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples', file), 'utf8')))
      const screens = doc.hmiScreens.length > 0 ? doc.hmiScreens : doc.sheets.map((sh) => importSheet(doc, sh.id))
      const model = buildSimModel(screens, doc.registry)
      let tags = initTags(model)
      expect(nonFinite(tags), `${file} at RUN start`).toEqual([])
      const rng = makeRng(1)
      let out = { tags, branchFlows: {}, pipePressures: {} } as ReturnType<typeof tick>
      for (let i = 0; i < 120; i++) out = tick(model, out.tags, 1, rng)
      expect(nonFinite(out.tags), `${file} after 120 s`).toEqual([])
    })
  }
})

describe('the runtime store publishes numbers', () => {
  it('every derived map stays finite through a run of the sample plant', () => {
    const doc = loadDoc(JSON.parse(readFileSync(join(__dirname, '../../examples/sample-plant.pnid.json'), 'utf8')))
    const screens = doc.sheets.map((sh) => importSheet(doc, sh.id))
    const sim = () => useSimStore.getState()
    sim().exitRun()
    sim().enterRun(screens, doc.registry)
    for (let i = 0; i < 200; i++) sim().tickOnce(1)

    expect(nonFinite(sim().tags)).toEqual([])
    for (const [name, map] of [
      ['pipeFlows', sim().pipeFlows],
      ['pipePressures', sim().pipePressures],
      ['branchFlows', sim().branchFlows],
      ['equipFlows', sim().equipFlows],
    ] as const) {
      const bad = Object.entries(map).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k)
      expect(bad, name).toEqual([])
    }
    sim().exitRun()
  })
})
