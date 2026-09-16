import { expect, test, type Page } from '@playwright/test'

/**
 * Whether this build has a Firebase project behind it. There is no hardcoded
 * config (see src/auth/config.ts), so a fork — and CI, which has no secrets —
 * runs with the account layer switched off entirely. The sign-in gate cannot
 * be asserted when there is nothing to sign in to.
 */
async function backendConfigured(page: Page): Promise<boolean> {
  await page.waitForFunction(() => '__pid' in window)
  return page.evaluate(
    () => (window as unknown as { __pid: { firebaseReady?: boolean } }).__pid.firebaseReady === true,
  )
}

test('the homepage is what / serves, and its CTA opens the editor', async ({ page }) => {
  await page.goto('/')

  // the marketing page, not the editor
  await expect(page.locator('.home')).toBeVisible()
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.locator('.toolbar')).toHaveCount(0)

  await page.getByRole('button', { name: /open ipd studio/i }).first().click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.locator('.toolbar')).toBeVisible()
})

test('sign in on the homepage leads to the editor sign-in screen', async ({ page, context }) => {
  await context.addInitScript(() => { try { localStorage.removeItem('pid.dev.skipAuth') } catch {} })
  await page.goto('/')
  test.skip(!(await backendConfigured(page)), 'no Firebase project configured — the account layer is off')
  await page.getByRole('button', { name: /^sign in$/i }).first().click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByTestId('auth-dialog')).toBeVisible()
  await expect(page.getByTestId('auth-email')).toBeVisible()
  await expect(page.getByTestId('auth-password')).toBeVisible()
})

test('the editor is gated: no account, no canvas', async ({ page, context }) => {
  // opt out of the suite-wide dev bypass to see what a real visitor sees
  await context.addInitScript(() => { try { localStorage.removeItem('pid.dev.skipAuth') } catch {} })
  await page.goto('/app')
  test.skip(!(await backendConfigured(page)), 'no Firebase project configured — the account layer is off')

  await expect(page.getByTestId('auth-dialog')).toBeVisible()
  await expect(page.locator('.toolbar')).toHaveCount(0)
  await expect(page.locator('.palette')).toHaveCount(0)
})

test('a deep link straight to /app boots the editor, not the homepage', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.home')).toHaveCount(0)
  await expect(page.locator('.toolbar')).toBeVisible()
})

test('the homepage says the product is actively updated', async ({ page }) => {
  await page.goto('/')
  const banner = page.locator('.version-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(/in active development/i)
  await expect(banner).toContainText(/v\d+\.\d+\.\d+/)
  await expect(page.getByTestId('version-refresh')).toBeVisible()
})

/* ── the redesigned homepage ─────────────────────────────────────────────
   These guard the three things a marketing page breaks silently: a button
   wired to nothing, a claim that outran the product, and a layout that only
   works on the machine it was designed on. */

test('every call to action goes somewhere real', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()

  // No anchor may be a placeholder, and every in-page anchor must land on a
  // target that actually exists.
  const hrefs = await page.locator('.home a[href]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href') ?? ''),
  )
  expect(hrefs.length).toBeGreaterThan(10)
  for (const href of hrefs) {
    expect(href, 'placeholder link').not.toBe('#')
    expect(href, 'placeholder link').not.toBe('')
    if (href.startsWith('#')) {
      await expect(page.locator(href), `anchor ${href} has no target`).toHaveCount(1)
    } else {
      expect(href, `suspicious href ${href}`).toMatch(/^(https:\/\/|mailto:|\/)/)
    }
  }

  // Buttons are the other half: each must carry a real label.
  const labels = await page.locator('.home button').evaluateAll((els) =>
    els.map((e) => (e.textContent ?? '').trim()),
  )
  for (const l of labels) expect(l.length).toBeGreaterThan(0)
})

test('the roadmap separates shipped from planned, and says so', async ({ page }) => {
  await page.goto('/')
  const roadmap = page.locator('#roadmap')
  await roadmap.scrollIntoViewIfNeeded()

  // Shipped items name a version; the other two columns must not.
  await expect(roadmap.locator('.rm-now .ver').first()).toBeVisible()
  await expect(roadmap.getByText('AutomationML', { exact: false })).toBeVisible()

  // AutomationML and MTP live under Future, never under Now.
  const now = await roadmap.locator('.rm-now').innerText()
  expect(now).not.toMatch(/AutomationML|MTP/i)
})

test('the standards index never claims certification', async ({ page }) => {
  await page.goto('/')
  const std = page.locator('#standards')
  await std.scrollIntoViewIfNeeded()

  // Only the CLAIMS are checked for overclaiming. The disclaimer is allowed to
  // use these words, because it uses them to deny them — "has not been
  // formally assessed or certified" must not trip a test aimed at the notes.
  const notes = await std.locator('.std .note').allInnerTexts()
  expect(notes.length).toBeGreaterThan(5)
  for (const note of notes) {
    expect(note, `overclaims: "${note}"`).not.toMatch(/\b(certified|compliant|conformant|accredited|endorsed)\b/i)
  }
  await expect(std.locator('.disclaimer')).toContainText(/not been formally assessed or certified/i)
  await expect(std.locator('.disclaimer')).toContainText(/not affiliated with or endorsed by/i)
})

test('the page carries its SEO and social metadata', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/IPD Studio — Professional P&ID & Industrial Engineering Platform/)
  // Social crawlers do not run JS, so these must be in the served HTML.
  for (const [sel, attr] of [
    ['meta[name="description"]', 'content'],
    ['meta[property="og:title"]', 'content'],
    ['meta[property="og:image"]', 'content'],
    ['meta[name="twitter:card"]', 'content'],
    ['link[rel="canonical"]', 'href'],
  ] as const) {
    const v = await page.locator(sel).first().getAttribute(attr)
    expect(v, `${sel} is missing`).toBeTruthy()
  }
})

test('it survives a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.home')).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls sideways on a phone').toBeLessThanOrEqual(1)

  // The spine must recompose vertically rather than shrink to illegibility.
  await expect(page.locator('.stage')).toHaveCount(6)
  await expect(page.getByRole('button', { name: /open ipd studio/i }).first()).toBeVisible()
})
