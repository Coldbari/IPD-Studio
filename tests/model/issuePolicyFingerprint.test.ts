// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE ISSUE POLICY IS PART OF THE STANDARD.
 *
 * Two profiles that differ only in whether open criticals may be issued at IFC
 * are not the same standard, and a revision issued under one must not be able
 * to claim the other. So the policy is in the fingerprint — which does mean
 * that adding a policy to an existing standard changes its fingerprint, and
 * existing revisions will show "the standard has changed since". That is a
 * true statement about the standard, and it is the reason the exclusion was
 * not taken.
 */

import { describe, expect, it } from 'vitest'
import { fingerprintStandard, canonicalStandard } from '../../src/model/provenance'
import { DEFAULT_STANDARD, recommendedIssuePolicy, issueGateFor, issueStatusesOf } from '../../src/model/standard'
import type { StandardProfile } from '../../src/model/standard'
import { compareDocs } from '../../src/model/diff'
import { createEmptyDoc } from '../../src/model/doc'
import type { ProjectDoc } from '../../src/model/types'

const std = (over: Partial<StandardProfile> = {}): StandardProfile => ({ ...DEFAULT_STANDARD, ...over })

describe('the fingerprint covers the issue policy', () => {
  it('a standard with no policy is unchanged by the feature existing', () => {
    expect(fingerprintStandard(std())).toBe(fingerprintStandard(std()))
    expect(canonicalStandard(std())).not.toContain('issuePolicy')
  })

  it('adding a policy changes the fingerprint', () => {
    const before = fingerprintStandard(std())
    const after = fingerprintStandard(std({ issuePolicy: { IFC: { blockSeverities: ['critical'] } } }))
    expect(after).not.toBe(before)
  })

  it('a meaningful policy change changes it again', () => {
    const a = fingerprintStandard(std({ issuePolicy: { IFC: { blockSeverities: ['critical'] } } }))
    const b = fingerprintStandard(std({ issuePolicy: { IFC: { blockSeverities: ['critical', 'warning'] } } }))
    const c = fingerprintStandard(std({ issuePolicy: { IFC: { blockSeverities: ['critical'], allowAcceptedFindings: false } } }))
    const d = fingerprintStandard(std({ issuePolicy: { IFR: { blockSeverities: ['critical'] } } }))
    expect(new Set([a, b, c, d]).size).toBe(4)
  })

  it('is independent of the order the policy was typed in', () => {
    const a = std({ issuePolicy: {
      IFC: { blockSeverities: ['critical', 'warning'], requireChecker: true },
      IFR: { requireApprover: true },
    } })
    const b = std({ issuePolicy: {
      IFR: { requireApprover: true },
      IFC: { requireChecker: true, blockSeverities: ['warning', 'critical'] },
    } })
    expect(fingerprintStandard(a)).toBe(fingerprintStandard(b))
  })

  it('is deterministic across repeated calls and fresh objects', () => {
    const policy = { IFC: { blockSeverities: ['critical' as const], requireChecker: true } }
    const a = fingerprintStandard(std({ issuePolicy: structuredClone(policy) }))
    const b = fingerprintStandard(std({ issuePolicy: structuredClone(policy) }))
    expect(a).toBe(b)
    expect(a).toHaveLength(16)
  })
})

describe('the recommended policy', () => {
  it('gates the final construction status and allows accepted findings', () => {
    const policy = recommendedIssuePolicy([...issueStatusesOf(DEFAULT_STANDARD)])
    expect(policy.IFC).toEqual({ blockSeverities: ['critical'], allowAcceptedFindings: true, requireChecker: true })
    // And only that status — nothing else is gated behind the engineer's back.
    expect(Object.keys(policy)).toEqual(['IFC'])
  })

  it('falls back to the house’s last status when there is no IFC', () => {
    const policy = recommendedIssuePolicy(['DRAFT', 'CHECK', 'RELEASED'])
    expect(Object.keys(policy)).toEqual(['RELEASED'])
  })

  it('is not installed anywhere by default', () => {
    expect(DEFAULT_STANDARD.issuePolicy).toBeUndefined()
    expect(issueGateFor(DEFAULT_STANDARD, 'IFC')).toBeUndefined()
    expect(issueGateFor(undefined, 'IFC')).toBeUndefined()
  })
})

describe('a policy change is visible in a revision diff', () => {
  const withStd = (base: ProjectDoc, s?: StandardProfile): ProjectDoc => ({ ...base, standard: s })

  it('names the status and what changed about its gate', () => {
    const BASE = createEmptyDoc('t')
    const before = withStd(BASE, std())
    const after = withStd(BASE, std({ issuePolicy: { IFC: { blockSeverities: ['critical'], requireChecker: true } } }))

    const changes = compareDocs(before, after).changes
    const policy = changes.find((c) => c.field === 'issuePolicy.IFC')
    expect(policy).toBeDefined()
    expect(policy!.after).toContain('blocks critical')
    expect(policy!.after).toContain('checker required')
    expect(policy!.category).toBe('engineering')
    // And the fingerprint line says the rules moved, as it does for any change.
    expect(changes.some((c) => c.field === 'fingerprint')).toBe(true)
  })

  it('does not report a change when the same policy was typed in another order', () => {
    const BASE = createEmptyDoc('t')
    const a = withStd(BASE, std({ issuePolicy: { IFC: { blockSeverities: ['critical', 'warning'] }, IFR: { requireChecker: true } } }))
    const b = withStd(BASE, std({ issuePolicy: { IFR: { requireChecker: true }, IFC: { blockSeverities: ['warning', 'critical'] } } }))

    expect(compareDocs(a, b).changes.filter((c) => c.field?.startsWith('issuePolicy'))).toEqual([])
  })

  it('conformance history on a revision row creates no diff — the revision table is excluded', () => {
    const BASE = createEmptyDoc('t')
    const sheet = BASE.sheets[0]!
    const a: ProjectDoc = { ...BASE, sheets: [{ ...sheet, revisions: [] }] }
    const b: ProjectDoc = {
      ...BASE,
      sheets: [{ ...sheet, revisions: [{
        id: 'r1', code: 'A', date: '', description: '', preparedBy: '', status: 'IFC',
        issuedAt: '2026-01-01T00:00:00.000Z',
        conformance: { status: 'conformant', open: { critical: 0, warning: 0, info: 0, total: 0 },
          accepted: { critical: 0, warning: 0, info: 0, total: 0 }, rulesEvaluated: 40, rulesDisabled: [] },
      }] }],
    }
    expect(compareDocs(a, b).changes).toEqual([])
  })
})
