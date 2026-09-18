// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { finding } from '../rules'
import { edgesOf, neighboursOf } from '../../model/projectIndex'
import { boundarySignal, operatingPressure, processFor } from '../../model/processData'
import { DEFAULTS } from '../../hmi/sim/units'
import { suctionFor } from '../../model/suction'
import { TERMINAL_SYMBOLS } from '../../hmi/sim/tags'
import { buildSimModel, flowLoopCandidate, speedLoopCandidate } from '../../hmi/sim/engine'

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
      /**
       * WHAT THE NOZZLE WOULD BE AT, or what it would be SHORT BY — K34.
       *
       * A positive figure is a pressure the nozzle would actually sit at, and
       * is reported as one. A NEGATIVE figure is not: no liquid sits below
       * absolute zero, and `hydraulic/solver.ts` already rules that a negative
       * absolute pressure "must be presented as INVALID rather than as a
       * reading". So the impossible case reports the SHORTFALL — how much more
       * pressure the path would need than the source has, which is a real
       * quantity and the one a reader can act on — and says plainly that the
       * condition cannot be reached.
       *
       * K33 made this branch reachable. Before it, every source was atmosphere
       * plus a static head and a shortfall this large was rare; a pressurised
       * plant can now be specified far enough past its suction to produce one.
       */
      const at = s.suctionAtRated ?? 0
      const nozzle = at >= 0
        ? `At the rated flow the nozzle would sit at ${at.toFixed(2)} bar absolute.`
        : `At the rated flow the path would need ${Math.abs(at).toFixed(2)} bar more than `
          + `the source has, putting the nozzle below zero bar absolute — not a condition `
          + `the plant can reach.`
      out.push(
        finding(
          pumpSuctionInsufficient,
          s.tag,
          `${s.tag} is rated ${m3h(s.ratedFlow)}${s.ratedDefaulted ? ' (assumed — no duty on its record)' : ''}, ` +
          `but its suction path from ${src} can pass at most ${m3h(s.maxFlow ?? 0)} on ` +
          `${(s.sourcePressure ?? 0).toFixed(2)} bar. ${nozzle} ` +
          `Lower the duty, shorten or enlarge the suction, or raise the source. ` +
          // K31 gave the product a fluid and made density move a pump head, so
          // "the model has no fluid" became false. The CHECK still has none —
          // it is pure capacity — and that is what the disclaimer is about.
          `(Hydraulic capacity only — this is not an NPSH calculation; this check has no fluid, vapour pressure or elevation.)`,
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

/**
 * A TERMINAL THAT HAS DECLARED ITSELF AND THEN SAID NOTHING.
 *
 * An untagged free pipe end is atmospheric and needs no comment — the drawing
 * says nothing about what lies beyond it and the model reads that honestly. A
 * TERMINAL is different: someone has drawn a battery limit, tagged it, and
 * thereby asserted that this connection terminates at a known condition. If the
 * record then gives no pressure, the assertion is incomplete, and falling back
 * to atmosphere silently would hide a half-finished specification behind a
 * plausible number.
 *
 * So the fallback still happens — the plant must still solve — and this says so.
 */
export const terminalNoPressure: Rule = {
  id: 'terminal-no-pressure',
  title: 'Terminals with no stated pressure',
  severity: 'warning',
  discipline: 'process',
  why: 'A battery limit asserts that the connection ends at a known condition. Without an operating pressure on its record the simulation holds it at atmosphere, which is a guess standing where a specification should be.',
  run(ix) {
    const out = []
    const seen = new Set<string>()
    for (const screen of ix.doc.hmiScreens ?? []) {
      for (const w of screen.widgets) {
        if (!isTerminalWidget(w) || !w.tag || seen.has(w.tag)) continue
        seen.add(w.tag)
        const raw = ix.doc.registry?.[w.tag]?.fields?.['design.operatingPressure']
        if (raw !== undefined && raw.trim() !== '') continue
        out.push(finding(terminalNoPressure, w.tag,
          `${w.tag} is a terminal with no operating pressure on its record, so the simulation is holding it at ${DEFAULTS.atmosphericPressureBar} bar (atmosphere). Set Operating pressure — "3 barg" or "4 bara".`))
      }
    }
    return out
  },
}

/**
 * A terminal whose stated pressure cannot be read as one.
 *
 * Separated from the rule above because it is a different problem: the first is
 * a specification nobody finished, this is one somebody got wrong, and only the
 * second means the value on the record is actively misleading.
 */
export const terminalBadPressure: Rule = {
  id: 'terminal-bad-pressure',
  title: 'Terminals with an unreadable pressure',
  severity: 'critical',
  discipline: 'process',
  why: 'A pressure the model cannot parse is not a pressure. The simulation falls back to atmosphere, so the record and the behaviour disagree — and the record is the one people will believe.',
  run(ix) {
    const out = []
    const seen = new Set<string>()
    for (const screen of ix.doc.hmiScreens ?? []) {
      for (const w of screen.widgets) {
        if (!isTerminalWidget(w) || !w.tag || seen.has(w.tag)) continue
        seen.add(w.tag)
        const raw = ix.doc.registry?.[w.tag]?.fields?.['design.operatingPressure']
        if (raw === undefined || raw.trim() === '') continue // the other rule's case
        const bar = operatingPressure(raw)
        if (bar !== undefined && Number.isFinite(bar)) continue
        out.push(finding(terminalBadPressure, w.tag,
          `${w.tag}'s operating pressure reads "${raw}", which is not a pressure this model can use. It is being held at atmosphere instead. Give it a number and a unit — "3 barg", "4 bara", "50 psig".`))
      }
    }
    return out
  },
}

const isTerminalWidget = (w: { type: string; props?: Record<string, unknown> }): boolean =>
  w.type === 'equip' && TERMINAL_SYMBOLS.has(typeof w.props?.symbolId === 'string' ? w.props.symbolId : '')

/**
 * A TERMINAL THAT SAYS IT MOVES, AND CANNOT.
 *
 * Declaring a runtime boundary signal is an assertion that this connection
 * changes during a run. If the declaration cannot be evaluated — an unknown
 * kind, a missing end pressure, a duration that is not a duration — then the
 * boundary silently does not move, and a training scenario built around it
 * quietly does not happen. That is worth saying.
 *
 * It is `critical` rather than a warning because, unlike a missing pressure,
 * this is a statement that is WRONG rather than absent: the record describes
 * behaviour the simulation will not produce.
 */
export const terminalBadSignal: Rule = {
  id: 'terminal-bad-signal',
  title: 'Terminals whose runtime boundary signal cannot be used',
  severity: 'critical',
  discipline: 'process',
  why: 'A declared boundary signal that cannot be evaluated means the terminal stays still while its record says it moves. The scenario built around it will not happen, and nothing else would say so.',
  run(ix) {
    const out = []
    const seen = new Set<string>()
    for (const screen of ix.doc.hmiScreens ?? []) {
      for (const w of screen.widgets) {
        if (!isTerminalWidget(w) || !w.tag || seen.has(w.tag)) continue
        seen.add(w.tag)
        const sig = boundarySignal(ix.doc.registry?.[w.tag]?.fields)
        if (typeof sig !== 'string') continue // absent (static) or valid
        out.push(finding(terminalBadSignal, w.tag,
          `${w.tag} declares a runtime boundary signal that cannot be used — ${sig} It is being held at its stated operating pressure instead.`))
      }
    }
    return out
  },
}

/**
 * A DRIVE CONFIGURED ON A MACHINE THAT HAS NOT DECLARED ONE.
 *
 * `duty.minSpeed` is a turndown limit, and a turndown limit is meaningless
 * without a variable speed drive to turn down. A record carrying one without
 * `duty.vsd` has been half filled in: the machine will run fixed-speed and the
 * limit will never apply, which is the sort of thing nobody notices until a
 * scenario built around part-speed operation quietly does not happen.
 *
 * Also catches a limit that is not a percentage, because a turndown of "low"
 * is not data.
 */
export const pumpSpeedConfig: Rule = {
  id: 'pump-speed-config',
  title: 'Drive speed configured without a drive',
  severity: 'warning',
  discipline: 'process',
  why: 'A minimum speed only means something on a variable speed drive. Without one the machine runs at rated speed and the limit is never applied.',
  run(ix) {
    const out = []
    const seen = new Set<string>()
    for (const screen of ix.doc.hmiScreens ?? []) {
      for (const w of screen.widgets) {
        if (w.type !== 'pump' && w.type !== 'equip') continue
        if (!w.tag || seen.has(w.tag)) continue
        seen.add(w.tag)
        const f = ix.doc.registry?.[w.tag]?.fields
        const stated = f?.['duty.minSpeed']
        if (stated === undefined || stated.trim() === '') continue
        const proc = processFor(ix.doc.registry, w.tag)
        if (proc.minSpeedPct === undefined) {
          out.push(finding(pumpSpeedConfig, w.tag,
            `${w.tag}'s minimum speed reads "${stated}", which is not a percentage. Give it one — "20 %".`))
          continue
        }
        if (proc.minSpeedPct < 0 || proc.minSpeedPct > 100) {
          out.push(finding(pumpSpeedConfig, w.tag,
            `${w.tag}'s minimum speed is ${proc.minSpeedPct} %, which is outside 0-100 %.`))
          continue
        }
        if (proc.vsd !== true) {
          out.push(finding(pumpSpeedConfig, w.tag,
            `${w.tag} states a minimum speed of ${proc.minSpeedPct} % but does not declare a variable speed drive, so it will run at rated speed and the limit will never apply. Set "Variable speed drive" to Yes.`))
        }
      }
    }
    return out
  },
}

/**
 * A MINIMUM FLOW THAT IS NOT A FLOW.
 *
 * `duty.minFlow` is the one number K13's operating-envelope derivation
 * compares a solved flow against, and it is never derived from anything else —
 * so a record that states one the reader cannot use leaves the machine at
 * LIMIT UNKNOWN while its record looks filled in. That is the worst of both:
 * somebody has done the work and the simulator is not using it.
 *
 * Also catches the two values that cannot be true of a pump: a negative
 * minimum, and a minimum at or above the machine's own rated capacity — a
 * machine that may never be run below its duty point has no operating range at
 * all.
 */
export const pumpFlowConfig: Rule = {
  id: 'pump-min-flow-config',
  title: 'Minimum flow that cannot be used',
  severity: 'warning',
  discipline: 'process',
  why: 'A minimum-flow limit the reader cannot use is not a limit: the simulator reports the machine as having no stated minimum while the record looks complete.',
  run(ix) {
    const out = []
    const seen = new Set<string>()
    for (const screen of ix.doc.hmiScreens ?? []) {
      for (const w of screen.widgets) {
        if (w.type !== 'pump' && w.type !== 'equip') continue
        if (!w.tag || seen.has(w.tag)) continue
        seen.add(w.tag)
        const stated = ix.doc.registry?.[w.tag]?.fields?.['duty.minFlow']
        if (stated === undefined || stated.trim() === '') continue
        const proc = processFor(ix.doc.registry, w.tag)
        if (proc.minFlowM3h === undefined) {
          out.push(finding(pumpFlowConfig, w.tag,
            `${w.tag}'s minimum flow reads "${stated}", which is not a flow this model can read. Give it one — "5 m³/h".`))
          continue
        }
        if (proc.minFlowM3h < 0) {
          out.push(finding(pumpFlowConfig, w.tag,
            `${w.tag}'s minimum flow is ${proc.minFlowM3h} m³/h. A flow limit is not negative.`))
          continue
        }
        // only against a STATED capacity: `ratedFlow` falls back to a
        // simulator default, and checking a record against a default would be
        // reporting the drawing for something the drawing does not say
        const rated = ix.doc.registry?.[w.tag]?.fields?.['duty.capacity']
        if (rated !== undefined && rated.trim() !== '' && proc.ratedFlowM3h !== undefined
            && proc.minFlowM3h >= proc.ratedFlowM3h) {
          out.push(finding(pumpFlowConfig, w.tag,
            `${w.tag}'s minimum flow of ${proc.minFlowM3h} m³/h is at or above its rated capacity of ${proc.ratedFlowM3h} m³/h, which leaves it no operating range.`))
        }
      }
    }
    return out
  },
}

/**
 * A PRESSURE LOOP POINTING AT A MACHINE THAT CANNOT BE SPEED-CONTROLLED.
 *
 * K14 connects a pressure controller with no valve in its loop to the machine
 * that makes the pressure it measures — but only when that machine's record
 * DECLARES a variable speed drive. A fixed-speed pump is not quietly turned
 * into a final control element.
 *
 * The consequence of silence would be a controller that looks wired on the
 * screen, tracks its measurement, and drives nothing at all. So it is said
 * out loud, and it is said HERE rather than at runtime because it is a
 * property of the drawing and the records, not of this instant.
 *
 * `speedLoopCandidate` is the same function the wiring uses. Two
 * implementations of "which machine would this loop drive" is how a check
 * starts disagreeing with the thing it is checking.
 */
export const pumpSpeedNoDrive: Rule = {
  id: 'pump-speed-no-drive',
  title: 'Pressure loop on a fixed-speed machine',
  severity: 'warning',
  discipline: 'process',
  why: 'The controller measures the pressure this machine makes and has nothing else to drive, but the machine has no variable speed drive on its record — so the loop will track its measurement and control nothing.',
  run(ix) {
    const screens = ix.doc.hmiScreens ?? []
    if (screens.length === 0) return []
    const model = buildSimModel(screens, ix.doc.registry)
    const out = []
    for (const c of model.defs) {
      if (c.kind !== 'controller') continue
      const wired = model.controllers.find((x) => x.tag === c.name)
      // already driving something: a valve in its loop, a heater, or a drive
      if (!wired || wired.outTag !== undefined) continue
      const pvDef = model.defs.find((d) => d.name === wired.pvTag)
      if (!pvDef) continue
      // ONE question per quantity, and each is the same function the wiring
      // uses: a check that re-derives the binding is a check that drifts.
      const pressure = speedLoopCandidate(pvDef, model.defs, model.hydraulic)
      const flow = flowLoopCandidate(pvDef, model.defs, model.hydraulic)
      const cand = pressure ?? flow
      if (!cand) continue
      const what = pressure ? `the pressure ${pressure.pump} makes` : `the flow through ${flow!.pump}`
      if (flow?.ambiguous === true) {
        out.push(finding(pumpSpeedNoDrive, c.name,
          `${c.name} measures a flow that more than one machine's stream passes through, so there is no single drive for it to command. Give the loop a control valve, or a flow element on one machine's own line.`))
        continue
      }
      if (cand.vsd) continue
      out.push(finding(pumpSpeedNoDrive, c.name,
        `${c.name} measures ${what} and has no valve to throttle, but ${cand.pump} does not declare a variable speed drive — so the loop controls nothing. Set "Variable speed drive" to Yes on ${cand.pump}, or give the loop a control valve.`))
    }
    return out
  },
}

/**
 * TWO LOOPS ON ONE DRIVE.
 *
 * A machine has one speed reference. Two controllers writing it every tick is
 * not control, it is a race decided by iteration order, and the second one
 * would silently undo the first — so `buildSimModel` unwires BOTH rather than
 * picking a winner, and this is what says so. There is no defensible rule for
 * which loop should own a machine; the engineer has to choose, or build the
 * cascade this phase deliberately does not.
 */
export const pumpSpeedContended: Rule = {
  id: 'pump-speed-contended',
  title: 'Two controllers on one drive',
  severity: 'critical',
  discipline: 'process',
  why: 'A drive has one speed reference. Two loops writing it would take turns overriding each other, so neither is connected until the configuration says which one owns the machine.',
  run(ix) {
    const screens = ix.doc.hmiScreens ?? []
    if (screens.length === 0) return []
    const model = buildSimModel(screens, ix.doc.registry)
    const out = []
    // the same question `resolveContention` asks, asked of the records
    const claims = new Map<string, string[]>()
    for (const c of model.defs) {
      if (c.kind !== 'controller') continue
      const wired = model.controllers.find((x) => x.tag === c.name)
      if (!wired || wired.outTag !== undefined) continue
      const pvDef = model.defs.find((d) => d.name === wired.pvTag)
      if (!pvDef) continue
      const cand = speedLoopCandidate(pvDef, model.defs, model.hydraulic)
        ?? flowLoopCandidate(pvDef, model.defs, model.hydraulic)
      if (!cand || !cand.vsd) continue
      claims.set(cand.pump, [...(claims.get(cand.pump) ?? []), c.name])
    }
    for (const [pump, loops] of [...claims].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (loops.length < 2) continue
      out.push(finding(pumpSpeedContended, pump,
        `${loops.join(' and ')} would both command ${pump}'s speed, so neither is connected. A drive has one speed reference: give one of them a control valve, or cascade one onto the other's setpoint.`))
    }
    return out
  },
}

/**
 * A LOOP WITH NOTHING TO AIM AT, AND ONE AIMED OFF ITS OWN SCALE.
 *
 * K15 stopped inventing a setpoint of 50 for every controller. A loop takes
 * `signal.setpoint` if its record states one, else starts at its own
 * measurement — and a loop whose measurement is not bound to anything the
 * simulation produces has neither, so it holds its output and does nothing.
 * That is the honest behaviour and it is worth saying out loud, because a
 * controller that does nothing looks exactly like one that is satisfied.
 *
 * The second case is the opposite: a setpoint the record states that the
 * instrument cannot read. It is NOT clamped — an operator may legitimately ask
 * for something the plant cannot make, and the loop will saturate and say so —
 * but a setpoint five times full scale is a filled-in field, not an intention.
 */
export const controllerSetpoint: Rule = {
  id: 'controller-setpoint',
  title: 'Controller setpoint unusable',
  severity: 'warning',
  discipline: 'process',
  why: 'A loop with no setpoint holds its output and looks satisfied; a setpoint outside the transmitter range can never be reached.',
  run(ix) {
    const screens = ix.doc.hmiScreens ?? []
    if (screens.length === 0) return []
    const model = buildSimModel(screens, ix.doc.registry)
    const out = []
    for (const wired of model.controllers) {
      if (wired.outTag === undefined) continue      // drives nothing: no setpoint needed
      const cd = model.defs.find((d) => d.name === wired.tag)
      const pvDef = model.defs.find((d) => d.name === wired.pvTag)
      if (!cd || !pvDef) continue
      if (cd.setpoint !== undefined) {
        if (cd.setpoint < cd.min || cd.setpoint > cd.max) {
          out.push(finding(controllerSetpoint, wired.tag,
            `${wired.tag}'s setpoint of ${cd.setpoint} is outside its ${cd.min}-${cd.max} range, so the loop will sit against a stop. It is used as stated; nothing here changes it.`))
        }
        continue
      }
      const bound = pvDef.kind === 'tank' || pvDef.bindTank !== undefined || pvDef.bindPipe !== undefined
      if (!bound) {
        out.push(finding(controllerSetpoint, wired.tag,
          `${wired.tag} has no configured setpoint and ${wired.pvTag} is not bound to anything the simulation produces, so there is nothing to start one from. It will hold its output and move nothing. Set "Setpoint" on its record, or bind ${wired.pvTag}.`))
      }
    }
    return out
  },
}

/**
 * A DECLARED CASCADE THAT CANNOT BE BUILT.
 *
 * `signal.cascadeTo` says "my output is that loop's setpoint". When the
 * declaration cannot be honoured the master drives NOTHING — it deliberately
 * does not fall back to the drive, because that fallback is the direct
 * master → VSD shortcut cascade exists to replace, and it would put two
 * writers on one machine.
 *
 * A controller that looks wired and controls nothing is the thing worth
 * saying out loud, and it is a property of the DRAWING and the RECORDS rather
 * than of this instant — which is why it is here and not a runtime finding.
 * `wireCascade` is the one place that decides; this reports its reason
 * verbatim rather than re-deriving it.
 */
export const cascadeInvalid: Rule = {
  id: 'cascade-invalid',
  title: 'Cascade that cannot be built',
  severity: 'critical',
  discipline: 'process',
  why: 'A master whose cascade cannot be honoured drives nothing at all: it tracks its measurement, computes an output, and sends it nowhere.',
  run(ix) {
    const screens = ix.doc.hmiScreens ?? []
    if (screens.length === 0) return []
    const model = buildSimModel(screens, ix.doc.registry)
    const out = []
    for (const c of model.controllers) {
      if (c.cascadeProblem === undefined) continue
      out.push(finding(cascadeInvalid, c.tag,
        `${c.tag} is declared to cascade onto ${c.cascadeTo ?? 'another loop'}, but ${c.cascadeProblem} `
        + `The master drives nothing until this is fixed — it is NOT quietly connected to the drive instead.`))
    }
    return out
  },
}

export const PROCESS_RULES: Rule[] = [
  noRelief, lineNoService, tankCapacityDefaulted,
  pumpSuctionInsufficient, pumpSuctionUnsupplied,
  terminalNoPressure, terminalBadPressure, terminalBadSignal,
  pumpSpeedConfig, pumpFlowConfig, pumpSpeedNoDrive,
  pumpSpeedContended, controllerSetpoint, cascadeInvalid,
]
