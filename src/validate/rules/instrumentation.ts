// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { finding } from '../rules'
import { isPortEnd } from '../../model/types'
import { edgesOf, signalReach } from '../../model/projectIndex'
import { formatTag } from '../../isa/tag'

/** Actuators that need a pneumatic signal, not a milliamp loop. */
const PNEUMATIC_ACTUATORS = new Set(['diaphragm', 'piston'])

export const noReceiver: Rule = {
  id: 'no-receiver',
  title: 'Measurements nothing receives',
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'A transmitter with no indicator or controller in its loop measures something nobody reads.',
  run(ix) {
    const out = []
    for (const n of ix.allNodes) {
      const t = n.node.tag
      if (n.node.kind !== 'instrument' || !t?.letters || !t.loop) continue
      if (t.letters.length < 2 || !t.letters.endsWith('T')) continue
      const family = t.letters[0]
      const hasReceiver = ix.allNodes.some((o) => {
        const ot = o.node.tag
        if (o.node.id === n.node.id || !ot?.letters) return false
        if (ot.letters[0] !== family || ot.loop !== t.loop) return false
        return /[ICR]/.test(ot.letters.slice(1))
      })
      if (hasReceiver) continue
      out.push(
        finding(noReceiver, n.key!, `${formatTag(t, '-')} measures but nothing receives it — add an indicator or controller?`, {
          targetId: n.node.id,
          sheetId: n.sheet.id,
        }),
      )
    }
    return out
  },
}

export const noFinalElement: Rule = {
  id: 'no-final-element',
  title: 'Controllers that control nothing',
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'A controller with no final element cannot act on what it measures.',
  run(ix) {
    const out = []
    for (const n of ix.allNodes) {
      const t = n.node.tag
      if (n.node.kind !== 'instrument' || !t?.letters || !t.loop) continue
      if (!t.letters.includes('C') || t.letters.endsWith('V')) continue
      const family = t.letters[0]
      const taggedFinal = ix.allNodes.some(
        (o) => o.node.kind === 'valve' && o.node.tag?.loop === t.loop && o.node.tag?.letters[0] === family,
      )
      const wiredFinal = [...signalReach(ix, n.node.id, 3)].some((id) => ix.nodes.get(id)?.node.kind === 'valve')
      if (taggedFinal || wiredFinal) continue
      out.push(
        finding(noFinalElement, n.key!, `${formatTag(t, '-')} controls nothing — where is its valve?`, {
          targetId: n.node.id,
          sheetId: n.sheet.id,
        }),
      )
    }
    return out
  },
}

export const deadEndInstrument: Rule = {
  id: 'dead-end-instrument',
  title: 'Unconnected instruments',
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'A tagged instrument joined to nothing is either unfinished or left over.',
  run(ix) {
    const out = []
    for (const n of ix.allNodes) {
      if (n.node.kind !== 'instrument' || !n.key) continue
      if (edgesOf(ix, n.node.id).length) continue
      out.push(
        finding(deadEndInstrument, n.key, `${n.key} is not connected to anything`, {
          targetId: n.node.id,
          sheetId: n.sheet.id,
        }),
      )
    }
    return out
  },
}

export const noFailPosition: Rule = {
  id: 'no-fail-position',
  title: 'Control valves without a fail position',
  // Warning by default for the same reason as no-relief: it is genuinely
  // important, and genuinely unstated on plenty of early-stage drawings. The
  // company standard is what turns it into a blocker.
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'What the valve does on loss of signal is a safety decision. It cannot be left unstated — and it is not one software should guess, so there is no auto-fix here on purpose.',
  run(ix) {
    // A house that records fail position on the datasheet rather than the P&ID
    // switches this off for the whole project from the Standards page.
    if (ix.standard.conventions.valveFailPosition === 'optional') return []
    const out = []
    for (const n of ix.allNodes) {
      if (!n.node.symbolId.startsWith('cv.')) continue
      if ((n.node.config?.fail ?? 'none') !== 'none') continue
      out.push(
        finding(noFailPosition, n.key ?? n.node.id, `${n.key ?? 'Control valve'} has no failure position (FC / FO / FL)`, {
          targetId: n.node.id,
          sheetId: n.sheet.id,
        }),
      )
    }
    return out
  },
}

export const needsIpConverter: Rule = {
  id: 'needs-ip-converter',
  // A warning rather than an observation: it is a wiring mistake that cannot
  // work as drawn, and it is one of the few findings with an exact fix.
  title: 'Signal chain: missing I/P converter',
  severity: 'warning',
  discipline: 'instrumentation',
  why: 'A milliamp signal cannot stroke a pneumatic actuator on its own.',
  run(ix) {
    const out = []
    for (const e of ix.allEdges) {
      if (e.edge.lineClass !== 'signal.electric') continue
      const { source, target } = e.edge
      if (!isPortEnd(source) || !isPortEnd(target)) continue
      for (const [end, other] of [[source, target], [target, source]] as const) {
        const valve = ix.nodes.get(end.nodeId)
        const sender = ix.nodes.get(other.nodeId)
        if (!valve || !sender) continue
        if (!valve.node.symbolId.startsWith('cv.') || end.portId !== 'sig') continue
        if (!PNEUMATIC_ACTUATORS.has(valve.node.config?.actuator ?? 'diaphragm')) continue
        if (sender.node.symbolId === 'instr.converter') continue
        const sheetId = e.sheet.id
        const edgeId = e.edge.id
        out.push(
          finding(needsIpConverter, e.key ?? edgeId, `Electric signal drives ${valve.key ?? 'a control valve'} with a pneumatic actuator — insert an I/P converter`, {
            targetId: edgeId,
            sheetId,
            fix: { label: 'Insert an I/P converter', spec: { kind: 'insert-ip', sheetId, edgeId } },
          }),
        )
      }
    }
    return out
  },
}

export const notInLoop: Rule = {
  id: 'instrument-not-in-loop',
  title: 'Instruments outside any loop',
  severity: 'info',
  discipline: 'instrumentation',
  why: 'An instrument that shares its loop number with nothing else gets no loop diagram.',
  run(ix) {
    const out = []
    for (const loop of ix.loops) {
      if (loop.members.length !== 1) continue
      const only = loop.members[0]!
      const n = ix.nodes.get(only.nodeId)
      if (!n || n.node.kind !== 'instrument') continue
      out.push(
        finding(notInLoop, n.key ?? only.nodeId, `${formatTag(only.tag, '-')} is the only instrument on loop ${loop.family}-${loop.loop}`, {
          targetId: only.nodeId,
          sheetId: n.sheet.id,
        }),
      )
    }
    return out
  },
}

export const INSTRUMENTATION_RULES: Rule[] = [
  noFailPosition,
  noReceiver,
  noFinalElement,
  deadEndInstrument,
  needsIpConverter,
  notInLoop,
]
