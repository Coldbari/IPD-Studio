// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { buildTagDefs } from '../../src/hmi/sim/tags'
import type { HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

/**
 * P1-A resolution order: registry → legacy widget prop → simulation default.
 * The registry is never overridden by a widget.
 */

const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget =>
  ({ x: 0, y: 0, w: 64, h: 64, ...w })

const reg = (fields: Record<string, string>): Registry => ({
  'LT-101': { key: 'LT-101', kind: 'instrument', fields },
})

const defOf = (widgets: HmiWidget[], registry?: Registry) =>
  buildTagDefs([{ widgets }], registry).find((d) => d.name === 'LT-101')!

describe('a measurement widget', () => {
  const display = (props: HmiWidget['props']) =>
    [widget({ id: 'w1', type: 'display', tag: 'LT-101', props })]

  it('1. takes the registry value when both exist', () => {
    const d = defOf(display({ min: 0, max: 100, unit: '%', H: 90 }),
      reg({ 'signal.range': '0-10 bar', 'signal.units': 'bar', 'alarm.H': '8' }))
    expect(d.min).toBe(0)
    expect(d.max).toBe(10)
    expect(d.unit).toBe('bar')
    expect(d.limits?.H).toBe(8)
  })

  it('2. falls back to the legacy widget prop when the registry is silent', () => {
    const d = defOf(display({ min: 0, max: 250, unit: 'degC', H: 200 }), reg({ 'general.service': 'Steam' }))
    expect(d.max).toBe(250)
    expect(d.unit).toBe('degC')
    expect(d.limits?.H).toBe(200)
  })

  it('3. uses the simulation default only when neither says anything', () => {
    const d = defOf(display({}))
    expect(d.min).toBe(0)
    expect(d.max).toBe(100)
    // LT-101 is a LEVEL tag by its ISA letter, so the default span and unit are
    // the ones level is measured in. That is a reading of the tag the drawing
    // already carries, not an engineering value invented for it — and
    // model/signalData.ts still never lets it reach a record.
    expect(d.unit).toBe('%')
    // Still no invented alarms on a measurement widget.
    expect(d.limits).toBeUndefined()
  })

  it('3b. a tag whose letters name nothing measurable gets no unit at all', () => {
    const d = buildTagDefs([{ widgets: [widget({ id: 'w1', type: 'display', tag: 'XI-9' })] }])
      .find((x) => x.name === 'XI-9')!
    expect(d.unit).toBeUndefined()
    expect(d.measures).toBeUndefined()
  })

  it('3c. ISA letters pick the quantity, and with it the default span', () => {
    const spanOf = (tag: string) => {
      const d = buildTagDefs([{ widgets: [widget({ id: 'w', type: 'display', tag })] }])[0]!
      return { measures: d.measures, min: d.min, max: d.max, unit: d.unit }
    }
    expect(spanOf('PT-1')).toEqual({ measures: 'pressure', min: 0, max: 10, unit: 'bar' })
    expect(spanOf('TT-1')).toEqual({ measures: 'temperature', min: 0, max: 150, unit: '°C' })
    expect(spanOf('FT-1')).toEqual({ measures: 'flow', min: 0, max: 100, unit: 'm³/h' })
  })

  it('mixes per value — a registry limit and a legacy range coexist', () => {
    const d = defOf(display({ min: 0, max: 250, H: 200 }), reg({ 'alarm.H': '180' }))
    expect(d.max).toBe(250)     // legacy, registry silent
    expect(d.limits?.H).toBe(180) // registry wins
  })

  it('reads the alarm priority from the registry', () => {
    expect(defOf(display({ priority: 'low' }), reg({ 'alarm.priority': 'high' })).priority).toBe('high')
    expect(defOf(display({ priority: 'low' })).priority).toBe('low')
  })
})

describe('a tank widget', () => {
  const tank = (props: HmiWidget['props']) => [widget({ id: 'w1', type: 'tank', tag: 'LT-101', props })]

  it('keeps its simulation fallbacks when nothing is specified', () => {
    // These are physics placeholders so a demo screen animates. They are NOT
    // engineering data and P1-A must not promote them into a record.
    expect(defOf(tank({})).limits).toEqual({ LL: 5, L: 10, H: 90, HH: 95 })
  })

  it('lets the registry override each limit independently', () => {
    const d = defOf(tank({}), reg({ 'alarm.LL': '2', 'alarm.HH': '98' }))
    expect(d.limits).toEqual({ LL: 2, L: 10, H: 90, HH: 98 })
  })

  it('still prefers the registry over a stored widget prop', () => {
    expect(defOf(tank({ H: 80 }), reg({ 'alarm.H': '85' })).limits?.H).toBe(85)
    expect(defOf(tank({ H: 80 })).limits?.H).toBe(80)
  })
})

describe('nothing else moves', () => {
  it('presentation and simulation-only props are untouched by the registry', () => {
    const d = defOf(
      [widget({ id: 'w1', type: 'display', tag: 'LT-101', props: { controller: true, base: 3, bindTank: 'TK-1', bindPipe: 'p1', deadband: 2, alarmDelay: 5 } })],
      reg({ 'signal.range': '0-10 bar', 'alarm.H': '8' }),
    )
    expect(d.kind).toBe('controller')
    expect(d.base).toBe(3)
    expect(d.bindTank).toBe('TK-1')
    expect(d.bindPipe).toBe('p1')
    expect(d.deadband).toBe(2)
    expect(d.alarmDelay).toBe(5)
  })

  it('an existing project with no registry at all behaves exactly as before', () => {
    const widgets = [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101', props: { LL: 3, L: 8, H: 92, HH: 97, capacity: 500 } }),
      widget({ id: 'w2', type: 'display', tag: 'PT-200', props: { min: 0, max: 40, unit: 'bar' } }),
    ]
    const withoutRegistry = buildTagDefs([{ widgets }])
    const withEmptyRegistry = buildTagDefs([{ widgets }], {})
    expect(withEmptyRegistry).toEqual(withoutRegistry)
    expect(withoutRegistry.find((d) => d.name === 'LT-101')!.limits).toEqual({ LL: 3, L: 8, H: 92, HH: 97 })
    expect(withoutRegistry.find((d) => d.name === 'PT-200')!.max).toBe(40)
  })
})
