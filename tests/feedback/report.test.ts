import { describe, expect, it } from 'vitest'
import {
  BODY_MAX, SUBJECT_MAX, TITLE_MAX, buildReport, cleanText, cleanTitle, friendly,
  mailSubject, refFrom, toPlainText, validateReport, type DiagInput,
} from '../../src/feedback/report'

const diag: DiagInput = {
  workspace: 'draw',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/141.0.0.0',
  viewport: '2560 × 1440',
  sheets: 3,
  nodes: 128,
  edges: 44,
}

describe('validateReport', () => {
  it('names the missing title and the missing body', () => {
    const errors = validateReport({ kind: 'bug', title: '   ', body: '' })
    expect(errors.title).toBe('Add a title before sending.')
    expect(errors.body).toMatch(/what happened/)
  })

  it('asks a suggestion for what is needed, not for what happened', () => {
    expect(validateReport({ kind: 'suggestion', title: 'Lock a sheet', body: 'x' }).body)
      .toMatch(/what you need/)
  })

  it('rejects a title too short to file', () => {
    expect(validateReport({ kind: 'bug', title: 'ugh', body: 'The line reattached wrongly.' }).title)
      .toMatch(/too short/)
  })

  it('returns no keys at all when both fields pass', () => {
    const errors = validateReport({
      kind: 'bug',
      title: 'Line jumps ports after undo',
      body: 'Drew a signal line, pressed Ctrl+Z, it reattached to the wrong port.',
    })
    expect(Object.keys(errors)).toHaveLength(0)
  })
})

describe('cleanText / cleanTitle', () => {
  // A NUL truncates strings in whatever C-backed tool eventually reads the
  // inbox, and U+202E renders the rest of a line backwards on the maintainer's
  // screen — display spoofing aimed squarely at the person triaging.
  it('strips control characters and bidi overrides', () => {
    expect(cleanText('ok\u0000\u0007bad\u202Eflip')).toBe('okbadflip')
  })

  it('keeps newlines and tabs in a body', () => {
    expect(cleanText('one\ntwo\tthree')).toBe('one\ntwo\tthree')
  })

  it('collapses a pasted multi-line title to one line', () => {
    expect(cleanTitle('Undo loses\nthe   tag')).toBe('Undo loses the tag')
  })
})

describe('buildReport', () => {
  const input = { kind: 'bug' as const, title: '  Line jumps ports  ', body: '  It reattached wrongly.  ' }

  it('trims, and clamps a pasted overlong title and body to the caps', () => {
    const built = buildReport({ ...input, title: 'x'.repeat(500), body: 'y'.repeat(5000) }, '0.17.0', diag)
    expect(built.title).toHaveLength(TITLE_MAX)
    expect(built.body).toHaveLength(BODY_MAX)
  })

  it('carries kind, version and the counts through unchanged', () => {
    const built = buildReport(input, '0.17.0', diag)
    expect(built).toMatchObject({
      kind: 'bug',
      title: 'Line jumps ports',
      body: 'It reattached wrongly.',
      version: '0.17.0',
    })
    expect(built.diag).toMatchObject({ workspace: 'draw', sheets: 3, nodes: 128, edges: 44 })
  })

  // The same trap tests/cloud/sync.test.ts guards for drawings: a report
  // written in Devanagari costs several bytes per character on the wire, and
  // the cap that matters is bytes.
  it('measures size in UTF-8 bytes, not characters', () => {
    const ascii = buildReport({ ...input, body: 'a'.repeat(100) }, '0.17.0', diag)
    const wide = buildReport({ ...input, body: '高'.repeat(100) }, '0.17.0', diag)
    expect(wide.sizeBytes).toBeGreaterThan(ascii.sizeBytes)
  })

  it('never stores a blank version', () => {
    expect(buildReport(input, '   ', diag).version).toBe('unknown')
  })

  it('bounds the user agent so a padded string cannot ride along', () => {
    const built = buildReport(input, '0.17.0', { ...diag, userAgent: 'U'.repeat(4000) })
    expect(built.diag.ua).toHaveLength(300)
  })
})

describe('friendly', () => {
  const of = (code: string) => friendly(Object.assign(new Error('nope'), { code }))

  it('tells an offline user nothing was sent and the text is still there', () => {
    expect(of('unavailable')).toMatch(/offline/)
    expect(of('unavailable')).toMatch(/still here/)
  })

  // Not the same as offline: the write went out and was never acknowledged, so
  // it may or may not have landed. Saying "nothing was sent" there would be a
  // guess, and the wrong one half the time.
  it('does not claim a timed-out write was never sent', () => {
    expect(of('deadline-exceeded')).toMatch(/may not have gone through/)
    expect(of('deadline-exceeded')).not.toMatch(/nothing was sent/)
  })

  it('points at Copy as text when permission is refused, and names no inbox', () => {
    expect(of('permission-denied')).toMatch(/Copy as text/)
    expect(of('unauthenticated')).toMatch(/sign in/)
  })

  // The address a report is mailed to is resolved server-side, by the mail
  // extension reading users/{uid}.email. A bundle is public, so an address in
  // any of these strings would be a published address — scraped, and
  // unrevocable once a build carrying it has shipped.
  it('never names an email address in any message it can produce', () => {
    const codes = ['unauthenticated', 'permission-denied', 'unavailable',
      'deadline-exceeded', 'resource-exhausted', 'invalid-argument', 'weird/unknown']
    for (const code of codes) expect(of(code)).not.toMatch(/@/)
  })

  it('says to wait, and that nothing was lost, when rate-limited', () => {
    expect(of('resource-exhausted')).toMatch(/Wait a minute/)
    expect(of('resource-exhausted')).toMatch(/nothing was lost/)
  })

  it('still returns something actionable for a code it has never seen', () => {
    const message = friendly(Object.assign(new Error('the sky fell'), { code: 'weird/unknown' }))
    expect(message).toContain('the sky fell.')
    expect(message).toMatch(/try again/)
  })
})

describe('refFrom', () => {
  it('is six uppercase alphanumerics, and stable for the same id', () => {
    expect(refFrom('7f3a2cQZ019')).toBe('7F3A2C')
    expect(refFrom('7f3a2cQZ019')).toBe(refFrom('7f3a2cQZ019'))
  })

  it('pads an id too short to fill the reference', () => {
    expect(refFrom('ab')).toHaveLength(6)
  })
})

describe('mailSubject — the header the extension sends', () => {
  const of = (kind: 'bug' | 'suggestion', title: string) =>
    mailSubject(buildReport({ kind, title, body: 'A sentence long enough to pass.' }, '0.18.0', diag))

  it('leads with kind and version so an inbox groups itself', () => {
    expect(of('bug', 'Line jumps ports')).toBe('[IPD 0.18.0] Bug: Line jumps ports')
    expect(of('suggestion', 'Lock a sheet')).toBe('[IPD 0.18.0] Suggestion: Lock a sheet')
  })

  // A newline in a subject is header injection — it ends the Subject: header
  // and lets the rest be read as headers of the attacker's choosing. cleanTitle
  // collapses them long before this runs; this asserts it stays that way.
  it('can never carry a newline or a carriage return', () => {
    const nasty = of('bug', 'Real title\r\nBcc: someone@example.com\nX-Evil: 1')
    expect(nasty).not.toMatch(/[\r\n]/)
    expect(nasty).toContain('Real title')
  })

  it('clamps to a length a mail client will not cut mid-word', () => {
    expect(of('bug', 'x'.repeat(400)).length).toBeLessThanOrEqual(SUBJECT_MAX)
  })
})

describe('toPlainText — the fallback for a build with no backend', () => {
  const built = buildReport(
    { kind: 'suggestion', title: 'Lock a sheet', body: 'Colleagues edit under me.' },
    '0.17.0',
    diag,
  )

  it('carries everything the Firestore record would have', () => {
    const text = toPlainText(built, false)
    expect(text).toContain('IPD Studio suggestion')
    expect(text).toContain('Lock a sheet')
    expect(text).toContain('Colleagues edit under me.')
    expect(text).toContain('Version: 0.17.0')
    expect(text).toContain('Symbols: 128')
    expect(text).toContain('Screenshot: none')
  })

  it('says a screenshot has to be attached by hand when there is one', () => {
    expect(toPlainText(built, true)).toMatch(/paste it into the email/i)
  })
})
