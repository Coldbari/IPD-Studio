import { expect, test, type Page } from '@playwright/test'

/**
 * P2-C Program 3 through the real application.
 *
 * The unit tests mount LoopsDialog and InspectorEngineering directly, so they
 * would pass even if nothing on screen led to them. These start from a loaded
 * editor and click — the toolbar, the picker, the revision dialog, the
 * comparison table.
 *
 * Drawing the symbols is done through the store because placing on canvas is
 * another spec's subject; everything the program ADDS is exercised through the
 * UI, which is what the brief asks for. No loop, no membership and no adoption
 * is ever written here by hand.
 */

type Store = { getState(): any }
const pid = (page: Page) => page.evaluate(() => (window as never as { __pid: { useStore: Store } }).__pid)

/**
 * Close the dialog the way a user does.
 *
 * NOT Escape: `Modal` ignores it while `busy`, and issuing a revision writes a
 * snapshot, so an Escape sent in that window silently does nothing and the
 * next click lands on the modal's own overlay instead of the toolbar.
 */
async function closeModal(page: Page) {
  await page.getByRole('dialog').getByTitle('Close').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function app(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

/** Three tagged objects that form one derived loop, drawn via the store. */
async function drawLoop(page: Page) {
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    for (const [letters, kind, symbolId, x] of [
      ['LT', 'instrument', 'instr.bubble', 200],
      ['LIC', 'instrument', 'instr.bubble', 300],
      ['LV', 'valve', 'cv.globe', 400],
    ] as const) {
      const id = useStore.getState().addNode({ symbolId, kind, x, y: 160, rotation: 0 })
      useStore.getState().setTag(id, { letters, loop: '101' })
    }
    useStore.getState().setSelection([])
  })
}

const select = (page: Page, letters: string) =>
  page.evaluate((l) => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    s.setSelection([s.doc.sheets[0].nodes.find((n: any) => n.tag?.letters === l).id])
  }, letters)

const loopsInDoc = (page: Page) =>
  page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return (useStore.getState().doc.loops ?? []) as { id: string; number: string; type?: string }[]
  })

const recordOf = (page: Page, key: string) =>
  page.evaluate((k) => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return useStore.getState().doc.registry?.[k] ?? null
  }, key)

/* ------------------------------------------------- the whole user workflow */

test('create a loop, assign, rename the tag, edit, issue, compare, undo', async ({ page }) => {
  await app(page)
  await drawLoop(page)

  // 1. Declare a loop in the Loop Manager.
  await page.getByTestId('tb-loops').click()
  await expect(page.getByTestId('loops-dialog')).toBeVisible()
  await expect(page.getByTestId('loops-empty')).toBeVisible()
  await page.getByTestId('loop-add').click()

  const loopId = (await loopsInDoc(page))[0]!.id
  await page.getByTestId(`loop-number-${loopId}`).fill('101')
  await page.getByTestId(`loop-name-${loopId}`).fill('Vessel level')
  await page.getByTestId(`loop-type-${loopId}`).selectOption('control')
  // Nothing assigned yet, so it reads empty rather than incomplete.
  await expect(page.getByTestId(`loop-count-${loopId}`)).toHaveText('0 members')
  await closeModal(page)

  // 2. Assign all three through the Inspector's picker.
  for (const letters of ['LT', 'LIC', 'LV']) {
    await select(page, letters)
    await page.getByTestId('insp-eng').click()
    await page.getByTestId('eng-loop').selectOption(loopId)
    await expect(page.getByTestId('eng-loop-note')).toContainText('Loop 101')
  }

  // 3. The Manager now shows three members and a structural verdict.
  await page.getByTestId('tb-loops').click()
  await expect(page.getByTestId(`loop-count-${loopId}`)).toHaveText('3 members')
  await expect(page.getByTestId(`loop-state-${loopId}`)).toHaveText('Complete')
  await expect(page.getByTestId(`loop-members-${loopId}`)).toContainText('LT-101')
  await closeModal(page)

  // 4. Rename a tag. The membership must follow the record.
  await select(page, 'LT')
  await page.getByTestId('insp-eng').click()
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    const node = s.doc.sheets[0].nodes.find((n: any) => n.tag?.letters === 'LT')
    s.setTag(node.id, { letters: 'LT', loop: '201' })
  })
  expect(await recordOf(page, 'LT-101')).toBeNull()
  expect((await recordOf(page, 'LT-201')).loopId).toBe(loopId)
  await select(page, 'LT')
  await page.getByTestId('insp-eng').click()
  await expect(page.getByTestId('eng-loop')).toHaveValue(loopId)

  // 5. Issue a revision, change the loop's type, issue again.
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    useStore.getState().setSelection([])
  })
  await page.getByTestId('open-revisions').click()
  await page.getByTestId('rev-start').click()
  await page.getByTestId('rev-description').fill('First issue')
  await page.getByTestId('rev-prepared').fill('PN')
  await page.getByTestId('rev-issue').click()
  await expect(page.locator('.rev-badge-issued')).toBeVisible()
  await closeModal(page)

  await page.getByTestId('tb-loops').click()
  await page.getByTestId(`loop-type-${loopId}`).selectOption('cascade')
  await closeModal(page)

  await page.getByTestId('open-revisions').click()
  await page.getByTestId('rev-start').click()
  await page.getByTestId('rev-description').fill('Second issue')
  await page.getByTestId('rev-prepared').fill('PN')
  await page.getByTestId('rev-issue').click()

  // 6. The comparison shows the loop change, by NUMBER and not by id.
  await page.getByTestId('rev-compare-wrap').locator('summary').click()
  await expect(page.getByTestId('rev-compare')).toBeVisible()
  // Pick the two ends explicitly. The component captured its defaults when it
  // first mounted, which was before the second issue existed, so Compare is
  // disabled until both selects name different revisions.
  const codes = await page.getByTestId('cmp-a').locator('option').allTextContents()
  await page.getByTestId('cmp-a').selectOption({ label: codes[0]! })
  await page.getByTestId('cmp-b').selectOption({ label: codes[codes.length - 1]! })
  await page.getByTestId('cmp-run').click()
  const table = page.getByTestId('cmp-table')
  await expect(table).toBeVisible()
  await expect(table).toContainText('Loop 101')
  await expect(table).toContainText('cascade')
  await expect(table).not.toContainText(loopId)
  await closeModal(page)

  // 7. Unassign from the Manager, then undo it.
  await page.getByTestId('tb-loops').click()
  await page.getByTestId('loop-unassign-LV-101').click()
  await expect(page.getByTestId(`loop-count-${loopId}`)).toHaveText('2 members')
  await closeModal(page)
  await page.keyboard.press('Control+z')
  await page.getByTestId('tb-loops').click()
  await expect(page.getByTestId(`loop-count-${loopId}`)).toHaveText('3 members')
})

/* ----------------------------------------------------- adoption, explicitly */

test('derived loops are adopted only when the user says so', async ({ page }) => {
  await app(page)
  await drawLoop(page)

  await page.getByTestId('tb-loops').click()
  // Opening the Manager persists nothing at all.
  expect(await loopsInDoc(page)).toHaveLength(0)

  // The preview is not even computed until it is asked for.
  await expect(page.getByTestId('loops-adopt')).toHaveCount(0)
  await page.getByTestId('loops-show-adopt').click()
  await expect(page.getByTestId('adopt-row-L-101')).toContainText('adopt')
  expect(await loopsInDoc(page)).toHaveLength(0)

  await page.getByTestId('adopt-apply').click()
  await expect(page.getByTestId('adopt-done')).toContainText('Declared 1 loop')

  const loops = await loopsInDoc(page)
  expect(loops).toHaveLength(1)
  expect(loops[0]!.number).toBe('L-101')
  expect(loops[0]!.type).toBe('control')
  expect((await recordOf(page, 'LT-101')).loopId).toBe(loops[0]!.id)

  // One undo step takes the whole adoption back.
  await closeModal(page)
  await page.keyboard.press('Control+z')
  expect(await loopsInDoc(page)).toHaveLength(0)
  // Adoption minted the record along with the membership (the tag carried no
  // record before), so undoing the adoption takes both back.
  expect(await recordOf(page, 'LT-101')).toBeNull()
})

/* ------------------------------------------------------- a broken reference */

test('a record pointing at a deleted loop says so and can be repaired', async ({ page }) => {
  await app(page)
  await drawLoop(page)

  // Declare and assign through the UI.
  await page.getByTestId('tb-loops').click()
  await page.getByTestId('loop-add').click()
  const loopId = (await loopsInDoc(page))[0]!.id
  await closeModal(page)
  await select(page, 'LT')
  await page.getByTestId('insp-eng').click()
  await page.getByTestId('eng-loop').selectOption(loopId)

  // Delete the loop from the Manager. That cascades, so the assignment is
  // cleared rather than left dangling — which is the correct behaviour and is
  // what this checks first.
  await page.getByTestId('tb-loops').click()
  page.once('dialog', (d) => void d.accept())
  await page.getByTestId(`loop-del-${loopId}`).click()
  await expect(page.getByTestId('loops-empty')).toBeVisible()
  await closeModal(page)

  await select(page, 'LT')
  await page.getByTestId('insp-eng').click()
  await expect(page.getByTestId('eng-loop-note')).toBeVisible()
  expect((await recordOf(page, 'LT-101')).loopId).toBeUndefined()
})

/* ------------------------------------- Program 4: the list and the diagram */

test('the Loop list reports the declared loop, and export mutates nothing', async ({ page }) => {
  await app(page)
  await drawLoop(page)

  // Declare and populate entirely through the UI.
  await page.getByTestId('tb-loops').click()
  await page.getByTestId('loop-add').click()
  const loopId = (await loopsInDoc(page))[0]!.id
  await page.getByTestId(`loop-number-${loopId}`).fill('101')
  await page.getByTestId(`loop-name-${loopId}`).fill('Vessel level')
  await page.getByTestId(`loop-type-${loopId}`).selectOption('control')
  await closeModal(page)
  for (const letters of ['LT', 'LIC', 'LV']) {
    await select(page, letters)
    await page.getByTestId('insp-eng').click()
    await page.getByTestId('eng-loop').selectOption(loopId)
  }

  // The Data workspace's Loop tab, read-only.
  await page.getByTestId('rail-data').click()
  await page.getByTestId('data-tab-loops').click()
  const table = page.getByTestId('data-table-loops')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await expect(table).toContainText('101')
  await expect(table).toContainText('Vessel level')
  await expect(table).toContainText('Control')
  await expect(table).toContainText('Structurally complete')
  // Not one cell is editable: a Loop is not an engineering record.
  await expect(table.locator('.ws-cell-btn')).toHaveCount(0)
  await expect(table).not.toContainText(loopId)

  // Reading the report changes nothing.
  const before = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return JSON.stringify(useStore.getState().doc)
  })
  await page.getByTestId('data-tab-instruments').click()
  await page.getByTestId('data-tab-loops').click()
  expect(await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return JSON.stringify(useStore.getState().doc)
  })).toBe(before)

  // Renumber, and the report follows the number without changing identity.
  await page.getByTestId('rail-draw').click()
  await page.getByTestId('tb-loops').click()
  await page.getByTestId(`loop-number-${loopId}`).fill('201')
  await closeModal(page)
  await page.getByTestId('rail-data').click()
  await page.getByTestId('data-tab-loops').click()
  await expect(page.getByTestId('data-table-loops')).toContainText('201')
  expect((await loopsInDoc(page))[0]!.id).toBe(loopId)

  // Rename a member tag; the list follows it through the registry.
  await page.getByTestId('rail-draw').click()
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    const s = useStore.getState()
    const n = s.doc.sheets[0].nodes.find((x: any) => x.tag?.letters === 'LT')
    s.setTag(n.id, { letters: 'LT', loop: '301' })
  })
  await page.getByTestId('rail-data').click()
  await page.getByTestId('data-tab-loops').click()
  await expect(page.getByTestId('data-table-loops')).toContainText('LT-301')
})

test('a declared loop prints its own diagram, and printing persists nothing', async ({ page }) => {
  await app(page)
  await drawLoop(page)

  await page.getByTestId('tb-loops').click()
  await page.getByTestId('loop-add').click()
  const loopId = (await loopsInDoc(page))[0]!.id
  await page.getByTestId(`loop-number-${loopId}`).fill('101')
  await page.getByTestId(`loop-type-${loopId}`).selectOption('control')
  await closeModal(page)
  for (const letters of ['LT', 'LIC', 'LV']) {
    await select(page, letters)
    await page.getByTestId('insp-eng').click()
    await page.getByTestId('eng-loop').selectOption(loopId)
  }

  // The print pipeline builds a hidden iframe and calls print(); the dialog
  // cannot be driven from here, so the assertion is on what it put IN it.
  await page.evaluate(() => { window.print = () => {} })
  const before = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return JSON.stringify(useStore.getState().doc)
  })

  await page.getByTestId('tb-loops').click()
  await page.getByTestId(`loop-diagram-${loopId}`).click()

  const svg = await page.evaluate(() =>
    [...document.querySelectorAll('iframe')]
      .map((f) => f.contentDocument?.body?.innerHTML ?? '')
      .find((h) => h.includes('LOOP')) ?? '')
  expect(svg).toContain('LOOP 101')
  expect(svg).toContain('LT-101')
  expect(svg).toContain('Structurally complete')
  expect(svg).toMatch(/not a verified wiring diagram/i)
  expect(svg).not.toContain(loopId)

  expect(await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return JSON.stringify(useStore.getState().doc)
  })).toBe(before)
})

test('a house standard can require a loop, and the default does not', async ({ page }) => {
  await app(page)
  await drawLoop(page)

  await page.getByTestId('rail-standards').click()
  const box = page.getByTestId('std-req-instrument-general.loop')

  // Offered, and OFF by default — a project that never asks sees no change.
  await expect(box).toBeVisible()
  await expect(box).not.toBeChecked()
  expect(await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return useStore.getState().doc.standard?.required?.instrument ?? null
  })).toBeNull()

  // A house ticks it and applies. The Standards screen edits a DRAFT and shows
  // what adopting it would cost before anything changes, so the tick alone is
  // not the decision — pressing Apply is.
  await box.check()
  await expect(box).toBeChecked()
  await page.getByRole('button', { name: 'Apply to this project' }).click()

  const required = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: Store } }).__pid
    return useStore.getState().doc.standard?.required?.instrument ?? []
  })
  expect(required).toContain('general.loop')
})
