import { expect, test, type Page } from '@playwright/test'

/**
 * The P1-C round trip, through the browser and the real controls.
 *
 * The change-set engine has thorough unit tests; until this spec existed,
 * nothing proved a user could reach it. Everything here goes through the
 * actual Export button, the actual file input, the actual preview dialog and
 * the actual Apply — no store calls standing in for a click.
 */

async function ready(page: Page) {
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

/** Two tagged instruments with engineering records. */
async function seed(page: Page) {
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    for (const [letters, loop] of [['LT', '101'], ['PT', '200']]) {
      const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 120, y: 120, rotation: 0 })
      useStore.getState().setTag(id, { letters, loop })
    }
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
    useStore.getState().setRecordField('PT-200', 'instrument', 'signal.units', 'bar')
  })
}

const registry = (page: Page) =>
  page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    return useStore.getState().doc.registry as Record<string, { fields: Record<string, string> }>
  })

test('export for editing, change it, import it back, apply, undo', async ({ page }) => {
  await page.goto('/app')
  await ready(page)
  await seed(page)
  await page.getByTestId('rail-data').click()

  // --- EXPORT, through the button, capturing the real file ----------------
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('data-export-engineering').click(),
  ]).then(([d]) => d)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const exported = Buffer.concat(chunks).toString('utf8')

  const header = exported.split('\n')[0]!
  expect(header.startsWith('Tag,Area,Unit,')).toBe(true)
  expect(exported).toContain('LT-101')

  // --- EDIT it the way a spreadsheet would --------------------------------
  const unitsCol = header.split(',').indexOf('Engineering unit')
  expect(unitsCol).toBeGreaterThan(0)
  const edited = exported
    .split('\n')
    .map((line, i) => {
      if (i === 0 || !line.startsWith('LT-101,')) return line
      const cells = line.split(',')
      cells[unitsCol] = 'barg'
      return cells.join(',')
    })
    .join('\n')

  // --- IMPORT through the real file input ---------------------------------
  await page.getByTestId('data-import-file').setInputFiles({
    name: 'edits.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(edited, 'utf8'),
  })

  const preview = page.getByTestId('import-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByTestId('imp-changes')).toContainText('LT-101')
  await expect(page.getByTestId('imp-changes')).toContainText('barg')

  // nothing has moved yet
  expect((await registry(page))['LT-101']!.fields['signal.units']).toBeUndefined()

  await page.getByTestId('imp-apply').click()
  await expect(preview).toBeHidden()
  expect((await registry(page))['LT-101']!.fields['signal.units']).toBe('barg')

  // --- UNDO: one import, one step ----------------------------------------
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await registry(page))['LT-101']!.fields['signal.units']).toBeUndefined()
})

test('a file with an unknown tag is refused, and applies nothing', async ({ page }) => {
  await page.goto('/app')
  await ready(page)
  await seed(page)
  await page.getByTestId('rail-data').click()

  // Build a file with the right header but a tag nothing carries.
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('data-export-engineering').click(),
  ]).then(([d]) => d)
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  const exported = Buffer.concat(chunks).toString('utf8')
  const columns = exported.split('\n')[0]!.split(',').length
  const hostile = `${exported.trimEnd()}\nZZ-999${','.repeat(columns - 1)}\n`

  await page.getByTestId('data-import-file').setInputFiles({
    name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(hostile, 'utf8'),
  })

  await expect(page.getByTestId('imp-problems')).toContainText('ZZ-999')
  await expect(page.getByTestId('imp-apply')).toBeDisabled()
  await page.getByTestId('imp-cancel').click()
  await expect(page.getByTestId('import-preview')).toBeHidden()

  const reg = await registry(page)
  expect(Object.keys(reg).sort()).toEqual(['LT-101', 'PT-200'])
})
