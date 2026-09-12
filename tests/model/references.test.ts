// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import { collectTagRefs, collectHmiBindings, applyRename, REVIEW_FIELDS } from '../../src/model/references'
import type { RefWhere } from '../../src/model/references'
import { TAG_PROP_KINDS, WIDGET_SCHEMA, createScreen } from '../../src/hmi/model'
import type { HmiScreen, HmiWidget, PropKind } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'

/**
 * The tag-reference LEDGER.
 *
 * Every location in a saved document that stores an engineering key must be
 * listed here and collected by collectTagRefs. The point is that a future
 * `HmiWidget.someNewTagReference` cannot be added without this test failing.
 */
const LEDGER: RefWhere[] = [
  'registry',
  'hmi-widget',
  'hmi-pen',
  'hmi-signal',
  'hmi-bind',
  'qa-ignored',
  'record-field',
]

/** PropKinds whose value contains a tag. `pipeRef`/`screenRef`/`symbolRef` hold
 *  ids and must stay OUT: adding one here without teaching the collector how to
 *  read it would break renames. */
const TAG_BEARING_KINDS: PropKind[] = ['signalRef', 'tagRef', 'tankRef']
const ID_BEARING_KINDS: PropKind[] = ['pipeRef', 'screenRef', 'symbolRef']

function widget(w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget {
  return { x: 0, y: 0, w: 64, h: 64, ...w }
}

/** A document exercising every reference class at once. */
function fixture(): ProjectDoc {
  const doc = createEmptyDoc()
  const screen: HmiScreen = {
    ...createScreen(1),
    id: 'scr1',
    name: 'Overview',
    widgets: [
      // 4 widgets bound to the tag itself...
      widget({ id: 'w1', type: 'tank', tag: 'LT-101', label: 'Tank Level' }),
      widget({ id: 'w2', type: 'bar', tag: 'LT-101' }),
      widget({ id: 'w3', type: 'display', tag: 'LT-101' }),
      widget({ id: 'w4', type: 'gauge', tag: 'LT-101' }),
      // ...2 trend pens, beside one that must not move...
      widget({
        id: 'w5',
        type: 'trend',
        tag: 'FT-200',
        pens: [{ ref: 'LT-101.PV' }, { ref: 'LT-101.SP' }, { ref: 'FT-200.PV' }],
      }),
      // ...1 signal prop...
      widget({ id: 'w6', type: 'lamp', props: { signal: 'LT-101.PV' } }),
      // ...and 1 bindTank, which holds a bare tag (reference #11).
      widget({ id: 'w7', type: 'display', tag: 'LIC-101', props: { bindTank: 'LT-101' } }),
      // Must NOT be touched: a pipe id that happens to read like a tag.
      widget({ id: 'w8', type: 'display', tag: 'PT-300', props: { bindPipe: 'LT-101' } }),
    ],
    pipes: [],
  }
  return {
    ...doc,
    hmiScreens: [screen],
    registry: {
      'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-10 bar' } },
      'P-101': { key: 'P-101', kind: 'equipment', fields: { 'general.line': 'from LT-101 header' } },
    },
    qa: { ignored: { 'missing-tag:LT-101': { reason: 'spare', at: '2026-09-08' } } },
  }
}

describe('the reference ledger', () => {
  it('collects every location on the ledger from one fixture', () => {
    const found = new Set(collectTagRefs(fixture(), 'LT-101').map((r) => r.where))
    for (const where of LEDGER) {
      expect(found, `ledger location "${where}" was not collected`).toContain(where)
    }
    for (const where of found) {
      expect(LEDGER, `collected "${where}" is not on the test ledger`).toContain(where)
    }
  })

  it('pins which PropKinds carry a tag, so a new one cannot slip past', () => {
    for (const kind of TAG_BEARING_KINDS) {
      expect(TAG_PROP_KINDS[kind], `${kind} must be readable as a tag`).toBeDefined()
    }
    for (const kind of ID_BEARING_KINDS) {
      expect(TAG_PROP_KINDS[kind], `${kind} holds an id, not a tag`).toBeUndefined()
    }
    // Every kind used by a real widget prop is classified one way or the other.
    const used = new Set<string>()
    for (const schema of Object.values(WIDGET_SCHEMA)) for (const k of Object.values(schema)) used.add(k)
    for (const kind of used) {
      const known = ['number', 'boolean', 'string', ...TAG_BEARING_KINDS, ...ID_BEARING_KINDS]
      expect(known, `PropKind "${kind}" is unclassified for renames`).toContain(kind)
    }
  })

  it('collectHmiBindings covers all four HMI binding paths', () => {
    const bindings = collectHmiBindings(fixture())
    const where = new Set(bindings.map((b) => b.where))
    expect(where).toEqual(new Set(['hmi-widget', 'hmi-pen', 'hmi-signal', 'hmi-bind']))
    // Same traversal the orphan rule validates, so neither can drift.
    expect(bindings.filter((b) => b.tag === 'LT-101')).toHaveLength(8)
  })

  it('addresses every reference by path, never by label', () => {
    for (const ref of collectTagRefs(fixture(), 'LT-101')) {
      expect(Object.keys(ref.path).length, `${ref.where} has no machine path`).toBeGreaterThan(0)
    }
  })
})

describe('collectTagRefs', () => {
  it('finds the record, 4 widgets, 2 pens, 1 signal, 1 bind and 1 accepted finding', () => {
    const refs = collectTagRefs(fixture(), 'LT-101')
    const count = (w: RefWhere) => refs.filter((r) => r.where === w).length
    expect(count('registry')).toBe(1)
    expect(count('hmi-widget')).toBe(4)
    expect(count('hmi-pen')).toBe(2)
    expect(count('hmi-signal')).toBe(1)
    expect(count('hmi-bind')).toBe(1)
    expect(count('qa-ignored')).toBe(1)
    expect(count('record-field')).toBe(1)
  })

  it('ignores props that hold ids rather than tags', () => {
    const refs = collectTagRefs(fixture(), 'LT-101')
    expect(refs.some((r) => r.path.widgetId === 'w8')).toBe(false)
  })

  it('matches human text on a word boundary, not a substring', () => {
    const doc = createEmptyDoc()
    const withField = (value: string): ProjectDoc => ({
      ...doc,
      registry: { 'P-1': { key: 'P-1', kind: 'equipment', fields: { 'general.line': value } } },
    })
    const hit = (value: string) => collectTagRefs(withField(value), 'LT-101').length
    expect(hit('from LT-101 header')).toBe(1)
    expect(hit('LT-101')).toBe(1)
    expect(hit('LT-1011')).toBe(0)
    expect(hit('LT-101-A')).toBe(0)
  })

  it('classifies human text as review, never auto', () => {
    const refs = collectTagRefs(fixture(), 'LT-101').filter((r) => r.where === 'record-field')
    expect(refs.every((r) => r.class === 'review')).toBe(true)
    expect(REVIEW_FIELDS).toContain('general.line')
  })
})

describe('applyRename', () => {
  const rename = (doc: ProjectDoc) => applyRename(doc, 'LT-101', 'LT-201')

  it('moves the engineering record', () => {
    const { doc } = rename(fixture())
    expect(doc.registry?.['LT-201']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc.registry?.['LT-101']).toBeUndefined()
  })

  it('updates HmiWidget.tag on every bound widget', () => {
    const { doc } = rename(fixture())
    const tags = doc.hmiScreens[0]!.widgets.map((w) => w.tag)
    expect(tags).toEqual(['LT-201', 'LT-201', 'LT-201', 'LT-201', 'FT-200', undefined, 'LIC-101', 'PT-300'])
  })

  it('updates trend pen refs and leaves other pens alone', () => {
    const { doc } = rename(fixture())
    const pens = doc.hmiScreens[0]!.widgets.find((w) => w.id === 'w5')?.pens
    expect(pens?.map((p) => p.ref)).toEqual(['LT-201.PV', 'LT-201.SP', 'FT-200.PV'])
  })

  it('updates a signalRef prop', () => {
    const { doc } = rename(fixture())
    expect(doc.hmiScreens[0]!.widgets.find((w) => w.id === 'w6')?.props?.signal).toBe('LT-201.PV')
  })

  it('updates a bindTank prop, which holds a bare tag', () => {
    const { doc } = rename(fixture())
    expect(doc.hmiScreens[0]!.widgets.find((w) => w.id === 'w7')?.props?.bindTank).toBe('LT-201')
  })

  it('leaves bindPipe alone — it holds a pipe id', () => {
    const { doc } = rename(fixture())
    expect(doc.hmiScreens[0]!.widgets.find((w) => w.id === 'w8')?.props?.bindPipe).toBe('LT-101')
  })

  it('re-keys an accepted QA finding', () => {
    const { doc } = rename(fixture())
    expect(doc.qa?.ignored['missing-tag:LT-201']?.reason).toBe('spare')
    expect(doc.qa?.ignored['missing-tag:LT-101']).toBeUndefined()
  })

  it('does NOT rewrite human text, and reports it as deferred', () => {
    const { doc, deferred } = rename(fixture())
    expect(doc.registry?.['P-101']?.fields['general.line']).toBe('from LT-101 header')
    expect(deferred).toHaveLength(1)
    expect(deferred[0]!.where).toBe('record-field')
  })

  it('A → B → A restores the document exactly', () => {
    const before = fixture()
    const there = applyRename(before, 'LT-101', 'LT-201')
    const back = applyRename(there.doc, 'LT-201', 'LT-101')
    expect(back.doc).toEqual(before)
  })

  it('is a no-op when the key does not change', () => {
    const before = fixture()
    const { doc, applied } = applyRename(before, 'LT-101', 'LT-101')
    expect(doc).toBe(before)
    expect(applied).toHaveLength(0)
  })

  it('is a no-op when either key is absent (clearing a tag moves nothing)', () => {
    const before = fixture()
    expect(applyRename(before, 'LT-101', null).doc).toBe(before)
    expect(applyRename(before, null, 'LT-201').doc).toBe(before)
  })
})

describe('applyRename collision', () => {
  function collidingDoc(): ProjectDoc {
    const doc = fixture()
    return {
      ...doc,
      registry: {
        ...doc.registry,
        'LT-201': { key: 'LT-201', kind: 'instrument', fields: { 'signal.range': '0-250 bar' } },
      },
    }
  }

  /**
   * The atomicity invariant. applyRename is all-or-nothing: on collision the
   * document it returns IS the document it was handed — same object, so no
   * caller can accidentally commit a half-renamed state, and no deep equality
   * check can be fooled by a rebuilt-but-equal object.
   */
  it('returns the very same document object — nothing was rebuilt', () => {
    const before = collidingDoc()
    const result = applyRename(before, 'LT-101', 'LT-201')
    expect(result.doc).toBe(before)
    expect(result.doc.registry).toBe(before.registry)
    expect(result.doc.hmiScreens).toBe(before.hmiScreens)
    expect(result.doc.qa).toBe(before.qa)
    expect(result.applied).toHaveLength(0)
    expect(result.deferred).toHaveLength(0)
  })

  it('reports every auto reference it could not move', () => {
    const { broken } = applyRename(collidingDoc(), 'LT-101', 'LT-201')
    const where = new Set(broken.map((r) => r.where))
    for (const w of ['registry', 'hmi-widget', 'hmi-pen', 'hmi-signal', 'hmi-bind', 'qa-ignored']) {
      expect(where, `collision should report the blocked ${w} reference`).toContain(w)
    }
    expect(broken.every((r) => r.class === 'broken')).toBe(true)
  })

  it('leaves both records intact', () => {
    const { doc } = applyRename(collidingDoc(), 'LT-101', 'LT-201')
    expect(doc.registry?.['LT-101']?.fields['signal.range']).toBe('0-10 bar')
    expect(doc.registry?.['LT-201']?.fields['signal.range']).toBe('0-250 bar')
  })

  it('leaves every HMI binding on the old tag rather than half-moving them', () => {
    const { doc, broken } = applyRename(collidingDoc(), 'LT-101', 'LT-201')
    expect(doc.hmiScreens[0]!.widgets.find((w) => w.id === 'w1')?.tag).toBe('LT-101')
    expect(doc.hmiScreens[0]!.widgets.find((w) => w.id === 'w6')?.props?.signal).toBe('LT-101.PV')
    expect(doc.qa?.ignored['missing-tag:LT-101']).toBeDefined()
    expect(broken.length).toBeGreaterThan(0)
    expect(broken.every((r) => r.class === 'broken')).toBe(true)
  })
})
