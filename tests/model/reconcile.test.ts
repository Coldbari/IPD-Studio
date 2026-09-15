// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * ENGINEERING ↔ HMI RECONCILIATION.
 *
 * The contract these tests hold, in one sentence: nothing happens that the
 * engineer did not ask for, and what they did ask for happens exactly once and
 * can be undone.
 *
 * Half of this file is about what must NOT change — hand-laid positions, an
 * ignored item, the objects nobody chose — because a reconciliation that
 * quietly tidies a screen up is worse than no reconciliation at all.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { bubble, docOf, vessel, widget } from './diagnosticsFixture'
import {
  applyReconcile, fingerprintTag, planFor, planIsEmpty, previewLines, reconcileScreen,
} from '../../src/model/reconcile'
import type { ProjectDoc } from '../../src/model/types'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'

/** A screen built from Sheet 1 showing LT-101, with its baseline recorded. */
function project(over: Partial<Parameters<typeof docOf>[0]> = {}): ProjectDoc {
  const base = docOf({
    nodes: [bubble('LT', '101', 'lt101')],
    widgets: [widget({ id: 'w-lt', type: 'display', tag: 'LT-101', x: 100, y: 100 })],
    fromSheet: true,
    ...over,
  })
  const sheet = base.sheets[0]!
  const screen = base.hmiScreens[0]!
  const tags = screen.widgets.map((w) => w.tag).filter((t): t is string => t !== undefined)
  const baseline = Object.fromEntries(tags.map((t) => [t, fingerprintTag(base, t, sheet)]))
  return { ...base, hmiScreens: [{ ...screen, baseline }] }
}

const report = (doc: ProjectDoc) => reconcileScreen(doc, doc.hmiScreens[0]!.id)!

// ── Detection ───────────────────────────────────────────────────────────────

describe('what changed', () => {
  it('detects an object added to the P&ID', () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    const r = report(doc)
    expect(r.counts.added).toBe(1)
    expect(r.items.find((i) => i.tag === 'PT-102')!.status).toBe('added')
  })

  it('detects an object removed from the P&ID', () => {
    const doc = project()
    doc.sheets[0]!.nodes = []
    const r = report(doc)
    expect(r.counts.removed).toBe(1)
    expect(r.items.find((i) => i.tag === 'LT-101')!.status).toBe('removed')
  })

  it('detects changed engineering metadata', () => {
    const doc = project()
    const next = { ...doc, registry: { 'LT-101': { key: 'LT-101', kind: 'instrument' as const, fields: { 'signal.range': '0-5 m' } } } }
    const r = report(next)
    const item = r.items.find((i) => i.tag === 'LT-101')!
    expect(item.status).toBe('changed')
    expect(item.changes!.map((c) => c.field)).toContain('signal.range')
    expect(item.changes![0]!.to).toBe('0-5 m')
  })

  it('detects a changed symbol, which decides what the HMI draws', () => {
    const doc = project()
    const next: ProjectDoc = {
      ...doc,
      sheets: [{ ...doc.sheets[0]!, nodes: [{ ...doc.sheets[0]!.nodes[0]!, symbolId: 'instr.bubble.dcs' }] }],
    }
    const item = report(next).items.find((i) => i.tag === 'LT-101')!
    expect(item.status).toBe('changed')
    expect(item.changes!.some((c) => c.label === 'Symbol')).toBe(true)
  })

  it('an untouched project reports no changes at all', () => {
    const r = report(project())
    expect(r.counts.added).toBe(0)
    expect(r.counts.removed).toBe(0)
    expect(r.counts.changed).toBe(0)
    expect(r.counts.unchanged).toBe(1)
  })

  it('reports nothing for a screen that was not built from a sheet', () => {
    const doc = docOf({ widgets: [widget({ id: 'w', type: 'display', tag: 'X-1' })] })
    expect(reconcileScreen(doc, doc.hmiScreens[0]!.id)).toBe(null)
  })

  it('establishes a baseline on the first apply to a screen that never had one', () => {
    // A screen built before Step I. Applying one addition must not leave every
    // OTHER tag on it permanently untrackable — nothing was reportable before,
    // so recording the present state accepts nothing.
    const doc = docOf({
      nodes: [bubble('LT', '101', 'lt101'), bubble('PT', '102', 'pt102')],
      widgets: [widget({ id: 'w-lt', type: 'display', tag: 'LT-101' })],
      fromSheet: true,
    })
    expect(reconcileScreen(doc, 'scr1')!.baselineMissing).toBe(true)
    const next = applyReconcile(doc, planFor(reconcileScreen(doc, 'scr1')!, { 'PT-102': { action: 'add' } }))
    expect(Object.keys(next.hmiScreens[0]!.baseline!).sort()).toEqual(['LT-101', 'PT-102'])

    // And LT-101 is now genuinely tracked.
    const edited: ProjectDoc = {
      ...next,
      registry: { 'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-5 m' } } },
    }
    expect(reconcileScreen(edited, 'scr1')!.counts.changed).toBe(1)
  })

  it('does NOT re-baseline a screen that already has one, so an ignore stays an ignore', () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    const edited: ProjectDoc = {
      ...doc,
      registry: { 'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-5 m' } } },
    }
    const after = applyReconcile(edited, planFor(report(edited), { 'PT-102': { action: 'add' } }))
    expect(report(after).counts.changed).toBe(1)
  })

  it('says so when a screen has no baseline, rather than reporting zero changes', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101')],
      widgets: [widget({ id: 'w-lt', type: 'display', tag: 'LT-101' })],
      fromSheet: true,
    })
    const r = reconcileScreen(doc, doc.hmiScreens[0]!.id)!
    expect(r.baselineMissing).toBe(true)
    expect(r.counts.changed).toBe(0)
  })
})

// ── Applying ────────────────────────────────────────────────────────────────

describe('applying', () => {
  it('changes nothing when nothing was chosen', () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    const r = report(doc)
    const plan = planFor(r, {})
    expect(planIsEmpty(plan)).toBe(true)
    expect(applyReconcile(doc, plan)).toBe(doc)
  })

  it('ignoring an item leaves the screen untouched', () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    const plan = planFor(report(doc), { 'PT-102': { action: 'ignore' } })
    expect(applyReconcile(doc, plan)).toBe(doc)
    expect(plan.ignored).toContain('PT-102')
  })

  it('applying an addition creates the right kind of object, below the existing layout', () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(vessel('TK', '102', 'tk102'))
    const plan = planFor(report(doc), { 'TK-102': { action: 'add' } })
    const next = applyReconcile(doc, plan)
    const screen = next.hmiScreens[0]!
    const added = screen.widgets.find((w) => w.tag === 'TK-102')!
    expect(added).toBeTruthy()
    // The importer decides the type — a vessel becomes a tank, not a display.
    expect(added.type).toBe('tank')
    // Placed below everything that was already there, never on top of it.
    expect(added.y).toBeGreaterThan(100)
  })

  it('applying an addition records its baseline, so later changes are reportable', () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    const next = applyReconcile(doc, planFor(report(doc), { 'PT-102': { action: 'add' } }))
    expect(next.hmiScreens[0]!.baseline!['PT-102']).toBeTruthy()
    // And it is genuinely live: change the record, and it now reports CHANGED.
    const edited: ProjectDoc = {
      ...next,
      registry: { 'PT-102': { key: 'PT-102', kind: 'instrument', fields: { 'signal.range': '0-16 bar' } } },
    }
    expect(report(edited).items.find((i) => i.tag === 'PT-102')!.status).toBe('changed')
  })

  it('applying a remap points the existing widget at the new tag and keeps it where it is', () => {
    const doc = project()
    doc.sheets[0]!.nodes = [bubble('LT', '105', 'lt105')]
    const r = report(doc)
    const removed = r.items.find((i) => i.tag === 'LT-101')!
    expect(removed.remapTo).toEqual(['LT-105'])
    const plan = planFor(r, { 'LT-101': { action: 'remap', target: 'LT-105' } })
    const next = applyReconcile(doc, plan)
    const widgets = next.hmiScreens[0]!.widgets
    expect(widgets).toHaveLength(1)
    expect(widgets[0]!.id).toBe('w-lt')
    expect(widgets[0]!.tag).toBe('LT-105')
    expect(widgets[0]!.x).toBe(100)
    expect(widgets[0]!.y).toBe(100)
  })

  it('a remap target is not also placed as a new object', () => {
    const doc = project()
    doc.sheets[0]!.nodes = [bubble('LT', '105', 'lt105')]
    const plan = planFor(report(doc), {
      'LT-101': { action: 'remap', target: 'LT-105' },
      'LT-105': { action: 'add' },
    })
    expect(plan.add).toEqual([])
    expect(applyReconcile(doc, plan).hmiScreens[0]!.widgets).toHaveLength(1)
  })

  it('refuses a remap to a tag that is not one of the offered destinations', () => {
    const doc = project()
    doc.sheets[0]!.nodes = [bubble('LT', '105', 'lt105')]
    const plan = planFor(report(doc), { 'LT-101': { action: 'remap', target: 'LT-999' } })
    expect(plan.remap).toEqual([])
    expect(plan.ignored).toContain('LT-101')
  })

  it('removing an obsolete object happens only when it is explicitly chosen', () => {
    const doc = project()
    doc.sheets[0]!.nodes = []
    // Reported, but nothing is removed until asked.
    expect(report(doc).counts.removed).toBe(1)
    expect(applyReconcile(doc, planFor(report(doc), {})).hmiScreens[0]!.widgets).toHaveLength(1)
    const next = applyReconcile(doc, planFor(report(doc), { 'LT-101': { action: 'remove' } }))
    expect(next.hmiScreens[0]!.widgets).toHaveLength(0)
  })

  it('an update moves the baseline forward and an ignore does not', () => {
    const doc = project()
    const edited: ProjectDoc = {
      ...doc,
      registry: { 'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-5 m' } } },
    }
    const ignored = applyReconcile(edited, planFor(report(edited), { 'LT-101': { action: 'ignore' } }))
    expect(report(ignored).counts.changed).toBe(1)

    const updated = applyReconcile(edited, planFor(report(edited), { 'LT-101': { action: 'update' } }))
    expect(report(updated).counts.changed).toBe(0)
  })

  it('leaves hand-laid positions, sizes and labels exactly as they were', () => {
    const doc = project({
      widgets: [
        widget({ id: 'w-lt', type: 'display', tag: 'LT-101', x: 640, y: 480, w: 200, h: 90, label: 'MY LEVEL' }),
        widget({ id: 'w-mine', type: 'label', label: 'UNIT 100', x: 20, y: 20 }),
      ],
    })
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    const next = applyReconcile(doc, planFor(report(doc), { 'PT-102': { action: 'add' } }))
    const lt = next.hmiScreens[0]!.widgets.find((w) => w.id === 'w-lt')!
    expect([lt.x, lt.y, lt.w, lt.h, lt.label]).toEqual([640, 480, 200, 90, 'MY LEVEL'])
    // A widget the engineer added by hand, which is on no sheet, survives too.
    expect(next.hmiScreens[0]!.widgets.some((w) => w.id === 'w-mine')).toBe(true)
  })

  it('previews exactly what it applies', () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    const plan = planFor(report(doc), { 'PT-102': { action: 'add' } })
    const lines = previewLines(plan)
    expect(lines).toEqual(['+ Add PT-102'])
    const next = applyReconcile(doc, plan)
    expect(next.hmiScreens[0]!.widgets.filter((w) => w.tag === 'PT-102')).toHaveLength(1)
  })

  it('is deterministic: the same project and the same choices give the same result', () => {
    const build = () => {
      const d = project()
      d.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'), bubble('FT', '103', 'ft103'))
      return d
    }
    const run = (d: ProjectDoc) =>
      applyReconcile(d, planFor(report(d), { 'PT-102': { action: 'add' }, 'FT-103': { action: 'add' } }))
    // `fromSheetId` is a fresh ULID per fixture document and is deliberately
    // excluded: it is the identity of the sheet, not an output of this code.
    const shape = (d: ProjectDoc) => {
      const sc = d.hmiScreens[0]!
      return JSON.stringify({ widgets: sc.widgets, baseline: sc.baseline })
    }
    expect(shape(run(build()))).toBe(shape(run(build())))
    // And the report itself is stable, item for item — with the fixture's
    // per-run sheet ULID masked out for the same reason.
    const items = (d: ProjectDoc) =>
      JSON.stringify(report(d).items).replaceAll(d.sheets[0]!.id, 'SHEET')
    expect(items(build())).toBe(items(build()))
  })
})

// ── Through the store: one transaction, undoable ────────────────────────────

describe('through the document store', () => {
  beforeEach(() => {
    useStore.temporal.getState().clear()
    useStore.setState({ doc: createEmptyDoc('t'), selection: [], dirty: false })
  })

  const load = () => {
    const doc = project()
    doc.sheets[0]!.nodes.push(bubble('PT', '102', 'pt102'))
    useStore.getState().loadIntoStore(doc)
    useStore.temporal.getState().clear()
  }

  it('applies as ONE undoable step, and undo restores the exact previous document', () => {
    load()
    const before = useStore.getState().doc
    const r = reconcileScreen(before, before.hmiScreens[0]!.id)!
    useStore.getState().applyReconciliation(planFor(r, { 'PT-102': { action: 'add' } }))

    const after = useStore.getState().doc
    expect(after).not.toBe(before)
    expect(after.hmiScreens[0]!.widgets.some((w) => w.tag === 'PT-102')).toBe(true)
    expect(useStore.temporal.getState().pastStates).toHaveLength(1)

    useStore.getState().undo()
    const undone = useStore.getState().doc
    expect(undone.hmiScreens).toEqual(before.hmiScreens)
    expect(undone.hmiScreens[0]!.widgets.some((w) => w.tag === 'PT-102')).toBe(false)
    expect(undone.hmiScreens[0]!.baseline).toEqual(before.hmiScreens[0]!.baseline)
  })

  it('records no undo step for an empty plan', () => {
    load()
    const doc = useStore.getState().doc
    const r = reconcileScreen(doc, doc.hmiScreens[0]!.id)!
    useStore.getState().applyReconciliation(planFor(r, {}))
    expect(useStore.getState().doc).toBe(doc)
    expect(useStore.temporal.getState().pastStates).toHaveLength(0)
  })
})
