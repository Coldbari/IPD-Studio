// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * CONFORMANCE HAS TO TRAVEL.
 *
 * The snapshot store is local to the machine that issued. The verdict, the
 * evidence and the standard fingerprint are not — they live on the revision
 * row inside the document, so they go wherever the `.pnid` goes. This proves
 * it by deleting the snapshot store entirely and reopening the file: everything
 * a reviewer needs to read the issue must still be there.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { serializeDoc } from '../../src/persist/file'
import { loadDoc } from '../../src/model/migrate'
import { issueRevision, getSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { revisionsOf } from '../../src/model/revision'
import { resetQaCache } from '../../src/validate/engine'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { historicalConformance } from '../../src/model/conformance'
import { serializeStandard, parseStandardFile } from '../../src/persist/standard'

const doc = () => useStore.getState().doc
const roundTrip = () => loadDoc(JSON.parse(serializeDoc(doc())))

async function issuedWithPolicyAndDisabledChecks() {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  const sheetId = doc().sheets[0]!.id
  const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
  useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 96, y: 0, rotation: 0 })

  useStore.getState().setStandard({
    ...DEFAULT_STANDARD,
    name: 'Acme', version: '2.1',
    severityOverrides: { 'no-relief': 'off', 'dangling-end': 'off' },
    issuePolicy: { IFR: { blockSeverities: ['critical'], requireChecker: true } },
  })
  resetQaCache()

  const rev = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR', preparedBy: 'PN', checkedBy: 'RN' })
  const res = await issueRevision(sheetId, rev)
  expect(res.ok).toBe(true)
  return { sheetId, rev }
}

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('conformance travels in the .pnid', () => {
  it('survives save and reopen, verdict, policy, counts and disabled checks intact', async () => {
    await issuedWithPolicyAndDisabledChecks()
    const original = revisionsOf(doc().sheets[0]!)[0]!
    expect(original.conformance).toBeDefined()

    const row = revisionsOf(roundTrip().sheets[0]!)[0]!

    expect(row.conformance).toEqual(original.conformance)
    expect(row.conformance!.policyApplied).toEqual({ blockSeverities: ['critical'], requireChecker: true })
    expect(row.conformance!.rulesDisabled).toEqual(['dangling-end', 'no-relief'])
    expect(row.conformance!.rulesEvaluated).toBeGreaterThan(0)
    expect(row.standard).toEqual(original.standard)
    expect(row.qaEvidence).toEqual(original.qaEvidence)
  })

  it('reads correctly after the local snapshot store is wiped', async () => {
    const { rev } = await issuedWithPolicyAndDisabledChecks()
    const saved = serializeDoc(doc())

    // The machine that issued it is gone. Only the file arrived.
    __resetSnapshots()
    useStore.getState().loadIntoStore(loadDoc(JSON.parse(saved)))

    expect(await getSnapshot(`snap-${rev}`)).toBeUndefined()

    const row = revisionsOf(doc().sheets[0]!)[0]!
    const h = historicalConformance(row)
    expect(h.record).toBeDefined()
    expect(h.status).toBe(row.conformance!.status)
    expect(h.countsOnly).toBe(false)
    expect(row.qaEvidence!.findings.length).toBeGreaterThan(0)
    expect(row.standard!.fingerprint).toHaveLength(16)
  })

  it('a revision issued before conformance existed reads as Not recorded, not as clean', () => {
    const base = createEmptyDoc('t')
    const legacy = {
      ...base,
      sheets: base.sheets.map((s) => ({
        ...s,
        revisions: [{
          id: 'r1', code: 'A', date: '2025-01-01', description: 'legacy', preparedBy: 'PN', status: 'IFC',
          issuedAt: '2025-01-01T00:00:00.000Z',
          qaAtIssue: { critical: 2, warning: 1, info: 0, total: 3 },
        }],
      })),
    }
    const reopened = loadDoc(JSON.parse(JSON.stringify(legacy)))
    const row = revisionsOf(reopened.sheets[0]!)[0]!

    expect(row.conformance).toBeUndefined()
    const h = historicalConformance(row)
    expect(h.status).toBe('not-recorded')
    expect(h.countsOnly).toBe(true)   // counts survived; the findings did not
    expect(h.open.total).toBe(3)
  })
})

describe('an .ipdstd.json written before issue policy existed still loads', () => {
  it('accepts a profile with no issuePolicy, and does not invent one', () => {
    const { issuePolicy: _drop, ...older } = { ...DEFAULT_STANDARD, issuePolicy: {} }
    const parsed = parseStandardFile(JSON.stringify(older))
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && 'issuePolicy' in parsed.profile).toBe(false)
  })

  it('round-trips a policy exactly', () => {
    const std = {
      ...DEFAULT_STANDARD,
      issuePolicy: {
        IFC: { blockSeverities: ['critical' as const, 'warning' as const], allowAcceptedFindings: false, requireApprover: true },
        'AS-BUILT': { requireQaEvaluation: true },
      },
    }
    const parsed = parseStandardFile(serializeStandard(std))
    expect(parsed.ok && parsed.profile.issuePolicy).toEqual(std.issuePolicy)
  })

  it('rejects a malformed gate with a readable problem rather than passing it to the engine', () => {
    const bad = { ...DEFAULT_STANDARD, issuePolicy: { IFC: { blockSeverities: ['fatal'], requireChecker: 'yes' } } }
    const parsed = parseStandardFile(JSON.stringify(bad))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    const fields = parsed.problems.map((p) => p.field)
    expect(fields).toContain('issuePolicy.IFC.blockSeverities')
    expect(fields).toContain('issuePolicy.IFC.requireChecker')
  })
})
