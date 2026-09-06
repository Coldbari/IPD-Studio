// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { finding } from '../rules'
import { isJunctionEnd, isPortEnd } from '../../model/types'
import { portKindAt } from '../../model/projectIndex'
import { canConnect } from '../../canvas/connectionRules'

export const danglingEnd: Rule = {
  id: 'dangling-end',
  title: 'Unterminated lines',
  severity: 'warning',
  discipline: 'topology',
  why: 'A line that stops in space carries nothing — the run it belongs to is incomplete.',
  run(ix) {
    const out = []
    for (const e of ix.allEdges) {
      const free = [e.edge.source, e.edge.target].filter((end) => !isPortEnd(end) && !isJunctionEnd(end)).length
      if (!free) continue
      out.push(
        finding(danglingEnd, e.key ?? e.edge.id, free === 2 ? 'Line is attached at neither end' : 'Line has an unterminated free end', {
          targetId: e.edge.id,
          sheetId: e.sheet.id,
        }),
      )
    }
    return out
  },
}

export const incompatibleConnection: Rule = {
  id: 'incompatible-connection',
  title: 'Incompatible connections',
  severity: 'critical',
  discipline: 'topology',
  why: 'A signal line into a process nozzle is not a thing that can be built.',
  run(ix) {
    const out = []
    for (const e of ix.allEdges) {
      const { source, target } = e.edge
      if (!isPortEnd(source) || !isPortEnd(target)) continue
      const a = portKindAt(ix, source)
      const b = portKindAt(ix, target)
      if (!a || !b || canConnect(a, b, e.edge.lineClass)) continue
      out.push(
        finding(incompatibleConnection, e.key ?? e.edge.id, `A ${e.edge.lineClass} line connects incompatible ports`, {
          targetId: e.edge.id,
          sheetId: e.sheet.id,
        }),
      )
    }
    return out
  },
}

export const duplicateLineNumber: Rule = {
  id: 'duplicate-line-number',
  title: 'Duplicate line numbers',
  severity: 'warning',
  discipline: 'topology',
  why: 'Two runs sharing a number cannot both be specified, isometric-drawn or tested.',
  run(ix) {
    const out = []
    for (const [key, group] of ix.edgesByKey) {
      if (group.length < 2) continue
      for (const dup of group.slice(1)) {
        out.push(
          finding(duplicateLineNumber, `${key}#${dup.edge.id}`, `Line number ${key} is used more than once`, {
            targetId: dup.edge.id,
            sheetId: dup.sheet.id,
          }),
        )
      }
    }
    return out
  },
}

export const duplicateParallelLine: Rule = {
  id: 'duplicate-parallel-line',
  title: 'Doubled lines',
  severity: 'info',
  discipline: 'topology',
  why: 'Two lines between the same two ports draw as one — the extra is invisible and will confuse every downstream count.',
  run(ix) {
    const out = []
    const seen = new Set<string>()
    for (const e of ix.allEdges) {
      const { source, target } = e.edge
      if (!isPortEnd(source) || !isPortEnd(target)) continue
      const key = [`${source.nodeId}:${source.portId}`, `${target.nodeId}:${target.portId}`].sort().join('|')
      if (seen.has(key)) {
        out.push(
          finding(duplicateParallelLine, e.key ?? e.edge.id, 'Two identical lines connect the same two points — delete one?', {
            targetId: e.edge.id,
            sheetId: e.sheet.id,
          }),
        )
      } else seen.add(key)
    }
    return out
  },
}

export const offpageLink: Rule = {
  id: 'offpage-link',
  title: 'Off-page connectors',
  severity: 'critical',
  discipline: 'topology',
  why: 'A connector that points nowhere breaks the continuity between sheets that the reader depends on.',
  run(ix) {
    const out = []
    const multiSheet = ix.doc.sheets.length > 1
    const sheetIds = new Set(ix.doc.sheets.map((s) => s.id))
    for (const n of ix.allNodes) {
      if (n.node.symbolId !== 'ann.offpage') continue
      const link = n.node.link
      const label = n.node.label || 'Off-page connector'
      if (!link) {
        // on a one-sheet drawing there is nowhere to point yet
        if (multiSheet) {
          out.push(
            finding(offpageLink, n.node.id, `${label} is not linked to another sheet`, {
              targetId: n.node.id,
              sheetId: n.sheet.id,
            }),
          )
        }
      } else if (!sheetIds.has(link.sheetId) || !ix.nodes.has(link.nodeId)) {
        out.push(
          finding(offpageLink, n.node.id, `${label} points at a missing sheet or connector`, {
            targetId: n.node.id,
            sheetId: n.sheet.id,
          }),
        )
      }
    }
    return out
  },
}

export const TOPOLOGY_RULES: Rule[] = [
  incompatibleConnection,
  offpageLink,
  danglingEnd,
  duplicateLineNumber,
  duplicateParallelLine,
]
