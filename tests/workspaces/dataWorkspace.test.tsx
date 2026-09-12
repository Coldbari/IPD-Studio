// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { equipmentListCsv, instrumentIndexCsv, lineListCsv, valveListCsv } from '../../src/export/csv'
import DataWorkspace from '../../src/workspaces/DataWorkspace'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

async function mount(): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<DataWorkspace />))
  return host
}

const click = async (el: Element | null) => {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}

/** A line-number key contains a double quote (6"-CS150-…), which no CSS
 *  attribute selector survives. Match the attribute directly instead. */
function byTestId(host: HTMLElement, testid: string, tagName?: string): HTMLElement | null {
  for (const el of host.querySelectorAll('[data-testid]')) {
    if (el.getAttribute('data-testid') !== testid) continue
    if (tagName && el.tagName !== tagName) continue
    return el as HTMLElement
  }
  return null
}

const tab = async (host: HTMLElement, name: string) => click(byTestId(host, `data-tab-${name}`))

/** Open a cell, type into it, and commit the way Enter does. */
async function typeInto(host: HTMLElement, testid: string, value: string, commit: 'enter' | 'blur' | 'escape' = 'enter') {
  await click(byTestId(host, testid))
  const input = byTestId(host, testid, 'INPUT') as HTMLInputElement | null
  expect(input, `cell ${testid} should have opened an input`).toBeTruthy()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    // React's onBlur is delegated from `focusout`, which bubbles; a native
    // non-bubbling 'blur' never reaches it.
    if (commit === 'blur') input!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    else input!.dispatchEvent(new KeyboardEvent('keydown', { key: commit === 'enter' ? 'Enter' : 'Escape', bubbles: true }))
  })
}

function seed() {
  const doc = createEmptyDoc('Editable')
  doc.sheets[0]!.nodes = [
    { id: 'ft', symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } },
    { id: 'pump', symbolId: 'pump.centrifugal', kind: 'equipment', x: 80, y: 0, rotation: 0, tag: { letters: 'P', loop: '101' }, label: 'Crude feed' },
    { id: 'bare', symbolId: 'vessel.vertical', kind: 'equipment', x: 160, y: 0, rotation: 0, label: 'Untagged drum' },
    { id: 'fv', symbolId: 'cv.globe', kind: 'valve', x: 240, y: 0, rotation: 0, tag: { letters: 'FV', loop: '101' } },
  ]
  doc.sheets[0]!.edges = [
    { id: 'e1', lineClass: 'process.major', source: { nodeId: 'pump', portId: 'discharge' }, target: { nodeId: 'ft', portId: 'w' },
      lineNumber: { size: '6"', spec: 'CS150', service: 'CW', seq: '001' } },
  ]
  useStore.getState().loadIntoStore(doc)
}

beforeEach(() => {
  document.body.innerHTML = ''
  seed()
})

const registry = () => useStore.getState().doc.registry ?? {}

describe('editing writes to the registry', () => {
  it('sets a previously blank field', async () => {
    const host = await mount()
    expect(registry()['FT-101']).toBeUndefined()
    await typeInto(host, 'cell-FT-101-signal.range', '0-150 m3/h')
    expect(registry()['FT-101']!.fields['signal.range']).toBe('0-150 m3/h')
  })

  it('edits an existing value', async () => {
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', 'old')
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', 'new')
    expect(registry()['FT-101']!.fields['signal.range']).toBe('new')
  })

  it('clears a field back to empty', async () => {
    useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', 'something')
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', '')
    expect(registry()['FT-101']!.fields['signal.range']).toBe('')
    expect(instrumentIndexCsv(useStore.getState().doc)).not.toContain('something')
  })

  it('commits on blur as well as Enter', async () => {
    const host = await mount()
    await typeInto(host, 'cell-FT-101-general.service', 'Feed water', 'blur')
    expect(registry()['FT-101']!.fields['general.service']).toBe('Feed water')
  })

  it('Escape leaves the record untouched', async () => {
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', 'discard me', 'escape')
    expect(registry()['FT-101']).toBeUndefined()
  })

  // Tabbing through a table must not mint a record for every object it passes.
  it('does not create a record when the value did not change', async () => {
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', '')
    expect(registry()['FT-101']).toBeUndefined()
  })

  it('is one undo step per committed cell', async () => {
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', '0-150')
    await act(async () => useStore.getState().undo())
    expect(useStore.getState().doc.registry?.['FT-101']?.fields['signal.range']).toBeUndefined()
  })
})

describe('what may be edited', () => {
  it('offers an input for engineering columns only', async () => {
    const host = await mount()
    // an engineering field is editable
    expect(byTestId(host, 'cell-FT-101-signal.range')).toBeTruthy()
    // the tag comes from the drawing, so it is plain text with no control
    const firstCell = host.querySelector('tbody tr td')!
    expect(firstCell.querySelector('button')).toBeNull()
    expect(firstCell.textContent).toContain('FT-101')
  })

  it('does not offer editing on a row with no registry key', async () => {
    const host = await mount()
    await tab(host, 'equipment')
    // the tagged pump can be edited
    expect(byTestId(host, 'cell-P-101-duty.capacity')).toBeTruthy()
    // the untagged drum is listed, but has nowhere to hang a record
    expect(host.innerHTML).toContain('Untagged drum')
    expect(byTestId(host, 'cell-null-duty.capacity')).toBeNull()
  })

  it('marks a cell that was changed in this session', async () => {
    const host = await mount()
    expect(host.querySelector('.ws-cell.is-modified')).toBeNull()
    await typeInto(host, 'cell-FT-101-signal.range', '0-150')
    expect(host.querySelector('.ws-cell.is-modified')).toBeTruthy()
  })
})

describe('every report is editable and reaches its export', () => {
  it('instrument index', async () => {
    const host = await mount()
    await typeInto(host, 'cell-FT-101-general.manufacturer', 'Acme')
    expect(instrumentIndexCsv(useStore.getState().doc)).toContain('Acme')
  })

  it('line list', async () => {
    const host = await mount()
    await tab(host, 'lines')
    await typeInto(host, 'cell-6"-CS150-CW-001-spec.material', 'A106 Gr B')
    expect(registry()['6"-CS150-CW-001']!.kind).toBe('line')
    expect(lineListCsv(useStore.getState().doc)).toContain('A106 Gr B')
  })

  it('equipment list', async () => {
    const host = await mount()
    await tab(host, 'equipment')
    await typeInto(host, 'cell-P-101-duty.capacity', '120 m3/h')
    expect(registry()['P-101']!.kind).toBe('equipment')
    expect(equipmentListCsv(useStore.getState().doc)).toContain('120 m3/h')
  })

  it('valve list', async () => {
    const host = await mount()
    await tab(host, 'valves')
    await typeInto(host, 'cell-FV-101-actuation.failPosition', 'FC')
    expect(registry()['FV-101']!.kind).toBe('valve')
    expect(valveListCsv(useStore.getState().doc)).toContain('FC')
  })

  it('shows the edit back in the table it was typed into', async () => {
    const host = await mount()
    await tab(host, 'equipment')
    await typeInto(host, 'cell-P-101-construction.material', 'CS')
    expect(byTestId(host, 'cell-P-101-construction.material')!.textContent).toContain('CS')
  })
})

describe('the registry stays the one source of truth', () => {
  it('an edit made on the drawing shows up in the table', async () => {
    const host = await mount()
    await act(async () => {
      useStore.getState().setRecordField('FT-101', 'instrument', 'signal.range', 'from the inspector')
    })
    expect(byTestId(host, 'cell-FT-101-signal.range')!.textContent).toContain('from the inspector')
  })

  // The record is keyed by tag, so the table follows a rename exactly as the
  // report and the inspector do.
  it('follows a tag rename', async () => {
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', '0-150')
    await act(async () => {
      useStore.getState().setTag('ft', { letters: 'FT', loop: '102' })
    })
    expect(byTestId(host, 'cell-FT-102-signal.range')!.textContent).toContain('0-150')
  })

  it('reads a legacy node datasheet when there is no record yet', async () => {
    const doc = useStore.getState().doc
    const nodes = doc.sheets[0]!.nodes.map((n) => (n.id === 'ft' ? { ...n, datasheet: { 'signal.range': 'legacy' } } : n))
    await act(async () => {
      useStore.getState().loadIntoStore({ ...doc, sheets: [{ ...doc.sheets[0]!, nodes }] })
    })
    const host = await mount()
    expect(byTestId(host, 'cell-FT-101-signal.range')!.textContent).toContain('legacy')
  })

  it('an edit over a legacy value wins and is what exports', async () => {
    const doc = useStore.getState().doc
    const nodes = doc.sheets[0]!.nodes.map((n) => (n.id === 'ft' ? { ...n, datasheet: { 'signal.range': 'legacy' } } : n))
    await act(async () => {
      useStore.getState().loadIntoStore({ ...doc, sheets: [{ ...doc.sheets[0]!, nodes }] })
    })
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', 'current')
    // Assert on the ROW, not the whole file: a column header legitimately
    // carries the word "legacy" now that `general.area` is labelled as such,
    // and matching the file would make this pass or fail on a heading.
    const dataRows = instrumentIndexCsv(useStore.getState().doc).split('\n').slice(1)
    const ft = dataRows.find((r) => r.startsWith('FT-101,'))!
    expect(ft).toContain('current')
    expect(ft).not.toContain('legacy')
  })

  // Two symbols wearing one tag are one engineering object drawn twice; both
  // cells address the same record, which is the correct behaviour and the
  // reason the duplicate tag itself is a QA finding rather than hidden here.
  it('a duplicate tag edits one shared record', async () => {
    const doc = useStore.getState().doc
    const twin = { ...doc.sheets[0]!.nodes[0]!, id: 'ft2', x: 300 }
    await act(async () => {
      useStore.getState().loadIntoStore({
        ...doc,
        sheets: [{ ...doc.sheets[0]!, nodes: [...doc.sheets[0]!.nodes, twin] }],
      })
    })
    const host = await mount()
    await typeInto(host, 'cell-FT-101-signal.range', 'shared')
    expect(Object.keys(registry())).toEqual(['FT-101'])
    expect(host.querySelectorAll('.ws-cell.is-modified').length).toBeGreaterThanOrEqual(2)
  })
})
