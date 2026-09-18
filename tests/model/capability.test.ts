// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K27 — THE MODEL-TRUTH BOUNDARY, CHECKED AGAINST THE RUNTIME.
 *
 * ── THE AUDIT ─────────────────────────────────────────────────────────────
 *
 * All eighty-one declared fields, cross-checked against what the runtime
 * actually reads. Twenty-four are consumed; the rest a record may state and
 * nothing looks at. That is legitimate — a datasheet carries far more than a
 * simulator needs — and it is exactly why the classes have to be written down.
 *
 * ── THE ONE-DIRECTIONAL DANGER ────────────────────────────────────────────
 *
 * An item moving from ASSUMPTION to ENGINEERING because a convenient default
 * exists. Wiring a datasheet field into physics is a modelling decision with a
 * stated physical relationship behind it, not a matter of noticing that a
 * field with a plausible name is going spare.
 *
 * SO THE CENTRAL TEST HERE IS BEHAVIOURAL, not a restatement of the table: for
 * every field classed DECLARED it builds the same plant twice, once with the
 * field stated and once without, and runs both. If anybody ever wires one in
 * without reclassifying it, a test fails rather than a plant behaving
 * differently for a reason nobody wrote down.
 *
 * ── AND NOTHING WAS ADDED ─────────────────────────────────────────────────
 *
 * No field, no value, no serialization change. `EngineeringRecord.fields` is a
 * free-form `Record<string, string>`, so the stored shape never depended on
 * the catalogue in the first place — proven below rather than assumed.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { processFor } from '../../src/model/processData'
import { FIELD_CATALOG } from '../../src/model/fields'
import { DATASHEET_SECTIONS } from '../../src/model/datasheet'
import {
  DECLARED_ONLY, EQUIPMENT_CAPABILITY, NO_ENGINEERING_MAX_SPEED,
} from '../../src/model/capability'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

// ── The K15 plant, which every phase since has been measured on ─────────────

const plant: HmiScreen = {
  id: 'k27', name: 'K27', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const base = {
  'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %',
}
const reg = (pump: Record<string, string> = {}, valve: Record<string, string> = {}): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: { ...base, ...pump } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  ...(Object.keys(valve).length > 0
    ? { 'HV-9': { key: 'HV-9', kind: 'valve' as const, fields: valve } } : {}),
})

/** The same plant with NO turndown stated, for the absent-means-absent tests. */
const bare = (pump: Record<string, string> = {}): Registry => {
  const r = reg(pump)
  const { 'duty.minSpeed': _omit, ...rest } = r['P-1']!.fields
  return { ...r, 'P-1': { ...r['P-1']!, fields: rest } }
}

const sim = () => useSimStore.getState()
const start = (r: Registry) => { sim().exitRun(); sim().enterRun(plant, r) }
const advance = (n: number) => { for (let i = 0; i < n; i++) sim().tickOnce(1) }

/** Run the plant and reduce it to everything an observer could notice. */
const observe = (r: Registry): string => {
  start(r)
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  sim().writeTag('FIC-1', 'SP', 30)
  const trace: string[] = []
  for (let i = 0; i < 120; i++) {
    advance(1)
    if (i === 60) sim().writeTag('FIC-1', 'SP', 12)
    const p = sim().tags['P-1']!, v = sim().tags['HV-9']!, f = sim().tags['FIC-1']!
    const e = sim().pumpEnvelopes['P-1']!
    trace.push([p.SPD, p.RAMP, v.OP, v.POS, f.OP, f.PV, e.state, e.flowM3h]
      .map((x) => (typeof x === 'number' ? x.toFixed(9) : String(x))).join(','))
  }
  return trace.join('|')
}

beforeEach(() => { start(reg()) })

// ── §13. The boundary, and the rule that protects it ────────────────────────

describe('§13 — every DECLARED field leaves the simulation untouched', () => {
  /**
   * THE CENTRAL TEST. Not a restatement of the table: the same plant, run
   * twice, once with the field stated and once without. A field classed
   * DECLARED that ever starts mattering fails here.
   */
  const withField: Record<string, { pump?: Record<string, string>; valve?: Record<string, string> }> = {
    'duty.speed': { pump: { 'duty.speed': '2950 rpm' } },
    'duty.designTemperature': { pump: { 'duty.designTemperature': '180 °C' } },
    'element.cv': { valve: { 'element.cv': '120' } },
    'element.characteristic': { valve: { 'element.characteristic': 'Linear' } },
    'actuation.actuator': { valve: { 'actuation.actuator': 'Diaphragm, spring return' } },
  }

  it('the table covers every DECLARED field, and every one is exercised', () => {
    expect(DECLARED_ONLY.length).toBeGreaterThan(0)
    expect([...DECLARED_ONLY].sort()).toEqual(Object.keys(withField).sort())
  })

  for (const [field, cfg] of Object.entries(withField)) {
    it(`${field} changes nothing an observer could see`, () => {
      const without = observe(reg())
      const stated = observe(reg(cfg.pump ?? {}, cfg.valve ?? {}))
      expect(stated).toBe(without)
    })
  }

  it('...while an ENGINEERING field demonstrably DOES change the plant', () => {
    // the control: if `observe` could not tell the difference, the tests above
    // would pass for the wrong reason
    const without = observe(reg())
    const stated = observe(reg({ 'duty.minSpeed': '60 %' }))
    expect(stated).not.toBe(without)
  })
})

// ── A, B, R. Rated speed ────────────────────────────────────────────────────

describe('A, B, R — rated speed is rpm, and is not a ceiling', () => {
  it('A: `duty.speed` is declared, and its meaning is rpm', () => {
    const keys = new Set(
      Object.values(FIELD_CATALOG).flatMap((s) => s.flatMap((x) => x.fields.map((f) => f.key))))
    expect(keys.has('duty.speed')).toBe(true)
    expect(EQUIPMENT_CAPABILITY.find((f) => f.id === 'duty.speed')!.unit).toBe('rpm')
  })

  it('B, R: nothing reads it, and stating it does not change the runtime', () => {
    // on a record that states NO turndown, a rated speed does not become one
    const p = processFor(bare({ 'duty.speed': '2950 rpm' }), 'P-1')
    expect(p.minSpeedPct).toBeUndefined()
    expect((p as unknown as Record<string, unknown>).speedRpm).toBeUndefined()
    // ...and where a turndown IS stated, the rated speed does not move it
    expect(processFor(reg({ 'duty.speed': '2950 rpm' }), 'P-1').minSpeedPct).toBe(20)
    const c = buildSimModel(plant, reg({ 'duty.speed': '2950 rpm' }))
      .controllers.find((x) => x.tag === 'FIC-1')!
    expect(c.outMax).toBe(100)                       // the curve's domain, unchanged
  })

  it('B: and there is no relationship through which it COULD enter', () => {
    /**
     * The pump curve is parameterised by FRACTION of rated speed — the shaft
     * runs 0..1 and the affinity laws work on that fraction. Rated rpm never
     * appears, so there is no conversion to invent. It would become necessary
     * only if a maximum speed in rpm ever arrived, which is what it would be
     * converted against.
     */
    const a = observe(reg({ 'duty.speed': '1450 rpm' }))
    const b = observe(reg({ 'duty.speed': '2950 rpm' }))
    expect(a).toBe(b)                                // even doubling it does nothing
  })
})

// ── C, D, E, F. Minimum speed ───────────────────────────────────────────────

describe('C-F — the turndown, and K26’s rule preserved', () => {
  const turndown = (v?: string) =>
    processFor(v === undefined ? bare() : reg({ 'duty.minSpeed': v }), 'P-1').minSpeedPct

  it('C: a valid turndown is read, and reaches both of its enforcers', () => {
    expect(turndown('20 %')).toBe(20)
    expect(buildSimModel(plant, reg()).controllers.find((c) => c.tag === 'FIC-1')!.outMin)
      .toBe(20)
  })

  it('D: invalid is REFUSED, not clamped — K26’s rule, still holding', () => {
    for (const bad of ['-5 %', '150 %', 'abc', '20 rpm']) {
      expect(turndown(bad)).toBeUndefined()
    }
  })

  it('E: absent means no turndown is imposed', () => {
    expect(turndown()).toBeUndefined()
  })

  it('F: zero is a real statement and is kept', () => {
    expect(turndown('0 %')).toBe(0)
    // it agrees with absence in what the PLANT does, and differs in what the
    // RECORD says — which is `absent ≠ zero` holding, not failing
    expect(turndown('0 %')).not.toBe(turndown())
  })
})

// ── G. Maximum speed ────────────────────────────────────────────────────────

describe('G, §5 — there is no maximum-speed concept anywhere', () => {
  it('G: no field, under any of the names one might have', () => {
    expect(NO_ENGINEERING_MAX_SPEED).toBe(true)
    const keys = new Set(
      Object.values(FIELD_CATALOG).flatMap((s) => s.flatMap((x) => x.fields.map((f) => f.key)))
        .concat(Object.values(DATASHEET_SECTIONS).flatMap((s) => s.map((f) => f.key))))
    for (const k of ['duty.maxSpeed', 'duty.speedMax', 'duty.overspeed',
      'duty.motorLimit', 'duty.driveLimit', 'duty.ratedSpeedPct', 'duty.speedLimit']) {
      expect(keys.has(k)).toBe(false)
    }
  })

  it('G: and rated speed is NOT it — a machine may be commanded above rated', () => {
    /**
     * A rated speed is the speed a machine is designed to run AT, not a limit
     * it may not pass, and a drive commanded above rated is a real thing a
     * real plant does. K26 made the runtime say so: the finding names the
     * CURVE's domain and states explicitly that no maximum is on the record.
     */
    const noLoop: HmiScreen = { ...plant, widgets: plant.widgets.filter((w) => w.id !== 'fic') }
    sim().exitRun(); sim().enterRun(noLoop, reg({ 'duty.speed': '2950 rpm' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('P-1', 'SPD', 120); advance(20)
    expect(sim().tags['P-1']!.SPD).toBe(120)         // the command is not refused
    expect(sim().defs['P-1']!.minSpeedPct).toBe(20)  // and rated did not become a limit
  })
})

// ── H, I, J, K, L, M. The classification itself ─────────────────────────────

describe('H-M — engineering, assumption and domain, kept apart', () => {
  it('M: every entry carries a class, a meaning and a unit decision', () => {
    expect(EQUIPMENT_CAPABILITY.length).toBeGreaterThan(10)
    const ids = EQUIPMENT_CAPABILITY.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of EQUIPMENT_CAPABILITY) {
      expect(['ENGINEERING', 'DECLARED', 'ASSUMPTION', 'DOMAIN']).toContain(f.cls)
      expect(f.meaning.length).toBeGreaterThan(20)
    }
  })

  it('I, J, K: the three physical rates are ASSUMPTIONS, and say so', () => {
    for (const id of ['RAMP_S', 'COAST_S', 'STROKE_RATE']) {
      expect(EQUIPMENT_CAPABILITY.find((f) => f.id === id)!.cls).toBe('ASSUMPTION')
    }
  })

  it('H, L: the normalised ranges are DOMAINS, not limits anybody declared', () => {
    for (const id of ['speed 0-100 %', 'valve position 0-100 %', 'controller output 0-100 %']) {
      expect(EQUIPMENT_CAPABILITY.find((f) => f.id === id)!.cls).toBe('DOMAIN')
    }
  })

  it('M: an ENGINEERING entry names a field that really exists in a catalogue', () => {
    const keys = new Set(
      Object.values(FIELD_CATALOG).flatMap((s) => s.flatMap((x) => x.fields.map((f) => f.key))))
    for (const f of EQUIPMENT_CAPABILITY) {
      if (f.cls !== 'ENGINEERING' && f.cls !== 'DECLARED') continue
      expect(keys.has(f.id), `${f.id} is a real catalogue field`).toBe(true)
    }
  })

  it('N: every ENGINEERING and DECLARED entry states what ABSENT means', () => {
    for (const f of EQUIPMENT_CAPABILITY) {
      if (f.cls === 'ENGINEERING' || f.cls === 'DECLARED') {
        expect(f.absent, `${f.id} states its absent semantics`).toBeTruthy()
      } else {
        // an assumption or a domain has no absent state to describe
        expect(f.absent).toBeNull()
      }
    }
  })
})

// ── P, Q. Serialization ─────────────────────────────────────────────────────

describe('P, Q, §11 — nothing was added, and nothing could have broken', () => {
  it('P: the stored shape never depended on the catalogue', () => {
    /**
     * `EngineeringRecord.fields` is a free-form `Record<string, string>` keyed
     * by field id. A catalogue entry adds a row to a form; it does not change
     * what is written to disk. So adding a field could not break an existing
     * project — and NOT adding one, which is what K27 did, changes nothing at
     * all.
     */
    const doc: ProjectDoc = {
      ...createEmptyDoc('t'),
      hmiScreens: [plant],
      registry: reg({ 'duty.speed': '2950 rpm', 'a.field.nobody.declared': 'x' }),
    }
    const round = JSON.parse(JSON.stringify(doc)) as ProjectDoc
    // every key survives, declared or not — the record is a map, not a schema
    expect(round.registry!['P-1']!.fields['duty.speed']).toBe('2950 rpm')
    expect(round.registry!['P-1']!.fields['a.field.nobody.declared']).toBe('x')
  })

  it('Q: a project carrying an undeclared field still builds and runs', () => {
    const r = reg({ 'a.field.nobody.declared': 'x', 'duty.speed': '2950 rpm' })
    expect(() => buildSimModel(plant, r)).not.toThrow()
    expect(observe(r)).toBe(observe(reg()))
  })
})

// ── S-Y. Every phase before K27, and determinism ────────────────────────────

describe('S-Y — K21 through K26, and determinism', () => {
  const loopReg = (fields: Record<string, string>): Registry => ({
    ...reg(),
    'FIC-1': { key: 'FIC-1', kind: 'instrument', fields },
  })

  it('S: K21 output-rate limiting', () => {
    start(loopReg({ 'signal.outputRateLimit': '10 %/s' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'MODE', 0); sim().writeTag('FIC-1', 'OP', 40); advance(60)
    sim().writeTag('FIC-1', 'OP', 90); sim().tickOnce(1)
    expect(sim().tags['FIC-1']!.OPC).toBeCloseTo(50, 6)
  })

  it('T: K22 — SAT is the controller’s own travel', () => {
    start(reg())
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 58); advance(400)
    expect(sim().loops['FIC-1']!.saturated).toBe(1)
  })

  it('U: K23 setpoint limits', () => {
    start(loopReg({ 'signal.spHigh': '30' }))
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 50); advance(100)
    expect(sim().loops['FIC-1']!.spLimit!.limited).toBe(30)
  })

  it('V, W: K24/K25 — no cascade here, so no downstream state', () => {
    start(reg())
    sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('FIC-1', 'SP', 30); advance(200)
    expect(sim().loops['FIC-1']!.downstreamLimited).toBeUndefined()
    expect(sim().loops['FIC-1']!.authority).toBe('available')
  })

  it('X: K26 — the turndown refusal and the reworded envelope finding', () => {
    expect(processFor(reg({ 'duty.minSpeed': '150 %' }), 'P-1').minSpeedPct).toBeUndefined()
  })

  it('Y: deterministic — `observe` itself reproduces exactly', () => {
    expect(observe(reg())).toBe(observe(reg()))
  })
})
