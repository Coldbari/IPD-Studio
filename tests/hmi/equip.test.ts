import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import { buildTagDefs } from '../../src/hmi/sim/tags'
import { buildSimModel, initTags, tick } from '../../src/hmi/sim/engine'
import { buildNetwork } from '../../src/hmi/sim/network'
import { mapNodes } from '../../src/hmi/importFromPid'
import type { Sheet } from '../../src/model/types'
import { renderWidget } from '../../src/hmi/widgets/index'
import { THEMES } from '../../src/hmi/theme'
import { SECTIONS } from '../../src/hmi/HmiPalette'
import { getSymbol } from '../../src/symbols/registry'
import '../../src/symbols/lib/index'
import { DEFAULTS } from '../../src/hmi/sim/units'

const rng = () => 0.5
const screen = (widgets: HmiWidget[], pipes: HmiScreen['pipes'] = []): HmiScreen =>
  ({ id: 's1', name: 'S', theme: 'classic', widgets, pipes })
const equip = (tag: string, x = 200, y = 200): HmiWidget =>
  ({ id: `w-${tag}`, type: 'equip', x, y, w: 64, h: 64, tag, props: { symbolId: 'comp.centrifugal' } })

describe('equip tag model', () => {
  it('a tagged equip widget is a motor', () => {
    const defs = buildTagDefs(screen([equip('K-101')]))
    // a driven machine now carries its DUTY: rated flow and head, from the
    // engineering record where there is one and a stated default where not
    expect(defs).toEqual([{
      name: 'K-101', kind: 'motor', min: 0, max: 1,
      ratedFlow: DEFAULTS.pumpFlowM3h, head: DEFAULTS.pumpHeadBar,
    }])
  })

  it('starts stopped and ramps up over ~2s once RUN is set', () => {
    const model = buildSimModel(screen([equip('K-101')]))
    let tags = initTags(model)
    expect(tags['K-101']).toEqual({ RUN: 0, RAMP: 0 })
    tags['K-101']!.RUN = 1
    for (let i = 0; i < 5; i++) tags = tick(model, tags, 0.2, rng).tags
    expect(tags['K-101']!.RAMP).toBeGreaterThan(0.4)
    expect(tags['K-101']!.RAMP).toBeLessThan(0.6)
  })

  it('a FAULT opens the breaker like a pump trip', () => {
    const model = buildSimModel(screen([equip('K-101')]))
    const tags = initTags(model)
    tags['K-101']!.RUN = 1
    tags['K-101']!.FAULT = 1
    const out = tick(model, tags, 0.2, rng).tags
    expect(out['K-101']!.RUN).toBe(0)
    expect(out['K-101']!.RAMP).toBe(0)
  })
})

describe('equip in the flow network', () => {
  // tank(0,0 96x128) → pipe → equip K-101 (200,40 64x64) → pipe → free end (sink)
  const tank: HmiWidget = { id: 'w-tk', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-1' }
  const sc = screen(
    [tank, equip('K-101', 200, 40)],
    [
      { id: 'p1', points: [{ x: 96, y: 100 }, { x: 200, y: 72 }] },
      { id: 'p2', points: [{ x: 264, y: 72 }, { x: 400, y: 72 }] },
    ],
  )
  it('collects the equip tag as a branch driver', () => {
    const net = buildNetwork(sc)
    expect(net.branches).toHaveLength(1)
    expect(net.branches[0]!.pumps).toEqual(['K-101'])
    expect(net.branches[0]!.from).toEqual({ kind: 'tank', tag: 'TK-1' })
  })
  it('moves flow only when the equip runs', () => {
    const model = buildSimModel(sc)
    const tags = initTags(model)
    let r = tick(model, tags, 0.2, rng)
    expect(Object.values(r.branchFlows).every((f) => f === 0)).toBe(true) // calm start
    r.tags['K-101']!.RUN = 1
    for (let i = 0; i < 15; i++) r = tick(model, r.tags, 0.2, rng)
    expect(Object.values(r.branchFlows).some((f) => f > 0)).toBe(true)
  })
})

describe('palette equipment items', () => {
  const items = SECTIONS.flatMap((s) => s.items).filter((it) => it.type === 'equip')
  it('offers the five motor-equipment presets', () => {
    expect(items.map((it) => it.label)).toEqual(['Agitator', 'Compressor', 'Blower', 'Conveyor', 'Heater'])
  })
  it('every preset symbolId resolves in the registry', () => {
    for (const it of items) {
      const id = it.props?.symbolId
      expect(typeof id).toBe('string')
      expect(() => getSymbol(id as string)).not.toThrow()
    }
  })
})

describe('import maps motor equipment to equip', () => {
  const node = (id: string, symbolId: string) =>
    ({ id, kind: 'equipment', symbolId, x: 100, y: 100 }) as Sheet['nodes'][number]
  const sheet = (nodes: Sheet['nodes']) => ({ id: 'sh1', name: 'S', nodes, edges: [] }) as unknown as Sheet
  const typeOf = (symbolId: string) => {
    const { widgets } = mapNodes(sheet([node('n1', symbolId)]), '-')
    return { type: widgets[0]?.type, props: widgets[0]?.props }
  }

  it('compressors, blowers, agitators, conveyors, heaters, boilers become equip', () => {
    for (const id of ['comp.centrifugal', 'comp.recip', 'comp.screw', 'blower', 'fan', 'agitator',
      'turbine.steam', 'conveyor.belt', 'conveyor.screw', 'bucket-elevator', 'feeder.rotary',
      'crusher', 'mill.ball', 'extruder', 'blender.ribbon', 'screen.vibrating',
      'heater.fired', 'heater.electric', 'boiler', 'cooling-tower']) {
      expect(typeOf(id), id).toEqual({ type: 'equip', props: { symbolId: id } })
    }
  })
  it('pumps stay pumps, exchangers stay symbols', () => {
    expect(typeOf('pump.centrifugal').type).toBe('pump')
    expect(typeOf('ejector').type).toBe('pump')
    expect(typeOf('hx.shell-tube').type).toBe('symbol')
  })
  it('untagged equip gets an M- auto tag', () => {
    const { widgets } = mapNodes(sheet([node('n1', 'comp.centrifugal')]), '-')
    expect(widgets[0]!.tag).toBe('M-1')
  })
})

describe('equip widget rendering', () => {
  const render = (sim: Record<string, number>) =>
    renderToStaticMarkup(renderWidget({ widget: equip('K-101'), theme: THEMES.classic, sim }))

  it('renders the P&ID glyph and the tag', () => {
    const html = render({})
    expect(html).toContain('data-hmi-equip="comp.centrifugal"')
    expect(html).toContain('K-101')
    expect(html).not.toContain('hmi-spin')
  })
  it('spins its badge while running and blinks while starting', () => {
    const html = render({ RUN: 1, RAMP: 0.3 })
    expect(html).toContain('hmi-spin')
    expect(html).toContain('hmi-blink')
  })
  it('marks a fault', () => {
    const html = render({ RUN: 0, FAULT: 1 })
    expect(html).toContain('data-fault')
    expect(html).toContain('hmi-blink')
  })
})
