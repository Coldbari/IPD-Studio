// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantEdge, PlantNode, ProjectDoc, Revision, Sheet } from '../model/types'
import { CONFORMANCE_LABEL, historicalConformance } from '../model/conformance'
import { isPortEnd } from '../model/types'
import { expandLetters, formatTag } from '../isa/tag'
import { getSymbol } from '../symbols/registry'
import type { EntityKind } from '../model/registry'
import { edgeFieldValue, fieldValue, keyOfEdge, keyOfNode } from '../model/registry'
import { fieldKeysFor, labelForField } from '../model/fields'
import { areaCodeOf, buildHierarchy, unitCodeOf, type Hierarchy } from '../model/hierarchy'
import { useStore } from '../store/store'
import { buildIndex } from '../model/projectIndex'
import { countNonIo, deriveIoList } from '../model/ioList'
import { loopPlaceLabel, loopViews } from '../model/loopIndex'
import { LOOP_TYPE_LABELS, type LoopCompleteness } from '../model/loop'

/**
 * Neutralise a value a spreadsheet would EXECUTE rather than display.
 *
 * Excel, LibreOffice and Sheets all treat a cell opening with `=`, `+`, `-` or
 * `@` as a formula, and a formula in a file an engineer was emailed is a code
 * path nobody reviewed. Every cell of every export goes through this — the one
 * sanitiser, applied in the one place cells become CSV, so a new report cannot
 * be added without it.
 *
 * A LEADING MINUS ON A REAL NUMBER IS LEFT ALONE. `-50` is a setpoint, and an
 * export that turned every negative temperature into text would be its own
 * data-integrity bug. Only a `+`/`-` value that does not parse as a number is
 * treated as hostile.
 *
 * The apostrophe is stripped again on import (`bulkEdit.unguard`), so the
 * round trip is exact.
 */
export function guardFormula(v: string): string {
  if (!v) return v
  const c = v[0]!
  if (c === '=' || c === '@') return `'${v}`
  if ((c === '+' || c === '-') && !Number.isFinite(Number(v))) return `'${v}`
  return v
}

/**
 * One cell. Guard FIRST, then quote: a hostile value that also contains a
 * comma must be neutralised inside the quotes, not merely wrapped in them.
 *
 * This is the only implementation of CSV escaping in the product. Anything
 * that writes a CSV calls `csvCell`/`csvRow` rather than rolling its own —
 * a second escaper is how one export quietly loses the protection.
 */
function csvField(v: string): string {
  const guarded = guardFormula(v)
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}
const row = (cells: string[]) => cells.map(csvField).join(',')

/** The shared cell/row writers, for CSV built outside this module. */
export const csvCell = csvField
export const csvRow = row

/** Symbol display name, degrading to the raw id rather than throwing. A custom
 *  symbol may not be registered at the moment a report runs (the same case
 *  `projectIndex.portsOf` guards), and a report that throws takes the whole
 *  Data workspace down with it. */
function symbolName(symbolId: string): string {
  try {
    return getSymbol(symbolId).name
  } catch {
    return symbolId
  }
}

/**
 * Node id -> node, built once per report.
 *
 * `nodeName` used to do `doc.sheets.flatMap(sh => sh.nodes).find(...)` — a
 * fresh array of every node on every sheet, scanned, for EVERY endpoint of
 * EVERY row. That is what made the two oldest reports quadratic: measured at
 * 246 ms for the instrument index and 117 ms for the line list on a
 * 2,000-object project. With the map they are 6 ms and 4 ms.
 *
 * Reports never run during a canvas gesture, so this was never a drag
 * problem — it was the Data workspace taking a quarter of a second to open,
 * and every report is built there now rather than two.
 */
function nodeIndex(doc: ProjectDoc): Map<string, PlantNode> {
  const map = new Map<string, PlantNode>()
  for (const sheet of doc.sheets) for (const node of sheet.nodes) map.set(node.id, node)
  return map
}

function nodeName(nodes: Map<string, PlantNode>, nodeId: string): string {
  const node = nodes.get(nodeId)
  if (!node) return '?'
  if (node.tag) return formatTag(node.tag, '-')
  if (node.label) return node.label
  return symbolName(node.symbolId)
}

function endName(nodes: Map<string, PlantNode>, end: PlantEdge['source']): string {
  return isPortEnd(end) ? nodeName(nodes, end.nodeId) : 'free end'
}

/** The edges touching each node on one sheet, in sheet order. An edge appears
 *  once per node even when both its ends land on the same one, which is what
 *  the per-row scan it replaces did. */
function edgesByNode(sheet: { edges: PlantEdge[] }): Map<string, PlantEdge[]> {
  const map = new Map<string, PlantEdge[]>()
  for (const edge of sheet.edges) {
    const ids = new Set<string>()
    for (const end of [edge.source, edge.target]) if (isPortEnd(end)) ids.add(end.nodeId)
    for (const id of ids) {
      const list = map.get(id)
      if (list) list.push(edge)
      else map.set(id, [edge])
    }
  }
  return map
}

/** One row of a generated report, carrying the id of the object it came from
 *  so a table can jump to it on the sheet. The CSV writers below and the Data
 *  workspace read the SAME rows — a report and the screen cannot disagree. */
export interface ReportRow {
  /** Node or edge id, for locateCell(). */
  id: string
  sheetId: string
  cells: string[]
  /**
   * The registry key this row's engineering cells live under, and the kind of
   * record to create if there is not one yet.
   *
   * Null when the object has no engineering identity — an untagged symbol, an
   * unnumbered line. Such a row still PRINTS, because leaving it out would
   * under-report the plant, but it cannot be edited: a record has nowhere to
   * hang without a key. That is the same rule the property panel states in
   * words ("no tag yet, so there is nothing to hang a record on"), applied to
   * the table.
   */
  recordKey: string | null
  /**
   * Absent where the row is not a registry record at all.
   *
   * The Loop list is the case: a Loop is its own entity with a stable id, not
   * an `EngineeringRecord`, and `EntityKind` deliberately does not have a
   * `loop` member. Stamping one of the four kinds onto a loop row to satisfy
   * the type would be a small lie in the data, and the editable path reads
   * this only after `recordKey` has already proved the row IS a record.
   */
  recordKind?: EntityKind
}

/**
 * A column in a generated report.
 *
 * `field` marks the column as an engineering value out of the registry — the
 * ones the Data workspace lets you edit, and the only ones it lets you edit. A
 * column with no `field` is derived from the drawing (a tag, a symbol name,
 * what a line is connected to) and is read-only everywhere, because the
 * drawing is where those are decided.
 */
export interface ReportColumn {
  label: string
  field?: string
  /**
   * A structured plant-hierarchy reference rather than a typed value.
   *
   * `unit` is assignable — picked from the units the project has declared, and
   * stored as a stable id. `area` is neither typed nor picked: it follows from
   * the unit, and printing it beside the unit is a convenience for the reader
   * and a disambiguator for an import, never a second thing to keep in step.
   */
  assign?: 'unit' | 'area'
}

const derived = (...labels: string[]): ReportColumn[] => labels.map((label) => ({ label }))
const editable = (keys: string[]): ReportColumn[] =>
  keys.map((field) => ({ label: labelForField(field), field }))

/**
 * Area and Unit, appended to every report.
 *
 * APPENDED, always. Existing columns keep the positions they have had since
 * the first release, so anything reading one of these CSVs by index still
 * works — the same promise the registry columns were added under.
 */
const HIERARCHY_COLUMNS: ReportColumn[] = [
  { label: 'Area', assign: 'area' },
  { label: 'Unit', assign: 'unit' },
]

/** The two hierarchy cells for one record key. Two map lookups, off a
 *  hierarchy built once per report. */
function hierarchyCells(h: Hierarchy, doc: ProjectDoc, key: string | null): string[] {
  const unitId = key ? doc.registry?.[key]?.unitId : undefined
  return [areaCodeOf(h, unitId), unitCodeOf(h, unitId)]
}

function toCsv(columns: string[], rows: ReportRow[]): string {
  return [row(columns), ...rows.map((r) => row(r.cells))].join('\n') + '\n'
}

/**
 * ENGINEERING COLUMNS
 *
 * Every report below prints engineering values out of `doc.registry`, read
 * through `fieldValue()` / `edgeFieldValue()`. Two rules hold everywhere:
 *
 *  1. The field KEYS come from `FIELD_CATALOG` and the HEADERS from
 *     `labelForField()`. There is one field catalogue in the product, so the
 *     column an engineer fills in on the Engineering tab and the column that
 *     prints in the CSV cannot drift apart.
 *  2. Nothing here stores a value. A report is a view of the record, so there
 *     is never a second copy to keep in step.
 */

/**
 * Registry fields appended to the instrument index.
 *
 * A curated subset rather than the whole instrument catalogue: the index is an
 * existing CSV contract people already read, and 24 new columns would make it
 * unusable. These seven are what an instrument index carries on a real
 * project. The complete record still prints in the datasheet matrix.
 */
const INSTRUMENT_INDEX_FIELDS = [
  'general.service',
  'general.area',
  'signal.range',
  'signal.output',
  'signal.fail',
  'general.manufacturer',
  'general.model',
]

/**
 * Registry fields appended to the line list.
 *
 * `general.service`, `general.from`, `general.to` and `general.pid` are
 * deliberately ABSENT. The report already answers all four, and answers them
 * better: Service from the line number, From and To from what the line is
 * actually connected to, the sheet from where it is drawn. Printing a typed
 * second copy beside a derived one is how a report starts disagreeing with
 * itself, which is the whole thing the registry exists to prevent.
 */
const LINE_LIST_FIELDS = [
  'general.fluid',
  'spec.size',
  'spec.class',
  'spec.material',
  'spec.schedule',
  'design.pressure',
  'design.temperature',
  'design.operatingPressure',
  'design.operatingTemperature',
  'design.insulation',
  'design.tracing',
  'design.testPressure',
]

/** The equipment and valve lists are new, so they have no column contract to
 *  protect and take their whole catalogue. */
const EQUIPMENT_LIST_FIELDS = fieldKeysFor('equipment')
const VALVE_LIST_FIELDS = fieldKeysFor('valve')

/** The seven original columns, then the record. Existing columns keep their
 *  positions — anything already reading this CSV by index still works. */
export const INSTRUMENT_INDEX_SPEC: ReportColumn[] = [
  ...derived('Tag', 'Description', 'Loop', 'Symbol', 'Sheet', 'Connected To', 'Notes'),
  ...editable(INSTRUMENT_INDEX_FIELDS),
  ...HIERARCHY_COLUMNS,
]
export const INSTRUMENT_INDEX_COLUMNS = INSTRUMENT_INDEX_SPEC.map((c) => c.label)

export function instrumentIndexRows(doc: ProjectDoc): ReportRow[] {
  const rows: ReportRow[] = []
  const nodes = nodeIndex(doc)
  const h = buildHierarchy(doc)
  for (const sheet of doc.sheets) {
    const touching = edgesByNode(sheet)
    for (const node of sheet.nodes) {
      if (!node.tag?.letters) continue
      const connected = (touching.get(node.id) ?? [])
        .map((e) =>
          isPortEnd(e.source) && e.source.nodeId === node.id
            ? endName(nodes, e.target)
            : endName(nodes, e.source),
        )
        .join('; ')
      rows.push({
        id: node.id,
        sheetId: sheet.id,
        recordKey: keyOfNode(node),
        recordKind: 'instrument',
        cells: [
          formatTag(node.tag, '-'),
          expandLetters(node.tag.letters),
          node.tag.loop,
          symbolName(node.symbolId),
          sheet.name,
          connected,
          node.label ?? '',
          // `fieldValue` resolves the record first and the legacy per-node
          // datasheet second, so a document written before schemaVersion 5
          // prints everything it has without being migrated first.
          ...INSTRUMENT_INDEX_FIELDS.map((k) => fieldValue(doc.registry, node, k)),
          ...hierarchyCells(h, doc, keyOfNode(node)),
        ],
      })
    }
  }
  return rows
}

export function instrumentIndexCsv(doc: ProjectDoc): string {
  return toCsv(INSTRUMENT_INDEX_COLUMNS, instrumentIndexRows(doc))
}

export const LINE_LIST_SPEC: ReportColumn[] = [
  ...derived('Line Number', 'Class', 'Size', 'Spec', 'Service', 'Seq', 'Sheet', 'From', 'To'),
  ...editable(LINE_LIST_FIELDS),
  ...HIERARCHY_COLUMNS,
]
export const LINE_LIST_COLUMNS = LINE_LIST_SPEC.map((c) => c.label)

export function lineListRows(doc: ProjectDoc): ReportRow[] {
  const rows: ReportRow[] = []
  const nodes = nodeIndex(doc)
  const h = buildHierarchy(doc)
  for (const sheet of doc.sheets) {
    for (const edge of sheet.edges) {
      const ln = edge.lineNumber
      if (!ln || !(ln.size || ln.spec || ln.service || ln.seq)) continue
      rows.push({
        id: edge.id,
        sheetId: sheet.id,
        recordKey: keyOfEdge(edge),
        recordKind: 'line',
        cells: [
          [ln.size, ln.spec, ln.service, ln.seq].filter(Boolean).join('-'),
          edge.lineClass,
          ln.size,
          ln.spec,
          ln.service,
          ln.seq,
          sheet.name,
          endName(nodes, edge.source),
          endName(nodes, edge.target),
          ...LINE_LIST_FIELDS.map((k) => edgeFieldValue(doc.registry, edge, k)),
          // A line's unit is whatever an engineer ASSIGNED, never inferred from
          // what it happens to be drawn between. A header can run the length of
          // a plant, and guessing its unit from one end of it would be a
          // fabricated engineering fact printed in a deliverable.
          ...hierarchyCells(h, doc, keyOfEdge(edge)),
        ],
      })
    }
  }
  return rows
}

export function lineListCsv(doc: ProjectDoc): string {
  return toCsv(LINE_LIST_COLUMNS, lineListRows(doc))
}

/**
 * The equipment and valve lists differ only in which objects they select and
 * which catalogue they print, so they are one function.
 *
 * UNTAGGED OBJECTS ARE LISTED, with the Tag cell empty. An equipment list that
 * silently dropped an untagged vessel would under-report the plant, which is
 * worse than showing it with a blank tag — and the blank is precisely the
 * signal that it needs one. Checks says so too (`equipment-no-record`), and
 * offers the fix that assigns the next free tag. `fieldValue()` already
 * returns '' for an object with no record, so nothing special is needed to
 * print one.
 *
 * Selection is on the drawing's own `node.kind`, NOT on `kindOfNode()`, which
 * maps fittings onto the equipment RECORD kind. That mapping is right for
 * storage — a tagged reducer keeps its record and its spec — and wrong for
 * this report, because an equipment list full of pipe junctions is not an
 * equipment list. No second identity system: the record is still found by
 * `keyOfNode()` exactly as everywhere else.
 */
function nodeReportRows(
  doc: ProjectDoc,
  kind: PlantNode['kind'],
  recordKind: EntityKind,
  fields: string[],
): ReportRow[] {
  const rows: ReportRow[] = []
  const h = buildHierarchy(doc)
  for (const sheet of doc.sheets) {
    for (const node of sheet.nodes) {
      if (node.kind !== kind) continue
      rows.push({
        id: node.id,
        sheetId: sheet.id,
        recordKey: keyOfNode(node),
        recordKind,
        cells: [
          node.tag ? formatTag(node.tag, '-') : '',
          node.label ?? '',
          symbolName(node.symbolId),
          sheet.name,
          ...fields.map((k) => fieldValue(doc.registry, node, k)),
          ...hierarchyCells(h, doc, keyOfNode(node)),
        ],
      })
    }
  }
  return rows
}

export const EQUIPMENT_LIST_SPEC: ReportColumn[] = [
  ...derived('Tag', 'Label', 'Symbol', 'Sheet'),
  ...editable(EQUIPMENT_LIST_FIELDS),
  ...HIERARCHY_COLUMNS,
]
export const EQUIPMENT_LIST_COLUMNS = EQUIPMENT_LIST_SPEC.map((c) => c.label)

export function equipmentListRows(doc: ProjectDoc): ReportRow[] {
  return nodeReportRows(doc, 'equipment', 'equipment', EQUIPMENT_LIST_FIELDS)
}

export function equipmentListCsv(doc: ProjectDoc): string {
  return toCsv(EQUIPMENT_LIST_COLUMNS, equipmentListRows(doc))
}

export const VALVE_LIST_SPEC: ReportColumn[] = [
  ...derived('Tag', 'Label', 'Symbol', 'Sheet'),
  ...editable(VALVE_LIST_FIELDS),
  ...HIERARCHY_COLUMNS,
]
export const VALVE_LIST_COLUMNS = VALVE_LIST_SPEC.map((c) => c.label)

export function valveListRows(doc: ProjectDoc): ReportRow[] {
  return nodeReportRows(doc, 'valve', 'valve', VALVE_LIST_FIELDS)
}

export function valveListCsv(doc: ProjectDoc): string {
  return toCsv(VALVE_LIST_COLUMNS, valveListRows(doc))
}

export function datasheetMatrixCsv(doc: ProjectDoc): string {
  const instruments = doc.sheets.flatMap((sh) => sh.nodes.filter((n) => n.kind === 'instrument'))
  // Columns come from both stores: the record where there is one, and the
  // legacy per-node datasheet for anything not migrated yet.
  const keys = [
    ...new Set(
      instruments.flatMap((n) => [
        ...Object.keys(n.datasheet ?? {}),
        ...Object.keys((keyOfNode(n) && doc.registry?.[keyOfNode(n)!]?.fields) || {}),
      ]),
    ),
  ].sort()
  const lines = [row(['Tag', 'Description', ...keys])]
  for (const node of instruments) {
    const tagText = node.tag ? formatTag(node.tag, '-') : ''
    lines.push(
      row([
        tagText,
        node.tag ? expandLetters(node.tag.letters) : '',
        ...keys.map((k) => fieldValue(doc.registry, node, k)),
      ]),
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * THE I/O LIST
 *
 * Derived, not stored. The engineering cells are registry fields, so they edit
 * through the same mechanism as every other engineering value in the Data
 * workspace; the derived ones carry no `field` and are therefore read-only
 * everywhere, which is the rule that keeps this a view rather than a second
 * source of truth.
 */
const IO_LIST_FIELDS = [
  'signal.type',
  'signal.units',
  'signal.systemTag',
  'signal.setpoint',
  'alarm.LL',
  'alarm.L',
  'alarm.H',
  'alarm.HH',
  'alarm.priority',
]

export const IO_LIST_SPEC: ReportColumn[] = [
  ...derived('Tag', 'Description', 'I/O type', 'Basis', 'Loop', 'Sheet', 'P&ID'),
  ...editable(IO_LIST_FIELDS),
  ...HIERARCHY_COLUMNS,
]
export const IO_LIST_COLUMNS = IO_LIST_SPEC.map((c) => c.label)

/**
 * The I/O rows AND the number of tagged objects deliberately left out.
 *
 * Both off ONE index walk. The count is not decoration: an I/O list is used to
 * size a cabinet, so "these 40 are your points" means something different from
 * "these 40, and 12 others were considered and are not points". Reporting only
 * the first leaves the reader unable to tell an exclusion from an omission.
 */
export function ioListReport(doc: ProjectDoc): { rows: ReportRow[]; excluded: number } {
  const ix = buildIndex(doc)
  return { rows: ioRowsFrom(ix), excluded: countNonIo(ix) }
}

export function ioListRows(doc: ProjectDoc): ReportRow[] {
  return ioRowsFrom(buildIndex(doc))
}

function ioRowsFrom(ix: ReturnType<typeof buildIndex>): ReportRow[] {
  const doc = ix.doc
  return deriveIoList(ix).map((r) => ({
    id: r.nodeId,
    sheetId: r.sheetId,
    recordKey: r.key,
    recordKind: 'instrument' as const,
    cells: [
      r.key,
      r.description,
      // A derived type prints in brackets: the list says what it worked out
      // and what an engineer stated, and never lets the two look alike.
      r.typeSource === 'registry' ? r.type : r.type === 'unknown' ? '—' : `(${r.type})`,
      r.typeBasis,
      r.loopIsAlone ? `${r.loopRef} (alone)` : r.loopRef,
      r.sheetName,
      r.drawingNumber,
      ...IO_LIST_FIELDS.map((k) => doc.registry?.[r.key]?.fields[k] ?? ''),
      // Blank where nothing is assigned, and the row still prints. Sizing a
      // cabinet from a list that hid its unassigned points is how a panel
      // arrives one card short.
      r.areaCode,
      r.unitCode,
    ],
  }))
}

export function ioListCsv(doc: ProjectDoc): string {
  return toCsv(IO_LIST_COLUMNS, ioListRows(doc))
}

/**
 * THE ENGINEERING DATA ROUND-TRIP
 *
 * A CSV designed to go out to a spreadsheet and come back. That is why it has
 * its own column list rather than reusing a report's: the tag comes first and
 * is the identity, every other column is a registry field, and there is
 * nothing derived in it that an import would have to ignore.
 *
 * Values that a spreadsheet would try to EXECUTE are prefixed with an
 * apostrophe on the way out and the apostrophe is stripped on the way back in,
 * so the file is safe to open and the round trip is still exact. A leading
 * minus on a real number is left alone — "-50" is a setpoint, not a formula,
 * and mangling it would be its own bug.
 */
const ENGINEERING_ROUND_TRIP_FIELDS = [
  'general.service',
  'signal.range',
  'signal.type',
  'signal.units',
  'signal.systemTag',
  'signal.setpoint',
  'alarm.LL',
  'alarm.L',
  'alarm.H',
  'alarm.HH',
  'alarm.priority',
]

/**
 * Area and Unit sit immediately after the Tag, because that is where a
 * spreadsheet reader expects the grouping columns to be — you sort by them.
 *
 * They carry CODES, never ids. A ULID in a cell is unreadable, unsortable and
 * unmergeable with the vendor list somebody is pasting in beside it. The code
 * is the engineering value a human recognises; the import resolves it back to
 * the stable id, and refuses anything it cannot resolve rather than inventing
 * the hierarchy the file implies.
 */
/* ------------------------------------------------------------- loop list */

/**
 * How a structural verdict is allowed to be WORDED in a deliverable.
 *
 * "Complete" on its own would be read as an approval by anybody skimming a
 * CSV, and this software cannot approve a control scheme — it can only say
 * which roles the declared loop type needs and whether they are present. Every
 * label below says `Structurally`, and the Basis column carries the
 * evaluation's own sentence, which ends by saying what it did not check.
 */
const LOOP_STATE_LABEL: Record<LoopCompleteness, string> = {
  complete: 'Structurally complete',
  incomplete: 'Structurally incomplete',
  broken: 'Broken membership',
  unknown: 'Type not stated',
  'not-applicable': 'Not applicable',
}

/**
 * THE LOOP LIST — export only, and read only.
 *
 * Persistent loops, never the derived grouping: a derived loop is an
 * observation about tag numbers, and printing it in the same table as a
 * declared engineering entity would let a reader mistake one for the other.
 * A project that has declared none exports an empty list, which is the honest
 * answer rather than a manufactured one.
 *
 * EVERY COLUMN IS DERIVED, so none of them carries a `field` and the Data
 * workspace renders the whole table read-only without needing to be told. A
 * Loop is not an `EngineeringRecord`; there is nowhere for a cell edit to go.
 */
export const LOOP_LIST_SPEC: ReportColumn[] = [
  ...derived(
    'Loop', 'Name', 'Description', 'Type', 'Type source', 'Status', 'State', 'Basis',
    'Members', 'Member tags', 'Area / Unit', 'I/O',
  ),
]
export const LOOP_LIST_COLUMNS = LOOP_LIST_SPEC.map((c) => c.label)

export function loopListRows(doc: ProjectDoc): ReportRow[] {
  // A project that has declared no loops has an empty list, and there is no
  // reason for it to pay for an index walk and an I/O derivation to find that
  // out — which is every project that has not adopted them.
  if (!doc.loops?.length) return []
  const ix = buildIndex(doc)
  // One index, one evaluation. `loopViews` is what the Loop Manager and the
  // QA rules read, so the CSV cannot disagree with either about whether a
  // loop is finished.
  const views = loopViews(ix)
  const io = new Map(deriveIoList(ix).map((r) => [r.key, r.type]))

  return views.map((view) => {
    const { loop, evaluation } = view
    // A member whose symbol is not on any sheet is SAID so rather than
    // dropped: the record outlives the symbol, and a list that quietly
    // shortened itself would under-report the loop.
    const tags = view.members.map((m) => (m.drawn ? m.key : `${m.key} (not drawn)`))

    // Counted from the I/O list's own verdicts. Nothing is classified here,
    // and a member the list left out as `none` — a local gauge, a relief
    // valve — is simply not an I/O point and is not counted as one.
    const counts = new Map<string, number>()
    for (const m of view.members) {
      const t = io.get(m.key)
      if (!t) continue
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const ioSummary = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, n]) => `${n} ${t}`)
      .join(', ')

    return {
      // The anchor is the first DRAWN member, so clicking the row finds
      // something. A loop with nothing drawn has no id to offer and falls back
      // to its own — stable, and never an array index.
      id: view.anchor?.targetId ?? loop.id,
      sheetId: view.anchor?.sheetId ?? '',
      // Not a registry record, so no key and no kind. See ReportRow.
      recordKey: null,
      cells: [
        loop.number,
        loop.name ?? '',
        loop.description ?? '',
        evaluation.type ? LOOP_TYPE_LABELS[evaluation.type] : '',
        evaluation.typeSource === 'none' ? '' : evaluation.typeSource,
        loop.status ?? '',
        // An EMPTY loop gets its own word rather than 'Structurally
        // incomplete'. `loop-incomplete` deliberately skips a loop with no
        // members and `loop-empty` reports it as info, so a report that called
        // it incomplete would be saying something the checker declines to say.
        view.members.length === 0 ? 'No members' : LOOP_STATE_LABEL[evaluation.completeness],
        evaluation.basis,
        String(view.members.length),
        tags.join('; '),
        loopPlaceLabel(ix, view),
        ioSummary,
      ],
    }
  })
}

export function loopListCsv(doc: ProjectDoc): string {
  return toCsv(LOOP_LIST_COLUMNS, loopListRows(doc))
}

export const ENGINEERING_SPEC: ReportColumn[] = [
  ...derived('Tag'),
  ...HIERARCHY_COLUMNS,
  ...editable(ENGINEERING_ROUND_TRIP_FIELDS),
]
export const ENGINEERING_COLUMNS = ENGINEERING_SPEC.map((c) => c.label)

/** One row per INSTRUMENT record, ordered by tag so two exports of one
 *  document are byte-identical. */
export function engineeringRows(doc: ProjectDoc): ReportRow[] {
  const h = buildHierarchy(doc)
  const sheetOf = new Map<string, string>()
  for (const sheet of doc.sheets) {
    for (const node of sheet.nodes) {
      const key = keyOfNode(node)
      if (key && !sheetOf.has(key)) sheetOf.set(key, sheet.id)
    }
  }
  return Object.entries(doc.registry ?? {})
    .filter(([, rec]) => rec.kind === 'instrument')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rec]) => ({
      id: key,
      sheetId: sheetOf.get(key) ?? '',
      recordKey: key,
      recordKind: 'instrument' as const,
      cells: [
        key,
        areaCodeOf(h, rec.unitId),
        unitCodeOf(h, rec.unitId),
        ...ENGINEERING_ROUND_TRIP_FIELDS.map((f) => rec.fields[f] ?? ''),
      ],
    }))
}

export function engineeringCsv(doc: ProjectDoc): string {
  // No local guarding: `csvField` neutralises every cell of every export now,
  // so doing it again here would only risk the two drifting apart.
  return toCsv(ENGINEERING_COLUMNS, engineeringRows(doc))
}

export function downloadEngineeringData(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'diagram'}-engineering-data.csv`, engineeringCsv(doc), 'text/csv')
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function downloadIoList(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'diagram'}-io-list.csv`, ioListCsv(doc), 'text/csv')
}

export function downloadInstrumentIndex(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'diagram'}-instrument-index.csv`, instrumentIndexCsv(doc), 'text/csv')
}

export function downloadDatasheetMatrix(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'diagram'}-datasheets.csv`, datasheetMatrixCsv(doc), 'text/csv')
}

export function downloadLineList(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'diagram'}-line-list.csv`, lineListCsv(doc), 'text/csv')
}

export function downloadEquipmentList(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'diagram'}-equipment-list.csv`, equipmentListCsv(doc), 'text/csv')
}

export function downloadLoopList(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'project'}-loops.csv`, loopListCsv(doc), 'text/csv')
}

export function downloadValveList(): void {
  const doc = useStore.getState().doc
  download(`${doc.meta.name || 'diagram'}-valve-list.csv`, valveListCsv(doc), 'text/csv')
}

/* ------------------------------------------------- conformance report */

/**
 * THE CONFORMANCE REPORT — one portable file, for one issued revision.
 *
 * One format, deliberately. A transmittal that can arrive in four shapes is a
 * transmittal nobody can check against anything, and the moment there are two
 * the question "which is authoritative" has no answer.
 *
 * Everything is read off the FROZEN revision row: the verdict, the counts, the
 * standard fingerprint, the findings. Nothing consults today's document or
 * today's standard, so regenerating this file next year produces the same
 * bytes it produces today — which is the only property that makes it evidence
 * rather than a screenshot.
 *
 * The header is a two-column key/value block rather than a wide single row,
 * because a person reads this in a spreadsheet and a wide header forces them
 * to scroll sideways past twenty columns to find one value.
 *
 * Every cell goes through the shared `csvCell`, which is also the shared
 * formula guard. There is exactly one escaper in this product.
 */
export function conformanceCsv(doc: ProjectDoc, sheet: Sheet, rev: Revision): string {
  const h = historicalConformance(rev)
  const lines: string[] = []
  const kv = (k: string, v: string) => lines.push(row([k, v]))
  const counts = (label: string, c: { critical: number; warning: number; info: number; total: number }) => {
    kv(`${label} — critical`, String(c.critical))
    kv(`${label} — warning`, String(c.warning))
    kv(`${label} — info`, String(c.info))
    kv(`${label} — total`, String(c.total))
  }

  kv('Report', 'Conformance')
  kv('Project', doc.meta.name ?? '')
  kv('Document number', doc.meta.documentNumber ?? '')
  kv('Sheet', sheet.name)
  kv('Drawing number', sheet.drawingNumber)
  kv('Revision', rev.code)
  kv('Issue status', rev.status)
  kv('Issued at', rev.issuedAt ?? 'not issued')
  kv('Standard name', rev.standard?.name ?? 'not recorded')
  kv('Standard version', rev.standard?.version ?? 'not recorded')
  kv('Standard fingerprint', rev.standard?.fingerprint ?? 'not recorded')
  kv('Conformance', CONFORMANCE_LABEL[h.status])
  kv('Evidence captured at', rev.qaEvidence?.capturedAt ?? 'not recorded')

  if (h.record) {
    counts('Open findings', h.record.open)
    counts('Accepted findings', h.record.accepted)
    kv('Rules evaluated', String(h.record.rulesEvaluated))
    // Named, not counted. "Three checks disabled" tells a reviewer nothing they
    // can act on; the ids tell them exactly which questions were not asked.
    kv('Disabled checks', h.record.rulesDisabled.length ? h.record.rulesDisabled.join(' ') : 'none')
  } else {
    counts('Open findings', h.open)
    counts('Accepted findings', { critical: 0, warning: 0, info: 0, total: 0 })
    kv('Rules evaluated', 'not recorded')
    kv('Disabled checks', 'not recorded')
  }

  lines.push('')
  lines.push(row(['Severity', 'Check', 'Rule id', 'Object', 'Finding', 'State', 'Accepted reason', 'Accepted by', 'Accepted at']))
  for (const f of rev.qaEvidence?.findings ?? []) {
    lines.push(row([
      f.severity, f.ruleTitle, f.ruleId, f.entityKey, f.message,
      f.ignored ? 'Accepted' : 'Open',
      f.ignored?.reason ?? '', f.ignored?.by ?? '', f.ignored?.at ?? '',
    ]))
  }
  if (!rev.qaEvidence) {
    lines.push(row(['', 'Finding evidence not recorded for this revision', '', '', '', '', '', '', '']))
  } else if (rev.qaEvidence.omitted > 0) {
    lines.push(row(['', `${rev.qaEvidence.omitted} further findings were not stored`, '', '', '', '', '', '', '']))
  }
  return lines.join('\n') + '\n'
}

export function downloadConformance(sheet: Sheet, rev: Revision): void {
  const doc = useStore.getState().doc
  const base = sheet.drawingNumber || doc.meta.name || 'diagram'
  download(`${base}-rev-${rev.code}-conformance.csv`, conformanceCsv(doc, sheet, rev), 'text/csv')
}
