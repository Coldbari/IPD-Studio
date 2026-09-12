// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * ISSUING FREEZES A RECORD, AND THE RECORD TRAVELS.
 *
 * Two properties are load-bearing and everything here defends one or the
 * other:
 *
 *   IMMUTABLE — nothing that happens after an issue may change what that issue
 *   says. Not editing the standard, not accepting a finding, not fixing the
 *   drawing, not issuing again.
 *
 *   PORTABLE — the provenance lives on the revision row inside ProjectDoc, so
 *   it is in the `.pnid`. A reviewer on another machine, with no IndexedDB
 *   snapshot at all, can still see which standard was used and what QA said.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { serializeDoc } from '../../src/persist/file'
import { loadDoc } from '../../src/model/migrate'
import { issueRevision, __resetSnapshots } from '../../src/persist/revisions'
import { revisionsOf } from '../../src/model/revision'
import { qaFor, resetQaCache } from '../../src/validate/engine'
import { countsOfEvidence, fingerprintStandard } from '../../src/model/provenance'
import { DEFAULT_STANDARD, standardOf } from '../../src/model/standard'
import type { Revision } from '../../src/model/types'

const st = () => useStore.getState()
const doc = () => useStore.getState().doc
const sheet = () => doc().sheets[0]!
const rowAt = (i: number): Revision => revisionsOf(sheet())[i]!

let sheetId = ''

/** A drawing with something for QA to find: a duplicate tag, and an untagged
 *  pump, so the evidence is never trivially empty. */
function seed() {
  st().loadIntoStore(createEmptyDoc('controlled'))
  sheetId = sheet().id
  for (const loop of ['101', '101']) {
    const id = st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0 })
    st().setTag(id, { letters: 'LT', loop })
  }
  st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 200, y: 0, rotation: 0 })
  st().setStandard({ ...DEFAULT_STANDARD, id: 'acme', name: 'Acme Standard', version: '1.0' })
  useStore.temporal.getState().clear()
}

async function issue(code: string, fields: Partial<Revision> = {}) {
  const id = st().addRevision(sheetId, { code, status: 'IFC', preparedBy: 'PN', checkedBy: 'RN', approvedBy: 'AB', ...fields })
  await issueRevision(sheetId, id)
  return id
}

beforeEach(() => {
  __resetSnapshots()
  resetQaCache()
  seed()
})

describe('3. issuing captures the provenance', () => {
  it('records the standard identity, version and fingerprint', async () => {
    await issue('A')
    const r = rowAt(0)
    expect(r.standard).toEqual({
      id: 'acme', name: 'Acme Standard', version: '1.0',
      fingerprint: fingerprintStandard(standardOf(doc())),
    })
  })

  it('records the findings, not just the counts', async () => {
    await issue('A')
    const r = rowAt(0)
    expect(r.qaEvidence).toBeTruthy()
    expect(r.qaEvidence!.findings.length).toBeGreaterThan(0)
    expect(r.qaEvidence!.findings.some((f) => f.entityKey === 'LT-101')).toBe(true)
  })

  it('the counts and the frozen findings describe one report', async () => {
    await issue('A')
    const r = rowAt(0)
    const fromEvidence = countsOfEvidence(r.qaEvidence!)
    expect(fromEvidence.total).toBe(r.qaAtIssue!.total)
    expect(fromEvidence.critical).toBe(r.qaAtIssue!.critical)
    expect(fromEvidence.warning).toBe(r.qaAtIssue!.warning)
    expect(fromEvidence.info).toBe(r.qaAtIssue!.info)
  })

  it('the capture stamp matches the issue stamp — one point in time', async () => {
    await issue('A')
    const r = rowAt(0)
    expect(r.qaEvidence!.capturedAt).toBe(r.issuedAt)
  })

  it('a project that never chose a standard still records the default it used', async () => {
    st().setStandard(undefined)
    await issue('A')
    expect(rowAt(0).standard).toMatchObject({ id: DEFAULT_STANDARD.id, fingerprint: fingerprintStandard(DEFAULT_STANDARD) })
  })

  it('an accepted finding is captured with its reason', async () => {
    // Take a key the engine really produced rather than assuming its shape —
    // an acceptance keyed on a finding that does not exist would make this
    // pass for the wrong reason.
    const live = qaFor(doc()).groups[0]!.findings[0]!
    st().ignoreFinding(live.key, 'Two displays of one instrument')
    await issue('A')
    const accepted = rowAt(0).qaEvidence!.findings.find((f) => f.ignored)
    expect(accepted?.ignored).toMatchObject({ reason: 'Two displays of one instrument' })
    expect(accepted?.key).toBe(live.key)
  })
})

describe('4 / 8 / 9 / 10. history does not move', () => {
  it('editing the standard afterwards does not touch the frozen fingerprint', async () => {
    await issue('A')
    const before = { ...rowAt(0).standard! }
    st().setStandard({ ...DEFAULT_STANDARD, id: 'acme', name: 'Acme Standard', version: '2.0' })
    expect(rowAt(0).standard).toEqual(before)
    // and the live fingerprint really did move, so this is not a no-op test
    expect(fingerprintStandard(standardOf(doc()))).not.toBe(before.fingerprint)
  })

  it('accepting a finding afterwards does not rewrite the evidence', async () => {
    await issue('A')
    const before = JSON.stringify(rowAt(0).qaEvidence)
    st().ignoreFinding(qaFor(doc()).groups[0]!.findings[0]!.key, 'Decided later')
    expect(JSON.stringify(rowAt(0).qaEvidence)).toBe(before)
  })

  it('un-accepting one does not either', async () => {
    const key = qaFor(doc()).groups[0]!.findings[0]!.key
    st().ignoreFinding(key, 'Accepted before issue')
    await issue('A')
    const before = JSON.stringify(rowAt(0).qaEvidence)
    st().unignoreFinding(key)
    expect(JSON.stringify(rowAt(0).qaEvidence)).toBe(before)
  })

  it('fixing the drawing afterwards does not rewrite the evidence', async () => {
    await issue('A')
    const before = JSON.stringify(rowAt(0).qaEvidence)
    const dup = sheet().nodes.find((n) => n.tag?.loop === '101')!
    st().setTag(dup.id, { letters: 'LT', loop: '999' })
    expect(JSON.stringify(rowAt(0).qaEvidence)).toBe(before)
  })

  it('11. a second issue leaves the first alone', async () => {
    await issue('A')
    const first = JSON.stringify(rowAt(0))
    st().setStandard({ ...DEFAULT_STANDARD, id: 'acme', name: 'Acme Standard', version: '2.0' })
    await issue('B')
    expect(JSON.stringify(rowAt(0))).toBe(first)
  })

  it('12. each revision keeps its OWN standard', async () => {
    await issue('A')
    st().setStandard({ ...DEFAULT_STANDARD, id: 'acme', name: 'Acme Standard', version: '2.0' })
    await issue('B')
    expect(rowAt(0).standard!.version).toBe('1.0')
    expect(rowAt(1).standard!.version).toBe('2.0')
    expect(rowAt(0).standard!.fingerprint).not.toBe(rowAt(1).standard!.fingerprint)
  })

  it('10. an issued row is still refused by updateRevision and deleteRevision', async () => {
    const id = await issue('A')
    const before = JSON.stringify(rowAt(0))
    expect(st().updateRevision(sheetId, id, { description: 'rewritten' }).ok).toBe(false)
    expect(st().deleteRevision(sheetId, id).ok).toBe(false)
    expect(JSON.stringify(rowAt(0))).toBe(before)
  })

  it('13. undo after an issue does not reach back through it', async () => {
    await issue('A')
    const before = JSON.stringify(rowAt(0))
    st().setRecordField('LT-101', 'instrument', 'signal.range', '0-10 bar')
    st().undo()
    st().undo()
    st().undo()
    expect(JSON.stringify(revisionsOf(sheet())[0])).toBe(before)
  })

  it('the stored row holds a COPY, not a window into the live QA report', async () => {
    // `qaFor` caches its report by document identity, so the same objects the
    // capture read from are still reachable. Mutating them must not reach the
    // frozen row — that is what `markIssued`'s deep copy is for.
    await issue('A')
    const before = rowAt(0).qaEvidence!.findings[0]!.message
    const live = qaFor(doc())
    for (const g of live.groups) for (const f of g.findings) f.message = 'tampered'
    expect(rowAt(0).qaEvidence!.findings[0]!.message).toBe(before)
    expect(rowAt(0).qaEvidence!.findings.some((f) => f.message === 'tampered')).toBe(false)
  })
})

describe('19 / 20. the provenance travels in the .pnid', () => {
  const roundTrip = () => loadDoc(JSON.parse(serializeDoc(doc())))

  it('survives serialize and reload exactly', async () => {
    await issue('A')
    const original = rowAt(0)
    const reopened = roundTrip()
    const reloaded = revisionsOf(reopened.sheets[0]!)[0]!
    expect(reloaded.standard).toEqual(original.standard)
    expect(reloaded.qaEvidence).toEqual(original.qaEvidence)
    expect(reloaded.qaAtIssue).toEqual(original.qaAtIssue)
  })

  it('20. is inspectable with NO local snapshot at all — the reviewer case', async () => {
    await issue('A')
    const json = serializeDoc(doc())
    // Another machine: nothing in IndexedDB, nothing in the snapshot store.
    __resetSnapshots()
    const elsewhere = loadDoc(JSON.parse(json))
    const row = revisionsOf(elsewhere.sheets[0]!)[0]!
    expect(row.standard!.fingerprint).toBeTruthy()
    expect(row.qaEvidence!.findings.length).toBeGreaterThan(0)
    expect(countsOfEvidence(row.qaEvidence!).total).toBe(row.qaAtIssue!.total)
  })

  it('stays a sane size — provenance must not bloat the file', async () => {
    await issue('A')
    const row = rowAt(0)
    const bytes = JSON.stringify({ standard: row.standard, qaEvidence: row.qaEvidence }).length
    // Well inside the 900 kB cloud ceiling, with room for a long history.
    expect(bytes).toBeLessThan(60_000)
  })
})

describe('21 / 22. old projects', () => {
  it('a revision issued before provenance existed stays valid and says so', () => {
    const legacy = createEmptyDoc('old')
    legacy.sheets[0]!.revisions = [{
      id: 'r1', code: 'A', date: '2025-01-01', description: 'First issue',
      preparedBy: 'PN', status: 'IFC', issuedAt: '2025-01-01T00:00:00.000Z',
      qaAtIssue: { critical: 0, warning: 2, info: 5, total: 7 },
    }]
    const reopened = loadDoc(JSON.parse(JSON.stringify(legacy)))
    const row = revisionsOf(reopened.sheets[0]!)[0]!
    expect(row.issuedAt).toBe('2025-01-01T00:00:00.000Z')
    // Absent, not fabricated: the standard and the rule set that produced
    // those seven findings are not recorded anywhere and cannot be recovered.
    expect(row.standard).toBeUndefined()
    expect(row.qaEvidence).toBeUndefined()
    expect(row.qaAtIssue!.total).toBe(7)
  })

  it('a document with no controlled metadata loads and saves unchanged', () => {
    const old = createEmptyDoc('old')
    const reopened = loadDoc(JSON.parse(JSON.stringify(old)))
    expect(reopened.meta.client).toBeUndefined()
    expect(reopened.meta.projectNumber).toBeUndefined()
    expect(reopened.schemaVersion).toBe(6)
  })
})


describe('23-28. P0 and P1 still work with provenance in the file', () => {
  it('a rename after an issue carries everything and rewrites no history', async () => {
    const areaId = st().addArea('100')
    const unitId = st().addUnit(areaId, 'U-101')
    st().assignUnit('LT-101', 'instrument', unitId)
    st().setRecordField('LT-101', 'instrument', 'alarm.H', '8')
    await issue('A')
    const frozen = JSON.stringify(rowAt(0))

    const node = sheet().nodes.find((n) => n.tag?.letters === 'LT')!
    st().setTag(node.id, { letters: 'LT', loop: '301' })

    // P0-A + P1-A + P1-D all followed the tag. The record is COPIED rather
    // than moved, because the seed draws LT-101 twice and the other placement
    // still needs its record — the documented `retagRegistry` rule.
    expect(doc().registry!['LT-301']!.unitId).toBe(unitId)
    expect(doc().registry!['LT-301']!.fields['alarm.H']).toBe('8')
    expect(doc().registry!['LT-101']!.unitId).toBe(unitId)
    // ...and the issued record did not move an inch.
    expect(JSON.stringify(rowAt(0))).toBe(frozen)
  })

  it('the I/O list still derives, and comparison still runs, after an issue', async () => {
    const { buildIndex } = await import('../../src/model/projectIndex')
    const { deriveIoList } = await import('../../src/model/ioList')
    const { compareDocs } = await import('../../src/model/diff')

    st().setRecordField('LT-101', 'instrument', 'signal.type', 'DI')
    const before = doc()
    await issue('A')
    st().setRecordField('LT-101', 'instrument', 'signal.type', 'AI')

    expect(deriveIoList(buildIndex(doc())).length).toBeGreaterThanOrEqual(0)
    const change = compareDocs(before, doc()).changes.find((c) => c.field === 'signal.type')
    expect(change).toMatchObject({ before: 'DI', after: 'AI', category: 'engineering' })
  })

  it('an accepted finding key still survives a redraw after an issue', async () => {
    const key = qaFor(doc()).groups[0]!.findings[0]!.key
    st().ignoreFinding(key, 'Known')
    await issue('A')
    const node = sheet().nodes.find((n) => n.tag)!
    st().deleteIds([node.id])
    expect(doc().qa!.ignored[key]).toBeTruthy()
    expect(rowAt(0).qaEvidence!.findings.some((f) => f.ignored)).toBe(true)
  })
})
