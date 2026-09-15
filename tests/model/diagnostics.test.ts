// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE SEVEN DIAGNOSTIC CATEGORIES.
 *
 * Every category is tested twice: once that it FIRES on a real defect, and
 * once that it stays SILENT on a correct project. The second half is the half
 * that matters — a diagnostic that reports everything is a diagnostic people
 * switch off, and this file is where a false positive gets caught before a
 * user finds it.
 */

import { describe, expect, it } from 'vitest'
import {
  bubble, docOf, findingsOf, pipe, pumpNode, vessel, widget,
} from './diagnosticsFixture'
import { diagnose, quantityOfUnit, sortFindings } from '../../src/model/diagnostics'
import { buildIndex } from '../../src/model/projectIndex'

// ── 1. MISSING TAG ──────────────────────────────────────────────────────────

describe('MISSING TAG', () => {
  it('reports an HMI object reading a tag the engineering source does not carry', () => {
    const doc = docOf({
      nodes: [],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101', label: 'Header pressure' })],
    })
    const found = findingsOf(doc, 'missing-tag')
    expect(found).toHaveLength(1)
    expect(found[0]!.tag).toBe('PT-101')
    expect(found[0]!.severity).toBe('error')
    expect(found[0]!.message).toContain('PT-101')
    // The action names the safe repair and refuses the destructive one.
    expect(found[0]!.suggestedAction).toContain('Do not delete the widget')
  })

  it('says nothing about a tag that is drawn', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101' })],
    })
    expect(findingsOf(doc, 'missing-tag')).toHaveLength(0)
  })

  it('reports one finding per BINDING, so accepting one does not silence the rest', () => {
    const doc = docOf({
      nodes: [],
      widgets: [
        widget({ id: 'w1', type: 'display', tag: 'PT-101' }),
        widget({ id: 'w2', type: 'gauge', tag: 'PT-101' }),
      ],
    })
    const found = findingsOf(doc, 'missing-tag')
    expect(found).toHaveLength(2)
    expect(new Set(found.map((f) => f.id)).size).toBe(2)
  })
})

// ── 2. BROKEN CONNECTION ────────────────────────────────────────────────────

describe('BROKEN CONNECTION', () => {
  it('reports a measurement bound to a line that is on no screen', () => {
    const doc = docOf({
      nodes: [bubble('FT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'FT-101', props: { bindPipe: 'gone' } })],
    })
    const found = findingsOf(doc, 'broken-connection')
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('error')
    // The reason this is the worst one: the value is not missing, it is wrong.
    expect(found[0]!.details).toContain('zero with GOOD quality')
  })

  it('reports a measurement bound to a vessel that is not a vessel', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101', props: { bindTank: 'TK-999' } })],
    })
    const found = findingsOf(doc, 'broken-connection')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('TK-999')
  })

  it('reports a P&ID line whose end names a symbol that is not on the sheet', () => {
    const node = bubble('PT', '101', 'keep')
    const doc = docOf({
      nodes: [node],
      edges: [{
        id: 'e1', lineClass: 'process.major',
        source: { nodeId: 'keep', portId: 'a' },
        target: { nodeId: 'deleted', portId: 'b' },
      }],
    })
    const found = findingsOf(doc, 'broken-connection')
    expect(found).toHaveLength(1)
    expect(found[0]!.source).toBe('pid')
    expect(found[0]!.location.kind).toBe('sheet-edge')
  })

  it('says nothing when every binding and every line end resolves', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101'), vessel('TK', '101')],
      widgets: [
        widget({ id: 'tk', type: 'tank', tag: 'TK-101' }),
        widget({ id: 'w1', type: 'display', tag: 'LT-101', props: { bindTank: 'TK-101' } }),
      ],
    })
    expect(findingsOf(doc, 'broken-connection')).toHaveLength(0)
  })
})

// ── 3. MISSING INSTRUMENT ───────────────────────────────────────────────────

describe('MISSING INSTRUMENT', () => {
  it('reports a bindable P&ID object a screen built from that sheet does not show', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101'), bubble('LT', '102')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101' })],
      fromSheet: true,
    })
    const found = findingsOf(doc, 'missing-instrument')
    expect(found).toHaveLength(1)
    expect(found[0]!.tag).toBe('LT-102')
    expect(found[0]!.severity).toBe('warning')
  })

  it('does NOT report undrawn instruments when no screen claims the sheet', () => {
    // The false-positive guard. A local gauge or a sample point is not an
    // omission just because nobody put it on an operator screen.
    const doc = docOf({
      nodes: [bubble('LT', '101'), bubble('PI', '205'), bubble('TI', '310')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101' })],
      fromSheet: false,
    })
    expect(findingsOf(doc, 'missing-instrument')).toHaveLength(0)
  })

  it('reports a controller with no measurement wired to it', () => {
    const doc = docOf({
      nodes: [bubble('LIC', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LIC-101', props: { controller: true } })],
    })
    const found = findingsOf(doc, 'missing-instrument')
    expect(found.some((f) => f.ruleId === 'controller-no-measurement')).toBe(true)
    expect(found.find((f) => f.ruleId === 'controller-no-measurement')!.severity).toBe('error')
  })

  it('says nothing about a controller that has its transmitter', () => {
    const doc = docOf({
      nodes: [bubble('LIC', '101'), bubble('LT', '101')],
      widgets: [
        widget({ id: 'w1', type: 'display', tag: 'LIC-101', props: { controller: true } }),
        widget({ id: 'w2', type: 'display', tag: 'LT-101' }),
      ],
    })
    expect(findingsOf(doc, 'missing-instrument').filter((f) => f.ruleId === 'controller-no-measurement'))
      .toHaveLength(0)
  })
})

// ── 4. INVALID RANGE ────────────────────────────────────────────────────────

describe('INVALID RANGE', () => {
  it('reports a calibrated range that does not ascend', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101' })],
      registry: { 'PT-101': { 'signal.range': '10-0 bar' } },
    })
    const found = findingsOf(doc, 'invalid-range')
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('error')
    expect(found[0]!.message).toContain('does not ascend')
  })

  it('reports a zero-width range, which is different from an inverted one', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101' })],
      registry: { 'PT-101': { 'signal.range': '5-5 bar' } },
    })
    const found = findingsOf(doc, 'invalid-range')
    expect(found).toHaveLength(1)
    expect(found[0]!.details).toContain('zero-width')
  })

  it('reports a physical quantity that cannot be positive', () => {
    const doc = docOf({
      nodes: [vessel('TK', '101')],
      widgets: [widget({ id: 'w1', type: 'tank', tag: 'TK-101' })],
      registry: { 'TK-101': { 'construction.volume': '0 m3' } },
    })
    const found = findingsOf(doc, 'invalid-range')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('capacity')
  })

  it('reports a range inverted by a WIDGET property, which no record covers', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101', props: { min: 10, max: 0 } })],
    })
    const found = findingsOf(doc, 'invalid-range')
    expect(found).toHaveLength(1)
    expect(found[0]!.details).toContain('widget property')
  })

  it('says nothing about an ordinary range', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101'), vessel('TK', '101')],
      widgets: [
        widget({ id: 'w1', type: 'display', tag: 'PT-101' }),
        widget({ id: 'tk', type: 'tank', tag: 'TK-101' }),
      ],
      registry: {
        'PT-101': { 'signal.range': '0-10 bar' },
        'TK-101': { 'construction.volume': '50 m3' },
      },
    })
    expect(findingsOf(doc, 'invalid-range')).toHaveLength(0)
  })
})

// ── 5. INVALID UNIT ─────────────────────────────────────────────────────────

describe('INVALID UNIT', () => {
  it('reports a unit that names a different quantity', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101' })],
      registry: { 'PT-101': { 'signal.units': 'm³/h' } },
    })
    const found = findingsOf(doc, 'invalid-unit')
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('error')
    expect(found[0]!.message).toContain('pressure')
    expect(found[0]!.message).toContain('flow')
    // Nothing is silently converted — the brief's rule, stated to the user.
    expect(found[0]!.details).toContain('Nothing is converted')
  })

  it('reports a per cent scale on a dimensioned measurement as a warning', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101' })],
      registry: { 'PT-101': { 'signal.units': '%' } },
    })
    const found = findingsOf(doc, 'invalid-unit')
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('warning')
  })

  it('accepts per cent on a LEVEL measurement, which is what the model uses', () => {
    // The false positive the bundled-sample baseline caught: `UNITS.level` is
    // '%', and an ISA level transmitter is conventionally ranged 0-100 %.
    const doc = docOf({
      nodes: [bubble('LT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'LT-101' })],
      registry: { 'LT-101': { 'signal.units': '%' } },
    })
    expect(findingsOf(doc, 'invalid-unit')).toHaveLength(0)
  })

  it('reports a unit it cannot read as INFO, not as an error', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101' })],
      registry: { 'PT-101': { 'signal.units': 'sqrgl' } },
    })
    const found = findingsOf(doc, 'invalid-unit')
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('info')
  })

  it('reports a range unit that contradicts the unit field', () => {
    const doc = docOf({
      nodes: [bubble('FT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'FT-101' })],
      registry: { 'FT-101': { 'signal.units': 'm³/h', 'signal.range': '0-100 °C' } },
    })
    const found = findingsOf(doc, 'invalid-unit')
    expect(found.some((f) => f.id.startsWith('unit-advisory:range-conflict'))).toBe(true)
  })

  it('says nothing about a correct unit', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101'), bubble('FT', '102'), bubble('TT', '103')],
      widgets: [
        widget({ id: 'a', type: 'display', tag: 'PT-101' }),
        widget({ id: 'b', type: 'display', tag: 'FT-102' }),
        widget({ id: 'c', type: 'display', tag: 'TT-103' }),
      ],
      registry: {
        'PT-101': { 'signal.units': 'bar' },
        'FT-102': { 'signal.units': 'm³/h' },
        'TT-103': { 'signal.units': '°C' },
      },
    })
    expect(findingsOf(doc, 'invalid-unit')).toHaveLength(0)
  })

  it('reads a unit table that knows dimensionless from unrecognised', () => {
    expect(quantityOfUnit('bar')).toBe('pressure')
    expect(quantityOfUnit('%')).toBe(null)
    expect(quantityOfUnit('parsecs')).toBe(undefined)
    expect(quantityOfUnit(undefined)).toBe(undefined)
  })
})

// ── 6. MISSING SIMULATION MODEL ─────────────────────────────────────────────

describe('MISSING SIMULATION MODEL', () => {
  it('reports a measurement with no process behind it', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'PT-101' })],
    })
    const found = findingsOf(doc, 'missing-simulation-model')
    expect(found).toHaveLength(1)
    expect(found[0]!.tag).toBe('PT-101')
    expect(found[0]!.message).toContain('no process model')
    // Step I §32: this must not be confused with bad data.
    expect(found[0]!.details).toContain('forced or failed instrument is a different finding')
  })

  it('reports a device on no flow path', () => {
    const doc = docOf({
      nodes: [pumpNode('P', '101')],
      widgets: [widget({ id: 'w1', type: 'pump', tag: 'P-101' })],
    })
    const found = findingsOf(doc, 'missing-simulation-model')
    expect(found.some((f) => f.tag === 'P-101' && f.message.includes('no flow path'))).toBe(true)
  })

  it('says nothing about a measurement that has a model', () => {
    const doc = docOf({
      nodes: [bubble('LT', '101'), vessel('TK', '101')],
      widgets: [
        widget({ id: 'tk', type: 'tank', tag: 'TK-101', x: 200, y: 200, w: 96, h: 128 }),
        widget({ id: 'w1', type: 'display', tag: 'LT-101', props: { bindTank: 'TK-101' } }),
      ],
      pipes: [pipe('p1', [[10, 10], [200, 240]], { bId: 'tk' })],
    })
    const found = findingsOf(doc, 'missing-simulation-model')
    expect(found.some((f) => f.tag === 'LT-101')).toBe(false)
    expect(found.some((f) => f.tag === 'TK-101')).toBe(false)
  })
})

// ── 7. UNBOUND HMI OBJECT ───────────────────────────────────────────────────

describe('UNBOUND HMI OBJECT', () => {
  it('reports a process widget carrying no tag at all', () => {
    const doc = docOf({ widgets: [widget({ id: 'w1', type: 'gauge' })] })
    const found = findingsOf(doc, 'unbound-hmi-object')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('carries no tag')
  })

  it('reports a control that writes to no signal', () => {
    const doc = docOf({ widgets: [widget({ id: 'w1', type: 'button', label: 'Start' })] })
    const found = findingsOf(doc, 'unbound-hmi-object')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('writes to no signal')
  })

  it('reports a control writing to a drawn tag that no runtime object carries', () => {
    const doc = docOf({
      nodes: [pumpNode('P', '101')],
      widgets: [widget({ id: 'w1', type: 'button', props: { signal: 'P-101.RUN' } })],
    })
    const found = findingsOf(doc, 'unbound-hmi-object')
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('error')
    expect(found[0]!.tag).toBe('P-101')
  })

  it('says nothing about a label, a panel or an imported graphic', () => {
    const doc = docOf({
      widgets: [
        widget({ id: 'l', type: 'label', label: 'UNIT 100' }),
        widget({ id: 'p', type: 'panel' }),
        widget({ id: 's', type: 'symbol', props: { symbolId: 'psv' } }),
      ],
    })
    expect(findingsOf(doc, 'unbound-hmi-object')).toHaveLength(0)
  })

  it('says nothing about a bound control', () => {
    const doc = docOf({
      nodes: [pumpNode('P', '101')],
      widgets: [
        widget({ id: 'pm', type: 'pump', tag: 'P-101' }),
        widget({ id: 'w1', type: 'button', props: { signal: 'P-101.RUN' } }),
      ],
    })
    expect(findingsOf(doc, 'unbound-hmi-object')).toHaveLength(0)
  })
})

// ── Structure ───────────────────────────────────────────────────────────────

describe('the diagnostic report', () => {
  it('counts by severity and by category, and the two agree on the total', () => {
    const doc = docOf({
      nodes: [bubble('PT', '101')],
      widgets: [
        widget({ id: 'w1', type: 'display', tag: 'PT-101' }),
        widget({ id: 'w2', type: 'display', tag: 'GONE-9' }),
        widget({ id: 'w3', type: 'gauge' }),
      ],
    })
    const r = diagnose(buildIndex(doc))
    const bySeverity = r.counts.error + r.counts.warning + r.counts.info
    const byCategory = Object.values(r.byCategory).reduce((a, b) => a + b, 0)
    expect(bySeverity).toBe(r.total)
    expect(byCategory).toBe(r.total)
    expect(r.total).toBeGreaterThan(0)
  })

  it('every finding carries an id, a rule, a message and an action', () => {
    const doc = docOf({
      nodes: [],
      widgets: [widget({ id: 'w1', type: 'display', tag: 'GONE-9' }), widget({ id: 'w2', type: 'gauge' })],
    })
    const r = diagnose(buildIndex(doc))
    expect(r.findings.length).toBeGreaterThan(0)
    for (const f of r.findings) {
      expect(f.id).toBeTruthy()
      expect(f.ruleId).toBeTruthy()
      expect(f.message.length).toBeGreaterThan(10)
      expect(f.suggestedAction.length).toBeGreaterThan(10)
      expect(f.location.kind).toBeTruthy()
    }
    expect(new Set(r.findings.map((f) => f.id)).size).toBe(r.findings.length)
  })

  it('sorts worst first, then by category, then by tag', () => {
    const shuffled = sortFindings([
      { id: 'c', category: 'invalid-unit', ruleId: 'x', severity: 'info', tag: 'B', source: 'hmi', message: '', suggestedAction: '', location: { kind: 'record' } },
      { id: 'a', category: 'missing-tag', ruleId: 'x', severity: 'error', tag: 'Z', source: 'hmi', message: '', suggestedAction: '', location: { kind: 'record' } },
      { id: 'b', category: 'missing-tag', ruleId: 'x', severity: 'error', tag: 'A', source: 'hmi', message: '', suggestedAction: '', location: { kind: 'record' } },
    ])
    expect(shuffled.map((f) => f.id)).toEqual(['b', 'a', 'c'])
  })
})
