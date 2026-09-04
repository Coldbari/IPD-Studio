import { expect, test, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'

/** A real, decodable PNG — the drop zone re-encodes what it accepts, so a
 *  hand-built header would be rejected by the browser's own decoder before the
 *  preview ever appeared. Built here rather than committed as a fixture so the
 *  dimensions in each assertion are visible in the test that makes them. */
function realPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // colour type: truecolour
  // One filter byte per scanline, then RGB triples. Mid-grey, so a JPEG
  // fallback encoder cannot collapse it to nothing.
  const raw = Buffer.concat(
    Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)])),
  )
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function openDialog(page: Page) {
  await page.goto('/app')
  await page.waitForFunction(() => '__pid' in window)
  await page.getByTestId('feedback-chip').click()
  await expect(page.getByTestId('feedback-dialog')).toBeVisible()
}

test('feedback: one form serves bugs and suggestions, and it rewrites itself', async ({ page }) => {
  await openDialog(page)

  // Bug is the default, and the placeholders prove the toggle changes the form
  // rather than just a stored value.
  await expect(page.getByTestId('feedback-type-bug')).toBeChecked()
  await expect(page.getByTestId('feedback-body')).toHaveAttribute('placeholder', /what happened instead/i)
  // Click the label, not the input: the radios are clipped to a pixel so they
  // stay focusable and announced while the <span> carries the paint.
  await page.locator('.fb-seg-opt', { hasText: 'Suggestion' }).click()
  await expect(page.getByTestId('feedback-type-suggestion')).toBeChecked()
  await expect(page.getByTestId('feedback-body')).toHaveAttribute('placeholder', /why the current way does not work/i)

  // The title counter stays out of the way until the cap is in sight — an
  // always-visible one reads as a quota to fill.
  await expect(page.getByTestId('feedback-title-count')).toHaveCount(0)
  await page.getByTestId('feedback-title').fill('x'.repeat(65))
  await expect(page.getByTestId('feedback-title-count')).toHaveText('65 / 80')
  await page.getByTestId('feedback-title').fill('x'.repeat(400))
  await expect(page.getByTestId('feedback-title')).toHaveValue('x'.repeat(80))

  // What is attached is on screen, not implied.
  await page.getByTestId('feedback-context').getByText('Sent with this report').click()
  await expect(page.getByTestId('feedback-context')).toContainText('No part of your drawing is sent')
})

test('feedback: only a real raster image is accepted as a screenshot', async ({ page }) => {
  await openDialog(page)
  const file = page.getByTestId('feedback-file')

  // A PDF wearing a .png name. `accept="image/png"` and File.type would both
  // have waved this through — both only ever look at the filename.
  await file.setInputFiles({
    name: 'screenshot.png',
    mimeType: 'image/png',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'),
  })
  await expect(page.getByTestId('feedback-alert')).toContainText('PDFs are not accepted')
  await expect(page.getByTestId('feedback-preview')).toHaveCount(0)

  // An SVG — nominally an image, actually a scriptable document.
  await file.setInputFiles({
    name: 'shot.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  })
  await expect(page.getByTestId('feedback-alert')).toContainText('it can carry scripts')

  // A structurally valid PNG with a payload appended after IEND. Every decoder
  // ignores that tail; the audit names it, and the re-encode would have
  // destroyed it anyway.
  await file.setInputFiles({
    name: 'polyglot.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([realPng(400, 300), Buffer.from('<script>fetch("//evil")</script>')]),
  })
  await expect(page.getByTestId('feedback-alert')).toContainText('extra data appended')

  // Too small to show anything.
  await file.setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: realPng(8, 8) })
  await expect(page.getByTestId('feedback-alert')).toContainText('too small')
  await expect(page.getByTestId('feedback-preview')).toHaveCount(0)
})

test('feedback: a genuine screenshot attaches, previews and can be removed', async ({ page }) => {
  await openDialog(page)
  await page.getByTestId('feedback-file').setInputFiles({
    name: 'Screen Shot.png', mimeType: 'image/png', buffer: realPng(400, 300),
  })

  await expect(page.getByTestId('feedback-preview')).toBeVisible()
  await expect(page.getByTestId('feedback-preview-name')).toHaveText('Screen Shot.png')
  await expect(page.getByTestId('feedback-preview-dims')).toContainText('400 × 300')
  // Says out loud that what is attached is not the file that arrived.
  await expect(page.getByTestId('feedback-preview-dims')).toContainText('re-encoded as')
  await expect(page.getByTestId('feedback-status')).toContainText('Screenshot attached — 400 × 300.')

  // The preview never points at the original file — a blob: URL inherits this
  // origin, so a polyglot opened from one would run as same-origin script.
  const src = await page.getByTestId('feedback-preview').locator('img').getAttribute('src')
  expect(src).toMatch(/^blob:/)

  await page.getByTestId('feedback-remove').click()
  await expect(page.getByTestId('feedback-drop')).toBeVisible()
  await expect(page.getByTestId('feedback-status')).toContainText('Screenshot removed.')
})

test('feedback: with nowhere to send, the form still gives you a way out', async ({ page }) => {
  await openDialog(page)
  // Two ways to reach this state: a fork or CI with no .env.local (no inbox at
  // all), and the dev bypass these specs run under, which opens the editor
  // with no signed-in account. Either way there is nothing to write to, and a
  // dialog whose only button is dead would be worse than no dialog.
  await expect(page.getByTestId('feedback-copy')).toBeVisible()
  await expect(page.getByTestId('feedback-send')).toHaveCount(0)
  await expect(page.getByTestId('feedback-cancel')).toBeVisible()
})

test('feedback: a half-written report is not lost to a stray click on the backdrop', async ({ page }) => {
  await openDialog(page)
  await page.getByTestId('feedback-title').fill('Line jumps to the wrong port after undo')
  await page.getByTestId('feedback-body').fill('Drew a signal line, pressed Ctrl+Z, it reattached wrongly.')

  // Select inside the textarea and release outside the card: the click lands
  // on the overlay, and before the mousedown fix that closed the dialog.
  const box = (await page.locator('.datasheet-box').boundingBox())!
  await page.mouse.move(box.x + 40, box.y + box.height - 20)
  await page.mouse.down()
  await page.mouse.move(box.x - 80, box.y + box.height + 60)
  await page.mouse.up()

  await expect(page.getByTestId('feedback-dialog')).toBeVisible()
  await expect(page.getByTestId('feedback-title')).toHaveValue('Line jumps to the wrong port after undo')
})

test('feedback: the chip is in the HMI status bar too', async ({ page }) => {
  await page.goto('/app/hmi')
  await page.waitForFunction(() => '__pid' in window)
  await expect(page.locator('.hmi-status').getByTestId('feedback-chip')).toBeVisible()
})
