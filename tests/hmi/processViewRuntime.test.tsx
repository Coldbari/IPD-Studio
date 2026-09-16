// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K4 — THE PROCESS VIEW SHOWS WHAT THE SOLVE SAYS, AND NOTHING ELSE.
 *
 * The derivation tests prove the picture describes the plant. These prove the
 * numbers and the motion on it come from the hydraulic solution:
 *
 *   - an FT reads the flow of ITS pipe, not a branch total
 *   - a PT reads the solved pressure of ITS line
 *   - a line animates only while something is passing through it, in the
 *     direction the SIGN says, and stops when it stops
 *   - a valve's position and its flow are shown as two different things
 *   - a vessel's level is its inventory and nothing else
 *   - a solve that cannot stand behind its numbers says so, and the view does
 *     not go on looking healthy
 *
 * Read off the rendered DOM, because that is what an operator actually sees.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import ProcessView from '../../src/hmi/operator/ProcessView'
import { SHUT_LEAK_MAX } from '../../src/hmi/sim/hydraulic/solver'
import { plant, registry, starvedRegistry } from './processView.fixture'
import type { Registry } from '../../src/model/registry'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}

let host: HTMLElement
let root: Root
const render = async () => {
  await act(async () => root.render(<ProcessView onOpen={() => {}} />))
  return host
}
/** The rendered edge carrying a given drawn pipe. */
const edgeEl = (pipe: string) =>
  host.querySelector<SVGGElement>(`[data-testid="pv-edge"][data-pipes~="${pipe}"]`)!
const nodeEl = (tag: string) =>
  host.querySelector<SVGGElement>(`[data-testid="pv-node"][data-tag="${tag}"]`)!
const instrumentEl = (tag: string) =>
  host.querySelector<SVGTextElement>(`[data-testid="pv-instrument"][data-tag="${tag}"]`)!
/** What an operator can read on an object or instrument. */
const textOf = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const start = (reg: Registry = registry) => {
  sim().exitRun()
  sim().enterRun(plant, reg)
}
/** Line up the plant and run the pump. FV and HV in hand, so a test owns them. */
const lineUp = (fv = 70, hv = 70, lv = 0) => {
  sim().writeTag('LIC-101', 'MODE', 0); sim().writeTag('LIC-101', 'OP', lv)
  sim().writeTag('FV-101', 'OP', fv)
  sim().writeTag('HV-102', 'OP', hv)
  sim().writeTag('P-101', 'RUN', 1)
}

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  start()
})
afterEach(async () => { await act(async () => root.unmount()) })

// ── Scenario A — normal flow ────────────────────────────────────────────────

describe('Scenario A — the plant is running', () => {
  it('every line that is carrying something is animated, forwards, and nothing else is', async () => {
    lineUp()
    advance(60)
    await render()
    for (const pipe of ['a1', 'a2', 'a3', 'b1', 'b2', 'a4', 'a5']) {
      const q = sim().pipeFlows[pipe]!
      const el = edgeEl(pipe)
      const moving = Math.abs(q) > SHUT_LEAK_MAX
      expect(el.getAttribute('data-flowing'), `${pipe} q=${q}`).toBe(moving ? '1' : '0')
      expect(el.getAttribute('data-direction')).toBe(moving ? (q < 0 ? 'reverse' : 'forward') : 'still')
    }
    // the drain is shut, so its line is drawn still even though it exists
    expect(edgeEl('c2').getAttribute('data-flowing')).toBe('0')
  })

  it('FT-101 shows the flow of ITS OWN pipe, to the number the solver produced', async () => {
    lineUp()
    advance(60)
    await render()
    const q = Math.abs(sim().pipeFlows.a2!)
    expect(q).toBeGreaterThan(1)
    // What is drawn is the TRANSMITTER's reading, which is the solved flow of
    // a2 plus that instrument's own noise — not the solved flow itself. Both
    // halves matter: the view must draw the tag's PV, and the tag's PV must be
    // the flow of ITS pipe.
    const pv = sim().tags['FT-101']!.PV!
    expect(textOf(instrumentEl('FT-101'))).toContain(pv.toFixed(1))
    const def = sim().defs['FT-101']!
    expect(Math.abs(pv - q)).toBeLessThan((def.max - def.min) * 0.008)
    // and NOT the total through the plant: a2 is one leg of two
    const total = Math.abs(sim().pipeFlows.a2!) + Math.abs(sim().pipeFlows.b2!)
    expect(Math.abs(pv - total)).toBeGreaterThan(1)
  })

  it('PT-101 shows the solved pressure of its line, with its unit', async () => {
    lineUp()
    advance(60)
    await render()
    // Again: what is drawn is the transmitter's reading, and the reading is
    // the SOLVED pressure of its line plus that instrument's noise.
    const p = sim().pipePressures.a3!
    const pv = sim().tags['PT-101']!.PV!
    expect(textOf(instrumentEl('PT-101'))).toContain(pv.toFixed(1))
    expect(textOf(instrumentEl('PT-101'))).toContain('bar')
    const def = sim().defs['PT-101']!
    expect(Math.abs(pv - p)).toBeLessThan((def.max - def.min) * 0.008)
    // and it is the pressure of a3 rather than of the line before the valve
    expect(Math.abs(p - sim().pipePressures.a2!)).toBeGreaterThan(0.5)
  })

  it('the vessel shows the level its inventory gives, and that level moves', async () => {
    lineUp()
    advance(60)
    const before = sim().tags['TK-A']!.PV!
    advance(900, 5)
    const after = sim().tags['TK-A']!.PV!
    expect(after).toBeGreaterThan(before)
    await render()
    expect(textOf(nodeEl('TK-A'))).toContain(after.toFixed(1))
    // the volume it holds, against its stated capacity — not a pixel height
    expect(textOf(nodeEl('TK-A'))).toContain('150')
    const liquid = nodeEl('TK-A').querySelector('[data-testid="pv-liquid"]')!
    const h = Number(liquid.getAttribute('height'))
    expect(h / (88 - 2)).toBeCloseTo(after / 100, 2)
  })

  it('the route is continuous: every line joins two objects that are drawn', async () => {
    lineUp()
    advance(30)
    await render()
    const drawn = new Set([...host.querySelectorAll('[data-testid="pv-node"]')].map((n) => n))
    expect(drawn.size).toBeGreaterThan(5)
    for (const e of sim().processView!.edges) {
      const el = host.querySelector(`[data-testid="pv-edge"][data-edge="${e.id}"]`)
      expect(el, e.id).not.toBeNull()
      const pts = el!.querySelector('polyline')!.getAttribute('points')!
      expect(pts.split(' ').length).toBeGreaterThanOrEqual(2)
    }
    // and every inline instrument is inside the line it belongs to, so it
    // cannot be read as belonging to a different one
    expect(edgeEl('a2').querySelector('[data-tag="FT-101"]')).not.toBeNull()
    expect(edgeEl('a3').querySelector('[data-tag="PT-101"]')).not.toBeNull()
    expect(edgeEl('a2').querySelector('[data-tag="PT-101"]')).toBeNull()
  })
})

// ── Scenario B — valve closure ──────────────────────────────────────────────

describe('Scenario B — closing the control valve', () => {
  it('resistance up, solved flow down, FT down, and the line eventually stops', async () => {
    lineUp(100, 0)
    advance(60)
    const open = Math.abs(sim().pipeFlows.a2!)
    await render()
    expect(edgeEl('a2').getAttribute('data-flowing')).toBe('1')
    const openText = textOf(instrumentEl('FT-101'))

    sim().writeTag('FV-101', 'OP', 20)
    advance(60)
    const part = Math.abs(sim().pipeFlows.a2!)
    await render()
    expect(part).toBeLessThan(open)
    expect(textOf(instrumentEl('FT-101'))).not.toBe(openText)
    expect(textOf(instrumentEl('FT-101'))).toContain(part.toFixed(1))

    sim().writeTag('FV-101', 'OP', 0)
    advance(60)
    await render()
    expect(Math.abs(sim().pipeFlows.a2!)).toBeLessThan(SHUT_LEAK_MAX)
    expect(edgeEl('a2').getAttribute('data-flowing')).toBe('0')
    expect(edgeEl('a2').querySelector('[data-testid="pv-arrow"]')).toBeNull()
  })

  it('a valve shows POSITION and FLOW as two different things', async () => {
    lineUp(100, 0)
    advance(60)
    await render()
    const t = textOf(nodeEl('FV-101'))
    expect(t).toContain('POS 100 %')
    // 100 % open is NOT 100 % of anything: the flow beside it is what the
    // hydraulic solve gave, and it is a rate in m³/h
    expect(t).toContain('m³/h')
    expect(t).toContain(Math.abs(sim().pipeFlows.a2!).toFixed(1))
  })
})

// ── Scenario C — pump trip ──────────────────────────────────────────────────

describe('Scenario C — the pump trips', () => {
  it('the state changes, the flow goes, and no moving flow is left behind', async () => {
    lineUp(100, 0)
    advance(60)
    await render()
    expect(nodeEl('P-101').getAttribute('data-state')).toBe('running')
    expect(edgeEl('a2').getAttribute('data-flowing')).toBe('1')

    sim().writeTag('P-101', 'FAULT', 1)
    advance(30)
    await render()
    expect(nodeEl('P-101').getAttribute('data-state')).toBe('tripped')
    expect(textOf(nodeEl('P-101'))).toContain('TRIPPED')
    // the pump does not imply flow it is not producing
    expect(Math.abs(sim().pipeFlows.a2!)).toBeLessThan(SHUT_LEAK_MAX)
    expect(edgeEl('a2').getAttribute('data-flowing')).toBe('0')
    expect(edgeEl('a1').getAttribute('data-flowing')).toBe('0')
    expect(edgeEl('a2').querySelector('[data-testid="pv-arrow"]')).toBeNull()

    // What motion IS left is real: with the machine stopped, what it put into
    // TK-A redistributes by gravity. That is a process, not a leftover
    // animation — so rather than demanding a still screen, assert the
    // invariant that makes the screen trustworthy either way.
    for (const e of sim().processView!.edges) {
      const q = e.pipeIds.reduce((m, p) => Math.max(m, Math.abs(sim().pipeFlows[p] ?? 0)), 0)
      const el = host.querySelector(`[data-testid="pv-edge"][data-edge="${e.id}"]`)!
      expect(el.getAttribute('data-flowing'), `${e.id} q=${q}`).toBe(q > SHUT_LEAK_MAX ? '1' : '0')
      expect(Boolean(el.querySelector('[data-testid="pv-arrow"]')), e.id).toBe(q > SHUT_LEAK_MAX)
    }
  })
})

// ── Scenario D — branch flow ────────────────────────────────────────────────

describe('Scenario D — two branches running at once', () => {
  it('each branch carries its OWN solved flow, and they are different numbers', async () => {
    lineUp(100, 40)
    advance(60)
    const a = Math.abs(sim().pipeFlows.a3!)
    const b = Math.abs(sim().pipeFlows.b2!)
    expect(a).toBeGreaterThan(0.5)
    expect(b).toBeGreaterThan(0.5)
    expect(Math.abs(a - b)).toBeGreaterThan(0.5) // genuinely different legs
    await render()
    // both feeds are drawn, separately, and both are live
    expect(edgeEl('a3').getAttribute('data-flowing')).toBe('1')
    expect(edgeEl('b2').getAttribute('data-flowing')).toBe('1')
    expect(edgeEl('a3').getAttribute('data-edge')).not.toBe(edgeEl('b2').getAttribute('data-edge'))
    // and the two destinations are separate lines carrying separate numbers,
    // not one shared total painted on both
    const toA = Math.abs(sim().pipeFlows.a4!)
    const toB = Math.abs(sim().pipeFlows.a5!)
    expect(toA).toBeGreaterThan(0.5)
    expect(toB).toBeGreaterThan(0.5)
    expect(Math.abs(toA - toB)).toBeGreaterThan(0.5)
    expect(edgeEl('a4').getAttribute('data-edge')).not.toBe(edgeEl('a5').getAttribute('data-edge'))
    // Mass balances at the tee, SIGNED — which is the only way to state it,
    // because the pump can push hard enough to send part of its delivery back
    // out through the second feed. Summing magnitudes would hide exactly that.
    const view = sim().processView!
    const tee = view.nodes.find((n) => n.tag === 'T-101')!
    let net = 0
    for (const e of view.edges) {
      const q = sim().pipeFlows[e.pipeIds[0]!] ?? 0
      if (e.to === tee.id) net += q
      if (e.from === tee.id) net -= q
    }
    expect(Math.abs(net)).toBeLessThan(0.01)
  })

  it('shutting one branch leaves the other running', async () => {
    lineUp(100, 100)
    advance(60)
    sim().writeTag('HV-102', 'OP', 0)
    advance(60)
    await render()
    expect(Math.abs(sim().pipeFlows.b2!)).toBeLessThan(SHUT_LEAK_MAX)
    expect(edgeEl('b2').getAttribute('data-flowing')).toBe('0')
    expect(edgeEl('a3').getAttribute('data-flowing')).toBe('1')
  })
})

// ── Scenario E — flow reversal ──────────────────────────────────────────────

describe('Scenario E — a line reverses', () => {
  it('the drawn direction is ignored; the SIGN of the solved flow decides', async () => {
    lineUp(100, 0)
    advance(120)
    await render()
    expect(sim().pipeFlows.a4!).toBeGreaterThan(0)
    expect(edgeEl('a4').getAttribute('data-direction')).toBe('forward')

    // stop the pump and leave TK-A high over an empty TK-B: the only pressure
    // left is TK-A's own head, so it drains back up the line that filled it
    sim().writeTag('P-101', 'RUN', 0)
    sim().writeTag('P-101', 'RAMP', 0)
    sim().writeTag('TK-A', 'PV', 90)
    sim().writeTag('TK-B', 'PV', 2)
    advance(120)
    await render()
    expect(sim().pipeFlows.a4!).toBeLessThan(0)
    expect(edgeEl('a4').getAttribute('data-direction')).toBe('reverse')
    expect(edgeEl('a4').getAttribute('data-flowing')).toBe('1')
    // the moving overlay runs the other way rather than the diagram relaying out
    const overlay = edgeEl('a4').querySelector<SVGElement>('.pv-flowing')!
    expect(overlay.style.animationDirection).toBe('reverse')
    // and the vessels moved the way the sign says
    expect(sim().tags['TK-A']!.PV!).toBeLessThan(90)
    expect(sim().tags['TK-B']!.PV!).toBeGreaterThan(2)
  })
})

// ── Scenario F — the solve cannot stand behind its numbers ──────────────────

describe('Scenario F — an invalid hydraulic state', () => {
  it('a cavitating plant SAYS SO, and the instrument on that line is not GOOD', async () => {
    start(starvedRegistry) // P-101 specified at 400 m³/h on a suction that cannot supply it
    lineUp(100, 0)
    advance(60)
    expect(sim().hydraulic.cavitating.length).toBeGreaterThan(0)
    await render()
    // the page says it plainly, in words
    const banner = host.querySelector('[data-testid="pv-degraded"]')
    expect(banner).not.toBeNull()
    expect(textOf(banner)).toMatch(/below absolute zero/i)
    // PG-102 is on the suction, whose node is the one that cavitated
    expect(sim().quality['PG-102']!.q).not.toBe('good')
    expect(sim().quality['PG-102']!.q).toBe('uncertain')
    expect(textOf(instrumentEl('PG-102'))).toContain('?') // the quality glyph
  })

  it('a pressure that is not a reading is NOT drawn as a believable number', async () => {
    start(starvedRegistry)
    lineUp(100, 0)
    advance(60)
    await render()
    // the number is still shown for an UNCERTAIN value — it is real, its
    // provenance is what is in question — but it is marked, so it can never be
    // read as a clean measurement
    const el = instrumentEl('PG-102')
    expect(el.querySelector('.pv-q')).not.toBeNull()
    expect(nodeEl('P-101')).not.toBeNull()
  })

  it('a value with NO number prints dashes rather than a plausible zero', async () => {
    lineUp(100, 40)
    advance(60)
    sim().writeTag('FT-101', 'BAD', 1) // instrument fault: there is no reading
    advance(2)
    await render()
    expect(sim().quality['FT-101']!.q).toBe('bad')
    expect(textOf(instrumentEl('FT-101'))).toContain('- - -')
    // the VALUE carries no number — the tag beside it legitimately does
    const value = instrumentEl('FT-101').querySelector('.pv-val')!
    expect(value.textContent).toBe('- - -')
    expect(value.textContent).not.toMatch(/\d/)
    // and the LINE is still carrying what it is carrying: a failed instrument
    // is not a failed process, and the view must not confuse the two
    expect(Math.abs(sim().pipeFlows.a2!)).toBeGreaterThan(1)
    expect(edgeEl('a2').getAttribute('data-flowing')).toBe('1')
  })
})

// ── Identity and safety ─────────────────────────────────────────────────────

describe('the view is a presentation and stays one', () => {
  it('clicking an object hands back the CANONICAL TAG, not an identity of its own', async () => {
    const opened: string[] = []
    lineUp()
    advance(10)
    await act(async () => root.render(<ProcessView onOpen={(t) => opened.push(t)} />))
    await act(async () => { nodeEl('P-101').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { nodeEl('TK-A').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(opened).toEqual(['P-101', 'TK-A'])
  })

  it('rendering it changes nothing in the store', async () => {
    lineUp()
    advance(30)
    const before = {
      tags: JSON.stringify(sim().tags),
      flows: JSON.stringify(sim().pipeFlows),
      view: sim().processView,
      t: sim().t,
    }
    await render()
    expect(JSON.stringify(sim().tags)).toBe(before.tags)
    expect(JSON.stringify(sim().pipeFlows)).toBe(before.flows)
    expect(sim().t).toBe(before.t)
    // and the layout is the SAME OBJECT: it is static for the run
    expect(sim().processView).toBe(before.view)
  })

  it('the layout is built once and never rebuilt by a tick', () => {
    const first = sim().processView
    advance(600, 10)
    expect(sim().processView).toBe(first)
    sim().reset()
    expect(sim().processView).toBe(first) // RESET restores state, not topology
    sim().exitRun()
    expect(sim().processView).toBeNull()
  })
})
