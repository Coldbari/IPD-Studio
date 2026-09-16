// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP H — the overview's simplified process flow.
 *
 * What matters is that it is a PROJECTION rather than a second description of
 * the plant: change the drawing, and the picture changes with it, because
 * there is only one topology.
 *
 * K5 made that literally true. This strip used to walk the BRANCH model and
 * lay itself out, while the Process flow page walked the hydraulic topology
 * and laid ITSELF out — one plant, two independent algorithms, free to drift.
 * Both now read `processRoutes`, which projects the same `ProcessViewModel`
 * the Process flow page draws. The tests below are the old ones, moved onto
 * the shared derivation with their claims unchanged.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import Overview from '../../src/hmi/operator/Overview'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { buildProcessView, processRoutes } from '../../src/hmi/sim/processView'
import type { HmiScreen } from '../../src/hmi/model'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** supply -> P-101 -> LV-101 -> TK-101 */
const screen: HmiScreen = {
  id: 'scr1', name: 'Feed area', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { level0: 30 } },
    { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-101' } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
}

const sim = () => useSimStore.getState()
const tick = (n: number, dt = 1) => { for (let i = 0; i < n; i++) sim().tickOnce(dt) }
const noop = () => {}

async function view(onJump: (t: string) => void = noop) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(
    <Overview onPage={noop} onGoToScreen={noop} onJumpTag={onJump} />))
  return host
}
const nodes = (h: HTMLElement) => [...h.querySelectorAll('[data-testid="flow-node"]')]

beforeEach(() => {
  document.body.innerHTML = ''
  useStore.getState().loadIntoStore({ ...createEmptyDoc('t'), hmiScreens: [screen] })
  sim().exitRun()
  sim().enterRun(screen)
})

/** The routes for a screen, through the one derivation both pages use. */
const routesOf = (sc: HmiScreen) => {
  const m = buildSimModel(sc)
  return processRoutes(buildProcessView(m.hydraulic, m.defs, m.controllers))
}

describe('the projection', () => {
  it('reads a route the way a person does: where from, through what, to where', () => {
    const routes = routesOf(screen)
    expect(routes).toHaveLength(1)
    expect(routes[0]!.nodes.map((n) => `${n.kind}:${n.tag ?? ''}`)).toEqual([
      'boundary:', 'pump:P-101', 'valve:LV-101', 'vessel:TK-101',
    ])
    // and it carries the EDGES between them, so the strip reads live flow per
    // line rather than one number chosen for the whole route
    expect(routes[0]!.edges).toHaveLength(3)
    expect(routes[0]!.edges.flatMap((e) => e.pipeIds)).toEqual(['e1', 'e2', 'e3'])
  })

  it('drops a bare stub that carries no equipment — it tells an operator nothing', () => {
    const stub: HmiScreen = {
      ...screen, id: 's2',
      pipes: [...screen.pipes, { id: 'z', points: [{ x: 0, y: 400 }, { x: 900, y: 400 }] }],
    }
    expect(routesOf(stub)).toHaveLength(1)
  })

  it('is the SOLVER’s topology, so a changed drawing changes the picture', () => {
    const extended: HmiScreen = {
      ...screen, id: 's3',
      widgets: [...screen.widgets,
        { id: 'h', type: 'valve', x: 650, y: 200, w: 48, h: 32, tag: 'HV-102' }],
      pipes: [...screen.pipes,
        { id: 'e4', points: [{ x: 548, y: 160 }, { x: 660, y: 210 }] },
        { id: 'e5', points: [{ x: 692, y: 210 }, { x: 860, y: 210 }] }],
    }
    const drain = routesOf(extended).find((r) => r.nodes.some((n) => n.tag === 'HV-102'))!
    expect(drain.nodes.map((n) => n.kind)).toEqual(['vessel', 'valve', 'boundary'])
  })

  it('a vessel ENDS a route: what arrives has arrived, and what leaves is another stream', () => {
    const extended: HmiScreen = {
      ...screen, id: 's5',
      widgets: [...screen.widgets,
        { id: 'h', type: 'valve', x: 650, y: 200, w: 48, h: 32, tag: 'HV-102' }],
      pipes: [...screen.pipes,
        { id: 'e4', points: [{ x: 548, y: 160 }, { x: 660, y: 210 }] },
        { id: 'e5', points: [{ x: 692, y: 210 }, { x: 860, y: 210 }] }],
    }
    const routes = routesOf(extended)
    expect(routes).toHaveLength(2)
    for (const r of routes) {
      const middle = r.nodes.slice(1, -1)
      expect(middle.some((n) => n.kind === 'vessel')).toBe(false)
    }
  })
})

describe('the drawn flowsheet', () => {
  it('shows every object on the path, terminals included', async () => {
    const host = await view()
    expect(host.querySelector('[data-testid="op-flowsheet"]')).not.toBeNull()
    const ns = nodes(host)
    // the kinds are the PROCESS VIEW's, because that is where they now come
    // from: a boundary rather than a 'source', a vessel rather than a 'tank'
    expect(ns.map((n) => n.getAttribute('data-kind'))).toEqual(['boundary', 'pump', 'valve', 'vessel'])
    // BOUNDARY, not SUPPLY: nothing is running, so this battery limit is not
    // supplying anything. Which it IS comes from the sign of the solved flow —
    // the same rule the Process flow page uses — and not from where it happens
    // to sit in the route.
    expect(ns[0]!.textContent).toContain('BOUNDARY')
    expect(ns[1]!.textContent).toContain('P-101')
    expect(ns[3]!.textContent).toContain('TK-101')
  })

  it('a battery limit says SUPPLY once it is actually supplying', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('LV-101', 'OP', 100)
    tick(20)
    const host = await view()
    expect(nodes(host)[0]!.textContent).toContain('SUPPLY')
  })

  it('carries each object’s live state and key value', async () => {
    const host = await view()
    const pump = nodes(host).find((n) => n.getAttribute('data-tag') === 'P-101')!
    expect(pump.getAttribute('data-state')).toBe('stopped')
    expect(pump.textContent).toContain('STOPPED')
    const tank = nodes(host).find((n) => n.getAttribute('data-tag') === 'TK-101')!
    expect(tank.textContent).toMatch(/30 %/)
  })

  it('follows the plant when equipment state changes', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    tick(10)
    const host = await view()
    const pump = nodes(host).find((n) => n.getAttribute('data-tag') === 'P-101')!
    expect(pump.getAttribute('data-state')).toBe('running')
    expect(pump.textContent).toContain('RUNNING')

    document.body.innerHTML = ''
    sim().writeTag('P-101', 'FAULT', 1)
    tick(2)
    const after = await view()
    const tripped = nodes(after).find((n) => n.getAttribute('data-tag') === 'P-101')!
    expect(tripped.getAttribute('data-state')).toBe('tripped')
    expect(tripped.textContent).toContain('TRIPPED')
  })

  it('marks an object that is in alarm', async () => {
    sim().writeTag('TK-101', 'PV', 97)
    tick(2)
    const host = await view()
    const tank = nodes(host).find((n) => n.getAttribute('data-tag') === 'TK-101')!
    expect(tank.getAttribute('data-alarm')).toBe('high')
  })

  it('lights the arrows only where something is actually flowing', async () => {
    const still = await view()
    expect(still.querySelector('[data-testid="flow-path"]')!.getAttribute('data-flow')).toBe('0')
    expect(still.querySelector('[data-testid="flow-rate"]')!.textContent).toBe('no flow')

    document.body.innerHTML = ''
    sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('LV-101', 'OP', 100)
    tick(20)
    const moving = await view()
    expect(moving.querySelector('[data-testid="flow-path"]')!.getAttribute('data-flow')).toBe('1')
    expect(moving.querySelector('[data-testid="flow-rate"]')!.textContent).toContain('m³/h')
  })

  it('clicking an object asks to show it, through the one navigation path', async () => {
    let jumped: string | null = null
    const host = await view((t) => { jumped = t })
    const pump = nodes(host).find((n) => n.getAttribute('data-tag') === 'P-101')! as HTMLElement
    await act(async () => pump.click())
    expect(jumped).toBe('P-101')
  })

  it('a terminal is not clickable — there is nothing to show', async () => {
    const host = await view()
    const supply = nodes(host)[0]!
    expect(supply.tagName).toBe('DIV')
    expect(supply.className).toContain('term')
  })

  it('a plant with no piping shows no flowsheet rather than an empty frame', async () => {
    const bare: HmiScreen = { ...screen, id: 's4', pipes: [] }
    sim().exitRun()
    sim().enterRun(bare)
    const host = await view()
    expect(host.querySelector('[data-testid="op-flowsheet"]')).toBeNull()
  })

  it('RESET returns it to the initial picture', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    tick(10)
    sim().reset()
    const host = await view()
    const pump = nodes(host).find((n) => n.getAttribute('data-tag') === 'P-101')!
    expect(pump.getAttribute('data-state')).toBe('stopped')
    expect(host.querySelector('[data-testid="flow-rate"]')!.textContent).toBe('no flow')
  })
})
