import { describe, expect, it } from 'vitest'
import { PROVIDER_INFO, providerOf } from '../../src/assist/transport'

describe('key routing', () => {
  it.each([
    ['sk-or-v1-abc123', 'openrouter'],
    ['gsk_abc123', 'groq'],
    ['sk-ant-api03-abc', 'anthropic'],
  ] as const)('%s -> %s', (key, expected) => {
    expect(providerOf(key)).toBe(expected)
  })

  // sk-or- must be tested before any looser sk- rule, or OpenRouter keys would
  // be sent to Anthropic — a key delivered to the wrong vendor is a leak.
  it('never mistakes an OpenRouter key for an Anthropic one', () => {
    expect(providerOf('sk-or-v1-looks-a-bit-like-sk-ant')).toBe('openrouter')
  })

  it('reports an unknown key rather than guessing a home for it', () => {
    expect(providerOf('hf_abc')).toBe('unknown')
    expect(providerOf('')).toBe('unknown')
    expect(providerOf('sk-proj-openai-style')).toBe('unknown')
  })

  it('tolerates surrounding whitespace from a paste', () => {
    expect(providerOf('  sk-or-v1-abc  ')).toBe('openrouter')
  })

  it('describes each provider honestly, including that one is not free', () => {
    expect(PROVIDER_INFO.openrouter.free).toMatch(/free/i)
    expect(PROVIDER_INFO.anthropic.free).toMatch(/paid|no free/i)
    for (const p of Object.values(PROVIDER_INFO)) expect(p.signup).toBeTruthy()
  })
})
