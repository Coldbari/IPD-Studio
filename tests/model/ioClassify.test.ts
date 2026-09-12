// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * How a final element's I/O type is decided, and — more importantly — when it
 * is refused.
 *
 * The rule this file defends: AO is returned only on EVIDENCE of a modulating
 * actuator. `node.kind === 'valve'` used to be treated as that evidence, which
 * made a hand valve and a relief valve report as analogue outputs. An I/O list
 * is what a vendor cards a cabinet from, so a confident wrong answer here is a
 * wiring change on site.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import { classifyIo, deriveIoList } from '../../src/model/ioList'
import { ioTypeUnclassified } from '../../src/validate/rules/signal'
import type { PlantEdge, PlantNode, ProjectDoc } from '../../src/model/types'

let n = 0
beforeEach(() => { n = 0 })

const node = (p: Partial<PlantNode> & Pick<PlantNode, 'symbolId' | 'kind'>): PlantNode =>
  ({ id: `n${n++}`, x: 0, y: 0, rotation: 0, ...p })
const sig = (a: string, b: string, lineClass: PlantEdge['lineClass'] = 'signal.electric'): PlantEdge =>
  ({ id: `e${n++}`, lineClass, source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })

function docOf(nodes: PlantNode[], edges: PlantEdge[] = []): ProjectDoc {
  const base = createEmptyDoc('t')
  return { ...base, sheets: [{ ...base.sheets[0]!, id: 'sh1', nodes, edges }] }
}

/** One tagged final element, wired to a DCS so it has a signal line. */
function driven(symbolId: string, kind: PlantNode['kind'], letters: string, config?: Record<string, string>) {
  const dev = node({ symbolId, kind, tag: { letters, loop: '101' }, ...(config ? { config } : {}) })
  const dcs = node({ symbolId: 'ctl.dcs', kind: 'equipment' })
  const doc = docOf([dev, dcs], [sig(dev.id, dcs.id)])
  return { doc, verdict: classifyIo(dev, buildIndex(doc)) }
}

describe('discrete evidence', () => {
  it('a solenoid valve is a discrete output', () => {
    expect(driven('valve.solenoid', 'valve', 'XV').verdict).toMatchObject({ type: 'DO' })
  })

  it('a motor-operated valve is a discrete output', () => {
    expect(driven('valve.mov', 'valve', 'XV').verdict).toMatchObject({ type: 'DO' })
  })

  it('a solenoid ACTUATOR on a control-valve body is a discrete output', () => {
    // The actuator is the fact, not the body. A control valve fitted with a
    // solenoid is on/off however it is drawn.
    const { verdict } = driven('cv.ball', 'valve', 'XV', { actuator: 'solenoid' })
    expect(verdict.type).toBe('DO')
    expect(verdict.basis).toContain('solenoid')
  })
})

describe('analogue evidence', () => {
  it('a control-valve body with its default modulating actuator is an analogue output', () => {
    const { verdict } = driven('cv.globe', 'valve', 'FV', { actuator: 'diaphragm', positioner: 'none' })
    expect(verdict.type).toBe('AO')
  })

  it('a positioner is decisive, whatever the body', () => {
    // A positioner exists to hold an intermediate position. Nothing else does.
    const { verdict } = driven('valve.threeway', 'valve', 'FV', { positioner: 'yes' })
    expect(verdict.type).toBe('AO')
    expect(verdict.basis).toContain('Positioner')
  })

  it('an I/P converter is an analogue output', () => {
    expect(driven('instr.converter', 'instrument', 'FY').verdict.type).toBe('AO')
  })
})

describe('refusing to guess — the regression this file exists for', () => {
  it('a generic valve with no actuator information is UNKNOWN, not AO', () => {
    const { verdict } = driven('valve.threeway', 'valve', 'FV')
    expect(verdict.type).toBe('unknown')
    expect(verdict.basis).toContain('actuator')
  })

  it('a manual valve is not an analogue output', () => {
    const { verdict } = driven('valve.angle', 'valve', 'FV', { actuator: 'manual' })
    expect(verdict.type).toBe('unknown')
    expect(verdict.basis).toContain('hand-operated')
  })

  it('a custom symbol tagged as a valve carries no actuator evidence, so UNKNOWN', () => {
    // The exact case a hard-coded symbol-id allowlist could never cover: a
    // definition the catalogue has never seen.
    const { verdict } = driven('custom.my-valve', 'valve', 'FV')
    expect(verdict.type).toBe('unknown')
  })

  it('an unregistered symbol id does not throw', () => {
    expect(() => driven('nonsense.symbol', 'valve', 'FV')).not.toThrow()
  })
})

describe('the letters that legitimately cannot be classified', () => {
  const cases: [string, string][] = [
    ['FE', 'a primary element is not itself the transmitter'],
    ['TE', 'a thermowell is not itself the transmitter'],
    ['PI', 'an indicator does not say which way the signal travels'],
  ]
  for (const [letters, why] of cases) {
    it(`${letters} — ${why}`, () => {
      expect(driven('instr.bubble', 'instrument', letters).verdict.type).toBe('unknown')
    })
  }

  it('and each one raises an info finding that names the reason', () => {
    const { doc } = driven('instr.bubble', 'instrument', 'FE')
    const found = ioTypeUnclassified.run(buildIndex(doc))
    expect(found).toHaveLength(1)
    expect(found[0]!.entityKey).toBe('FE-101')
    expect(found[0]!.message).toContain('FE-101')
    expect(ioTypeUnclassified.severity).toBe('info')
  })
})

describe('a classifiable point raises no unclassified finding', () => {
  for (const [letters, expected] of [['LT', 'AI'], ['LSH', 'DI']] as const) {
    it(`${letters} → ${expected}`, () => {
      const { doc, verdict } = driven('instr.bubble', 'instrument', letters)
      expect(verdict.type).toBe(expected)
      expect(ioTypeUnclassified.run(buildIndex(doc))).toHaveLength(0)
    })
  }

  it('a solenoid valve → DO, and nothing to report', () => {
    const { doc } = driven('valve.solenoid', 'valve', 'XV')
    expect(ioTypeUnclassified.run(buildIndex(doc))).toHaveLength(0)
  })

  it('a stated I/O type on the record settles it, so the finding goes', () => {
    const { doc } = driven('valve.threeway', 'valve', 'FV')
    expect(ioTypeUnclassified.run(buildIndex(doc))).toHaveLength(1)
    const stated: ProjectDoc = {
      ...doc,
      registry: { 'FV-101': { key: 'FV-101', kind: 'valve', fields: { 'signal.type': 'DO' } } },
    }
    expect(ioTypeUnclassified.run(buildIndex(stated))).toHaveLength(0)
    expect(deriveIoList(buildIndex(stated))[0]).toMatchObject({ type: 'DO', typeSource: 'registry' })
  })
})

describe('a device with no wiring is still NONE, not unknown', () => {
  it('a relief valve with no signal line is not an I/O point at all', () => {
    const psv = node({ symbolId: 'psv', kind: 'valve', tag: { letters: 'PSV', loop: '101' } })
    expect(classifyIo(psv, buildIndex(docOf([psv]))).type).toBe('none')
  })

  it('and it never reaches the unclassified rule', () => {
    const psv = node({ symbolId: 'psv', kind: 'valve', tag: { letters: 'PSV', loop: '101' } })
    expect(ioTypeUnclassified.run(buildIndex(docOf([psv])))).toHaveLength(0)
  })
})
