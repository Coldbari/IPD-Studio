import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { THEMES } from '../../src/hmi/theme'
import { renderWidget } from '../../src/hmi/widgets/index'
import type { HmiWidget } from '../../src/hmi/model'

const mk = (over: Partial<HmiWidget>): HmiWidget =>
  ({ id: 'w1', type: 'tank', x: 0, y: 0, w: 96, h: 128, ...over })
const render = (widget: HmiWidget, sim: Record<string, number> = {}) =>
  renderToStaticMarkup(<svg>{renderWidget({ widget, theme: THEMES.classic, sim })}</svg>)

describe('tank shape variants', () => {
  it('renders each imported vessel shape distinctly', () => {
    expect(render(mk({}))).toContain('data-shape="vertical"')
    expect(render(mk({ props: { shape: 'horizontal' }, w: 160, h: 96 }))).toContain('data-shape="horizontal"')
    expect(render(mk({ props: { shape: 'cone' } }))).toContain('data-shape="cone"')
    const agitated = render(mk({ props: { shape: 'agitated' } }))
    expect(agitated).toContain('data-shape="agitated"')
    expect(agitated).toContain('data-agitator')
  })
  it('horizontal tank rounds into a capsule', () => {
    const html = render(mk({ props: { shape: 'horizontal' }, w: 160, h: 96 }))
    expect(html).toContain(`rx="${(96 - 4) / 2}"`)
  })
  it('level fill still tracks PV on shaped tanks', () => {
    const lo = render(mk({ props: { shape: 'cone' } }), { PV: 10 })
    const hi = render(mk({ props: { shape: 'cone' } }), { PV: 90 })
    expect(lo).not.toEqual(hi)
    // the unit is a <tspan> at its own size now, so compare the TEXT rather
    // than the markup: "90" and "%" are adjacent on screen, not in the string
    expect(hi.replace(/<[^>]*>/g, '')).toContain('90%')
  })
})

describe('valve orientation', () => {
  it('rotated valves render the vertical bowtie', () => {
    expect(render(mk({ type: 'valve', w: 48, h: 32 }), { OPEN: 1 })).toContain('data-orient="h"')
    expect(render(mk({ type: 'valve', w: 16, h: 32, rotation: 90 }), { OPEN: 1 })).toContain('data-orient="v"')
    expect(render(mk({ type: 'valve', w: 16, h: 32, rotation: 270 }), { OPEN: 1 })).toContain('data-orient="v"')
  })
})

describe('symbol rotation', () => {
  it('applies the imported rotation to the embedded glyph', () => {
    const html = render(mk({ type: 'symbol', w: 16, h: 40, rotation: 180, props: { symbolId: 'acc.lg' } }))
    expect(html).toContain('rotate(180')
  })
})
