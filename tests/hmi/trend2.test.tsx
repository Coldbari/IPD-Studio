import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Trend, { PEN_COLORS, axisLabel, splitRef } from '../../src/hmi/widgets/trend'
import { THEMES } from '../../src/hmi/theme'
import type { HmiWidget } from '../../src/hmi/model'
import { historyOf } from './historyFixture'

// Windowing moved OUT of the widget: history owns which samples answer a
// window (see tests/hmi/history.test.ts), the trend owns drawing them.
describe('trend helpers', () => {
  it('splits a signal reference at the last dot', () => {
    expect(splitRef('LIC-101.OP')).toEqual({ tag: 'LIC-101', signal: 'OP' })
    expect(splitRef('PT-1.PV')).toEqual({ tag: 'PT-1', signal: 'PV' })
    expect(splitRef('PV')).toEqual({ tag: 'PV', signal: 'PV' })
  })
  it('labels a short span in mm:ss and a long one in h:mm', () => {
    expect(axisLabel(125, 60)).toBe('02:05')
    expect(axisLabel(125, 300)).toBe('02:05')
    expect(axisLabel(3725, 3600)).toBe('1:02')
    expect(axisLabel(-5, 60)).toBe('00:00')
  })
})

const widget: HmiWidget = {
  id: 't1', type: 'trend', x: 0, y: 0, w: 192, h: 96, tag: 'FT-1',
  props: { min: 0, max: 100, span: 60 },
  pens: [{ ref: 'LIC-1.SP' }],
}

const hist = historyOf({
  'FT-1.PV': [10, 20, 30, 40],
  'LIC-1.SP': [50, 50, 55, 55],
})

describe('multi-pen trend', () => {
  const html = renderToStaticMarkup(
    <svg>{<Trend widget={widget} theme={THEMES.classic} sim={{ PV: 40 }} hist={hist} />}</svg>,
  )
  it('draws one polyline per pen in distinct colors', () => {
    expect(html.match(/<polyline/g)!.length).toBe(2)
    expect(html).toContain(PEN_COLORS[0]!)
    expect(html).toContain(PEN_COLORS[1]!)
  })
  it('legend names both pens (PV suffix trimmed) with live values', () => {
    expect(html).toContain('FT-1 40')
    expect(html).toContain('LIC-1.SP 55')
  })
  it('renders a time axis in mm:ss', () => {
    expect(html).toContain('00:0')
  })
  it('a pen with no recorded series simply draws nothing', () => {
    const w2: HmiWidget = { ...widget, pens: [{ ref: 'GHOST.OP' }] }
    const h2 = renderToStaticMarkup(
      <svg>{<Trend widget={w2} theme={THEMES.classic} sim={{ PV: 40 }} hist={hist} />}</svg>,
    )
    expect(h2.match(/<polyline/g)!.length).toBe(1)
  })
})

describe('display sparkline', () => {
  it('renders when props.spark is on and history exists', async () => {
    const { default: Display } = await import('../../src/hmi/widgets/display')
    const w: HmiWidget = { id: 'd', type: 'display', x: 0, y: 0, w: 96, h: 40, tag: 'FT-1', props: { spark: true } }
    const html = renderToStaticMarkup(
      <svg>{<Display widget={w} theme={THEMES.classic} sim={{ PV: 40 }} hist={hist} />}</svg>,
    )
    expect(html).toContain('data-spark')
    const off = renderToStaticMarkup(
      <svg>{<Display widget={{ ...w, props: {} }} theme={THEMES.classic} sim={{ PV: 40 }} hist={hist} />}</svg>,
    )
    expect(off).not.toContain('data-spark')
  })
})
