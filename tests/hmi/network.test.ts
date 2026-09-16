import { describe, expect, it } from 'vitest'
import { buildNetwork } from '../../src/hmi/sim/network'
import type { HmiScreen, HmiWidget, HmiPipe } from '../../src/hmi/model'

const W = (id: string, type: HmiWidget['type'], x: number, y: number, w: number, h: number, tag: string, props?: HmiWidget['props']): HmiWidget =>
  ({ id, type, x, y, w, h, tag, props })
const P = (id: string, ...pts: [number, number][]): HmiPipe =>
  ({ id, points: pts.map(([x, y]) => ({ x, y })) })
const S = (widgets: HmiWidget[], pipes: HmiPipe[]): HmiScreen =>
  ({ id: 's', name: 'S', theme: 'classic', widgets, pipes })

describe('buildNetwork', () => {
  it('chains source -> pump -> valve -> tank into one branch', () => {
    const screen = S(
      [W('p', 'pump', 100, 90, 56, 56, 'P-1'), W('v', 'valve', 300, 95, 48, 32, 'LV-1', { throttle: true }), W('t', 'tank', 500, 40, 96, 128, 'TK-1')],
      [P('e1', [0, 118], [110, 118]), P('e2', [150, 118], [310, 111]), P('e3', [340, 111], [510, 100])],
    )
    const net = buildNetwork(screen)
    expect(net.branches).toHaveLength(1)
    const b = net.branches[0]!
    expect(b.from).toEqual({ kind: 'source' })
    expect(b.to).toEqual({ kind: 'tank', tag: 'TK-1' })
    expect(b.pumps).toEqual(['P-1'])
    expect(b.valves).toEqual(['LV-1'])
    expect(b.pipeIds).toEqual(['e1', 'e2', 'e3'])
  })
  it('tank -> valve -> sink is a drain branch', () => {
    const screen = S(
      [W('t', 'tank', 0, 0, 96, 128, 'TK-1'), W('v', 'valve', 200, 150, 48, 32, 'HV-1')],
      [P('e1', [48, 120], [210, 166]), P('e2', [240, 166], [400, 166])],
    )
    const net = buildNetwork(screen)
    expect(net.branches).toHaveLength(1)
    expect(net.branches[0]!.from).toEqual({ kind: 'tank', tag: 'TK-1' })
    expect(net.branches[0]!.to).toEqual({ kind: 'sink' })
    expect(net.branches[0]!.valves).toEqual(['HV-1'])
  })
  it('marks tank connections as bottom or top (vent lines must not drain)', () => {
    const screen = S(
      [W('t', 'tank', 0, 0, 96, 128, 'TK-1')],
      [P('bot', [48, 120], [300, 200]), P('top', [48, 8], [300, 8])],
    )
    const net = buildNetwork(screen)
    const bot = net.branches.find((b) => b.pipeIds.includes('bot'))!
    const top = net.branches.find((b) => b.pipeIds.includes('top'))!
    expect(bot.fromBottom).toBe(true)
    expect(top.fromBottom).toBe(false)
  })
  it('a second pipe leaving a pump becomes a real leg (fan-out), never a fabricated source', () => {
    const screen = S(
      [W('t0', 'tank', 0, 80, 96, 128, 'TK-T'), W('p', 'pump', 200, 110, 56, 56, 'P-1'), W('ta', 'tank', 400, 0, 96, 128, 'TK-A'), W('tb', 'tank', 400, 300, 96, 128, 'TK-B')],
      [P('in', [90, 140], [210, 140]), P('outA', [250, 130], [410, 60]), P('outB', [250, 150], [410, 360])],
    )
    const net = buildNetwork(screen)
    expect(net.branches.filter((b) => b.from.kind === 'source')).toHaveLength(0)
    expect(net.branches).toHaveLength(2)
    expect(net.branches.every((b) => b.from.kind === 'tank' && b.from.tag === 'TK-T')).toBe(true)
  })
  it('two independent pipes make two branches', () => {
    const screen = S([], [P('a', [0, 0], [100, 0]), P('b', [0, 50], [100, 50])])
    const net = buildNetwork(screen)
    expect(net.branches).toHaveLength(2)
    // `pipeFlowMap` used to spread a branch's flow back over its pipes. It is
    // gone with the conductance model: a pipe's flow is its own hydraulic
    // edge's flow, published signed in `simStore.pipeFlows`.
  })
})

describe('endpoint attachment', () => {
  it('anchored pipe ends beat geometric lookup', () => {
    const screen = {
      id: 's', name: 'S', theme: 'classic' as const,
      widgets: [
        { id: 'tk', type: 'tank' as const, x: 100, y: 100, w: 96, h: 128, tag: 'TK-1' },
        // decoy valve overlapping the endpoint region, later in z-order
        { id: 'v', type: 'valve' as const, x: 130, y: 60, w: 48, h: 32, tag: 'HV-9' },
      ],
      pipes: [{ id: 'p1', points: [{ x: 0, y: 104 }, { x: 148, y: 104 }], bId: 'tk' }],
    }
    const net = buildNetwork(screen)
    expect(net.branches).toHaveLength(1)
    expect(net.branches[0]!.to).toEqual({ kind: 'tank', tag: 'TK-1' })
  })
  it('without anchors, exact containment beats an inflated near-miss later in z-order', () => {
    const screen = {
      id: 's', name: 'S', theme: 'classic' as const,
      widgets: [
        { id: 'tk', type: 'tank' as const, x: 100, y: 100, w: 96, h: 128, tag: 'TK-1' },
        { id: 'v', type: 'valve' as const, x: 120, y: 60, w: 48, h: 32, tag: 'HV-9' }, // inflated rect reaches y=106
      ],
      pipes: [{ id: 'p1', points: [{ x: 0, y: 106 }, { x: 144, y: 106 }] }],
    }
    const net = buildNetwork(screen)
    expect(net.branches[0]!.to).toEqual({ kind: 'tank', tag: 'TK-1' })
  })
})
