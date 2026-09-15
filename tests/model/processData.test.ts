// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Reading physical duty off an engineering record.
 *
 * The sibling of `signalData.test.ts`. What matters here is the same thing that
 * matters there: a value it cannot read with certainty must come back as
 * absent, so the caller falls back to a STATED default that the QA report
 * discloses — never to a guess dressed up as engineering data.
 */

import { describe, expect, it } from 'vitest'
import { parseQuantity, processFor } from '../../src/model/processData'
import type { Registry } from '../../src/model/registry'

const reg = (fields: Record<string, string>): Registry => ({
  'TK-1': { key: 'TK-1', kind: 'equipment', fields },
})
const of = (fields: Record<string, string>) => processFor(reg(fields), 'TK-1')

describe('parseQuantity', () => {
  it('reads a number and whatever unit was written after it', () => {
    expect(parseQuantity('100 m³')).toEqual({ value: 100, unit: 'm³' })
    expect(parseQuantity('  12.5bar ')).toEqual({ value: 12.5, unit: 'bar' })
    expect(parseQuantity('50')).toEqual({ value: 50, unit: '' })
    // the unit comes back lower-cased: it is only ever used to CONVERT, and
    // case-folding it once here is what lets the tables stay one entry per unit
    expect(parseQuantity('-10 degC')).toEqual({ value: -10, unit: 'degc' })
  })

  it('accepts a decimal comma, because half the world writes one', () => {
    expect(parseQuantity('12,5 bar')).toEqual({ value: 12.5, unit: 'bar' })
  })

  it('refuses anything that does not start with a number', () => {
    for (const bad of ['see datasheet', '', 'approx 100', undefined]) {
      expect(parseQuantity(bad)).toBeNull()
    }
  })
})

describe('volumes convert to m³', () => {
  it('bare numbers are already m³', () => {
    expect(of({ 'construction.volume': '250' }).volumeM3).toBe(250)
  })
  it('however the cubic metre is spelled', () => {
    for (const t of ['250 m³', '250 m3', '250 M3', '250 cbm', '250m^3']) {
      expect(of({ 'construction.volume': t }).volumeM3, t).toBeCloseTo(250)
    }
  })
  it('and litres are not quietly taken for cubic metres', () => {
    expect(of({ 'construction.volume': '5000 L' }).volumeM3).toBeCloseTo(5)
    expect(of({ 'construction.volume': '5000 litre' }).volumeM3).toBeCloseTo(5)
  })
})

describe('duties convert to the internal units', () => {
  it('flow to m³/h', () => {
    expect(of({ 'duty.capacity': '60' }).ratedFlowM3h).toBe(60)
    expect(of({ 'duty.capacity': '60 m3/h' }).ratedFlowM3h).toBe(60)
    expect(of({ 'duty.capacity': '10 l/s' }).ratedFlowM3h).toBeCloseTo(36)
  })

  it('head to bar — and a bare number is METRES, the way a pump curve is written', () => {
    expect(of({ 'duty.head': '45' }).headBar).toBeCloseTo(45 / 10.197, 4)
    expect(of({ 'duty.head': '45 m' }).headBar).toBeCloseTo(45 / 10.197, 4)
    expect(of({ 'duty.head': '4.5 bar' }).headBar).toBe(4.5)
  })

  it('power to kW', () => {
    expect(of({ 'duty.power': '400' }).powerKw).toBe(400)
    expect(of({ 'duty.power': '1 MW' }).powerKw).toBe(1000)
    expect(of({ 'duty.power': '750 W' }).powerKw).toBeCloseTo(0.75)
  })

  it('pressure to bar and temperature to °C', () => {
    expect(of({ 'design.pressure': '600 kPa' }).designPressureBar).toBeCloseTo(6)
    expect(of({ 'design.pressure': '145 psi' }).designPressureBar).toBeCloseTo(10, 1)
    expect(of({ 'design.operatingTemperature': '80' }).operatingTempC).toBe(80)
    expect(of({ 'design.operatingTemperature': '353.15 K' }).operatingTempC).toBeCloseTo(80)
    expect(of({ 'design.operatingTemperature': '176 degF' }).operatingTempC).toBeCloseTo(80)
  })
})

describe('what it refuses to guess at', () => {
  it('a unit it does not recognise yields NOTHING, not the number', () => {
    // silently taking "250 drums" for 250 m³ would put an invented capacity
    // into the process model, which is the whole failure mode this avoids
    expect(of({ 'construction.volume': '250 drums' }).volumeM3).toBeUndefined()
    expect(of({ 'duty.power': '400 zorkmids' }).powerKw).toBeUndefined()
  })

  it('a blank or unreadable field is simply absent', () => {
    expect(of({ 'construction.volume': '' }).volumeM3).toBeUndefined()
    expect(of({ 'construction.volume': 'see vendor drawing' }).volumeM3).toBeUndefined()
    expect(of({}).volumeM3).toBeUndefined()
  })

  it('no record at all is empty, not an error', () => {
    expect(processFor(undefined, 'TK-1')).toEqual({})
    expect(processFor(reg({}), undefined)).toEqual({})
    expect(processFor(reg({}), 'NOPE-1')).toEqual({})
  })

  it('falls back to the second field only when the first says nothing', () => {
    expect(of({ 'duty.designPressure': '12 bar' }).designPressureBar).toBe(12)
    expect(of({ 'design.pressure': '10 bar', 'duty.designPressure': '12 bar' }).designPressureBar).toBe(10)
  })
})
