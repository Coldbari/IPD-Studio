// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K9 — THE OPERATOR CAN SEE WHICH TRUTH IS IN FORCE.
 *
 * A battery limit's record says 3 barg. Today it is at 1. Both are true, they
 * are different kinds of truth, and the page exists so an operator never has to
 * guess which one the plant is currently running on.
 *
 * Three things these tests hold:
 *
 *  1. THE PAGE CALCULATES NOTHING. An override is a boundary condition handed
 *     to the solver; every number beside it is read back out of the solved
 *     state. A test drives an override through the UI and checks the flow, the
 *     pressure and the TRANSMITTERS moved — a display-only override fails.
 *  2. "OBSERVED" IS NOT A PROPERTY OF THE TERMINAL. Supplying or receiving is
 *     the sign of the solved flow, and the same terminal, unchanged, reads
 *     differently when the pressures around it change.
 *  3. A SCENARIO IS NOT AN ALARM. An override is a legitimate operating state
 *     and is marked as one. The alarm treatment is reserved for a scenario
 *     PROBLEM — something the operator asked for that is not in effect.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import ScenarioPage from '../../src/hmi/operator/ScenarioPage'
import { formatBarg } from '../../src/hmi/sim/scenario'
import { DEFAULTS } from '../../src/hmi/sim/units'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** BL-S ─a1─ P-1 ─a2─ FV-1 ─a3─ TK-1 ─a4─ LV-1 ─a5─ BL-D, PT/FT/LT on it. */
const plant: HmiScreen = {
  id: 'k9', name: 'K9', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'fv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'FV-1', props: { throttle: true } },
    { id: 't', type: 'tank', x: 600, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 40 } },
    { id: 'lv', type: 'valve', x: 820, y: 180, w: 48, h: 32, tag: 'LV-1', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 1000, y: 180, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'pt', type: 'display', x: 1200, y: 40, w: 96, h: 40, tag: 'PT-1', props: { bindPipe: 'a2' } },
    { id: 'ft', type: 'display', x: 1200, y: 90, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a3' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'fv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 596, y: 150 }], aId: 'fv', aPort: 'out', bId: 't', bPort: 'bottom' },
    { id: 'a4', points: [{ x: 648, y: 165 }, { x: 816, y: 196 }], aId: 't', aPort: 'bottom', bId: 'lv', bPort: 'in' },
    { id: 'a5', points: [{ x: 872, y: 196 }, { x: 1004, y: 192 }], aId: 'lv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const registry: Registry = {
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '3 barg', 'general.service': 'Feed header' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg', 'general.service': 'Product outlet' } },
  'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '200 m³' } },
}

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}
const lineUp = () => {
  sim().writeTag('FV-1', 'OP', 100)
  sim().writeTag('LV-1', 'OP', 100)
  sim().writeTag('P-1', 'RUN', 1)
}

let host: HTMLElement
let root: Root
const render = async () => {
  await act(async () => root.render(<ScenarioPage />))
  return host
}
const row = (tag: string) =>
  host.querySelector<HTMLTableRowElement>(`[data-testid="scn-terminal"][data-tag="${tag}"]`)!
const cell = (tag: string, id: string) =>
  row(tag).querySelector(`[data-testid="${id}"]`)!.textContent!.trim()
/** Drive the page the way an operator would. */
const override = async (tag: string, text: string) => {
  const input = row(tag).querySelector<HTMLInputElement>('[data-testid="scn-input"]')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    row(tag).querySelector<HTMLButtonElement>('[data-testid="scn-apply"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await render()
}

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  sim().exitRun()
  sim().enterRun(plant, registry)
})
afterEach(async () => { await act(async () => root.unmount()) })

// ── §1, §2, §10. What the page shows ────────────────────────────────────────

describe('the page shows both truths, side by side', () => {
  it('a terminal on its records reads Engineering, with the record’s pressure', async () => {
    await render()
    expect(cell('BL-S', 'scn-engineering')).toBe('3.0 barg')
    expect(cell('BL-S', 'scn-active')).toBe('3.0 barg')
    expect(cell('BL-S', 'scn-source')).toBe('Engineering')
    expect(cell('BL-S', 'scn-desc')).toBe('Feed header')
    expect(host.querySelector('[data-testid="scn-state"]')!.textContent)
      .toMatch(/no scenario applied/i)
  })

  it('§10: EVERY terminal keeps its own identity, pressure and source', async () => {
    await render()
    expect(host.querySelectorAll('[data-testid="scn-terminal"]')).toHaveLength(2)
    expect(cell('BL-S', 'scn-active')).toBe('3.0 barg')
    expect(cell('BL-D', 'scn-active')).toBe('1.0 barg')
    // not collapsed into one plant pressure
    expect(cell('BL-S', 'scn-active')).not.toBe(cell('BL-D', 'scn-active'))
  })

  it('an override reads Scenario, and the ENGINEERING column still shows the record', async () => {
    await render()
    await override('BL-S', '2 barg')
    expect(cell('BL-S', 'scn-active')).toBe('2.0 barg')
    expect(cell('BL-S', 'scn-engineering')).toBe('3.0 barg')
    expect(cell('BL-S', 'scn-source')).toBe('Scenario')
    // ...and the untouched one is unchanged
    expect(cell('BL-D', 'scn-source')).toBe('Engineering')
  })

  it('the pressure is shown in the canonical gauge representation, not a new one', () => {
    expect(formatBarg(4)).toBe('3.0 barg')
    expect(formatBarg(DEFAULTS.atmosphericPressureBar)).toBe('0.0 barg')
  })
})

// ── §3, §9. It is causal ────────────────────────────────────────────────────

describe('§9 — an override drives the SOLVE, and the measurements follow it', () => {
  it('overriding from the page moves flow, pressure and the transmitters', async () => {
    lineUp(); advance(60)
    await render()
    const before = {
      flow: sim().pipeFlows.a3!,
      pressure: sim().pipePressures.a2!,
      pt: sim().tags['PT-1']!.PV!,
      ft: sim().tags['FT-1']!.PV!,
    }

    await override('BL-S', '1 barg')   // the header sags
    advance(60)

    expect(sim().pipeFlows.a3!).toBeLessThan(before.flow)
    expect(sim().pipePressures.a2!).toBeLessThan(before.pressure)
    expect(sim().tags['PT-1']!.PV!).toBeLessThan(before.pt)
    expect(sim().tags['FT-1']!.PV!).toBeLessThan(before.ft)
    // THE TRANSMITTER READS ITS OWN LINE, not the number typed into the page
    expect(sim().tags['PT-1']!.PV!).toBeCloseTo(sim().pipePressures.a2!, 1)
    expect(sim().tags['PT-1']!.PV!).not.toBeCloseTo(2, 1)
  })

  it('§9: raising the far terminal above the near one REVERSES the signed flow', async () => {
    // BL-S 3 barg, BL-D 1 barg as specified. Put BL-D above BL-S and the
    // plant runs the other way — nothing on the page decides that.
    await render()
    await override('BL-D', '0 barg')
    lineUp(); advance(90)
    const drain = sim().pipeFlows.a5!
    expect(drain).toBeGreaterThan(0)
    await render()
    const draining = cell('BL-D', 'scn-observed')

    await override('BL-D', '6 barg')
    advance(90)
    expect(sim().pipeFlows.a5!).toBeLessThan(0)
    await render()
    expect(cell('BL-D', 'scn-observed')).not.toBe(draining)
  })
})

// ── §6. Observed role is a runtime observation ──────────────────────────────

describe('§6 — SUPPLYING / RECEIVING is observed, never declared', () => {
  it('the same terminal reads differently as the plant changes around it', async () => {
    await render()
    // nothing running: no significant flow anywhere
    expect(cell('BL-S', 'scn-observed')).toBe('NO SIGNIFICANT FLOW')

    lineUp(); advance(90)
    await render()
    expect(cell('BL-S', 'scn-observed')).toBe('SUPPLYING')

    // stop the machine and the feed stops with it — the terminal did not change
    sim().writeTag('P-1', 'RUN', 0)
    advance(90)
    await render()
    expect(cell('BL-S', 'scn-observed')).not.toBe('SUPPLYING')
  })

  it('the words are the only vocabulary — no SOURCE or SINK anywhere on the page', async () => {
    lineUp(); advance(60)
    await render()
    const text = host.textContent ?? ''
    expect(text).not.toMatch(/\bSOURCE\b/)
    expect(text).not.toMatch(/\bSINK\b/)
    for (const t of ['BL-S', 'BL-D']) {
      expect(['SUPPLYING', 'RECEIVING', 'NO SIGNIFICANT FLOW']).toContain(cell(t, 'scn-observed'))
    }
  })
})

// ── §4. Clear scenario is not Reset ─────────────────────────────────────────

describe('§4 — clearing a scenario is not rewinding the plant, and says so', () => {
  it('both actions exist and the difference is stated in words', async () => {
    await render()
    expect(host.querySelector('[data-testid="scn-clear"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="scn-reset"]')).not.toBeNull()
    const note = host.querySelector('[data-testid="scn-note"]')!.textContent!
    expect(note).toMatch(/removes runtime boundary overrides only/i)
    expect(note).toMatch(/returns the whole simulation/i)
  })

  it('Clear scenario removes the override and LEAVES equipment where it was', async () => {
    lineUp()
    await render()
    await override('BL-S', '1 barg')
    expect(sim().terminals['BL-S']!.source).toBe('scenario')
    expect(sim().tags['P-1']!.RUN).toBe(1)

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="scn-clear"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await render()
    expect(cell('BL-S', 'scn-source')).toBe('Engineering')
    // K8's deliberate choice, preserved: a command is undone by a command
    expect(sim().tags['P-1']!.RUN).toBe(1)
  })

  it('Reset returns the whole plant, scenario included', async () => {
    lineUp(); advance(60)
    await render()
    await override('BL-S', '1 barg')
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="scn-reset"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(sim().scenario).toBeNull()
    expect(sim().tags['P-1']!.RUN).toBe(0)
  })
})

// ── §5. Problems, through the existing conventions ──────────────────────────

describe('§5 — a problem is reported with the existing severity model', () => {
  it('an unreadable pressure typed into the page becomes a finding', async () => {
    await render()
    await override('BL-S', 'lots')
    const problems = host.querySelectorAll('[data-testid="scn-problem"]')
    expect(problems).toHaveLength(1)
    expect(problems[0]!.getAttribute('data-tag')).toBe('BL-S')
    // the EXISTING operator-layer severity, not a new one
    expect(problems[0]!.getAttribute('data-severity')).toBe('error')
    expect(problems[0]!.textContent).toMatch(/not a pressure this model can use/i)
    // and the terminal falls back to its record rather than to a made-up value
    expect(cell('BL-S', 'scn-active')).toBe('3.0 barg')
    expect(cell('BL-S', 'scn-source')).toBe('Invalid')
  })

  it('a valid scenario shows no problems section at all', async () => {
    await render()
    await override('BL-S', '2 barg')
    expect(host.querySelector('[data-testid="scn-problems"]')).toBeNull()
  })

  it('the page NEVER produces the duplicate-override state: one tag, one value', async () => {
    await render()
    await override('BL-S', '2 barg')
    await override('BL-S', '5 barg')
    // replaced, not appended — so the operator gets what they asked for
    expect(sim().scenario!.overrides.filter((o) => o.kind === 'terminal-pressure')).toHaveLength(1)
    expect(sim().scenarioProblems).toEqual([])
    expect(cell('BL-S', 'scn-active')).toBe('5.0 barg')
  })
})

// ── §8, §11. Visual language and safety ─────────────────────────────────────

describe('§8, §11 — a scenario is a state, not an alarm, and changes no document', () => {
  it('an override is marked as a STATE: the row says so without borrowing a colour', async () => {
    await render()
    await override('BL-S', '2 barg')
    expect(row('BL-S').getAttribute('data-source')).toBe('scenario')
    // the alarm treatment belongs to the problem list and nothing else
    expect(row('BL-S').querySelector('.scn-sev')).toBeNull()
    expect(sim().alarms).toEqual([])
  })

  it('§11: overriding changes no engineering record and no topology', async () => {
    const before = JSON.stringify(registry)
    const nodesBefore = sim().processView!.nodes.length
    await render()
    await override('BL-S', '1 barg')
    advance(60)
    expect(JSON.stringify(registry)).toBe(before)
    expect(sim().processView!.nodes.length).toBe(nodesBefore)
    // the record's value is still what the ENGINEERING column shows
    expect(cell('BL-S', 'scn-engineering')).toBe('3.0 barg')
  })

  it('a plant with no terminals says so rather than showing an empty table', async () => {
    const bare: HmiScreen = {
      ...plant, id: 'bare',
      widgets: plant.widgets.filter((w) => !w.tag?.startsWith('BL-')),
      pipes: plant.pipes.map((p) =>
        p.id === 'a1' ? { id: 'a1', points: p.points, bId: 'p', bPort: 'suction' }
        : p.id === 'a5' ? { id: 'a5', points: p.points, aId: 'lv', aPort: 'out' } : p),
    }
    sim().exitRun(); sim().enterRun(bare, registry)
    await render()
    expect(host.querySelector('[data-testid="scn-no-terminals"]')).not.toBeNull()
  })
})

// ── §7. The directional finding, recorded as a test ─────────────────────────

describe('§7 — a terminal’s direction is the solved flow, not its name', () => {
  /**
   * THE FINDING, kept as evidence rather than fixed by changing anything.
   *
   * `BL-D` is named and positioned as a product OUTLET, and its record says
   * 1 barg. That is two bar absolute — and the vessel it drains sits at roughly
   * 1.12 bar at its bottom nozzle. So AS SPECIFIED this "outlet" is above the
   * plant and FEEDS it.
   *
   * Nothing here is wrong with the solver, and nothing was adjusted to make the
   * picture agree with the name. It is an engineering-data review finding: the
   * stated pressure and the intended direction disagree, and the pressure wins
   * because it is the only one of the two that is a physical quantity.
   */
  it('the specified BL-D is above the vessel, so as drawn it SUPPLIES', async () => {
    lineUp(); advance(90)
    const stated = sim().terminals['BL-D']!
    expect(stated.source).toBe('engineering')
    expect(stated.barA).toBe(2)                                  // 1 barg
    // the vessel's bottom nozzle, which this "outlet" is connected to
    const tankBottom = sim().pipePressures.a4!
    expect(stated.barA).toBeGreaterThan(tankBottom)              // the terminal is HIGHER
    expect(sim().pipeFlows.a5!).toBeLessThan(0)                  // so the line runs inward
    await render()
    expect(cell('BL-D', 'scn-observed')).toBe('SUPPLYING')       // and the page says so
  })

  it('and it becomes an outlet the moment its stated pressure drops below the plant', async () => {
    await render()
    await override('BL-D', '0 barg')
    lineUp(); advance(90)
    expect(sim().terminals['BL-D']!.barA).toBe(1)
    expect(sim().terminals['BL-D']!.barA).toBeLessThan(sim().pipePressures.a4!)
    expect(sim().pipeFlows.a5!).toBeGreaterThan(0)
    await render()
    expect(cell('BL-D', 'scn-observed')).toBe('RECEIVING')
  })
})
