// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { PlantNode, ProjectDoc } from '../model/types'
import { isPortEnd } from '../model/types'
import { formatTag } from '../isa/tag'
import { getSymbol } from '../symbols/registry'
import { deriveLoops } from '../store/selectors'
import { useStore } from '../store/store'
import { locateCell } from '../canvas/locate'
import { tr, useT } from '../i18n'

interface Ref {
  key: string
  label: string
  sub: string
  go?: () => void
}

const nameOf = (n: PlantNode) =>
  n.tag ? formatTag(n.tag, '-') : n.label?.trim() || tr(getSymbol(n.symbolId).name)

/** Everywhere this object appears, derived from the document. No new storage:
 *  every relationship shown here already exists in the drawing. */
function referencesFor(doc: ProjectDoc, node: PlantNode): { sheets: Ref[]; loop: Ref[]; lines: Ref[]; hmi: Ref[] } {
  const tagText = node.tag ? formatTag(node.tag, '-') : null
  const sheet = doc.sheets.find((sh) => sh.nodes.some((n) => n.id === node.id))

  const sheets: Ref[] = sheet ? [{ key: sheet.id, label: sheet.name, sub: sheet.drawingNumber || tr('no drawing №') }] : []

  const loop: Ref[] = []
  if (node.tag?.letters && node.tag.loop) {
    const family = node.tag.letters[0]!
    const found = deriveLoops(doc).find((l) => l.family === family && l.loop === node.tag!.loop)
    for (const m of found?.members ?? []) {
      if (m.nodeId === node.id) continue
      loop.push({
        key: m.nodeId,
        label: formatTag(m.tag, '-'),
        sub: tr('same loop'),
        go: () => locateCell(m.nodeId),
      })
    }
  }

  const lines: Ref[] = []
  if (sheet) {
    for (const e of sheet.edges) {
      const ends = [e.source, e.target]
      if (!ends.some((end) => isPortEnd(end) && end.nodeId === node.id)) continue
      const other = ends.find((end) => isPortEnd(end) && end.nodeId !== node.id)
      const otherNode = other && isPortEnd(other) ? sheet.nodes.find((n) => n.id === other.nodeId) : undefined
      const freeEnd = ends.find((end) => !isPortEnd(end))
      const ln = e.lineNumber
      const number = ln ? [ln.size, ln.spec, ln.service, ln.seq].filter(Boolean).join('-') : ''
      lines.push({
        key: e.id,
        label: number || e.lineClass,
        sub: otherNode
          ? tr('to') + ' ' + nameOf(otherNode)
          : (freeEnd && !isPortEnd(freeEnd) && freeEnd.pendingTag
              ? tr('pending') + ' ' + freeEnd.pendingTag
              : tr('free end')),
        go: () => locateCell(e.id),
      })
    }
  }

  const hmi: Ref[] = tagText
    ? doc.hmiScreens
        .filter((sc) => sc.widgets.some((w) => w.tag === tagText))
        .map((sc) => ({ key: sc.id, label: sc.name, sub: tr('HMI screen') }))
    : []

  return { sheets, loop, lines, hmi }
}

function Group({ title, refs, empty }: { title: string; refs: Ref[]; empty: string }) {
  return (
    <div className="used-group">
      <div className="used-head">{title}{refs.length ? ` (${refs.length})` : ''}</div>
      {refs.length === 0 ? (
        <div className="used-empty">{empty}</div>
      ) : (
        refs.map((r) =>
          r.go ? (
            <button key={r.key} className="used-row" onClick={r.go}>
              <b>{r.label}</b><span>{r.sub}</span>
            </button>
          ) : (
            <div key={r.key} className="used-row static">
              <b>{r.label}</b><span>{r.sub}</span>
            </div>
          ),
        )
      )}
    </div>
  )
}

/**
 * The connective tissue: what makes the panel read as a database rather than a
 * longer form. Everything here is derived — the stored engineering record it
 * will eventually sit beside arrives with the registry in v0.15.
 */
export default function InspectorWhereUsed({ node }: { node: PlantNode }) {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const { sheets, loop, lines, hmi } = referencesFor(doc, node)
  return (
    <div className="used">
      <div className="prop-title">{nameOf(node)}</div>
      <Group title={t('Sheet')} refs={sheets} empty={t('not placed on a sheet')} />
      <Group title={t('Loop')} refs={loop} empty={node.tag ? t('no other instrument shares this loop') : t('untagged — no loop')} />
      <Group title={t('Connected lines')} refs={lines} empty={t('nothing connected yet')} />
      <Group title={t('HMI')} refs={hmi} empty={t('not on an operator screen')} />
    </div>
  )
}
