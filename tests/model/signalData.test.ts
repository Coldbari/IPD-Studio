// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { engineeringFor, isEmptySignal, parseRange } from '../../src/model/signalData'
import type { Registry } from '../../src/model/registry'

const reg = (fields: Record<string, string>): Registry => ({
  'LT-101': { key: 'LT-101', kind: 'instrument', fields },
})

describe('reading a calibrated range', () => {
  it('accepts the forms an engineer writes', () => {
    expect(parseRange('0-10')).toEqual({ min: 0, max: 10 })
    expect(parseRange('0 - 10 bar')).toEqual({ min: 0, max: 10, unit: 'bar' })
    expect(parseRange('0 to 100 %')).toEqual({ min: 0, max: 100, unit: '%' })
    expect(parseRange('-50…250 degC')).toEqual({ min: -50, max: 250, unit: 'degC' })
    expect(parseRange('4-20 mA')).toEqual({ min: 4, max: 20, unit: 'mA' })
  })

  it('declines rather than guessing', () => {
    for (const bad of ['', 'wide', '0/100', 'see datasheet', '10']) {
      expect(parseRange(bad), bad).toBeNull()
    }
  })
})

describe('the registry as the source of truth', () => {
  it('is empty for a tag with no record — normal, not an error', () => {
    expect(isEmptySignal(engineeringFor(undefined, 'LT-101'))).toBe(true)
    expect(isEmptySignal(engineeringFor({}, 'LT-101'))).toBe(true)
    expect(isEmptySignal(engineeringFor(reg({ 'general.service': 'Water' }), 'LT-101'))).toBe(true)
  })

  it('reads every signal and alarm field', () => {
    const e = engineeringFor(reg({
      'signal.type': 'ai', 'signal.units': 'bar', 'signal.systemTag': 'AI_0101',
      'signal.setpoint': '6.5', 'signal.range': '0-10 bar',
      'alarm.LL': '1', 'alarm.L': '2', 'alarm.H': '8', 'alarm.HH': '9',
      'alarm.priority': 'HIGH',
    }), 'LT-101')
    expect(e.type).toBe('AI')
    expect(e.units).toBe('bar')
    expect(e.systemTag).toBe('AI_0101')
    expect(e.setpoint).toBe(6.5)
    expect(e.min).toBe(0)
    expect(e.max).toBe(10)
    expect(e.limits).toEqual({ LL: 1, L: 2, H: 8, HH: 9 })
    expect(e.priority).toBe('high')
  })

  it('supports partial data without inventing the rest', () => {
    const e = engineeringFor(reg({ 'alarm.H': '80' }), 'LT-101')
    expect(e.limits).toEqual({ LL: undefined, L: undefined, H: 80, HH: undefined })
    expect(e.min).toBeUndefined()
    expect(e.type).toBeUndefined()
  })

  it('prefers an explicit unit over the one trailing the range', () => {
    expect(engineeringFor(reg({ 'signal.range': '0-10 bar', 'signal.units': 'kPa' }), 'LT-101').units).toBe('kPa')
    expect(engineeringFor(reg({ 'signal.range': '0-10 bar' }), 'LT-101').units).toBe('bar')
  })

  it('treats an unreadable value as absent rather than as zero', () => {
    const e = engineeringFor(reg({ 'alarm.H': 'high-ish', 'signal.setpoint': '', 'signal.type': 'analogue' }), 'LT-101')
    expect(e.limits.H).toBeUndefined()
    expect(e.setpoint).toBeUndefined()
    expect(e.type).toBeUndefined()
  })
})
