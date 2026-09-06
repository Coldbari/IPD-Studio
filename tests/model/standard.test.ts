import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STANDARD,
  formatLineNumber,
  loopDigitsOk,
  missingLineParts,
  padLoop,
  requiredFor,
  standardFromLegacySettings,
  standardOf,
  suffixAllowed,
  validateProfile,
  type StandardProfile,
} from '../../src/model/standard'

const ln = (p: Partial<{ size: string; spec: string; service: string; seq: string }> = {}) => ({
  size: '6"', spec: '150', service: 'CW', seq: '001', ...p,
})

describe('the default standard', () => {
  it('reproduces exactly what the engine checked before standards existed', () => {
    // Guard against a well-meaning edit here silently changing every existing
    // project's QA report the moment it is opened by a newer build.
    expect(DEFAULT_STANDARD.required.instrument).toEqual(['general.service', 'signal.range'])
    expect(DEFAULT_STANDARD.required.valve).toEqual(['element.size', 'actuation.failPosition'])
    expect(DEFAULT_STANDARD.required.equipment).toEqual(['general.service'])
    expect(DEFAULT_STANDARD.required.line).toEqual(['spec.size', 'spec.material'])
    expect(DEFAULT_STANDARD.conventions.valveFailPosition).toBe('required')
  })

  it('is what a document without a standard is checked against', () => {
    expect(standardOf({})).toBe(DEFAULT_STANDARD)
    const own = { ...DEFAULT_STANDARD, id: 'x' }
    expect(standardOf({ standard: own })).toBe(own)
  })

  it('reports required fields per kind, and nothing for a kind it omits', () => {
    expect(requiredFor(DEFAULT_STANDARD, 'instrument')).toContain('signal.range')
    const sparse = { ...DEFAULT_STANDARD, required: {} as StandardProfile['required'] }
    expect(requiredFor(sparse, 'valve')).toEqual([])
  })
})

describe('tag formatting rules', () => {
  it('accepts a loop number of exactly the profile width', () => {
    expect(loopDigitsOk(DEFAULT_STANDARD, '101')).toBe(true)
    expect(loopDigitsOk(DEFAULT_STANDARD, '1013')).toBe(false)
    const four: StandardProfile = { ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, digits: 4 } }
    expect(loopDigitsOk(four, '101')).toBe(false)
    expect(loopDigitsOk(four, '0101')).toBe(true)
  })

  it('pads a loop number to the profile width', () => {
    const four: StandardProfile = { ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, digits: 4 } }
    expect(padLoop(four, '101')).toBe('0101')
    expect(padLoop(DEFAULT_STANDARD, '7')).toBe('007')
  })

  it('allows a suffix only under LL-NNNA', () => {
    expect(suffixAllowed(DEFAULT_STANDARD)).toBe(true)
    const plain: StandardProfile = { ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, pattern: 'LL-NNN' } }
    expect(suffixAllowed(plain)).toBe(false)
  })
})

describe('line numbering', () => {
  it('formats in the profile component order', () => {
    expect(formatLineNumber(DEFAULT_STANDARD, ln())).toBe('6"-150-CW-001')
    const other: StandardProfile = {
      ...DEFAULT_STANDARD,
      lineNumber: { ...DEFAULT_STANDARD.lineNumber, order: ['size', 'service', 'spec', 'seq'] },
    }
    expect(formatLineNumber(other, ln())).toBe('6"-CW-150-001')
  })

  it('skips components the line does not carry rather than leaving a gap', () => {
    expect(formatLineNumber(DEFAULT_STANDARD, ln({ spec: '' }))).toBe('6"-CW-001')
  })

  it('names the components the standard expects but the line lacks', () => {
    expect(missingLineParts(DEFAULT_STANDARD, ln())).toEqual([])
    expect(missingLineParts(DEFAULT_STANDARD, ln({ service: '  ' }))).toEqual(['service'])
    const short: StandardProfile = {
      ...DEFAULT_STANDARD,
      lineNumber: { ...DEFAULT_STANDARD.lineNumber, order: ['size', 'seq'] },
    }
    // a component the profile does not ask for is not missing
    expect(missingLineParts(short, ln({ service: '', spec: '' }))).toEqual([])
  })
})

describe('validateProfile', () => {
  it('accepts a well-formed profile', () => {
    const r = validateProfile({ ...DEFAULT_STANDARD, name: 'Acme Rev 3' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.profile.name).toBe('Acme Rev 3')
  })

  it('refuses something that is not a profile at all', () => {
    for (const bad of [null, 42, 'standard', []]) {
      const r = validateProfile(bad)
      expect(r.ok).toBe(false)
    }
  })

  it('names the field that is wrong', () => {
    const r = validateProfile({ ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, digits: 7 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.map((p) => p.field)).toContain('tagFormat.digits')
  })

  it('rejects an unknown tag pattern rather than silently ignoring it', () => {
    const r = validateProfile({ ...DEFAULT_STANDARD, tagFormat: { ...DEFAULT_STANDARD.tagFormat, pattern: 'AREA-LL-NNN' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.map((p) => p.field)).toContain('tagFormat.pattern')
  })

  it('rejects a line-number order that repeats a component', () => {
    const r = validateProfile({
      ...DEFAULT_STANDARD,
      lineNumber: { ...DEFAULT_STANDARD.lineNumber, order: ['size', 'size'] },
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a severity override that is not a severity', () => {
    const r = validateProfile({ ...DEFAULT_STANDARD, severityOverrides: { 'duplicate-tag': 'urgent' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems[0]!.field).toBe('severityOverrides.duplicate-tag')
  })

  it('requires a name', () => {
    const r = validateProfile({ ...DEFAULT_STANDARD, name: '   ' })
    expect(r.ok).toBe(false)
  })

  it('fills sections an older file predates instead of refusing it', () => {
    const withoutConventions: Record<string, unknown> = { ...DEFAULT_STANDARD }
    delete withoutConventions.conventions
    const r = validateProfile({ ...withoutConventions, conventions: { valveFailPosition: 'optional' } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.profile.conventions.valveFailPosition).toBe('optional')
      // absent keys come from the default rather than becoming undefined
      expect(r.profile.conventions.defaultSignal).toBe(DEFAULT_STANDARD.conventions.defaultSignal)
    }
  })
})

describe('migrating pre-v0.19 project settings', () => {
  it('leaves a project on the built-in default when it never chose anything', () => {
    expect(standardFromLegacySettings({ tagSeparator: '-', numberStart: 100 })).toBeUndefined()
    expect(standardFromLegacySettings({})).toBeUndefined()
  })

  it('carries a hand-chosen separator into a profile of its own', () => {
    const std = standardFromLegacySettings({ tagSeparator: '', numberStart: 100 })
    expect(std?.tagFormat.separator).toBe('')
    expect(std?.tagFormat.numberStart).toBe(100)
  })

  it('carries a hand-chosen numbering base', () => {
    const std = standardFromLegacySettings({ tagSeparator: '-', numberStart: 1 })
    expect(std?.tagFormat.numberStart).toBe(1)
  })
})
