// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule, RuleFinding } from '../rules'
import { finding } from '../rules'
import { labelForField } from '../../model/fields'
import { requiredFor } from '../../model/standard'
import { collectHmiBindings } from '../../model/references'
import { recordFieldValue } from '../../model/hierarchy'
import { danglingNozzlePorts, duplicateNozzleNumbers, duplicateNozzlePorts } from '../../model/nozzle'
import { portIdsOfKey } from '../../model/projectIndex'

export const orphanRecord: Rule = {
  id: 'orphan-record',
  title: 'Engineering records with nothing on a sheet',
  severity: 'warning',
  discipline: 'data',
  why: 'Deleting a symbol deliberately leaves its record behind. This is where you decide whether to redraw it or discard the record.',
  run(ix) {
    const out = []
    for (const key of Object.keys(ix.records)) {
      if (ix.liveKeys.has(key)) continue
      const unassigned = key.startsWith('__unassigned:')
      out.push(
        finding(
          orphanRecord,
          key,
          unassigned
            ? 'A record was imported from an untagged symbol — tag the symbol to reunite them'
            : `${key} has an engineering record but nothing on any sheet carries that tag`,
          {
            fix: { label: 'Discard the record', spec: { kind: 'purge-record', key } },
          },
        ),
      )
    }
    return out
  },
}

/**
 * The HMI twin of `orphanRecord`, and the check that closes the rename defect.
 *
 * A widget bound to a tag nothing on any sheet carries still renders — it just
 * reads nothing, for ever, and says so nowhere. That is how a deleted or
 * cleared instrument leaves a dead faceplate on an operator screen.
 *
 * Checked against `liveKeys` — the tags actually DRAWN — and deliberately not
 * against the registry. An engineering record is optional: most drawings carry
 * bindings to perfectly valid tags that nobody has written a datasheet for yet.
 * Testing the registry would report all 12 bindings of the bundled HMI demo,
 * which has no records at all, and a check that fires on the sample project is
 * a check that gets switched off.
 *
 * One finding per BINDING, not per tag: the same missing tag read by four
 * widgets is four separate repairs, and accepting one must not silence the
 * other three. Hence the explicit `key`.
 */
export const orphanedBinding: Rule = {
  id: 'orphaned-binding',
  title: 'HMI widgets bound to tags that are not on any sheet',
  severity: 'warning',
  discipline: 'data',
  why: 'The widget still draws, reads nothing, and never says so. This is what a deleted or renamed instrument leaves behind on an operator screen.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const b of collectHmiBindings(ix.doc)) {
      // liveKeys is a Set — one O(1) test per binding, no registry rescan.
      if (ix.liveKeys.has(b.tag)) continue
      const slot = b.where === 'hmi-pen' ? `pen${b.path.penIndex}` : b.path.field ?? 'tag'
      out.push(
        finding(orphanedBinding, b.tag, `${b.label} reads ${b.tag}, which nothing on any sheet carries`, {
          // Per-binding identity, so each is accepted or repaired on its own.
          // Widget ids are stable for the life of a screen; a re-import
          // rebuilds the bindings anyway, so an acceptance has nothing to
          // survive.
          key: `${orphanedBinding.id}:${b.tag}@${b.path.screenId}/${b.path.widgetId}/${slot}`,
          fix: {
            label: 'Clear the binding',
            spec: {
              kind: 'clear-binding',
              screenId: b.path.screenId,
              widgetId: b.path.widgetId,
              where: b.where,
              tag: b.tag,
              ...(b.path.field ? { field: b.path.field } : {}),
              ...(b.path.penIndex !== undefined ? { penIndex: b.path.penIndex } : {}),
            },
          },
        }),
      )
    }
    return out
  },
}

export const requiredFieldEmpty: Rule = {
  id: 'required-field-empty',
  title: 'Incomplete engineering records',
  severity: 'warning',
  discipline: 'data',
  why: 'These are the fields a datasheet, an I/O list or a purchase enquiry cannot be produced without.',
  run(ix) {
    const out = []
    for (const [key, group] of ix.nodesByKey) {
      const first = group[0]!
      if (!first.kind) continue
      const required = requiredFor(ix.standard, first.kind)
      if (!required.length) continue
      const record = ix.records[key]
      // Only nag about a record someone has STARTED. Firing on every tagged
      // object of a drawing that predates the registry buries the report under
      // a wall of identical warnings — measured at 11-13 on the bundled
      // samples — and an object nobody has begun specifying is not yet an
      // omission. Overall completeness is the dashboard's job, not the QA
      // report's.
      const started = record && (record.unitId !== undefined || Object.values(record.fields).some((v) => v.trim() !== ''))
      if (!started) continue
      const missing = required.filter((f) => {
        // Through the one accessor that knows a Unit assignment is a reference
        // on the record rather than a string in `fields` — so a standard that
        // requires a Unit is checked by this rule and no second one.
        const value = recordFieldValue(record, f) || first.node.datasheet?.[f] || ''
        return value.trim() === ''
      })
      if (!missing.length) continue
      out.push(
        finding(requiredFieldEmpty, key, `${key} is missing ${missing.map(labelForField).join(', ')}`, {
          targetId: first.node.id,
          sheetId: first.sheet.id,
        }),
      )
    }
    return out
  },
}

export const equipmentNoRecord: Rule = {
  id: 'equipment-no-record',
  title: 'Untagged equipment',
  severity: 'info',
  discipline: 'data',
  why: 'Equipment has to be tagged before it can carry a record, appear in the equipment list, or be bought.',
  run(ix) {
    const out = []
    for (const n of ix.allNodes) {
      if (n.kind !== 'equipment' || n.key) continue
      const name = n.node.label?.trim()
      out.push(
        finding(equipmentNoRecord, n.node.id, name ? `"${name}" has no tag, so it carries no record` : 'This equipment has no tag, so it carries no record', {
          targetId: n.node.id,
          sheetId: n.sheet.id,
        }),
      )
    }
    return out
  },
}

/* --------------------------------------------------------------- nozzles */

/**
 * THE THREE NOZZLE CHECKS, and the long list of ones deliberately absent.
 *
 * All three are deterministic statements about what the document says about
 * ITSELF — two nozzles wearing one number, two claiming one port, a port that
 * is not on the symbol. None of them reads a line, a service, a piping class
 * or a port side, because a nozzle's size, rating, facing and service are
 * typed by an engineer and nothing in the drawing establishes them. There is
 * deliberately no rule saying a nozzle should be an inlet, should match the
 * line size, or should exist at all because a symbol has a port.
 *
 * A nozzle on an ORPHANED record is not reported here either. The record
 * outliving its symbol is `orphan-record`'s finding, and saying it again per
 * nozzle would bury it.
 */
export const nozzleDuplicateNumber: Rule = {
  id: 'nozzle-duplicate-number',
  title: 'Nozzles sharing a number',
  // Critical, and the twin of `duplicate-tag`: two nozzles called N2 on one
  // vessel cannot both be fabricated, inspected or bought against that number.
  severity: 'critical',
  discipline: 'data',
  why: 'Two nozzles on one piece of equipment sharing a number cannot both be specified or fabricated.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const key of Object.keys(ix.records).sort()) {
      const record = ix.records[key]
      for (const [, group] of [...duplicateNozzleNumbers(record)].sort(([a], [b]) => a.localeCompare(b))) {
        const number = group[0]!.number
        out.push(
          finding(nozzleDuplicateNumber, `${key}/${number}`, `${key} has ${group.length} nozzles numbered ${number}`, {
            ...anchorOf(ix, key),
          }),
        )
      }
    }
    return out
  },
}

export const nozzleDuplicatePort: Rule = {
  id: 'nozzle-duplicate-port',
  title: 'Nozzles claiming one connection point',
  // A warning rather than critical: the drawing may be mid-edit, and the
  // engineering data is not wrong — two nozzles simply cannot be at the same
  // point on the symbol.
  severity: 'warning',
  discipline: 'data',
  why: 'Two nozzles cannot be at the same connection point on the symbol.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const key of Object.keys(ix.records).sort()) {
      const record = ix.records[key]
      for (const [portId, group] of [...duplicateNozzlePorts(record)].sort(([a], [b]) => a.localeCompare(b))) {
        const numbers = group.map((n) => n.number).sort().join(', ')
        out.push(
          finding(nozzleDuplicatePort, `${key}/${portId}`, `${key}: nozzles ${numbers} all claim connection point ${portId}`, {
            ...anchorOf(ix, key),
          }),
        )
      }
    }
    return out
  },
}

export const nozzlePortMissing: Rule = {
  id: 'nozzle-port-missing',
  title: 'Nozzles pointing at a connection point that is gone',
  // Warning, not critical: the NOZZLE is still good engineering data. What is
  // broken is where it says it sits, and nothing is repaired automatically —
  // remapping it to a port that merely looks similar is the guess this
  // refuses to make.
  severity: 'warning',
  discipline: 'data',
  why: 'A nozzle naming a connection point the symbol does not have cannot be located on the drawing.',
  run(ix) {
    const out: RuleFinding[] = []
    for (const key of Object.keys(ix.records).sort()) {
      const drawn = ix.nodesByKey.get(key)
      // Nothing drawn wears this key, so there are no ports to check against.
      // `orphan-record` is what reports that, and it reports it once.
      if (!drawn?.length) continue
      // The shared answer to "which ports does this tag currently have",
      // rather than a third private reconstruction of it.
      const available = portIdsOfKey(ix, key)
      for (const nozzle of danglingNozzlePorts(ix.records[key], available).sort((a, b) => a.number.localeCompare(b.number))) {
        out.push(
          finding(nozzlePortMissing, `${key}/${nozzle.number}`, `${key} nozzle ${nozzle.number} points at connection point ${nozzle.portId}, which this symbol does not have`, {
            ...anchorOf(ix, key),
            // ACCEPTANCE IS KEYED ON THE ULID, not on the number above.
            //
            // The two are different jobs. `entityKey` names the object for a
            // person — it prints in the conformance report's Object column, and
            // a ULID there is unreadable. This key is what an acceptance is
            // filed under, and a number is what an engineer RENUMBERS: keying
            // on it means renumbering N1 to N9 strands the acceptance and
            // re-opens a finding about an unchanged breakage. The nozzle has a
            // stable identity, so the acceptance uses it.
            //
            // The two rules either side of this one keep number- and port-based
            // keys deliberately: each is ABOUT the value it keys on, so
            // changing that value genuinely is a different finding.
            key: `${nozzlePortMissing.id}:${key}/${nozzle.id}`,
          }),
        )
      }
    }
    return out
  },
}

/** Where a nozzle finding points: the first drawn object wearing the key, so
 *  the report can jump to something. Absent when nothing is drawn. */
function anchorOf(ix: Parameters<Rule['run']>[0], key: string): { targetId?: string; sheetId?: string } {
  const first = ix.nodesByKey.get(key)?.[0]
  return first ? { targetId: first.node.id, sheetId: first.sheet.id } : {}
}

export const DATA_RULES: Rule[] = [
  orphanRecord,
  orphanedBinding,
  requiredFieldEmpty,
  equipmentNoRecord,
  nozzleDuplicateNumber,
  nozzleDuplicatePort,
  nozzlePortMissing,
]
