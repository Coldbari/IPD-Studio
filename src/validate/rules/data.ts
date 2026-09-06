// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { Rule } from '../rules'
import { finding } from '../rules'
import { labelForField } from '../../model/fields'
import { requiredFor } from '../../model/standard'

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
      const started = record && Object.values(record.fields).some((v) => v.trim() !== '')
      if (!started) continue
      const missing = required.filter((f) => {
        const value = record?.fields[f] ?? first.node.datasheet?.[f] ?? ''
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

export const DATA_RULES: Rule[] = [orphanRecord, requiredFieldEmpty, equipmentNoRecord]
