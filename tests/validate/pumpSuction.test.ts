// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * K3.3 — CAN THE DRAWN SUCTION SUPPLY THE PUMP SPECIFIED ON IT?
 *
 * K3.2 found that a machine can be specified past what its own suction line
 * can pass, and that the only sign was a `cavitating` flag at RUN time — on a
 * plant somebody had already drawn and issued. This closes the static half.
 *
 * Every assertion here is about a HYDRAULIC CAPACITY, never about NPSH. The
 * model has no fluid, no vapour pressure, no suction temperature and no
 * elevation, so it cannot compute NPSHa and does not pretend to; see the
 * header of `model/suction.ts`. What it can say, and what these tests pin, is
 * whether the path can pass the rated flow from the pressure available at all.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { createScreen } from '../../src/hmi/model'
import { buildIndex } from '../../src/model/projectIndex'
import { suctionFor, resetSuctionCache } from '../../src/model/suction'
import { pumpSuctionInsufficient, pumpSuctionUnsupplied } from '../../src/validate/rules/process'
import { ALL_RULES } from '../../src/validate/rules/index'
import { DEFAULTS } from '../../src/hmi/sim/units'
import { PIPE_K } from '../../src/hmi/sim/hydraulic/model'
import type { HmiScreen } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'
import type { Registry } from '../../src/model/registry'

/** boundary -> [suction runs] -> P-1 -> TK-1. `runs` lengthens the suction. */
const plant = (runs: number, suctionFrom: 'boundary' | 'vessel' = 'boundary'): HmiScreen => {
  const widgets: HmiScreen['widgets'] = [
    { id: 'p', type: 'pump', x: 400, y: 90, w: 56, h: 56, tag: 'P-1' },
    { id: 't', type: 'tank', x: 700, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 50 } },
  ]
  const pipes: HmiScreen['pipes'] = []
  // the suction, in `runs` separate pipe runs joined by tees
  let prev: { id: string; port?: string } | undefined
  if (suctionFrom === 'vessel') {
    widgets.push({ id: 'src', type: 'tank', x: 0, y: 40, w: 96, h: 128, tag: 'TK-0', props: { level0: 50 } })
    prev = { id: 'src', port: 'bottom' }
  }
  for (let i = 0; i < runs; i++) {
    const last = i === runs - 1
    if (!last) widgets.push({ id: `j${i}`, type: 'symbol', x: 120 + i * 60, y: 110, w: 16, h: 16, tag: `T-${i}`, props: { symbolId: 'fit.junction' } })
    pipes.push({
      id: `s${i}`,
      points: [{ x: 100 + i * 60, y: 118 }, { x: last ? 396 : 116 + i * 60, y: 118 }],
      ...(prev ? { aId: prev.id, ...(prev.port ? { aPort: prev.port } : {}) } : {}),
      ...(last ? { bId: 'p', bPort: 'suction' } : { bId: `j${i}` }),
    })
    prev = last ? undefined : { id: `j${i}` }
  }
  pipes.push({ id: 'd', points: [{ x: 460, y: 118 }, { x: 710, y: 150 }], aId: 'p', aPort: 'discharge', bId: 't', bPort: 'bottom' })
  return { ...createScreen(1), id: 'scr1', name: 'Unit', widgets, pipes }
}

const docOf = (screen: HmiScreen, registry?: Registry): ProjectDoc => {
  const d = createEmptyDoc('t')
  return { ...d, hmiScreens: [screen], ...(registry ? { registry } : {}) }
}
const duty = (capacity: string, head = '40 m'): Registry =>
  ({ 'P-1': { key: 'P-1', kind: 'equipment', fields: { 'duty.capacity': capacity, 'duty.head': head } } })

const checkOf = (doc: ProjectDoc) => suctionFor(buildIndex(doc))[0]!
const findings = (doc: ProjectDoc) => {
  const ix = buildIndex(doc)
  return [...pumpSuctionInsufficient.run(ix), ...pumpSuctionUnsupplied.run(ix)]
}

beforeEach(() => { resetSuctionCache() })

// ── What it computes ────────────────────────────────────────────────────────

describe('the suction check reports what an engineer needs to act on', () => {
  it('names the machine, its duty, its source, and what the path can pass', () => {
    const c = checkOf(docOf(plant(1), duty('200 m³/h')))
    expect(c.tag).toBe('P-1')
    expect(c.ratedFlow).toBe(200)
    expect(c.ratedDefaulted).toBe(false)
    expect(c.source).toEqual({ kind: 'boundary' })
    expect(c.sourcePressure).toBe(DEFAULTS.supplyPressureBar)
    expect(c.resistance).toBeCloseTo(PIPE_K, 12)
    // the model's own law: √(P/R) is the most the path can pass
    expect(c.maxFlow).toBeCloseTo(Math.sqrt(DEFAULTS.supplyPressureBar / PIPE_K), 9)
    expect(c.suctionAtRated).toBeCloseTo(1 - PIPE_K * 200 * 200, 9)
    expect(c.state).toBe('insufficient')
  })

  it('says when the duty it judged was an assumption rather than a record', () => {
    const c = checkOf(docOf(plant(1)))
    expect(c.ratedDefaulted).toBe(true)
    expect(c.ratedFlow).toBe(DEFAULTS.pumpFlowM3h)
    // and the finding says so, so nobody acts on a number nobody stated
    const over = findings(docOf(plant(4)))
    expect(over[0]!.message).toMatch(/assumed — no duty on its record/)
  })

  it('a vessel feeding the suction adds its static head, and the check uses it', () => {
    const boundary = checkOf(docOf(plant(1, 'boundary'), duty('60 m³/h')))
    resetSuctionCache()
    const vessel = checkOf(docOf(plant(1, 'vessel'), duty('60 m³/h')))
    expect(vessel.source!.kind).toBe('vessel')
    expect(vessel.source!.tag).toBe('TK-0')
    expect(vessel.source!.levelPct).toBe(50)
    // the liquid above the nozzle is pressure the boundary case does not have
    expect(vessel.sourcePressure!).toBeGreaterThan(boundary.sourcePressure!)
    expect(vessel.maxFlow!).toBeGreaterThan(boundary.maxFlow!)
  })
})

// ── The three states ────────────────────────────────────────────────────────

describe('it tells the three states apart', () => {
  it('NORMAL: a duty the path can pass says nothing at all', () => {
    const doc = docOf(plant(1), duty('30 m³/h'))
    expect(checkOf(doc).state).toBe('ok')
    resetSuctionCache()
    expect(findings(doc)).toEqual([])
  })

  it('INSUFFICIENT: a duty beyond the path is reported, with the numbers', () => {
    const doc = docOf(plant(1), duty('400 m³/h', '90 m'))
    expect(checkOf(doc).state).toBe('insufficient')
    resetSuctionCache()
    const out = findings(doc)
    expect(out).toHaveLength(1)
    expect(out[0]!.ruleId).toBe('pump-suction-insufficient')
    expect(out[0]!.entityKey).toBe('P-1')
    expect(out[0]!.message).toContain('P-1')
    expect(out[0]!.message).toMatch(/400 m³\/h/)         // the duty asked for
    expect(out[0]!.message).toMatch(/can pass at most/)  // what it can have
    expect(out[0]!.message).toMatch(/bar absolute/)      // where the nozzle sits
    expect(out[0]!.message).toMatch(/Lower the duty/)    // what to do about it
  })

  it('UNSUPPLIED: a suction that reaches nothing is a different finding', () => {
    // the pump's suction connects only to a valve that connects to nothing
    const stranded: HmiScreen = {
      ...createScreen(1), id: 'scr1', name: 'Unit',
      widgets: [
        { id: 'p', type: 'pump', x: 400, y: 90, w: 56, h: 56, tag: 'P-1' },
        { id: 't', type: 'tank', x: 700, y: 40, w: 96, h: 128, tag: 'TK-1', props: { level0: 50 } },
      ],
      pipes: [
        // discharge only: nothing is drawn on the suction side at all
        { id: 'd', points: [{ x: 460, y: 118 }, { x: 710, y: 150 }], aId: 'p', aPort: 'discharge', bId: 't', bPort: 'bottom' },
      ],
    }
    const doc = docOf(stranded, duty('50 m³/h'))
    expect(checkOf(doc).state).toBe('unsupplied')
    resetSuctionCache()
    const out = findings(doc)
    expect(out).toHaveLength(1)
    expect(out[0]!.ruleId).toBe('pump-suction-unsupplied')
    expect(out[0]!.message).toMatch(/reaches no vessel and no process boundary/)
  })

  it('a longer suction lowers what the path can pass, monotonically', () => {
    let last = Infinity
    for (const runs of [1, 2, 3, 4]) {
      resetSuctionCache()
      const c = checkOf(docOf(plant(runs), duty('50 m³/h')))
      expect(c.maxFlow!, `${runs} runs`).toBeLessThan(last)
      last = c.maxFlow!
    }
    // and a duty that was fine on one run becomes unachievable on four
    resetSuctionCache()
    expect(checkOf(docOf(plant(1), duty('45 m³/h'))).state).toBe('ok')
    resetSuctionCache()
    expect(checkOf(docOf(plant(4), duty('45 m³/h'))).state).toBe('insufficient')
  })
})

// ── The threshold is the physics, not a tuned number ────────────────────────

describe('the boundary of the check is physical, not chosen', () => {
  it('the test is STRICTLY “more than the path can pass”, and nothing else', () => {
    // A path at exactly its capability is at capability, not beyond it. This
    // matters more than it looks: with the model's own constants
    //
    //     √(supplyPressureBar / PIPE_K) = √(1 / 4e-4) = 50 m³/h = DEFAULTS.pumpFlowM3h
    //
    // EXACTLY — an identity, not a coincidence, because `PIPE_K` was calibrated
    // against that same default machine. So the default plant on a single-run
    // suction sits precisely on the line, and any margin added here would fire
    // on it and on every drawing like it, for a reason no draughtsman can fix.
    // Where "enough margin" begins is the question NPSH answers and this model
    // cannot, so it declines to guess.
    expect(Math.sqrt(DEFAULTS.supplyPressureBar / PIPE_K)).toBe(DEFAULTS.pumpFlowM3h)
    const exact = checkOf(docOf(plant(1), duty(`${DEFAULTS.pumpFlowM3h} m³/h`)))
    expect(exact.maxFlow).toBe(DEFAULTS.pumpFlowM3h)
    expect(exact.suctionAtRated).toBe(0)
    expect(exact.state).toBe('ok')
    resetSuctionCache()
    expect(findings(docOf(plant(1), duty(`${DEFAULTS.pumpFlowM3h} m³/h`)))).toEqual([])
  })

  it('one m³/h past capability does fire', () => {
    expect(checkOf(docOf(plant(1), duty('51 m³/h'))).state).toBe('insufficient')
  })

  it('never claims to have calculated NPSH', () => {
    const out = findings(docOf(plant(1), duty('400 m³/h', '90 m')))
    expect(out[0]!.message).toMatch(/not an NPSH calculation/)
    // and it says WHY, rather than leaving the reader to wonder
    expect(out[0]!.message).toMatch(/no fluid, vapour pressure or elevation/)
  })
})

// ── Wiring ──────────────────────────────────────────────────────────────────

describe('it uses the existing Checks engine rather than a framework of its own', () => {
  it('both rules are registered, in the process discipline', () => {
    const ids = new Set(ALL_RULES.map((r) => r.id))
    expect(ids).toContain('pump-suction-insufficient')
    expect(ids).toContain('pump-suction-unsupplied')
    for (const r of ALL_RULES) {
      if (!r.id.startsWith('pump-suction')) continue
      expect(r.discipline).toBe('process')
      expect(r.severity).toBe('warning')
      expect((r.why ?? '').length).toBeGreaterThan(20)
    }
  })

  it('a drawing with no operator screens is not judged at all', () => {
    // The process model is compiled from HMI screens. Without them there is no
    // topology to walk, and inventing one would be worse than staying quiet.
    const d = createEmptyDoc('t')
    expect(suctionFor(buildIndex(d))).toEqual([])
  })
})
