import { beforeEach, describe, expect, it } from 'vitest'
import { useSimStore } from '../../src/hmi/simStore'
import type { HmiScreen } from '../../src/hmi/model'
import type { CommandEvent } from '../../src/hmi/sim/alarms'

const screen: HmiScreen = {
  id: 's', name: 'S', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 50, level0: 40 } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 510, y: 100 }] },
  ],
}

const st = () => useSimStore.getState()

beforeEach(() => st().exitRun())

describe('operator command journal', () => {
  it('writeTag records a CMD event with before/after values', () => {
    st().enterRun(screen)
    st().writeTag('P-1', 'RUN', 1)
    const e = st().journal[0] as CommandEvent
    expect(e).toMatchObject({ what: 'CMD', tag: 'P-1', sig: 'RUN', from: 0, to: 1 })
  })

  it('a burst of writes to the same signal coalesces into one entry', () => {
    st().enterRun(screen)
    st().writeTag('P-1', 'RUN', 1)
    st().writeTag('TK-1', 'PV', 41)
    st().writeTag('TK-1', 'PV', 44)
    st().writeTag('TK-1', 'PV', 48)
    const cmds = st().journal.filter((e) => e.what === 'CMD')
    expect(cmds).toHaveLength(2) // P-1 start + one coalesced TK-1 adjust
    expect(cmds[0]).toMatchObject({ tag: 'TK-1', from: 40, to: 48 })
  })

  it('alarm ACK events still land alongside commands', () => {
    st().enterRun(screen)
    st().writeTag('P-1', 'RUN', 1)
    // 40 % -> the 90 % H limit is 25 m³ of a 50 m³ vessel: half an hour at 50 m³/h
    for (let i = 0; i < 80; i++) st().tickOnce(30)
    expect(st().alarms.length).toBeGreaterThan(0)
    st().ack()
    expect(st().journal.some((e) => e.what === 'ACK')).toBe(true)
    expect(st().journal.some((e) => e.what === 'CMD')).toBe(true)
  })
})

describe('equipment flows', () => {
  it('exposes the live flow through each pump and valve for faceplates', () => {
    st().enterRun(screen)
    st().tickOnce(0.2)
    expect(st().equipFlows['P-1']).toBe(0)
    st().writeTag('P-1', 'RUN', 1)
    st().tickOnce(0.2)
    expect(st().equipFlows['P-1']).toBeGreaterThan(0)
  })
})
