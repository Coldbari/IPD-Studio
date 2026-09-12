import { expect, test, type Page } from '@playwright/test'

/**
 * H4: the revision and comparison UI reached the way a user reaches it.
 *
 * The component tests mount RevisionsDialog and RevisionCompare directly, so
 * they would pass even if nothing on screen led to them. These start from a
 * loaded application and click.
 */

async function app(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

/** The sheet panel shows when nothing is selected. */
async function openRevisions(page: Page) {
  await page.getByTestId('open-revisions').click()
  await expect(page.getByTestId('revisions-dialog')).toBeVisible()
}

test('a revision can be created and issued through the real UI', async ({ page }) => {
  await app(page)

  // Something to issue.
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    s.setTag(id, { letters: 'LT', loop: '101' })
    s.setSelection([])
  })

  await openRevisions(page)
  await page.getByTestId('rev-start').click()

  await page.getByTestId('rev-description').fill('First issue for review')
  await page.getByTestId('rev-prepared').fill('PN')
  await page.getByTestId('rev-status').selectOption('IFC')
  await expect(page.getByTestId('rev-issue')).toContainText('IFC')

  await page.getByTestId('rev-issue').click()

  // Visible in the application's own revision table, marked issued.
  await expect(page.locator('.rev-badge-issued')).toBeVisible()
  await expect(page.locator('.rev-table')).toContainText('First issue for review')
  await expect(page.locator('.rev-table')).toContainText('PN')
  await expect(page.locator('.rev-badge-wip')).toHaveCount(0)

  const stored = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const sh = useStore.getState().doc.sheets[0]
    return { code: sh.revision, rows: sh.revisions.length, issued: Boolean(sh.revisions[0].issuedAt) }
  })
  expect(stored).toEqual({ code: 'A', rows: 1, issued: true })
})

test('two issued revisions can be compared through the real UI', async ({ page }) => {
  await app(page)

  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    s.setTag(id, { letters: 'LT', loop: '101' })
    s.setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
    s.setSelection([])
  })

  // Rev A
  await openRevisions(page)
  await page.getByTestId('rev-start').click()
  await page.getByTestId('rev-issue').click()
  await expect(page.locator('.rev-badge-issued')).toHaveCount(1)

  // A known engineering difference, then Rev B. The dialog reads live store
  // state, so there is no need to close and reopen it.
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-16 bar')
  })
  await page.getByTestId('rev-start').click()
  await page.getByTestId('rev-issue').click()
  await expect(page.locator('.rev-badge-issued')).toHaveCount(2)

  // Compare, from the dialog the user is already in.
  await page.getByTestId('rev-compare-wrap').locator('summary').click()
  await expect(page.getByTestId('rev-compare')).toBeVisible()
  await page.getByTestId('cmp-a').selectOption({ label: 'A' })
  await page.getByTestId('cmp-b').selectOption({ label: 'B' })
  await page.getByTestId('cmp-run').click()

  await expect(page.getByTestId('cmp-summary')).toContainText('modified')
  const table = page.getByTestId('cmp-table')
  await expect(table).toContainText('signal.range')
  await expect(table).toContainText('0-10 bar')
  await expect(table).toContainText('0-16 bar')
})
