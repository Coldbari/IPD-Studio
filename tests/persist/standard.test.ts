import { describe, expect, it } from 'vitest'
import { parseStandardFile, serializeStandard, STANDARD_EXTENSION } from '../../src/persist/standard'
import { DEFAULT_STANDARD, type StandardProfile } from '../../src/model/standard'

const acme: StandardProfile = {
  ...DEFAULT_STANDARD,
  id: 'acme',
  name: 'Acme Engineering — Rev 3',
  tagFormat: { pattern: 'LL-NNN', separator: '-', numberStart: 1, digits: 4 },
  lineNumber: { order: ['size', 'service', 'spec', 'seq'], separator: '-', sizeUnit: 'DN' },
  conventions: { ...DEFAULT_STANDARD.conventions, valveFailPosition: 'optional' },
  severityOverrides: { 'duplicate-tag': 'off', 'no-relief': 'critical' },
}

describe('the .ipdstd.json file', () => {
  it('round-trips a profile without losing anything', () => {
    const result = parseStandardFile(serializeStandard(acme))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.profile).toEqual(acme)
  })

  it('is written for a human to read and diff', () => {
    const text = serializeStandard(acme)
    expect(text).toContain('\n  ')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('keeps the extension the importer advertises', () => {
    expect(STANDARD_EXTENSION).toBe('.ipdstd.json')
  })

  it('reports unreadable JSON rather than throwing at the file picker', () => {
    const result = parseStandardFile('{ not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]!.field).toBe('file')
  })

  it('refuses a well-formed file that is not a standard', () => {
    const result = parseStandardFile(JSON.stringify({ hello: 'world' }))
    expect(result.ok).toBe(false)
  })

  it('names the offending field so the page can show a sentence', () => {
    const bad = { ...acme, tagFormat: { ...acme.tagFormat, digits: 9 } }
    const result = parseStandardFile(JSON.stringify(bad))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.map((p) => p.field)).toContain('tagFormat.digits')
  })
})
