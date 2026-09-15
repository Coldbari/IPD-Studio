// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * A READ-ONLY PROJECTION of the flow network, for situational awareness.
 *
 * The solver's `Branch` is shaped for solving: sets of pumps and valves, pipe
 * ids, indices. This rearranges the same facts into what a person reads — a
 * path from where the fluid comes from, through what it passes, to where it
 * goes — so the overview can draw a simplified flowsheet without any component
 * re-deriving process topology for itself.
 *
 * It DERIVES. It holds no state, changes nothing, and is computed once when a
 * run is compiled, because topology only changes when the drawing does.
 */

import type { Branch, EndRef, FlowNetwork } from './network'

export type FlowNodeKind = 'source' | 'sink' | 'tank' | 'pump' | 'heater' | 'valve'

export interface FlowNode {
  kind: FlowNodeKind
  /** Absent only for a terminal — a battery limit has no tag. */
  tag?: string
}

export interface FlowPath {
  /** The branch this path projects, so live flow can be looked up. */
  branchId: string
  nodes: FlowNode[]
}

const terminal = (e: EndRef): FlowNode =>
  e.kind === 'tank' ? { kind: 'tank', tag: e.tag } : { kind: e.kind }

/** One path per branch: origin, the devices the fluid passes through in order,
 *  then the destination. */
export function projectPath(b: Branch): FlowPath {
  const middle: FlowNode[] = [...b.devices]
    .sort((x, y) => x.at - y.at)
    .map((d) => ({ kind: d.kind, tag: d.tag }))
  return { branchId: b.id, nodes: [terminal(b.from), ...middle, terminal(b.to)] }
}

/**
 * The plant as a set of readable paths.
 *
 * Paths that carry no equipment at all are dropped: a bare source-to-sink stub
 * tells an operator nothing and would only crowd the overview. Longer paths
 * come first, because the main process route is the one worth reading.
 */
export function projectTopology(net: FlowNetwork, limit = 6): FlowPath[] {
  return net.branches
    .map(projectPath)
    .filter((p) => p.nodes.some((n) => n.kind !== 'source' && n.kind !== 'sink'))
    .sort((a, b) => b.nodes.length - a.nodes.length)
    .slice(0, limit)
}

/** Net flow into a vessel and out of it, m³/h, from the branch flows the
 *  engine already solved. Nothing is recomputed — this only sums. */
export function tankFlows(
  net: FlowNetwork,
  tag: string,
  branchFlows: Record<string, number>,
): { inlet: number; outlet: number } {
  let inlet = 0
  let outlet = 0
  for (const b of net.branches) {
    const f = branchFlows[b.id] ?? 0
    if (b.to.kind === 'tank' && b.to.tag === tag) inlet += f
    if (b.from.kind === 'tank' && b.from.tag === tag) outlet += f
  }
  return { inlet, outlet }
}
