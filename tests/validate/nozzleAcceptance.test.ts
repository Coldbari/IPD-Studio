// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-3 — what an accepted nozzle finding is filed under.
 *
 * The rule: an acceptance is keyed on whatever the rule is ABOUT.
 *
 *  - `nozzle-duplicate-number` is about the NUMBER, so the number is the key.
 *    Renumber one of the pair and the collision is genuinely a different one.
 *  - `nozzle-duplicate-port` is about the PORT, for the same reason.
 *  - `nozzle-port-missing` is about the NOZZLE — the number is only how the
 *    message reads. Keying it on the number meant renumbering N1 to N9
 *    stranded the acceptance and re-opened a finding about an unchanged
 *    breakage, which is the defect this file pins shut.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { runRules, type IgnoredEntry } from '../../src/validate/engine'
import { buildIndex } from '../../src/model/projectIndex'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { newNozzle } from '../../src/model/nozzle'
import type { Nozzle } from '../../src/model/nozzle'
import type { EngineeringRecord } from '../../src/model/registry'
import type { PlantNode, ProjectDoc } from '../../src/model/types'

/* ------------------------------------------------------------- fixtures */

const vessel = (id: string): PlantNode =>
  ({ id, symbolId: 'vessel.vertical', kind: 'equipment', x: 0, y: 0, rotation: 0, tag: { letters: 'TK', loop: '101' } })

const docWith = (nozzles: Nozzle[]): ProjectDoc => ({
  ...createEmptyDoc('acceptance'),
  sheets: [{ ...createSheet(1), id: 's1', nodes: [vessel('v')], edges: [] }],
  registry: { 'TK-101': { key: 'TK-101', kind: 'equipment', fields: {}, nozzles } as EngineeringRecord },
})

/** Every finding one rule produces, live or accepted. */
function report(doc: ProjectDoc, ignored: Record<string, IgnoredEntry> = {}) {
  const r = runRules(buildIndex(doc), ignored)
  return {
    live: r.groups.flatMap((g) => g.findings),
    accepted: r.ignored.map((s) => s.finding),
  }
}
const liveIds = (doc: ProjectDoc, ignored: Record<string, IgnoredEntry> = {}) =>
  report(doc, ignored).live.map((f) => f.ruleId)

const accept = (key: string): Record<string, IgnoredEntry> =>
  ({ [key]: { reason: 'Nozzle is on a nozzle neck not drawn here', by: 'PN', at: '2026-09-15T00:00:00.000Z' } })

/** Rename a nozzle without touching anything else about it — the exact shape
 *  `updateNozzle` produces, which keeps the id. */
const renumber = (doc: ProjectDoc, id: string, to: string): ProjectDoc => ({
  ...doc,
  registry: {
    'TK-101': {
      ...doc.registry!['TK-101']!,
      nozzles: doc.registry!['TK-101']!.nozzles!.map((n) => (n.id === id ? { ...n, number: to } : n)),
    },
  },
})

/* --------------------------------------------------- nozzle-port-missing */

describe('an accepted nozzle-port-missing survives a renumber', () => {
  const broken = newNozzle('N1', { portId: 'gone' })
  const doc = docWith([broken])
  const keyOf = (d: ProjectDoc) =>
    report(d).live.find((f) => f.ruleId === 'nozzle-port-missing')!.key

  it('reports the broken port in the first place', () => {
    expect(liveIds(doc)).toContain('nozzle-port-missing')
  })

  it('is keyed on the stable id, not on the number', () => {
    expect(keyOf(doc)).toBe(`nozzle-port-missing:TK-101/${broken.id}`)
    expect(keyOf(doc)).not.toContain('N1')
  })

  it('still names the nozzle by its NUMBER where a person reads it', () => {
    const f = report(doc).live.find((x) => x.ruleId === 'nozzle-port-missing')!
    expect(f.message).toContain('nozzle N1')
    expect(f.message).toContain('gone')
    // The conformance report's Object column — readable, never a ULID.
    expect(f.entityKey).toBe('TK-101/N1')
    expect(f.entityKey).not.toContain(broken.id)
  })

  it('STAYS ACCEPTED after N1 becomes N9', () => {
    const ignored = accept(keyOf(doc))
    expect(liveIds(doc, ignored)).not.toContain('nozzle-port-missing')

    const renamed = renumber(doc, broken.id, 'N9')
    // Same nozzle, same unrepaired breakage, same acceptance.
    expect(liveIds(renamed, ignored)).not.toContain('nozzle-port-missing')
    // And the message follows the new number.
    const still = report(renamed, ignored).accepted.find((f) => f.ruleId === 'nozzle-port-missing')
    expect(still!.message).toContain('nozzle N9')
  })

  it('would be a DIFFERENT acceptance for a different nozzle', () => {
    // The id is the identity, so an acceptance cannot leak onto another
    // nozzle that happens to be renumbered into the accepted one's place.
    const other = newNozzle('N1', { portId: 'gone' })
    expect(keyOf(docWith([other]))).not.toBe(keyOf(doc))
  })

  it('re-opens once the port is repaired, acceptance or not', () => {
    const ignored = accept(keyOf(doc))
    const fixed = docWith([{ ...broken, portId: 'n' }])
    expect(liveIds(fixed, ignored)).not.toContain('nozzle-port-missing')
    expect(report(fixed, ignored).accepted).toHaveLength(0)
  })
})

/* ----------------------------------- the two rules that keep their keys */

describe('the other two rules stay keyed on what they are about', () => {
  it('nozzle-duplicate-number is keyed on the NUMBER', () => {
    const doc = docWith([newNozzle('N1'), newNozzle('N1')])
    const f = report(doc).live.find((x) => x.ruleId === 'nozzle-duplicate-number')!
    expect(f.key).toBe('nozzle-duplicate-number:TK-101/N1')
  })

  it('and a renumber therefore clears it rather than carrying the acceptance', () => {
    const a = newNozzle('N1')
    const doc = docWith([a, newNozzle('N1')])
    const ignored = accept('nozzle-duplicate-number:TK-101/N1')
    expect(liveIds(doc, ignored)).not.toContain('nozzle-duplicate-number')
    // Renumbering one of them is a repair — there is no collision left at all.
    const renamed = renumber(doc, a.id, 'N9')
    expect(liveIds(renamed, ignored)).not.toContain('nozzle-duplicate-number')
    expect(report(renamed, ignored).accepted).toHaveLength(0)
  })

  it('nozzle-duplicate-port is keyed on the PORT', () => {
    const doc = docWith([newNozzle('N1', { portId: 'n' }), newNozzle('N2', { portId: 'n' })])
    const f = report(doc).live.find((x) => x.ruleId === 'nozzle-duplicate-port')!
    expect(f.key).toBe('nozzle-duplicate-port:TK-101/n')
  })

  it('and an accepted port collision survives renumbering both nozzles', () => {
    const a = newNozzle('N1', { portId: 'n' })
    const doc = docWith([a, newNozzle('N2', { portId: 'n' })])
    const ignored = accept('nozzle-duplicate-port:TK-101/n')
    expect(liveIds(doc, ignored)).not.toContain('nozzle-duplicate-port')
    expect(liveIds(renumber(doc, a.id, 'N9'), ignored)).not.toContain('nozzle-duplicate-port')
  })
})
