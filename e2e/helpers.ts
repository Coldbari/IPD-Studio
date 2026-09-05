import type { Page } from '@playwright/test'

/**
 * Load a bundled template.
 *
 * Templates moved out of the toolbar's `<select class="tb-template">` and into
 * the File menu as real menu items — a control you had to operate to find out
 * what it offered became a list you can read. Specs go through here so the next
 * move costs one edit rather than six.
 */
export async function openTemplate(page: Page, id: 'sample' | 'refinery' | 'hmi-demo' | 'blank' | 'utility') {
  await page.getByTestId('tb-file').click()
  await page.getByTestId(`tpl-${id}`).click()
  // A drawing with unsaved changes asks before it is replaced.
  await confirmIfAsked(page)
}

/**
 * Answer the "open without saving?" question, when there is one.
 *
 * Replacing a document is one of the few actions Undo cannot reach, so it is
 * confirmed — in the app's own dialog now rather than a browser confirm, which
 * is why `page.on('dialog')` no longer sees it.
 */
export async function confirmIfAsked(page: Page): Promise<void> {
  const go = page.getByTestId('confirm-go')
  if (await go.isVisible().catch(() => false)) await go.click()
}

/** Take the autosaved drawing back after a reload. */
export async function restoreIfOffered(page: Page): Promise<void> {
  const go = page.getByTestId('confirm-go')
  await go.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined)
  if (await go.isVisible().catch(() => false)) await go.click()
}

/**
 * Accept a QA finding with a reason.
 *
 * This was a `window.prompt` answered through `page.on('dialog')`. It is a
 * form now: the finding stays on screen while the reason is typed, and an
 * empty reason cannot be submitted.
 */
export async function acceptFinding(page: Page, reason: string): Promise<void> {
  await page.getByTestId('accept-reason').fill(reason)
  await page.getByTestId('accept-go').click()
}
