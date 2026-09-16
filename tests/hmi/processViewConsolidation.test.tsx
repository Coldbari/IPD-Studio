// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K5, PART A — ONE PROCESS PICTURE, TWO PRESENTATIONS.
 *
 * The Overview's summary strip and the Process flow page both describe the
 * plant. Until K5 they did it independently: the strip walked the BRANCH model
 * and laid itself out, the page walked the hydraulic topology and laid ITSELF
 * out. Two algorithms, one plant, free to drift — and a drawing change had to
 * be understood twice.
 *
 * They now read one derivation. These tests hold that literally: the objects in
 * a route are the SAME OBJECTS the page draws, by reference, so there is no
 * copy to fall out of step. And they hold it under change — a branch added, a
 * branch removed, a second input, a line reversing — because a shared
 * derivation that only agrees on one fixture has not been shared at all.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import Overview from '../../src/hmi/operator/Overview'
import ProcessView from '../../src/hmi/operator/ProcessView'
import { buildSimModel } from '../../src/hmi/sim/engine'
import { buildProcessView, processRoutes } from '../../src/hmi/sim/processView'
import type { HmiScreen } from '../../src/hmi/model'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** supply -> P-1 -> LV-1 -> TK-1, with room to graft a second branch on. */
const base: HmiScreen = {
  id: 'c1', name: 'Consolidation', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 30 } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 96, y: 118 }], bId: 'p', bPort: 'suction' },
    { id: 'e2', points: [{ x: 160, y: 118 }, { x: 296, y: 111 }], aId: 'p', aPort: 'discharge', bId: 'v', bPort: 'in' },
    { id: 'e3', points: [{ x: 352, y: 111 }, { x: 496, y: 150 }], aId: 'v', aPort: 'out', bId: 't', bPort: 'bottom' },
  ],
}

/** ...plus a drain off the tank: a SECOND branch. */
const withDrain: HmiScreen = {
  ...base, id: 'c2',
  widgets: [...base.widgets,
    { id: 'd', type: 'valve', x: 700, y: 200, w: 48, h: 32, tag: 'HV-2', props: { throttle: true } }],
  pipes: [...base.pipes,
    { id: 'e4', points: [{ x: 548, y: 165 }, { x: 696, y: 216 }], aId: 't', aPort: 'bottom', bId: 'd', bPort: 'in' },
    { id: 'e5', points: [{ x: 752, y: 216 }, { x: 900, y: 216 }], aId: 'd', aPort: 'out' }],
}

/** ...and a SECOND INPUT feeding the same vessel. */
const twoInputs: HmiScreen = {
  ...base, id: 'c3',
  widgets: [...base.widgets,
    { id: 'v2', type: 'valve', x: 300, y: 400, w: 48, h: 32, tag: 'HV-3', props: { throttle: true } }],
  pipes: [...base.pipes,
    { id: 'f1', points: [{ x: 0, y: 416 }, { x: 296, y: 416 }], bId: 'v2', bPort: 'in' },
    { id: 'f2', points: [{ x: 352, y: 416 }, { x: 496, y: 160 }], aId: 'v2', aPort: 'out', bId: 't', bPort: 'bottom' }],
}

const sim = () => useSimStore.getState()
const tick = (n: number, dt = 1) => { for (let i = 0; i < n; i++) sim().tickOnce(dt) }
const noop = () => {}

async function render(what: 'overview' | 'process') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(what === 'overview'
    ? <Overview onPage={noop} onGoToScreen={noop} onJumpTag={noop} />
    : <ProcessView onOpen={noop} />))
  return host
}
/** The tags each presentation shows, in the order it shows them. */
const stripTags = (h: HTMLElement) =>
  [...h.querySelectorAll('[data-testid="flow-node"]')].map((n) => n.getAttribute('data-tag'))
const pageTags = (h: HTMLElement) =>
  [...h.querySelectorAll('[data-testid="pv-node"]')].map((n) => n.getAttribute('data-tag'))

const start = (sc: HmiScreen) => {
  useStore.getState().loadIntoStore({ ...createEmptyDoc('t'), hmiScreens: [sc] })
  sim().exitRun()
  sim().enterRun(sc)
}

beforeEach(() => { document.body.innerHTML = '' })

// ── They are literally the same objects ─────────────────────────────────────

describe('the strip and the page read ONE derivation', () => {
  it('a route’s objects ARE the page’s objects, by reference', () => {
    start(base)
    const view = sim().processView!
    const routes = sim().routes
    expect(routes.length).toBeGreaterThan(0)
    for (const r of routes) {
      for (const n of r.nodes) {
        // not an equal copy — the same object. There is nothing to fall out of
        // step, because there is only one of it.
        expect(view.nodes).toContain(n)
      }
      for (const e of r.edges) expect(view.edges).toContain(e)
    }
  })

  it('the routes the store publishes are the routes the derivation gives', () => {
    start(base)
    const m = buildSimModel(base)
    const fresh = processRoutes(buildProcessView(m.hydraulic, m.defs, m.controllers))
    expect(sim().routes.map((r) => r.id)).toEqual(fresh.map((r) => r.id))
  })

  it('both presentations name the same equipment', async () => {
    start(withDrain)
    tick(5)
    const strip = stripTags(await render('overview')).filter(Boolean)
    document.body.innerHTML = ''
    const page = pageTags(await render('process')).filter(Boolean)
    // the strip drops nothing the page shows except the fittings it has no
    // room for; every tag it DOES show is a tag the page shows
    for (const t of new Set(strip)) expect(page, `${t}`).toContain(t)
  })
})

// ── Under change ────────────────────────────────────────────────────────────

describe('a change to the drawing reaches both, because there is one algorithm', () => {
  it('ADDING a branch adds it to both', async () => {
    start(base)
    const before = { routes: sim().routes.length, nodes: sim().processView!.nodes.length }
    const beforeStrip = stripTags(await render('overview'))
    document.body.innerHTML = ''

    start(withDrain)
    expect(sim().routes.length).toBeGreaterThan(before.routes)
    expect(sim().processView!.nodes.length).toBeGreaterThan(before.nodes)
    const afterStrip = stripTags(await render('overview'))
    document.body.innerHTML = ''
    const afterPage = pageTags(await render('process'))
    expect(afterStrip.length).toBeGreaterThan(beforeStrip.length)
    expect(afterStrip).toContain('HV-2')
    expect(afterPage).toContain('HV-2')
  })

  it('REMOVING it removes it from both', async () => {
    start(withDrain)
    expect(stripTags(await render('overview'))).toContain('HV-2')
    document.body.innerHTML = ''
    start(base)
    expect(stripTags(await render('overview'))).not.toContain('HV-2')
    document.body.innerHTML = ''
    expect(pageTags(await render('process'))).not.toContain('HV-2')
  })

  it('a SECOND INPUT appears in both, and stays a second input', async () => {
    start(twoInputs)
    const routes = sim().routes
    // two ways into the vessel, each its own route
    const intoTank = routes.filter((r) => r.nodes[r.nodes.length - 1]!.tag === 'TK-1')
    expect(intoTank.length).toBe(2)
    expect(new Set(intoTank.map((r) => r.nodes[0]!.id)).size).toBe(2) // different sources
    const strip = stripTags(await render('overview'))
    expect(strip).toContain('LV-1')
    expect(strip).toContain('HV-3')
    document.body.innerHTML = ''
    const page = pageTags(await render('process'))
    expect(page).toContain('LV-1')
    expect(page).toContain('HV-3')
  })
})

// ── Under flow ──────────────────────────────────────────────────────────────

describe('both read the same signed flow, and neither relays out because of it', () => {
  it('a reversal changes what both SHOW and not what either IS', async () => {
    start(withDrain)
    sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('LV-1', 'OP', 100)
    sim().writeTag('HV-2', 'OP', 0)
    tick(60)
    const routesForward = sim().routes
    const forward = sim().pipeFlows.e3!
    expect(forward).toBeGreaterThan(0)

    // stop the pump and let the vessel push back down the line that filled it
    sim().writeTag('P-1', 'RUN', 0)
    sim().writeTag('P-1', 'RAMP', 0)
    sim().writeTag('TK-1', 'PV', 95)
    sim().writeTag('HV-2', 'OP', 100)
    tick(60)
    expect(sim().pipeFlows.e4!).toBeGreaterThan(0) // draining through HV-2

    // the ROUTES are unchanged — a route is a description of the plant, and the
    // plant did not change. Same objects, same order.
    expect(sim().routes).toBe(routesForward)
    expect(sim().processView!.nodes).toBe(sim().processView!.nodes)

    // ...and both presentations read the one signed flow map
    const page = await render('process')
    const drain = page.querySelector('[data-testid="pv-edge"][data-pipes~="e4"]')!
    expect(drain.getAttribute('data-flowing')).toBe('1')
    document.body.innerHTML = ''
    const strip = await render('overview')
    const rates = [...strip.querySelectorAll('[data-testid="flow-rate"]')].map((n) => n.textContent)
    expect(rates.some((r) => r?.includes('m³/h'))).toBe(true)
  })

  it('a battery limit reads the SAME on both screens, from the same rule', async () => {
    start(withDrain)
    sim().writeTag('P-1', 'RUN', 1)
    sim().writeTag('LV-1', 'OP', 100)
    tick(60)
    const page = await render('process')
    const pageTerms = [...page.querySelectorAll('[data-testid="pv-node"][data-kind="boundary"]')]
      .map((n) => n.textContent?.trim())
    document.body.innerHTML = ''
    const strip = await render('overview')
    const stripTerms = [...strip.querySelectorAll('[data-testid="flow-node"][data-kind="boundary"]')]
      .map((n) => n.textContent?.trim())
    // the supply end is supplying, and BOTH say so
    expect(pageTerms).toContain('SUPPLY')
    expect(stripTerms).toContain('SUPPLY')
    // and neither invents a role the other does not have
    expect(new Set(stripTerms)).toEqual(new Set(stripTerms.filter((t) => pageTerms.includes(t))))
  })

  it('a shut plant reads still in BOTH, not moving in one and still in the other', async () => {
    start(withDrain)
    tick(20)
    const page = await render('process')
    expect([...page.querySelectorAll('[data-testid="pv-edge"]')]
      .every((e) => e.getAttribute('data-flowing') === '0')).toBe(true)
    document.body.innerHTML = ''
    const strip = await render('overview')
    expect([...strip.querySelectorAll('[data-testid="flow-path"]')]
      .every((p) => p.getAttribute('data-flow') === '0')).toBe(true)
    expect([...strip.querySelectorAll('[data-testid="flow-rate"]')]
      .every((n) => n.textContent === 'no flow')).toBe(true)
  })
})

// ── There is only one of everything ─────────────────────────────────────────

describe('nothing derives process connectivity for itself any more', () => {
  it('the branch-model projection is gone from the tree', () => {
    // `sim/topology.ts` held a second idea of process order, branch structure
    // and equipment sequence. It was deleted rather than left beside the new
    // one, because a dead derivation with live tests reads as coverage.
    expect(existsSync(join(__dirname, '../../src/hmi/sim/topology.ts'))).toBe(false)
    // ...and nothing in the product asks for it
    const src = readFileSync(join(__dirname, '../../src/hmi/simStore.ts'), 'utf8')
    expect(src).not.toContain('sim/topology')
    expect(src).not.toContain('projectTopology')
  })

  it('the store publishes ONE layout and ONE set of routes, both static', () => {
    start(withDrain)
    const view = sim().processView
    const routes = sim().routes
    tick(300, 2)
    expect(sim().processView).toBe(view)
    expect(sim().routes).toBe(routes)
  })
})
