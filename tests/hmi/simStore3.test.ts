import { beforeEach, describe, expect, it } from 'vitest'
import { useSimStore } from '../../src/hmi/simStore'
import type { HmiScreen } from '../../src/hmi/model'

// controller loop so SP/OP series get recorded alongside PV
const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 't', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'LT-1', props: { level0: 40 } },
    { id: 'v', type: 'valve', x: 200, y: 0, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 'c', type: 'display', x: 400, y: 0, w: 96, h: 40, tag: 'LIC-1', props: { controller: true } },
    { id: 'p', type: 'pump', x: 600, y: 0, w: 56, h: 56, tag: 'P-1' },
  ],
  pipes: [],
}

const st = () => useSimStore.getState()
beforeEach(() => st().exitRun())

describe('signal-keyed history', () => {
  const win = (ref: string) => st().history.getSeries(ref, 0, 1e9)

  it('records PV for every tag and SP/OP for controllers', () => {
    st().enterRun(screen)
    // the fine tier samples once a SECOND, so five 0.2 s ticks are one sample —
    // capacity is time, not tick count
    for (let i = 0; i < 25; i++) st().tickOnce(0.2)
    expect(win('LT-1.PV').v.length).toBeGreaterThan(1)
    expect(win('LIC-1.PV').v.length).toBeGreaterThan(1)
    expect(win('LIC-1.SP').v.length).toBeGreaterThan(1)
    expect(win('LIC-1.OP').v.length).toBeGreaterThan(1)
    // motors have no PV — no phantom series
    expect(win('P-1.PV').v).toHaveLength(0)
    expect(win('P-1.RUN').v).toHaveLength(0)
    expect(st().history.refs()).not.toContain('P-1.RUN')
  })

  it('timestamps are SIMULATION time, so a speed change stays truthful', () => {
    st().enterRun(screen)
    st().tickOnce(1)   // 1x
    st().tickOnce(60)  // operator flipped to 300x: sixty process-seconds
    expect(win('LT-1.PV').t).toEqual([1, 61])
    expect(st().history.latestT).toBe(61)
  })
})
