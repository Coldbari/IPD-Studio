// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-3 — retiring the free-text field that WAS the nozzle schedule.
 *
 * `construction.connections` was labelled "Nozzle schedule" when it was the
 * only nozzle data in the product. It now sits directly above a structured
 * schedule of the same name, which is two answers to one question.
 *
 * Retired exactly as `general.area` was: the KEY never moves, no value is ever
 * migrated or deleted, the column still exports. What is withdrawn is the
 * invitation to type more into it.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { LEGACY_AREA_FIELD } from '../../src/model/hierarchy'
import { LEGACY_CONNECTIONS_FIELD, labelForField } from '../../src/model/fields'
import { EQUIPMENT_LIST_COLUMNS, equipmentListCsv, equipmentListRows } from '../../src/export/csv'
import InspectorEngineering from '../../src/panels/InspectorEngineering'
import type { PlantNode } from '../../src/model/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const doc = () => st().doc
const q = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)

async function mount(node: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(node))
  return host
}

/** A tagged vessel carrying a value typed into the legacy field long ago. */
function seeded(value = '3 off 6" N1/N2/N3, 1 off 2" drain'): PlantNode {
  st().loadIntoStore(createEmptyDoc('legacy'))
  const id = st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0 })
  st().setTag(id, { letters: 'TK', loop: '101' })
  st().setRecordField('TK-101', 'equipment', LEGACY_CONNECTIONS_FIELD, value)
  return doc().sheets[0]!.nodes.find((n) => n.id === id)!
}

beforeEach(() => { st().loadIntoStore(createEmptyDoc('legacy')) })

describe('the value is preserved', () => {
  it('keeps the key exactly where it was', () => {
    expect(LEGACY_CONNECTIONS_FIELD).toBe('construction.connections')
  })

  it('survives in the record, untouched', () => {
    seeded()
    expect(doc().registry!['TK-101']!.fields[LEGACY_CONNECTIONS_FIELD]).toBe('3 off 6" N1/N2/N3, 1 off 2" drain')
  })

  it('survives a RETAG, like every other engineering value', () => {
    const node = seeded()
    st().setTag(node.id, { letters: 'TK', loop: '201' })
    expect(doc().registry!['TK-201']!.fields[LEGACY_CONNECTIONS_FIELD]).toBe('3 off 6" N1/N2/N3, 1 off 2" drain')
  })

  it('is NOT migrated into the structured schedule — that would be inventing nozzles', () => {
    seeded()
    expect(doc().registry!['TK-101']!.nozzles).toBeUndefined()
  })
})

describe('the value still exports', () => {
  it('is still a column of the equipment list, at the position it has always had', () => {
    seeded()
    const i = EQUIPMENT_LIST_COLUMNS.indexOf(labelForField(LEGACY_CONNECTIONS_FIELD))
    expect(i).toBeGreaterThan(-1)
    expect(equipmentListRows(doc())[0]!.cells[i]).toBe('3 off 6" N1/N2/N3, 1 off 2" drain')
    expect(equipmentListCsv(doc())).toContain('3 off 6"" N1/N2/N3, 1 off 2"" drain')
  })

  it('is still editable there — nothing is locked, only relabelled', () => {
    seeded()
    const i = EQUIPMENT_LIST_COLUMNS.indexOf(labelForField(LEGACY_CONNECTIONS_FIELD))
    // A column the Data workspace can edit is one carrying a `field`.
    expect(EQUIPMENT_LIST_COLUMNS[i]).toBe('Connections (legacy text)')
  })

  it('no longer heads a column called "Nozzle schedule"', () => {
    // There is a real Nozzle schedule now, and it is its own report.
    expect(EQUIPMENT_LIST_COLUMNS).not.toContain('Nozzle schedule')
  })
})

describe('the Inspector no longer offers it as the schedule', () => {
  it('labels it as legacy text, and no field is labelled "Nozzle schedule" any more', async () => {
    const host = await mount(<InspectorEngineering node={seeded()} />)
    const labels = [...host.querySelectorAll('.eng-field span')].map((el) => el.textContent)
    expect(labels).toContain('Connections (legacy text)')
    // The phrase still appears once, inside the hint that points AT the real
    // schedule — what must not exist is a second control wearing the name.
    expect(labels).not.toContain('Nozzle schedule')
  })

  it('says in words that it is not the nozzle schedule, and where the real one is', async () => {
    const host = await mount(<InspectorEngineering node={seeded()} />)
    const note = q(host, 'eng-legacy-connections-note')!
    expect(note.textContent).toContain('not')
    expect(note.textContent).toContain('Nozzles')
    expect(note.textContent).toContain('nothing typed before is lost')
  })

  it('still shows the typed value and still accepts an edit', async () => {
    const host = await mount(<InspectorEngineering node={seeded()} />)
    const input = q(host, `eng-${LEGACY_CONNECTIONS_FIELD}`) as HTMLInputElement
    expect(input.value).toBe('3 off 6" N1/N2/N3, 1 off 2" drain')
    expect(input.disabled).toBe(false)
  })

  it('dims it, the same signal the legacy area field carries', async () => {
    const host = await mount(<InspectorEngineering node={seeded()} />)
    expect(q(host, `eng-${LEGACY_CONNECTIONS_FIELD}`)!.className).toContain('eng-legacy')
  })

  it('leaves the structured Nozzles section exactly where it was, below it', async () => {
    const host = await mount(<InspectorEngineering node={seeded()} />)
    const legacy = q(host, `eng-${LEGACY_CONNECTIONS_FIELD}`)!
    const nozzles = q(host, 'eng-nozzles')!
    expect(nozzles).not.toBeNull()
    expect(legacy.compareDocumentPosition(nozzles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the other legacy field is unchanged', () => {
  it('still carries its own note and its own wording', async () => {
    st().loadIntoStore(createEmptyDoc('legacy'))
    const id = st().addNode({ symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters: 'TK', loop: '101' })
    st().setRecordField('TK-101', 'equipment', LEGACY_AREA_FIELD, 'Reactor')
    const host = await mount(<InspectorEngineering node={doc().sheets[0]!.nodes.find((n) => n.id === id)!} />)
    expect(q(host, 'eng-legacy-area-note')!.textContent).toContain('Unit')
    expect(doc().registry!['TK-101']!.fields[LEGACY_AREA_FIELD]).toBe('Reactor')
  })
})
