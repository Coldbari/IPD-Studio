// @vitest-environment jsdom
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The import dialog, through the rendered UI.
 *
 * `buildChangeSet` was thoroughly tested and this component was not, which
 * meant the product could have had a perfect change-set engine behind a button
 * that did the wrong thing — or nothing. Everything here goes through the
 * actual rendered dialog and the actual Apply button.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { buildChangeSet, parseCsv } from '../../src/model/bulkEdit'
import { ENGINEERING_COLUMNS, ENGINEERING_SPEC, engineeringCsv } from '../../src/export/csv'
import ImportPreview from '../../src/panels/ImportPreview'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const st = () => useStore.getState()
const doc = () => useStore.getState().doc
const fieldsOf = (key: string) => doc().registry?.[key]?.fields ?? {}

function seed() {
  st().loadIntoStore(createEmptyDoc('t'))
  for (const [letters, loop] of [['LT', '101'], ['PT', '200']] as const) {
    const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters, loop })
  }
  st().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
  st().setRecordField('PT-200', 'instrument', 'signal.units', 'bar')
  useStore.temporal.getState().clear()
}

const csv = (rows: string[][]) => [ENGINEERING_COLUMNS.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n'
/** A row in the exporter's own column order. */
const rowFor = (key: string, over: Record<string, string> = {}): string[] => {
  const f = { ...fieldsOf(key), ...over }
  return [key, '', '', ...ENGINEERING_SPEC.slice(3).map((c) => f[c.field!] ?? '')]
}

let closed = 0
async function mount(text: string) {
  closed = 0
  const changes = buildChangeSet(doc(), parseCsv(text), ENGINEERING_SPEC)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(
    <ImportPreview changes={changes} source="edits.csv" onClose={() => { closed += 1 }} />,
  ))
  return host
}

const byTestId = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}

beforeEach(() => {
  document.body.innerHTML = ''
  seed()
})

describe('a clean import', () => {
  it('lists what will change, in engineering language', async () => {
    const host = await mount(csv([rowFor('LT-101', { 'signal.units': 'bar' }), rowFor('PT-200')]))
    const table = byTestId(host, 'imp-changes')!
    expect(table.textContent).toContain('LT-101')
    expect(table.textContent).toContain('Engineering unit')   // the label, not the key
    expect(table.textContent).toContain('bar')
    expect(byTestId(host, 'imp-summary')!.textContent).toContain('1')
  })

  it('does not touch the registry until Apply is pressed', async () => {
    const host = await mount(csv([rowFor('LT-101', { 'signal.units': 'bar' })]))
    expect(fieldsOf('LT-101')['signal.units']).toBeUndefined()
    await click(byTestId(host, 'imp-apply'))
    expect(fieldsOf('LT-101')['signal.units']).toBe('bar')
    expect(closed).toBe(1)
  })

  it('Cancel changes nothing at all', async () => {
    const host = await mount(csv([rowFor('LT-101', { 'signal.units': 'bar' })]))
    await click(byTestId(host, 'imp-cancel'))
    expect(fieldsOf('LT-101')['signal.units']).toBeUndefined()
    expect(closed).toBe(1)
  })

  it('applies every row as ONE undo step', async () => {
    const host = await mount(csv([
      rowFor('LT-101', { 'signal.units': 'bar', 'alarm.H': '8' }),
      rowFor('PT-200', { 'signal.units': 'kPa', 'signal.setpoint': '12' }),
    ]))
    await click(byTestId(host, 'imp-apply'))
    expect(fieldsOf('LT-101')['alarm.H']).toBe('8')
    expect(fieldsOf('PT-200')['signal.setpoint']).toBe('12')

    st().undo()
    expect(fieldsOf('LT-101')['alarm.H']).toBeUndefined()
    expect(fieldsOf('PT-200')['signal.setpoint']).toBeUndefined()
    st().redo()
    expect(fieldsOf('LT-101')['alarm.H']).toBe('8')
  })

  it('says plainly when there is nothing to do', async () => {
    const host = await mount(engineeringCsv(doc()))
    expect(byTestId(host, 'imp-nothing')).toBeTruthy()
    expect((byTestId(host, 'imp-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports records the file did not mention, and promises not to delete them', async () => {
    const host = await mount(csv([rowFor('LT-101', { 'signal.units': 'bar' })]))
    const note = byTestId(host, 'imp-not-included')!
    expect(note.textContent).toContain('Nothing will be deleted')
    await click(byTestId(host, 'imp-apply'))
    expect(doc().registry!['PT-200']).toBeTruthy()
  })
})

describe('a file with a problem', () => {
  const badRow = (key: string) => [key, '', '', ...ENGINEERING_SPEC.slice(3).map(() => '')]

  it('an unknown tag blocks Apply entirely', async () => {
    const host = await mount(csv([rowFor('LT-101', { 'signal.units': 'bar' }), badRow('ZZ-999')]))
    expect(byTestId(host, 'imp-problems')!.textContent).toContain('ZZ-999')
    expect((byTestId(host, 'imp-apply') as HTMLButtonElement).disabled).toBe(true)
    // and pressing it anyway changes nothing — the good row does not sneak in
    await click(byTestId(host, 'imp-apply'))
    expect(fieldsOf('LT-101')['signal.units']).toBeUndefined()
  })

  it('a bad value is named with its row and its field', async () => {
    const host = await mount(csv([rowFor('LT-101', { 'alarm.H': 'quite high' })]))
    const problems = byTestId(host, 'imp-problems')!.textContent!
    expect(problems).toContain('not a number')
    expect(problems).toContain('LT-101')
  })

  it('a wrong header refuses the file without listing changes', async () => {
    const host = await mount('Tag,Something Else\nLT-101,x\n')
    expect(byTestId(host, 'imp-problems')!.textContent).toContain('Columns do not match')
    expect(byTestId(host, 'imp-changes')).toBeNull()
  })

  it('contradictory alarm setpoints never land', async () => {
    const host = await mount(csv([rowFor('LT-101', { 'alarm.L': '90', 'alarm.H': '10' })]))
    expect(byTestId(host, 'imp-problems')!.textContent).toContain('out of order')
    expect((byTestId(host, 'imp-apply') as HTMLButtonElement).disabled).toBe(true)
  })
})
