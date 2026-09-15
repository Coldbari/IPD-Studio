import { beforeEach, describe, expect, it } from 'vitest'
import { useSimStore } from '../../src/hmi/simStore'
import type { HmiScreen } from '../../src/hmi/model'
import { COARSE_PERIOD_S, FINE_WINDOW_S } from '../../src/hmi/sim/history'

const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 50, level0: 88, H: 90 } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 510, y: 100 }] },
  ],
}

beforeEach(() => useSimStore.getState().exitRun())

describe('simStore', () => {
  it('enterRun compiles and seeds; tickOnce advances time and history', () => {
    const st = () => useSimStore.getState()
    st().enterRun(screen)
    expect(st().mode).toBe('run')
    expect(st().tags['TK-1']!.PV).toBe(88)
    st().tickOnce(0.2)
    expect(st().t).toBeCloseTo(0.2)
    expect(st().history.getSeries('TK-1.PV', 0, 10).v).toHaveLength(1)
    expect(st().history.latestT).toBeCloseTo(0.2)
    expect(st().historyVersion).toBe(1)
  })
  it('pump start fills tank through the pipes and raises the H alarm; ack works', () => {
    const st = () => useSimStore.getState()
    st().enterRun(screen)
    st().writeTag('P-1', 'RUN', 1)
    st().tickOnce(0.2)
    expect(st().pipeFlows.e1).toBeGreaterThan(0)   // flowing while filling (stops once full)
    // 88 % -> past the 90 % H limit is 1 m³ of a 50 m³ vessel: ~72 s at 50 m³/h
    for (let i = 0; i < 60; i++) st().tickOnce(2)
    expect(st().tags['TK-1']!.PV).toBeGreaterThan(90)
    expect(st().alarms.some((a) => a.id === 'TK-1:H' && a.phase === 'active')).toBe(true)
    st().ack()
    expect(st().alarms[0]!.phase).toBe('acked')
  })
  it('reset restores initial state; writeTag accepts TAG.SIGNAL form', () => {
    const st = () => useSimStore.getState()
    st().enterRun(screen)
    st().writeTag('P-1.RUN', '', 1)
    expect(st().tags['P-1']!.RUN).toBe(1)
    for (let i = 0; i < 10; i++) st().tickOnce(0.2)
    st().reset()
    expect(st().t).toBe(0)
    expect(st().tags['TK-1']!.PV).toBe(88)
    expect(st().history.getSeries('TK-1.PV', 0, 10).v).toHaveLength(0)
    expect(st().history.latestT).toBe(0)
  })
  it('history is bounded by TIME, not by a sample count', () => {
    // The old buffer capped at 1200 SAMPLES, so the window it covered depended
    // on how fast the simulation happened to be running — four minutes at 1×,
    // twenty at 5×. It is now a fixed span whatever the step size.
    const st = () => useSimStore.getState()
    st().enterRun(screen)
    for (let i = 0; i < 600; i++) st().tickOnce(2) // 20 process-minutes
    const all = st().history.getSeries('TK-1.PV', 0, st().history.latestT)
    expect(st().history.latestT).toBeCloseTo(1200)
    // the fine tier only reaches back five minutes; older data lives coarse
    const fine = st().history.getSeries('TK-1.PV', 1200 - FINE_WINDOW_S, 1200)
    expect(fine.t[0]!).toBeGreaterThanOrEqual(1200 - FINE_WINDOW_S)
    // and the whole 20 minutes is still retrievable, at coarse resolution —
    // whose newest sample can be up to one 10 s period behind the live value
    expect(all.t[0]!).toBeLessThan(FINE_WINDOW_S)
    expect(1200 - all.t[all.t.length - 1]!).toBeLessThanOrEqual(COARSE_PERIOD_S)
  })
})
