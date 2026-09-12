// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P2-C Program 4 — `general.loop` as a house requirement.
 *
 * EXPRESSIBLE, never default. The whole point is that a company can say "an
 * instrument must belong to a declared loop" through the standards mechanism
 * it already has, and that a project which never says so sees no change at
 * all — including its standard's fingerprint.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { runRules, resetQaCache } from '../../src/validate/engine'
import { DEFAULT_STANDARD } from '../../src/model/standard'
import { fingerprintStandard } from '../../src/model/provenance'
import { LOOP_FIELD, newLoop } from '../../src/model/loop'
import { recordFieldValue } from '../../src/model/hierarchy'
import { labelForField } from '../../src/model/fields'
import type { EngineeringRecord, Registry } from '../../src/model/registry'
import type { PlantNode, ProjectDoc, Tag } from '../../src/model/types'
import type { StandardProfile } from '../../src/model/standard'

let seq = 0
const node = (tag: Tag): PlantNode =>
  ({ id: `n${seq++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag })
const rec = (key: string, over: Partial<EngineeringRecord> = {}): EngineeringRecord =>
  ({ key, kind: 'instrument', fields: {}, ...over })

function docOf(registry: Registry, loops = [] as ProjectDoc['loops'], standard?: StandardProfile): ProjectDoc {
  const d = createEmptyDoc('req')
  d.sheets[0]!.nodes = [node({ letters: 'LT', loop: '101' }), node({ letters: 'LIC', loop: '101' })]
  return { ...d, registry, ...(loops ? { loops } : {}), ...(standard ? { standard } : {}) }
}

/** A house standard that requires every instrument to belong to a loop. */
const requiresLoop: StandardProfile = {
  ...DEFAULT_STANDARD,
  id: 'house',
  name: 'House standard',
  required: { ...DEFAULT_STANDARD.required, instrument: [LOOP_FIELD] },
}

const findings = (doc: ProjectDoc) => {
  resetQaCache()
  const report = runRules(buildIndex(doc))
  return report.groups.find((g) => g.rule.id === 'required-field-empty')?.findings ?? []
}

beforeEach(() => { resetQaCache() })

describe('the key is expressible', () => {
  it('resolves through the one accessor, off the record', () => {
    expect(recordFieldValue(rec('LT-101', { loopId: 'L1' }), LOOP_FIELD)).toBe('L1')
    expect(recordFieldValue(rec('LT-101'), LOOP_FIELD)).toBe('')
  })

  it('has a printable label, so a finding can name it', () => {
    expect(labelForField(LOOP_FIELD)).toBe('Loop')
  })

  it('is NOT a catalogue field — it is a reference, not typed text', () => {
    // A record that happened to carry a `fields['general.loop']` string must
    // not satisfy anything: the assignment is `loopId` and nothing else.
    const r = rec('LT-101', { fields: { [LOOP_FIELD]: 'pretend' } })
    expect(recordFieldValue(r, LOOP_FIELD)).toBe('')
  })
})

describe('the default standard is untouched', () => {
  it('does not require it, and its fingerprint has not moved', () => {
    expect(DEFAULT_STANDARD.required.instrument).not.toContain(LOOP_FIELD)
    expect(fingerprintStandard(DEFAULT_STANDARD)).toBe('3c935cd3e3e09cd4')
  })

  it('a project on the default standard gains no finding from it', () => {
    const doc = docOf({ 'LT-101': rec('LT-101', { fields: { 'general.service': 'Feed' } }) })
    expect(findings(doc).map((f) => f.message).join(' ')).not.toMatch(/Loop/)
  })
})

describe('a house standard that requires it', () => {
  it('reports a started record with no loop assignment', () => {
    const doc = docOf({ 'LT-101': rec('LT-101', { fields: { 'general.service': 'Feed' } }) }, [], requiresLoop)
    const f = findings(doc)
    expect(f).toHaveLength(1)
    expect(f[0]!.entityKey).toBe('LT-101')
    expect(f[0]!.message).toMatch(/missing Loop/i)
  })

  it('is SATISFIED by a persistent loop assignment', () => {
    const loop = newLoop('101')
    const doc = docOf(
      { 'LT-101': rec('LT-101', { fields: { 'general.service': 'Feed' }, loopId: loop.id }) },
      [loop], requiresLoop,
    )
    expect(findings(doc)).toHaveLength(0)
  })

  it('is NOT satisfied by a derived loop alone', () => {
    // LT-101 and LIC-101 share loop number 101, so `deriveLoops` groups them.
    // That is an observation about numbering, not a declaration, and it must
    // not discharge a requirement nobody has answered.
    const doc = docOf({ 'LT-101': rec('LT-101', { fields: { 'general.service': 'Feed' } }) }, [], requiresLoop)
    expect(buildIndex(doc).loops.length).toBeGreaterThan(0)
    expect(findings(doc)).toHaveLength(1)
  })

  it('does not nag a record nobody has started, as the rule already decided', () => {
    const doc = docOf({}, [], requiresLoop)
    expect(findings(doc)).toHaveLength(0)
  })

  it('moves only the HOUSE fingerprint, which is correct — they changed their standard', () => {
    expect(fingerprintStandard(requiresLoop)).not.toBe(fingerprintStandard(DEFAULT_STANDARD))
    expect(fingerprintStandard(DEFAULT_STANDARD)).toBe('3c935cd3e3e09cd4')
  })
})
