import { expect, test, type Page } from '@playwright/test'

async function store(page: Page) {
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

test('an engineering record survives deleting and redrawing its symbol', async ({ page }) => {
  await page.goto('/app')
  await store(page)

  // place a transmitter and tag it
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const ft = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    s.setTag(ft, { letters: 'FT', loop: '101' })
    s.setSelection([ft])
  })

  // fill in the record through the inspector
  await page.getByTestId('insp-eng').click()
  await page.getByTestId('eng-signal.range').fill('0-150 m3/h')
  await page.getByTestId('eng-general.service').fill('Feed water')
  await page.locator('.props').click()

  // delete the symbol, then redraw it with the same tag
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    s.deleteIds(s.doc.sheets[0].nodes.map((n: any) => n.id))
    const again = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 260, y: 200, rotation: 0 })
    useStore.getState().setTag(again, { letters: 'FT', loop: '101' })
    useStore.getState().setSelection([again])
  })

  await page.getByTestId('insp-eng').click()
  await expect(page.getByTestId('eng-signal.range')).toHaveValue('0-150 m3/h')
  await expect(page.getByTestId('eng-general.service')).toHaveValue('Feed water')
})

test('renaming a tag carries its record', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const pt = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    s.setTag(pt, { letters: 'PT', loop: '200' })
    s.setRecordField('PT-200', 'instrument', 'signal.range', '0-10 bar')
    s.setSelection([pt])
  })

  // rename through the tag editor on the Symbol tab
  await page.getByTestId('insp-symbol').click()
  await page.locator('.tag-loop').fill('201')
  await page.locator('.props').click()

  await page.getByTestId('insp-eng').click()
  await expect(page.getByTestId('eng-signal.range')).toHaveValue('0-10 bar')
})

test('an untagged object is told why it has no record', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const id = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 200, y: 200, rotation: 0 })
    s.setSelection([id])
  })
  await page.getByTestId('insp-eng').click()
  await expect(page.locator('.eng-untagged')).toContainText('no tag yet')
})

test('a deleted record surfaces as an orphan and can be purged', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const ft = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    s.setTag(ft, { letters: 'FT', loop: '101' })
    s.setRecordField('FT-101', 'instrument', 'signal.range', '0-150')
    useStore.getState().deleteIds([ft])
  })

  await page.getByTestId('rail-checks').click()
  const orphan = page.locator('.ws-issue', { hasText: 'engineering record' })
  await expect(orphan).toBeVisible()

  // the fix names what it does rather than saying "Fix"
  await orphan.getByRole('button', { name: 'Discard the record' }).click()
  await expect(page.locator('.ws-issue', { hasText: 'engineering record' })).toHaveCount(0)
})

/**
 * The whole point of the engineering registry, end to end.
 *
 * A value is typed ONCE, into the Engineering tab. It must then be the same
 * value in the Data workspace and in the exported CSV, because all three are
 * views of one record rather than three copies of it. If this test ever fails,
 * the product has started keeping a second copy somewhere.
 */
test('an engineering value typed once reaches the Data workspace and the CSV', async ({ page }) => {
  await page.goto('/app')
  await store(page)

  // a tagged control valve on a real drawing
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const fv = s.addNode({ symbolId: 'cv.globe', kind: 'valve', x: 240, y: 180, rotation: 0 })
    s.setTag(fv, { letters: 'FV', loop: '101' })
    s.setSelection([fv])
  })

  // 1 — ENGINEERING INPUT: type the values into the property panel, nowhere else
  await page.getByTestId('insp-eng').click()
  await page.getByTestId('eng-element.trim').fill('316 SS')
  await page.getByTestId('eng-actuation.failPosition').fill('FC')
  await page.locator('.props').click() // commit and end the undo pause

  // 2 — DATA WORKSPACE: the valve list is generated from that record
  await page.getByTestId('rail-data').click()
  await page.getByTestId('data-tab-valves').click()
  const row = page.locator('.ws-table tbody tr', { hasText: 'FV-101' })
  await expect(row).toContainText('316 SS')
  await expect(row).toContainText('FC')

  // 3 — EXPORT: the same value, in the file an engineer sends out
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('data-export').click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const csv = Buffer.concat(chunks).toString()

  expect(csv).toContain('Trim')
  expect(csv).toContain('Fail position (FC/FO/FL)')
  const valveRow = csv.split('\n').find((l) => l.startsWith('FV-101,'))
  expect(valveRow, 'the valve list CSV has a row for FV-101').toBeTruthy()
  expect(valveRow).toContain('316 SS')
  expect(valveRow).toContain('FC')
})

test('untagged equipment is listed with a blank tag rather than dropped', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    useStore.getState().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 200, y: 200, rotation: 0, label: 'Crude feed pump' })
  })

  await page.getByTestId('rail-data').click()
  await page.getByTestId('data-tab-equipment').click()
  // it is on the list — under-reporting the plant would be worse than a blank tag
  await expect(page.locator('.ws-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.ws-table tbody tr')).toContainText('Crude feed pump')
})

/**
 * The Data workspace as a data-ENTRY surface, end to end.
 *
 * Typed into a table cell, stored in the registry, and out through the export
 * — the same chain as the property panel, entered from the other end. If this
 * passes, the table is a view of the record rather than a copy of it.
 */
test('an engineering value typed into the Data table reaches the registry and the CSV', async ({ page }) => {
  await page.goto('/app')
  await store(page)

  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const p = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 220, y: 180, rotation: 0, label: 'Crude feed' })
    s.setTag(p, { letters: 'P', loop: '101' })
  })

  await page.getByTestId('rail-data').click()
  await page.getByTestId('data-tab-equipment').click()

  // type into the cell, commit with Enter
  await page.getByTestId('cell-P-101-duty.capacity').click()
  await page.getByTestId('cell-P-101-duty.capacity').fill('120 m3/h')
  await page.keyboard.press('Enter')

  // it is in the registry, which is the only place it lives
  const stored = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    return useStore.getState().doc.registry?.['P-101']?.fields['duty.capacity']
  })
  expect(stored).toBe('120 m3/h')

  // and the table shows it back
  await expect(page.locator('.ws-table tbody tr', { hasText: 'P-101' })).toContainText('120 m3/h')

  // and it is in the deliverable
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('data-export').click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  expect(Buffer.concat(chunks).toString()).toContain('120 m3/h')
})

test('a tag on the drawing is read-only in the Data table', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const ft = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    s.setTag(ft, { letters: 'FT', loop: '101' })
  })

  await page.getByTestId('rail-data').click()
  // the engineering column is a control; the Tag column is plain text
  await expect(page.getByTestId('cell-FT-101-signal.range')).toBeVisible()
  await expect(page.locator('.ws-table tbody tr td').first().locator('button')).toHaveCount(0)
})

test('the status bar reports how full the cloud copy is', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  const chip = page.getByTestId('headroom')
  await expect(chip).toBeVisible()
  // a fresh drawing is nowhere near the ceiling, and says so without alarm
  await expect(chip).toHaveAttribute('data-state', 'healthy')
  await expect(chip).toContainText('%')
})
