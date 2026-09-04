import { describe, expect, it } from 'vitest'
import {
  ImageRejected, MAX_FILE_BYTES, MAX_SIDE, auditJpeg, auditPng, auditWebp,
  checkDimensions, checkFileSize, formatBytes, inspectImage, probeImage,
} from '../../src/feedback/probe'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** A PNG chunk. The CRC is left zeroed on purpose — nothing in probe.ts reads
 *  it, and a test that computed one would be asserting the test helper. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(ascii(type), 4)
  out.set(data, 8)
  return out
}

const PNG_SIG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function ihdr(w: number, h: number): Uint8Array {
  const d = new Uint8Array(13)
  const dv = new DataView(d.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  d[8] = 8   // bit depth
  d[9] = 6   // colour type: RGBA
  return d
}

function png(w = 400, h = 300, opts: { animated?: boolean; trailing?: Uint8Array } = {}): Uint8Array {
  return join(
    PNG_SIG,
    chunk('IHDR', ihdr(w, h)),
    ...(opts.animated ? [chunk('acTL', new Uint8Array(8))] : []),
    chunk('IDAT', new Uint8Array(16)),
    chunk('IEND', new Uint8Array(0)),
    opts.trailing ?? new Uint8Array(0),
  )
}

function jpeg(w = 400, h = 300, opts: { trailing?: Uint8Array } = {}): Uint8Array {
  const sof = new Uint8Array(19)
  const dv = new DataView(sof.buffer)
  sof[0] = 0xff
  sof[1] = 0xc0
  dv.setUint16(2, 17)  // segment length
  sof[4] = 8           // precision
  dv.setUint16(5, h)   // height comes first
  dv.setUint16(7, w)
  sof[9] = 3           // component count
  return join(
    bytes(0xff, 0xd8),
    bytes(0xff, 0xe0, 0x00, 0x04, 0x00, 0x00),   // a JFIF-shaped APP0 to walk past
    sof,
    bytes(0xff, 0xda, 0x00, 0x02),               // SOS
    bytes(0x00, 0x11, 0x22),                     // entropy-coded bytes
    opts.trailing ?? new Uint8Array(0),
    bytes(0xff, 0xd9),
  )
}

/** A lossless WebP — the shortest of the three variants to build by hand. */
function webp(w = 400, h = 300, opts: { trailing?: Uint8Array } = {}): Uint8Array {
  const body = new Uint8Array(13)
  body.set(ascii('VP8L'), 0)
  new DataView(body.buffer).setUint32(4, 5, true)   // chunk payload size
  body[8] = 0x2f
  new DataView(body.buffer).setUint32(9, (w - 1) | ((h - 1) << 14), true)
  const trailing = opts.trailing ?? new Uint8Array(0)
  const head = new Uint8Array(12)
  head.set(ascii('RIFF'), 0)
  new DataView(head.buffer).setUint32(4, 4 + body.length, true)  // filesize − 8
  head.set(ascii('WEBP'), 8)
  return join(head, body, trailing)
}

describe('probeImage — identity comes from the bytes, never the name', () => {
  it('reads PNG dimensions out of IHDR', () => {
    expect(probeImage(png(1280, 800))).toMatchObject({ kind: 'png', mime: 'image/png', width: 1280, height: 800 })
  })

  it('walks the JPEG segment chain to SOF, where height precedes width', () => {
    expect(probeImage(jpeg(1920, 1080))).toMatchObject({ kind: 'jpeg', width: 1920, height: 1080 })
  })

  it('reads a lossless WebP bitfield', () => {
    expect(probeImage(webp(1024, 768))).toMatchObject({ kind: 'webp', mime: 'image/webp', width: 1024, height: 768 })
  })

  // RIFF on its own is also WAV and AVI, so the form type at byte 8 has to
  // agree before anything is treated as an image.
  it('does not accept a RIFF container that is not WEBP', () => {
    const wav = webp()
    wav.set(ascii('WAVE'), 8)
    expect(() => probeImage(wav)).toThrow(/not a PNG, JPEG or WebP/)
  })

  // The whole reason the sniff exists: `accept=` and `File.type` would both
  // have waved this through, because both only ever look at the filename.
  it('rejects a PDF that arrived called screenshot.png', () => {
    expect(() => probeImage(ascii('%PDF-1.7\n1 0 obj'))).toThrow(/PDFs are not accepted/)
  })

  it('rejects an SVG by name, even though it is nominally an image', () => {
    expect(() => probeImage(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>')))
      .toThrow(/SVG is not accepted here — it can carry scripts/)
    expect(() => probeImage(ascii('<?xml version="1.0"?><svg/>'))).toThrow(/SVG is not accepted/)
  })

  it('names the other containers people actually try', () => {
    expect(() => probeImage(ascii('GIF89a'))).toThrow(/GIFs are not accepted/)
    expect(() => probeImage(join(bytes(0, 0, 0, 24), ascii('ftypavif')))).toThrow(/HEIC and AVIF/)
    expect(() => probeImage(ascii('BM'))).toThrow(/BMP is not accepted/)
    expect(() => probeImage(bytes(0x49, 0x49, 0x2a, 0x00))).toThrow(/TIFF/)
    expect(() => probeImage(bytes(0x50, 0x4b, 0x03, 0x04))).toThrow(/zip archive/)
    expect(() => probeImage(bytes(0x4d, 0x5a, 0x90, 0x00))).toThrow(/is a program/)
  })

  it('rejects random bytes and an empty buffer', () => {
    expect(() => probeImage(bytes(1, 2, 3, 4, 5, 6, 7, 8))).toThrow(ImageRejected)
    expect(() => probeImage(new Uint8Array(0))).toThrow(ImageRejected)
  })

  it('rejects an animated WebP rather than silently keeping frame one', () => {
    const anim = new Uint8Array(30)
    anim.set(ascii('RIFF'), 0)
    new DataView(anim.buffer).setUint32(4, 22, true)
    anim.set(ascii('WEBP'), 8)
    anim.set(ascii('VP8X'), 12)
    anim[20] = 0x02   // the ANIMATION flag
    expect(() => probeImage(anim)).toThrow(/animated WebP/)
  })
})

describe('the appended-payload audits', () => {
  // Every decoder stops at IEND, so the tail is where a JS or ZIP polyglot
  // rides along. The re-encode is what destroys it; this is what names it.
  it('spots data appended after a PNG IEND', () => {
    expect(() => auditPng(png())).not.toThrow()
    expect(() => auditPng(png(400, 300, { trailing: ascii('<script>fetch("//evil")</script>') })))
      .toThrow(/extra data appended/)
  })

  it('spots an APNG by its acTL chunk', () => {
    expect(() => auditPng(png(400, 300, { animated: true }))).toThrow(/animated PNG/)
  })

  it('spots a truncated PNG', () => {
    expect(() => auditPng(png().slice(0, 40))).toThrow(/truncated/)
  })

  // RIFF carries the file length in its own header, so appended data is four
  // bytes away from being detectable.
  it('spots data appended to a WebP', () => {
    expect(() => auditWebp(webp())).not.toThrow()
    expect(() => auditWebp(webp(400, 300, { trailing: ascii('PK\x03\x04junk') }))).toThrow(/extra data appended/)
  })

  it('spots data appended after a JPEG EOI', () => {
    expect(() => auditJpeg(jpeg())).not.toThrow()
    expect(() => auditJpeg(join(jpeg(), ascii('trailing')))).toThrow(/extra data appended/)
  })
})

describe('the size and pixel gates', () => {
  it('refuses an empty file and one over the byte cap, and states both numbers', () => {
    expect(() => checkFileSize(0)).toThrow(/empty/)
    expect(() => checkFileSize(MAX_FILE_BYTES + 1)).toThrow(/5\.0 MB/)
    expect(() => checkFileSize(MAX_FILE_BYTES)).not.toThrow()
  })

  it('refuses an image too small to show anything', () => {
    expect(() => checkDimensions(8, 8)).toThrow(/8 × 8 — too small/)
    expect(() => checkDimensions(40, 40)).not.toThrow()
  })

  // A 6 kB PNG may legally declare 225000×225000, which is 202 GB of RGBA. The
  // header says so before anything allocates, which is the only place this can
  // be stopped — by the time a decode resolves the allocation has happened.
  it('refuses a declared pixel bomb, naming the limit', () => {
    expect(() => checkDimensions(225_000, 225_000)).toThrow(new RegExp(`${MAX_SIDE} px limit`))
    expect(() => checkDimensions(7000, 7000)).toThrow(/too many pixels/)
  })

  // Deliberately shape-blind. A tall crop of one sidebar is a real screenshot,
  // and an aspect-ratio heuristic would reject it while happily passing a
  // screenshot-shaped photo of a whiteboard. Do not add one.
  it('accepts a narrow tall crop', () => {
    expect(() => checkDimensions(200, 3000)).not.toThrow()
  })
})

describe('inspectImage — the whole byte gate in one call', () => {
  it('accepts a plain PNG, JPEG and WebP', () => {
    expect(inspectImage(png(800, 600)).kind).toBe('png')
    expect(inspectImage(jpeg(800, 600)).kind).toBe('jpeg')
    expect(inspectImage(webp(800, 600)).kind).toBe('webp')
  })

  it('rejects a valid PNG carrying an appended payload', () => {
    expect(() => inspectImage(png(800, 600, { trailing: ascii('PK\x03\x04') }))).toThrow(/extra data appended/)
  })

  it('rejects a structurally valid PNG that declares impossible dimensions', () => {
    expect(() => inspectImage(png(60_000, 60_000))).toThrow(/px limit/)
  })
})

describe('formatBytes', () => {
  it('scales the unit to the size', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 kB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
