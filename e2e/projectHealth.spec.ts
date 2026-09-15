import { expect, test, type Page } from '@playwright/test'

/**
 * P3-5 — the Project workspace, in the real app.
 *
 * The one behaviour worth an end-to-end test is the claim the whole screen
 * rests on: a tile is a jump into the workspace that owns its numbers, and the
 * number it shows is the same one that workspace shows.
 */

async function seed(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    s.setTag(tank, { letters: 'TK', loop: '101' })
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 280, y: 240, rotation: 0 })
    s.setTag(pump, { letters: 'P', loop: '101' })
    s.addEdge({
      lineClass: 'process.major',
      source: { nodeId: tank, portId: 's' },
      target: { nodeId: pump, portId: 'suction' },
      lineNumber: { size: '6"', spec: 'CS', service: 'CW', seq: '001' },
    })
    // One started record, so completeness has a denominator to report.
    s.setRecordField('TK-101', 'equipment', 'general.service', 'Cooling water')
  })
  await expect(page.locator('.rail')).toBeVisible()
}

test('the Project workspace reports what is drawn, and each tile opens its source', async ({ page }) => {
  await seed(page)

  await page.getByTestId('rail-project').click()
  await expect(page).toHaveURL(/\/app\/project$/)

  // Two tagged vessels and one physical run.
  await expect(page.getByTestId('ph-count-equipment')).toHaveText('2')
  await expect(page.getByTestId('ph-count-lines')).toHaveText('1')

  // One started equipment record with its one required field filled.
  await expect(page.getByTestId('ph-complete-equipment')).toHaveText('100%');
  // The line record was never started, so there is nothing to measure — and
  // that reads as an em dash, never as 0%.
  await expect(page.getByTestId('ph-complete-line')).toHaveText('—')

  // No invented deliverables figure.
  await expect(page.getByTestId('ph-deliverables')).toHaveCount(0)

  // The counts tile opens the Data workspace, where the tables are.
  await page.getByTestId('ph-counts-jump').click()
  await expect(page).toHaveURL(/\/app\/data$/)
  await expect(page.locator('.ws-table')).toBeVisible()
})

test('the quality tile agrees with the Checks workspace it opens', async ({ page }) => {
  await seed(page)
  await page.getByTestId('rail-project').click()

  const critical = await page.getByTestId('ph-qa-critical').textContent()

  await page.getByTestId('ph-qa-jump').click()
  await expect(page).toHaveURL(/\/app\/checks$/)
  await expect(page.getByTestId('checks-tally')).toBeVisible()
  // The rail badge is the same report; it only appears when there is one.
  if (critical !== '0') {
    await expect(page.locator('.rail-badge')).toHaveText(critical!)
  } else {
    await expect(page.locator('.rail-badge')).toHaveCount(0)
  }
})
