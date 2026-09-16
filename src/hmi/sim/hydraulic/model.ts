// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE CANONICAL PROCESS TOPOLOGY.
 *
 * A pressure-node / flow-edge graph, compiled once from the operator screens
 * and then held still. It is the thing the hydraulic solver operates on, and
 * it is deliberately NOT the drawing:
 *
 *   P&ID engineering geometry   — `model/types.ts`, sheets, nodes, edges
 *   HMI presentation geometry   — `hmi/model.ts`, widgets and pipe polylines
 *   PROCESS SIMULATION TOPOLOGY — this file
 *
 * They reference the same engineering objects by TAG. They are not the same
 * data structure, and none of them is derived from another's pixel positions
 * at run time.
 *
 * ── WHAT REPLACED WHAT ────────────────────────────────────────────────────
 *
 * The previous model (`sim/network.ts`) walked pipes into `Branch`es —
 * independent source-to-destination paths, each carrying a list of pumps and
 * valves. Flow came out of a conductance heuristic: the product of the valve
 * fractions on a path, times a pump's rating, split between competing legs in
 * proportion to that product. Pressure was then painted on afterwards.
 *
 * Three things that cannot express:
 *
 *  1. **Junction mass balance.** Branches were independent paths, so a split
 *     and a merge were never solved together and nothing made what arrived at
 *     a tee equal what left it.
 *  2. **Pressure driving flow.** The causal arrow ran flow → pressure. Closing
 *     a valve changed the flow directly, and the pressure profile was redrawn
 *     to match. Nothing in the model said that flow happens BECAUSE of a
 *     pressure difference.
 *  3. **Direction.** Flows were non-negative by construction, so a stream
 *     could not reverse however the pressures stood.
 *
 * This graph is built so the solver can fix all three: material moves between
 * nodes because they are at different pressures, and what enters a node leaves
 * it.
 *
 * Pure, DOM-free, and compiled once per document — never per tick.
 */

import type { HmiPipe, HmiScreen, HmiWidget } from '../../model'
import { HEATER_SYMBOLS } from '../tags'
import type { EquipmentKind, PortResolution, PortRole, ProcessPort } from './ports'
import { INLET_ROLE, OUTLET_ROLE, declaredRole, portId, portsOf, roleFromGeometry } from './ports'

/** A pipe endpoint attaches to a widget within this many pixels when the pipe
 *  names no widget. Inherited from the previous builder so imported screens
 *  keep the connections they had; every such attachment is recorded as
 *  `geometric` and reported by diagnostics. */
const ATTACH = 14

/** Runaway guards for pathological drawings. */
const MAX_NODES = 512
const MAX_EDGES = 1024

// ── Nodes ───────────────────────────────────────────────────────────────────

export type NodeKind =
  /** An interior point whose pressure the solver determines. */
  | 'junction'
  /** A vessel's liquid space. Pressure is fixed for the instant by its level. */
  | 'vessel'
  /** A process boundary: a supply header, a battery limit, atmosphere. */
  | 'boundary'

export interface ProcessNode {
  id: string
  kind: NodeKind
  /** Vessel nodes only: the tag whose inventory sets this node's pressure. */
  tag?: string
  /** Vessel nodes only: whether this nozzle sees the liquid head. */
  liquid?: boolean
  /** Boundary nodes only: the pressure held at this boundary, bar. */
  pressureBar?: number
  /** Ports that share this node. A junction between two pipes has none. */
  ports: ProcessPort[]
}

// ── Edges ───────────────────────────────────────────────────────────────────

export type EdgeKind =
  /** A pipe run. Pure resistance. */
  | 'pipe'
  /** A throttling or on/off element. Resistance set by position. */
  | 'valve'
  /** Driven equipment that raises pressure. */
  | 'pump'
  /** Driven equipment that adds heat and nothing else. Pure resistance. */
  | 'heater'
  /** An imported graphic with no process behaviour — a fitting, a gauge
   *  glass. It passes fluid at a small loss. */
  | 'fitting'

export interface ProcessEdge {
  id: string
  kind: EdgeKind
  /** Node the edge leaves. Nominal only: flow sign decides the true direction. */
  from: string
  /** Node the edge enters. */
  to: string
  /** The equipment tag for a valve, pump or heater edge. */
  tag?: string
  /**
   * Resistance coefficient in bar / (m³/h)², so `ΔP = R · Q|Q|`.
   *
   * Quadratic because pipe loss is quadratic in the turbulent regime this
   * model assumes. For a pipe this is fixed at compile time; for a valve the
   * solver recomputes it each tick from the position, because that is exactly
   * the coupling the old model lacked.
   */
  resistance: number
  /** Pipe edges: the drawn polylines this edge represents, so the HMI can
   *  paint the solved flow onto what the operator can see. */
  pipeIds: string[]
}

// ── The model ───────────────────────────────────────────────────────────────

export interface ProcessModel {
  nodes: ProcessNode[]
  edges: ProcessEdge[]
  /** Node id -> its index, for the solver's matrix assembly. */
  indexOf: Map<string, number>
  /** Equipment the model knows about, by tag. */
  equipment: Map<string, { kind: EquipmentKind; widgetId: string; ports: ProcessPort[] }>
  /** Vessel tag -> the nodes its nozzles sit on. */
  vesselNodes: Map<string, string[]>
  /** The inverse: node id -> the vessel whose nozzle it is. Used by the solver
   *  to gate an edge that would fill a full vessel or drain an empty one. */
  vesselOfNode: Map<string, string>
  /** Pipe id -> the edge that carries it, so a widget bound to a line can ask
   *  the solver what that line is doing. */
  edgeOfPipe: Map<string, string>
  /** Compile-time problems, for `model/diagnostics.ts`. Never thrown. */
  issues: TopologyIssue[]
}

export interface TopologyIssue {
  kind:
    | 'unattached-stream-end'
    | 'geometric-attachment'
    | 'equipment-without-ports'
    | 'stream-to-missing-port'
    | 'no-driving-boundary'
  /** Screen the problem is on. */
  screenId: string
  /** The pipe or widget it is about. */
  objectId: string
  tag?: string
  message: string
}

// ── Building ────────────────────────────────────────────────────────────────

const isSolid = (w: HmiWidget): boolean =>
  w.type === 'tank' || w.type === 'pump' || w.type === 'valve' || w.type === 'symbol' || w.type === 'equip'

/** What KIND of process object a widget is. The one place this is decided. */
export function kindOf(w: HmiWidget): EquipmentKind | null {
  if (w.type === 'tank') return 'vessel'
  if (w.type === 'valve') return 'valve'
  if (w.type === 'pump') return 'pump'
  if (w.type === 'equip') {
    const symbolId = typeof w.props?.symbolId === 'string' ? w.props.symbolId : ''
    return HEATER_SYMBOLS.has(symbolId) ? 'heater' : 'pump'
  }
  if (w.type === 'symbol') return 'passthrough'
  return null
}

/** Nearest solid widget within ATTACH. A point inside a rect is distance 0, so
 *  containment always beats an inflated near-miss. */
function widgetAt(widgets: HmiWidget[], p: { x: number; y: number }): HmiWidget | null {
  let best: HmiWidget | null = null
  let bestD = Infinity
  for (let i = widgets.length - 1; i >= 0; i--) {
    const w = widgets[i]!
    if (!isSolid(w)) continue
    const dx = Math.max(w.x - p.x, 0, p.x - (w.x + w.w))
    const dy = Math.max(w.y - p.y, 0, p.y - (w.y + w.h))
    if (dx > ATTACH || dy > ATTACH) continue
    const d = Math.hypot(dx, dy)
    if (d < bestD) { best = w; bestD = d }
  }
  return best
}

/**
 * Line loss coefficient, bar per (m³/h)², for one pipe run.
 *
 * Sized together with `VALVE_K` and the pump curve's runout factor so that a
 * default machine (50 m³/h rated, 4 bar at that duty) running through a
 * typical three-run path with one fully open control valve settles at its
 * RATED duty.
 *
 * The figure is defined RELATIVE TO THE BOUNDARY CONDITIONS: change
 * `supplyPressureBar` and this has to be re-derived, or the same machine
 * delivers a different duty through the same path.
 *
 * It is a calibration, not a calculation from diameter and length: an HMI pipe
 * carries neither. `model/processData.ts` is where a stated
 * diameter would enter if the engineering record ever holds one, and until it
 * does this is the documented stand-in.
 */
export const PIPE_K = 4e-4

/** A fitting passes fluid at a tenth of a pipe run's loss — present so it is
 *  not invisible, small enough that it does not dominate. */
export const FITTING_K = PIPE_K / 10

/**
 * A valve's resistance at a given opening, bar / (m³/h)².
 *
 * `R = K / f⁴`, so `ΔP = K·Q²/f⁴` and at a fixed pressure drop the flow goes
 * as `f²`. That is an equal-percentage-ish characteristic rather than the
 * linear `Q ∝ position` the previous model used — and, more importantly, it
 * is a RESISTANCE that enters the pressure balance rather than a multiplier
 * applied to a flow that was decided elsewhere.
 *
 * A shut valve returns `Infinity`, which the solver reads as "no path".
 */
export const VALVE_K = 4e-4

/**
 * The opening a shut element is treated as having.
 *
 * NOT zero, and this is the point. An infinite resistance carries exactly no
 * flow and has exactly no derivative, so the nodes either side of a shut valve
 * become numerically undetermined — their pressures can slide together
 * anywhere and still balance. A dead-end behind a closed valve then made the
 * whole solve singular even though the drawing is perfectly connected.
 *
 * `1e-3` of an opening gives a resistance twelve orders of magnitude above
 * open, so the flow it passes is around 5e-5 m³/h at a full bar — a twentieth
 * of a millilitre an hour, two parts per million of a typical duty. The valve
 * is shut as far as any observer is concerned, and the Jacobian still has a
 * slope to work with. This is the standard treatment for a closed element in a
 * pipe-network solve.
 *
 * The exponent is a CONDITIONING choice as much as a physical one. An earlier
 * value of `1e-4` put sixteen orders between a shut valve and an open one,
 * which is a Jacobian condition number around 1e8, and the line search stalled
 * short of tolerance on any network with a dead end behind a closed valve.
 */
export const SHUT_FRACTION = 1e-3

export function valveResistance(openFraction: number): number {
  const f = Math.max(SHUT_FRACTION, Math.min(1, openFraction))
  return VALVE_K / f ** 4
}

interface Attach {
  node: string
  port?: ProcessPort
}

/**
 * Compile one or more screens into a process topology.
 *
 * Every widget that participates in the process contributes its ports as
 * nodes; every pipe contributes an edge between the two nodes its ends attach
 * to; every two-port device contributes an edge between its own two ports, so
 * a pump is a pressure rise BETWEEN nodes rather than a flag on a path.
 */
export function buildProcessModel(screens: HmiScreen | HmiScreen[]): ProcessModel {
  const list = Array.isArray(screens) ? screens : [screens]
  const nodes: ProcessNode[] = []
  const edges: ProcessEdge[] = []
  const equipment: ProcessModel['equipment'] = new Map()
  const vesselNodes = new Map<string, string[]>()
  const vesselOfNode = new Map<string, string>()
  const edgeOfPipe = new Map<string, string>()
  const issues: TopologyIssue[] = []
  const nodeById = new Map<string, ProcessNode>()

  const addNode = (n: ProcessNode): ProcessNode => {
    const existing = nodeById.get(n.id)
    if (existing) return existing
    if (nodes.length >= MAX_NODES) return n
    nodes.push(n)
    nodeById.set(n.id, n)
    return n
  }

  for (const [si, screen] of list.entries()) {
    const ns = (id: string) => `S${si}:${id}`
    const byId = new Map(screen.widgets.map((w) => [w.id, w]))

    // ── equipment and their ports ───────────────────────────────────────────
    for (const w of screen.widgets) {
      if (!isSolid(w)) continue
      const kind = kindOf(w)
      if (!kind) continue
      const ports: ProcessPort[] = portsOf(kind).map((role) => ({
        id: ns(portId(w.id, role)),
        widgetId: w.id,
        ...(w.tag ? { tag: w.tag } : {}),
        role,
        resolution: 'geometric' as PortResolution,
      }))
      if (ports.length === 0) {
        issues.push({
          kind: 'equipment-without-ports', screenId: screen.id, objectId: w.id,
          ...(w.tag ? { tag: w.tag } : {}),
          message: `${w.tag ?? w.type} offers no process port, so nothing can be connected to it`,
        })
        continue
      }
      if (w.tag) equipment.set(w.tag, { kind, widgetId: w.id, ports })

      for (const p of ports) {
        const liquid = kind === 'vessel' && p.role === 'bottom'
        addNode({
          id: p.id,
          kind: kind === 'vessel' ? 'vessel' : 'junction',
          ...(kind === 'vessel' && w.tag ? { tag: w.tag } : {}),
          ...(kind === 'vessel' ? { liquid } : {}),
          ports: [p],
        })
      }
      if (kind === 'vessel' && w.tag) {
        vesselNodes.set(w.tag, ports.map((p) => p.id))
        for (const p of ports) vesselOfNode.set(p.id, w.tag)
      }

      // The device itself is an EDGE between its own two ports. A vessel is
      // not: its nozzles are separated by the liquid, not by a resistance.
      if (kind !== 'vessel' && edges.length < MAX_EDGES) {
        const inRole = INLET_ROLE[kind]
        const outRole = OUTLET_ROLE[kind]
        edges.push({
          id: ns(`dev:${w.id}`),
          kind: kind === 'pump' ? 'pump' : kind === 'heater' ? 'heater' : kind === 'valve' ? 'valve' : 'fitting',
          from: ns(portId(w.id, inRole)),
          to: ns(portId(w.id, outRole)),
          ...(w.tag ? { tag: w.tag } : {}),
          // A pump's own resistance is nil — its curve already falls with
          // flow. A valve's is set every tick from its position.
          resistance: kind === 'pump' ? 0 : kind === 'heater' ? FITTING_K : kind === 'valve' ? VALVE_K : FITTING_K,
          pipeIds: [],
        })
      }
    }

    // ── streams ────────────────────────────────────────────────────────────
    for (const pipe of screen.pipes) {
      if (pipe.points.length < 2) continue
      const a = attachEnd(pipe, 'a', screen, byId, ns, issues)
      const b = attachEnd(pipe, 'b', screen, byId, ns, issues)
      if (edges.length >= MAX_EDGES) break
      for (const end of [a, b]) if (end.port) markResolution(nodeById, end)

      const id = ns(`pipe:${pipe.id}`)
      edges.push({
        id, kind: 'pipe',
        from: a.node, to: b.node,
        resistance: PIPE_K,
        pipeIds: [pipe.id],
      })
      edgeOfPipe.set(pipe.id, id)
      // A free end is a BOUNDARY, not a dead end: a battery-limit supply or a
      // discharge to a receiving system. Declaring it explicitly is what lets
      // the solver answer "why is there no flow" instead of inventing one.
      for (const end of [a, b]) {
        if (!end.port) {
          addNode({ id: end.node, kind: 'boundary', pressureBar: undefined, ports: [] })
        }
      }
    }
  }

  const indexOf = new Map(nodes.map((n, i) => [n.id, i]))
  return { nodes, edges, indexOf, equipment, vesselNodes, vesselOfNode, edgeOfPipe, issues }

  /** Resolve one pipe end to a node, recording how certain the answer is. */
  function attachEnd(
    pipe: HmiPipe,
    which: 'a' | 'b',
    screen: HmiScreen,
    byId: Map<string, HmiWidget>,
    ns: (id: string) => string,
    out: TopologyIssue[],
  ): Attach {
    const point = which === 'a' ? pipe.points[0]! : pipe.points[pipe.points.length - 1]!
    const anchor = which === 'a' ? pipe.aId : pipe.bId
    const declaredPort = which === 'a' ? pipe.aPort : pipe.bPort

    let widget = anchor !== undefined ? byId.get(anchor) : undefined
    let resolution: PortResolution = widget ? 'anchored' : 'geometric'
    if (!widget || !isSolid(widget)) {
      widget = widgetAt(screen.widgets, point) ?? undefined
      resolution = 'geometric'
    }
    if (!widget) {
      // Genuinely unattached: this end is a process boundary.
      return { node: ns(`free:${pipe.id}:${which}`) }
    }
    const kind = kindOf(widget)
    if (!kind) return { node: ns(`free:${pipe.id}:${which}`) }

    const stated = declaredRole(declaredPort)
    const role: PortRole = stated ?? roleFromGeometry(kind, widget, point)
    if (stated) resolution = 'declared'
    else if (declaredPort !== undefined && resolution === 'anchored') {
      // The drawing named a port this model has no role for. Not fatal — the
      // positional rule still answers — but worth saying, because it means the
      // symbol carries a nozzle the process model does not understand.
      out.push({
        kind: 'stream-to-missing-port', screenId: screen.id, objectId: pipe.id,
        ...(widget.tag ? { tag: widget.tag } : {}),
        message: `A line attaches to port "${declaredPort}" on ${widget.tag ?? widget.type}, which this process model has no role for; its position was used instead`,
      })
    }
    if (resolution === 'geometric') {
      out.push({
        kind: 'geometric-attachment', screenId: screen.id, objectId: pipe.id,
        ...(widget.tag ? { tag: widget.tag } : {}),
        message: `A line was attached to ${widget.tag ?? widget.type} by proximity rather than by a stated connection`,
      })
    }
    return {
      node: ns(portId(widget.id, role)),
      port: { id: ns(portId(widget.id, role)), widgetId: widget.id, ...(widget.tag ? { tag: widget.tag } : {}), role, resolution },
    }
  }
}

/** Carry the strongest resolution seen onto the node's port record. */
function markResolution(nodeById: Map<string, ProcessNode>, end: Attach): void {
  const node = nodeById.get(end.node)
  const port = node?.ports[0]
  if (!node || !port || !end.port) return
  const rank: Record<PortResolution, number> = { geometric: 0, anchored: 1, declared: 2 }
  if (rank[end.port.resolution] > rank[port.resolution]) port.resolution = end.port.resolution
}
