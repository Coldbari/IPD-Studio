// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Praharsh Nagpure - IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { EdgeEnd, PlantEdge, Sheet } from './types'
import { isJunctionEnd } from './types'

/**
 * Return every persisted edge that belongs to the same managed line object.
 *
 * Junctions describe connectivity only. They must not make an adjacent branch
 * part of the original line's editing/selection/property scope.
 */
export function lineGroupIds(sheet: Pick<Sheet, 'edges'>, seedId: string): string[] {
  const seed = sheet.edges.find((edge) => edge.id === seedId)
  if (!seed) return []

  if (!seed.lineGroupId) {
    // Legacy documents had no explicit identity. Infer a line object from
    // collinear limbs at the same junction. A perpendicular limb is a real
    // branch and must not steal the main line's arrow or selection.
    const key = (end: PlantEdge['source']) => {
      if ('nodeId' in end) return null
      return `point:${Math.round(end.x * 2) / 2},${Math.round(end.y * 2) / 2}`
    }
    const pointOf = (end: PlantEdge['source']): { x: number; y: number } | null =>
      'nodeId' in end ? null : { x: end.x, y: end.y }
    const portAxis = (end: PlantEdge['source']): 'h' | 'v' | null => {
      if (!('nodeId' in end)) return null
      const port = end.portId.toLowerCase()
      if (/^(e|w|east|west)/.test(port)) return 'h'
      if (/^(n|s|north|south)/.test(port)) return 'v'
      return null
    }
    const axisAt = (edge: PlantEdge, side: 'source' | 'target'): 'h' | 'v' | null => {
      const endpoint = pointOf(edge[side])
      if (!endpoint) return portAxis(edge[side])
      const route = side === 'source'
        ? [endpoint, ...(edge.vertices ?? []), pointOf(edge.target)].filter((point): point is { x: number; y: number } => Boolean(point))
        : [pointOf(edge.source), ...(edge.vertices ?? []), endpoint].filter((point): point is { x: number; y: number } => Boolean(point)).reverse()
      const next = route.find((point) => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) > 0.5)
      // Legacy limbs often have a junction at one end and a device port at
      // the other. The port's cardinal name still tells us whether this is the
      // horizontal main run or a vertical branch.
      if (!next) return portAxis(side === 'source' ? edge.target : edge.source) ?? portAxis(edge[side === 'source' ? 'source' : 'target'])
      return Math.abs(next.x - endpoint.x) >= Math.abs(next.y - endpoint.y) ? 'h' : 'v'
    }
    const by = new Map<string, PlantEdge[]>()
    for (const e of sheet.edges) for (const end of [e.source, e.target]) {
      const k = key(end); if (k) by.set(k, [...(by.get(k) ?? []), e])
    }
    const out = new Set<string>(); const queue = [seed]
    while (queue.length) {
      const e = queue.pop()!
      if (out.has(e.id)) continue
      out.add(e.id)
      for (const side of ['source', 'target'] as const) {
        const end = e[side]
        const k = key(end)
        if (!k) continue
        const axis = axisAt(e, side)
        for (const candidate of by.get(k) ?? []) {
          if (candidate.id === e.id) continue
          const candidateSide = key(candidate.source) === k ? 'source' : key(candidate.target) === k ? 'target' : null
          if (candidateSide && axis && axisAt(candidate, candidateSide) === axis) queue.push(candidate)
        }
      }
    }
    return sheet.edges.filter((e) => out.has(e.id)).map((e) => e.id)
  }
  return sheet.edges.filter((edge) => edge.lineGroupId === seed.lineGroupId).map((edge) => edge.id)
}

/** Stable user-facing representative for a junction-connected line group. */
export function lineGroupRepresentative(sheet: Pick<Sheet, 'edges'>, seedId: string): string | null {
  const seed = sheet.edges.find((edge) => edge.id === seedId)
  if (!seed) return null
  if (seed.lineGroupId) return sheet.edges.find((edge) => edge.lineGroupId === seed.lineGroupId)?.id ?? seedId
  return lineGroupIds(sheet, seedId)[0] ?? seedId
}

/**
 * Return every limb that physically meets the selected line through a
 * junction. This is deliberately broader than `lineGroupIds`: separate line
 * objects may share a tee, but all of their visible limbs still need the same
 * selection affordance while editing the topology.
 */
export function junctionConnectedIds(sheet: Pick<Sheet, 'edges'>, seedIds: Iterable<string>): string[] {
  const edges = sheet.edges
  const byJunction = new Map<string, PlantEdge[]>()
  for (const edge of edges) {
    for (const end of [edge.source, edge.target]) {
      if (!isJunctionEnd(end)) continue
      byJunction.set(end.junctionId, [...(byJunction.get(end.junctionId) ?? []), edge])
    }
  }
  const out = new Set<string>()
  const queue = [...seedIds].map((id) => edges.find((edge) => edge.id === id)).filter((edge): edge is PlantEdge => Boolean(edge))
  while (queue.length) {
    const edge = queue.pop()!
    if (out.has(edge.id)) continue
    out.add(edge.id)
    for (const end of [edge.source, edge.target]) {
      if (isJunctionEnd(end)) queue.push(...(byJunction.get(end.junctionId) ?? []))
    }
  }
  return edges.filter((edge) => out.has(edge.id)).map((edge) => edge.id)
}

/** Remove junction metadata from a point that no longer has another limb.
 * Deleting one section must leave the surviving section editable as its own
 * free-ended object; it must not retain a phantom branch endpoint. */
export function normalizeDanglingJunctions(sheet: Sheet): Sheet {
  const counts = new Map<string, number>()
  for (const edge of sheet.edges) {
    for (const end of [edge.source, edge.target]) {
      if (isJunctionEnd(end)) counts.set(end.junctionId, (counts.get(end.junctionId) ?? 0) + 1)
    }
  }
  let changed = false
  const freeEnd = (end: PlantEdge['source']): PlantEdge['source'] => {
    if (!isJunctionEnd(end) || counts.get(end.junctionId) !== 1) return end
    changed = true
    return { x: end.x, y: end.y, ...(end.pendingTag ? { pendingTag: end.pendingTag } : {}) }
  }
  const edges = sheet.edges.map((edge) => {
    const source = freeEnd(edge.source)
    const target = freeEnd(edge.target)
    // Preserve object identity for untouched edges. The canvas reconciler uses
    // that identity to avoid replaying a route edit on every other line.
    return source === edge.source && target === edge.target
      ? edge
      : { ...edge, source, target }
  })
  return changed ? { ...sheet, edges } : sheet
}

function touches(edge: PlantEdge, junctionId: string): boolean {
  return (isJunctionEnd(edge.source) && edge.source.junctionId === junctionId) ||
    (isJunctionEnd(edge.target) && edge.target.junctionId === junctionId)
}

function otherEnd(edge: PlantEdge, junctionId: string): EdgeEnd | null {
  if (isJunctionEnd(edge.source) && edge.source.junctionId === junctionId) return edge.target
  if (isJunctionEnd(edge.target) && edge.target.junctionId === junctionId) return edge.source
  return null
}

function orientedVertices(edge: PlantEdge, junctionId: string, towardJunction: boolean): { x: number; y: number }[] {
  const junctionAtSource = isJunctionEnd(edge.source) && edge.source.junctionId === junctionId
  const vertices = edge.vertices ?? []
  return junctionAtSource === towardJunction ? [...vertices].reverse() : [...vertices]
}

function mergedEdge(a: PlantEdge, b: PlantEdge, junctionId: string): PlantEdge {
  const source = otherEnd(a, junctionId)!
  const target = otherEnd(b, junctionId)!
  const junction = isJunctionEnd(a.source) && a.source.junctionId === junctionId ? a.source : a.target
  const at = isJunctionEnd(junction) ? { x: junction.x, y: junction.y } : null
  const vertices = [
    ...orientedVertices(a, junctionId, true),
    ...(at ? [at] : []),
    ...orientedVertices(b, junctionId, false),
  ]
  return {
    id: a.id,
    ...(a.lineGroupId || b.lineGroupId ? { lineGroupId: a.lineGroupId ?? b.lineGroupId } : {}),
    lineClass: a.lineClass,
    source,
    target,
    ...(vertices.length ? { vertices } : {}),
    ...(a.lineNumber || b.lineNumber ? { lineNumber: a.lineNumber ?? b.lineNumber } : {}),
    ...(a.arrow === 'flow' || b.arrow === 'flow' ? { arrow: 'flow' as const } : {}),
    ...(a.fluidId || b.fluidId ? { fluidId: a.fluidId ?? b.fluidId } : {}),
  }
}

/**
 * Line junction ids are topology metadata, not components. After a limb is
 * deleted, collapse a two-way junction back into one line and turn a lone
 * junction end into a normal free end.
 */
export function normalizeLineJunctions(sheet: Sheet): Sheet {
  let edges = sheet.edges
  let changed = true
  while (changed) {
    changed = false
    const ids = new Set(edges.flatMap((edge) =>
      [edge.source, edge.target].filter(isJunctionEnd).map((end) => end.junctionId),
    ))
    for (const junctionId of ids) {
      const incident = edges.filter((edge) => touches(edge, junctionId))
      if (incident.length > 2) continue
      // Two limbs from the same managed line are a temporary split (for
      // example after deleting its branch) and can be safely rejoined. Two
      // different line ids are independent objects and keep the junction.
      if (incident.length === 2 && incident[0]!.lineGroupId !== incident[1]!.lineGroupId) continue

      const drop = new Set(incident.map((edge) => edge.id))
      edges = edges.filter((edge) => !drop.has(edge.id))
      if (incident.length === 2) {
        edges.push(mergedEdge(incident[0]!, incident[1]!, junctionId))
      } else if (incident.length === 1) {
        const edge = incident[0]!
        const junction = isJunctionEnd(edge.source) && edge.source.junctionId === junctionId
          ? edge.source
          : edge.target
        if (!isJunctionEnd(junction)) continue
        const point = { x: junction.x, y: junction.y }
        edges.push({
          ...edge,
          ...(junction === edge.source ? { source: point } : { target: point }),
        })
      }
      changed = true
      break
    }
  }
  return edges === sheet.edges ? sheet : { ...sheet, edges }
}
