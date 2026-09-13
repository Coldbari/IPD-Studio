// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4A — the DEXPI export as a RUN-AWARE PROJECTION.
 *
 * The piping half used to emit one `PipingNetworkSystem` per drawn edge, so a
 * pipe drawn in four segments left as four unrelated networks. One RUN is one
 * system now, and its edges are that system's segments.
 *
 * Most of what follows is about what the projection REFUSES to say: it never
 * picks one of several line numbers, never fabricates a tag for an unnumbered
 * pipe, never turns a positional port label into an engineering name, and
 * never states a flow direction.
 */

import { describe, expect, it } from 'vitest'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import '../../src/symbols/lib/index'
import { dexpiXml } from '../../src/export/dexpi'
import { importDexpi } from '../../src/import/dexpi'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { newArea, newUnit } from '../../src/model/hierarchy'
import type { EngineeringRecord } from '../../src/model/registry'
import type { LineNumber, PlantEdge, PlantNode, ProjectDoc, Sheet } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const node = (id: string, kind: PlantNode['kind'], symbolId: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind, symbolId, x: 0, y: 0, rotation: 0, ...over })
const tank = (id: string, over: Partial<PlantNode> = {}) => node(id, 'equipment', 'vessel.tank', over)
const valve = (id: string) => node(id, 'valve', 'valve.gate')
const tee = (id: string) => node(id, 'fitting', 'fit.junction')
const pump = (id: string) => node(id, 'equipment', 'pump.centrifugal')

const ln = (seq: string, over: Partial<LineNumber> = {}): LineNumber =>
  ({ size: '6"', spec: 'CS150', service: 'CW', seq, ...over })

const edge = (
  id: string,
  a: string | { x: number; y: number },
  b: string | { x: number; y: number },
  over: Partial<PlantEdge> = {},
): PlantEdge => ({
  id,
  lineClass: 'process.major',
  source: typeof a === 'string' ? { nodeId: a, portId: 'e' } : a,
  target: typeof b === 'string' ? { nodeId: b, portId: 'w' } : b,
  ...over,
})

const sheetOf = (id: string, nodes: PlantNode[], edges: PlantEdge[]): Sheet =>
  ({ ...createSheet(1), id, nodes, edges })
const docOf = (...sheets: Sheet[]): ProjectDoc => ({ ...createEmptyDoc('dexpi'), sheets })

const parse = (xml: string) => new XMLParser({ ignoreAttributes: false }).parse(xml).PlantModel
const systems = (xml: string): Record<string, unknown>[] => {
  const pns = parse(xml).PipingNetworkSystem
  return pns === undefined ? [] : [pns].flat()
}
const segmentsOf = (sys: Record<string, unknown>): Record<string, unknown>[] => {
  const seg = sys.PipingNetworkSegment
  return seg === undefined ? [] : ([seg].flat() as Record<string, unknown>[])
}
/** Every private attribute on an element, flattened across its groups. */
const attrsOf = (el: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const group of [el.GenericAttributes].flat()) {
    if (!group) continue
    for (const a of [(group as Record<string, unknown>).GenericAttribute].flat()) {
      if (!a) continue
      const r = a as Record<string, string>
      out[r['@_Name']!] = r['@_Value']!
    }
  }
  return out
}
const xmlOf = (doc: ProjectDoc) => dexpiXml(doc, doc.sheets[0]!.id)

/* ------------------------------------------------------------ run export */

describe('one run is one piping network system', () => {
  it('exports a four-edge run ONCE, with four segments', () => {
    const doc = docOf(sheetOf('s1', [pump('p1'), valve('v1'), valve('v2'), tee('t'), tank('tk')], [
      edge('e1', 'p1', 'v1', { lineNumber: ln('001') }),
      edge('e2', 'v1', 'v2', { lineNumber: ln('001') }),
      edge('e3', 'v2', 't', { lineNumber: ln('001') }),
      edge('e4', 't', 'tk', { lineNumber: ln('001') }),
    ]))
    expect(buildIndex(doc).runs).toHaveLength(1)
    const list = systems(xmlOf(doc))
    expect(list).toHaveLength(1)
    expect(segmentsOf(list[0]!).map((s) => s['@_ID'])).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(attrsOf(list[0]!).SegmentCount).toBe('4')
  })

  it('exports a one-edge run as one system with one segment', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    const list = systems(xmlOf(doc))
    expect(list).toHaveLength(1)
    expect(segmentsOf(list[0]!)).toHaveLength(1)
  })

  it('exports disconnected runs as separate systems', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b'), tank('c'), tank('d')], [
      edge('e1', 'a', 'b', { lineNumber: ln('001') }),
      edge('e2', 'c', 'd', { lineNumber: ln('002') }),
    ]))
    expect(systems(xmlOf(doc))).toHaveLength(2)
  })

  it('keeps two disconnected runs SHARING a number as two systems', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b'), tank('c'), tank('d')], [
      edge('e1', 'a', 'b', { lineNumber: ln('001') }),
      edge('e2', 'c', 'd', { lineNumber: ln('001') }),
    ]))
    const list = systems(xmlOf(doc))
    expect(list).toHaveLength(2)
    // Two pipes, one number. Merging them would be the exporter deciding they
    // are the same line, which the drawing does not say.
    expect(list.map((s) => attrsOf(s)['Line.1.Number'])).toEqual(['6"-CS150-CW-001', '6"-CS150-CW-001'])
    expect(new Set(list.map((s) => s['@_ID'])).size).toBe(2)
  })

  it('exports a branched run once, with every leg as a segment', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tee('t'), tank('b'), tank('c')], [
      edge('e1', 'a', 't'), edge('e2', 't', 'b'), edge('e3', 't', 'c'),
    ]))
    const list = systems(xmlOf(doc))
    expect(list).toHaveLength(1)
    expect(segmentsOf(list[0]!).map((s) => s['@_ID'])).toEqual(['e1', 'e2', 'e3'])
  })

  it('leaves no process edge unexported', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), valve('v'), tank('b'), tank('c'), tank('d')], [
      edge('e1', 'a', 'v', { lineNumber: ln('001') }), edge('e2', 'v', 'b'),
      edge('e3', 'c', 'd'), edge('free', { x: 0, y: 0 }, { x: 9, y: 9 }),
    ]))
    const exported = systems(xmlOf(doc)).flatMap((s) => segmentsOf(s).map((g) => g['@_ID']))
    expect(exported.sort()).toEqual(['e1', 'e2', 'e3', 'free'])
  })

  it('never exports a signal edge as piping', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), node('i', 'instrument', 'instr.bubble')], [
      edge('sig', 'a', 'i', { lineClass: 'signal.electric' }),
    ]))
    const xml = xmlOf(doc)
    expect(systems(xml)).toHaveLength(0)
    expect(parse(xml).InformationFlow['@_ID']).toBe('sig')
  })

  it('keeps each sheet to its own systems', () => {
    const doc = docOf(
      sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]),
      sheetOf('s2', [tank('c'), tank('d')], [edge('e2', 'c', 'd', { lineNumber: ln('002') })]),
    )
    expect(systems(dexpiXml(doc, 's1')).flatMap((s) => segmentsOf(s).map((g) => g['@_ID']))).toEqual(['e1'])
    expect(systems(dexpiXml(doc, 's2')).flatMap((s) => segmentsOf(s).map((g) => g['@_ID']))).toEqual(['e2'])
  })
})

/* ---------------------------------------------------------- run identity */

describe('run identity is derived and deterministic', () => {
  const doc = () => docOf(sheetOf('s1', [tank('a'), valve('v'), tank('b')], [
    edge('e9', 'v', 'b', { lineNumber: ln('001') }), edge('e1', 'a', 'v', { lineNumber: ln('001') }),
  ]))

  it('names the system after the run, not after an array index', () => {
    const list = systems(xmlOf(doc()))
    expect(list[0]!['@_ID']).toBe('run-s1-e1')
    expect(xmlOf(doc())).not.toContain('pns-')
  })

  it('carries the internal run id as private metadata, and not as a tag', () => {
    expect(attrsOf(systems(xmlOf(doc()))[0]!).RunId).toBe('s1:e1')
  })

  it('writes the export id nowhere into the document', () => {
    const d = doc()
    xmlOf(d)
    expect(JSON.stringify(d)).not.toContain('run-s1-e1')
  })
})

/* ------------------------------------------------------------ numbering */

describe('line numbers are stated, never chosen', () => {
  it('carries the single number and its record', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    const withRec: ProjectDoc = {
      ...doc,
      registry: {
        '6"-CS150-CW-001': { key: '6"-CS150-CW-001', kind: 'line', fields: { 'spec.material': 'A106 Gr B', 'design.pressure': '16 barg' } },
      },
    }
    const a = attrsOf(systems(xmlOf(withRec))[0]!)
    expect(a.LineNumberState).toBe('single')
    expect(a['Line.1.Number']).toBe('6"-CS150-CW-001')
    expect(a['Line.1.spec.material']).toBe('A106 Gr B')
    expect(a['Line.1.design.pressure']).toBe('16 barg')
  })

  it('exports an UNNUMBERED run without fabricating a tag', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b')]))
    const list = systems(xmlOf(doc))
    expect(list).toHaveLength(1)
    const a = attrsOf(list[0]!)
    expect(a.LineNumberState).toBe('unnumbered')
    expect(a['Line.1.Number']).toBeUndefined()
    expect(a.LineNumbers).toBeUndefined()
    // Identified only by the derived export id, which is not a line number.
    expect(list[0]!['@_ID']).toBe('run-s1-e1')
  })

  it('carries EVERY number of a multi-number run and selects none', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), valve('v'), tank('b')], [
      edge('e1', 'a', 'v', { lineNumber: ln('001', { size: '12"' }) }),
      edge('e2', 'v', 'b', { lineNumber: ln('010', { size: '2"' }) }),
    ]))
    const list = systems(xmlOf(doc))
    expect(list).toHaveLength(1)
    const a = attrsOf(list[0]!)
    expect(a.LineNumberState).toBe('multiple')
    expect(a.LineNumbers).toBe('12"-CS150-CW-001; 2"-CS150-CW-010')
    expect(a['Line.1.Number']).toBe('12"-CS150-CW-001')
    expect(a['Line.2.Number']).toBe('2"-CS150-CW-010')
  })

  it('gives each number of a multi-number run its OWN record', () => {
    const rec = (key: string, material: string): EngineeringRecord =>
      ({ key, kind: 'line', fields: { 'spec.material': material } })
    const base = docOf(sheetOf('s1', [tank('a'), valve('v'), tank('b')], [
      edge('e1', 'a', 'v', { lineNumber: ln('001', { size: '12"' }) }),
      edge('e2', 'v', 'b', { lineNumber: ln('010', { size: '2"' }) }),
    ]))
    const doc: ProjectDoc = {
      ...base,
      registry: {
        '12"-CS150-CW-001': rec('12"-CS150-CW-001', 'Carbon Steel'),
        '2"-CS150-CW-010': rec('2"-CS150-CW-010', 'Stainless Steel'),
      },
    }
    const a = attrsOf(systems(xmlOf(doc))[0]!)
    // Two groups, two materials. Never one fabricated composite value.
    expect(a['Line.1.spec.material']).toBe('Carbon Steel')
    expect(a['Line.2.spec.material']).toBe('Stainless Steel')
    expect(Object.values(a)).not.toContain('Carbon Steel; Stainless Steel')
  })

  it('leaves a field the record does not carry absent, not blank', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    const a = attrsOf(systems(xmlOf(doc))[0]!)
    expect(a['Line.1.Number']).toBe('6"-CS150-CW-001')
    expect(a['Line.1.spec.material']).toBeUndefined()
  })
})

/* --------------------------------------------------------- area and unit */

describe('area and unit come from the assignment, never from geometry', () => {
  const AREA = newArea('100')
  const UNIT = newUnit(AREA.id, 'U-101')

  it('exports the unit an engineer assigned to a line', () => {
    const base = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    const doc: ProjectDoc = {
      ...base,
      areas: [AREA],
      units: [UNIT],
      registry: { '6"-CS150-CW-001': { key: '6"-CS150-CW-001', kind: 'line', fields: {}, unitId: UNIT.id } },
    }
    const a = attrsOf(systems(xmlOf(doc))[0]!)
    expect(a['Line.1.Area']).toBe('100')
    expect(a['Line.1.Unit']).toBe('U-101')
  })

  it('says nothing when nothing is assigned', () => {
    const doc = docOf(sheetOf('s1', [tank('a'), tank('b')], [edge('e1', 'a', 'b', { lineNumber: ln('001') })]))
    const a = attrsOf(systems(xmlOf(doc))[0]!)
    expect(a['Line.1.Area']).toBeUndefined()
    expect(a['Line.1.Unit']).toBeUndefined()
  })

  it('exports a tagged node’s own assignment', () => {
    const base = docOf(sheetOf('s1', [
      node('tk', 'equipment', 'vessel.tank', { tag: { letters: 'TK', loop: '101' } }), tank('b'),
    ], [edge('e1', 'tk', 'b')]))
    const doc: ProjectDoc = {
      ...base,
      areas: [AREA],
      units: [UNIT],
      registry: { 'TK-101': { key: 'TK-101', kind: 'equipment', fields: {}, unitId: UNIT.id } },
    }
    const eq = [parse(xmlOf(doc)).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 'tk')!
    expect(attrsOf(eq as Record<string, unknown>).Unit).toBe('U-101')
  })
})

/* ------------------------------------------------- connection projection */

describe('connection points are projected, never invented', () => {
  it('projects only the ports a line actually uses', () => {
    // A tank carries many catalogue ports; one is connected.
    const doc = docOf(sheetOf('s1', [tank('tk'), tank('b')], [edge('e1', 'tk', 'b', { lineNumber: ln('001') })]))
    const eq = [parse(xmlOf(doc)).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 'tk')!
    const a = attrsOf(eq as Record<string, unknown>)
    const ports = Object.keys(a).filter((k) => k.startsWith('Port.')).map((k) => k.split('.')[1])
    expect(new Set(ports)).toEqual(new Set(['e']))
  })

  it('records the port kind, the edge and the run it belongs to', () => {
    const doc = docOf(sheetOf('s1', [pump('p1'), tank('b')], [
      edge('e1', 'p1', 'b', { lineNumber: ln('001'), source: { nodeId: 'p1', portId: 'discharge' } }),
    ]))
    const eq = [parse(xmlOf(doc)).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 'p1')!
    const a = attrsOf(eq as Record<string, unknown>)
    expect(a['Port.discharge.Kind']).toBe('process')
    expect(a['Port.discharge.Edge']).toBe('e1')
    expect(a['Port.discharge.Run']).toBe('run-s1-e1')
  })

  it('marks an authoritative catalogue name as authoritative', () => {
    const doc = docOf(sheetOf('s1', [pump('p1'), tank('b')], [
      edge('e1', 'p1', 'b', { source: { nodeId: 'p1', portId: 'discharge' } }),
    ]))
    const eq = [parse(xmlOf(doc)).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 'p1')!
    const a = attrsOf(eq as Record<string, unknown>)
    expect(a['Port.discharge.Name']).toBe('Discharge')
    expect(a['Port.discharge.NameAuthoritative']).toBe('true')
  })

  it('gives a POSITIONAL port no name at all', () => {
    const doc = docOf(sheetOf('s1', [tank('tk'), tank('b')], [edge('e1', 'tk', 'b')]))
    const eq = [parse(xmlOf(doc)).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 'tk')!
    const a = attrsOf(eq as Record<string, unknown>)
    expect(a['Port.e.NameAuthoritative']).toBe('false')
    expect(a['Port.e.Name']).toBeUndefined()
  })

  it('gives a user-added extra port a kind but no name', () => {
    const doc = docOf(sheetOf('s1', [
      tank('tk', { extraPorts: [{ id: 'x1', x: 4, y: 4, kind: 'process' }] }), tank('b'),
    ], [edge('e1', 'tk', 'b', { source: { nodeId: 'tk', portId: 'x1' } })]))
    const eq = [parse(xmlOf(doc)).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 'tk')!
    const a = attrsOf(eq as Record<string, unknown>)
    expect(a['Port.x1.Kind']).toBe('process')
    expect(a['Port.x1.NameAuthoritative']).toBe('false')
    expect(a['Port.x1.Name']).toBeUndefined()
  })

  it('survives a node whose symbol is not in the catalogue', () => {
    const doc = docOf(sheetOf('s1', [node('ghost', 'equipment', 'not.a.real.symbol'), tank('b')],
      [edge('e1', 'ghost', 'b')]))
    const xml = xmlOf(doc)
    expect(XMLValidator.validate(xml)).toBe(true)
    const eq = [parse(xml).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 'ghost')!
    expect(attrsOf(eq as Record<string, unknown>)['Port.e.NameAuthoritative']).toBe('false')
  })

  it('projects several ports on one node, deterministically ordered', () => {
    const doc = docOf(sheetOf('s1', [tee('t'), tank('a'), tank('b'), tank('c')], [
      edge('e1', 'a', 't', { target: { nodeId: 't', portId: 'w' } }),
      edge('e2', 't', 'b', { source: { nodeId: 't', portId: 'e' } }),
      edge('e3', 't', 'c', { source: { nodeId: 't', portId: 's' } }),
    ]))
    const eq = [parse(xmlOf(doc)).Equipment].flat().find((e) => (e as Record<string, string>)['@_ID'] === 't')!
    const keys = Object.keys(attrsOf(eq as Record<string, unknown>)).filter((k) => k.endsWith('.Kind'))
    expect(keys).toEqual(['Port.e.Kind', 'Port.s.Kind', 'Port.w.Kind'])
  })

  it('states no inlet, outlet, service, size, rating or direction anywhere', () => {
    const doc = docOf(sheetOf('s1', [pump('p1'), tank('b')], [
      edge('e1', 'p1', 'b', { lineNumber: ln('001'), arrow: 'flow', source: { nodeId: 'p1', portId: 'discharge' } }),
    ]))
    const xml = xmlOf(doc)
    for (const word of ['FlowDirection', 'NozzleSize', 'NozzleRating', 'NozzleService', 'IsInlet', 'IsOutlet']) {
      expect(xml, word).not.toContain(word)
    }
  })
})

/* --------------------------------------------------------- round trip */

describe('the round trip still holds', () => {
  const rt = () => docOf(sheetOf('s1', [pump('p1'), valve('v'), tank('tk'), node('ft', 'instrument', 'instr.bubble', { tag: { letters: 'FT', loop: '101' } })], [
    edge('e1', 'p1', 'v', { lineNumber: ln('001'), source: { nodeId: 'p1', portId: 'discharge' } }),
    edge('e2', 'v', 'tk', { lineNumber: ln('001') }),
    edge('s1e', 'ft', 'v', { lineClass: 'signal.electric' }),
  ]))

  it('imports back to the same edges, one per segment', () => {
    const { sheet, warnings } = importDexpi(xmlOf(rt()))
    expect(warnings).toEqual([])
    expect(sheet.edges.map((e) => e.id).sort()).toEqual(['e1', 'e2', 's1e'])
  })

  it('and the index derives the same run from them', () => {
    const before = buildIndex(rt()).runs
    const { sheet } = importDexpi(xmlOf(rt()))
    const round = createEmptyDoc('back')
    round.sheets = [{ ...round.sheets[0]!, id: 's1', nodes: sheet.nodes, edges: sheet.edges }]
    const after = buildIndex(round).runs
    // DEXPI -> edges -> ProjectIndex -> Runs. The file never carries a run.
    expect(after).toHaveLength(before.length)
    expect(after[0]!.edgeIds).toEqual(before[0]!.edgeIds)
    expect(after[0]!.number).toBe(before[0]!.number)
  })

  it('keeps line numbers and line classes on the segments', () => {
    const { sheet } = importDexpi(xmlOf(rt()))
    const proc = sheet.edges.find((e) => e.id === 'e1')!
    expect(proc.lineNumber).toEqual({ size: '6"', spec: 'CS150', service: 'CW', seq: '001' })
    expect(proc.lineClass).toBe('process.major')
    expect(sheet.edges.find((e) => e.id === 's1e')!.lineClass).toBe('signal.electric')
  })
})

/* ------------------------------------------------- determinism and purity */

describe('the export is deterministic and changes nothing', () => {
  const busy = () => docOf(sheetOf('s1', [pump('p1'), valve('v'), tee('t'), tank('a'), tank('b')], [
    edge('z1', 't', 'b', { lineNumber: ln('002') }),
    edge('a1', 'p1', 'v', { lineNumber: ln('001'), source: { nodeId: 'p1', portId: 'discharge' } }),
    edge('m1', 'v', 't', { lineNumber: ln('001') }),
    edge('s9', 'a', 'b', { lineClass: 'signal.electric' }),
  ]))

  /** Everything but the export timestamp, which is provenance rather than
   *  content and was in `PlantInformation` long before this program. */
  const stable = (xml: string) => xml.replace(/ Date="[^"]*"/, '')

  it('produces byte-identical output for one document', () => {
    const doc = busy()
    expect(stable(xmlOf(doc))).toBe(stable(xmlOf(doc)))
  })

  it('does not depend on the order edges were drawn in', () => {
    const forward = busy()
    const reversed = docOf(sheetOf('s1', forward.sheets[0]!.nodes, [...forward.sheets[0]!.edges].reverse()))
    expect(stable(xmlOf(reversed))).toBe(stable(xmlOf(forward)))
  })

  /** DECLARED ids only. `FromID=`/`ToID=` are references and must not be
   *  counted as declarations — doing so makes both tests below vacuous. */
  const declaredIds = (xml: string) => [...xml.matchAll(/\sID="([^"]+)"/g)].map((m) => m[1]!)

  it('uses no random identity anywhere', () => {
    const ids = declaredIds(xmlOf(busy()))
    // Every declared id is an edge id, a node id, or `run-` + a derived one.
    // 5 nodes, 3 piping segments, 1 information flow, 1 system.
    expect(ids.sort()).toEqual(['a', 'a1', 'b', 'm1', 'p1', 'run-s1-a1', 's9', 't', 'v', 'z1'])
    expect(stable(xmlOf(busy()))).toBe(stable(xmlOf(busy())))
  })

  it('exports no duplicate ID within a kind', () => {
    const xml = xmlOf(busy())
    // An edge id appears twice by design — once as the InformationFlow or
    // PipingNetworkSegment, once nowhere else — so the check is per element.
    const systemIds = systems(xml).map((s) => s['@_ID'] as string)
    const segmentIds = systems(xml).flatMap((s) => segmentsOf(s).map((g) => g['@_ID'] as string))
    const nodeIds = [parse(xml).Equipment].flat().concat([parse(xml).ProcessInstrument].flat())
      .filter(Boolean).map((e) => (e as Record<string, string>)['@_ID'])
    for (const [what, list] of [['system', systemIds], ['segment', segmentIds], ['node', nodeIds]] as const) {
      expect(new Set(list).size, what).toBe(list.length)
    }
  })

  it('leaves every internal reference resolvable', () => {
    const xml = xmlOf(busy())
    const ids = new Set(declaredIds(xml))
    const refs = [...xml.matchAll(/(?:FromID|ToID)="([^"]+)"/g)].map((m) => m[1]!)
    const runRefs = [...xml.matchAll(/Name="Port\.[^."]+\.Run" Value="([^"]+)"/g)].map((m) => m[1]!)
    // Not vacuous: there really are references of both kinds to check.
    expect(refs.length).toBeGreaterThan(3)
    expect(runRefs.length).toBeGreaterThan(0)
    for (const ref of [...refs, ...runRefs]) expect(ids, ref).toContain(ref)
  })

  it('mutates nothing about the document', () => {
    const doc = busy()
    const before = JSON.stringify(doc)
    xmlOf(doc)
    xmlOf(doc)
    expect(JSON.stringify(doc)).toBe(before)
    expect(doc.registry).toBeUndefined()
    expect(doc.schemaVersion).toBe(6)
  })

  it('is well-formed XML', () => {
    expect(XMLValidator.validate(xmlOf(busy()))).toBe(true)
  })
})
