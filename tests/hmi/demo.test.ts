import { describe, expect, it } from 'vitest'
import demo from '../../examples/template-hmi-demo.pnid.json'
import { loadDoc } from '../../src/model/migrate'
import { activeHmiScreen } from '../../src/store/store'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { makeRng } from '../../src/hmi/sim/noise'

describe('HMI demo template', () => {
  it('loads as a valid v4 doc with one screen linked to its sheet', () => {
    const doc = loadDoc(demo)
    expect(doc.hmiScreens).toHaveLength(1)
    expect(doc.hmiScreens[0]!.fromSheetId).toBe(doc.sheets[0]!.id)
    expect(activeHmiScreen({ doc, activeScreenId: 'screen-demo' })!.name).toBe('Tank Level HMI')
  })
  it('compiles to a working control loop: pump on -> LIC holds level at SP', () => {
    const doc = loadDoc(demo)
    const model = buildSimModel(doc.hmiScreens[0]!)
    expect(model.controllers).toEqual([
      { tag: 'LIC-101', pvTag: 'LT-101', outTag: 'LV-101', outKind: 'valve', action: 1 },
    ])
    expect(model.net.branches.length).toBeGreaterThanOrEqual(2)
    let tags = initTags(model)
    tags['P-101']!.RUN = 1
    tags['HV-101']!.OPEN = 1 // line up the drain — calm start ships it closed
    const rng = makeRng(3)
    // TK-101 is 120 m³ and starts at 35 %: filling to setpoint against the
    // open drain is well over half an hour of process time, then the loop settles.
    for (let i = 0; i < Math.round((4 * 3600) / 2); i++) tags = tick(model, tags, 2, rng).tags
    expect(Math.abs(tags['TK-101']!.PV! - 50)).toBeLessThan(4)
  })
})
