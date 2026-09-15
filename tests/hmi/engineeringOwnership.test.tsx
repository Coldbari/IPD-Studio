// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderWidget } from '../../src/hmi/widgets/index'
import { buildTagDefs, tagDefMap } from '../../src/hmi/sim/tags'
import { useSimStore } from '../../src/hmi/simStore'
import Faceplate from '../../src/hmi/Faceplate'
import { THEMES } from '../../src/hmi/theme'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/**
 * STEP A — one resolver.
 *
 * The audit found the simulation and the alarm engine reading the engineering
 * registry while every renderer resolved `widget.props` for itself. A tag whose
 * record said `0-10 bar` alarmed correctly at 8 and drew a 0-100 scale with no
 * limit ticks at all. These tests pin the fix: whatever `sim/tags.ts` compiled
 * is what the mimic and the faceplate draw.
 */

const theme = THEMES.classic

/** The record says 0-10 bar with H 8 / HH 9. The widget props say 0-100 %,
 *  which is exactly the stale authoring the registry is meant to outrank. */
const registry: Registry = {
  'PT-101': {
    key: 'PT-101',
    kind: 'instrument',
    fields: { 'signal.range': '0-10 bar', 'signal.units': 'bar', 'alarm.H': '8', 'alarm.HH': '9' },
  },
}

const measured = (id: string, type: HmiWidget['type']): HmiWidget => ({
  id, type, x: 0, y: 0, w: 56, h: 144, tag: 'PT-101', props: { min: 0, max: 100, unit: '%' },
})

const screen = (widgets: HmiWidget[]): HmiScreen =>
  ({ id: 's', name: 'S', theme: 'classic', widgets, pipes: [] })

const defsFor = (widgets: HmiWidget[], reg?: Registry) => tagDefMap(buildTagDefs([{ widgets }], reg))

const draw = (widget: HmiWidget, sim: Record<string, number>, reg?: Registry) =>
  renderToStaticMarkup(
    <svg>{renderWidget({ widget, theme, sim, eng: defsFor([widget], reg)[widget.tag!] })}</svg>,
  )

/** y of the bar's PV pointer line (the one stroked in the text colour). */
function pointerY(html: string): number {
  const m = new RegExp(`<line[^>]*y1="([\\d.]+)"[^>]*stroke="${theme.text}"`).exec(html)
  expect(m).not.toBeNull()
  return Number(m![1])
}

describe('a measurement widget draws on the range the simulation compiled', () => {
  it('bar: the registry range positions the PV, the stale widget range does not', () => {
    const w = measured('b1', 'bar')
    // 8 of 10 -> near the top of the scale; 8 of 100 -> near the bottom
    const withRecord = pointerY(draw(w, { PV: 8 }, registry))
    const legacy = pointerY(draw(w, { PV: 8 }))
    expect(withRecord).toBeLessThan(60)
    expect(legacy).toBeGreaterThan(100)
  })

  it('bar: the unit and the limit ticks come from the record, not from props', () => {
    const html = draw(measured('b2', 'bar'), { PV: 8 }, registry)
    expect(html).toContain('8.0 bar')
    expect(html).not.toContain('8.0 %')
    expect(html).toContain('>H<')
    expect(html).toContain('>HH<')
  })

  it('gauge: the record’s limits draw the warn and alarm zones', () => {
    const g = { ...measured('g1', 'gauge'), w: 96, h: 96 }
    expect(draw(g, { PV: 4 }, registry)).toContain(theme.warn)
    // props carry no limits at all, so without a record there is nothing to draw
    expect(draw(g, { PV: 4 })).not.toContain(theme.warn)
  })

  it('trend: the record’s limits draw the limit lines', () => {
    const t = { ...measured('t1', 'trend'), w: 192, h: 96 }
    expect(draw(t, { PV: 4 }, registry)).toContain(theme.warn)
    expect(draw(t, { PV: 4 })).not.toContain(theme.warn)
  })

  it('display: the value carries the record’s unit', () => {
    const d = { ...measured('d1', 'display'), w: 96, h: 40 }
    expect(draw(d, { PV: 8 }, registry)).toContain('8.0 bar')
  })

  it('the legacy widget prop still answers when the record is silent', () => {
    const w: HmiWidget = {
      id: 'b3', type: 'bar', x: 0, y: 0, w: 56, h: 144, tag: 'TT-1',
      props: { min: 0, max: 250, unit: 'degC', H: 200 },
    }
    const html = draw(w, { PV: 120 })
    expect(html).toContain('120.0 degC')
    expect(html).toContain('>H<')
  })
})

describe('no renderer invents alarm limits any more', () => {
  it('an untagged vessel draws no limit markers', () => {
    const t: HmiWidget = { id: 'tk', type: 'tank', x: 0, y: 0, w: 96, h: 128 }
    const html = renderToStaticMarkup(<svg>{renderWidget({ widget: t, theme, sim: { PV: 40 } })}</svg>)
    for (const k of ['>LL<', '>HH<']) expect(html).not.toContain(k)
  })

  it('a tagged vessel draws the markers its definition states — the sim’s own numbers', () => {
    const t: HmiWidget = { id: 'tk', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'TK-1' }
    expect(draw(t, { PV: 40 })).toContain('>HH<')
    const reg: Registry = { 'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'alarm.HH': '98' } } }
    expect(defsFor([t], reg)['TK-1']!.limits).toEqual({ LL: 5, L: 10, H: 90, HH: 98 })
  })
})

describe('the faceplate and the running simulation cannot disagree', () => {
  const w = measured('b1', 'bar')

  beforeEach(() => {
    useSimStore.getState().exitRun()
    document.body.innerHTML = ''
  })

  it('publishes the compiled definitions the mimic and the plate read', () => {
    useSimStore.getState().enterRun(screen([w]), registry)
    expect(useSimStore.getState().defs['PT-101']).toMatchObject({ min: 0, max: 10, unit: 'bar' })
    useSimStore.getState().exitRun()
    expect(useSimStore.getState().defs).toEqual({})
  })

  it('the plate shows the record’s unit and limit ticks, not the widget’s', async () => {
    useSimStore.getState().enterRun(screen([w]), registry)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<Faceplate widget={w} onClose={() => {}} />))
    expect(host.innerHTML).toContain('bar')
    expect(host.innerHTML).not.toContain('%<')
    // scale end-labels are rounded min/max of the RECORD's range
    expect(host.innerHTML).toContain('>10<')
    expect(host.innerHTML).toContain('>HH<')
  })
})
