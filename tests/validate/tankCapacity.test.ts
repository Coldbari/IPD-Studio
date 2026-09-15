// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * A vessel simulating on an ASSUMED capacity has to say so.
 *
 * Capacity used to come from the widget's pixel area, so every vessel silently
 * had one. It now comes from the engineering record, and where nobody has
 * stated one the simulator uses a documented default — disclosed here rather
 * than passed off as engineering data.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { tankCapacityDefaulted } from '../../src/validate/rules/process'
import { createScreen } from '../../src/hmi/model'
import { buildTagDefs } from '../../src/hmi/sim/tags'
import { DEFAULTS } from '../../src/hmi/sim/units'
import type { HmiWidget } from '../../src/hmi/model'
import type { ProjectDoc } from '../../src/model/types'
import type { Registry } from '../../src/model/registry'

const tank = (tag: string, props?: HmiWidget['props']): HmiWidget =>
  ({ id: `w-${tag}`, type: 'tank', x: 0, y: 0, w: 96, h: 128, tag, ...(props ? { props } : {}) })

function docOf(widgets: HmiWidget[], registry?: Registry): ProjectDoc {
  const d = createEmptyDoc('t')
  return { ...d, hmiScreens: [{ ...createScreen(1), widgets }], ...(registry ? { registry } : {}) }
}

const run = (doc: ProjectDoc) => tankCapacityDefaulted.run(buildIndex(doc))

describe('tank-capacity-defaulted', () => {
  it('reports a vessel nobody has stated a volume for, and names the assumption', () => {
    const out = run(docOf([tank('TK-1')]))
    expect(out).toHaveLength(1)
    expect(out[0]!.entityKey).toBe('TK-1')
    expect(out[0]!.message).toContain(`${DEFAULTS.tankVolumeM3} m³`)
    expect(out[0]!.message).toContain('TK-1')
  })

  it('says nothing once the record states one', () => {
    const registry: Registry = { 'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': '250 m³' } } }
    expect(run(docOf([tank('TK-1')], registry))).toHaveLength(0)
  })

  it('a legacy widget capacity is still an answer, just not one on the record', () => {
    expect(run(docOf([tank('TK-1', { capacity: 60 })]))).toHaveLength(0)
  })

  it('an unreadable volume is NOT taken as stated — that is the whole point', () => {
    const registry: Registry = { 'TK-1': { key: 'TK-1', kind: 'equipment', fields: { 'construction.volume': 'see vendor drawing' } } }
    expect(run(docOf([tank('TK-1')], registry))).toHaveLength(1)
  })

  it('one finding per vessel, however many times it is drawn', () => {
    const out = run(docOf([tank('TK-1'), tank('TK-1'), tank('TK-2')]))
    expect(out.map((f) => f.entityKey).sort()).toEqual(['TK-1', 'TK-2'])
  })

  it('an untagged vessel has no identity to report against', () => {
    expect(run(docOf([{ id: 'w', type: 'tank', x: 0, y: 0, w: 96, h: 128 }]))).toHaveLength(0)
  })

  it('is INFO — a drawing nobody has specified yet is normal, not an error', () => {
    expect(tankCapacityDefaulted.severity).toBe('info')
  })

  it('and what it reports is exactly what the simulator flagged', () => {
    const doc = docOf([tank('TK-1'), tank('TK-2', { capacity: 60 })])
    const flagged = buildTagDefs(doc.hmiScreens, doc.registry)
      .filter((d) => d.capacityDefaulted)
      .map((d) => d.name)
    expect(run(doc).map((f) => f.entityKey)).toEqual(flagged)
  })
})
