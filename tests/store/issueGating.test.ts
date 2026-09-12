// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * ISSUE GATING — the enforcement, not the dialog.
 *
 * Three things are proved here and nothing else is worth proving:
 *
 *  1. A project with no issue policy behaves EXACTLY as it did before gating
 *     existed. That is the compatibility promise, and it is first.
 *  2. A blocked issue is atomic: the document is object-identical afterwards
 *     and no snapshot was written. The same standard the P0 rename collision
 *     holds — a refused operation leaves no trace to clean up.
 *  3. The gate cannot be bypassed by calling the store directly. A disabled
 *     button is a courtesy; `markIssued` is the control.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { issueRevision, hasSnapshot, __resetSnapshots } from '../../src/persist/revisions'
import { isIssued, revisionsOf } from '../../src/model/revision'
import { qaFor, resetQaCache } from '../../src/validate/engine'
import { DEFAULT_STANDARD, DEFAULT_ISSUE_STATUSES } from '../../src/model/standard'
import type { IssueGate, StandardProfile } from '../../src/model/standard'
import { fingerprintStandard } from '../../src/model/provenance'

const doc = () => useStore.getState().doc
const sheet = () => doc().sheets[0]!
const rows = () => revisionsOf(sheet())
const row = () => rows()[0]!

/** A drawing that produces at least one open CRITICAL finding. Two symbols
 *  wearing one tag is the canonical one — duplicate tags are critical. */
function seedCritical(): string {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  for (const x of [0, 96]) {
    const id = useStore.getState().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x, y: 0, rotation: 0 })
    useStore.getState().setTag(id, { letters: 'LT', loop: '101' })
  }
  expect(qaFor(doc()).counts.critical, 'the fixture must produce a critical').toBeGreaterThan(0)
  return sheet().id
}

/** A drawing with no findings at all. */
function seedClean(): string {
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
  expect(qaFor(doc()).total).toBe(0)
  return sheet().id
}

function withPolicy(policy: Record<string, IssueGate>): void {
  const std: StandardProfile = { ...DEFAULT_STANDARD, issuePolicy: policy }
  useStore.getState().setStandard(std)
}

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  useStore.getState().loadIntoStore(createEmptyDoc('t'))
})

describe('a project with no issue policy is untouched', () => {
  it.each([...DEFAULT_ISSUE_STATUSES])('issues at %s with open criticals, exactly as before', async (status) => {
    const sheetId = seedCritical()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status, preparedBy: 'PN' })

    const res = await issueRevision(sheetId, id)

    expect(res.ok).toBe(true)
    expect(res.blockers).toEqual([])
    expect(isIssued(row())).toBe(true)
    expect(await hasSnapshot(res.snapshotId!)).toBe(true)
  })

  it('still records a conformance verdict, with no policy applied', async () => {
    const sheetId = seedCritical()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)

    const c = row().conformance!
    expect(c.status).toBe('conformant')          // nothing is blocked when nothing blocks
    expect(c.policyApplied).toBeUndefined()      // and the absence is itself recorded
    expect(c.open.critical).toBeGreaterThan(0)   // while the findings are stated plainly
    expect(c.rulesEvaluated).toBeGreaterThan(0)
  })
})

describe('a policy that permits the issue', () => {
  it('lets a clean drawing through a critical gate', async () => {
    const sheetId = seedClean()
    withPolicy({ IFC: { blockSeverities: ['critical'] } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })

    const res = await issueRevision(sheetId, id)
    expect(res.ok).toBe(true)
    expect(row().conformance!.status).toBe('conformant')
    expect(row().conformance!.policyApplied).toEqual({ blockSeverities: ['critical'] })
  })

  it('gates only the status it names — other statuses are untouched', async () => {
    const sheetId = seedCritical()
    withPolicy({ IFC: { blockSeverities: ['critical'] } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFR' })

    expect((await issueRevision(sheetId, id)).ok).toBe(true)
  })
})

describe('a policy that blocks the issue', () => {
  it('refuses, and says exactly why', async () => {
    const sheetId = seedCritical()
    withPolicy({ IFC: { blockSeverities: ['critical'] } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })

    const res = await issueRevision(sheetId, id)
    expect(res.ok).toBe(false)
    expect(res.blockers.join(' ')).toContain('open critical')
    expect(res.snapshotId).toBeUndefined()
  })

  it('blocks a missing checker', async () => {
    const sheetId = seedClean()
    withPolicy({ IFC: { requireChecker: true } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })

    expect((await issueRevision(sheetId, id)).blockers).toEqual(['A checker is required, and none is named.'])
    useStore.getState().updateRevision(sheetId, id, { checkedBy: 'AB' })
    expect((await issueRevision(sheetId, id)).ok).toBe(true)
  })

  it('blocks a missing approver', async () => {
    const sheetId = seedClean()
    withPolicy({ IFC: { requireApprover: true } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })

    expect((await issueRevision(sheetId, id)).blockers).toEqual(['An approver is required, and none is named.'])
    useStore.getState().updateRevision(sheetId, id, { approvedBy: 'CD' })
    expect((await issueRevision(sheetId, id)).ok).toBe(true)
  })

  it('a QA requirement is satisfied by a clean drawing — evaluated is not the same as empty', async () => {
    const sheetId = seedClean()
    withPolicy({ IFC: { requireQaEvaluation: true } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })

    const res = await issueRevision(sheetId, id)
    expect(res.ok).toBe(true)
    expect(row().conformance!.rulesEvaluated).toBeGreaterThan(0)
  })

  it('blocks an accepted critical when the house does not permit waivers', async () => {
    seedCritical()
    // Accept every live finding, then insist that accepting is not enough.
    const report = qaFor(doc())
    const ignored: Record<string, { reason: string; at: string }> = {}
    for (const g of report.groups) for (const f of g.findings) ignored[f.key] = { reason: 'agreed', at: '2026-01-01T00:00:00.000Z' }
    useStore.getState().loadIntoStore({ ...doc(), qa: { ignored } })
    resetQaCache()
    expect(qaFor(doc()).counts.critical).toBe(0)

    withPolicy({ IFC: { blockSeverities: ['critical'], allowAcceptedFindings: false } })
    const id = useStore.getState().addRevision(sheet().id, { code: 'A', status: 'IFC' })

    const res = await issueRevision(sheet().id, id)
    expect(res.ok).toBe(false)
    expect(res.blockers.join(' ')).toContain('accepted critical')

    // The same document under the default (waivers allowed) issues fine.
    withPolicy({ IFC: { blockSeverities: ['critical'] } })
    const ok = await issueRevision(sheet().id, id)
    expect(ok.ok).toBe(true)
    expect(row().conformance!.status).toBe('conformant-with-accepted')
  })
})

describe('a blocked issue is atomic', () => {
  it('leaves the document object-identical and writes no snapshot', async () => {
    const sheetId = seedCritical()
    withPolicy({ IFC: { blockSeverities: ['critical'] } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC', preparedBy: 'PN' })

    const before = doc()
    const beforeRow = row()
    const dirtyBefore = useStore.getState().dirty

    const res = await issueRevision(sheetId, id)

    expect(res.ok).toBe(false)
    expect(doc()).toBe(before)               // object-identical, not merely equal
    expect(row()).toBe(beforeRow)
    expect(useStore.getState().dirty).toBe(dirtyBefore)
    expect(row().issuedAt).toBeUndefined()
    expect(row().standard).toBeUndefined()
    expect(row().conformance).toBeUndefined()
    expect(row().qaEvidence).toBeUndefined()
    expect(row().qaAtIssue).toBeUndefined()
    // The gate runs BEFORE the snapshot, so there is no orphan to collect.
    expect(await hasSnapshot(`snap-${id}`)).toBe(false)
  })

  it('leaves the sheet revision code alone — a blocked issue does not advance the title block', async () => {
    const sheetId = seedCritical()
    withPolicy({ IFC: { blockSeverities: ['critical'] } })
    const wasCode = sheet().revision
    const id = useStore.getState().addRevision(sheetId, { code: 'Z9', status: 'IFC' })

    await issueRevision(sheetId, id)
    expect(sheet().revision).toBe(wasCode)
  })
})

describe('the gate cannot be bypassed', () => {
  it('a direct markIssued call is refused by the same rules', async () => {
    const sheetId = seedCritical()
    withPolicy({ IFC: { blockSeverities: ['critical'], requireChecker: true } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })

    const before = doc()
    // Everything a caller could offer, including a snapshot id and counts that
    // flatter the drawing. None of it is trusted: the store recomputes.
    const res = useStore.getState().markIssued(sheetId, id, {
      issuedAt: '2026-01-01T00:00:00.000Z',
      snapshotId: 'forged',
      qaAtIssue: { critical: 0, warning: 0, info: 0, total: 0 },
      standard: { id: 'x', name: 'Anything', fingerprint: '0'.repeat(16) },
      qaEvidence: { findings: [], omitted: 0, capturedAt: '2026-01-01T00:00:00.000Z' },
    })

    expect(res.ok).toBe(false)
    expect(res.blockers.length).toBe(2)
    expect(doc()).toBe(before)
    expect(row().issuedAt).toBeUndefined()
  })

  it('computes the verdict itself rather than storing the caller’s', async () => {
    const sheetId = seedCritical()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })

    useStore.getState().markIssued(sheetId, id, {
      issuedAt: '2026-01-01T00:00:00.000Z',
      qaAtIssue: { critical: 0, warning: 0, info: 0, total: 0 },
    })
    // No gate, so the issue proceeds — but the conformance record reflects the
    // real document, not the zeroed counts the caller handed in.
    expect(row().conformance!.open.critical).toBeGreaterThan(0)
  })

  it('refuses a second issue of the same row', async () => {
    const sheetId = seedClean()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    expect((await issueRevision(sheetId, id)).ok).toBe(true)

    const again = await issueRevision(sheetId, id)
    expect(again.ok).toBe(false)
    expect(again.blockers).toEqual(['That revision has already been issued.'])
  })

  it('refuses a revision that does not exist', async () => {
    const sheetId = seedClean()
    const res = await issueRevision(sheetId, 'nope')
    expect(res.ok).toBe(false)
    expect(res.blockers).toEqual(['That revision no longer exists.'])
  })
})

describe('issued conformance is history, and history does not move', () => {
  it('survives a standard change, a policy change, accepting findings, fixing the drawing and undo', async () => {
    const sheetId = seedCritical()
    withPolicy({ IFR: { blockSeverities: ['warning'] } })
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    expect((await issueRevision(sheetId, id)).ok).toBe(true)

    const frozen = structuredClone(row().conformance!)
    const frozenPrint = row().standard!.fingerprint
    const frozenEvidence = structuredClone(row().qaEvidence!)
    expect(frozen.open.critical).toBeGreaterThan(0)

    // 1. A different standard entirely.
    useStore.getState().setStandard({ ...DEFAULT_STANDARD, name: 'Something else', version: '9' })
    // 2. A tighter issue policy.
    withPolicy({ IFC: { blockSeverities: ['critical', 'warning', 'info'], allowAcceptedFindings: false } })
    // 3. Accept the findings that were open at issue.
    useStore.getState().loadIntoStore({
      ...doc(),
      qa: { ignored: Object.fromEntries(qaFor(doc()).groups.flatMap((g) => g.findings.map((f) => [f.key, { reason: 'later', at: 'now' }]))) },
    })
    resetQaCache()
    // 4. Fix the drawing.
    const dup = sheet().nodes[1]!
    useStore.getState().setTag(dup.id, { letters: 'LT', loop: '102' })
    // 5. Undo and redo it.
    useStore.getState().undo()
    useStore.getState().redo()

    const after = revisionsOf(sheet()).find((r) => r.id === id)!
    expect(after.conformance).toEqual(frozen)
    expect(after.standard!.fingerprint).toBe(frozenPrint)
    expect(after.qaEvidence).toEqual(frozenEvidence)
  })

  it('the live fingerprint moves when the policy does — the frozen one does not', async () => {
    const sheetId = seedClean()
    const id = useStore.getState().addRevision(sheetId, { code: 'A', status: 'IFC' })
    await issueRevision(sheetId, id)
    const frozen = row().standard!.fingerprint
    expect(frozen).toBe(fingerprintStandard(DEFAULT_STANDARD))

    withPolicy({ IFC: { blockSeverities: ['critical'] } })
    expect(fingerprintStandard(doc().standard!)).not.toBe(frozen)
    expect(row().standard!.fingerprint).toBe(frozen)
  })
})
