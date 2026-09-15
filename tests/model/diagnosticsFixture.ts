// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Fixtures for the Step I diagnostics and reconciliation tests.
 *
 * Small, explicit documents: a sheet with named symbols, a screen with named
 * widgets, and a registry a test can write one field into. Shared between the
 * diagnostic tests and the reconciliation tests so both are arguing about the
 * same shape of project.
 */

import '../../src/symbols/lib/index'
import { createEmptyDoc } from '../../src/model/doc'
import { buildIndex } from '../../src/model/projectIndex'
import type { ProjectIndex } from '../../src/model/projectIndex'
import { createScreen } from '../../src/hmi/model'
import type { HmiPipe, HmiScreen, HmiWidget } from '../../src/hmi/model'
import type { PlantEdge, PlantNode, ProjectDoc } from '../../src/model/types'
import { diagnose } from '../../src/model/diagnostics'
import type { DiagnosticCategory, DiagnosticFinding } from '../../src/model/diagnostics'

let seq = 0

export const widget = (w: Partial<HmiWidget> & { id: string; type: HmiWidget['type'] }): HmiWidget => ({
  x: 0, y: 0, w: 64, h: 64, ...w,
})

export const bubble = (letters: string, loop: string, id?: string): PlantNode => ({
  id: id ?? `n${seq++}`, symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0,
  tag: { letters, loop },
})

export const vessel = (letters: string, loop: string, id?: string): PlantNode => ({
  id: id ?? `n${seq++}`, symbolId: 'vessel.tank', kind: 'equipment', x: 0, y: 0, rotation: 0,
  tag: { letters, loop },
})

export const pumpNode = (letters: string, loop: string, id?: string): PlantNode => ({
  id: id ?? `n${seq++}`, symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 0, rotation: 0,
  tag: { letters, loop },
})

export interface DocSpec {
  nodes?: PlantNode[]
  edges?: PlantEdge[]
  widgets?: HmiWidget[]
  pipes?: HmiPipe[]
  /** Registry field patches, keyed by tag. */
  registry?: Record<string, Record<string, string>>
  /** Set when the screen should claim a sheet (enables reconciliation). */
  fromSheet?: boolean
  baseline?: Record<string, string>
}

export function docOf(spec: DocSpec): ProjectDoc {
  const d = createEmptyDoc('t')
  const sheet = d.sheets[0]!
  sheet.name = 'Sheet 1'
  sheet.nodes = spec.nodes ?? []
  sheet.edges = spec.edges ?? []
  const screen: HmiScreen = {
    ...createScreen(1),
    id: 'scr1',
    name: 'Area 1',
    widgets: spec.widgets ?? [],
    pipes: spec.pipes ?? [],
    ...(spec.fromSheet ? { fromSheetId: sheet.id } : {}),
    ...(spec.baseline ? { baseline: spec.baseline } : {}),
  }
  const registry = Object.fromEntries(
    Object.entries(spec.registry ?? {}).map(([key, fields]) => [
      key,
      { key, kind: 'instrument' as const, fields },
    ]),
  )
  return { ...d, hmiScreens: [screen], ...(Object.keys(registry).length ? { registry } : {}) }
}

export const indexOf = (doc: ProjectDoc): ProjectIndex => buildIndex(doc)

/** Every finding of one category, which is what most assertions are about. */
export function findingsOf(doc: ProjectDoc, category: DiagnosticCategory): DiagnosticFinding[] {
  return diagnose(buildIndex(doc)).findings.filter((f) => f.category === category)
}

/** A straight pipe between two points, for building a flow path. */
export const pipe = (id: string, pts: [number, number][], ends?: { aId?: string; bId?: string }): HmiPipe => ({
  id,
  points: pts.map(([x, y]) => ({ x, y })),
  ...(ends?.aId ? { aId: ends.aId } : {}),
  ...(ends?.bId ? { bId: ends.bId } : {}),
})
