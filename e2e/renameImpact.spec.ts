import { expect, test, type Page } from '@playwright/test'

async function store(page: Page) {
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.rail')).toBeVisible()
}

/** A tagged instrument with a record, an HMI widget bound to it, and a record
 *  field that merely MENTIONS the tag in prose. */
async function seed(page: Page) {
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const id = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 200, y: 160, rotation: 0 })
    s.setTag(id, { letters: 'LT', loop: '101' })
    s.setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
    s.setRecordField('P-101', 'equipment', 'general.line', 'from LT-101 header')
    const screenId = useStore.getState().addScreen()
    const sc = useStore.getState().doc.hmiScreens.find((x: any) => x.id === screenId)
    useStore.getState().replaceScreen({
      ...sc,
      widgets: [{ id: 'w1', type: 'tank', x: 0, y: 0, w: 96, h: 128, tag: 'LT-101', label: 'Tank Level' }],
    })
    useStore.getState().setSelection([id])
  })
  await page.getByTestId('insp-symbol').click()
}

test('a rename shows what will follow it before anything moves', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await seed(page)

  await page.locator('.tag-loop').fill('201')

  // The preview appears against the DRAFT — nothing has been committed yet.
  await expect(page.getByTestId('rename-impact')).toBeVisible()
  await expect(page.getByTestId('rename-impact-auto')).toContainText('1 engineering record')
  await expect(page.getByTestId('rename-impact-auto')).toContainText('1 HMI widget')
  await expect(page.getByTestId('rename-impact-review')).toContainText('general.line')

  const stillOld = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    return Boolean(useStore.getState().doc.registry['LT-101'])
  })
  expect(stillOld).toBe(true)

  // Applying carries the AUTO references and leaves the typed sentence alone.
  await page.getByTestId('tag-apply').click()
  const after = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const d = useStore.getState().doc
    return {
      moved: Boolean(d.registry['LT-201']),
      oldGone: !d.registry['LT-101'],
      widget: d.hmiScreens[0].widgets[0].tag,
      prose: d.registry['P-101'].fields['general.line'],
    }
  })
  expect(after).toEqual({
    moved: true, oldGone: true, widget: 'LT-201', prose: 'from LT-101 header',
  })
})

test('moving focus out of the tag fields applies the draft', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await seed(page)

  await page.locator('.tag-loop').fill('201')
  await page.locator('.props').click() // focus leaves the tag row

  const widget = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    return useStore.getState().doc.hmiScreens[0].widgets[0].tag
  })
  expect(widget).toBe('LT-201')
})

test('a colliding rename is refused, and says so before it is applied', async ({ page }) => {
  await page.goto('/app')
  await store(page)
  await seed(page)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    useStore.getState().setRecordField('LT-201', 'instrument', 'signal.range', '0-250 bar')
  })

  await page.locator('.tag-loop').fill('201')
  await expect(page.getByTestId('rename-impact-blocked')).toContainText('already has an engineering record')

  await page.getByTestId('tag-apply').click()
  const after = await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const d = useStore.getState().doc
    return {
      old: d.registry['LT-101'].fields['signal.range'],
      other: d.registry['LT-201'].fields['signal.range'],
      widget: d.hmiScreens[0].widgets[0].tag,
    }
  })
  expect(after).toEqual({ old: '0-10 bar', other: '0-250 bar', widget: 'LT-101' })
})
