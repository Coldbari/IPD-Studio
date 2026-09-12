// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { orphanedBinding } from '../../src/validate/rules/data'
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { PlantNode, ProjectDoc } from '../../src/model/types'
import { useStore } from '../../src/store/store'
import { applyFix } from '../../src/assist/fixes'
import { applyRename, collectHmiBindings } from '../../src/model/references'
import { loadDoc } from '../../src/model/migrate'
import { readFileSync } from 'node:fs'

let n = 0
const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget => ({
  x: 0, y: 0, w: 64, h: 64, ...w,
})
const bubble = (letters: string, loop: string): PlantNode => ({
  id: `n${n++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0,
  tag: { letters, loop },
})

/** `drawn` are tags actually on the sheet; `widgets` are the HMI bindings. */
function docOf(drawn: PlantNode[], widgets: HmiWidget[]): ProjectDoc {
  const d = createEmptyDoc('t')
  d.sheets[0]!.nodes = drawn
  const screen: HmiScreen = { ...createScreen(1), id: 'scr1', name: 'Overview', widgets, pipes: [] }
  return { ...d, hmiScreens: [screen] }
}

const run = (doc: ProjectDoc) => orphanedBinding.run(buildIndex(doc))

describe('orphaned-binding: the four AUTO binding paths', () => {
  it('says nothing when the widget tag is drawn on a sheet', () => {
    const doc = docOf([bubble('LT', '101')], [widget({ id: 'w1', type: 'tank', tag: 'LT-101' })])
    expect(run(doc)).toHaveLength(0)
  })

  it('reports a widget tag that is on no sheet', () => {
    const doc = docOf([], [widget({ id: 'w1', type: 'tank', tag: 'LT-101', label: 'Tank Level' })])
    const found = run(doc)
    expect(found).toHaveLength(1)
    expect(found[0]!.entityKey).toBe('LT-101')
    expect(orphanedBinding.severity).toBe('warning')
    expect(found[0]!.message).toContain('Tank Level')
    expect(found[0]!.message).toContain('LT-101')
  })

  it('reports a trend pen ref', () => {
    const doc = docOf(
      [bubble('FT', '200')],
      [widget({ id: 'w1', type: 'trend', tag: 'FT-200', pens: [{ ref: 'LT-101.PV' }, { ref: 'FT-200.PV' }] })],
    )
    const found = run(doc)
    expect(found).toHaveLength(1)
    expect(found[0]!.entityKey).toBe('LT-101')
  })

  it('reports a props.signal ref', () => {
    const doc = docOf([], [widget({ id: 'w1', type: 'lamp', props: { signal: 'LT-101.PV' } })])
    const found = run(doc)
    expect(found).toHaveLength(1)
    expect(found[0]!.entityKey).toBe('LT-101')
  })

  it('reports a props.bindTank ref', () => {
    const doc = docOf(
      [bubble('LIC', '101')],
      [widget({ id: 'w1', type: 'display', tag: 'LIC-101', props: { bindTank: 'TK-3' } })],
    )
    const found = run(doc)
    expect(found).toHaveLength(1)
    expect(found[0]!.entityKey).toBe('TK-3')
  })

  it('leaves bindPipe alone — it holds a pipe id, not a tag', () => {
    const doc = docOf(
      [bubble('FT', '200')],
      [widget({ id: 'w1', type: 'display', tag: 'FT-200', props: { bindPipe: 'not-a-tag' } })],
    )
    expect(run(doc)).toHaveLength(0)
  })
})

describe('orphaned-binding: reporting shape', () => {
  it('reports each broken binding independently, with distinct keys', () => {
    const doc = docOf([], [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101' }),
      widget({ id: 'w2', type: 'bar', tag: 'LT-101' }),
      widget({ id: 'w3', type: 'trend', pens: [{ ref: 'LT-101.PV' }, { ref: 'LT-101.SP' }] }),
      widget({ id: 'w4', type: 'lamp', props: { signal: 'LT-101.PV' } }),
      widget({ id: 'w5', type: 'display', tag: 'LIC-9', props: { bindTank: 'LT-101' } }),
    ])
    const found = run(doc)
    // 2 tags + 2 pens + 1 signal + 1 bindTank + LIC-9's own tag = 7
    expect(found).toHaveLength(7)
    // No duplicate finding keys: accepting one must not silence another.
    expect(new Set(found.map((f) => f.key)).size).toBe(found.length)
    // ...but they still group under the engineering key they are about.
    expect(found.filter((f) => f.entityKey === 'LT-101')).toHaveLength(6)
  })

  it('never guesses a replacement tag — the only fix offered clears', () => {
    const doc = docOf([], [widget({ id: 'w1', type: 'tank', tag: 'LT-101' })])
    expect(run(doc)[0]!.fix?.spec.kind).toBe('clear-binding')
  })

  it('is linear in bindings — 500 widgets stay well inside a frame', () => {
    const widgets = Array.from({ length: 500 }, (_, i) => widget({ id: `w${i}`, type: 'tank', tag: `LT-${i}` }))
    const doc = docOf([], widgets)
    const t0 = performance.now()
    const found = run(doc)
    expect(found).toHaveLength(500)
    expect(performance.now() - t0).toBeLessThan(100)
  })
})

describe('orphaned-binding: interaction with rename', () => {
  it('a valid P0-A rename leaves ZERO orphan findings', () => {
    const drawn = bubble('LT', '101')
    const doc = docOf([drawn], [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101' }),
      widget({ id: 'w2', type: 'trend', pens: [{ ref: 'LT-101.PV' }] }),
      widget({ id: 'w3', type: 'lamp', props: { signal: 'LT-101.PV' } }),
      widget({ id: 'w4', type: 'display', tag: 'LIC-1', props: { bindTank: 'LT-101' } }),
    ])
    expect(run(doc).filter((f) => f.entityKey === 'LT-101')).toHaveLength(0)

    // Rename the symbol, then carry the references exactly as the store does.
    const renamedSheets = doc.sheets.map((sh) => ({
      ...sh,
      nodes: sh.nodes.map((nd) => (nd.id === drawn.id ? { ...nd, tag: { letters: 'LT', loop: '201' } } : nd)),
    }))
    const { doc: after } = applyRename({ ...doc, sheets: renamedSheets }, 'LT-101', 'LT-201')

    expect(run(after).filter((f) => f.entityKey === 'LT-101')).toHaveLength(0)
    expect(run(after).filter((f) => f.entityKey === 'LT-201')).toHaveLength(0)
  })

  it('clearing a tag orphans the bindings that pointed at it', () => {
    const drawn = bubble('LT', '101')
    const doc = docOf([drawn], [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101' }),
      widget({ id: 'w2', type: 'lamp', props: { signal: 'LT-101.PV' } }),
    ])
    expect(run(doc)).toHaveLength(0)

    const cleared = {
      ...doc,
      sheets: doc.sheets.map((sh) => ({
        ...sh,
        nodes: sh.nodes.map((nd) => (nd.id === drawn.id ? { ...nd, tag: undefined } : nd)),
      })),
    }
    expect(run(cleared)).toHaveLength(2)
  })

  it('deleting the symbol orphans them too', () => {
    const drawn = bubble('LT', '101')
    const doc = docOf([drawn], [widget({ id: 'w1', type: 'tank', tag: 'LT-101' })])
    const deleted = { ...doc, sheets: doc.sheets.map((sh) => ({ ...sh, nodes: [] })) }
    expect(run(deleted)).toHaveLength(1)
  })
})

describe('the bundled samples stay quiet', () => {
  /** The decision this pins: bindings are checked against tags DRAWN on a
   *  sheet, not against engineering records. Every shipped sample has an empty
   *  registry, so a registry-based check would report all 12 bindings of the
   *  HMI demo — a check that fires on the sample project gets switched off. */
  it('reports nothing on template-hmi-demo, which has 12 bindings and no records', () => {
    const raw = readFileSync(new URL('../../examples/template-hmi-demo.pnid.json', import.meta.url), 'utf8')
    const doc = loadDoc(JSON.parse(raw))
    expect(Object.keys(doc.registry ?? {})).toHaveLength(0)
    expect(collectHmiBindings(doc).length).toBeGreaterThanOrEqual(12)
    expect(run(doc)).toHaveLength(0)
  })
})

describe('the clear-binding fix', () => {
  function load(widgets: HmiWidget[], drawn: PlantNode[] = []) {
    useStore.getState().loadIntoStore(docOf(drawn, widgets))
  }
  const screen = () => useStore.getState().doc.hmiScreens[0]!
  const byId = (id: string) => screen().widgets.find((w) => w.id === id)
  const fixFor = (entityKey: string) => {
    const f = run(useStore.getState().doc).find((x) => x.entityKey === entityKey)
    return f!.fix!.spec
  }

  beforeEach(() => { useStore.getState().loadIntoStore(createEmptyDoc('t')) })

  it('clears only the widget tag it named', () => {
    load([
      widget({ id: 'w1', type: 'tank', tag: 'LT-101' }),
      widget({ id: 'w2', type: 'bar', tag: 'PT-900' }),
    ])
    const spec = run(useStore.getState().doc).find((f) => f.entityKey === 'LT-101')!.fix!.spec
    expect(applyFix(spec).ok).toBe(true)
    expect(byId('w1')?.tag).toBeUndefined()
    expect(byId('w2')?.tag).toBe('PT-900')
  })

  it('removes only the affected pen', () => {
    load([widget({ id: 'w1', type: 'trend', tag: 'FT-200', pens: [{ ref: 'LT-101.PV' }, { ref: 'FT-200.PV' }] })],
      [bubble('FT', '200')])
    expect(applyFix(fixFor('LT-101')).ok).toBe(true)
    expect(byId('w1')?.pens?.map((p) => p.ref)).toEqual(['FT-200.PV'])
  })

  it('clears only the named signal prop', () => {
    load([widget({ id: 'w1', type: 'button', props: { signal: 'LT-101.PV', writeValue: 1 } })])
    expect(applyFix(fixFor('LT-101')).ok).toBe(true)
    expect(byId('w1')?.props?.signal).toBeUndefined()
    expect(byId('w1')?.props?.writeValue).toBe(1)
  })

  it('clears only bindTank and leaves bindPipe untouched', () => {
    load([widget({ id: 'w1', type: 'display', tag: 'LIC-1', props: { bindTank: 'TK-3', bindPipe: 'p1' } })],
      [bubble('LIC', '1')])
    expect(applyFix(fixFor('TK-3')).ok).toBe(true)
    expect(byId('w1')?.props?.bindTank).toBeUndefined()
    expect(byId('w1')?.props?.bindPipe).toBe('p1')
    expect(byId('w1')?.tag).toBe('LIC-1')
  })

  it('creates no registry record and touches no other widget', () => {
    load([
      widget({ id: 'w1', type: 'tank', tag: 'LT-101' }),
      widget({ id: 'w2', type: 'lamp', props: { signal: 'LT-101.PV' } }),
    ])
    const spec = run(useStore.getState().doc).find(
      (f) => f.fix!.spec.kind === 'clear-binding' && (f.fix!.spec as { widgetId: string }).widgetId === 'w1',
    )!.fix!.spec
    applyFix(spec)
    expect(useStore.getState().doc.registry?.['LT-101']).toBeUndefined()
    // The other broken binding is left for its own finding and its own fix.
    expect(byId('w2')?.props?.signal).toBe('LT-101.PV')
  })

  it('refuses on a stale report rather than wiping an edited binding', () => {
    load([widget({ id: 'w1', type: 'tank', tag: 'LT-101' })])
    const spec = fixFor('LT-101')
    useStore.getState().replaceScreen({
      ...screen(),
      widgets: [widget({ id: 'w1', type: 'tank', tag: 'LT-999' })],
    })
    const result = applyFix(spec)
    expect(result.ok).toBe(false)
    expect(byId('w1')?.tag).toBe('LT-999')
  })
})
