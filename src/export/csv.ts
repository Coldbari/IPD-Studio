// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantEdge, ProjectDoc } from '../model/types'
import { isPortEnd } from '../model/types'
import { expandLetters, formatTag } from '../isa/tag'
import { getSymbol } from '../symbols/registry'
import { fieldValue, keyOfNode } from '../model/registry'
import { useStore } from '../store/store'
import { LINE_CLASS_LABELS } from '../canvas/lineStyle'
import { tr } from '../i18n'

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
const row = (cells: string[]) => cells.map(csvField).join(',')

function nodeName(doc: ProjectDoc, nodeId: string): string {
  const node = doc.sheets.flatMap((sh) => sh.nodes).find((n) => n.id === nodeId)
  if (!node) return '?'
  if (node.tag) return formatTag(node.tag, '-')
  if (node.label) return node.label
  return tr(getSymbol(node.symbolId).name)
}

function endName(doc: ProjectDoc, end: PlantEdge['source']): string {
  if (isPortEnd(end)) return nodeName(doc, end.nodeId)
  // A free end waiting for a not-yet-drawn device shows its reservation.
  return end.pendingTag ? tr('pending') + ' ' + end.pendingTag : tr('free end')
}

/** One row of a generated report, carrying the id of the object it came from
 *  so a table can jump to it on the sheet. The CSV writers below and the Data
 *  workspace read the SAME rows — a report and the screen cannot disagree. */
export interface ReportRow {
  /** Node or edge id, for locateCell(). */
  id: string
  sheetId: string
  cells: string[]
}

export const INSTRUMENT_INDEX_COLUMNS = ['Tag', 'Description', 'Loop', 'Symbol', 'Sheet', 'Connected To', 'Notes']

export function instrumentIndexRows(doc: ProjectDoc): ReportRow[] {
  const rows: ReportRow[] = []
  for (const sheet of doc.sheets) {
    for (const node of sheet.nodes) {
      if (!node.tag?.letters) continue
      const connected = sheet.edges
        .flatMap((e) => {
          if (isPortEnd(e.source) && e.source.nodeId === node.id) return [endName(doc, e.target)]
          if (isPortEnd(e.target) && e.target.nodeId === node.id) return [endName(doc, e.source)]
          return []
        })
        .join('; ')
      rows.push({
        id: node.id,
        sheetId: sheet.id,
        cells: [
          formatTag(node.tag, '-'),
          expandLetters(node.tag.letters),
          node.tag.loop,
          getSymbol(node.symbolId).name,
          sheet.name,
          connected,
          node.label ?? '',
        ],
      })
    }
  }
  return rows
}

export function instrumentIndexCsv(doc: ProjectDoc): string {
  const lines = [row(INSTRUMENT_INDEX_COLUMNS)]
  for (const r of instrumentIndexRows(doc)) lines.push(row(r.cells))
  return lines.join('\n') + '\n'
}

export const LINE_LIST_COLUMNS = ['Line Number', 'Class', 'Size', 'Spec', 'Service', 'Seq', 'Sheet', 'From', 'To']

export function lineListRows(doc: ProjectDoc): ReportRow[] {
  const rows: ReportRow[] = []
  for (const sheet of doc.sheets) {
    for (const edge of sheet.edges) {
      const ln = edge.lineNumber
      if (!ln || !(ln.size || ln.spec || ln.service || ln.seq)) continue
      rows.push({
        id: edge.id,
        sheetId: sheet.id,
        cells: [
          [ln.size, ln.spec, ln.service, ln.seq].filter(Boolean).join('-'),
          tr(LINE_CLASS_LABELS[edge.lineClass] ?? edge.lineClass),
          ln.size,
          ln.spec,
          ln.service,
          ln.seq,
          sheet.name,
          endName(doc, edge.source),
          endName(doc, edge.target),
        ],
      })
    }
  }
  return rows
}

export function lineListCsv(doc: ProjectDoc): string {
  const lines = [row(LINE_LIST_COLUMNS)]
  for (const r of lineListRows(doc)) lines.push(row(r.cells))
  return lines.join('\n') + '\n'
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

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
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
