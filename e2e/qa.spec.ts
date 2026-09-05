import { expect, test, type Page } from '@playwright/test'
import { acceptFinding, restoreIfOffered } from './helpers'

async function seedDuplicate(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const a = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 160, y: 160, rotation: 0 })
    const b = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 300, y: 160, rotation: 0 })
    useStore.getState().setTag(a, { letters: 'FT', loop: '101' })
    useStore.getState().setTag(b, { letters: 'FT', loop: '101' })
  })
}

test('a duplicate tag is critical, and its fix renumbers the extra one', async ({ page }) => {
  await seedDuplicate(page)
  await page.getByTestId('rail-checks').click()

  await expect(page.getByTestId('checks-tally')).toContainText('critical')
  const group = page.getByTestId('rule-duplicate-tag')
  await expect(group).toBeVisible()

  await group.getByRole('button', { name: /next free number/i }).click()
  await expect(page.getByTestId('rule-duplicate-tag')).toHaveCount(0)

  const tags = await page.evaluate(() =>
    (window as never as { __pid: { useStore: { getState(): any } } }).__pid.useStore
      .getState().doc.sheets[0].nodes.map((n: any) => `${n.tag.letters}-${n.tag.loop}`).sort(),
  )
  expect(new Set(tags).size).toBe(2)
})

test('the rail badge counts criticals only', async ({ page }) => {
  await seedDuplicate(page)
  await expect(page.locator('.rail-badge')).toHaveText('1')
})

test('accepting a finding records the reason and survives a reload', async ({ page }) => {
  await seedDuplicate(page)
  await page.getByTestId('rail-checks').click()

  await page.getByTestId('rule-duplicate-tag').getByRole('button', { name: 'Accept' }).click()
  await acceptFinding(page, 'second bubble is an off-page continuation')
  await expect(page.getByTestId('rule-duplicate-tag')).toHaveCount(0)

  // it moves into the accepted section, with the reason kept
  await page.getByTestId('checks-ignored').click()
  await expect(page.locator('.ws-ignored')).toContainText('off-page continuation')

  // and the acceptance is part of the document, so a reload keeps it.
  // Autosave debounces 500ms — wait for the write, or the reload restores a
  // snapshot taken before the accept.
  await page.waitForTimeout(900)
  await page.reload()
  await page.waitForFunction(() => '__pid' in window)
  await restoreIfOffered(page)
  await page.getByTestId('rail-checks').click()
  await expect(page.getByTestId('rule-duplicate-tag')).toHaveCount(0)
  await page.getByTestId('checks-ignored').click()
  await expect(page.locator('.ws-ignored')).toContainText('off-page continuation')
})

test('a reopened finding comes back', async ({ page }) => {
  await seedDuplicate(page)
  await page.getByTestId('rail-checks').click()
  await page.getByTestId('rule-duplicate-tag').getByRole('button', { name: 'Accept' }).click()
  await acceptFinding(page, 'intentional')
  await page.getByTestId('checks-ignored').click()
  await page.locator('.ws-ignored').getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByTestId('rule-duplicate-tag')).toBeVisible()
})

test('the discipline filter narrows the report', async ({ page }) => {
  await seedDuplicate(page)
  await page.getByTestId('rail-checks').click()
  await expect(page.getByTestId('rule-duplicate-tag')).toBeVisible()
  await page.getByTestId('checks-discipline').selectOption('process')
  await expect(page.getByTestId('rule-duplicate-tag')).toHaveCount(0)
})
