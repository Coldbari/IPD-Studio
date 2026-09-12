// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import { compareDocs, compareRevisions, DOC_FIELD_COVERAGE } from '../../src/model/diff'
import type { DocChange } from '../../src/model/diff'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { newRevision } from '../../src/model/revision'
import { createScreen } from '../../src/hmi/model'
import type { HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { PlantEdge, PlantNode, ProjectDoc } from '../../src/model/types'

const node = (p: Partial<PlantNode> & Pick<PlantNode, 'id'>): PlantNode => ({
  symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, ...p,
})
const edge = (p: Partial<PlantEdge> & Pick<PlantEdge, 'id'>): PlantEdge => ({
  lineClass: 'process.major',
  source: { nodeId: 'n1', portId: 'e' },
  target: { nodeId: 'n2', portId: 'w' },
  ...p,
})
const widget = (p: Partial<HmiWidget> & Pick<HmiWidget, 'id' | 'type'>): HmiWidget => ({
  x: 0, y: 0, w: 64, h: 64, ...p,
})

/** A document with one sheet of a known id, so diffs are addressable. */
function docOf(over: Partial<ProjectDoc> & { nodes?: PlantNode[]; edges?: PlantEdge[] } = {}): ProjectDoc {
  const base = createEmptyDoc('t')
  const { nodes = [], edges = [], ...rest } = over
  return {
    ...base,
    sheets: [{ ...base.sheets[0]!, id: 'sh1', nodes, edges }],
    ...rest,
  }
}

const find = (cs: DocChange[], p: Partial<DocChange>): DocChange | undefined =>
  cs.find((c) => Object.entries(p).every(([k, v]) => (c as unknown as Record<string, unknown>)[k] === v))

describe('a diff of identical snapshots', () => {
  it('is empty', () => {
    const d = docOf({ nodes: [node({ id: 'n1', tag: { letters: 'LT', loop: '101' } })] })
    const diff = compareDocs(d, d)
    expect(diff.changes).toHaveLength(0)
    expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0, renamed: 0 })
    expect(diff.engineeringCount).toBe(0)
  })
})

describe('the drawing model', () => {
  it('reports an added and a removed node', () => {
    const before = docOf({ nodes: [node({ id: 'n1', tag: { letters: 'LT', loop: '101' } })] })
    const after = docOf({ nodes: [node({ id: 'n2', tag: { letters: 'PT', loop: '200' } })] })
    const { changes, counts } = compareDocs(before, after)
    expect(counts.added).toBe(1)
    expect(counts.removed).toBe(1)
    expect(find(changes, { kind: 'removed', entityType: 'node', entityKey: 'LT-101' })).toBeTruthy()
    expect(find(changes, { kind: 'added', entityType: 'node', entityKey: 'PT-200' })).toBeTruthy()
  })

  it('reports a modified node field, and separates engineering from graphical', () => {
    const before = docOf({ nodes: [node({ id: 'n1', label: 'Old', x: 0 })] })
    const after = docOf({ nodes: [node({ id: 'n1', label: 'New', x: 64 })] })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { field: 'label' })).toMatchObject({ before: 'Old', after: 'New', category: 'engineering' })
    expect(find(changes, { field: 'x' })).toMatchObject({ before: 0, after: 64, category: 'graphical' })
  })

  it('reports several field changes on one object independently', () => {
    const before = docOf({ nodes: [node({ id: 'n1', label: 'A', cost: 100, config: { positioner: 'none' } })] })
    const after = docOf({ nodes: [node({ id: 'n1', label: 'B', cost: 250, config: { positioner: 'yes' } })] })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { field: 'label' })).toBeTruthy()
    expect(find(changes, { field: 'cost' })).toMatchObject({ before: 100, after: 250 })
    expect(find(changes, { field: 'config.positioner' })).toMatchObject({ before: 'none', after: 'yes' })
  })

  it('reports edges added, removed and rerouted', () => {
    const before = docOf({ edges: [edge({ id: 'e1' }), edge({ id: 'e2' })] })
    const after = docOf({
      edges: [edge({ id: 'e1', target: { nodeId: 'n3', portId: 'w' } }), edge({ id: 'e3' })],
    })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { kind: 'removed', entityType: 'edge', entityId: 'e2' })).toBeTruthy()
    expect(find(changes, { kind: 'added', entityType: 'edge', entityId: 'e3' })).toBeTruthy()
    expect(find(changes, { entityId: 'e1', field: 'target' })).toMatchObject({ before: 'n2:w', after: 'n3:w' })
  })

  it('reports sheets added and removed, and sheet metadata changes', () => {
    const base = createEmptyDoc('t')
    const before = docOf({})
    const after: ProjectDoc = {
      ...before,
      sheets: [
        { ...before.sheets[0]!, drawingNumber: 'PID-002' },
        { ...base.sheets[0]!, id: 'sh2', name: 'Sheet 2', nodes: [], edges: [] },
      ],
    }
    const { changes } = compareDocs(before, after)
    expect(find(changes, { kind: 'added', entityType: 'sheet', entityId: 'sh2' })).toBeTruthy()
    expect(find(changes, { entityType: 'sheet', field: 'drawingNumber' })).toMatchObject({ category: 'metadata' })
    // ...and the other direction
    expect(find(compareDocs(after, before).changes, { kind: 'removed', entityType: 'sheet', entityId: 'sh2' })).toBeTruthy()
  })
})

describe('the engineering registry', () => {
  const withRegistry = (registry: ProjectDoc['registry']) => docOf({ registry })

  it('reports added, removed and changed records', () => {
    const before = withRegistry({
      'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-10 bar' } },
      'PT-900': { key: 'PT-900', kind: 'instrument', fields: {} },
    })
    const after = withRegistry({
      'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-16 bar' } },
      'FT-200': { key: 'FT-200', kind: 'instrument', fields: {} },
    })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { kind: 'removed', entityType: 'record', entityKey: 'PT-900' })).toBeTruthy()
    expect(find(changes, { kind: 'added', entityType: 'record', entityKey: 'FT-200' })).toBeTruthy()
    expect(find(changes, { entityType: 'record', entityKey: 'LT-101', field: 'signal.range' }))
      .toMatchObject({ before: '0-10 bar', after: '0-16 bar', category: 'engineering' })
  })
})

describe('HMI', () => {
  const withScreen = (widgets: HmiWidget[], id = 'scr1'): ProjectDoc =>
    docOf({ hmiScreens: [{ ...createScreen(1), id, name: 'Overview', pipes: [], widgets } as HmiScreen] })

  it('reports widgets added and removed', () => {
    const { changes } = compareDocs(
      withScreen([widget({ id: 'w1', type: 'tank', tag: 'LT-101' })]),
      withScreen([widget({ id: 'w2', type: 'bar', tag: 'PT-200' })]),
    )
    expect(find(changes, { kind: 'removed', entityType: 'hmi-widget', entityId: 'w1' })).toBeTruthy()
    expect(find(changes, { kind: 'added', entityType: 'hmi-widget', entityId: 'w2' })).toBeTruthy()
  })

  it('reports a binding that genuinely changed', () => {
    const { changes } = compareDocs(
      withScreen([widget({ id: 'w1', type: 'tank', tag: 'LT-101' })]),
      withScreen([widget({ id: 'w1', type: 'tank', tag: 'LT-999' })]),
    )
    expect(find(changes, { entityId: 'w1', field: 'tag' })).toMatchObject({ before: 'LT-101', after: 'LT-999' })
  })

  it('reports pen and prop binding changes', () => {
    const { changes } = compareDocs(
      withScreen([widget({ id: 'w1', type: 'trend', pens: [{ ref: 'LT-101.PV' }], props: { signal: 'A.PV' } })]),
      withScreen([widget({ id: 'w1', type: 'trend', pens: [{ ref: 'FT-200.PV' }], props: { signal: 'B.PV' } })]),
    )
    expect(find(changes, { field: 'pens[0]' })).toMatchObject({ before: 'LT-101.PV', after: 'FT-200.PV' })
    expect(find(changes, { field: 'props.signal' })).toMatchObject({ before: 'A.PV', after: 'B.PV' })
  })

  it('reports whole screens added and removed', () => {
    const { changes } = compareDocs(withScreen([], 'scr1'), withScreen([], 'scr2'))
    expect(find(changes, { kind: 'removed', entityType: 'hmi-screen', entityId: 'scr1' })).toBeTruthy()
    expect(find(changes, { kind: 'added', entityType: 'hmi-screen', entityId: 'scr2' })).toBeTruthy()
  })
})

describe('identity', () => {
  it('reordering arrays creates no changes at all', () => {
    const a = node({ id: 'n1', tag: { letters: 'LT', loop: '101' } })
    const b = node({ id: 'n2', tag: { letters: 'PT', loop: '200' } })
    const e1 = edge({ id: 'e1' })
    const e2 = edge({ id: 'e2', lineClass: 'signal.electric' })
    const before = docOf({ nodes: [a, b], edges: [e1, e2] })
    const after = docOf({ nodes: [b, a], edges: [e2, e1] })
    expect(compareDocs(before, after).changes).toHaveLength(0)
  })

  it('reordering HMI widgets creates no changes', () => {
    const w1 = widget({ id: 'w1', type: 'tank', tag: 'LT-101' })
    const w2 = widget({ id: 'w2', type: 'bar', tag: 'PT-200' })
    const mk = (widgets: HmiWidget[]) =>
      docOf({ hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'S', pipes: [], widgets } as HmiScreen] })
    expect(compareDocs(mk([w1, w2]), mk([w2, w1])).changes).toHaveLength(0)
  })
})

describe('renames', () => {
  /** LT-101 → LT-201 on the same node, with its record and every HMI
   *  reference following it exactly as P0-A makes them. */
  const before = docOf({
    nodes: [node({ id: 'n1', tag: { letters: 'LT', loop: '101' } })],
    registry: { 'LT-101': { key: 'LT-101', kind: 'instrument', fields: { 'signal.range': '0-10 bar' } } },
    hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'Overview', pipes: [], widgets: [
      widget({ id: 'w1', type: 'tank', tag: 'LT-101' }),
      widget({ id: 'w2', type: 'trend', pens: [{ ref: 'LT-101.PV' }, { ref: 'LT-101.SP' }] }),
      widget({ id: 'w3', type: 'lamp', props: { signal: 'LT-101.PV' } }),
      widget({ id: 'w4', type: 'display', tag: 'LIC-1', props: { bindTank: 'LT-101' } }),
    ] } as HmiScreen],
  })
  const after = docOf({
    nodes: [node({ id: 'n1', tag: { letters: 'LT', loop: '201' } })],
    registry: { 'LT-201': { key: 'LT-201', kind: 'instrument', fields: { 'signal.range': '0-10 bar' } } },
    hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'Overview', pipes: [], widgets: [
      widget({ id: 'w1', type: 'tank', tag: 'LT-201' }),
      widget({ id: 'w2', type: 'trend', pens: [{ ref: 'LT-201.PV' }, { ref: 'LT-201.SP' }] }),
      widget({ id: 'w3', type: 'lamp', props: { signal: 'LT-201.PV' } }),
      widget({ id: 'w4', type: 'display', tag: 'LIC-1', props: { bindTank: 'LT-201' } }),
    ] } as HmiScreen],
  })

  it('is reported ONCE, as a rename', () => {
    const { changes, counts } = compareDocs(before, after)
    expect(counts.renamed).toBe(1)
    expect(find(changes, { kind: 'renamed', entityType: 'node' }))
      .toMatchObject({ field: 'tag', before: 'LT-101', after: 'LT-201' })
  })

  it('does not claim the HMI independently changed', () => {
    const { changes } = compareDocs(before, after)
    expect(changes.filter((c) => c.entityType === 'hmi-widget')).toHaveLength(0)
  })

  it('does not report the record as removed and re-added', () => {
    const { changes } = compareDocs(before, after)
    expect(changes.filter((c) => c.entityType === 'record')).toHaveLength(0)
  })

  it('the whole rename is one change, not eight', () => {
    expect(compareDocs(before, after).changes).toHaveLength(1)
  })

  it('still reports a real field edit made in the same revision', () => {
    const edited: ProjectDoc = {
      ...after,
      registry: { 'LT-201': { key: 'LT-201', kind: 'instrument', fields: { 'signal.range': '0-16 bar' } } },
    }
    const { changes } = compareDocs(before, edited)
    expect(find(changes, { kind: 'renamed' })).toBeTruthy()
    expect(find(changes, { entityType: 'record', field: 'signal.range' }))
      .toMatchObject({ before: '0-10 bar', after: '0-16 bar', entityKey: 'LT-201' })
  })

  it('a widget repointed to an unrelated tag during a rename is still reported', () => {
    const moved: ProjectDoc = {
      ...after,
      hmiScreens: [{ ...after.hmiScreens[0]!, widgets: [
        widget({ id: 'w1', type: 'tank', tag: 'PT-900' }),
        ...after.hmiScreens[0]!.widgets.slice(1),
      ] } as HmiScreen],
    }
    const { changes } = compareDocs(before, moved)
    expect(find(changes, { entityId: 'w1', field: 'tag' })).toMatchObject({ before: 'LT-101', after: 'PT-900' })
  })

  it('renumbering a line is a rename too', () => {
    const b = docOf({ edges: [edge({ id: 'e1', lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '001' } })] })
    const a = docOf({ edges: [edge({ id: 'e1', lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '002' } })] })
    expect(find(compareDocs(b, a).changes, { kind: 'renamed', entityType: 'edge' }))
      .toMatchObject({ before: '6"-CS-CW-001', after: '6"-CS-CW-002' })
  })
})

describe('determinism', () => {
  it('the same snapshots give byte-identical results', () => {
    const before = docOf({
      nodes: [node({ id: 'n2', label: 'B' }), node({ id: 'n1', label: 'A' })],
      registry: { 'B-2': { key: 'B-2', kind: 'instrument', fields: { f: '1' } } },
    })
    const after = docOf({
      nodes: [node({ id: 'n1', label: 'A2' }), node({ id: 'n2', label: 'B2' })],
      registry: { 'B-2': { key: 'B-2', kind: 'instrument', fields: { f: '2' } } },
    })
    const one = JSON.stringify(compareDocs(before, after))
    const two = JSON.stringify(compareDocs(before, after))
    expect(one).toBe(two)
  })
})

describe('read-only safety', () => {
  it('mutates neither snapshot', () => {
    const before = docOf({ nodes: [node({ id: 'n1', label: 'A' })], registry: { 'X-1': { key: 'X-1', kind: 'instrument', fields: { f: '1' } } } })
    const after = docOf({ nodes: [node({ id: 'n1', label: 'B' })], registry: { 'X-1': { key: 'X-1', kind: 'instrument', fields: { f: '2' } } } })
    const snapBefore = JSON.stringify(before)
    const snapAfter = JSON.stringify(after)
    const refs = { sheets: before.sheets, registry: before.registry, screens: before.hmiScreens }

    compareDocs(before, after)

    expect(JSON.stringify(before)).toBe(snapBefore)
    expect(JSON.stringify(after)).toBe(snapAfter)
    expect(before.sheets).toBe(refs.sheets)
    expect(before.registry).toBe(refs.registry)
    expect(before.hmiScreens).toBe(refs.screens)
  })
})

describe('comparing revisions', () => {
  const revA = { ...newRevision('r1', { code: 'A', status: 'IFC' }), issuedAt: 'x', snapshotId: 's1', qaAtIssue: { critical: 1, warning: 2, info: 3, total: 6 } }
  const revB = { ...newRevision('r2', { code: 'B', status: 'IFC' }), issuedAt: 'y', snapshotId: 's2', qaAtIssue: { critical: 0, warning: 1, info: 3, total: 4 } }
  const d = docOf({})

  it('exposes the QA counts recorded at issue as metadata, not as changes', () => {
    const r = compareRevisions(revA, revB, { before: d, after: d })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.diff.qa).toEqual({ before: revA.qaAtIssue, after: revB.qaAtIssue })
    // The QA state produced no diff entries of its own.
    expect(r.diff.changes).toHaveLength(0)
  })

  it('refuses when the first snapshot is missing', () => {
    const r = compareRevisions(revA, revB, { before: undefined, after: d })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('missing-before')
    expect(r.message).toContain('Revision A')
  })

  it('refuses when the second snapshot is missing', () => {
    const r = compareRevisions(revA, revB, { before: d, after: undefined })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('missing-after')
    expect(r.message).toContain('Revision B')
  })

  it('refuses when both are missing, and never falls back to live data', () => {
    const r = compareRevisions(revA, revB, { before: undefined, after: undefined })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('missing-both')
    expect(r).not.toHaveProperty('diff')
  })
})

describe('document-level engineering context (H2)', () => {
  it('reports a company-standard change, which alters what every finding means', () => {
    const before = docOf({ standard: DEFAULT_STANDARD })
    const after = docOf({
      standard: {
        ...DEFAULT_STANDARD,
        name: 'Acme Rev 3',
        tagFormat: { ...DEFAULT_STANDARD.tagFormat, digits: 4 },
        conventions: { ...DEFAULT_STANDARD.conventions, valveFailPosition: 'optional' },
        severityOverrides: { 'duplicate-tag': 'off' },
      },
    })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { entityType: 'standard', field: 'tagFormat.digits' }))
      .toMatchObject({ before: 3, after: 4, category: 'engineering' })
    expect(find(changes, { entityType: 'standard', field: 'conventions.valveFailPosition' }))
      .toMatchObject({ before: 'required', after: 'optional' })
    expect(find(changes, { entityType: 'standard', field: 'severity.duplicate-tag' }))
      .toMatchObject({ after: 'off' })
    // Renaming the profile is bookkeeping, not an engineering change.
    expect(find(changes, { entityType: 'standard', field: 'name' })).toMatchObject({ category: 'metadata' })
  })

  it('reports a service RENAME, which silently changes what every line carries', () => {
    const before = docOf({ fluids: [{ id: 'f1', name: 'Cooling Water', color: '#00f' }] })
    const after = docOf({ fluids: [{ id: 'f1', name: 'Chilled Water', color: '#0af' }] })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { entityType: 'fluid', field: 'name' }))
      .toMatchObject({ before: 'Cooling Water', after: 'Chilled Water', category: 'engineering' })
    expect(find(changes, { entityType: 'fluid', field: 'color' })).toMatchObject({ category: 'graphical' })
  })

  it('reports budget and price changes, but as metadata rather than engineering', () => {
    const before = docOf({ budget: { currency: 'USD', installFactor: 3, overrides: { 'instr.transmitter': 1200 } } })
    const after = docOf({ budget: { currency: 'USD', installFactor: 5, overrides: { 'instr.transmitter': 1500 } } })
    const diff = compareDocs(before, after)
    expect(find(diff.changes, { entityType: 'budget', field: 'installFactor' }))
      .toMatchObject({ before: 3, after: 5, category: 'metadata' })
    expect(find(diff.changes, { entityType: 'budget', field: 'price.instr.transmitter' }))
      .toMatchObject({ before: 1200, after: 1500 })
    expect(diff.engineeringCount).toBe(0)
  })

  it('reports a custom symbol whose PORTS changed — connectivity, not decoration', () => {
    const def = { id: 'cs1', name: 'Special', svg: '<g/>', gridSize: { w: 6, h: 6 },
      ports: [{ id: 'w', x: 0, y: 3, kind: 'process' as const }], tagRule: 'equipment' as const, keywords: [] }
    const before = docOf({ customSymbols: [def] })
    const after = docOf({ customSymbols: [{ ...def, ports: [...def.ports, { id: 'e', x: 6, y: 3, kind: 'process' as const }], svg: '<g><path/></g>' }] })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { entityType: 'custom-symbol', field: 'ports' })).toMatchObject({ category: 'engineering' })
    expect(find(changes, { entityType: 'custom-symbol', field: 'svg' })).toMatchObject({ category: 'graphical' })
  })

  it('reports an HMI pipe re-anchored, because the flow network reads those ends', () => {
    const pipe = { id: 'p1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], aId: 'w1', bId: 'w2' }
    const mk = (p: typeof pipe) =>
      docOf({ hmiScreens: [{ ...createScreen(1), id: 'scr1', name: 'S', widgets: [], pipes: [p] } as HmiScreen] })
    const { changes } = compareDocs(mk(pipe), mk({ ...pipe, bId: 'w3', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }))
    expect(find(changes, { entityType: 'hmi-pipe', field: 'bId' }))
      .toMatchObject({ before: 'w2', after: 'w3', category: 'engineering' })
    expect(find(changes, { entityType: 'hmi-pipe', field: 'points' })).toMatchObject({ category: 'graphical' })
  })

  it('reports findings accepted or withdrawn between issues', () => {
    const before = docOf({ qa: { ignored: { 'missing-tag:LT-101': { reason: 'spare', at: 'x' } } } })
    const after = docOf({ qa: { ignored: { 'no-relief:V-1': { reason: 'by others', at: 'y' } } } })
    const { changes } = compareDocs(before, after)
    expect(find(changes, { kind: 'removed', entityType: 'qa-accepted', entityKey: 'missing-tag:LT-101' })).toBeTruthy()
    expect(find(changes, { kind: 'added', entityType: 'qa-accepted', entityKey: 'no-relief:V-1' })).toBeTruthy()
  })

  it('the coverage ledger accounts for every ProjectDoc field', () => {
    // Typed as Record<keyof ProjectDoc, …>, so a new document field will not
    // COMPILE until it is classified. This asserts the runtime side: nothing
    // is left blank, and every exclusion carries its reason.
    for (const [field, verdict] of Object.entries(DOC_FIELD_COVERAGE)) {
      expect(verdict, `${field} has no coverage verdict`).toBeTruthy()
      if (verdict !== 'compared') {
        expect(verdict.startsWith('Excluded:'), `${field} is excluded without a reason`).toBe(true)
      }
    }
    expect(DOC_FIELD_COVERAGE.standard).toBe('compared')
    expect(DOC_FIELD_COVERAGE.fluids).toBe('compared')
    expect(DOC_FIELD_COVERAGE.budget).toBe('compared')
    expect(DOC_FIELD_COVERAGE.customSymbols).toBe('compared')
  })
})

describe('annotation identity (H5)', () => {
  it('a renamed annotation cannot be mistaken for an engineering rename', () => {
    const ann = (tag: { letters: string; loop: string }) =>
      node({ id: 'a1', symbolId: 'note.text', kind: 'annotation', tag })
    const before = docOf({ nodes: [ann({ letters: 'LT', loop: '101' })] })
    const after = docOf({ nodes: [ann({ letters: 'LT', loop: '201' })] })
    const { counts } = compareDocs(before, after)
    // keyOfNode() excludes annotations, so there is no engineering key to move.
    expect(counts.renamed).toBe(0)
  })

  it('and cannot silence an unrelated HMI binding change', () => {
    const screen = (tag: string): HmiScreen =>
      ({ ...createScreen(1), id: 'scr1', name: 'S', pipes: [], widgets: [widget({ id: 'w1', type: 'tank', tag })] })
    const before = docOf({
      nodes: [node({ id: 'a1', symbolId: 'note.text', kind: 'annotation', tag: { letters: 'LT', loop: '101' } })],
      hmiScreens: [screen('LT-101')],
    })
    const after = docOf({
      nodes: [node({ id: 'a1', symbolId: 'note.text', kind: 'annotation', tag: { letters: 'LT', loop: '201' } })],
      hmiScreens: [screen('LT-201')],
    })
    const { changes } = compareDocs(before, after)
    // The widget genuinely was repointed; an annotation must not explain it away.
    expect(find(changes, { entityType: 'hmi-widget', field: 'tag' }))
      .toMatchObject({ before: 'LT-101', after: 'LT-201' })
  })
})
