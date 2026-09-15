import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { THEMES } from '../../src/hmi/theme'
import { renderWidget } from '../../src/hmi/widgets/index'
import type { HmiWidget } from '../../src/hmi/model'
import type { History } from '../../src/hmi/sim/history'
import { historyOf } from './historyFixture'

const mk = (over: Partial<HmiWidget>): HmiWidget =>
  ({ id: 'w1', type: 'display', x: 0, y: 0, w: 96, h: 40, ...over })
const render = (widget: HmiWidget, sim: Record<string, number> = {}, hist?: History) =>
  renderToStaticMarkup(<svg>{renderWidget({ widget, theme: THEMES.classic, sim, hist })}</svg>)

describe('indicator widgets', () => {
  it('display shows value + unit and alarm border when in alarm', () => {
    const html = render(mk({ tag: 'LT-101', props: { unit: '%' } }), { PV: 42.4 })
    expect(html).toContain('42.4')
    expect(html).toContain('%')
    const alarmed = renderToStaticMarkup(<svg>{renderWidget({ widget: mk({}), theme: THEMES.classic, sim: { PV: 97 }, alarm: 'unacked' })}</svg>)
    expect(alarmed).toContain(THEMES.classic.alarm)
  })
  it('gauge needle angle tracks PV across min..max', () => {
    const lo = render(mk({ type: 'gauge', w: 96, h: 96 }), { PV: 0 })
    const hi = render(mk({ type: 'gauge', w: 96, h: 96 }), { PV: 100 })
    expect(lo).not.toEqual(hi)
    expect(lo).toContain('rotate(-120')
    expect(hi).toContain('rotate(120')
  })
  it('trend draws a polyline from history', () => {
    const html = render(mk({ type: 'trend', w: 192, h: 96 }), {}, historyOf({ PV: [10, 50, 90] }))
    expect(html).toContain('polyline')
  })
  it('button and switch render labels', () => {
    expect(render(mk({ type: 'button', label: 'START' }))).toContain('START')
    expect(render(mk({ type: 'switch', props: { onLabel: 'AUTO', signal: 'X.Y' } }), { 'X.Y': 1 })).toContain('AUTO')
  })
  it('symbol widget embeds a registry symbol scaled to its box', () => {
    const html = render(mk({ type: 'symbol', w: 64, h: 64, props: { symbolId: 'valve.gate' } }))
    expect(html).toContain('data-hmi-symbol="valve.gate"')
  })
  it('renderWidget covers every type without throwing', () => {
    for (const type of ['tank','pump','valve','display','gauge','trend','lamp','button','switch','label','symbol'] as const) {
      expect(() => render(mk({ type, props: type === 'symbol' ? { symbolId: 'valve.gate' } : undefined }))).not.toThrow()
    }
  })
})
