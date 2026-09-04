// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import {
  ImageRejected, checkFileSize, formatBytes, inspectImage, type ImageMime,
} from './probe'

/**
 * Turning a candidate file into the screenshot that is actually sent.
 *
 * The decisive defence in this whole feature is here and it is one sentence:
 * **the user's bytes are never stored**. The file is decoded into pixels and
 * those pixels are re-encoded by the browser's own encoder, so what leaves the
 * machine is an image the browser wrote — not the file that arrived. That
 * destroys, unconditionally: anything appended after IEND / EOI / the RIFF
 * length (the HTML, JS, ZIP and PHAR polyglots), every EXIF and XMP block
 * including GPS coordinates and the camera serial, ICC profile payloads, and
 * any malformed structure aimed at a downstream decoder. It cannot un-take a
 * photograph — nothing in a browser can prove an image is "a genuine
 * screenshot", and the dialog's copy is careful not to claim otherwise.
 *
 * `probe.ts` runs first anyway, for three reasons: it fails fast with a message
 * that names the format, it rejects animation and appended data explicitly
 * rather than silently keeping frame one, and above all it reads the declared
 * dimensions BEFORE anything allocates, which is the only place a pixel bomb
 * can be stopped. A 6 kB PNG declaring 225000×225000 is 202 GB of RGBA, and by
 * the time `createImageBitmap` resolves the allocation has already happened.
 */

/** What the back-off loop aims at, and where it gives up. Firestore caps a
 *  document at 1 048 576 bytes; the text half is capped at 40 kB by
 *  `report.ts`, so 500 kB of image leaves the record at roughly half the
 *  limit. The same "leave the cap a wide margin" reasoning as MAX_DOC_BYTES in
 *  `cloud/sync.ts` — a size rejection from Firestore is unreadable. */
export const SHOT_TARGET_BYTES = 380_000
export const SHOT_MAX_BYTES = 500_000

/** 1600 px on the long side. A bug report is read on a laptop, where 1600 is
 *  full width and still legible zoomed; 2000 costs ~55% more bytes for detail
 *  nobody reads, and 1280 starts making the 11 px tag text this app exists to
 *  show unreadable. */
const SIDES = [1600, 1280, 1024, 800]
const QUALITIES = [0.82, 0.7, 0.6, 0.5, 0.42]

export type ShotSource = 'file' | 'paste' | 'capture' | 'sheet'

export interface Screenshot {
  /** The re-encoded image. The original File is not reachable from here on
   *  purpose — nothing downstream should be able to reach for it by mistake. */
  blob: Blob
  mime: ImageMime
  width: number
  height: number
  bytes: number
  /** Object URL of the re-encoded blob, for the preview. Never of the original
   *  file: a `blob:` URL inherits this page's origin, and an SVG or HTML
   *  polyglot opened from one — by a middle-click, a devtools "open in new
   *  tab", anything — would run as same-origin script with the user's Firebase
   *  session. Revoke it via `releaseScreenshot`. */
  url: string
  /** What the preview calls it. Never used as a path, and never the original
   *  filename verbatim — see `label()`. */
  name: string
  source: ShotSource
}

export function releaseScreenshot(shot: Screenshot | null): void {
  if (shot) URL.revokeObjectURL(shot.url)
}

/**
 * A display label derived from the original filename. The name describes bytes
 * that no longer exist, so it is decoration — but it still reaches a
 * maintainer's screen, so it loses directory separators (path traversal in any
 * triage script that writes it to disk), control characters, and bidi
 * overrides (U+202E renders a `.exe` as a `.png`).
 */
function label(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 60)
  return base || 'screenshot'
}

/** Browsers that cannot encode a format do not throw — they hand back a PNG
 *  with a straight face. Ask a 1×1 canvas first, and check `blob.type` after. */
let webpOk: boolean | null = null
function canEncodeWebp(): boolean {
  if (webpOk === null) {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      webpOk = c.toDataURL('image/webp').startsWith('data:image/webp')
    } catch {
      webpOk = false
    }
  }
  return webpOk
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  // Callback first — `canvas.toBlob('image/png')` is a TypeError, and it is the
  // single most common way to get this wrong. Same shape as export/png.ts.
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality))
}

/** `createImageBitmap` resizes inside the decode pipeline with a real filter,
 *  which is visibly sharper on screenshot text than a `drawImage` squeeze — but
 *  the options bag is not universally honoured, and the whole API is missing on
 *  older Safari. Three rungs, each one narrower than the last. */
async function decode(blob: Blob, w: number, h: number): Promise<CanvasImageSource & { close?(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        resizeWidth: w, resizeHeight: h, resizeQuality: 'high', imageOrientation: 'from-image',
      })
    } catch {
      try {
        return await createImageBitmap(blob)
      } catch {
        /* fall through to the image element */
      }
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new ImageRejected(
        'That image could not be decoded — it may be damaged. Take a fresh screenshot and attach that instead.',
      ))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Decode, repaint, re-encode, backing off until it fits the budget.
 *
 * Quality before size: a report screenshot losing a little crispness is fine,
 * losing enough pixels that the tag text is unreadable is not. Both loops are
 * bounded — twenty encodes worst case — because "keep halving until it fits" is
 * itself a way to hang a slow machine.
 *
 * The white fill is not cosmetic. A macOS window capture carries a transparent
 * drop-shadow border that renders black on a dark triage screen, and JPEG has
 * no alpha at all. `export/png.ts` paints white for the same reason.
 */
async function reencode(
  blob: Blob, srcW: number, srcH: number,
): Promise<{ blob: Blob; mime: ImageMime; width: number; height: number }> {
  const wanted: ImageMime = canEncodeWebp() ? 'image/webp' : 'image/jpeg'
  let best: { blob: Blob; mime: ImageMime; width: number; height: number } | null = null

  for (const side of SIDES) {
    const scale = Math.min(1, side / Math.max(srcW, srcH))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))

    const bitmap = await decode(blob, w, h)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      bitmap.close?.()
      throw new ImageRejected('Your browser could not process that image. Send the report without it and describe what you saw.')
    }
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    for (const quality of QUALITIES) {
      const out = await toBlob(canvas, wanted, quality)
      if (!out) continue
      // An encoder that does not know the format silently returns PNG, so the
      // stored mime is the blob's own type, never the one we asked for.
      const mime: ImageMime = out.type === 'image/webp' ? 'image/webp'
        : out.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
      if (!best || out.size < best.blob.size) best = { blob: out, mime, width: w, height: h }
      if (out.size <= SHOT_TARGET_BYTES) {
        // Safari holds the backing store of a canvas until it is zeroed.
        canvas.width = canvas.height = 0
        return { blob: out, mime, width: w, height: h }
      }
      // PNG ignores quality entirely, so a second pass at the same size would
      // produce the identical bytes four more times.
      if (mime === 'image/png') break
    }
    canvas.width = canvas.height = 0
  }

  if (best && best.blob.size <= SHOT_MAX_BYTES) return best
  throw new ImageRejected(
    'That screenshot will not compress small enough to send. Crop it to the part that shows the problem and try again.',
  )
}

function finish(
  out: { blob: Blob; mime: ImageMime; width: number; height: number },
  name: string,
  source: ShotSource,
): Screenshot {
  return {
    blob: out.blob,
    mime: out.mime,
    width: out.width,
    height: out.height,
    bytes: out.blob.size,
    url: URL.createObjectURL(out.blob),
    name,
    source,
  }
}

/**
 * The one door every attachment comes through — chosen, dropped or pasted.
 * Size gate, byte gate, pixel gate, then the re-encode. Throws `ImageRejected`
 * with a message meant to be shown verbatim.
 */
export async function acceptFile(file: File, source: ShotSource): Promise<Screenshot> {
  checkFileSize(file.size)
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Re-check after the read: `file.size` is metadata, and a file on a network
  // share can be a different length by the time it is actually read.
  checkFileSize(bytes.length)
  const found = inspectImage(bytes)
  // Hand the decoder the buffer that was validated, tagged with the sniffed
  // type — never a second read of the File, and never `file.type`.
  const source_ = new Blob([bytes as unknown as BlobPart], { type: found.mime })
  const out = await reencode(source_, found.width, found.height)
  return finish(out, source === 'paste' ? 'Pasted from the clipboard' : label(file.name), source)
}

/** The first image on a drop or a paste, and how many were offered. `text/html`
 *  is deliberately never read: a pasted `<img src="https://…">` must not turn
 *  into a fetch to somebody else's server. */
export function imageFromTransfer(data: DataTransfer | null): { file: File | null; count: number } {
  if (!data) return { file: null, count: 0 }
  const files = [...(data.files ?? [])]
  if (files.length > 0) return { file: files[0]!, count: files.length }
  const items = [...(data.items ?? [])].filter((i) => i.kind === 'file')
  const got = items.map((i) => i.getAsFile()).filter((f): f is File => f !== null)
  return { file: got[0] ?? null, count: got.length }
}

/** Chromium-only options TypeScript still does not declare. Other engines
 *  ignore members they do not know rather than throwing, which is what makes it
 *  safe to always send them. */
interface CaptureOptions extends DisplayMediaStreamOptions {
  preferCurrentTab?: boolean
  surfaceSwitching?: 'include' | 'exclude'
  systemAudio?: 'include' | 'exclude'
  controller?: unknown
}

export function canCaptureScreen(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

/**
 * One frame of whatever the user picks in the browser's own share dialog.
 *
 * Must be called straight from the click with no `await` in front of it —
 * an await hands back the transient activation and the request is refused.
 *
 * `audio: false` is not negotiable: asking adds a "share tab audio" checkbox
 * to the picker, and a bug-report button that asks for your microphone reads as
 * spyware. `preferCurrentTab` is the flag that matters most — capturing a tab
 * is in-process, so on macOS the common path never needs the system Screen
 * Recording permission that a window or monitor capture does.
 */
export async function captureScreen(): Promise<Screenshot | null> {
  if (!canCaptureScreen()) {
    throw new ImageRejected(
      'This browser cannot capture the screen from inside the page. Use your system screenshot key and drop the file here.',
    )
  }
  const Controller = (window as unknown as {
    CaptureController?: new () => { setFocusBehavior(b: string): void }
  }).CaptureController
  const controller = Controller ? new Controller() : undefined

  let stream: MediaStream
  try {
    const pending = navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { displaySurface: 'browser', frameRate: { ideal: 5, max: 10 } },
      preferCurrentTab: true,
      surfaceSwitching: 'exclude',
      systemAudio: 'exclude',
      controller,
    } as CaptureOptions)
    // Legal while the promise is still pending, which is why it sits here and
    // not after the await: without it the browser focuses the surface that was
    // picked, burying this dialog behind the window you just pointed at.
    try { controller?.setFocusBehavior('no-focus-change') } catch { /* not supported */ }
    stream = await pending
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? ''
    // NotAllowedError covers "the user cancelled", "Permissions-Policy said no"
    // and "the OS refused" and the three are indistinguishable — one message
    // that is true in all three beats a guess that is accusatory when wrong.
    if (name === 'NotAllowedError' || name === 'AbortError') return null
    if (name === 'NotFoundError') {
      throw new ImageRejected('There was nothing available to capture. Take the screenshot yourself and drop it here instead.')
    }
    throw new ImageRejected('Your browser blocked screen capture. Take the screenshot yourself and drop it here instead.')
  }

  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    // Attached, 1×1 and transparent rather than display:none — Safari will not
    // decode a detached media element, and an undisplayed one may never paint.
    video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(video)
    video.srcObject = stream
    await video.play()
    await firstFrame(video)

    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) {
      throw new ImageRejected('The captured frame came back empty. Take the screenshot yourself and drop it here instead.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new ImageRejected('Your browser could not process the captured frame.')
    ctx.drawImage(video, 0, 0, w, h)
    const raw = await toBlob(canvas, 'image/png', 1)
    canvas.width = canvas.height = 0
    if (!raw) throw new ImageRejected('The captured frame could not be read. Take the screenshot yourself and drop it here instead.')

    // Straight to the budget loop: there is nothing to sniff about a frame this
    // page drew itself, and the byte accounting has to stay uniform.
    const out = await reencode(raw, w, h)
    return finish(out, `Captured ${clock()}`, 'capture')
  } finally {
    // In a finally, not on the happy path: a throw between the picker and the
    // draw must not leave the screen shared with a page that has forgotten it
    // is capturing. This is what clears the sharing bar and the OS indicator.
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
    video.remove()
  }
}

/** `loadedmetadata` only means the dimensions are known — drawing then yields a
 *  black rectangle often enough to matter. `requestVideoFrameCallback` fires on
 *  a genuinely composited frame; two nested rAFs are the fallback where it is
 *  missing. Bounded, so a stream that never paints does not hang the dialog. */
function firstFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish_ = () => { if (!done) { done = true; resolve() } }
    const timer = setTimeout(finish_, 2000)
    const settle = () => { clearTimeout(timer); finish_() }
    const rvfc = (video as unknown as {
      requestVideoFrameCallback?: (cb: () => void) => number
    }).requestVideoFrameCallback
    if (typeof rvfc === 'function') rvfc.call(video, settle)
    else requestAnimationFrame(() => requestAnimationFrame(settle))
  })
}

function clock(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * The fallback where `getDisplayMedia` does not exist: rasterise the drawing
 * sheet itself. Deliberately labelled as a different thing in the UI, because
 * it is — `exportSvg` renders the drawing and none of the surrounding chrome,
 * so it answers "the line routes wrongly" and cannot answer "the panel is
 * behind the dialog". Zero attack surface: the bytes come from this app's own
 * store and never touch the sniffer.
 */
export async function captureSheet(): Promise<Screenshot> {
  const { renderSheetPng } = await import('../export/png')
  const { blob, width, height } = await renderSheetPng(1.5)
  const out = await reencode(blob, width, height)
  return finish(out, `Drawing sheet ${clock()}`, 'sheet')
}

/**
 * The re-encoded image as base64, for the mail attachment.
 *
 * `btoa(String.fromCharCode(...new Uint8Array(buf)))` is the obvious way and it
 * throws RangeError well below this size — spreading half a megabyte into an
 * argument list blows the call stack. Reading a data URL and taking what
 * follows the comma is the form that survives, and the browser does the encode.
 */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new ImageRejected(
      'The screenshot could not be encoded for sending. Remove it and send the report without it.',
    ))
    const reader = new FileReader()
    reader.onerror = fail
    reader.onload = () => {
      const url = String(reader.result)
      const comma = url.indexOf(',')
      if (comma < 0) { fail(); return }
      resolve(url.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/** The attachment filename. Derived from the format, never from what the user
 *  handed over — the original name described bytes that no longer exist, and a
 *  filename is the one string a mail client may write to disk. */
export function attachmentName(shot: Screenshot): string {
  const ext = shot.mime === 'image/webp' ? 'webp' : shot.mime === 'image/jpeg' ? 'jpg' : 'png'
  return `screenshot.${ext}`
}

/** Preview line: `1600 × 1000 · 84 kB · re-encoded as WebP`. Says out loud that
 *  what is attached is not the file that arrived. */
export function describeShot(shot: Screenshot): string {
  const kind = shot.mime === 'image/webp' ? 'WebP' : shot.mime === 'image/jpeg' ? 'JPEG' : 'PNG'
  return `${shot.width} × ${shot.height} · ${formatBytes(shot.bytes)} · re-encoded as ${kind}`
}
