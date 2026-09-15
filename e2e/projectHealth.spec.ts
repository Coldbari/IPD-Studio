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

  // No invented deliverables figure. P3-6 added a staleness section, which
  // COMPARES regenerated reports — it never counts files the product cannot see,
  // and it computes nothing until it is asked.
  await expect(page.getByTestId('ph-deliverables-jump')).toHaveCount(0)

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

test('deliverable staleness compares against the last issue, and only when asked', async ({ page }) => {
  await seed(page)

  // Issue Rev A through the real path, which is what stores the snapshot.
  await page.evaluate(async () => {
    const w = window as never as { __pid: { useStore: { getState(): any } } }
    const { useStore } = w.__pid
    useStore.getState().setSheetMeta({ drawingNumber: 'PID-1001' })
    const sheetId = useStore.getState().doc.sheets[0].id
    const rev = useStore.getState().addRevision(sheetId, {
      code: 'A', status: 'IFC', description: 'Issued for construction',
      date: '2026-03-04', preparedBy: 'P Nagpure', checkedBy: 'R Nair', approvedBy: 'A Bose',
    })
    const mod = await import('/src/persist/revisions.ts')
    await mod.issueRevision(sheetId, rev)
  })

  await page.getByTestId('rail-project').click()

  // Nothing is compared until it is asked for — sixteen report builds must not
  // happen on a render.
  await expect(page.getByTestId('ph-deliverables-basis')).toContainText('PID-1001')
  await expect(page.getByTestId('ph-deliverables-jump')).toHaveCount(0)

  await page.getByTestId('ph-deliverables-run').click()
  await expect(page.getByTestId('ph-deliv-equipment-list')).toHaveText('UNCHANGED')
  await expect(page.getByTestId('ph-deliv-dexpi')).toHaveText('NOT COMPARABLE')

  // Change one engineering field, and the report that prints it goes stale.
  await page.getByTestId('rail-project').click()
  await page.evaluate(() => {
    const w = window as never as { __pid: { useStore: { getState(): any } } }
    w.__pid.useStore.getState().setRecordField('TK-101', 'equipment', 'construction.material', 'SS316')
  })

  // The old answer describes a document that no longer exists, so it is gone.
  await expect(page.getByTestId('ph-deliverables-jump')).toHaveCount(0)
  await page.getByTestId('ph-deliverables-run').click()
  await expect(page.getByTestId('ph-deliv-equipment-list')).toHaveText('DIFFERS')
  await expect(page.getByTestId('ph-deliv-line-list')).toHaveText('UNCHANGED')

  // And it opens the workspace where those reports live.
  await page.getByTestId('ph-deliverables-jump').click()
  await expect(page).toHaveURL(/\/app\/data$/)
})

test('review comments: write one on a record, reply, resolve, reopen — and the project counts it', async ({ page }) => {
  await seed(page)

  // Select the tagged vessel so the Inspector shows its Engineering tab.
  await page.evaluate(() => {
    const w = window as never as { __pid: { useStore: { getState(): any } } }
    const { useStore } = w.__pid
    const tank = useStore.getState().doc.sheets[0].nodes.find((n: any) => n.tag?.letters === 'TK')
    useStore.getState().setSelection([tank.id])
  })
  await page.getByTestId('insp-eng').click()

  // A review comment is not a QA finding, and the panel says so.
  await expect(page.getByTestId('eng-review-empty')).toContainText('no severity')

  await page.getByTestId('rev-new-body').fill('Design pressure looks low for this duty.')
  await page.getByTestId('rev-add').click()
  await expect(page.getByTestId('eng-review-open')).toHaveText('1 open')

  // Reply into the same thread.
  const threadId = await page.evaluate(() => {
    const w = window as never as { __pid: { useStore: { getState(): any } } }
    return w.__pid.useStore.getState().doc.registry['TK-101'].comments[0].id
  })
  await page.getByTestId(`rev-${threadId}-reply`).click()
  await page.getByTestId(`rev-${threadId}-reply-body`).fill('Agreed — raise it to 12 barg.')
  await page.getByTestId(`rev-${threadId}-reply-send`).click()
  await expect(page.getByTestId(`rev-${threadId}`)).toContainText('raise it to 12 barg')

  // The Project workspace counts it, and says it is not QA.
  await page.getByTestId('rail-project').click()
  await expect(page.getByTestId('ph-review-open')).toHaveText('1')
  await expect(page.getByTestId('ph-review-note')).toContainText('never block an issue')

  // Resolve, and the count falls to zero. Switching workspaces unmounts the
  // drawing, so the Inspector opens on its first tab again.
  await page.getByTestId('rail-draw').click()
  await page.getByTestId('insp-eng').click()
  await page.getByTestId(`rev-${threadId}-resolve`).click()
  await expect(page.getByTestId(`rev-${threadId}-resolved`)).toBeVisible()
  await page.getByTestId('rail-project').click()
  await expect(page.getByTestId('ph-review-open')).toHaveText('0')

  // Reopen, and it comes back as the same thread.
  await page.getByTestId('rail-draw').click()
  await page.getByTestId('insp-eng').click()
  await page.getByTestId(`rev-${threadId}-reopen`).click()
  await expect(page.getByTestId(`rev-${threadId}-resolve`)).toBeVisible()
  await page.getByTestId('rail-project').click()
  await expect(page.getByTestId('ph-review-open')).toHaveText('1')
})
