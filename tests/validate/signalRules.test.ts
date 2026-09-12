// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import {
  alarmOrder, alarmOutsideRange, duplicateSystemTag, rangeUnreadable, signalDataInvalid,
} from '../../src/validate/rules/signal'
import type { ProjectDoc } from '../../src/model/types'

function docWith(records: Record<string, Record<string, string>>): ProjectDoc {
  const d = createEmptyDoc('t')
  return {
    ...d,
    registry: Object.fromEntries(
      Object.entries(records).map(([key, fields]) => [key, { key, kind: 'instrument' as const, fields }]),
    ),
  }
}
const run = (rule: { run: (ix: ReturnType<typeof buildIndex>) => unknown[] }, doc: ProjectDoc) =>
  rule.run(buildIndex(doc))

describe('alarm ordering', () => {
  it('passes on a correctly ordered set', () => {
    expect(run(alarmOrder, docWith({ 'LT-101': { 'alarm.LL': '5', 'alarm.L': '10', 'alarm.H': '90', 'alarm.HH': '95' } }))).toHaveLength(0)
  })

  it('passes on a partial set — H and HH with no low alarms is complete', () => {
    expect(run(alarmOrder, docWith({ 'LT-101': { 'alarm.H': '90', 'alarm.HH': '95' } }))).toHaveLength(0)
    expect(run(alarmOrder, docWith({ 'LT-101': { 'alarm.LL': '5', 'alarm.HH': '95' } }))).toHaveLength(0)
  })

  it('passes when limits are equal — a deadband decision, not a contradiction', () => {
    expect(run(alarmOrder, docWith({ 'LT-101': { 'alarm.L': '10', 'alarm.H': '10' } }))).toHaveLength(0)
  })

  it('reports limits that cross', () => {
    const found = run(alarmOrder, docWith({ 'LT-101': { 'alarm.L': '90', 'alarm.H': '10' } }))
    expect(found).toHaveLength(1)
    expect(alarmOrder.severity).toBe('critical')
  })

  it('ignores values it cannot read, leaving those to signal-data-invalid', () => {
    expect(run(alarmOrder, docWith({ 'LT-101': { 'alarm.L': 'low', 'alarm.H': '10' } }))).toHaveLength(0)
  })
})

describe('structurally invalid signal data', () => {
  it('reports a non-numeric limit or setpoint', () => {
    expect(run(signalDataInvalid, docWith({ 'LT-101': { 'alarm.H': 'ninety' } }))).toHaveLength(1)
    expect(run(signalDataInvalid, docWith({ 'LT-101': { 'signal.setpoint': 'mid' } }))).toHaveLength(1)
  })

  it('reports an I/O type that is not one, case-insensitively accepting real ones', () => {
    expect(run(signalDataInvalid, docWith({ 'LT-101': { 'signal.type': 'analogue' } }))).toHaveLength(1)
    for (const t of ['AI', 'ao', 'DI', 'Do']) {
      expect(run(signalDataInvalid, docWith({ 'LT-101': { 'signal.type': t } })), t).toHaveLength(0)
    }
  })

  it('reports a priority ISA-18.2 does not define', () => {
    expect(run(signalDataInvalid, docWith({ 'LT-101': { 'alarm.priority': 'urgent' } }))).toHaveLength(1)
    expect(run(signalDataInvalid, docWith({ 'LT-101': { 'alarm.priority': 'High' } }))).toHaveLength(0)
  })

  it('says nothing about an empty or absent record', () => {
    expect(run(signalDataInvalid, docWith({ 'LT-101': {} }))).toHaveLength(0)
    expect(run(signalDataInvalid, docWith({ 'LT-101': { 'alarm.H': '', 'signal.type': '  ' } }))).toHaveLength(0)
  })

  it('does not crash on an unknown or exotic value', () => {
    expect(() => run(signalDataInvalid, docWith({ 'LT-101': { 'signal.type': '¯\\_(ツ)_/¯', 'alarm.LL': 'NaN' } }))).not.toThrow()
  })
})

describe('alarms against the calibrated range', () => {
  it('passes when everything sits inside it', () => {
    expect(run(alarmOutsideRange, docWith({ 'LT-101': { 'signal.range': '0-10 bar', 'alarm.H': '8', 'signal.setpoint': '5' } }))).toHaveLength(0)
  })

  it('warns — not errors — when a limit is unreachable', () => {
    expect(run(alarmOutsideRange, docWith({ 'LT-101': { 'signal.range': '0-10 bar', 'alarm.HH': '12' } }))).toHaveLength(1)
    expect(alarmOutsideRange.severity).toBe('warning')
  })

  it('stays quiet when the range cannot be read — it invents no bounds', () => {
    expect(run(alarmOutsideRange, docWith({ 'LT-101': { 'signal.range': 'see datasheet', 'alarm.HH': '12' } }))).toHaveLength(0)
  })
})

describe('control system tags', () => {
  it('reports two instruments claiming one', () => {
    const found = run(duplicateSystemTag, docWith({
      'LT-101': { 'signal.systemTag': 'AI_0101' },
      'PT-200': { 'signal.systemTag': 'AI_0101' },
      'FT-300': { 'signal.systemTag': 'AI_0300' },
    }))
    expect(found).toHaveLength(2)
  })

  it('says nothing when they are distinct or absent', () => {
    expect(run(duplicateSystemTag, docWith({ 'LT-101': {}, 'PT-200': {} }))).toHaveLength(0)
  })
})

describe('an unreadable range', () => {
  it('is reported only when something would use the numbers', () => {
    expect(run(rangeUnreadable, docWith({ 'LT-101': { 'signal.range': 'wide' } }))).toHaveLength(0)
    expect(run(rangeUnreadable, docWith({ 'LT-101': { 'signal.range': 'wide', 'alarm.H': '8' } }))).toHaveLength(1)
    expect(rangeUnreadable.severity).toBe('info')
  })

  it('says nothing about a range it can read', () => {
    expect(run(rangeUnreadable, docWith({ 'LT-101': { 'signal.range': '0 to 10 bar', 'alarm.H': '8' } }))).toHaveLength(0)
  })
})
