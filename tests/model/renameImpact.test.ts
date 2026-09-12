// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import { applyRename, renameImpact } from '../../src/model/references'
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'

const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget => ({
  x: 0, y: 0, w: 64, h: 64, ...w,
})

/** LT-101 referenced from every AUTO path, plus all three REVIEW fields. */
function fixture(): ProjectDoc {
  const screen: HmiScreen = {
    ...createScreen(1), id: 'scr1', name: 'Overview', pipes: [],
    widgets: [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101', label: 'Tank Level' }),
      widget({ id: 'w2', type: 'bar', tag: 'LT-101' }),
      widget({ id: 'w3', type: 'display', tag: 'LT-101' }),
      widget({ id: 'w4', type: 'gauge', tag: 'LT-101' }),
      widget({ id: 'w5', type: 'trend', tag: 'FT-200', pens: [{ ref: 'LT-101.PV' }, { ref: 'LT-101.SP' }] }),
      widget({ id: 'w6', type: 'lamp', props: { signal: 'LT-101.PV' } }),
      widget({ id: 'w7', type: 'display', tag: 'LIC-101', props: { bindTank: 'LT-101' } }),
      widget({ id: 'w8', type: 'display', tag: 'PT-300', props: { bindPipe: 'LT-101' } }),
    ],
  }
  return {
    ...createEmptyDoc('t'),
    hmiScreens: [screen],
    registry: {
      'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-10 bar' } },
      'P-101': { key: 'P-101', kind: 'equipment', fields: { 'general.line': 'from LT-101 header' } },
      'P-102': { key: 'P-102', kind: 'equipment', fields: { 'general.pid': 'LT-101' } },
      'P-103': { key: 'P-103', kind: 'equipment', fields: { 'general.area': 'LT-101 bund' } },
    },
    qa: { ignored: { 'missing-tag:LT-101': { reason: 'spare', at: '2026-09-08' } } },
  }
}

const preview = (doc: ProjectDoc) => renameImpact(doc, 'LT-101', 'LT-201')

describe('renameImpact', () => {
  it('reports nothing for a key with no references', () => {
    const i = renameImpact(fixture(), 'ZZ-999', 'ZZ-998')
    expect(i.auto).toHaveLength(0)
    expect(i.review).toHaveLength(0)
    expect(i.collision).toBe(false)
    expect(i.counts.auto).toBe(0)
  })

  it('is inert when the key does not change, or either side is missing', () => {
    for (const [a, b] of [['LT-101', 'LT-101'], ['LT-101', ''], ['', 'LT-201']] as const) {
      const i = renameImpact(fixture(), a, b)
      expect(i.counts.auto + i.counts.review + i.counts.blocked).toBe(0)
    }
  })

  it('lists every AUTO reference and counts them by location', () => {
    const i = preview(fixture())
    expect(i.counts.byWhere.registry).toBe(1)
    expect(i.counts.byWhere['hmi-widget']).toBe(4)
    expect(i.counts.byWhere['hmi-pen']).toBe(2)
    expect(i.counts.byWhere['hmi-signal']).toBe(1)
    expect(i.counts.byWhere['hmi-bind']).toBe(1)
    expect(i.counts.byWhere['qa-ignored']).toBe(1)
    expect(i.counts.auto).toBe(10)
  })

  it('surfaces general.line, general.pid and general.area as review, not auto', () => {
    const i = preview(fixture())
    expect(i.counts.review).toBe(3)
    expect(i.counts.byWhere['record-field']).toBe(3)
    const labels = i.review.map((r) => r.label).join(' | ')
    expect(labels).toContain('general.line')
    expect(labels).toContain('general.pid')
    expect(labels).toContain('general.area')
    expect(i.auto.every((r) => r.where !== 'record-field')).toBe(true)
  })

  it('keeps bindPipe out of the impact entirely', () => {
    const i = preview(fixture())
    expect([...i.auto, ...i.review].some((r) => r.path.widgetId === 'w8')).toBe(false)
  })

  it('includes bindTank in AUTO', () => {
    expect(preview(fixture()).auto.some((r) => r.where === 'hmi-bind')).toBe(true)
  })

  it('mutates nothing — the document is the same object afterwards', () => {
    const doc = fixture()
    const snapshot = JSON.stringify(doc)
    const before = { registry: doc.registry, screens: doc.hmiScreens, qa: doc.qa }
    preview(doc)
    expect(doc.registry).toBe(before.registry)
    expect(doc.hmiScreens).toBe(before.screens)
    expect(doc.qa).toBe(before.qa)
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('is deterministic — repeated calls give the same answer', () => {
    const doc = fixture()
    expect(JSON.stringify(preview(doc))).toBe(JSON.stringify(preview(doc)))
  })

  it('predicts exactly what applyRename then applies', () => {
    const doc = fixture()
    const predicted = preview(doc)
    const applied = applyRename(doc, 'LT-101', 'LT-201')
    expect(applied.applied).toHaveLength(predicted.counts.auto)
    expect(applied.deferred).toHaveLength(predicted.counts.review)
    expect(applied.broken).toHaveLength(predicted.counts.blocked)
  })
})

describe('renameImpact on a collision', () => {
  function colliding(): ProjectDoc {
    const doc = fixture()
    return {
      ...doc,
      registry: { ...doc.registry, 'LT-201': { key: 'LT-201', kind: 'instrument', fields: { 'signal.range': '0-250 bar' } } },
    }
  }

  it('reports the collision before anything is committed', () => {
    const i = preview(colliding())
    expect(i.collision).toBe(true)
    expect(i.auto).toHaveLength(0)
    expect(i.blocked).toHaveLength(10)
    expect(i.counts.blocked).toBe(10)
    expect(i.blocked.every((r) => r.class === 'broken')).toBe(true)
  })

  it('still lists the review fields, which a collision does not affect', () => {
    expect(preview(colliding()).counts.review).toBe(3)
  })

  it('agrees with the collision applyRename would report', () => {
    const doc = colliding()
    expect(preview(doc).collision).toBe(applyRename(doc, 'LT-101', 'LT-201').broken.length > 0)
  })

  it('leaves the document untouched when previewed', () => {
    const doc = colliding()
    const snapshot = JSON.stringify(doc)
    preview(doc)
    expect(JSON.stringify(doc)).toBe(snapshot)
  })
})
