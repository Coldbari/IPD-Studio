// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { finding } from '../rules'
import { edgesOf, neighboursOf } from '../../model/projectIndex'
import { processFor } from '../../model/processData'
import { DEFAULTS } from '../../hmi/sim/units'
import { suctionFor } from '../../model/suction'

const RELIEF_SYMBOLS = new Set(['psv', 'pse', 'pvsv', 'psv.pilot', 'vacuum-breaker', 'breather', 'flame-arrestor'])

export const noRelief: Rule = {
  id: 'no-relief',
  title: 'Vessels without a relief device',
  // A real safety concern, but a warning rather than a critical BY DEFAULT: a
  // vessel's relief is very often on another sheet or outside the drawing's
  // scope, and three of the five bundled sample drawings trip it legitimately.
  // A company standard promotes this to critical (v0.18); crying wolf on every
  // drawing until then would teach people to ignore the report.
  severity: 'warning',
  discipline: 'process',
  why: 'A vessel that can be blocked in and has no relief path is the classic overpressure case.',
  run(ix) {
    const out = []
    for (const n of ix.allNodes) {
      if (!n.node.symbolId.startsWith('vessel.')) continue
      const hasProcess = edgesOf(ix, n.node.id).some(
        (e) => e.lineClass.startsWith('process') || e.lineClass.startsWith('pipe'),
      )
      if (!hasProcess) continue
      const hasRelief = neighboursOf(ix, n.node.id).some((id) =>
        RELIEF_SYMBOLS.has(ix.nodes.get(id)?.node.symbolId ?? ''),
      )
      if (hasRelief) continue
      const name = n.node.label || n.key || 'Vessel'
      out.push(
        finding(noRelief, n.key ?? n.node.id, `${name} has no relief device connected — intended?`, {
          targetId: n.node.id,
          sheetId: n.sheet.id,
        }),
      )
    }
    return out
  },
}

export const lineNoService: Rule = {
  id: 'line-no-service',
  title: 'Numbered lines with no service',
  severity: 'warning',
  discipline: 'process',
  why: 'The service is what tells a reader, and the line list, what is actually in the pipe.',
  run(ix) {
    const out = []
    for (const e of ix.allEdges) {
      if (!e.key) continue
      const hasService = Boolean(e.edge.lineNumber?.service?.trim()) || Boolean(e.edge.fluidId)
      if (hasService) continue
      out.push(
        finding(lineNoService, e.key, `Line ${e.key} has no service or fluid assigned`, {
          targetId: e.edge.id,
          sheetId: e.sheet.id,
        }),
      )
    }
    return out
  },
}

/**
 * A vessel the simulation is running on an ASSUMED capacity.
 *
 * Capacity used to be taken from the widget's pixel area, so every vessel
 * silently had one and resizing the drawing changed it. It now comes from
 * `construction.volume` on the engineering record, and where nobody has stated
 * one the simulator uses a documented default — but it says so here rather
 * than letting an assumption pass for engineering data.
 *
 * INFO, not a warning. A drawing that nobody has specified yet is normal, and
 * a check that fires on every vessel of every new project is a check people
 * switch off. What matters is that the assumption is visible when someone asks
 * why a tank fills at the rate it does.
 */
export const tankCapacityDefaulted: Rule = {
  id: 'tank-capacity-defaulted',
  title: 'Vessels simulating on a default capacity',
  severity: 'info',
  discipline: 'process',
  why: 'The simulation integrates level as volume over capacity. Without a stated volume it uses an assumed one, and the fill rates it shows are that assumption rather than your plant.',
  run(ix) {
    const out = []
    const seen = new Set<string>()
    for (const screen of ix.doc.hmiScreens ?? []) {
      for (const w of screen.widgets) {
        if (w.type !== 'tank' || !w.tag || seen.has(w.tag)) continue
        seen.add(w.tag)
        if (processFor(ix.doc.registry, w.tag).volumeM3 !== undefined) continue
        // a legacy widget prop is still an answer, just not one on the record
        if (typeof w.props?.capacity === 'number') continue
        out.push(
          finding(
            tankCapacityDefaulted,
            w.tag,
            `${w.tag} has no stated volume — the simulation is using ${DEFAULTS.tankVolumeM3} m³. Set Volume on its engineering record.`,
          ),
        )
      }
    }
    return out
  },
}

/**
 * CAN THE DRAWN SUCTION SUPPLY THE PUMP SPECIFIED ON IT?
 *
 * Detection is in `model/suction.ts`; both rules below are adapters, the same
 * split `validate/rules/diagnostics.ts` uses. Two rules rather than one because
 * a `Rule` declares ONE severity and these two states are not equally serious:
 * a suction that reaches no source at all is a broken drawing, while a duty
 * the path cannot pass is a specification that needs revisiting.
 *
 * NEITHER IS AN NPSH CHECK. `model/suction.ts` says at length why the model
 * cannot make one and what it computes instead; the messages below say so to
 * the reader as well, because a finding that sounds like NPSH would be read as
 * NPSH.
 */
const m3h = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} m³/h`

export const pumpSuctionInsufficient: Rule = {
  id: 'pump-suction-insufficient',
  title: 'Pumps whose suction cannot supply their rated duty',
  // A warning, not critical. The finding is about the specification rather
  // than about the drawing being unreadable, and the remedy is often a line
  // size or a duty that is still being settled. `no-relief` carries the same
  // reasoning: a check that blocks issue on work in progress gets switched off.
  severity: 'warning',
  discipline: 'process',
  why: 'A pump cannot deliver a duty its suction line cannot bring to it. Specifying past that point is a commissioning problem found on site rather than on the drawing.',
  run(ix) {
    const out = []
    for (const s of suctionFor(ix)) {
      if (s.state !== 'insufficient') continue
      const src = s.source?.kind === 'vessel'
        ? `${s.source.tag ?? 'a vessel'} at ${s.source.levelPct ?? 0}%`
        : 'the process boundary'
      out.push(
        finding(
          pumpSuctionInsufficient,
          s.tag,
          `${s.tag} is rated ${m3h(s.ratedFlow)}${s.ratedDefaulted ? ' (assumed — no duty on its record)' : ''}, ` +
          `but its suction path from ${src} can pass at most ${m3h(s.maxFlow ?? 0)} on ` +
          `${(s.sourcePressure ?? 0).toFixed(2)} bar. At the rated flow the nozzle would sit at ` +
          `${(s.suctionAtRated ?? 0).toFixed(2)} bar absolute. ` +
          `Lower the duty, shorten or enlarge the suction, or raise the source. ` +
          `(Hydraulic capacity only — this is not an NPSH calculation; the model has no fluid, vapour pressure or elevation.)`,
        ),
      )
    }
    return out
  },
}

export const pumpSuctionUnsupplied: Rule = {
  id: 'pump-suction-unsupplied',
  title: 'Pumps whose suction reaches no source',
  severity: 'warning',
  discipline: 'process',
  why: 'A suction that connects to no vessel and no boundary has nothing to draw from. The machine has no supply at all, not merely a poor one.',
  run(ix) {
    const out = []
    for (const s of suctionFor(ix)) {
      if (s.state !== 'unsupplied') continue
      out.push(
        finding(
          pumpSuctionUnsupplied,
          s.tag,
          `${s.tag}'s suction reaches no vessel and no process boundary, so nothing can arrive at it. ` +
          `Connect the suction to its source, or terminate the line at a battery limit.`,
        ),
      )
    }
    return out
  },
}

export const PROCESS_RULES: Rule[] = [
  noRelief, lineNoService, tankCapacityDefaulted,
  pumpSuctionInsufficient, pumpSuctionUnsupplied,
]
