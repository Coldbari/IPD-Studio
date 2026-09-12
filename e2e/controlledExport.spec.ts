import { expect, test, type Page } from '@playwright/test'

/**
 * THE CONTROLLED DELIVERABLE, THROUGH THE REAL EXPORT PATH.
 *
 * Issue a revision in the UI, then export and read what actually came out.
 * The defect this guards is specific: the drawing used to be stamped with the
 * date it was PRINTED, so an issued Rev B exported a month later claimed to
 * have been issued a month later.
 */

async function ready(page: Page) {
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

/** Fill in the controlled metadata and issue Rev A, through the store. */
async function issuedDrawing(page: Page) {
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    s.setMeta({
      name: 'Crude Unit', author: 'P Nagpure', client: 'Northern Refining',
      projectNumber: 'J-4471', plant: 'Teesside', discipline: 'Process',
      documentNumber: 'NR-J4471-PID',
    })
    useStore.getState().setSheetMeta({ drawingNumber: 'PID-1001' })
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  })
  return page.evaluate(async () => {
    const w = window as never as { __pid: { useStore: { getState(): any } } }
    const { useStore } = w.__pid
    const sheetId = useStore.getState().doc.sheets[0].id
    const rev = useStore.getState().addRevision(sheetId, {
      code: 'A', status: 'IFC', description: 'Issued for construction',
      date: '2026-03-04', preparedBy: 'P Nagpure', checkedBy: 'R Nair', approvedBy: 'A Bose',
    })
    const mod = await import('/src/persist/revisions.ts')
    await mod.issueRevision(sheetId, rev)
    return useStore.getState().doc.sheets[0].revisions[0]
  })
}

async function download(page: Page, label: string): Promise<{ name: string; body: Buffer }> {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByTestId('tb-export').click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    })(),
  ])
  const stream = await dl.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return { name: dl.suggestedFilename(), body: Buffer.concat(chunks) }
}

test('29. the exported SVG describes the issue, not the print', async ({ page }) => {
  await page.goto('/app')
  await ready(page)
  const revision = await issuedDrawing(page)
  expect(revision.standard?.fingerprint).toBeTruthy()

  const { body } = await download(page, 'SVG image')
  const svg = body.toString('utf8')
  const text = svg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

  // The date on the drawing is the date of the ISSUE.
  expect(text).toContain('2026-03-04')
  const today = new Date().toISOString().slice(0, 10)
  if (today !== '2026-03-04') expect(svg).not.toContain(today)

  // Identity, control and provenance all on the sheet.
  for (const v of [
    'Crude Unit', 'PID-1001', 'NR-J4471-PID', 'Northern Refining', 'J-4471',
    'Teesside', 'Process', 'IFC', 'P Nagpure', 'R Nair', 'A Bose', '1 of 1',
    'CHECKED AGAINST', 'Issued for construction',
  ]) {
    expect(text, v).toContain(v)
  }
  expect(text).toContain(revision.standard.fingerprint.slice(0, 8))
})

test('30. the exported PNG comes out of the same path', async ({ page }) => {
  await page.goto('/app')
  await ready(page)
  await issuedDrawing(page)
  const { name, body } = await download(page, 'PNG image')
  expect(name).toMatch(/\.png$/)
  // A real PNG, rasterised from the same SVG the test above read.
  expect(body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(body.length).toBeGreaterThan(2000)
})

test('31 / 32. both PDF paths render the controlled sheet', async ({ page }) => {
  await page.goto('/app')
  await ready(page)
  await issuedDrawing(page)

  // printPdf and printAllSheets build a hidden iframe and call print(). The
  // print dialog cannot be driven from here, so the assertion is on what they
  // put IN the iframe — which is the controlled SVG.
  await page.evaluate(() => { window.print = () => {} })

  for (const label of ['PDF — this sheet', 'PDF — all sheets']) {
    await page.getByTestId('tb-export').click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    await expect
      .poll(async () => page.evaluate(() => {
        const frames = [...document.querySelectorAll('iframe')]
        return frames.some((f) => (f.contentDocument?.body?.innerHTML ?? '').includes('CHECKED AGAINST'))
      }), { timeout: 5000 })
      .toBe(true)
    const text = await page.evaluate(() => {
      const frames = [...document.querySelectorAll('iframe')]
      const html = frames.map((f) => f.contentDocument?.body?.innerHTML ?? '').join(' ')
      return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
    })
    expect(text, label).toContain('2026-03-04')
    expect(text, label).toContain('IFC')
    expect(text, label).toContain('Issued for construction')
  }
})
