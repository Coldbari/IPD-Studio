// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * STEP I, WHERE IT MEETS EVERYTHING ELSE.
 *
 * Determinism, the Checks integration, the rename and delete paths, navigation,
 * and the promise that reconciling a plant cannot disturb the plant. These are
 * the properties that are easy to state and easy to lose, so each one is
 * pinned rather than assumed.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { bubble, docOf, widget } from './diagnosticsFixture'
import { diagnose, diagnosticsFor, resetDiagnosticsCache, DIAGNOSTIC_RULE_CATEGORY } from '../../src/model/diagnostics'
import { applyReconcile, fingerprintTag, planFor, reconcileScreen } from '../../src/model/reconcile'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules } from '../../src/validate/engine'
import { ALL_RULES } from '../../src/validate/rules/index'
import { DIAGNOSTIC_RULES } from '../../src/validate/rules/diagnostics'
import { orphanedBinding } from '../../src/validate/rules/data'
import { applyRename } from '../../src/model/references'
import { useStore } from '../../src/store/store'
import { useSimStore } from '../../src/hmi/simStore'
import { createEmptyDoc } from '../../src/model/doc'
import type { HmiScreen } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'

// ── Determinism ─────────────────────────────────────────────────────────────

/** A project with a finding in most categories, so ordering has work to do. */
function messy(): ProjectDoc {
  return docOf({
    nodes: [bubble('PT', '101', 'pt101'), bubble('FT', '102', 'ft102'), bubble('LIC', '103', 'lic103')],
    widgets: [
      widget({ id: 'w1', type: 'display', tag: 'PT-101' }),
      widget({ id: 'w2', type: 'display', tag: 'FT-102', props: { bindPipe: 'gone' } }),
      widget({ id: 'w3', type: 'display', tag: 'LIC-103', props: { controller: true } }),
      widget({ id: 'w4', type: 'display', tag: 'DELETED-1' }),
      widget({ id: 'w5', type: 'gauge' }),
    ],
    registry: { 'PT-101': { 'signal.units': 'm³/h', 'signal.range': '10-0 bar' } },
  })
}

describe('determinism', () => {
  beforeEach(() => resetDiagnosticsCache())

  it('the same project produces identical findings, in identical order', () => {
    const a = diagnose(buildIndex(messy()))
    const b = diagnose(buildIndex(messy()))
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id))
    expect(a.total).toBe(b.total)
    expect(a.counts).toEqual(b.counts)
  })

  it('order does not depend on the order objects were written into the document', () => {
    const forward = messy()
    const reversed: ProjectDoc = {
      ...forward,
      sheets: [{ ...forward.sheets[0]!, nodes: [...forward.sheets[0]!.nodes].reverse() }],
      hmiScreens: [{ ...forward.hmiScreens[0]!, widgets: [...forward.hmiScreens[0]!.widgets].reverse() }],
    }
    const ids = (d: ProjectDoc) => diagnose(buildIndex(d)).findings.map((f) => f.id).sort()
    expect(ids(forward)).toEqual(ids(reversed))
  })

  it('findings come back worst first', () => {
    const rank = { error: 0, warning: 1, info: 2 } as const
    const found = diagnose(buildIndex(messy())).findings
    expect(found.length).toBeGreaterThan(3)
    for (let i = 1; i < found.length; i++) {
      expect(rank[found[i]!.severity]).toBeGreaterThanOrEqual(rank[found[i - 1]!.severity])
    }
  })

  it('runtime values cannot affect engineering diagnostics', () => {
    // The simulation is running and has moved; the document has not. An
    // engineering finding that changed here would be reading the plant.
    const doc = messy()
    const before = diagnose(buildIndex(doc)).findings.map((f) => f.id)
    useSimStore.getState().enterRun(doc.hmiScreens)
    for (let i = 0; i < 20; i++) useSimStore.getState().tickOnce(1)
    expect(useSimStore.getState().t).toBeGreaterThan(0)
    resetDiagnosticsCache()
    expect(diagnose(buildIndex(doc)).findings.map((f) => f.id)).toEqual(before)
    useSimStore.getState().exitRun()
  })
})

// ── Checks integration ──────────────────────────────────────────────────────

describe('one diagnostic source, two consumers', () => {
  beforeEach(() => resetDiagnosticsCache())

  it('every rule the diagnostics emit has an adapter, and every adapter is emitted by a rule', () => {
    const adapters = new Set(DIAGNOSTIC_RULES.map((r) => r.id))
    const ledger = new Set(Object.keys(DIAGNOSTIC_RULE_CATEGORY))
    // `orphaned-binding` is in the ledger and lives in rules/data.ts, so it is
    // the one entry with no adapter here.
    ledger.delete('orphaned-binding')
    expect([...ledger].sort()).toEqual([...adapters].sort())
  })

  it('every diagnostic rule id is registered with the engine', () => {
    const registered = new Set(ALL_RULES.map((r) => r.id))
    for (const id of Object.keys(DIAGNOSTIC_RULE_CATEGORY)) expect(registered).toContain(id)
  })

  it('the Checks report and the Diagnostics page see the SAME findings', () => {
    const ix = buildIndex(messy())
    const diag = diagnosticsFor(ix)
    const qa = runRules(ix)
    const inReport = new Set(
      qa.groups
        .filter((g) => g.rule.id in DIAGNOSTIC_RULE_CATEGORY)
        .flatMap((g) => g.findings.map((f) => f.key)),
    )
    const fromDiagnostics = new Set(diag.findings.map((f) => f.id))
    expect(inReport).toEqual(fromDiagnostics)
  })

  it('orphaned-binding still produces exactly the keys it always did', () => {
    const doc = docOf({ widgets: [widget({ id: 'w1', type: 'tank', tag: 'LT-101', label: 'Tank Level' })] })
    const found = orphanedBinding.run(buildIndex(doc))
    expect(found).toHaveLength(1)
    expect(found[0]!.key).toBe('orphaned-binding:LT-101@scr1/w1/tag')
    expect(found[0]!.entityKey).toBe('LT-101')
    // And its severity is unchanged, so an operator screen still cannot block
    // a drawing being issued.
    expect(orphanedBinding.severity).toBe('warning')
  })

  it('an engineering finding carries the operator severity and the rule carries the drawing one', () => {
    const ix = buildIndex(docOf({ widgets: [widget({ id: 'w1', type: 'tank', tag: 'LT-101' })] }))
    const f = diagnosticsFor(ix).findings.find((x) => x.ruleId === 'orphaned-binding')!
    expect(f.severity).toBe('error')
    expect(orphanedBinding.severity).toBe('warning')
  })
})

// ── Navigation ──────────────────────────────────────────────────────────────

describe('navigation', () => {
  beforeEach(() => resetDiagnosticsCache())

  it('a finding about an HMI object names the screen and the widget', () => {
    const doc = docOf({ widgets: [widget({ id: 'w1', type: 'display', tag: 'GONE-1' })] })
    const f = diagnose(buildIndex(doc)).findings.find((x) => x.category === 'missing-tag')!
    expect(f.location).toMatchObject({ kind: 'hmi-widget', screenId: 'scr1', widgetId: 'w1' })
  })

  it('a finding about the drawing names the sheet and the object', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101', 'keep')],
      edges: [{ id: 'e1', lineClass: 'process.major', source: { nodeId: 'keep', portId: 'a' }, target: { nodeId: 'gone', portId: 'b' } }],
    })
    const f = diagnose(buildIndex(doc)).findings.find((x) => x.category === 'broken-connection')!
    expect(f.location.kind).toBe('sheet-edge')
    expect(f.location.sheetId).toBe(doc.sheets[0]!.id)
    expect(f.location.edgeId).toBe('e1')
  })

  it('the Checks report carries both destinations through to the UI', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101', 'keep'), bubble('LT', '102')],
      edges: [{ id: 'e1', lineClass: 'process.major', source: { nodeId: 'keep', portId: 'a' }, target: { nodeId: 'gone', portId: 'b' } }],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'GONE-1' })],
      fromSheet: true,
    })
    const qa = runRules(buildIndex(doc))
    const hmiFinding = qa.groups.flatMap((g) => g.findings).find((f) => f.key.startsWith('orphaned-binding:'))!
    expect(hmiFinding.hmi).toEqual({ screenId: 'scr1', widgetId: 'w1' })

    const pidFinding = qa.groups.flatMap((g) => g.findings).find((f) => f.ruleId === 'broken-process-connection')!
    expect(pidFinding.targetId).toBe('e1')
    expect(pidFinding.sheetId).toBe(doc.sheets[0]!.id)
    expect(pidFinding.hmi).toBeUndefined()
  })

  it('a reconciliation item identifies the screen object and the drawing object it is about', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101', 'lt101'), bubble('PT', '102', 'pt102')],
      widgets: [widget({ id: 'w-lt', type: 'display', tag: 'LT-101' })],
      fromSheet: true,
    })
    const r = reconcileScreen(doc, 'scr1')!
    expect(r.items.find((i) => i.tag === 'PT-102')!.pid!.nodeId).toBe('pt102')
    expect(r.items.find((i) => i.tag === 'LT-101')!.hmi!.widgetId).toBe('w-lt')
  })
})

// ── Rename and delete ───────────────────────────────────────────────────────

describe('rename and delete', () => {
  beforeEach(() => resetDiagnosticsCache())

  it('a rename still carries every machine-written reference, through the one mechanism', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101', 'lt101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101', pens: [{ ref: 'LT-101.PV' }] })],
      registry: { 'LT-101': { 'signal.range': '0-10 m' } },
    })
    // The sheet already carries the new name, which is this function's contract.
    const renamed: ProjectDoc = {
      ...doc,
      sheets: [{ ...doc.sheets[0]!, nodes: [{ ...doc.sheets[0]!.nodes[0]!, tag: { letters: 'LT', loop: '201' } }] }],
    }
    const result = applyRename(renamed, 'LT-101', 'LT-201')
    const w = result.doc.hmiScreens[0]!.widgets[0]!
    expect(w.tag).toBe('LT-201')
    expect(w.pens![0]!.ref).toBe('LT-201.PV')
    expect(result.doc.registry!['LT-201']!.fields['signal.range']).toBe('0-10 m')
  })

  it('a rename creates no false missing-tag finding', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101', 'lt101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101' })],
    })
    expect(diagnose(buildIndex(doc)).findings.filter((f) => f.category === 'missing-tag')).toHaveLength(0)

    const renamed: ProjectDoc = {
      ...doc,
      sheets: [{ ...doc.sheets[0]!, nodes: [{ ...doc.sheets[0]!.nodes[0]!, tag: { letters: 'LT', loop: '201' } }] }],
    }
    const after = applyRename(renamed, 'LT-101', 'LT-201').doc
    resetDiagnosticsCache()
    expect(diagnose(buildIndex(after)).findings.filter((f) => f.category === 'missing-tag')).toHaveLength(0)
  })

  it('a deleted tag produces a visible finding and does NOT remove the widget', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101', 'lt101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101' })],
      fromSheet: true,
    })
    const deleted: ProjectDoc = { ...doc, sheets: [{ ...doc.sheets[0]!, nodes: [] }] }
    resetDiagnosticsCache()
    const found = diagnose(buildIndex(deleted)).findings.filter((f) => f.category === 'missing-tag')
    expect(found).toHaveLength(1)
    // The screen is untouched: detection is not deletion.
    expect(deleted.hmiScreens[0]!.widgets).toHaveLength(1)
    // And reconciliation offers the decision rather than making it.
    const item = reconcileScreen(deleted, 'scr1')!.items.find((i) => i.tag === 'LT-101')!
    expect(item.status).toBe('removed')
    expect(item.actions).toContain('remove')
    expect(item.actions).toContain('ignore')
  })

  it('rebinding resolves the finding', () => {
    const doc = docOf({
      nodes: [bubble('LT', '201', 'lt201')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101' })],
      fromSheet: true,
      baseline: {},
    })
    resetDiagnosticsCache()
    expect(diagnose(buildIndex(doc)).findings.filter((f) => f.category === 'missing-tag')).toHaveLength(1)

    const r = reconcileScreen(doc, 'scr1')!
    const fixed = applyReconcile(doc, planFor(r, { 'LT-101': { action: 'remap', target: 'LT-201' } }))
    resetDiagnosticsCache()
    expect(diagnose(buildIndex(fixed)).findings.filter((f) => f.category === 'missing-tag')).toHaveLength(0)
  })
})

// ── Reconciliation does not touch the plant ─────────────────────────────────

describe('reconciliation and the running plant', () => {
  const screen: HmiScreen = {
    id: 'scr1', name: 'Area 1', theme: 'classic',
    widgets: [
      { id: 'p', type: 'pump', x: 100, y: 90, w: 56, h: 56, tag: 'P-1' },
      { id: 't', type: 'tank', x: 500, y: 40, w: 96, h: 128, tag: 'TK-1', props: { capacity: 50, level0: 88, H: 90 } },
    ],
    pipes: [
      { id: 'e1', points: [{ x: 0, y: 118 }, { x: 110, y: 118 }] },
      { id: 'e2', points: [{ x: 150, y: 118 }, { x: 510, y: 100 }] },
    ],
  }

  beforeEach(() => {
    useSimStore.getState().exitRun()
    useStore.temporal.getState().clear()
    useStore.setState({ doc: createEmptyDoc('t'), selection: [], dirty: false })
  })

  it('leaves the simulation, its history and its alarms exactly as they were', () => {
    const base = docOf({
      nodes: [bubble('LT', '101', 'lt101'), bubble('PT', '102', 'pt102')],
      fromSheet: true,
    })
    const sheet = base.sheets[0]!
    const doc: ProjectDoc = {
      ...base,
      hmiScreens: [{ ...screen, fromSheetId: sheet.id, baseline: { 'LT-101': fingerprintTag(base, 'LT-101', sheet) } }],
    }
    useStore.getState().loadIntoStore(doc)

    const sim = () => useSimStore.getState()
    sim().enterRun(useStore.getState().doc.hmiScreens)
    sim().writeTag('P-1', 'RUN', 1)
    for (let i = 0; i < 40; i++) sim().tickOnce(2)
    expect(sim().alarms.length).toBeGreaterThan(0)

    const before = {
      t: sim().t,
      tags: JSON.stringify(sim().tags),
      alarms: JSON.stringify(sim().alarms),
      history: sim().history,
      version: sim().historyVersion,
      samples: sim().history.getSeries('TK-1.PV', 0, 1e9, 500).v.length,
    }

    const r = reconcileScreen(useStore.getState().doc, 'scr1')!
    expect(r.counts.added).toBeGreaterThan(0)
    useStore.getState().applyReconciliation(planFor(r, { 'LT-101': { action: 'add' }, 'PT-102': { action: 'add' } }))
    expect(useStore.getState().doc.hmiScreens[0]!.widgets.length).toBe(4)

    expect(sim().t).toBe(before.t)
    expect(JSON.stringify(sim().tags)).toBe(before.tags)
    expect(JSON.stringify(sim().alarms)).toBe(before.alarms)
    // The ring buffer is mutated in place, so identity IS the assertion here.
    expect(sim().history).toBe(before.history)
    expect(sim().historyVersion).toBe(before.version)
    expect(sim().history.getSeries('TK-1.PV', 0, 1e9, 500).v).toHaveLength(before.samples)

    // And undo puts the document back without disturbing the plant either.
    useStore.getState().undo()
    expect(useStore.getState().doc.hmiScreens[0]!.widgets.length).toBe(2)
    expect(sim().t).toBe(before.t)
    expect(JSON.stringify(sim().alarms)).toBe(before.alarms)
  })
})

// ── Cost ────────────────────────────────────────────────────────────────────

/**
 * Step I §41: engineering diagnostics are computed on a DOCUMENT change, never
 * on the simulation tick. Ten rules ask for them per report, and they must
 * compile the plant once between them — not ten times, and not at 5 Hz.
 */
describe('what it costs', () => {
  beforeEach(() => resetDiagnosticsCache())

  it('computes once per project index, however many consumers ask', () => {
    const ix = buildIndex(messy())
    const first = diagnosticsFor(ix)
    expect(diagnosticsFor(ix)).toBe(first)
    // Ten rule adapters, one compile: the whole report reuses that one object.
    runRules(ix)
    expect(diagnosticsFor(ix)).toBe(first)
  })

  it('a new index recomputes, so an edit is never served a stale answer', () => {
    const doc = messy()
    const first = diagnosticsFor(buildIndex(doc))
    const second = diagnosticsFor(buildIndex(doc))
    expect(second).not.toBe(first)
    expect(second.findings.map((f) => f.id)).toEqual(first.findings.map((f) => f.id))
  })

  it('adds a bounded cost to the full QA report', () => {
    const ix = buildIndex(messy())
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) {
      resetDiagnosticsCache()
      diagnose(ix)
    }
    const perRun = (performance.now() - t0) / 50
    // Generous, because this is a correctness guard against an accidental
    // O(widgets x registry) scan rather than a benchmark. A regression that
    // made this quadratic would blow straight through it.
    expect(perRun).toBeLessThan(25)
  })
})
