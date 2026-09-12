import { expect, test, type Page } from '@playwright/test'

/**
 * P1-D through the real application: declare Area 100 / Unit U-101 in the
 * dialog, assign an instrument to it in the inspector, and see the assignment
 * reach the Data workspace's table and its filters.
 */

async function ready(page: Page) {
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

async function placeTagged(page: Page, letters: string, loop: string, x: number) {
  await page.evaluate(([l, n, px]) => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: px, y: 160, rotation: 0 })
    useStore.getState().setTag(id, { letters: l, loop: n })
    useStore.getState().setRecordField(`${l}-${n}`, 'instrument', 'general.service', 'Feed water')
    useStore.getState().setSelection([id])
  }, [letters, loop, x] as const)
}

test('an area and a unit can be declared, assigned and filtered by', async ({ page }) => {
  await page.goto('/app')
  await ready(page)

  await placeTagged(page, 'FT', '101', 200)
  await placeTagged(page, 'PT', '200', 320)

  // Declare the hierarchy.
  await page.getByTestId('tb-areas').click()
  await expect(page.getByTestId('areas-dialog')).toBeVisible()
  await page.getByTestId('area-add').click()
  const areaId = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    return useStore.getState().doc.areas[0].id as string
  })
  await page.getByTestId(`area-code-${areaId}`).fill('100')
  await page.getByTestId(`unit-add-${areaId}`).click()
  const unitId = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    return useStore.getState().doc.units[0].id as string
  })
  await page.getByTestId(`unit-code-${unitId}`).fill('U-101')
  await page.keyboard.press('Escape')

  // Assign FT-101 from the inspector, and read the area back beside it.
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    s.setSelection([s.doc.sheets[0].nodes.find((n: any) => n.tag?.letters === 'FT').id])
  })
  await page.getByTestId('insp-eng').click()
  await page.getByTestId('eng-unit').selectOption(unitId)
  await expect(page.getByTestId('eng-area')).toContainText('Area 100')

  // The Data workspace shows it, and filters on it.
  await page.getByTestId('rail-data').click()
  const table = page.getByTestId('data-table-instruments')
  await expect(table.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByTestId('unit-FT-101')).toHaveValue(unitId)

  await page.getByTestId('data-filter-area').selectOption(areaId)
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await page.getByTestId('data-filter-area').selectOption('__none')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByTestId('unit-PT-200')).toBeVisible()
})

test('renaming a unit does not break an assignment', async ({ page }) => {
  await page.goto('/app')
  await ready(page)
  await placeTagged(page, 'FT', '101', 200)

  const ids = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const areaId = useStore.getState().addArea('100')
    const unitId = useStore.getState().addUnit(areaId, 'U-101')
    useStore.getState().assignUnit('FT-101', 'instrument', unitId)
    return { areaId, unitId }
  })

  await page.getByTestId('tb-areas').click()
  await page.getByTestId(`unit-code-${ids.unitId}`).fill('U-102')
  await page.getByTestId(`area-code-${ids.areaId}`).fill('200')
  await page.keyboard.press('Escape')

  await page.getByTestId('rail-data').click()
  await expect(page.getByTestId('unit-FT-101')).toHaveValue(ids.unitId)
  const row = page.getByTestId('data-table-instruments').locator('tbody tr').first()
  await expect(row).toContainText('200')
})
