// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Identify an attached image by its BYTES and read its declared dimensions
 * without decoding it. Pure — no DOM, no File — so the whole gate is unit
 * tested in the default node environment.
 *
 * The order is the security argument. `File.type` is the filename's extension
 * in disguise: the browser fills it from the OS extension→MIME map and never
 * looks at a byte, so `evil.exe` renamed `shot.png` arrives as `image/png`.
 * The `accept=` attribute on the file input is a picker default with no effect
 * at all on the drop and paste paths. And `file.size` cannot see that a 6 kB
 * PNG legally declares 225000×225000 — 202 GB of RGBA the moment anything
 * decodes it. Everything downstream (decode, canvas, encode) allocates, so
 * nothing downstream may run until these numbers have passed the caps here.
 *
 * PNG, JPEG and WebP only. SVG is rejected because it is a scriptable XML
 * document rather than a picture, has no magic bytes to sniff (it may start
 * with a BOM, `<?xml`, a DOCTYPE, a comment or whitespace), and has no
 * intrinsic pixel size for the caps to check. GIF is rejected because it is an
 * animation container whose LZW is a decompression amplifier and whose trailer
 * leaves free polyglot space. Neither is ever produced by a screenshot tool, so
 * neither costs a real user anything.
 *
 * Do NOT reach for `import/svgSymbol.ts` to make SVG work here. That sanitiser
 * is right for its job — symbols a user curates for their own drawing — and
 * wrong for this one: an attachment arrives from a possibly hostile party and
 * is read by the maintainer, which is a different trust level entirely.
 */

export type ImageKind = 'png' | 'jpeg' | 'webp'
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

export interface Probe {
  kind: ImageKind
  mime: ImageMime
  width: number
  height: number
}

/** A rejection whose message is meant to be shown verbatim: every one of them
 *  names the thing to do next, because "invalid file" tells nobody anything. */
export class ImageRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageRejected'
  }
}

/** `file.size` is metadata — free to read, and it must be checked before
 *  `arrayBuffer()` or a dropped 4 GB video kills the tab. 5 MB is far larger
 *  than any real screenshot and is the number the dialog's fine print states. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Decoded RGBA costs exactly w × h × 4 and both numbers are in the header.
 *  8000 px a side covers a dual-5K capture; 32 MP is 128 MB peak, which clears
 *  a 5K iMac (14.7 MP) and a Pro Display XDR (20.4 MP) with room over. */
export const MAX_SIDE = 8000
export const MAX_PIXELS = 32_000_000

/** Below this there is nothing to see, and it is the shape a tracking pixel
 *  and a favicon arrive in. */
export const MIN_SIDE = 40

const u32be = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!
const u32le = (b: Uint8Array, o: number) =>
  b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16) + ((b[o + 3]! << 24) >>> 0)
const u24le = (b: Uint8Array, o: number) => b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16)
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) + b[o + 1]!
const u16le = (b: Uint8Array, o: number) => b[o]! + (b[o + 1]! << 8)
const at = (b: Uint8Array, o: number, sig: readonly number[]) => sig.every((v, i) => b[o + i] === v)
const fourcc = (b: Uint8Array, o: number) =>
  String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0)

// The PNG signature is deliberately adversarial: \x89 trips 7-bit-clean
// transports, \r\n and \n catch line-ending mangling, \x1a is DOS EOF. Check
// all eight bytes, not the four everybody checks.
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const IHDR = [0x49, 0x48, 0x44, 0x52] as const
const RIFF = [0x52, 0x49, 0x46, 0x46] as const
const WEBP = [0x57, 0x45, 0x42, 0x50] as const

const NOT_AN_IMAGE = 'That file is not a PNG, JPEG or WebP screenshot. Attach a screenshot, or send the report without one.'

/**
 * What the bytes actually are, ignoring the filename and the browser's MIME
 * guess entirely. Throws `ImageRejected` for everything that is not a still
 * PNG, JPEG or WebP — naming the format where it can, because "that is a PDF"
 * gets someone unstuck and "invalid file" does not.
 */
export function probeImage(b: Uint8Array): Probe {
  // ---- PNG ---------------------------------------------------------------
  if (at(b, 0, PNG_SIG)) {
    if (b.length < 33 || !at(b, 12, IHDR) || u32be(b, 8) !== 13) {
      throw new ImageRejected('That PNG is malformed. Take a fresh screenshot and attach that instead.')
    }
    return { kind: 'png', mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20) }
  }

  // ---- JPEG --------------------------------------------------------------
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // Dimensions live in a SOF marker, so the segment chain has to be walked.
    // Markers 01 (TEM) and D0–D9 (RSTn, SOI, EOI) are standalone with no length
    // field; any number of FF fill bytes may precede a marker; DA (SOS) starts
    // entropy-coded data, where the marker grammar stops applying.
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]!
      if (m === 0xff) { i++; continue }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue }
      if (m === 0xda) break
      // C4 is DHT, C8 is JPG and CC is DAC — in the Cn range but not SOF.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        // SOF payload: len(2) precision(1) height(2) width(2) — height first.
        return { kind: 'jpeg', mime: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) }
      }
      const len = u16be(b, i + 2)
      if (len < 2) break
      i += 2 + len
    }
    throw new ImageRejected('That JPEG is malformed. Take a fresh screenshot and attach that instead.')
  }

  // ---- WebP --------------------------------------------------------------
  // RIFF alone is also WAV and AVI, so bytes 8..12 have to say WEBP too.
  if (at(b, 0, RIFF) && at(b, 8, WEBP)) {
    const chunk = fourcc(b, 12)
    if (chunk === 'VP8 ') {
      if (!at(b, 23, [0x9d, 0x01, 0x2a])) {
        throw new ImageRejected('That WebP is malformed. Take a fresh screenshot and attach that instead.')
      }
      return {
        kind: 'webp', mime: 'image/webp',
        width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff,
      }
    }
    if (chunk === 'VP8L') {
      if (b[20] !== 0x2f) {
        throw new ImageRejected('That WebP is malformed. Take a fresh screenshot and attach that instead.')
      }
      const v = u32le(b, 21)
      return {
        kind: 'webp', mime: 'image/webp',
        width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1,
      }
    }
    if (chunk === 'VP8X') {
      // Bit 0x02 of the flags byte is ANIMATION. drawImage would silently keep
      // frame one, which is a bait-and-switch — say so instead.
      if ((b[20]! & 0x02) !== 0) {
        throw new ImageRejected('That is an animated WebP. Attach a still screenshot instead.')
      }
      return { kind: 'webp', mime: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
    }
    throw new ImageRejected('That WebP uses a form IPD Studio does not read. Re-save it as a PNG.')
  }

  // ---- named rejections, so the message can be acted on -------------------
  if (at(b, 0, [0x47, 0x49, 0x46, 0x38])) {
    throw new ImageRejected('GIFs are not accepted — they are animations. Attach a still PNG or JPEG.')
  }
  if (at(b, 4, [0x66, 0x74, 0x79, 0x70])) {
    throw new ImageRejected('HEIC and AVIF are not accepted. Export the image as a PNG or JPEG and attach that.')
  }
  if (at(b, 0, [0x42, 0x4d])) {
    throw new ImageRejected('BMP is not accepted. Attach a PNG, JPEG or WebP.')
  }
  if (at(b, 0, [0x49, 0x49, 0x2a, 0x00]) || at(b, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
    throw new ImageRejected('Your clipboard produced a TIFF. Take the screenshot with your system shortcut and attach the file instead.')
  }
  if (at(b, 0, [0x25, 0x50, 0x44, 0x46])) {
    throw new ImageRejected('PDFs are not accepted. Attach a screenshot as a PNG, JPEG or WebP.')
  }
  if (at(b, 0, [0x50, 0x4b, 0x03, 0x04])) {
    throw new ImageRejected('That is a zip archive, not an image.')
  }
  if (at(b, 0, [0x4d, 0x5a]) || at(b, 0, [0x7f, 0x45, 0x4c, 0x46])) {
    throw new ImageRejected('That is a program, not an image.')
  }
  if (looksLikeSvg(b)) {
    throw new ImageRejected('SVG is not accepted here — it can carry scripts. Screenshot it as a PNG and attach that.')
  }
  throw new ImageRejected(NOT_AN_IMAGE)
}

/**
 * SVG has no magic bytes, so this is a best-effort sniff whose only job is a
 * better error message — the allowlist above has already rejected the file by
 * the time anyone asks. Skips a UTF-8 BOM and leading whitespace, then looks
 * for the two openings an SVG can actually start with.
 */
function looksLikeSvg(b: Uint8Array): boolean {
  let i = at(b, 0, [0xef, 0xbb, 0xbf]) ? 3 : 0
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++
  const head = String.fromCharCode(...b.slice(i, i + 5)).toLowerCase()
  return head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!doc')
}

/**
 * Walk the PNG chunk table. Two things matter: an `acTL` before the first
 * `IDAT` (APNG — `drawImage` keeps only the default frame, silently), and any
 * byte living past `IEND`, which is where the appended-ZIP/HTML polyglot goes.
 * Every decoder ignores that tail; every content-sniffing consumer does not.
 *
 * This is defence in depth and a better error message. The re-encode in
 * `screenshot.ts` is what actually destroys an appended payload.
 */
export function auditPng(b: Uint8Array): void {
  let i = 8
  let seenIdat = false
  while (i + 12 <= b.length) {
    const len = u32be(b, i)
    const type = fourcc(b, i + 4)
    if (type === 'acTL' && !seenIdat) {
      throw new ImageRejected('That is an animated PNG. Attach a still screenshot instead.')
    }
    if (type === 'IDAT') seenIdat = true
    if (type === 'IEND') {
      if (i + 12 !== b.length) {
        throw new ImageRejected('That PNG has extra data appended after the image. Take a fresh screenshot and attach that instead.')
      }
      return
    }
    // A length field larger than the file is either corruption or a deliberate
    // walk-off-the-end; both end here.
    if (len > b.length) break
    i += 12 + len
  }
  throw new ImageRejected('That PNG is truncated. Take a fresh screenshot and attach that instead.')
}

/** RIFF carries the file length in its header, so appended data is four bytes
 *  away from being detectable. The spec pads chunks to an even length, hence
 *  the ±1. */
export function auditWebp(b: Uint8Array): void {
  const declared = 8 + u32le(b, 4)
  if (declared !== b.length && declared + 1 !== b.length) {
    throw new ImageRejected('That WebP has extra data appended after the image. Take a fresh screenshot and attach that instead.')
  }
}

/** JPEG readers stop at EOI, so everything past it is free polyglot space. */
export function auditJpeg(b: Uint8Array): void {
  if (!(b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9)) {
    throw new ImageRejected('That JPEG has extra data appended after the image. Take a fresh screenshot and attach that instead.')
  }
}

/** Sizes for humans. Deliberately a local copy rather than an import of
 *  `cloud/sync.ts` — that module pulls `firebase/firestore` into whatever
 *  imports it, and this one is on the path that runs before any send. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The byte gate, run on `file.size` before a single byte is read. */
export function checkFileSize(bytes: number): void {
  if (bytes === 0) throw new ImageRejected('That file is empty.')
  if (bytes > MAX_FILE_BYTES) {
    throw new ImageRejected(
      `That screenshot is ${formatBytes(bytes)}, over the ${formatBytes(MAX_FILE_BYTES)} limit. ` +
      'Crop it to the part that shows the problem, or attach a JPEG instead of a PNG.',
    )
  }
}

/** The pixel gate, run on the header's numbers before anything decodes them.
 *  Deliberately shape-blind: a 200 × 3000 crop of one sidebar is a real
 *  screenshot, and an aspect-ratio heuristic would reject it while happily
 *  passing a screenshot-shaped photo of a whiteboard. */
export function checkDimensions(width: number, height: number): void {
  if (width < MIN_SIDE || height < MIN_SIDE) {
    throw new ImageRejected(`That image is ${width} × ${height} — too small to show anything. Attach the actual screenshot.`)
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new ImageRejected(`That image is ${width} × ${height}, over the ${MAX_SIDE} px limit on a side. Crop it and try again.`)
  }
  if (width * height > MAX_PIXELS) {
    throw new ImageRejected(`That image is ${width} × ${height}, too many pixels to process here. Crop it and try again.`)
  }
}

/**
 * The whole byte-level gate in one call: identify, structurally audit, and
 * bound. Everything it accepts is still re-encoded before it is sent — this
 * decides what is worth handing to a decoder, not what is safe to store.
 */
export function inspectImage(bytes: Uint8Array): Probe {
  const found = probeImage(bytes)
  if (found.kind === 'png') auditPng(bytes)
  else if (found.kind === 'jpeg') auditJpeg(bytes)
  else auditWebp(bytes)
  checkDimensions(found.width, found.height)
  return found
}
