// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * What a revision comparison must and must not say about provenance.
 *
 * The distinction the whole file turns on: a change to what the DOCUMENT
 * CLAIMS TO BE — its client, its number, the standard it is checked against —
 * is a real change a reviewer needs. A difference in the revision TABLE
 * between two snapshots is not a change at all; it is the frame the comparison
 * is happening inside.
 */

import { describe, expect, it } from 'vitest'
import { createEmptyDoc } from '../../src/model/doc'
import { compareDocs } from '../../src/model/diff'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { fingerprintStandard, standardProvenance } from '../../src/model/provenance'
import type { DocChange } from '../../src/model/diff'
import type { ProjectDoc, Revision } from '../../src/model/types'

/** ONE base document, shared. `createEmptyDoc` mints a fresh sheet id on every
 *  call, so building each side separately would diff as a removed sheet plus an
 *  added one and drown whatever the test was actually about. */
const BASE = createEmptyDoc('t')
const docOf = (over: Partial<ProjectDoc> = {}): ProjectDoc => ({ ...BASE, ...over })
const at = (cs: DocChange[], field: string) => cs.find((c) => c.field === field)

describe('controlled-document metadata is compared', () => {
  const withMeta = (over: Partial<ProjectDoc['meta']>) => docOf({ meta: { ...BASE.meta, ...over } })

  for (const field of ['client', 'projectNumber', 'plant', 'discipline', 'documentNumber', 'name', 'author'] as const) {
    it(`${field} changing is reported`, () => {
      const d = compareDocs(withMeta({ [field]: 'before' }), withMeta({ [field]: 'after' }))
      expect(at(d.changes, field)).toMatchObject({
        entityType: 'document', before: 'before', after: 'after', category: 'metadata',
      })
    })
  }

  it('gaining a field that was blank is reported', () => {
    const d = compareDocs(withMeta({}), withMeta({ client: 'Northern Refining' }))
    expect(at(d.changes, 'client')).toMatchObject({ before: undefined, after: 'Northern Refining' })
  })

  it('timestamps are not — they are not decisions', () => {
    const d = compareDocs(
      withMeta({ created: '2020-01-01', modified: '2020-01-01' }),
      withMeta({ created: '2020-01-01', modified: '2026-09-11' }),
    )
    expect(at(d.changes, 'modified')).toBeUndefined()
    expect(d.changes).toHaveLength(0)
  })

  it('metadata is metadata — it must not inflate the engineering count', () => {
    const d = compareDocs(withMeta({ client: 'A' }), withMeta({ client: 'B' }))
    expect(d.engineeringCount).toBe(0)
  })
})

describe('a standard that moved is visible', () => {
  const withStd = (over: Partial<typeof DEFAULT_STANDARD>) =>
    docOf({ standard: { ...DEFAULT_STANDARD, ...over } })

  it('the fingerprint change is reported as engineering', () => {
    const before = withStd({ required: { ...DEFAULT_STANDARD.required, instrument: ['general.service'] } })
    const after = withStd({ required: { ...DEFAULT_STANDARD.required, instrument: ['general.service', 'signal.units'] } })
    const change = at(compareDocs(before, after).changes, 'fingerprint')
    expect(change).toMatchObject({
      entityType: 'standard',
      before: fingerprintStandard(before.standard!),
      after: fingerprintStandard(after.standard!),
      category: 'engineering',
    })
  })

  it('a version bump is reported as metadata', () => {
    const change = at(compareDocs(withStd({ version: '1.0' }), withStd({ version: '2.0' })).changes, 'version')
    expect(change).toMatchObject({ before: '1.0', after: '2.0', category: 'metadata' })
  })

  it('an unchanged standard reports no fingerprint change', () => {
    expect(at(compareDocs(withStd({}), withStd({})).changes, 'fingerprint')).toBeUndefined()
  })

  it('reordering a required-field list is not a change', () => {
    const a = withStd({ required: { ...DEFAULT_STANDARD.required, valve: ['element.size', 'actuation.failPosition'] } })
    const b = withStd({ required: { ...DEFAULT_STANDARD.required, valve: ['actuation.failPosition', 'element.size'] } })
    expect(at(compareDocs(a, b).changes, 'fingerprint')).toBeUndefined()
  })
})

describe('historical provenance creates no false changes', () => {
  const issued = (over: Partial<Revision> = {}): Revision => ({
    id: 'r1', code: 'A', date: '2026-01-01', description: 'First', preparedBy: 'PN',
    status: 'IFC', issuedAt: '2026-01-01T00:00:00.000Z',
    standard: standardProvenance(DEFAULT_STANDARD),
    qaAtIssue: { critical: 0, warning: 1, info: 2, total: 3 },
    qaEvidence: { findings: [], omitted: 3, capturedAt: '2026-01-01T00:00:00.000Z' },
    ...over,
  })

  const withRevisions = (rows: Revision[]): ProjectDoc =>
    ({ ...BASE, sheets: [{ ...BASE.sheets[0]!, id: 'sh1', revisions: rows }] })

  it('a snapshot gaining the revision row it was issued under is NOT reported', () => {
    // Every comparison of two issues would otherwise open with "a revision was
    // added", which is noise dressed as information.
    const before = withRevisions([issued()])
    const after = withRevisions([issued(), issued({ id: 'r2', code: 'B' })])
    expect(compareDocs(before, after).changes).toHaveLength(0)
  })

  it('frozen QA evidence does not diff', () => {
    const before = withRevisions([issued()])
    const after = withRevisions([issued({ qaEvidence: { findings: [], omitted: 99, capturedAt: 'x' } })])
    expect(compareDocs(before, after).changes).toHaveLength(0)
  })

  it('but the LIVE standard between two snapshots still does', () => {
    const before: ProjectDoc = { ...withRevisions([issued()]), standard: { ...DEFAULT_STANDARD, version: '1.0' } }
    const after: ProjectDoc = { ...withRevisions([issued()]), standard: { ...DEFAULT_STANDARD, version: '2.0' } }
    expect(at(compareDocs(before, after).changes, 'version')).toBeTruthy()
  })
})
