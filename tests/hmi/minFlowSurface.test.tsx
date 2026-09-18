// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K18 — MINIMUM-FLOW PROTECTION, ON THE PLATES THAT ALREADY EXIST.
 *
 * No new page. Four numbers on the controller's plate and one line on the
 * machine's, because the thing an operator has to be able to read here cannot
 * be said in fewer:
 *
 *     Min flow      20.0 m³/h     what the record requires
 *     Requested SP  12.0 m³/h     what the loop was asked for
 *     Effective SP  20.0 m³/h     what it is controlling to
 *     Actual flow    7.3 m³/h     what the machine is passing
 *     Min-flow protection  UNABLE
 *
 * Collapse any two of those and the screen starts lying. Show only the
 * effective setpoint and the override is invisible; show only the setpoint and
 * a raised DEMAND reads as an achieved RESULT; show a magnitude instead of the
 * solve's signed flow and a machine running backwards reads as a healthy one.
 *
 * A COLOUR IS STILL A SEVERITY. A protection holding a machine above its
 * minimum is the system WORKING and reads in the ordinary text tone. Only
 * UNABLE — asking, and not getting — takes the warning colour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useSimStore } from '../../src/hmi/simStore'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaLive } from '../../src/validate/live'
import { resetQaCache } from '../../src/validate/engine'
import { resetDiagnosticsCache } from '../../src/model/diagnostics'
import Faceplate from '../../src/hmi/Faceplate'
import DiagnosticsPage from '../../src/hmi/operator/DiagnosticsPage'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { Registry } from '../../src/model/registry'
import type { ProjectDoc } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const screen: HmiScreen = {
  id: 'k18ui', name: 'K18 UI', theme: 'classic',
  widgets: [
    { id: 'bs', type: 'equip', x: 0, y: 100, w: 48, h: 24, tag: 'BL-S', props: { symbolId: 'bl.terminal' } },
    { id: 'p', type: 'pump', x: 200, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 'hv', type: 'valve', x: 400, y: 100, w: 48, h: 32, tag: 'HV-9', props: { throttle: true } },
    { id: 'bd', type: 'equip', x: 700, y: 100, w: 48, h: 24, tag: 'BL-D', props: { symbolId: 'bl.terminal' } },
    { id: 'ft', type: 'display', x: 900, y: 40, w: 96, h: 40, tag: 'FT-1', props: { bindPipe: 'a2', min: 0, max: 60, unit: 'm³/h' } },
    { id: 'fic', type: 'display', x: 900, y: 100, w: 96, h: 40, tag: 'FIC-1', props: { controller: true, min: 0, max: 60, unit: 'm³/h' } },
  ],
  pipes: [
    { id: 'a1', points: [{ x: 0, y: 112 }, { x: 196, y: 118 }], aId: 'bs', aPort: 'process', bId: 'p', bPort: 'suction' },
    { id: 'a2', points: [{ x: 260, y: 118 }, { x: 396, y: 116 }], aId: 'p', aPort: 'discharge', bId: 'hv', bPort: 'in' },
    { id: 'a3', points: [{ x: 452, y: 116 }, { x: 700, y: 112 }], aId: 'hv', aPort: 'out', bId: 'bd', bPort: 'process' },
  ],
}

const reg = (minFlow?: string): Registry => ({
  'P-1': { key: 'P-1', kind: 'equipment', fields: {
    'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes', 'duty.minSpeed': '20 %',
    ...(minFlow !== undefined ? { 'duty.minFlow': minFlow } : {}) } },
  'BL-S': { key: 'BL-S', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
  'BL-D': { key: 'BL-D', kind: 'equipment', fields: { 'design.operatingPressure': '1 barg' } },
})
const project = (r: Registry): ProjectDoc =>
  ({ ...createEmptyDoc('t'), hmiScreens: [screen], registry: r })

const roots: { unmount(): void }[] = []
async function mount(el: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(el))
  return host
}

const sim = () => useSimStore.getState()
const start = (r: Registry = reg('20 m³/h')) => {
  useStore.getState().loadIntoStore(project(r))
  sim().exitRun(); sim().enterRun(screen, r)
}
const advance = (seconds: number) => act(() => {
  for (let i = 0; i < seconds; i++) sim().tickOnce(1)
})
const lineUp = (sp: number) => act(() => {
  sim().writeTag('HV-9', 'OP', 100); sim().writeTag('P-1', 'RUN', 1)
  sim().writeTag('FIC-1', 'SP', sp)
})
const w = (id: string): HmiWidget => screen.widgets.find((x) => x.id === id)!
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)

afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
  resetQaLive()
})
beforeEach(() => {
  document.body.innerHTML = ''
  resetQaLive(); resetQaCache(); resetDiagnosticsCache()
  start()
})

// ── The controller's plate ──────────────────────────────────────────────────

describe('the flow controller\'s plate carries the whole protection', () => {
  it('all four numbers, apart, in the loop\'s own units', async () => {
    lineUp(12); advance(300)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)

    expect(q(host, 'fp-v-min-flow')!.textContent).toContain('20.0')
    expect(q(host, 'fp-v-requested-sp')!.textContent).toContain('12.0')
    expect(q(host, 'fp-v-effective-sp')!.textContent).toContain('20.0')
    expect(q(host, 'fp-v-actual-flow')).not.toBeNull()
    expect(q(host, 'fp-v-min-flow')!.textContent).toContain('m³/h')
    // ...and the SP box still shows what the operator typed, because that is
    // still what they typed. The override is not a write.
    expect((q(host, 'fp-sp') as HTMLInputElement).value).toBe('12')
  })

  it('the actual flow shown is the SOLVE\'S, not the demand and not a magnitude', async () => {
    lineUp(12); advance(300)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    const shown = Number(q(host, 'fp-v-actual-flow')!.textContent!.replace(/[^\d.-]/g, ''))
    expect(shown).toBeCloseTo(sim().pumpEnvelopes['P-1']!.flowM3h!, 1)
  })

  it('a machine whose record states no minimum gets no block at all', async () => {
    start(reg())
    lineUp(12); advance(60)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    expect(q(host, 'fp-minflow')).toBeNull()
    expect(q(host, 'fp-v-min-flow')).toBeNull()
    // and the rest of the plate is exactly the plate K15 shipped
    expect(q(host, 'fp-sp-row')!.getAttribute('data-sp')).toBe('set')
  })

  it('INACTIVE is a normal state and carries no alarm colour', async () => {
    lineUp(35); advance(300)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    const el = q(host, 'fp-minflow')!
    expect(el.getAttribute('data-state')).toBe('INACTIVE')
    expect(el.getAttribute('data-severity')).toBe('none')
  })

  it('EFFECTIVE — the protection working — carries no alarm colour either', async () => {
    start(reg('5 m³/h'))
    lineUp(2); advance(400)
    const el = q(await mount(<Faceplate widget={w('fic')} onClose={() => {}} />), 'fp-minflow')!
    expect(el.getAttribute('data-state')).toBe('EFFECTIVE')
    expect(el.getAttribute('data-severity')).toBe('none')
  })

  it('UNABLE — asking, and not getting — is the one that earns the warning tone', async () => {
    start(reg('55 m³/h'))
    lineUp(12); advance(400)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    const el = q(host, 'fp-minflow')!
    expect(el.getAttribute('data-state')).toBe('UNABLE')
    expect(el.getAttribute('data-severity')).toBe('warning')
    // THE DEMAND AND THE RESULT ARE BOTH ON THE PLATE, and they disagree —
    // which is the entire reason the block has four numbers
    expect(q(host, 'fp-v-effective-sp')!.textContent).toContain('55.0')
    const actual = Number(q(host, 'fp-v-actual-flow')!.textContent!.replace(/[^\d.-]/g, ''))
    expect(actual).toBeLessThan(55)
  })
})

/**
 * K19 — THE STATE AN OPERATOR READS WHEN THE MACHINE IS OFF, OR IN HAND.
 *
 * K18 painted both of these UNABLE, in the warning colour. A plate that shows
 * a failed protection on a pump nobody has started yet teaches an operator to
 * stop reading the line.
 */
describe('K19 — a protection that is not acting says so, and does not alarm', () => {
  it('a STOPPED machine reads STANDING BY, in the plain tone, with no warning', async () => {
    lineUp(12); advance(300)
    await act(() => { sim().writeTag('P-1', 'RUN', 0) })
    advance(30)
    const host = await mount(<Faceplate widget={w('fic')} onClose={() => {}} />)
    const el = q(host, 'fp-minflow')!
    expect(el.getAttribute('data-state')).toBe('STANDING_BY')
    expect(el.getAttribute('data-severity')).toBe('none')
    // the OPERATOR'S word has a space in it; the data attribute keeps the enum
    expect(el.textContent).toContain('STANDING BY')
    // ...and the four numbers are all still there to be read
    expect(q(host, 'fp-v-min-flow')!.textContent).toContain('20.0')
    expect(q(host, 'fp-v-requested-sp')!.textContent).toContain('12.0')
    expect(q(host, 'fp-v-effective-sp')!.textContent).toContain('20.0')
  })

  it('MANUAL reads the same, because the setpoint is not what drives the machine', async () => {
    lineUp(12); advance(300)
    await act(() => { sim().writeTag('FIC-1', 'MODE', 0) })
    advance(5)
    const el = q(await mount(<Faceplate widget={w('fic')} onClose={() => {}} />), 'fp-minflow')!
    expect(el.getAttribute('data-state')).toBe('STANDING_BY')
    expect(el.getAttribute('data-severity')).toBe('none')
  })

  it('the machine\'s own plate agrees with the loop\'s', async () => {
    lineUp(12); advance(300)
    await act(() => { sim().writeTag('P-1', 'RUN', 0) })
    advance(30)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect(q(host, 'fp-envelope')!.getAttribute('data-state')).toBe('STOPPED')
    const el = q(host, 'fp-minflow-pump')!
    expect(el.getAttribute('data-state')).toBe('STANDING_BY')
    expect(el.textContent).toContain('STANDING BY')
  })

  it('§13: the machine\'s BELOW MINIMUM FLOW row names the loop defending it', async () => {
    start(reg('55 m³/h'))
    lineUp(12); advance(400)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    // the MACHINE's row is in the equipment-envelope section — K13's own —
    // and the LOOP's is among the control loops. Two sections, two subjects.
    const machine = [...host.querySelectorAll('[data-testid="diag-env-row"]')]
      .find((r) => r.getAttribute('data-tag') === 'P-1'
        && r.textContent?.includes('below minimum flow'))!
    expect(machine.textContent).toContain('FIC-1 carries this machine')
    const loopRow = [...host.querySelectorAll('[data-testid="diag-loop-row"]')]
      .find((r) => r.getAttribute('data-tag') === 'FIC-1'
        && r.textContent?.includes('is asking for'))!
    expect(loopRow.textContent).toContain('the LOOP\'s report')
  })
})

// ── The machine's plate ─────────────────────────────────────────────────────

describe('the pump\'s plate says whether anything is being done about it', () => {
  it('names the loop that is defending it, beside the limit it already showed', async () => {
    start(reg('55 m³/h'))
    lineUp(12); advance(400)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    // K13's line, untouched
    expect(q(host, 'fp-envelope')!.getAttribute('data-state')).toBe('BELOW MINIMUM FLOW')
    expect(q(host, 'fp-v-minimum-flow')!.textContent).toContain('55.0')
    // ...and K18's, beside it
    const el = q(host, 'fp-minflow-pump')!
    expect(el.getAttribute('data-state')).toBe('UNABLE')
    expect(el.getAttribute('data-loop')).toBe('FIC-1')
    expect(el.textContent).toContain('FIC-1')
  })

  it('a machine with no protection gets no line, and K13 is unchanged', async () => {
    start(reg())
    lineUp(12); advance(200)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect(q(host, 'fp-minflow-pump')).toBeNull()
    expect(q(host, 'fp-envelope')!.getAttribute('data-state')).toBe('LIMIT UNKNOWN')
  })
})

/**
 * K20 — WHETHER ANYBODY DECIDED TO ANNUNCIATE THE LIMIT.
 *
 * A stated `duty.minFlow` makes a machine DETECTABLE and PROTECTABLE. It does
 * not make it alarmed: that is a separate record, routinely blank. Without
 * this line an operator cannot tell a plant that will call them from one that
 * will not, and the blank looks like a decision rather than a gap.
 */
describe('K20 — the pump\'s plate says whether the limit is alarmed', () => {
  it('a limit with NO alarm policy says NOT CONFIGURED, in the muted tone', async () => {
    start(reg('20 m³/h'))
    lineUp(12); advance(200)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    const el = q(host, 'fp-minflow-alarm')!
    expect(el.getAttribute('data-configured')).toBe('no')
    expect(el.textContent).toContain('NOT CONFIGURED')
    // and no priority, width or delay is shown for a record that states none
    expect(el.textContent).not.toMatch(/HIGH|MEDIUM|LOW|delay|±/)
  })

  it('a configured policy shows exactly what the record states, and no more', async () => {
    start({
      ...reg('20 m³/h'),
      'P-1': { key: 'P-1', kind: 'equipment', fields: {
        'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes',
        'duty.minSpeed': '20 %', 'duty.minFlow': '20 m³/h',
        'alarm.minFlowPriority': 'high' } },
    })
    lineUp(12); advance(200)
    const el = q(await mount(<Faceplate widget={w('p')} onClose={() => {}} />), 'fp-minflow-alarm')!
    expect(el.getAttribute('data-configured')).toBe('yes')
    expect(el.textContent).toContain('HIGH')
    // the record stated no deadband and no delay, so neither is shown
    expect(el.textContent).not.toContain('±')
    expect(el.textContent).not.toContain('delay')
  })

  it('...and the alarm itself lands in the plate\'s existing Alarms section', async () => {
    start({
      ...reg('55 m³/h'),
      'P-1': { key: 'P-1', kind: 'equipment', fields: {
        'duty.capacity': '40 m³/h', 'duty.head': '35 m', 'duty.vsd': 'Yes',
        'duty.minSpeed': '20 %', 'duty.minFlow': '55 m³/h',
        'alarm.minFlowPriority': 'medium', 'alarm.minFlowDeadband': '2 m³/h' } },
    })
    lineUp(12); advance(300)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    // NO NEW PAGE and no new section: the existing one, with the existing ACK
    const alarms = q(host, 'fp-alarms')!
    expect(alarms.textContent).toContain('MINF')
    expect(alarms.textContent).toContain('below minimum flow')
    expect(q(host, 'fp-minflow-alarm')!.textContent).toContain('MEDIUM')
    expect(q(host, 'fp-minflow-alarm')!.textContent).toContain('± 2.0 m³/h')
  })

  it('a machine with no stated minimum gets no alarm line at all', async () => {
    start(reg())
    lineUp(12); advance(200)
    const host = await mount(<Faceplate widget={w('p')} onClose={() => {}} />)
    expect(q(host, 'fp-minflow-alarm')).toBeNull()
  })
})

// ── The Diagnostics page ────────────────────────────────────────────────────

describe('the Diagnostics page carries it on LIVE, among the control loops', () => {
  it('a protection that cannot be met is a WARNING row against its loop', async () => {
    start(reg('55 m³/h'))
    lineUp(12); advance(400)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    const rows = [...host.querySelectorAll('[data-testid="diag-loop-row"]')]
    const row = rows.find((r) => r.textContent?.includes('minimum flow'))!
    expect(row.getAttribute('data-tag')).toBe('FIC-1')
    expect(row.getAttribute('data-severity')).toBe('warning')
    expect(row.textContent).toContain('the plant is not making it')
    // it is LIVE, not ENGINEERING: the record is not what is wrong
    expect(q(host, 'diag-section-live')!.getAttribute('aria-pressed')).toBe('true')
    await act(async () => (q(host, 'diag-section-engineering') as HTMLElement).click())
    expect(q(host, 'diag-loops')).toBeNull()
  })

  it('a protection doing its job produces no row at all', async () => {
    start(reg('5 m³/h'))
    lineUp(2); advance(400)
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    expect(sim().minFlow['FIC-1']!.state).toBe('EFFECTIVE')
    expect(q(host, 'diag-loops')).toBeNull()
  })

  it('and a loop simply CONTROLLING AT its minimum does not flicker a warning', async () => {
    lineUp(12); advance(400)
    /**
     * THE NUISANCE THIS GATE EXISTS FOR. A loop held exactly on its minimum
     * sits on it, so half the time it is a hair under — the state genuinely
     * crosses hundreds of times an hour, and K13's envelope crosses with it.
     * What must NOT happen is a warning blinking on a plant that is working.
     */
    const host = await mount(<DiagnosticsPage onJumpTag={() => {}} />)
    const seen = new Set<string>()
    for (let i = 0; i < 120; i++) {
      advance(1)
      seen.add(sim().minFlow['FIC-1']!.state)
      expect(sim().tags['FIC-1']!.SAT).toBe(0)     // in control, not out of machine
      expect(q(host, 'diag-loops')).toBeNull()
    }
    // the STATE did cross, repeatedly. The WARNING never appeared once.
    expect(seen.size).toBeGreaterThan(1)
    expect([...seen].sort()).toEqual(['EFFECTIVE', 'UNABLE'])
  })
})
