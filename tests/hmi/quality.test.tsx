// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP C — data quality.
 *
 * The audit found every live value rendering as the same confident number: a
 * frozen transmitter, a measurement with no process model behind it at all,
 * and a genuine reading were indistinguishable. These tests hold the line that
 * an operator can tell what produced the number in front of them.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { qualityOf, QUALITY_GLYPH, QUALITY_LABEL, hasNumber } from '../../src/hmi/sim/quality'
import type { Quality } from '../../src/hmi/sim/quality'
import { renderWidget } from '../../src/hmi/widgets/index'
import { useSimStore } from '../../src/hmi/simStore'
import HmiCanvas from '../../src/hmi/HmiCanvas'
import Faceplate from '../../src/hmi/Faceplate'
import { THEMES } from '../../src/hmi/theme'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const theme = THEMES.classic
const ALL: Quality[] = ['good', 'forced', 'stale', 'uncertain', 'bad']

// TK-1 fed through HV-1; LT-1 reads the tank, XI-1 reads nothing at all.
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 't', type: 'tank', x: 400, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 50, level0: 40 } },
    { id: 'lt', type: 'display', x: 600, y: 40, w: 96, h: 40, tag: 'LT-1', props: { bindTank: 'TK-1' } },
    { id: 'xi', type: 'display', x: 600, y: 120, w: 96, h: 40, tag: 'XI-1', props: { base: 30 } },
  ],
  pipes: [],
}
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!
const sim = () => useSimStore.getState()
const qOf = (tag: string) => sim().quality[tag]!

beforeEach(() => {
  document.body.innerHTML = ''
  sim().exitRun()
  sim().enterRun(screen)
})

describe('qualityOf', () => {
  const display = { kind: 'display', bindTank: 'TK-1' }

  it('a bound measurement with nothing interfering is GOOD', () => {
    expect(qualityOf(display, { PV: 40 }).q).toBe('good')
  })
  it('a tag nothing produces a value for is BAD', () => {
    expect(qualityOf(display, undefined).q).toBe('bad')
  })
  it('a measurement with no process model behind it is UNCERTAIN, not GOOD', () => {
    expect(qualityOf({ kind: 'display' }, { PV: 30 }).q).toBe('uncertain')
  })
  it('out of service is UNCERTAIN and says so', () => {
    const s = qualityOf(display, { PV: 40 }, { oos: true })
    expect(s.q).toBe('uncertain')
    expect(s.why).toMatch(/out of service/i)
  })
  it('a frozen input is STALE; a hand-set value is FORCED', () => {
    expect(qualityOf(display, { PV: 40, FROZEN: 1 }).q).toBe('stale')
    expect(qualityOf(display, { PV: 40, FORCED: 1 }).q).toBe('forced')
  })
  it('the worst cause wins — a forced AND failed instrument reads BAD', () => {
    expect(qualityOf(display, { PV: 40, FORCED: 1, FROZEN: 1, BAD: 1 }).q).toBe('bad')
    expect(qualityOf(display, { PV: 40, FORCED: 1, FROZEN: 1 }).q).toBe('forced')
  })
  it('every quality has a glyph and a word, so colour is never the only signal', () => {
    for (const q of ALL) {
      expect(QUALITY_LABEL[q]).toBeTruthy()
      if (q !== 'good') expect(QUALITY_GLYPH[q]).toBeTruthy()
    }
    expect(hasNumber('bad')).toBe(false)
    expect(ALL.filter((q) => q !== 'bad').every(hasNumber)).toBe(true)
  })
})

describe('the running plant publishes quality for every tag', () => {
  it('an unbound display is flagged UNCERTAIN from the first frame', () => {
    expect(qOf('LT-1').q).toBe('good')
    expect(qOf('XI-1').q).toBe('uncertain')
    expect(qOf('XI-1').why).toMatch(/no process model/i)
  })

  it('forcing a transmitter marks it FORCED and pins the reading', () => {
    sim().writeTag('LT-1', 'PV', 90)
    sim().writeTag('LT-1', 'FORCED', 1)
    expect(qOf('LT-1').q).toBe('forced')
    for (let i = 0; i < 20; i++) sim().tickOnce(0.2)
    // the tank is untouched at 40; a live LT-1 would have tracked it back down
    expect(sim().tags['LT-1']!.PV).toBe(90)
  })

  it('releasing the force lets the process take the measurement back', () => {
    sim().writeTag('LT-1', 'PV', 90)
    sim().writeTag('LT-1', 'FORCED', 1)
    sim().writeTag('LT-1', 'FORCED', 0)
    expect(qOf('LT-1').q).toBe('good')
    for (let i = 0; i < 5; i++) sim().tickOnce(0.2)
    expect(sim().tags['LT-1']!.PV).toBeLessThan(50)
  })

  it('a failed instrument reads BAD, and quality reacts without waiting for a tick', () => {
    sim().writeTag('LT-1', 'BAD', 1)
    expect(qOf('LT-1').q).toBe('bad')
  })

  it('taking a tag out of service downgrades it even while paused', () => {
    sim().toggleOos('LT-1')
    expect(qOf('LT-1').q).toBe('uncertain')
    sim().toggleOos('LT-1')
    expect(qOf('LT-1').q).toBe('good')
  })

  it('Reset clears every injected fault', () => {
    sim().writeTag('LT-1', 'BAD', 1)
    sim().writeTag('XI-1', 'FORCED', 1)
    sim().reset()
    expect(qOf('LT-1').q).toBe('good')
    expect(qOf('XI-1').q).toBe('uncertain') // its own honest state, not an injected one
  })
})

describe('a bad reading shows no number', () => {
  const draw = (widget: HmiWidget, quality: Quality) =>
    renderToStaticMarkup(<svg>{renderWidget({ widget, theme, sim: { PV: 42.7 }, quality })}</svg>)

  it('display, bar, gauge and tank all print dashes rather than a stale value', () => {
    for (const type of ['display', 'bar', 'gauge', 'tank'] as const) {
      const html = draw({ id: 'x', type, x: 0, y: 0, w: 96, h: 128, tag: 'LT-1' }, 'bad')
      expect(html, type).toContain('- - -')
      // the number is gone from the TEXT, not merely styled away
      const shown = [...html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('|')
      expect(shown, type).not.toMatch(/4[23]/)
    }
  })

  it('and draws no indicator either — a leftover fill or needle still reads as a value', () => {
    const bar = draw({ id: 'b', type: 'bar', x: 0, y: 0, w: 56, h: 144, tag: 'LT-1' }, 'bad')
    const gauge = draw({ id: 'g', type: 'gauge', x: 0, y: 0, w: 96, h: 96, tag: 'LT-1' }, 'bad')
    expect(bar).not.toContain(theme.liquid)   // no PV fill
    expect(gauge).not.toContain('rotate(')    // no needle
    // the same widgets DO indicate when the reading is merely forced
    expect(draw({ id: 'b', type: 'bar', x: 0, y: 0, w: 56, h: 144, tag: 'LT-1' }, 'forced')).toContain(theme.liquid)
  })

  it('a forced value keeps its number — provenance is what is in doubt, not arithmetic', () => {
    const html = draw({ id: 'x', type: 'display', x: 0, y: 0, w: 96, h: 40, tag: 'LT-1' }, 'forced')
    expect(html).toContain('42.7')
  })
})

describe('the mimic badges anything that is not simply live', () => {
  const canvas = (quality: Quality) =>
    renderToStaticMarkup(
      <HmiCanvas screen={screen} selection={[]} onSelect={() => {}} mode="run" tool="select" onToolDone={() => {}}
        sim={sim().tags} quality={{ 'LT-1': { q: quality, why: 'because' } }} />)

  it('draws the glyph and the word for a degraded value', () => {
    const html = canvas('stale')
    expect(html).toContain('data-quality="stale"')
    expect(html).toContain(QUALITY_GLYPH.stale)
    expect(html).toContain('STALE')
  })

  it('draws nothing at all for a good one — a calm screen means all is well', () => {
    expect(canvas('good')).not.toContain('data-quality')
  })
})

describe('the faceplate states the provenance before the number', () => {
  async function plate(widget: HmiWidget): Promise<HTMLDivElement> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<Faceplate widget={widget} onClose={() => {}} />))
    return host
  }

  it('names the quality and the reason for a forced transmitter', async () => {
    sim().writeTag('LT-1', 'FORCED', 1)
    const host = await plate(w('lt'))
    const strip = host.querySelector('[data-testid="fp-quality"]')!
    expect(strip.getAttribute('data-quality')).toBe('forced')
    expect(strip.textContent).toContain('FORCED')
    // the WORD is on the badge; the reason rides in its tooltip, so a degraded
    // value is unmistakable without a sentence shouting on every faceplate
    expect(strip.getAttribute('title')).toMatch(/not the process/i)
  })

  it('a failed instrument shows no PV on the plate either', async () => {
    sim().writeTag('LT-1', 'BAD', 1)
    const host = await plate(w('lt'))
    expect(host.innerHTML).toContain('- - -')
  })

  it('says nothing when the value is simply live', async () => {
    const host = await plate(w('lt'))
    expect(host.querySelector('[data-testid="fp-quality"]')).toBeNull()
  })
})
