// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { describe, expect, it } from 'vitest'
import {
  DISCLAIMER,
  FUTURE,
  LICENCE_FREE,
  LICENCE_PAID,
  LINKS,
  NEXT,
  NOW,
  STAGES,
  STANDARDS,
  STANDARD_LABEL,
  STATUS_LABEL,
  type Capability,
} from '../../src/home/content'

/**
 * THE HOMEPAGE CANNOT OVERCLAIM.
 *
 * These are not tests of rendering. They are tests of the promises the page
 * makes, because the failure mode for a marketing page is not a crash — it is
 * quietly describing something that does not exist yet.
 *
 * The load-bearing rule is the first one: to claim a capability is available
 * you must name the release it shipped in. Anything still being built has no
 * version to name, so it cannot pass, so it stays in NEXT where it belongs.
 */
describe('the capability ledger', () => {
  const all: Capability[] = [...NOW, ...NEXT, ...FUTURE]

  it('only claims a capability is available if it names the release it shipped in', () => {
    for (const c of NOW) {
      expect(c.status, `${c.id} is in NOW`).toBe('available')
      expect(c.since, `${c.id} claims to be available but names no release`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('never lets an unreleased capability carry a version', () => {
    // A version on an unshipped item is how "planned" becomes "available" by
    // accident during an edit.
    for (const c of [...NEXT, ...FUTURE]) {
      expect(c.since, `${c.id} is not shipped but names a release`).toBeUndefined()
    }
  })

  it('keeps the three columns disjoint and correctly statused', () => {
    expect(NEXT.every((c) => c.status === 'developing')).toBe(true)
    expect(FUTURE.every((c) => c.status === 'roadmap')).toBe(true)

    const ids = all.map((c) => c.id)
    expect(new Set(ids).size, 'a capability appears in more than one column').toBe(ids.length)
  })

  it('does not advertise AutomationML or MTP as anything but roadmap', () => {
    // Named explicitly because the brief asks for both by name, and both have
    // zero implementation in the source tree.
    for (const id of ['aml', 'mtp']) {
      const cap = all.find((c) => c.id === id)
      expect(cap?.status, `${id} must stay on the roadmap until it exists`).toBe('roadmap')
      expect(NOW.some((c) => c.id === id)).toBe(false)
    }
  })

  it('gives every capability a non-empty name and a label that renders', () => {
    for (const c of all) {
      expect(c.name.trim().length).toBeGreaterThan(0)
      expect(STATUS_LABEL[c.status]).toBeTruthy()
    }
    // the roadmap's vocabulary, which is not the standards index's
    expect(STATUS_LABEL.available).toBe('Available')
  })
})

describe('the standards index', () => {
  it('never claims conformance, compliance or certification', () => {
    // The wording is the whole point of the section: IPD Studio has not been
    // assessed against any of these.
    const banned = /\b(certified|certification|compliant|compliance|conformant|accredited|endorsed|approved by)\b/i
    for (const s of STANDARDS) {
      expect(banned.test(s.note), `${s.code} note overclaims: "${s.note}"`).toBe(false)
    }
  })

  it('carries the affiliation disclaimer', () => {
    expect(DISCLAIMER).toMatch(/not been\s+formally assessed or certified/i)
    expect(DISCLAIMER).toMatch(/not affiliated with or endorsed by/i)
  })

  it('marks AutomationML and MTP as roadmap and DEXPI as in development', () => {
    const by = (code: string) => STANDARDS.find((s) => s.code === code)
    expect(by('AutomationML')?.status).toBe('roadmap')
    expect(by('MTP')?.status).toBe('roadmap')
    expect(by('DEXPI')?.status).toBe('developing')
  })

  it('gives every reference a status label that renders', () => {
    for (const s of STANDARDS) expect(STANDARD_LABEL[s.status]).toBeTruthy()
    // and the two vocabularies stay distinct: a standard is never "available"
    expect(STANDARD_LABEL.available).toBe('Implemented')
  })
})

describe('the page wiring', () => {
  it('points every outbound link at a real destination', () => {
    for (const [name, url] of Object.entries(LINKS)) {
      if (name === 'email') {
        expect(url).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
        continue
      }
      expect(url, `${name} is not an absolute https URL`).toMatch(/^https:\/\//)
      // no placeholder destinations — a dead button is worse than no button
      expect(url).not.toMatch(/example\.com|#$|TODO/i)
    }
  })

  it('walks the six stages in workflow order', () => {
    expect(STAGES.map((s) => s.step)).toEqual(['01', '02', '03', '04', '05', '06'])
    expect(STAGES.map((s) => s.id)).toEqual(['pid', 'model', 'validate', 'simulate', 'hmi', 'connect'])
  })

  it('keeps both sides of the licence split populated', () => {
    // If either side empties out, the page silently stops telling a commercial
    // visitor that they need a licence.
    expect(LICENCE_FREE.length).toBeGreaterThan(0)
    expect(LICENCE_PAID.length).toBeGreaterThan(0)
    expect(LICENCE_PAID.join(' ')).toMatch(/for-profit/i)
  })
})
