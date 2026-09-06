import { test, expect } from '@playwright/test'

test('drawing UI switches between English and simplified Chinese', async ({ page }) => {
  await page.goto('/app')
  const toggle = page.getByTestId('language-toggle')
  await expect(toggle).toBeVisible()
  if (await toggle.textContent() === '中') {
    await toggle.click()
  }
  await expect(toggle).toHaveText('EN')
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '属性', exact: true })).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveText('中')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
})
