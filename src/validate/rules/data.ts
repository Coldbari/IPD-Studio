// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule, RuleFinding } from '../rules'
import { finding } from '../rules'
import { labelForField } from '../../model/fields'
import { requiredFor } from '../../model/standard'
import { collectHmiBindings } from '../../model/references'
import { recordFieldValue } from '../../model/hierarchy'

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

export const DATA_RULES: Rule[] = [orphanRecord, orphanedBinding, requiredFieldEmpty, equipmentNoRecord]
