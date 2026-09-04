import { expect, test } from '@playwright/test'

declare global {
  interface Window { __pid: any }
}

/** Two members of one flow loop, with no final element — so "is it complete?"
 *  has a real, checkable answer. Returns the FT's id. */
async function drawPartialLoop(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const s = window.__pid.useStore.getState()
    const ft = s.addNode({
      symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 200, rotation: 0,
      tag: { letters: 'FT', loop: '101' },
    })
    s.addNode({
      symbolId: 'instr.bubble', kind: 'instrument', x: 340, y: 200, rotation: 0,
      tag: { letters: 'FIC', loop: '101' },
    })
    window.__pid.useStore.getState().setSelection([ft])
    return ft
  })
}

test('assistant: answers about the selected loop and jumps to real objects', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.waitForFunction(() => Boolean(window.__pid))

  const ftId = await drawPartialLoop(page)

  // the assistant shares the right column with the inspector
  await page.getByTestId('right-tab-assist').click()
  await expect(page.getByTestId('assist-panel')).toBeVisible()

  // it knows what is selected without being told
  await expect(page.getByTestId('assist-context')).toContainText('FT-101')
  await expect(page.getByTestId('assist-context')).toContainText('loop F-101')

  // the offered questions are the ones that make sense for this selection
  const askComplete = page.getByRole('button', { name: 'Is loop F-101 complete?' })
  await expect(askComplete).toBeVisible()
  await askComplete.click()

  // the answer names what is missing, and lists the real members
  const ans = page.getByTestId('assist-answer')
  await expect(ans).toContainText('final control element')
  await expect(ans).toContainText('FT-101')
  await expect(ans).toContainText('FIC-101')

  // every row is a jump into a real object
  await ans.getByRole('button', { name: /FT-101/ }).click()
  await expect.poll(() => page.evaluate(() => window.__pid.useStore.getState().selection)).toEqual([ftId])
})

test('assistant: declines what the drawing cannot answer, and says what is missing', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await drawPartialLoop(page)

  await page.getByTestId('right-tab-assist').click()
  await page.getByTestId('assist-input').fill('is this PSV sized right?')
  await page.getByTestId('assist-input').press('Enter')

  const ans = page.getByTestId('assist-answer')
  await expect(ans).toContainText('does not say')
  await expect(ans).toContainText(/relieving load/i)
  // a refusal offers no object rows — it must not look like an answer
  await expect(ans.locator('.assist-rows')).toHaveCount(0)
})

test('assistant: an unmatched question asks to connect a model rather than guessing', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))

  await page.getByTestId('right-tab-assist').click()
  await page.getByTestId('assist-input').fill('summarise the control philosophy of this plant')
  await page.getByTestId('assist-input').press('Enter')

  // No key is configured, so the question cannot be answered from the drawing
  // alone and the panel offers to connect one — it never invents an answer.
  await expect(page.getByTestId('assist-setup')).toBeVisible()
  await expect(page.getByTestId('assist-answer')).toHaveCount(0)
})

test('assistant: the model gate states what leaves the browser and needs authorisation', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await drawPartialLoop(page)

  await page.getByTestId('right-tab-assist').click()
  await page.getByTestId('assist-input').fill('summarise the control philosophy')
  await page.getByTestId('assist-input').press('Enter')

  const setup = page.getByTestId('assist-setup')
  await expect(setup).toContainText('2 tagged item')
  await expect(setup).toContainText(/underlay/i)

  // Save stays disabled until BOTH a recognised key and the authorisation box
  const save = setup.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  await page.getByTestId('assist-key').fill('gsk_exampleonlynotreal')
  await expect(setup).toContainText(/Detected: Groq/i)
  await expect(save).toBeDisabled()
  await page.getByTestId('assist-consent').check()
  await expect(save).toBeEnabled()

  // an unrecognised key is reported, never sent somewhere hopeful
  await page.getByTestId('assist-key').fill('not-a-real-key')
  await expect(setup).toContainText('Unrecognised key format')
  await expect(save).toBeDisabled()
})

test('assistant: switching back to Properties keeps the inspector working', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await drawPartialLoop(page)

  await page.getByTestId('right-tab-assist').click()
  await expect(page.getByTestId('assist-panel')).toBeVisible()
  await page.getByTestId('right-tab-props').click()
  await expect(page.getByTestId('assist-panel')).toHaveCount(0)
  await expect(page.getByTestId('insp-symbol')).toBeVisible()
})

test('assistant: the conversation reads as a chat thread', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await drawPartialLoop(page)
  await page.getByTestId('right-tab-assist').click()

  await page.getByRole('button', { name: 'Is loop F-101 complete?' }).click()
  // the question appears as the user's own turn, the answer as a reply
  await expect(page.getByTestId('bubble-user')).toHaveText('Is loop F-101 complete?')
  await expect(page.getByTestId('assist-answer')).toContainText('final control element')

  // a second question appends rather than replacing the first
  await page.getByTestId('assist-input').fill('how much does this loop cost')
  await page.getByTestId('assist-input').press('Enter')
  await expect(page.getByTestId('bubble-user')).toHaveCount(2)
  await expect(page.getByTestId('assist-answer')).toHaveCount(2)
  await expect(page.getByTestId('bubble-user').nth(1)).toHaveText('how much does this loop cost')

  // clearing empties the thread
  await page.getByTitle('Clear the conversation').click()
  await expect(page.getByTestId('bubble-user')).toHaveCount(0)
})

test('right column: the divider resizes the panel and the width persists', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))

  const width = () => page.locator('.right-col').evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const before = await width()

  const grip = page.getByTestId('right-grip')
  const box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x - 160, box.y + 200, { steps: 12 })
  await page.mouse.up()

  const after = await width()
  expect(after).toBeGreaterThan(before + 100)

  // and it survives a reload
  await page.reload()
  await page.waitForFunction(() => Boolean(window.__pid))
  expect(await width()).toBeGreaterThan(before + 100)
})

test('assistant: the free option is offered up front and routes OpenRouter keys correctly', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => Boolean(window.__pid))
  await page.getByTestId('right-tab-assist').click()
  await page.locator('.panel-head').getByTitle('Model settings').click()

  // the free route is stated before any key is typed
  const note = page.getByTestId('assist-free-note')
  await expect(note).toContainText(/openrouter/i)
  await expect(note).toContainText(/no cost|free/i)

  // an OpenRouter key is recognised as such, never mistaken for Anthropic
  await page.getByTestId('assist-key').fill('sk-or-v1-exampleonlynotreal')
  const setup = page.getByTestId('assist-setup')
  await expect(setup).toContainText(/Detected: OpenRouter/i)
  // and free-only is the default, so nobody spends by accident
  await expect(page.getByTestId('assist-free-only')).toBeChecked()

  // the model list is public, so real free models load without a valid key
  await expect(page.getByTestId('assist-model')).toBeVisible({ timeout: 20000 })
  const options = await page.getByTestId('assist-model').locator('option').allTextContents()
  expect(options.length).toBeGreaterThan(0)

  // Every offered model must ACTUALLY cost nothing and ACTUALLY call tools,
  // checked against the live catalogue rather than a name suffix — ":free" is
  // a naming convention, and a toolless model would just invent a P&ID.
  const res = await page.request.get('https://openrouter.ai/api/v1/models')
  const catalogue = (await res.json()).data as {
    id: string; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[]
  }[]
  const byId = new Map(catalogue.map((m) => [m.id, m]))
  for (const id of options) {
    const m = byId.get(id)
    expect(m, `${id} is not in the OpenRouter catalogue`).toBeDefined()
    expect(Number(m!.pricing?.prompt), `${id} charges for input`).toBe(0)
    expect(Number(m!.pricing?.completion), `${id} charges for output`).toBe(0)
    expect(m!.supported_parameters ?? [], `${id} cannot call tools`).toContain('tools')
  }
})
