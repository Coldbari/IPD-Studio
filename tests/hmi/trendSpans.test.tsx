// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP F — the trend at every operator span.
 *
 * The widget asks history for the window it wants; history decides which
 * stored samples answer it. Nothing here knows a ring buffer exists, and
 * there is no span-specific drawing code — which is what these tests are
 * really checking, by exercising all four spans through one path.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import Trend, { PEN_COLORS } from '../../src/hmi/widgets/trend'
import { History, TREND_SPANS, qualityCode } from '../../src/hmi/sim/history'
import { THEMES } from '../../src/hmi/theme'
import type { HmiWidget } from '../../src/hmi/model'
import type { TagDef } from '../../src/hmi/sim/tags'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const theme = THEMES.classic

/** 70 process-minutes of a plant, sampled once a second. */
function plantHistory(): History {
  const h = new History()
  for (let t = 0; t <= 70 * 60; t++) {
    h.record(t, (put) => {
      put('PT-101.PV', 4 + Math.sin(t / 240) * 1.5)
      put('LIC-101.PV', 45 + Math.sin(t / 300) * 8)
      put('LIC-101.SP', 45)
      put('LIC-101.OP', 40 + Math.cos(t / 300) * 10)
    })
  }
  return h
}

const defs: Record<string, TagDef> = {
  'PT-101': { name: 'PT-101', kind: 'display', measures: 'pressure', unit: 'bar', min: 0, max: 10 },
  'LIC-101': { name: 'LIC-101', kind: 'controller', measures: 'level', unit: '%', min: 0, max: 100 },
}

const trend = (props: HmiWidget['props'], pens?: HmiWidget['pens'], tag = 'PT-101'): HmiWidget =>
  ({ id: 't1', type: 'trend', x: 0, y: 0, w: 240, h: 120, tag, ...(pens ? { pens } : {}), props })

const draw = (w: HmiWidget, hist: History) =>
  renderToStaticMarkup(
    <svg>{<Trend widget={w} theme={theme} sim={{ PV: 4.2 }} hist={hist} eng={defs[w.tag!]} defs={defs} />}</svg>,
  )

const pointsOf = (html: string): number => {
  const m = /<polyline points="([^"]*)"/.exec(html)
  return m ? m[1]!.trim().split(/\s+/).length : 0
}

let hist: History
beforeEach(() => { hist = plantHistory() })

describe('every operator span renders', () => {
  it('1, 5, 15 and 60 minutes each draw a real trace', () => {
    for (const span of TREND_SPANS) {
      const html = draw(trend({ span }), hist)
      expect(html, `${span}s`).toContain('polyline')
      expect(pointsOf(html), `${span}s`).toBeGreaterThan(5)
      expect(html, `${span}s`).toContain(`data-span="${span}"`)
    }
  })

  it('a 60-minute chart does not try to draw thousands of points', () => {
    // 3600 stored samples; the plot is ~206 px wide
    const html = draw(trend({ span: 3600 }), hist)
    expect(pointsOf(html)).toBeLessThanOrEqual(210)
    expect(pointsOf(html)).toBeGreaterThan(50)
  })

  it('a 1-minute chart keeps its full resolution', () => {
    expect(pointsOf(draw(trend({ span: 60 }), hist))).toBeGreaterThan(50)
  })

  it('a wider span reaches further back in process time', () => {
    const axis = (span: number) => {
      const m = [...draw(trend({ span }), hist).matchAll(/<text[^>]*>([\d:]+)<\/text>/g)].map((x) => x[1])
      return m[m.length - 3] // first of the three time-axis labels
    }
    expect(axis(60)).toBe('69:00')
    expect(axis(3600)).toBe('0:10') // h:mm once the span passes fifteen minutes
  })

  it('a screen saved before spans existed still draws', () => {
    // no `span` prop at all — the widget falls back rather than rendering blank
    expect(draw(trend({}), hist)).toContain('polyline')
    // and an old 2-minute / 4-minute value is still an honest window
    expect(draw(trend({ span: 120 }), hist)).toContain('polyline')
    expect(draw(trend({ span: 240 }), hist)).toContain('polyline')
  })
})

describe('pens stay independent', () => {
  const w = trend({ span: 300, min: 0, max: 100 },
    [{ ref: 'LIC-101.SP' }, { ref: 'LIC-101.OP' }], 'LIC-101')

  it('PV, SP and OP are three separate traces in three colours', () => {
    const html = draw(w, hist)
    expect(html.match(/<polyline/g)!.length).toBe(3)
    for (const c of PEN_COLORS.slice(0, 3)) expect(html).toContain(c)
  })

  it('the legend names each one and never confuses output with PV', () => {
    const html = draw(w, hist)
    expect(html).toContain('LIC-101 ')       // PV pen, .PV trimmed
    expect(html).toContain('LIC-101.SP ')
    expect(html).toContain('LIC-101.OP ')
  })

  it('a setpoint that never moved draws flat, while the PV does not', () => {
    const html = draw(w, hist)
    const lines = [...html.matchAll(/<polyline points="([^"]*)"/g)].map((m) => m[1]!)
    const ys = (pts: string) => new Set(pts.trim().split(/\s+/).map((p) => p.split(',')[1]))
    expect(ys(lines[1]!).size, 'SP is constant').toBe(1)
    expect(ys(lines[0]!).size, 'PV moves').toBeGreaterThan(5)
  })

  it('a pen with no recorded series simply draws nothing', () => {
    const ghost = trend({ span: 300 }, [{ ref: 'GHOST.OP' }])
    expect(draw(ghost, hist).match(/<polyline/g)!.length).toBe(1)
  })
})

describe('units come from the canonical engineering metadata', () => {
  it('the legend shows each pen in its own unit', () => {
    const html = draw(trend({ span: 300 }), hist)
    expect(html).toContain('bar') // PT-101 is a pressure tag
  })

  it('a controller output is per cent whatever its PV measures', () => {
    const w = trend({ span: 300, min: 0, max: 100 }, [{ ref: 'LIC-101.OP' }], 'LIC-101')
    const html = draw(w, hist)
    expect(html).toMatch(/LIC-101\.OP [\d.]+ %/)
    expect(html).toMatch(/LIC-101 [\d.]+ %/)
  })

  it('nothing is invented when the metadata says nothing', () => {
    const html = renderToStaticMarkup(
      <svg>{<Trend widget={trend({ span: 300 }, undefined, 'ZZ-9')} theme={theme} sim={{}} hist={hist} />}</svg>,
    )
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('NaN')
  })
})

describe('degraded history is visibly degraded', () => {
  it('a forced period draws dashed rather than as ordinary data', () => {
    const h = new History()
    for (let t = 0; t <= 120; t++) {
      h.record(t, (put) => put('PT-101.PV', 4, qualityCode(t > 60 ? 'forced' : 'good')))
    }
    expect(draw(trend({ span: 60 }), h)).toContain('data-degraded')
    // a window clear of it is drawn solid
    const clean = new History()
    for (let t = 0; t <= 120; t++) clean.record(t, (put) => put('PT-101.PV', 4))
    expect(draw(trend({ span: 60 }), clean)).not.toContain('data-degraded')
  })
})

describe('the hover cursor', () => {
  async function mount(w: HmiWidget, h: History) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(
      <svg>{<Trend widget={w} theme={theme} sim={{ PV: 4.2 }} hist={h} eng={defs[w.tag!]} defs={defs} />}</svg>,
    ))
    return host
  }

  it('reports the time and the value at the cursor, for every pen', async () => {
    const w = trend({ span: 300, min: 0, max: 100 },
      [{ ref: 'LIC-101.SP' }, { ref: 'LIC-101.OP' }], 'LIC-101')
    const host = await mount(w, hist)
    const surface = [...host.querySelectorAll('rect')].find((r) => r.getAttribute('fill') === 'transparent')!
    surface.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 80, right: 200, bottom: 80, x: 0, y: 0, toJSON: () => ({}) })

    await act(async () => {
      surface.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 100 }))
    })
    // halfway across a 5-minute window ending at 70:00 -> about 67:30
    const stamp = host.querySelector('[data-cursor-time]')!
    expect(stamp.textContent).toBe('67:30')
    // and a readout for every pen at that instant, not the live value
    expect(host.innerHTML).toMatch(/LIC-101 [\d.]+ %/)
    expect(host.innerHTML).toMatch(/LIC-101\.SP 45\.0 %/)
    expect(host.innerHTML).toMatch(/LIC-101\.OP [\d.]+ %/)
  })

  it('leaving the chart releases the cursor', async () => {
    const host = await mount(trend({ span: 300 }), hist)
    const surface = [...host.querySelectorAll('rect')].find((r) => r.getAttribute('fill') === 'transparent')!
    surface.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 80, right: 200, bottom: 80, x: 0, y: 0, toJSON: () => ({}) })
    await act(async () => surface.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 50 })))
    expect(host.querySelector('[data-cursor-time]')).not.toBeNull()
    await act(async () => surface.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true })))
    expect(host.querySelector('[data-cursor-time]')).toBeNull()
  })
})
