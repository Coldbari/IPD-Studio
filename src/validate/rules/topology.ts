// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { finding } from '../rules'
import { isPortEnd } from '../../model/types'
import { portKindAt } from '../../model/projectIndex'
import { runContinuity } from '../../model/run'
import { canConnect } from '../../canvas/connectionRules'
import { connectionRef } from '../../symbols/portLabels'

export const danglingEnd: Rule = {
  id: 'dangling-end',
  title: 'Unterminated lines',
  severity: 'warning',
  discipline: 'topology',
  why: 'A line that stops in space carries nothing — the run it belongs to is incomplete.',
  run(ix) {
    const out = []
    for (const e of ix.allEdges) {
      const free = [e.edge.source, e.edge.target].filter((end) => !isPortEnd(end)).length
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
      // The rule is unchanged — same check, same severity. What changed is
      // that it can now say WHICH two points, which is the difference between
      // a finding you can act on and one you have to go and look for.
      const from = ix.nodes.get(source.nodeId)
      const to = ix.nodes.get(target.nodeId)
      const aRef = from && connectionRef(from.node, source.portId)
      const bRef = to && connectionRef(to.node, target.portId)
      const message = aRef && bRef
        ? `A ${e.edge.lineClass} line joins ${aRef} to ${bRef}, which cannot be connected`
        : `A ${e.edge.lineClass} line connects incompatible ports`
      out.push(
        finding(incompatibleConnection, e.key ?? e.edge.id, message, {
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
  /**
   * ONE NUMBER, ONE PIPE — asked of the RUN, not of the edge.
   *
   * This used to flag every edge past the first that wore a number, which made
   * drawing a real line a fault: pump, block valve, check valve, vessel is four
   * edges, and numbering all four honestly produced three warnings. The product
   * was telling engineers not to number their pipes. `ix.runs` (P3 Program 1)
   * is what was missing — it says which edges are one pipe — so the question
   * becomes "is this number on more than one PIPE", which is what the rule
   * always meant.
   *
   * THREE THINGS ARE NOT DUPLICATES, and each is a real drawing:
   *
   *  1. Several edges of one run. That is one pipe drawn in segments.
   *  2. Two runs separated by an in-line instrument. An orifice plate ends a
   *     run only because `passesThrough` rejects instruments by kind, so
   *     splitting there is our model's doing, not the drawing's.
   *  3. Two runs on different sheets joined by a linked off-page connector.
   *     Program 1 deliberately does not cross sheets; `runContinuity` reads the
   *     link the `offpage-link` rule already validates and says so.
   *
   * Everything else stays a duplicate. A number on two pipes that the drawing
   * does not connect cannot be specified, isometric-drawn or tested twice, and
   * the severity is unchanged.
   *
   * NOT IN A RUN, STILL CHECKED. `runOfEdge` holds process edges only, so a
   * number typed onto a signal line has no run. Those stay in the check as an
   * island of one, exactly as before — narrowing the rule to piping would have
   * quietly dropped coverage nobody asked to lose.
   */
  run(ix) {
    const out = []
    const cluster = runContinuity(ix)
    /** What a numbered edge belongs to: its pipe, or itself when it is not one. */
    const localityOf = (edgeId: string): string => {
      const runId = ix.runOfEdge.get(edgeId)
      if (!runId) return `edge:${edgeId}`
      return cluster.get(runId) ?? runId
    }

    for (const key of [...ix.edgesByKey.keys()].sort()) {
      const group = ix.edgesByKey.get(key)!
      if (group.length < 2) continue
      // Smallest edge id per locality, so both the count and the edge the
      // finding points at are independent of document order.
      const firstOf = new Map<string, { edgeId: string; sheetId: string }>()
      for (const e of group) {
        const where = localityOf(e.edge.id)
        const seen = firstOf.get(where)
        if (!seen || e.edge.id < seen.edgeId) firstOf.set(where, { edgeId: e.edge.id, sheetId: e.sheet.id })
      }
      if (firstOf.size < 2) continue

      // Point at the SECOND pipe, ordered by its first edge — the one that
      // repeats a number already used, which is what the old rule targeted.
      const ordered = [...firstOf.values()].sort((a, b) => (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))
      const target = ordered[1]!
      out.push(
        // Keyed by the NUMBER alone. The old key carried an edge id, so
        // accepting the finding and then redrawing the line brought it back;
        // a line number is the engineering identity and does survive a redraw.
        finding(duplicateLineNumber, key, `Line number ${key} is used on ${firstOf.size} runs that are not connected to each other`, {
          targetId: target.edgeId,
          sheetId: target.sheetId,
        }),
      )
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
            // Safe to offer: the SECOND line of the pair is the one flagged, so
            // the surviving line keeps whatever the first one carried.
            fix: { label: 'Delete the doubled line', spec: { kind: 'delete-duplicate-line', sheetId: e.sheet.id, edgeId: e.edge.id } },
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
