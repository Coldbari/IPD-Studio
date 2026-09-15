// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP G — the operator workstation, mounted.
 *
 * These drive the real pages against the real runtime store: no mock alarm
 * engine, no mock history, no mock equipment state. What is being checked is
 * the information architecture — that each page shows the canonical state,
 * that filters change only the view, and that acknowledgement goes through the
 * one command path rather than reaching into an alarm record.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import Overview from '../../src/hmi/operator/Overview'
import AlarmsPage from '../../src/hmi/operator/AlarmsPage'
import EquipmentPage from '../../src/hmi/operator/EquipmentPage'
import TrendsPage from '../../src/hmi/operator/TrendsPage'
import DiagnosticsPage from '../../src/hmi/operator/DiagnosticsPage'
import OperatorNav from '../../src/hmi/operator/nav'
import type { OperatorPage } from '../../src/hmi/operator/nav'
import type { HmiScreen } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** source -> P-101 -> LV-101 -> TK-101, LT/PT reading it, LIC controlling. */
const screen: HmiScreen = {
  id: 'scr1', name: 'Feed area', theme: 'classic',
  widgets: [
    { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-101' },
    { id: 'v', type: 'valve', x: 300, y: 95, w: 48, h: 32, tag: 'LV-101', props: { throttle: true } },
    { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-101', props: { level0: 20, H: 60 } },
    { id: 'lt', type: 'display', x: 700, y: 40, w: 96, h: 40, tag: 'LT-101', props: { bindTank: 'TK-101' } },
    { id: 'pt', type: 'display', x: 700, y: 90, w: 96, h: 40, tag: 'PT-101', props: { bindPipe: 'e2' } },
    { id: 'lic', type: 'display', x: 700, y: 140, w: 96, h: 40, tag: 'LIC-101', props: { controller: true } },
  ],
  pipes: [
    { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
    { id: 'e2', points: [{ x: 150, y: 118 }, { x: 310, y: 111 }] },
    { id: 'e3', points: [{ x: 340, y: 111 }, { x: 510, y: 100 }] },
  ],
}
const registry: Registry = {
  'TK-101': { key: 'TK-101', kind: 'equipment', fields: { 'construction.volume': '20 m³' } },
}

const sim = () => useSimStore.getState()
const advance = (seconds: number, dt = 1) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim().tickOnce(dt)
}

async function mount(el: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(el))
  return host
}
const noop = () => {}
const txt = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
const rows = (host: HTMLElement, id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)]
const click = async (el: Element | null | undefined) => {
  await act(async () => (el as HTMLElement).click())
}

beforeEach(() => {
  document.body.innerHTML = ''
  useStore.getState().loadIntoStore({ ...createEmptyDoc('t'), hmiScreens: [screen], registry })
  sim().exitRun()
  sim().enterRun(screen, registry)
})

// ── Navigation ──────────────────────────────────────────────────────────────

describe('the page bar', () => {
  it('offers every operator area and marks the current one', async () => {
    const host = await mount(<OperatorNav page="overview" onPage={noop} />)
    for (const p of ['overview', 'process', 'equipment', 'alarms', 'trends', 'diagnostics'] as OperatorPage[]) {
      expect(host.querySelector(`[data-testid="op-nav-${p}"]`), p).not.toBeNull()
    }
    expect(host.querySelector('[data-testid="op-nav-overview"]')!.getAttribute('aria-current')).toBe('page')
    expect(host.querySelector('[data-testid="op-nav-process"]')!.getAttribute('aria-current')).toBeNull()
  })

  it('navigates when a page is chosen', async () => {
    let went: OperatorPage | null = null
    const host = await mount(<OperatorNav page="overview" onPage={(p) => { went = p }} />)
    await click(host.querySelector('[data-testid="op-nav-trends"]'))
    expect(went).toBe('trends')
  })

  it('carries the standing alarm count so trouble is visible from every page', async () => {
    expect((await mount(<OperatorNav page="overview" onPage={noop} />))
      .querySelector('[data-testid="op-nav-alarm-count"]')).toBeNull()
    sim().writeTag('TK-101', 'PV', 95)
    advance(2)
    document.body.innerHTML = ''
    const host = await mount(<OperatorNav page="overview" onPage={noop} />)
    expect(Number(txt(host, 'op-nav-alarm-count'))).toBeGreaterThan(0)
  })

  it('shows a breadcrumb for the screen the operator is on', async () => {
    const host = await mount(<OperatorNav page="process" onPage={noop} crumb="Feed area" />)
    expect(txt(host, 'op-crumb')).toContain('Feed area')
  })
})

// ── Overview ────────────────────────────────────────────────────────────────

describe('the overview', () => {
  const view = () => mount(<Overview onPage={noop} onGoToScreen={noop} onJumpTag={noop} />)

  it('reports a calm plant as stopped with nothing standing', async () => {
    const host = await view()
    expect(txt(host, 'kpi-status')).toContain('STOPPED')
    expect(txt(host, 'kpi-alarms')).toContain('0')
    expect(txt(host, 'kpi-running')).toContain('0 / 1')
    expect(host.querySelector('[data-testid="op-no-alarms"]')).not.toBeNull()
  })

  it('follows the plant: starting a pump changes the running count and the status', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(5)
    const host = await view()
    expect(txt(host, 'kpi-running')).toContain('1 / 1')
    expect(txt(host, 'kpi-status')).toContain('RUNNING')
  })

  it('counts a real alarm, names it critical and lists it', async () => {
    sim().writeTag('TK-101', 'PV', 95)
    advance(2)
    const host = await view()
    expect(Number(txt(host, 'kpi-alarms').replace(/\D/g, ''))).toBeGreaterThan(0)
    expect(txt(host, 'kpi-critical')).not.toContain('0')
    expect(txt(host, 'kpi-status')).toContain('ALARM')
    expect(rows(host, 'op-overview-alarm').length).toBeGreaterThan(0)
  })

  it('a tripped drive reports as faulted and puts the plant in alarm', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(5)
    sim().writeTag('P-101', 'FAULT', 1)
    advance(2)
    const host = await view()
    expect(txt(host, 'kpi-faulted')).toContain('1')
    expect(txt(host, 'kpi-status')).toContain('ALARM')
  })

  it('shows KPIs only for quantities the plant actually measures', async () => {
    const host = await view()
    expect(host.querySelector('[data-testid="kpi-group-level"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="kpi-group-pressure"]')).not.toBeNull()
    // nothing here measures temperature, so no temperature group is invented
    expect(host.querySelector('[data-testid="kpi-group-temperature"]')).toBeNull()
  })

  it('KPI values are the live runtime values, in their engineering units', async () => {
    advance(5)
    const host = await view()
    const tile = host.querySelector('[data-testid="kpi-tag-PT-101"]')!
    // the VALUE element, not the whole tile: the tag name runs straight into
    // the number in the text content
    const value = tile.querySelector('.v')!.textContent ?? ''
    expect(value).toContain('bar')
    expect(Number(value.replace('bar', ''))).toBeCloseTo(sim().tags['PT-101']!.PV!, 0)
  })

  it('names the area that needs attention and can navigate to it', async () => {
    sim().writeTag('TK-101', 'PV', 95)
    advance(2)
    let went: string | null = null
    const host = await mount(<Overview onPage={noop} onGoToScreen={(id) => { went = id }} onJumpTag={noop} />)
    const area = host.querySelector('[data-testid="op-area"]')!
    expect(area.getAttribute('data-attention')).toBeTruthy()
    await click(area)
    expect(went).toBe('scr1')
  })

  it('returns to its initial reading after RESET', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('TK-101', 'PV', 95)
    advance(5)
    sim().reset()
    const host = await view()
    expect(txt(host, 'kpi-status')).toContain('STOPPED')
    expect(txt(host, 'kpi-alarms')).toContain('0')
    expect(txt(host, 'kpi-running')).toContain('0 / 1')
  })
})

// ── Alarms ──────────────────────────────────────────────────────────────────

describe('the alarm page', () => {
  const raise = () => { sim().writeTag('TK-101', 'PV', 95); advance(2) }

  it('shows the canonical alarm with its value, limit, unit and message', async () => {
    raise()
    const host = await mount(<AlarmsPage onJumpTag={noop} />)
    const row = rows(host, 'alarm-row').find((r) => r.getAttribute('data-tag') === 'TK-101')!
    const cells = [...row.querySelectorAll('td')].map((c) => c.textContent)
    expect(cells.join('|')).toContain('above')      // the message
    expect(cells.join('|')).toContain('95.0')       // the value at trip
    expect(cells.join('|')).toContain('60.0')       // the limit it crossed
    expect(cells.join('|')).toContain('%')          // the unit
    expect(row.getAttribute('data-state')).toBe('ACTIVE')
  })

  it('acknowledges through the store command path, and the journal records it', async () => {
    raise()
    const host = await mount(<AlarmsPage onJumpTag={noop} />)
    const before = sim().alarms.find((a) => a.tag === 'TK-101')!
    expect(before.phase).toBe('active')
    await click(host.querySelector('[data-testid="alarm-ack"]'))
    expect(sim().alarms.find((a) => a.tag === 'TK-101')!.phase).toBe('acked')
    expect(sim().journal.some((e) => e.what === 'ACK')).toBe(true)
    // the ORIGINAL record object was not mutated — a new one replaced it
    expect(before.phase).toBe('active')
  })

  it('filters change what is listed and nothing else', async () => {
    raise()
    const snapshot = JSON.parse(JSON.stringify(sim().alarms))
    const host = await mount(<AlarmsPage onJumpTag={noop} />)
    const all = rows(host, 'alarm-row').length
    expect(all).toBeGreaterThan(0)

    await click(host.querySelector('[data-testid="alarm-filter-acked"]'))
    expect(rows(host, 'alarm-row')).toHaveLength(0)
    expect(host.querySelector('[data-testid="alarms-none"]')).not.toBeNull()

    await click(host.querySelector('[data-testid="alarm-filter-active"]'))
    expect(rows(host, 'alarm-row').length).toBeGreaterThan(0)

    await click(host.querySelector('[data-testid="alarm-prio-low"]'))
    expect(rows(host, 'alarm-row')).toHaveLength(0)
    await click(host.querySelector('[data-testid="alarm-prio-all"]'))
    expect(rows(host, 'alarm-row').length).toBe(all)

    expect(JSON.parse(JSON.stringify(sim().alarms))).toEqual(snapshot)
  })

  it('unacknowledged filter hides what has been acked', async () => {
    raise()
    const host = await mount(<AlarmsPage onJumpTag={noop} />)
    await click(host.querySelector('[data-testid="alarm-filter-unacked"]'))
    const before = rows(host, 'alarm-row').length
    await act(async () => sim().ack())
    expect(rows(host, 'alarm-row').length).toBeLessThan(before)
  })

  it('clicking a tag asks to navigate to it', async () => {
    raise()
    let jumped: string | null = null
    const host = await mount(<AlarmsPage onJumpTag={(t) => { jumped = t }} />)
    await click(host.querySelector('[data-testid="alarm-jump"]'))
    expect(jumped).toBe('TK-101')
  })

  it('counts match the canonical summary', async () => {
    raise()
    const host = await mount(<AlarmsPage onJumpTag={noop} />)
    const standing = sim().alarms.filter((a) => !a.sup && a.phase !== 'pending')
    expect(txt(host, 'alarms-kpi-active')).toContain(String(standing.length))
  })
})

// ── Equipment ───────────────────────────────────────────────────────────────

describe('the equipment page', () => {
  it('lists what the process model actually contains', async () => {
    const host = await mount(<EquipmentPage onOpen={noop} />)
    const tags = rows(host, 'equip-row').map((r) => r.getAttribute('data-tag')).sort()
    expect(tags).toEqual(['LV-101', 'P-101', 'TK-101'])
  })

  it('reports drive state from the canonical state machine, live', async () => {
    const stopped = await mount(<EquipmentPage onOpen={noop} />)
    expect(rows(stopped, 'equip-row').find((r) => r.getAttribute('data-tag') === 'P-101')!
      .getAttribute('data-state')).toBe('stopped')

    document.body.innerHTML = ''
    sim().writeTag('P-101', 'RUN', 1)
    advance(1)
    const starting = await mount(<EquipmentPage onOpen={noop} />)
    expect(rows(starting, 'equip-row').find((r) => r.getAttribute('data-tag') === 'P-101')!
      .getAttribute('data-state')).toBe('starting')

    document.body.innerHTML = ''
    advance(5)
    const running = await mount(<EquipmentPage onOpen={noop} />)
    expect(rows(running, 'equip-row').find((r) => r.getAttribute('data-tag') === 'P-101')!
      .getAttribute('data-state')).toBe('running')
  })

  it('filters the view without touching the plant', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(5)
    const before = JSON.parse(JSON.stringify(sim().tags))
    const host = await mount(<EquipmentPage onOpen={noop} />)
    await click(host.querySelector('[data-testid="equip-filter-faulted"]'))
    expect(rows(host, 'equip-row')).toHaveLength(0)
    await click(host.querySelector('[data-testid="equip-filter-running"]'))
    expect(rows(host, 'equip-row')).toHaveLength(1)
    expect(JSON.parse(JSON.stringify(sim().tags))).toEqual(before)
  })

  it('opens the detail for the equipment that was clicked', async () => {
    let opened: string | null = null
    const host = await mount(<EquipmentPage onOpen={(t) => { opened = t }} />)
    await click(host.querySelector('[data-testid="equip-open"]'))
    expect(opened).toBeTruthy()
  })
})

// ── Trends ──────────────────────────────────────────────────────────────────

describe('the trends page', () => {
  it('offers only signals the runtime records, grouped', async () => {
    const host = await mount(<TrendsPage />)
    const picks = rows(host, 'trend-signal').map((r) => r.textContent)
    expect(picks.some((p) => p?.includes('PT-101.PV'))).toBe(true)
    expect(picks.some((p) => p?.includes('LIC-101.SP'))).toBe(true)
    expect(picks.some((p) => p?.includes('LIC-101.OP'))).toBe(true)
    // a pump records nothing: it must not appear as a trendable signal
    expect(picks.some((p) => p?.includes('P-101'))).toBe(false)
  })

  it('exposes exactly the canonical spans and draws at each', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(600)
    const host = await mount(<TrendsPage />)
    for (const s of [60, 300, 900, 3600]) {
      await click(host.querySelector(`[data-testid="trend-span-${s}"]`))
      expect(host.querySelector('[data-testid="op-trend-chart"]'), `${s}s`).not.toBeNull()
      expect(host.querySelectorAll('polyline').length, `${s}s`).toBeGreaterThan(0)
    }
  })

  it('draws the real history, not a copy of it', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(300)
    const host = await mount(<TrendsPage />)
    const pts = host.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/).length
    const stored = sim().history.getSeries('LT-101.PV', sim().history.latestT - 300, sim().history.latestT, 740)
    expect(pts).toBe(stored.v.length)
  })

  it('plots several pens, each named with its own unit', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(300)
    const host = await mount(<TrendsPage />)
    await click(host.querySelector('[data-testid="trend-pick-PT-101.PV"]'))
    await click(host.querySelector('[data-testid="trend-pick-LIC-101.OP"]'))
    const legend = rows(host, 'trend-pen').map((p) => p.textContent ?? '')
    expect(legend.length).toBeGreaterThanOrEqual(2)
    expect(legend.some((l) => l.includes('PT-101.PV') && l.includes('bar'))).toBe(true)
    expect(legend.some((l) => l.includes('LIC-101.OP') && l.includes('%'))).toBe(true)
  })

  it('says so when pens carry different units rather than sharing one scale', async () => {
    advance(60)
    const host = await mount(<TrendsPage />)
    await click(host.querySelector('[data-testid="trend-pick-PT-101.PV"]'))
    expect(host.querySelector('[data-testid="trend-mixed-units"]')).not.toBeNull()
  })

  it('the cursor reports the time at the point under it', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(300)
    const host = await mount(<TrendsPage />)
    const svg = host.querySelector('[data-testid="op-trend-chart"]') as SVGSVGElement
    svg.getBoundingClientRect = () => ({ left: 0, width: 760, top: 0, height: 300, right: 760, bottom: 300, x: 0, y: 0, toJSON: () => ({}) })
    await act(async () => svg.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 400 })))
    expect(host.querySelector('[data-testid="op-trend-cursor-time"]')).not.toBeNull()
  })

  it('marks a pen whose history was forced rather than drawing it as normal', async () => {
    advance(30)
    sim().writeTag('LT-101', 'FORCED', 1)
    advance(60)
    const host = await mount(<TrendsPage />)
    expect(host.querySelector('[data-testid="trend-degraded"]')).not.toBeNull()
    expect(host.querySelector('polyline[data-degraded]')).not.toBeNull()
  })

  it('selecting a signal changes nothing about the process', async () => {
    advance(30)
    const before = JSON.parse(JSON.stringify(sim().tags))
    const version = sim().historyVersion
    const host = await mount(<TrendsPage />)
    await click(host.querySelector('[data-testid="trend-pick-PT-101.PV"]'))
    await click(host.querySelector('[data-testid="trend-span-3600"]'))
    expect(JSON.parse(JSON.stringify(sim().tags))).toEqual(before)
    expect(sim().historyVersion).toBe(version)
  })
})

// ── Diagnostics ─────────────────────────────────────────────────────────────

describe('the diagnostics page', () => {
  it('lists every instrument with its live reading, unit and range', async () => {
    advance(10)
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const row = rows(host, 'diag-row').find((r) => r.getAttribute('data-tag') === 'PT-101')!
    const cells = [...row.querySelectorAll('td')].map((c) => c.textContent ?? '')
    expect(cells.join('|')).toContain('bar')
    expect(cells.join('|')).toContain('0–10')
    expect(Number(cells[3])).toBeCloseTo(sim().tags['PT-101']!.PV!, 1)
  })

  it('the reading follows the process', async () => {
    advance(10)
    const first = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const before = rows(first, 'diag-row').find((r) => r.getAttribute('data-tag') === 'LT-101')!
      .querySelector('[data-testid="diag-pv"]')!.textContent
    document.body.innerHTML = ''
    sim().writeTag('P-101', 'RUN', 1)
    advance(120)
    const later = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const after = rows(later, 'diag-row').find((r) => r.getAttribute('data-tag') === 'LT-101')!
      .querySelector('[data-testid="diag-pv"]')!.textContent
    expect(after).not.toBe(before)
  })

  it('reports quality and source from the canonical models', async () => {
    advance(10)
    const good = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const ltGood = rows(good, 'diag-row').find((r) => r.getAttribute('data-tag') === 'LT-101')!
    expect(ltGood.getAttribute('data-quality')).toBe('good')
    expect(ltGood.getAttribute('data-source')).toBe('SIMULATION')

    document.body.innerHTML = ''
    sim().writeTag('LT-101', 'FORCED', 1)
    advance(2)
    const forced = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const ltForced = rows(forced, 'diag-row').find((r) => r.getAttribute('data-tag') === 'LT-101')!
    expect(ltForced.getAttribute('data-quality')).toBe('forced')
    expect(ltForced.getAttribute('data-source')).toBe('FORCED')
    expect(ltForced.textContent).toContain('FORCED')
  })

  it('a failed instrument shows no reading, and says it is not valid', async () => {
    sim().writeTag('PT-101', 'BAD', 1)
    advance(2)
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const row = rows(host, 'diag-row').find((r) => r.getAttribute('data-tag') === 'PT-101')!
    expect(row.querySelector('[data-testid="diag-pv"]')!.textContent).toBe('- - -')
    expect(row.textContent).toContain('BAD')
  })

  it('shows the alarm standing on an instrument', async () => {
    sim().writeTag('TK-101', 'PV', 95)
    advance(2)
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const row = rows(host, 'diag-row').find((r) => r.getAttribute('data-tag') === 'TK-101')!
    expect(row.textContent).toContain('HIGH')
  })

  it('makes a measurement with no process model visible instead of hiding it', async () => {
    const orphan: HmiScreen = {
      ...screen, id: 'scr2',
      widgets: [...screen.widgets, { id: 'x', type: 'display', x: 0, y: 0, w: 96, h: 40, tag: 'TT-900' }],
    }
    sim().exitRun()
    sim().enterRun(orphan, registry)
    advance(5)
    const host = await mount(<DiagnosticsPage onJumpTag={noop} />)
    const row = rows(host, 'diag-row').find((r) => r.getAttribute('data-tag') === 'TT-900')!
    expect(row.getAttribute('data-source')).toBe('NO MODEL')
    expect(row.getAttribute('data-quality')).toBe('uncertain')
    expect(host.querySelector('[data-testid="diag-unbound-note"]')).not.toBeNull()
    await click(host.querySelector('[data-testid="diag-filter-unbound"]'))
    expect(rows(host, 'diag-row')).toHaveLength(1)
  })

  it('navigating from a row asks for the tag, and mutates nothing', async () => {
    advance(5)
    const before = JSON.parse(JSON.stringify(sim().tags))
    let jumped: string | null = null
    const host = await mount(<DiagnosticsPage onJumpTag={(t) => { jumped = t }} />)
    await click(host.querySelector('[data-testid="diag-jump"]'))
    expect(jumped).toBeTruthy()
    expect(JSON.parse(JSON.stringify(sim().tags))).toEqual(before)
  })
})

// ── Data ownership ──────────────────────────────────────────────────────────

describe('runtime pages never touch the document', () => {
  it('browsing every page leaves the project bit-identical', async () => {
    sim().writeTag('P-101', 'RUN', 1)
    sim().writeTag('TK-101', 'PV', 95)
    advance(60)
    const before = JSON.parse(JSON.stringify(useStore.getState().doc))

    for (const el of [
      <Overview onPage={noop} onGoToScreen={noop} onJumpTag={noop} />,
      <AlarmsPage onJumpTag={noop} />,
      <EquipmentPage onOpen={noop} />,
      <TrendsPage />,
      <DiagnosticsPage onJumpTag={noop} />,
    ]) {
      document.body.innerHTML = ''
      await mount(el)
    }
    expect(JSON.parse(JSON.stringify(useStore.getState().doc))).toEqual(before)
  })

  it('no runtime state reaches the saved document', () => {
    sim().writeTag('P-101', 'RUN', 1)
    advance(60)
    const doc = JSON.stringify(useStore.getState().doc)
    expect(doc).not.toContain('historyVersion')
    expect(doc).not.toContain('"alarms"')
    expect(doc).not.toContain('pipePressures')
    expect(useStore.getState().doc.hmiScreens[0]!.widgets).toEqual(screen.widgets)
  })
})
