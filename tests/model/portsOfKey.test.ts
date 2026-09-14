// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * P3-4B-2 — the ONE answer to "which connection points does this have".
 *
 * Three callers were reconstructing `catalogue ports ++ extraPorts`
 * separately: `buildIndex`, the `nozzle-port-missing` rule and the Inspector's
 * port picker. Three implementations of one question is three places for the
 * answer to drift, and the nozzle schedule would have been a fourth.
 *
 * This is NOT a port subsystem. It resolves nothing, names nothing, and says
 * nothing about what a port means — least of all that one is a nozzle.
 */

import { describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { buildIndex, portIdsOfKey, portsOfNode } from '../../src/model/projectIndex'
import { createEmptyDoc, createSheet } from '../../src/model/doc'
import { nozzlePortMissing } from '../../src/validate/rules/data'
import type { PlantNode, ProjectDoc, Sheet } from '../../src/model/types'
import { newNozzle } from '../../src/model/nozzle'

const node = (id: string, over: Partial<PlantNode> = {}): PlantNode =>
  ({ id, kind: 'equipment', symbolId: 'vessel.vertical', x: 0, y: 0, rotation: 0, ...over })

const sheetOf = (id: string, nodes: PlantNode[]): Sheet => ({ ...createSheet(1), id, nodes, edges: [] })
const docOf = (sheets: Sheet[], registry = {}): ProjectDoc =>
  ({ ...createEmptyDoc('ports'), sheets, registry })

describe('portsOfNode', () => {
  it('includes the catalogue ports', () => {
    // `vessel.vertical` carries eleven. None of them is a nozzle.
    expect(portsOfNode(node('v')).map((p) => p.id).sort()).toEqual(
      ['e', 'e1', 'e2', 'n', 'n1', 'n2', 's', 's1', 'w', 'w1', 'w2'],
    )
  })

  it('includes the pins the user added to THIS placement', () => {
    const ids = portsOfNode(node('v', { extraPorts: [{ id: 'pin-1', x: 4, y: 4, kind: 'process' }] })).map((p) => p.id)
    expect(ids).toContain('pin-1')
    expect(ids).toHaveLength(12)
  })

  it('excludes a pin that has been removed', () => {
    expect(portsOfNode(node('v', { extraPorts: [] })).map((p) => p.id)).not.toContain('pin-1')
  })

  it('carries the port KIND through', () => {
    const ports = portsOfNode(node('v', { extraPorts: [{ id: 'pin-1', x: 4, y: 4, kind: 'signal' }] }))
    expect(ports.find((p) => p.id === 'pin-1')!.kind).toBe('signal')
  })

  it('gives an unregistered symbol no ports rather than throwing', () => {
    expect(portsOfNode(node('v', { symbolId: 'not.a.real.symbol' }))).toEqual([])
  })

  it('is what buildIndex puts on IndexedNode.ports', () => {
    const n = node('v', { extraPorts: [{ id: 'pin-1', x: 4, y: 4, kind: 'process' }] })
    const ix = buildIndex(docOf([sheetOf('s1', [n])]))
    expect(ix.nodes.get('v')!.ports).toEqual(portsOfNode(n))
  })
})

describe('portIdsOfKey', () => {
  const tagged = (id: string, over: Partial<PlantNode> = {}) =>
    node(id, { tag: { letters: 'TK', loop: '101' }, ...over })

  it('is the UNION across every placement of a tag', () => {
    const ix = buildIndex(docOf([
      sheetOf('s1', [tagged('a', { extraPorts: [{ id: 'pin-1', x: 4, y: 4, kind: 'process' }] })]),
      sheetOf('s2', [tagged('b', { extraPorts: [{ id: 'pin-9', x: 4, y: 4, kind: 'process' }] })]),
    ]))
    const ids = portIdsOfKey(ix, 'TK-101')
    expect(ids.has('pin-1')).toBe(true)
    expect(ids.has('pin-9')).toBe(true)
    expect(ids.size).toBe(13)
  })

  it('is EMPTY for a key with nothing drawn, which is not "every port is missing"', () => {
    const ix = buildIndex(docOf([sheetOf('s1', [])]))
    expect(portIdsOfKey(ix, 'TK-101').size).toBe(0)
  })

  it('is empty for a key nothing has ever worn', () => {
    const ix = buildIndex(docOf([sheetOf('s1', [tagged('a')])]))
    expect(portIdsOfKey(ix, 'TK-999').size).toBe(0)
  })
})

describe('the QA rule reads the same answer it always did', () => {
  const withNozzle = (portId: string, nodes: PlantNode[]) =>
    buildIndex(docOf([sheetOf('s1', nodes)], {
      'TK-101': { key: 'TK-101', kind: 'equipment', fields: {}, nozzles: [newNozzle('N1', { portId })] },
    }))

  const tagged = (id: string, over: Partial<PlantNode> = {}) =>
    node(id, { tag: { letters: 'TK', loop: '101' }, ...over })

  it('says nothing about a catalogue port', () => {
    expect(nozzlePortMissing.run(withNozzle('n', [tagged('a')]))).toEqual([])
  })

  it('says nothing about a user pin', () => {
    const ix = withNozzle('pin-1', [tagged('a', { extraPorts: [{ id: 'pin-1', x: 4, y: 4, kind: 'process' }] })])
    expect(nozzlePortMissing.run(ix)).toEqual([])
  })

  it('reports a port no placement has', () => {
    const findings = nozzlePortMissing.run(withNozzle('gone', [tagged('a')]))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.message).toContain('gone')
  })

  it('still says NOTHING when the equipment is not drawn — orphan-record owns that', () => {
    expect(nozzlePortMissing.run(withNozzle('gone', []))).toEqual([])
  })

  it('accepts a port that exists on only ONE of two placements', () => {
    const ix = withNozzle('pin-1', [
      tagged('a'),
      tagged('b', { extraPorts: [{ id: 'pin-1', x: 4, y: 4, kind: 'process' }] }),
    ])
    expect(nozzlePortMissing.run(ix)).toEqual([])
  })
})
