import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderWidget } from '../../src/hmi/widgets/index'
import { THEMES } from '../../src/hmi/theme'
import type { HmiWidget } from '../../src/hmi/model'
import { historyOf } from './historyFixture'

const theme = THEMES.classic
const render = (widget: HmiWidget, sim: Record<string, number> = {}) =>
  renderToStaticMarkup(<svg>{renderWidget({ widget, theme, sim })}</svg>)

describe('bar indicator', () => {
  const base: HmiWidget = {
    id: 'b1', type: 'bar', x: 0, y: 0, w: 56, h: 144, tag: 'LT-1',
    props: { LL: 5, L: 10, H: 90, HH: 95, unit: '%' },
  }
  it('renders limit ticks, SP caret, PV pointer, and the value', () => {
    const html = render(base, { PV: 48.3, SP: 60 })
    expect(html).toContain('LT-1')
    expect(html).toContain('48.3 %')
    for (const lbl of ['LL', 'HH']) expect(html).toContain(`>${lbl}<`)
    expect(html).toContain(theme.sp) // caret painted in the SP color
  })
  it('no PV -> em dash, no fill', () => {
    const html = render(base, {})
    expect(html).toContain('—')
  })
})

describe('panel + nav', () => {
  it('panel renders its title uppercased with a separator', () => {
    const html = render({ id: 'p1', type: 'panel', x: 0, y: 0, w: 320, h: 208, label: 'Feed area' })
    expect(html).toContain('FEED AREA')
    expect(html).toContain('<line')
  })
  it('panel without title is just the frame', () => {
    const html = render({ id: 'p2', type: 'panel', x: 0, y: 0, w: 320, h: 208 })
    expect(html).not.toContain('<text')
  })
  it('nav shows its label and a chevron', () => {
    const html = render({ id: 'n1', type: 'nav', x: 0, y: 0, w: 120, h: 32, label: 'Overview' })
    expect(html).toContain('Overview')
    expect(html).toContain('<path')
  })
})

describe('upgraded gauge and trend', () => {
  it('gauge draws warn/alarm zone arcs when limits exist', () => {
    const withZones = render(
      { id: 'g1', type: 'gauge', x: 0, y: 0, w: 96, h: 96, tag: 'PI-1', props: { H: 70, HH: 90 } },
      { PV: 50 },
    )
    expect(withZones).toContain(theme.warn)
    expect(withZones).toContain(theme.alarm)
    const plain = render({ id: 'g2', type: 'gauge', x: 0, y: 0, w: 96, h: 96 }, { PV: 50 })
    expect(plain).not.toContain(theme.warn)
  })
  it('trend draws gridlines, scale labels, SP and limit lines', () => {
    const html = renderToStaticMarkup(
      <svg>{renderWidget({
        widget: { id: 't1', type: 'trend', x: 0, y: 0, w: 192, h: 96, tag: 'LT-1', props: { H: 80, min: 0, max: 100 } },
        theme, sim: { PV: 52, SP: 60 }, hist: historyOf({ 'LT-1.PV': [40, 45, 50, 52] }),
      })}</svg>)
    expect(html).toContain('100') // max label
    expect(html).toContain(theme.sp)
    expect(html).toContain(theme.warn)
    expect(html).toContain('polyline')
  })
})
