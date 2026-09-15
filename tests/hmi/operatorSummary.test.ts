// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP G — the numbers the operator workstation reports.
 *
 * Every page is a view of these derivations, so this is where the counts an
 * operator acts on are pinned. The rule they all follow: DERIVE from the
 * canonical runtime, never recompute. Equipment state comes from
 * `equipmentState()`, alarm priority from the alarm model, quality from the
 * quality model, units and ranges from the compiled TagDef.
 */

import { describe, expect, it } from 'vitest'
import {
  alarmCounts, alarmViewState, areaRows, equipmentCounts, equipmentRows,
  kpisByQuantity, measurementRows, processStatus, standingAlarms, trendSignals, worstByTag,
} from '../../src/hmi/operator/summary'
import type { AlarmRecord } from '../../src/hmi/sim/alarms'
import type { TagDef } from '../../src/hmi/sim/tags'
import type { HmiScreen } from '../../src/hmi/model'

const def = (d: Partial<TagDef> & { name: string; kind: TagDef['kind'] }): TagDef =>
  ({ min: 0, max: 100, ...d })

const defs: Record<string, TagDef> = {
  'P-101': def({ name: 'P-101', kind: 'motor' }),
  'P-102': def({ name: 'P-102', kind: 'motor' }),
  'LV-101': def({ name: 'LV-101', kind: 'valve' }),
  'HV-101': def({ name: 'HV-101', kind: 'valveOnOff' }),
  'TK-101': def({ name: 'TK-101', kind: 'tank', measures: 'level', unit: '%' }),
  'PT-101': def({ name: 'PT-101', kind: 'display', measures: 'pressure', unit: 'bar', max: 10 }),
  'LIC-101': def({ name: 'LIC-101', kind: 'controller', measures: 'level', unit: '%' }),
  'XI-9': def({ name: 'XI-9', kind: 'display' }),
}

const tags = {
  'P-101': { RUN: 1, RAMP: 1 },
  'P-102': { RUN: 0, RAMP: 0, FAULT: 1 },
  'LV-101': { OP: 60, POS: 55 },
  'HV-101': { OPEN: 1 },
  'TK-101': { PV: 42, P: 0.1, T: 20 },
  'PT-101': { PV: 4.2 },
  'LIC-101': { PV: 42, SP: 50, OP: 61, MODE: 1 },
  'XI-9': { PV: 30 },
}

const alarm = (a: Partial<AlarmRecord> & { id: string; tag: string }): AlarmRecord =>
  ({ level: 'H', phase: 'active', since: 10, priority: 'medium', ...a })

describe('alarm counts', () => {
  const list: AlarmRecord[] = [
    alarm({ id: 'a', tag: 'PT-101', priority: 'high' }),
    alarm({ id: 'b', tag: 'TK-101', priority: 'medium', phase: 'acked' }),
    alarm({ id: 'c', tag: 'TK-101', priority: 'low', phase: 'cleared' }),
    alarm({ id: 'd', tag: 'P-102', priority: 'high', sup: 'shelved' }),
    alarm({ id: 'e', tag: 'XI-9', priority: 'low', phase: 'pending' }),
  ]

  it('counts what is ANNUNCIATING — pending and suppressed are not', () => {
    const c = alarmCounts(list)
    expect(c.active).toBe(3)
    expect(standingAlarms(list).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('unacknowledged excludes acked but includes cleared-not-yet-acked', () => {
    expect(alarmCounts(list).unacked).toBe(2)
  })

  it('breaks down by priority and names the worst', () => {
    const c = alarmCounts(list)
    expect({ high: c.high, medium: c.medium, low: c.low }).toEqual({ high: 1, medium: 1, low: 1 })
    expect(c.worst).toBe('high')
    expect(c.suppressed).toBe(1)
  })

  it('a quiet plant counts zero and names no worst', () => {
    const c = alarmCounts([])
    expect(c).toMatchObject({ active: 0, unacked: 0, high: 0, medium: 0, low: 0, suppressed: 0 })
    // the key is ABSENT rather than present-and-undefined: there is no worst
    expect('worst' in c).toBe(false)
  })

  it('every lifecycle state is distinguishable — not folded into a boolean', () => {
    expect(alarmViewState(alarm({ id: '1', tag: 'T' }))).toBe('ACTIVE')
    expect(alarmViewState(alarm({ id: '2', tag: 'T', phase: 'acked' }))).toBe('ACKNOWLEDGED')
    expect(alarmViewState(alarm({ id: '3', tag: 'T', phase: 'cleared' }))).toBe('CLEARED')
    expect(alarmViewState(alarm({ id: '4', tag: 'T', phase: 'pending' }))).toBe('PENDING')
    expect(alarmViewState(alarm({ id: '5', tag: 'T', sup: 'shelved' }))).toBe('SHELVED')
    expect(alarmViewState(alarm({ id: '6', tag: 'T', sup: 'oos' }))).toBe('OUT OF SERVICE')
    expect(alarmViewState(alarm({ id: '7', tag: 'T', sup: 'design' }))).toBe('SUPPRESSED')
  })

  it('the worst alarm per tag is what a row badge shows', () => {
    const w = worstByTag([
      alarm({ id: 'x', tag: 'TK-101', priority: 'low' }),
      alarm({ id: 'y', tag: 'TK-101', priority: 'high' }),
    ])
    expect(w.get('TK-101')).toBe('high')
  })
})

describe('equipment rows', () => {
  const rows = equipmentRows(defs, tags, { alarms: [alarm({ id: 'a', tag: 'P-102', level: 'TRIP', priority: 'high' })], flows: { 'P-101': 48 } })
  const byTag = Object.fromEntries(rows.map((r) => [r.tag, r]))

  it('lists drives, valves and vessels — and nothing that is not equipment', () => {
    expect(rows.map((r) => r.tag).sort()).toEqual(['HV-101', 'LV-101', 'P-101', 'P-102', 'TK-101'])
  })

  it('drive state comes from equipmentState(), not from raw RUN/FAULT', () => {
    expect(byTag['P-101']!.state).toBe('running')
    expect(byTag['P-102']!.state).toBe('tripped')
    // a trip outranks the run command, which is the state machine's rule
    expect(equipmentRows(defs, { ...tags, 'P-102': { RUN: 1, RAMP: 1, FAULT: 1 } }, {})
      .find((r) => r.tag === 'P-102')!.state).toBe('tripped')
  })

  it('out of service reads DISABLED', () => {
    const r = equipmentRows(defs, tags, { oos: { 'P-101': true } }).find((x) => x.tag === 'P-101')!
    expect(r.state).toBe('disabled')
  })

  it('a throttling valve reports POSITION, an on/off one reports open or shut', () => {
    expect(byTag['LV-101']).toMatchObject({ kind: 'valve', value: 55, unit: '%' })
    expect(byTag['HV-101']).toMatchObject({ kind: 'valve', value: 100 })
  })

  it('a vessel reports its level in the unit its definition states', () => {
    expect(byTag['TK-101']).toMatchObject({ kind: 'vessel', value: 42, unit: '%' })
  })

  it('carries the live flow and the worst alarm on the tag', () => {
    expect(byTag['P-101']!.flow).toBe(48)
    expect(byTag['P-102']!.alarm).toBe('high')
    expect(byTag['P-101']!.alarm).toBeUndefined()
  })

  it('describes EQUIPMENT by what it is, never by expanding its letters', () => {
    // `TK-101` is a tank. Expanding its letters as ISA-5.1 function codes gives
    // "Temperature Control Station" — confidently wrong, and exactly the
    // collision that once made a temperature controller read a vessel's level.
    expect(byTag['TK-101']!.description).toBe('Vessel')
    expect(byTag['P-101']!.description).toBe('Pump / driver')
    expect(byTag['LV-101']!.description).toBe('Valve')
    for (const r of rows) expect(r.description).not.toMatch(/Temperature Control/i)
  })

  it('counts DRIVES only — a valve is not "running"', () => {
    const c = equipmentCounts(rows)
    expect(c).toEqual({ total: 2, running: 1, stopped: 0, faulted: 1 })
  })

  it('a starting or coasting drive counts as running, because it is turning', () => {
    const c = equipmentCounts(equipmentRows(defs, {
      'P-101': { RUN: 1, RAMP: 0.3 }, 'P-102': { RUN: 0, RAMP: 0.4 },
    }, {}))
    expect(c.running).toBe(2)
  })
})

describe('measurements', () => {
  const rows = measurementRows(defs, tags, {
    quality: { 'PT-101': { q: 'forced', why: 'forced by hand' }, 'XI-9': { q: 'uncertain', why: 'no model' } },
    alarms: [alarm({ id: 'a', tag: 'PT-101', priority: 'high' })],
  })
  const byTag = Object.fromEntries(rows.map((r) => [r.tag, r]))

  it('expands ISA letters for INSTRUMENTS, and only for instruments', () => {
    expect(byTag['PT-101']!.description).toMatch(/Pressure/i)
    expect(byTag['LIC-101']!.description).toMatch(/Level/i)
    expect(byTag['TK-101']!.description).toBe('Vessel')
  })

  it('covers measurements, controllers and vessels — not valves or drives', () => {
    expect(rows.map((r) => r.tag).sort()).toEqual(['LIC-101', 'PT-101', 'TK-101', 'XI-9'])
  })

  it('takes range and unit from the compiled definition', () => {
    expect(byTag['PT-101']).toMatchObject({ pv: 4.2, unit: 'bar', min: 0, max: 10, measures: 'pressure' })
  })

  it('names what is producing each value', () => {
    expect(byTag['TK-101']!.source).toBe('SIMULATION')
    expect(byTag['PT-101']!.source).toBe('FORCED')
    expect(byTag['XI-9']!.source).toBe('NO MODEL')
    expect(measurementRows(defs, {}).find((r) => r.tag === 'PT-101')!.source).toBe('NO PRODUCER')
  })

  it('carries the quality state rather than a second opinion about it', () => {
    expect(byTag['PT-101']!.quality).toEqual({ q: 'forced', why: 'forced by hand' })
    expect(byTag['TK-101']!.quality).toBeUndefined()
  })

  it('groups key values by quantity, and OMITS quantities nothing measures', () => {
    const groups = kpisByQuantity(rows)
    expect(groups.map((g) => g.measures)).toEqual(['level', 'pressure'])
    // nothing measures flow or temperature here, so neither appears at all
    expect(groups.find((g) => g.measures === 'flow')).toBeUndefined()
    expect(groups.find((g) => g.measures === 'temperature')).toBeUndefined()
  })

  it('a measurement with no value is left out of the KPIs rather than shown as a dash', () => {
    const noValue = measurementRows({ 'PT-9': def({ name: 'PT-9', kind: 'display', measures: 'pressure' }) }, {})
    expect(kpisByQuantity(noValue)).toEqual([])
  })
})

describe('process status', () => {
  const eq = (o: Partial<ReturnType<typeof equipmentCounts>>) =>
    ({ total: 2, running: 0, stopped: 2, faulted: 0, ...o })
  const al = (o: Partial<ReturnType<typeof alarmCounts>>) =>
    ({ active: 0, unacked: 0, high: 0, medium: 0, low: 0, suppressed: 0, ...o })

  it('nothing turning and nothing wrong reads STOPPED', () => {
    expect(processStatus(al({}), eq({}))).toBe('stopped')
  })
  it('a turning drive with no alarms reads RUNNING', () => {
    expect(processStatus(al({}), eq({ running: 1 }))).toBe('running')
  })
  it('a standing alarm reads ATTENTION', () => {
    expect(processStatus(al({ active: 1, medium: 1 }), eq({ running: 1 }))).toBe('attention')
  })
  it('a high alarm or a tripped drive reads ALARM, whichever is present', () => {
    expect(processStatus(al({ active: 1, high: 1 }), eq({ running: 1 }))).toBe('alarm')
    expect(processStatus(al({}), eq({ faulted: 1 }))).toBe('alarm')
  })
})

describe('process areas', () => {
  const screens: HmiScreen[] = [
    { id: 's1', name: 'Feed', theme: 'classic', pipes: [], widgets: [
      { id: 'a', type: 'pump', x: 0, y: 0, w: 10, h: 10, tag: 'P-101' },
      { id: 'b', type: 'tank', x: 0, y: 0, w: 10, h: 10, tag: 'TK-101' },
    ] },
    { id: 's2', name: 'Transfer', theme: 'classic', pipes: [], widgets: [
      { id: 'c', type: 'pump', x: 0, y: 0, w: 10, h: 10, tag: 'P-102' },
    ] },
  ]
  const rows = areaRows(screens, defs, tags, [alarm({ id: 'a', tag: 'P-102', priority: 'high' })])

  it('reports what each screen contains and whether it needs attention', () => {
    expect(rows[0]).toMatchObject({ screenId: 's1', name: 'Feed', running: 1, faulted: 0, alarms: 0 })
    expect(rows[1]).toMatchObject({ screenId: 's2', name: 'Transfer', running: 0, faulted: 1, alarms: 1, worst: 'high' })
  })

  it('an alarm on a tag no screen shows is attributed to no area', () => {
    const r = areaRows(screens, defs, tags, [alarm({ id: 'z', tag: 'GHOST-1' })])
    expect(r.every((a) => a.alarms === 0)).toBe(true)
  })
})

describe('trend signal catalogue', () => {
  const opts = trendSignals(defs)

  it('offers PV for measurements and PV/SP/OP for controllers — and nothing else', () => {
    const refs = opts.map((o) => o.ref).sort()
    expect(refs).toEqual([
      'LIC-101.OP', 'LIC-101.PV', 'LIC-101.SP',
      'PT-101.PV', 'TK-101.PV', 'XI-9.PV',
    ])
  })

  it('invents no tags: drives and valves record nothing to trend', () => {
    expect(opts.some((o) => o.tag.startsWith('P-'))).toBe(false)
    expect(opts.some((o) => o.tag.startsWith('LV-'))).toBe(false)
  })

  it('groups process measurements apart from control signals', () => {
    expect(opts.find((o) => o.ref === 'PT-101.PV')!.group).toBe('PROCESS')
    expect(opts.find((o) => o.ref === 'LIC-101.SP')!.group).toBe('CONTROL')
  })

  it('carries each signal’s canonical unit, and OP is per cent whatever the PV is', () => {
    expect(opts.find((o) => o.ref === 'PT-101.PV')!.unit).toBe('bar')
    expect(opts.find((o) => o.ref === 'LIC-101.PV')!.unit).toBe('%')
    expect(opts.find((o) => o.ref === 'LIC-101.OP')!.unit).toBe('%')
  })
})

describe('these derivations never mutate what they read', () => {
  it('leaves the alarm list, the tags and the definitions untouched', () => {
    const list = [alarm({ id: 'a', tag: 'PT-101' })]
    const snapshot = JSON.parse(JSON.stringify({ list, tags, defs }))
    alarmCounts(list)
    equipmentRows(defs, tags, { alarms: list })
    measurementRows(defs, tags, { alarms: list })
    trendSignals(defs)
    expect(JSON.parse(JSON.stringify({ list, tags, defs }))).toEqual(snapshot)
  })
})
