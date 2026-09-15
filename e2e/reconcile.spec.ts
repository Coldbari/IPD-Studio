import { expect, test } from '@playwright/test'
import { openTemplate } from './helpers'

/**
 * STEP I — the whole engineering scenario, end to end.
 *
 * A P&ID gains an instrument, changes one, and loses one, and at every stage
 * the operator screen is the engineer's: nothing is applied that was not
 * chosen, hand placement survives, and the last apply can be undone.
 *
 * THE P&ID-SIDE EDITS GO THROUGH THE STORE (`__pid.useStore`), not through the
 * drawing canvas. That is deliberate and it is not a shortcut around the thing
 * being tested: it is the same store the Draw workspace writes, so the
 * document changes exactly as it would from a drag — and it makes the scenario
 * deterministic, which a sequence of twenty canvas drags would not be. Every
 * Step I surface below is driven through its real UI.
 */

type Win = Window & {
  __pid?: {
    useStore: {
      getState(): {
        doc: { sheets: { id: string; nodes: { id: string; tag?: { letters: string; loop: string } }[] }[]; hmiScreens: { id: string; widgets: { id: string; tag?: string; x: number }[] }[] }
        addNode(n: unknown): string
        deleteIds(ids: string[]): void
        setRecordField(key: string, kind: string, field: string, value: string): void
      }
    }
  }
}

const widgetCount = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as Win).__pid!.useStore.getState().doc.hmiScreens[0]!.widgets.length)

const hasTag = (page: import('@playwright/test').Page, tag: string) =>
  page.evaluate((t) => (window as Win).__pid!.useStore.getState().doc.hmiScreens[0]!.widgets.some((w) => w.tag === t), tag)

test('engineering scenario: add, change and delete on the P&ID, reconciled by choice', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await openTemplate(page, 'hmi-demo')
  await page.getByTestId('rail-hmi').click()

  // 1-2. A project as shipped: the screen and the sheet agree, and nothing is
  //      reported as added or removed.
  await page.getByTestId('hmi-reconcile').click()
  await expect(page.getByTestId('rc-count-added')).toContainText('0')
  await expect(page.getByTestId('rc-count-removed')).toContainText('0')
  // This screen predates change tracking, and the dialog says so rather than
  // letting a zero read as "nothing changed".
  await expect(page.getByTestId('rc-no-baseline')).toBeVisible()
  await expect(page.getByTestId('rc-apply')).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()

  const before = await widgetCount(page)

  // 3. A new instrument is added to the P&ID.
  await page.evaluate(() => {
    const s = (window as Win).__pid!.useStore.getState()
    s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 600, y: 400, rotation: 0, tag: { letters: 'PT', loop: '150' } })
  })

  // 4-6. Reconciliation reports it, and changes NOTHING by reporting it.
  await page.getByTestId('hmi-reconcile').click()
  await expect(page.getByTestId('rc-count-added')).toContainText('1')
  const added = page.getByTestId('rc-item').filter({ hasText: 'PT-150' })
  await expect(added).toHaveAttribute('data-status', 'added')
  expect(await widgetCount(page)).toBe(before)

  // 7. The engineer chooses to create the HMI object, and sees exactly what
  //    will happen before it happens.
  await added.getByTestId('rc-action-add').click()
  await expect(page.getByTestId('rc-preview-line')).toHaveText(['+ Add PT-150'])
  await page.getByTestId('rc-apply').click()

  // 8. It exists.
  expect(await hasTag(page, 'PT-150')).toBe(true)
  expect(await widgetCount(page)).toBe(before + 1)

  // 9. The engineer moves it, which is the work reconciliation must not undo.
  const moved = await page.evaluate(() => {
    const s = (window as Win).__pid!.useStore.getState()
    const w = s.doc.hmiScreens[0]!.widgets.find((x) => x.tag === 'PT-150')!
    return w.id
  })
  await page.evaluate((id) => {
    const store = (window as Win).__pid!.useStore as unknown as { getState(): { updateWidget(id: string, patch: unknown): void } }
    store.getState().updateWidget(id, { x: 123, y: 321 })
  }, moved)

  // 10. An engineering range changes on a tag the screen already shows.
  await page.evaluate(() => {
    (window as Win).__pid!.useStore.getState().setRecordField('LT-101', 'instrument', 'signal.range', '0-5 m')
  })

  // 11-13. Reported as CHANGED, with the field, the old value and the new one.
  await page.getByTestId('hmi-reconcile').click()
  await expect(page.getByTestId('rc-count-changed')).toContainText('1')
  const changed = page.getByTestId('rc-item').filter({ hasText: 'LT-101' })
  await expect(changed).toHaveAttribute('data-status', 'changed')
  await expect(changed.getByTestId('rc-change')).toContainText('0-5 m')
  await changed.getByTestId('rc-action-update').click()
  await page.getByTestId('rc-apply').click()

  // The hand placement survived both applies.
  expect(await page.evaluate((id) => (window as Win).__pid!.useStore.getState()
    .doc.hmiScreens[0]!.widgets.find((w) => w.id === id)!.x, moved)).toBe(123)

  // 14. The instrument is deleted from the P&ID.
  await page.evaluate(() => {
    const s = (window as Win).__pid!.useStore.getState()
    const node = s.doc.sheets[0]!.nodes.find((n) => n.tag?.letters === 'PT' && n.tag.loop === '150')!
    s.deleteIds([node.id])
  })

  // 15-17. Reported as REMOVED — and the widget is STILL THERE. A deleted tag
  //        never silently deletes an operator's screen object.
  await page.getByTestId('hmi-reconcile').click()
  await expect(page.getByTestId('rc-count-removed')).toContainText('1')
  const removed = page.getByTestId('rc-item').filter({ hasText: 'PT-150' })
  await expect(removed).toHaveAttribute('data-status', 'removed')
  expect(await hasTag(page, 'PT-150')).toBe(true)
  await page.getByRole('button', { name: 'Cancel' }).click()

  // The diagnostics page says the same thing, from the same source.
  await page.getByTestId('hmi-run-toggle').click()
  await page.getByTestId('op-nav-diagnostics').click()
  await page.getByTestId('diag-section-engineering').click()
  await expect(page.getByTestId('diag-eng-row').filter({ hasText: 'PT-150' }).first()).toBeVisible()
  await page.getByTestId('hmi-run-toggle').click()

  // 18-19. The engineer decides: remove it. Then the finding is gone.
  await page.getByTestId('hmi-reconcile').click()
  await page.getByTestId('rc-item').filter({ hasText: 'PT-150' }).getByTestId('rc-action-remove').click()
  await expect(page.getByTestId('rc-preview-line')).toHaveText(['− Remove PT-150 from this screen'])
  await page.getByTestId('rc-apply').click()
  expect(await hasTag(page, 'PT-150')).toBe(false)

  await page.getByTestId('hmi-run-toggle').click()
  await page.getByTestId('op-nav-diagnostics').click()
  await page.getByTestId('diag-section-engineering').click()
  await expect(page.getByTestId('diag-eng-row').filter({ hasText: 'PT-150' })).toHaveCount(0)
  await page.getByTestId('hmi-run-toggle').click()

  // 20-21. One undo puts it back, exactly.
  await page.keyboard.press('Control+z')
  expect(await hasTag(page, 'PT-150')).toBe(true)
  expect(await page.evaluate((id) => (window as Win).__pid!.useStore.getState()
    .doc.hmiScreens[0]!.widgets.find((w) => w.id === id)!.x, moved)).toBe(123)
})

test('reconciliation leaves the running process alone', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await openTemplate(page, 'hmi-demo')
  await page.getByTestId('rail-hmi').click()

  await page.evaluate(() => {
    (window as Win).__pid!.useStore.getState().addNode({
      symbolId: 'instr.bubble', kind: 'instrument', x: 600, y: 400, rotation: 0,
      tag: { letters: 'PT', loop: '160' },
    })
  })

  // Build the plan through the real dialog, then close it without applying.
  await page.getByTestId('hmi-reconcile').click()
  await page.getByTestId('rc-item').filter({ hasText: 'PT-160' }).getByTestId('rc-action-add').click()
  await expect(page.getByTestId('rc-preview-line')).toHaveText(['+ Add PT-160'])
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Start the plant and let it move.
  await page.getByTestId('hmi-run-toggle').click()
  const sim = () => page.evaluate(() =>
    (window as unknown as { __pid: { useSimStore: { getState(): { t: number; alarms: unknown[]; historyVersion: number } } } })
      .__pid.useSimStore.getState())
  await expect.poll(async () => (await sim()).t, { timeout: 15000 }).toBeGreaterThan(1)
  const before = await sim()

  /**
   * Apply WHILE it runs.
   *
   * The dialog itself is deliberately EDIT-only — an operator station does not
   * reshape its own screens — so this submits the same document transaction the
   * dialog's Apply submits, which is the thing under test: a document write
   * must not reach the simulation, its history or its alarm list, because
   * those live outside the document entirely.
   */
  await page.evaluate(() => {
    const w = window as unknown as {
      __pid: { useStore: { getState(): { doc: unknown; applyReconciliation(p: unknown): void } } }
      __reconcile: { reconcileScreen(d: unknown, id: string): unknown; planFor(r: unknown, c: unknown): unknown }
    }
    const st = w.__pid.useStore.getState()
    const doc = st.doc as { hmiScreens: { id: string }[] }
    const report = w.__reconcile.reconcileScreen(doc, doc.hmiScreens[0]!.id)
    st.applyReconciliation(w.__reconcile.planFor(report, { 'PT-160': { action: 'add' } }))
  })

  const after = await sim()
  expect(after.t).toBeGreaterThanOrEqual(before.t)
  expect(after.alarms).toEqual(before.alarms)
  expect(after.historyVersion).toBeGreaterThanOrEqual(before.historyVersion)

  // The widget arrived, and the plant kept running through it.
  expect(await hasTag(page, 'PT-160')).toBe(true)
  await expect.poll(async () => (await sim()).t, { timeout: 15000 }).toBeGreaterThan(after.t)
})
