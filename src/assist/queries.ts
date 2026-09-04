// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { ProjectIndex } from '../model/projectIndex'
import { edgesOf, signalReach } from '../model/projectIndex'
import { isPortEnd } from '../model/types'
import { fieldKeysFor } from '../model/fields'
import { fmtMoney, unitCost } from '../model/costs'
import { qaFor } from '../validate/engine'
import { validateLetters, expandLetters } from '../isa/tag'
import { TYPICALS } from './typicals'
import { refOf, type SelectionBrief } from './context'
import { answer, gap, type Answer, type AnswerRow } from './answer'

/**
 * The questions the document can answer on its own.
 *
 * Every function here is a query, not a generation: exact, instant, and unable
 * to name an object that is not on a sheet. Roughly half of what an engineer
 * asks lands in this file, which is why it exists before any model does.
 *
 * The standing rule is that nothing here re-derives domain logic. Loops come
 * from the index, findings from `qaFor`, letters from the ISA tables, prices
 * from the cost table. Two implementations of "has relief" is how the
 * assistant and the Checks workspace start disagreeing.
 */

function row(ix: ProjectIndex, id: string, note?: string, tone?: AnswerRow['tone']): AnswerRow | null {
  const sheetId = ix.nodes.get(id)?.sheet.id ?? ix.edges.get(id)?.sheet.id
  if (!sheetId) return null
  return { id, sheetId, ref: refOf(ix, id), ...(note ? { note } : {}), ...(tone ? { tone } : {}) }
}

const rows = (ix: ProjectIndex, ids: string[], note?: string, tone?: AnswerRow['tone']): AnswerRow[] =>
  ids.map((id) => row(ix, id, note, tone)).filter((r): r is AnswerRow => r !== null)

const NEEDS_LOOP = 'Select a tagged instrument first — I answer this about the loop it belongs to.'

/** 1. Is this loop complete? */
export function loopComplete(ix: ProjectIndex, brief: SelectionBrief): Answer {
  const loop = brief.loop
  if (!loop) return gap('No loop selected.', NEEDS_LOOP)

  const template = TYPICALS.find((t) => t.members[0]?.[0] === loop.family)
  const missing: string[] = []
  if (!loop.roles.transmitter.length && !loop.roles.element.length) missing.push('a measurement')
  if (!loop.roles.controller.length && !loop.roles.indicator.length) missing.push('a receiver (indicator or controller)')
  if (loop.roles.controller.length && !loop.roles.final.length) missing.push('a final control element')

  const memberRows: AnswerRow[] = []
  for (const m of loop.members) {
    const r = row(ix, m.id, roleOf(loop, m.ref))
    if (r) memberRows.push(r)
  }

  const headline = missing.length === 0
    ? `Loop ${loop.ref} looks complete — ${loop.members.length} members.`
    : `Loop ${loop.ref} is missing ${missing.join(' and ')}.`

  const withTemplate = template
    ? `${headline} A ${template.name.toLowerCase()} usually reads ${template.members.join(' → ')}.`
    : headline

  return answer(withTemplate, memberRows)
}

function roleOf(loop: NonNullable<SelectionBrief['loop']>, ref: string): string | undefined {
  for (const [role, refs] of Object.entries(loop.roles)) if (refs.includes(ref)) return role
  return undefined
}

/** 2. What is this controlling? */
export function whatControls(ix: ProjectIndex, brief: SelectionBrief): Answer {
  const f = brief.focus
  if (f?.objectType !== 'node') return gap('Nothing selected.', 'Select an instrument.')
  const reached = [...signalReach(ix, f.id, 3)]
  const finals = reached.filter((id) => ix.nodes.get(id)?.node.kind === 'valve')
  if (finals.length === 0) {
    return answer(
      `Nothing final is wired to ${f.ref} within three signal hops.`,
      rows(ix, reached, 'on the signal chain'),
    )
  }
  const untagged = finals.filter((id) => !ix.nodes.get(id)?.node.tag?.loop)
  const note = untagged.length
    ? ` ${untagged.length} of them ${untagged.length === 1 ? 'is' : 'are'} untagged, so I can only name ${untagged.length === 1 ? 'it' : 'them'} by label.`
    : ''
  return answer(`${f.ref} drives ${finals.length} final element${finals.length === 1 ? '' : 's'}.${note}`, rows(ix, finals, 'final element'))
}

/** 3. What is downstream of this? Adjacency is exact; direction usually is not. */
export function downstreamOf(ix: ProjectIndex, brief: SelectionBrief): Answer {
  const f = brief.focus
  if (!f) return gap('Nothing selected.', 'Select a component or a line.')

  if (f.objectType === 'edge') {
    const { arrowsMarked, arrowsTotal } = f.run
    const ends = [f.from, f.to].filter((r): r is NonNullable<typeof r> => Boolean(r))
    return answer(
      arrowsMarked === arrowsTotal && arrowsTotal > 0
        ? `Flow is marked on this whole run, so direction is known.`
        : `Adjacency only — ${arrowsMarked} of ${arrowsTotal} lines in this run carry a flow arrow, so I cannot tell you direction.`,
      ends.map((e) => ({ ...e, note: 'connected' })),
    )
  }

  const touching = edgesOf(ix, f.id).filter((e) => !e.lineClass.startsWith('signal'))
  const marked = touching.filter((e) => e.arrow === 'flow').length
  const others: string[] = []
  for (const e of touching) {
    for (const end of [e.source, e.target]) {
      if (isPortEnd(end) && end.nodeId !== f.id) others.push(end.nodeId)
    }
  }
  return answer(
    marked === touching.length && touching.length > 0
      ? `${f.ref} connects to ${others.length} object${others.length === 1 ? '' : 's'}, and every line is direction-marked.`
      : `${f.ref} connects to ${others.length} object${others.length === 1 ? '' : 's'} — this is adjacency, not direction: ${marked} of ${touching.length} lines carry a flow arrow.`,
    rows(ix, others, 'connected'),
  )
}

/** 4. What instruments are on this line? */
export function onThisLine(ix: ProjectIndex, brief: SelectionBrief): Answer {
  const f = brief.focus
  if (f?.objectType !== 'edge') return gap('No line selected.', 'Select a process line first.')
  const seen = new Set<string>()
  for (const id of f.run.edgeIds) {
    const e = ix.edges.get(id)?.edge
    if (!e) continue
    for (const end of [e.source, e.target]) if (isPortEnd(end)) seen.add(end.nodeId)
  }
  const list = [...seen]
  return answer(`${list.length} object${list.length === 1 ? '' : 's'} sit on this run of ${f.run.edgeIds.length} line${f.run.edgeIds.length === 1 ? '' : 's'}.`, rows(ix, list))
}

/** 5. Which loops are missing a controller? */
export function loopsMissingController(ix: ProjectIndex): Answer {
  const out: AnswerRow[] = []
  for (const loop of ix.loops) {
    const hasController = loop.members.some((m) => m.tag.letters.includes('C') && !m.tag.letters.endsWith('V'))
    const hasMeasure = loop.members.some((m) => /[TE]/.test(m.tag.letters))
    if (hasMeasure && !hasController) {
      const first = loop.members[0]
      const r = first ? row(ix, first.nodeId, `loop ${loop.family}-${loop.loop}`, 'warn') : null
      if (r) out.push(r)
    }
  }
  return answer(
    out.length === 0 ? 'Every measured loop has a receiver.' : `${out.length} loop${out.length === 1 ? '' : 's'} measure something with no controller.`,
    out,
  )
}

/** 6. Why did that finding fire? Pure retrieval over the rule's own words. */
export function whyFinding(ix: ProjectIndex, brief: SelectionBrief): Answer {
  if (brief.findings.length === 0) return answer('Nothing is flagged against this selection.')
  const report = qaFor(ix.doc)
  const lines: string[] = []
  const out: AnswerRow[] = []
  for (const f of brief.findings) {
    const group = report.groups.find((g) => g.rule.id === f.ruleId)
    if (group) lines.push(`${group.rule.title}: ${group.rule.why ?? f.message}`)
    if (f.targetId) {
      const r = row(ix, f.targetId, f.message, f.severity === 'critical' ? 'warn' : 'gap')
      if (r) out.push(r)
    }
  }
  return answer(lines.join(' · ') || 'See the findings below.', out)
}

/** 7. Is this tag ISA-legal? Quotes the validator; never re-derives the rule. */
export function tagLegal(_ix: ProjectIndex, brief: SelectionBrief): Answer {
  const f = brief.focus
  if (f?.objectType !== 'node' || !f.tag) {
    return gap('No tag to check.', 'Select a tagged instrument.')
  }
  const v = validateLetters(f.tag.letters)
  return answer(
    v.ok
      ? `${f.tag.text} is valid — ${expandLetters(f.tag.letters)}.`
      : `${f.tag.text} is not valid: ${v.reason}`,
  )
}

/** 8. Does this vessel have relief? Delegates to the rule; never re-walks. */
export function hasRelief(ix: ProjectIndex, brief: SelectionBrief): Answer {
  const f = brief.focus
  if (!f) return gap('Nothing selected.', 'Select a vessel.')
  const hit = brief.findings.find((x) => x.ruleId === 'no-relief' && x.targetId === f.id)
  if (hit) return answer(hit.message, rows(ix, [f.id], 'no relief device', 'warn'))
  return answer(`Nothing is flagged about relief on ${f.ref}.`, rows(ix, [f.id]))
}

/** 9. What is the calibrated range / is anything specified? Retrieval only. */
export function withoutDatasheet(ix: ProjectIndex): Answer {
  const out: AnswerRow[] = []
  for (const entry of ix.allNodes) {
    const { key, kind } = entry
    if (!key || !kind) continue
    const total = fieldKeysFor(kind).length
    const fields = ix.records[key]?.fields ?? {}
    const filled = Object.keys(fields).filter((k) => fields[k]).length
    if (filled === 0 && total > 0) {
      const r = row(ix, entry.node.id, 'no engineering record', 'gap')
      if (r) out.push(r)
    }
  }
  return answer(
    out.length === 0 ? 'Every tagged object has something on its record.' : `${out.length} tagged object${out.length === 1 ? '' : 's'} ${out.length === 1 ? 'has' : 'have'} no engineering data yet.`,
    out,
  )
}

/** 10. How much does this loop cost? */
export function loopCost(ix: ProjectIndex, brief: SelectionBrief): Answer {
  const loop = brief.loop
  if (!loop) return gap('No loop selected.', NEEDS_LOOP)
  let total = 0
  const out: AnswerRow[] = []
  for (const m of loop.members) {
    const node = ix.nodes.get(m.id)?.node
    if (!node) continue
    const cost = unitCost(node, ix.doc.budget)
    total += cost
    const r = row(ix, m.id, fmtMoney(cost))
    if (r) out.push(r)
  }
  return answer(`Loop ${loop.ref} totals ${fmtMoney(total)} in budgetary hardware across ${out.length} item${out.length === 1 ? '' : 's'}.`, out)
}

/** 11. Does the HMI screen for this loop show everything it should? */
export function hmiCoverage(ix: ProjectIndex, brief: SelectionBrief): Answer {
  const loop = brief.loop
  if (!loop) return gap('No loop selected.', NEEDS_LOOP)
  const bound = new Set<string>()
  for (const screen of ix.doc.hmiScreens) {
    for (const w of screen.widgets) if (w.tag) bound.add(w.tag)
  }
  if (bound.size === 0) return gap(`No HMI screens carry bound tags yet.`, 'Build or import an HMI screen first.')
  const unbound = loop.members.filter((m) => !bound.has(m.ref))
  const unboundRows: AnswerRow[] = []
  for (const m of unbound) {
    const r = row(ix, m.id, 'not on an HMI screen', 'gap')
    if (r) unboundRows.push(r)
  }
  return answer(
    unbound.length === 0
      ? `Every member of ${loop.ref} appears on an HMI screen.`
      : `${unbound.length} of ${loop.members.length} members of ${loop.ref} are not on any HMI screen.`,
    unboundRows,
  )
}

/** Everything that is legitimately unanswerable, answered honestly. */
export function unanswerable(topic: 'psv-sizing' | 'revision' | 'interlock' | 'hazard'): Answer {
  switch (topic) {
    case 'psv-sizing':
      return gap(
        'The drawing does not hold what sizing needs.',
        'Relieving load, orifice designation, set pressure and back-pressure are not fields in the valve catalog.',
        'valve.size',
      )
    case 'revision':
      return gap('There is no revision history to compare.', 'Revisions are not stored yet — sheet.revision is only a label.')
    case 'interlock':
      return gap('Trip logic is not captured in the model.', 'Cause-and-effect relationships have no home in the document yet.')
    case 'hazard':
      return gap(
        'I will not produce a hazard assessment from this drawing.',
        'Composition, inventory, ignition sources, layout and any HAZOP data are all absent. I can list the service, design conditions and relief devices that ARE recorded.',
      )
  }
}
