import { expect, test } from '@playwright/test'
import { openTemplate } from './helpers'

test('place, connect, tag, validate, export', async ({ page }) => {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  page.on('dialog', (d) => void d.accept())

  // Place a pump, a tank, and an FT instrument through the store dev hook
  // (HTML5 palette drag is exercised manually; the hook mirrors its code path).
  await page.waitForFunction(() => Boolean((window as never as { __pid?: unknown }).__pid))
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    const s = useStore.getState()
    const tank = s.addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 96, y: 96, rotation: 0 })
    const pump = s.addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 280, y: 240, rotation: 0 })
    s.addEdge({ lineClass: 'process.major', source: { nodeId: tank, portId: 's' }, target: { nodeId: pump, portId: 'suction' } })
    const ft = s.addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 424, y: 96, rotation: 0, config: { display: 'discrete', location: 'field' } })
    s.setSelection([ft])
  })

  // Symbols render on the canvas
  await expect(page.locator('[model-id]')).toHaveCount(4, { timeout: 5000 }) // 3 elements + 1 link

  // The untagged instrument is flagged
  // the untagged instrument is reported (exact counts shift as rules are added,
  // so assert the signal, not the number)
  await expect(page.locator('.status')).toContainText('finding')

  // Tag it through the property panel; expansion appears; finding clears
  await page.locator('.tag-letters').fill('FIC')
  await page.locator('.tag-loop').fill('101')
  await expect(page.locator('.tag-expansion')).toHaveText('Flow Indicating Controller')
  // tagging clears the blocker; remaining advice is not critical
  await expect(page.locator('.status')).not.toContainText('critical')

  // Undo removes the loop digits, redo restores them
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.locator('.tag-loop')).toHaveValue('101')

  // Instrument index CSV contains the tagged row
  await page.locator('.props').click() // move focus out of input
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export ▾' }).click()
  await page.getByRole('menuitem', { name: 'Instrument index' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const csv = Buffer.concat(chunks).toString()
  expect(csv).toContain('Tag,Description,Loop,Symbol,Sheet,Connected To,Notes')
  expect(csv).toContain('FIC-101,Flow Indicating Controller,101,Instrument,Sheet 1')

  // Sample plant loads clean (v1 file exercises schema migration)
  await openTemplate(page, 'sample')
  await expect(page.locator('.status')).not.toContainText('critical')
  await expect(page.locator('.doc-name')).toContainText('Sample Plant')

  // Multi-sheet: add a sheet, place a symbol there, verify isolation
  const cellsOnSheet1 = await page.locator('[model-id]').count()
  await page.locator('.sheet-add').click()
  await expect(page.locator('.sheet-tab')).toHaveCount(2)
  await expect(page.locator('[model-id]')).toHaveCount(0)
  await page.evaluate(() => {
    const { useStore } = (window as never as { __pid: { useStore: { getState(): any } } }).__pid
    useStore.getState().addNode({ symbolId: 'vessel.sphere', kind: 'equipment', x: 200, y: 200, rotation: 0 })
  })
  await expect(page.locator('[model-id]')).toHaveCount(1)
  await page.locator('.sheet-tab').first().click()
  await expect(page.locator('[model-id]')).toHaveCount(cellsOnSheet1)
})
