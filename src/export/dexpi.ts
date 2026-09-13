// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantEdge, PlantNode, ProjectDoc, Sheet } from '../model/types'
import { isPortEnd } from '../model/types'
import { sheetPx } from '../model/doc'
import { formatTag } from '../isa/tag'
import { isProcessClass } from '../canvas/lineStyle'
import { componentClassFor } from './componentClass'
import { activeSheet, useStore } from '../store/store'
import { buildIndex, type ProjectIndex } from '../model/projectIndex'
import type { Run } from '../model/run'
import { fieldKeysFor } from '../model/fields'
import { areaCodeOf, unitCodeOf } from '../model/hierarchy'
import { labelOfPort } from '../symbols/portLabels'

/**
 * A DEXPI-ORIENTED PROJECTION, in the Proteus 4.2 SHAPE.
 *
 * Not a conformance claim, and deliberately not called one: this repository
 * contains no copy of the Proteus 4.2 schema, so nothing here can be checked
 * against it. See docs/DEXPI-MAPPING.md, which separates what is written in
 * the target shape from what is carried in the private `PIDStudio` attribute
 * sets from what cannot be represented at all.
 *
 * IT IS A PROJECTION, AND ONLY A PROJECTION. It reads `ProjectIndex` and
 * writes XML. It creates no record, derives no topology of its own, states no
 * flow direction, and mutates nothing — the same contract every report in
 * `export/csv.ts` holds to.
 *
 * WHAT CHANGED IN P3-4A. The piping half used to emit one
 * `PipingNetworkSystem` per drawn EDGE, so a pipe drawn in four segments left
 * as four unrelated networks and a consumer could not tell they were one line.
 * `ProjectIndex.runs` (P3 Program 1) is the authoritative physical grouping,
 * so one RUN is now one system and its drawn edges are that system's segments.
 * Nothing here re-derives connectivity; there is one run algorithm and it is
 * in `model/run.ts`.
 *
 * The importer is unaffected by that change and was not touched: it has always
 * read segments rather than systems (`for sys -> for seg -> one edge`), so a
 * file written this way imports back to exactly the same edges, and
 * `ProjectIndex` derives the runs again from them. DEXPI -> edges -> runs,
 * never DEXPI -> runs.
 */

function escapeXml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function el(tag: string, attrs: Record<string, string | number>, children: string[] = []): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('')
  if (children.length === 0) return `<${tag}${attrStr}/>`
  return `<${tag}${attrStr}>${children.join('')}</${tag}>`
}

/**
 * A private attribute group.
 *
 * `Set` names the group, so a consumer can tell IPD Studio's own metadata from
 * anything it recognises as standard. Several groups may sit on one element;
 * the names inside a group are dotted (`Config.x`, `Port.discharge.Kind`) so
 * that a reader which flattens every group into one map still loses nothing.
 */
function genericAttrs(pairs: [string, string][], set = 'PIDStudio'): string {
  return el(
    'GenericAttributes',
    { Set: set },
    pairs.map(([name, value]) => el('GenericAttribute', { Name: name, Value: value })),
  )
}

/** Every line field the catalogue defines, so the export cannot drift from
 *  what the Engineering tab and the Line list ask for. */
const LINE_FIELDS = fieldKeysFor('line')

/**
 * The export id of a run.
 *
 * Derived from `run.id` — itself `sheetId:oldestEdgeId`, stable and already
 * deterministic — with the colon replaced, because a colon in an XML ID reads
 * as a namespace prefix. Nothing generates it randomly and nothing writes it
 * back into the document: `ProjectDoc` has never heard of it.
 */
const runExportId = (runId: string): string => `run-${runId.replace(/:/g, '-')}`

/**
 * The connection points of one node that a drawn line ACTUALLY uses.
 *
 * Only used ports. A catalogue symbol carries every port it could ever have —
 * a vertical vessel has eleven — and the drawing offers no evidence that an
 * unused one is a real engineering nozzle. Projecting all of them would invent
 * a nozzle schedule out of a symbol definition.
 *
 * Deterministic: ports sorted by id, and where a port carries more than one
 * line the named edge is the smallest id.
 */
function usedPorts(ix: ProjectIndex, node: PlantNode): { portId: string; edgeId: string; count: number }[] {
  const first = new Map<string, string>()
  const count = new Map<string, number>()
  for (const edge of ix.edgesByNode.get(node.id) ?? []) {
    for (const end of [edge.source, edge.target]) {
      if (!isPortEnd(end) || end.nodeId !== node.id) continue
      count.set(end.portId, (count.get(end.portId) ?? 0) + 1)
      const seen = first.get(end.portId)
      if (seen === undefined || edge.id < seen) first.set(end.portId, edge.id)
    }
  }
  return [...first.keys()].sort().map((portId) => ({
    portId,
    edgeId: first.get(portId)!,
    count: count.get(portId)!,
  }))
}

/**
 * What can be PROVEN about each used connection point.
 *
 * THE NAMING RULE, and it is the important one. `PortLabel.authoritative` is
 * true only where the CATALOGUE names the point — a pump's suction and
 * discharge, a PSV's in and out. Everything else is a description of where the
 * point sits ("Top connection"), and a nozzle at the top of a vessel is not an
 * inlet because it is at the top. So a positional label is NEVER exported as a
 * name; `NameAuthoritative` is written either way so a consumer can see which
 * kind it is holding rather than having to trust it.
 *
 * Nothing here states an inlet/outlet role, a service, a size, a rating or a
 * direction. None of those exist in the model, and unknown stays unknown.
 */
function connectionPointAttrs(ix: ProjectIndex, node: PlantNode): [string, string][] {
  const kinds = new Map((ix.nodes.get(node.id)?.ports ?? []).map((p) => [p.id, p.kind]))
  const pairs: [string, string][] = []
  for (const { portId, edgeId, count } of usedPorts(ix, node)) {
    const at = `Port.${portId}`
    const kind = kinds.get(portId)
    if (kind) pairs.push([`${at}.Kind`, kind])
    // `labelOfPort` returns null for an unknown symbol AND for a user-added
    // pin — the app did not put those there and has no word for them.
    const label = labelOfPort(node, portId)
    if (label?.authoritative) pairs.push([`${at}.Name`, label.text])
    pairs.push([`${at}.NameAuthoritative`, String(Boolean(label?.authoritative))])
    pairs.push([`${at}.Edge`, edgeId])
    const runId = ix.runOfEdge.get(edgeId)
    if (runId) pairs.push([`${at}.Run`, runExportId(runId)])
    if (count > 1) pairs.push([`${at}.EdgeCount`, String(count)])
  }
  return pairs
}

function nodeXml(ix: ProjectIndex, node: PlantNode): string {
  const isInstrument = node.kind === 'instrument'
  const tagName = node.tag ? formatTag(node.tag, '-') : (node.label ?? '')
  const attrs: [string, string][] = [
    ['SymbolId', node.symbolId],
    ['Rotation', String(node.rotation)],
  ]
  if (node.tag) {
    attrs.push(['TagLetters', node.tag.letters], ['TagLoop', node.tag.loop])
    if (node.tag.suffix) attrs.push(['TagSuffix', node.tag.suffix])
  }
  if (node.label) attrs.push(['Label', node.label])
  for (const [key, value] of Object.entries(node.config ?? {})) {
    attrs.push([`Config.${key}`, value])
  }
  // Where the object sits in the plant, when an engineer has ASSIGNED it.
  // Never inferred from geometry, and absent when nothing is assigned.
  const indexed = ix.nodes.get(node.id)
  const unitId = indexed?.key ? ix.records[indexed.key]?.unitId : undefined
  const area = areaCodeOf(ix.hierarchy, unitId)
  const unit = unitCodeOf(ix.hierarchy, unitId)
  if (area) attrs.push(['Area', area])
  if (unit) attrs.push(['Unit', unit])

  const ports = connectionPointAttrs(ix, node)
  return el(
    isInstrument ? 'ProcessInstrument' : 'Equipment',
    { ID: node.id, TagName: tagName, ComponentClass: componentClassFor(node.symbolId) },
    [
      el('Position', {}, [el('Location', { X: node.x, Y: node.y })]),
      genericAttrs(attrs),
      ...(ports.length ? [genericAttrs(ports, 'PIDStudio.ConnectionPoints')] : []),
    ],
  )
}

function connectionXml(edge: PlantEdge): string {
  const attrs: Record<string, string> = {}
  if (isPortEnd(edge.source)) {
    attrs.FromID = edge.source.nodeId
    attrs.FromNode = edge.source.portId
  }
  if (isPortEnd(edge.target)) {
    attrs.ToID = edge.target.nodeId
    attrs.ToNode = edge.target.portId
  }
  return el('Connection', attrs)
}

function centerLineXml(edge: PlantEdge): string {
  const coords: string[] = []
  if (!isPortEnd(edge.source)) coords.push(el('Coordinate', { X: edge.source.x, Y: edge.source.y }))
  for (const v of edge.vertices ?? []) coords.push(el('Coordinate', { X: v.x, Y: v.y }))
  if (!isPortEnd(edge.target)) coords.push(el('Coordinate', { X: edge.target.x, Y: edge.target.y }))
  return coords.length ? el('CenterLine', {}, coords) : ''
}

function edgeAttrs(edge: PlantEdge): string {
  const pairs: [string, string][] = [['LineClass', edge.lineClass]]
  const ln = edge.lineNumber
  if (ln && (ln.size || ln.spec || ln.service || ln.seq)) {
    pairs.push(['LineSize', ln.size], ['LineSpec', ln.spec], ['LineService', ln.service], ['LineSequence', ln.seq])
  }
  return genericAttrs(pairs)
}

/**
 * ONE RUN, ONE PIPING NETWORK SYSTEM.
 *
 * Its drawn edges are the system's segments, in `run.edgeIds` order — which is
 * sorted, so two exports of one document agree. Each segment keeps exactly the
 * shape it had before this program, because that is what the importer reads.
 *
 * THE NUMBERS ARE STATED, NEVER CHOSEN:
 *
 *  - one  — `LineNumberState=single`, and the one line's record travels with it.
 *  - none — `LineNumberState=unnumbered`. The system still exists and is
 *           identified by its derived export id, which is not presented as an
 *           engineering line number anywhere. No tag is fabricated.
 *  - many — `LineNumberState=multiple` and EVERY number is carried. No single
 *           number is written, because `run.number` is deliberately undefined
 *           in this state and picking `numbers[0]` would be the exporter
 *           deciding which of an engineer's answers is right.
 *
 * All of it rides in the private `PIDStudio` sets rather than in a standard
 * property, for one honest reason: without the Proteus schema in the
 * repository there is no way to check what the standard property for any of
 * this would be, and writing a guess into a standard-looking attribute is
 * worse than writing the truth into a clearly private one.
 */
function runXml(ix: ProjectIndex, run: Run): string {
  const state = run.unnumbered ? 'unnumbered' : run.numbers.length > 1 ? 'multiple' : 'single'
  const runAttrs: [string, string][] = [
    ['RunId', run.id],
    ['SegmentCount', String(run.edgeIds.length)],
    ['LineNumberState', state],
  ]
  if (run.numbers.length > 1) runAttrs.push(['LineNumbers', run.numbers.join('; ')])

  // One numbered group per line record behind this run — one for an ordinary
  // line, several for a header carrying its branches' numbers. Each carries
  // its OWN record, so two lines that disagree are two groups rather than one
  // fabricated composite value.
  const lineAttrs: [string, string][] = []
  run.numbers.forEach((number, i) => {
    const at = `Line.${i + 1}`
    lineAttrs.push([`${at}.Number`, number])
    const record = ix.records[number]
    for (const key of LINE_FIELDS) {
      const value = record?.fields[key]
      if (value) lineAttrs.push([`${at}.${key}`, value])
    }
    const area = areaCodeOf(ix.hierarchy, record?.unitId)
    const unit = unitCodeOf(ix.hierarchy, record?.unitId)
    if (area) lineAttrs.push([`${at}.Area`, area])
    if (unit) lineAttrs.push([`${at}.Unit`, unit])
  })

  const segments = run.edgeIds.flatMap((id) => {
    const indexed = ix.edges.get(id)
    if (!indexed) return []
    const { edge } = indexed
    return [el('PipingNetworkSegment', { ID: edge.id },
      [connectionXml(edge), centerLineXml(edge), edgeAttrs(edge)].filter(Boolean))]
  })

  return el('PipingNetworkSystem', { ID: runExportId(run.id) }, [
    genericAttrs(runAttrs),
    ...(lineAttrs.length ? [genericAttrs(lineAttrs, 'PIDStudio.Lines')] : []),
    ...segments,
  ])
}

function signalEdgeXml(edge: PlantEdge): string {
  return el('InformationFlow', { ID: edge.id }, [connectionXml(edge), centerLineXml(edge), edgeAttrs(edge)].filter(Boolean))
}

export function dexpiXml(doc: ProjectDoc, sheetId: string): string {
  const sheet: Sheet | undefined = doc.sheets.find((sh) => sh.id === sheetId)
  if (!sheet) throw new Error(`Unknown sheet: ${sheetId}`)
  const { w, h } = sheetPx(sheet.sheetSize)
  // ONE index, and it is where the runs, the records and the hierarchy come
  // from. Nothing below walks the document a second time.
  const ix = buildIndex(doc)
  const body: string[] = [
    el('PlantInformation', {
      Application: 'IPD Studio',
      ApplicationVersion: '0.2.0',
      OriginatingSystem: 'IPD Studio',
      Date: new Date().toISOString(),
      Units: 'px',
      SchemaVersion: '4.2.0',
      ProjectName: doc.meta.name,
      DrawingNumber: sheet.drawingNumber,
    }),
    el('Drawing', { Name: sheet.name, Type: 'PID' }, [
      el('Extent', {}, [el('Min', { X: 0, Y: 0 }), el('Max', { X: Math.round(w), Y: Math.round(h) })]),
    ]),
    ...sheet.nodes.map((node) => nodeXml(ix, node)),
    // Runs come off the index already ordered and already sheet-local; a run
    // never spans two sheets, so this sheet's piping is exactly its runs.
    ...ix.runs.filter((run) => run.sheetId === sheet.id).map((run) => runXml(ix, run)),
    // Signal lines are untouched: they are in no run, and an InformationFlow
    // is what they have always been.
    ...sheet.edges.filter((e) => !isProcessClass(e.lineClass)).map(signalEdgeXml),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n` + el('PlantModel', {}, body)
}

export function downloadDexpi(): void {
  const state = useStore.getState()
  const sheet = activeSheet(state)
  const xml = dexpiXml(state.doc, sheet.id)
  const blob = new Blob([xml], { type: 'application/xml' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${state.doc.meta.name || 'diagram'}-${sheet.name.replace(/\s+/g, '')}.dexpi.xml`
  a.click()
  URL.revokeObjectURL(a.href)
}
