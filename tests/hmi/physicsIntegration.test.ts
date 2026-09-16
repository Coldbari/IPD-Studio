// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP B+E — the whole plant, end to end, through the real runtime store.
 *
 * The unit tests prove each mechanism. This one walks the scenario an operator
 * would: line up, start, watch the level and the pressure move, let the loop
 * take it, heat the contents, then RESET and check the plant really is back
 * where it started.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useSimStore } from '../../src/hmi/simStore'
import { DEFAULTS, SIM_SPEEDS, volumeMoved } from '../../src/hmi/sim/units'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

/**
 * source -> P-101 -> [e2 discharge] -> PV-101 -> [e3] -> EH-101 -> [e4] -> TK-101
 * PT-101 on the discharge, LT-101 and TT-101 on the vessel, PIC-101 controlling.
 */
const screen: HmiScreen = {
  id: 's', name: 'Unit 1', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'PV-101', props: { throttle: true } },
    { id: 'h', type: 'equip', x: 450, y: 95, w: 48, h: 48, tag: 'EH-101', props: { symbolId: 'heater.electric' } },
    { id: 't', type: 'tank', x: 650, y: 40, w: 96, h: 128, tag: 'TK-101', props: { level0: 20 } },
    { id: 'pt', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'PT-101', props: { bindPipe: 'e2' } },
    { id: 'lt', type: 'display', x: 900, y: 90, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-101' } },
    { id: 'tt', type: 'display', x: 900, y: 140, w: 96, h: 40, tag: 'TT-101', props: { bindTank: 'TK-101' } },
    { id: 'pic', type: 'display', x: 900, y: 190, w: 96, h: 40, tag: 'PIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 460, y: 118 }] },
    { id: 'e4', points: [{ x: 490, y: 118 }, { x: 660, y: 100 }] },
  ],
}

/** Capacity and duty stated properly, the way a specified plant would be. */
const registry: Registry = {
  'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
  'P-101': { key: 'P-101', kind: 'equipment', fields: { 'duty.capacity': '60 m³/h', 'duty.head': '45 m' } },
  'EH-101': { key: 'EH-101', kind: 'equipment', fields: { 'duty.power': '400 kW' } },
}

const sim = () => useSimStore.getState()
/** Advance `seconds` of PROCESS time, the way the 60x training speed does. */
const advance = (seconds: number, dt = 10) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const pv = (tag: string) => sim().tags[tag]!.PV!

beforeEach(() => {
  sim().exitRun()
  sim().enterRun(screen, registry)
})

describe('the plant compiles from engineering data', () => {
  it('takes capacity and duty off the records, not off the drawing', () => {
    const d = (tag: string) => sim().defs[tag]!
    expect(d('TK-101').capacity).toBe(200)
    expect(d('TK-101').capacityDefaulted).toBe(false)
    expect(d('P-101').ratedFlow).toBe(60)
    expect(d('P-101').head).toBeCloseTo(45 / 10.197, 3)
    expect(d('EH-101').heaterKw).toBe(400)
  })

  it('every measurement knows its quantity, unit and range', () => {
    expect(sim().defs['PT-101']).toMatchObject({ measures: 'pressure', unit: 'bar', min: 0, max: 10 })
    expect(sim().defs['LT-101']).toMatchObject({ measures: 'level', unit: '%' })
    expect(sim().defs['TT-101']).toMatchObject({ measures: 'temperature', unit: '°C' })
  })

  it('the controller controls PRESSURE — its ISA letter says so', () => {
    expect(sim().defs['PIC-101']!.measures).toBe('pressure')
  })
})

describe('a shift: start up, control, heat, reset', () => {
  it('starts calm — nothing turning, nothing flowing, nothing hot', () => {
    expect(sim().tags['P-101']!.RUN).toBe(0)
    expect(Object.values(sim().pipeFlows).every((f) => !f)).toBe(true)
    expect(pv('LT-101')).toBeCloseTo(20, 0)
    expect(sim().tags['TK-101']!.T).toBeCloseTo(DEFAULTS.ambientC, 0)
  })

  it('runs the whole scenario with every variable causally connected', () => {
    // 1. START THE PUMP — in MANUAL so the operator owns the valve
    sim().writeTag('PIC-101', 'MODE', 0)
    sim().writeTag('PIC-101', 'OP', 60)
    sim().writeTag('P-101', 'RUN', 1)
    advance(60, 1)

    // 2. FLOW DEVELOPS, and it is in m³/h
    const flow = Math.max(...Object.values(sim().pipeFlows))
    expect(flow).toBeGreaterThan(0)
    expect(flow).toBeLessThanOrEqual(60) // cannot exceed the pump's rated duty

    // 3. PRESSURE APPEARS on the discharge, and PT-101 reads it
    const press = pv('PT-101')
    expect(press).toBeGreaterThan(DEFAULTS.supplyPressureBar)
    expect(press).toBeCloseTo(sim().pipePressures.e2!, 1)

    // 4. THE LEVEL RISES BY EXACTLY WHAT THE FLOW PUT IN. Rather than a
    // magic number, assert the integration law itself, end to end through the
    // store: m³ = m³/h × s / 3600, over the vessel's real capacity.
    //
    // Against the VESSEL's level, not the transmitter's reading: LT-101 carries
    // measurement noise, and a law about the process should not be checked
    // through an instrument's jitter.
    const before = sim().tags['TK-101']!.PV!
    advance(1800)
    const after = sim().tags['TK-101']!.PV!
    const expectedRise = (volumeMoved(flow, 1800) / 200) * 100
    expect(after - before).toBeCloseTo(expectedRise, 1)
    expect(expectedRise).toBeGreaterThan(5) // the scenario has to actually move
    // and the transmitter agrees with the vessel, to within its noise
    expect(Math.abs(pv('LT-101') - after)).toBeLessThan(0.5)

    // 5. HAND THE VALVE TO THE CONTROLLER and watch it take the pressure to SP
    // 6 bar. This plant is not the one in `pressure.test.ts` — P-101 here is
    // 60 m³/h at 45 m and there is a heater in the line — so it has its own
    // range: sweeping the valve gives 4.76 bar wide open and 8.92 bar shut.
    // The 3 bar this step used before is below that floor, and the loop could
    // only saturate. 6 bar sits inside it with the valve near 70 % open.
    sim().writeTag('PIC-101', 'SP', 6)
    sim().writeTag('PIC-101', 'MODE', 1)
    advance(1800, 2)
    expect(Math.abs(pv('PT-101') - 6)).toBeLessThan(0.4)
    expect(sim().tags['PIC-101']!.OP!).toBeGreaterThan(0)
    expect(sim().tags['PIC-101']!.OP!).toBeLessThan(100)

    // 6. STOP THE PUMP and HEAT what is in the vessel. 400 kW into roughly
    // 90 m³ of water is about 1 °C every sixteen minutes — slow, and real.
    sim().writeTag('P-101', 'RUN', 0)
    const coldT = sim().tags['TK-101']!.T!
    sim().writeTag('EH-101', 'RUN', 1)
    advance(3 * 3600, 30)
    const hotT = sim().tags['TK-101']!.T!
    expect(hotT).toBeGreaterThan(coldT + 5)
    // TT-101 reads the contents, within its own noise: ±0.8 % of a 0-150 °C
    // span is ±0.6 °C, which is the instrument and not the process
    expect(Math.abs(pv('TT-101') - hotT)).toBeLessThan(1)

    // 7. TURN IT OFF: the contents cool towards ambient rather than freezing there
    sim().writeTag('EH-101', 'RUN', 0)
    advance(4 * 3600, 30)
    expect(sim().tags['TK-101']!.T!).toBeLessThan(hotT)

    // 8. RESET — every process variable back to its configured start
    sim().reset()
    expect(sim().t).toBe(0)
    expect(pv('LT-101')).toBeCloseTo(20, 5)
    expect(sim().tags['TK-101']!.T).toBeCloseTo(DEFAULTS.ambientC, 5)
    expect(sim().tags['TK-101']!.PV).toBe(20)
    expect(sim().tags['P-101']!.RUN).toBe(0)
    expect(sim().tags['EH-101']!.RUN).toBe(0)
    expect(sim().tags['PIC-101']!.MODE).toBe(1)
    expect(sim().alarms).toEqual([])
    expect(sim().journal).toEqual([])
    expect(Object.keys(sim().pipeFlows)).toHaveLength(0)
    expect(Object.keys(sim().pipePressures)).toHaveLength(0)
  })

  it('every quantity a display shows carries its engineering unit', () => {
    const unitOf = (tag: string) => sim().defs[tag]!.unit
    expect(unitOf('LT-101')).toBe('%')
    expect(unitOf('PT-101')).toBe('bar')
    expect(unitOf('TT-101')).toBe('°C')
  })
})

describe('training speed', () => {
  it('offers the accelerations a process this slow needs', () => {
    expect(SIM_SPEEDS).toEqual([1, 10, 60, 300])
  })

  it('a coarse step reaches the same state as a fine one', () => {
    const startUp = () => {
      sim().exitRun()
      sim().enterRun(screen, registry)
      sim().writeTag('PIC-101', 'MODE', 0)
      sim().writeTag('PIC-101', 'OP', 100)
      sim().writeTag('P-101', 'RUN', 1)
    }
    startUp()
    advance(600, 0.2) // 1x
    const fine = pv('LT-101')
    startUp()
    advance(600, 60) // 300x
    // Explicit integration at a 1 s sub-step differs from a 0.2 s step by a
    // fraction of a percent across a start-up transient. That is numerical
    // resolution, not a change of units or of model: the two agree to well
    // inside a quarter of a percent of the value.
    expect(Math.abs(pv('LT-101') - fine) / fine).toBeLessThan(0.005)
  })
})
