// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE PROCESS VIEW — presentation metadata over the canonical topology.
 *
 * The mimic screen draws the P&ID's own geometry with live values painted on.
 * That is the right picture for an engineer and the wrong one for an operator:
 * a P&ID is routed for drafting — long runs to keep the sheet tidy, crossings,
 * instruments floated out to where a bubble fits — and none of that says
 * anything about the order the fluid passes through things.
 *
 * This derives a second PRESENTATION of the same engineering model:
 *
 *     P&ID  ->  ProcessModel (canonical)  ->  ProcessViewModel  ->  renderer
 *                     ^                              ^
 *              the one topology              layout + bindings only
 *
 * IT IS NOT A SECOND TOPOLOGY. Every node and every edge here points back at
 * an id in the `ProcessModel` it was derived from, nothing is invented, and no
 * connectivity decision is taken here that the canonical model has not already
 * taken. Delete this file and the plant still runs.
 *
 * THE GRAPH IS INVERTED, deliberately. In the hydraulic model a pump or a
 * valve is an EDGE — a conductor between two pressure nodes — because that is
 * what it is to the solver. To an operator it is a THING you look at and click,
 * and the pipe is the line between things. So each device edge collapses into
 * a view NODE that absorbs its two port nodes, and each pipe edge becomes a
 * view EDGE. The result reads
 *
 *     SOURCE -> PUMP -> FT -> VALVE -> JUNCTION -> TANK A / TANK B
 *
 * which is the sequence the fluid actually takes.
 *
 * STATIC. Built once when a run is compiled, because topology and layout change
 * only when the drawing does. Nothing here reads a flow, a pressure or a tag
 * value; every runtime number is looked up by the renderer through the ids
 * below. See `simStore`, which holds this beside the live maps and rebuilds it
 * on `enterRun` and never on a tick.
 */

import type { ProcessModel } from './hydraulic/model'
import type { Measures, TagDef } from './tags'
import type { ControllerSpec } from './engine'

/** What a box on the process view IS. */
export type ViewNodeKind =
  /** A free pipe end: a battery limit. Whether it supplies or receives is a
   *  RUNTIME question — the sign of the flow answers it — so it is not decided
   *  here. */
  | 'boundary'
  /** A vessel. Both its nozzles collapse into the one object. */
  | 'vessel'
  /** A driven machine. */
  | 'pump'
  /** A valve, hand or throttling. */
  | 'valve'
  /** Driven equipment that adds heat rather than head. */
  | 'heater'
  /** A fitting with no behaviour that still passes fluid — a tee symbol. */
  | 'fitting'
  /** A pipe-to-pipe junction the drawing made without a symbol. */
  | 'junction'

/** An instrument, at the place it is installed. */
export interface ViewInstrument {
  tag: string
  /** What its ISA letter says it measures. Absent for a tag whose letters name
   *  nothing this simulation models. */
  measures?: Measures
  unit?: string
  /** A controller is drawn with its final element, not as a measurement. */
  isController: boolean
}

export interface ViewNode {
  /** Stable for the life of a run. Prefixed by what it came from. */
  id: string
  kind: ViewNodeKind
  /** The canonical engineering tag. Absent only for a boundary or a bare
   *  junction, neither of which is a tagged object. */
  tag?: string
  /** The `ProcessModel` nodes this box absorbed, so the renderer can ask the
   *  solve for their pressures. */
  nodeIds: string[]
  /** The `ProcessModel` edge this box IS, for a device. The renderer reads its
   *  signed flow to show what the device is passing. */
  edgeId?: string
  /** Instruments reading this object — a vessel's LT/TT, a device's own tags. */
  instruments: ViewInstrument[]
  /** Controllers whose final element this is. */
  controllers: string[]
  /** Layout, in view units. */
  x: number
  y: number
  w: number
  h: number
}

export interface ViewEdge {
  /** The `ProcessModel` edge id. Signed flow is read from this. */
  id: string
  /** View node the edge leaves, NOMINALLY. The sign of the solved flow decides
   *  the real direction, and the renderer reverses the arrows when it is
   *  negative rather than this deciding anything. */
  from: string
  to: string
  /** The drawn pipes this edge carries, so the view can be traced back to the
   *  P&ID lines an operator may also be looking at. */
  pipeIds: string[]
  /** INLINE INSTRUMENTS: the transmitters installed in this run. They keep
   *  their place in the sequence — an FT between a pump and a valve is drawn
   *  between the pump and the valve, not floated off to one side. */
  instruments: ViewInstrument[]
  /** Polyline through the laid-out nodes, in view units. */
  points: { x: number; y: number }[]
}

export interface ProcessViewModel {
  nodes: ViewNode[]
  edges: ViewEdge[]
  /** Extent of the laid-out diagram, for the renderer's viewBox. */
  width: number
  height: number
  /** Node id -> index, so the renderer can resolve an edge end in O(1). */
  indexOf: Map<string, number>
}

// ── Layout constants ────────────────────────────────────────────────────────

/** Column pitch: enough for a box plus a run of pipe with room for an inline
 *  instrument to sit on it without touching either end. */
const COL = 180
/** Row pitch. */
const ROW = 120
const BOX_W = 96
const BOX_H = 56
/** A vessel is drawn taller, because it carries a level. */
const VESSEL_H = 88
const MARGIN = 40

const sizeOf = (kind: ViewNodeKind): { w: number; h: number } =>
  kind === 'vessel' ? { w: BOX_W, h: VESSEL_H }
  : kind === 'junction' || kind === 'fitting' ? { w: 28, h: 28 }
  : { w: BOX_W, h: BOX_H }

// ── Derivation ──────────────────────────────────────────────────────────────

/** `ProcessEdge.kind` -> the box it becomes. Keyed on the EDGE kind the
 *  canonical model states, not on the equipment kind: `fitting` is what a tee
 *  compiles to, and reading it as anything else leaves the junction drawn as
 *  two separate nodes with an unexplained gap between them. */
const DEVICE_KIND: Record<string, ViewNodeKind> = {
  pump: 'pump', valve: 'valve', heater: 'heater', fitting: 'fitting',
}

/**
 * Build the presentation model.
 *
 * `defs` and `controllers` are the compiled engineering definitions the run
 * already holds — instruments are placed from their OWN bindings (`bindPipe`,
 * `bindTank`), which is the same binding the engine reads when it decides what
 * a transmitter measures. There is no second answer to "where is FT-101".
 */
export function buildProcessView(
  model: ProcessModel,
  defs: TagDef[],
  controllers: ControllerSpec[] = [],
): ProcessViewModel {
  const nodes: ViewNode[] = []
  const byId = new Map<string, ViewNode>()
  /** ProcessModel node id -> the view node that absorbed it. */
  const owner = new Map<string, string>()

  const add = (n: Omit<ViewNode, 'x' | 'y' | 'w' | 'h'>): ViewNode => {
    const v: ViewNode = { ...n, ...sizeOf(n.kind), x: 0, y: 0 }
    nodes.push(v)
    byId.set(v.id, v)
    for (const id of v.nodeIds) owner.set(id, v.id)
    return v
  }

  // 1. DEVICES absorb their own two port nodes. A pump is one box, not two
  //    pressure nodes with a machine between them.
  for (const e of model.edges) {
    const kind = DEVICE_KIND[e.kind]
    if (kind === undefined) continue // a pipe: an edge here too
    add({
      id: `dev:${e.id}`, kind, ...(e.tag ? { tag: e.tag } : {}),
      nodeIds: [e.from, e.to], edgeId: e.id, instruments: [], controllers: [],
    })
  }

  // 2. VESSELS absorb every nozzle they own. A tank with a bottom draw and a
  //    top fill is ONE tank on a process view.
  for (const [tag, nodeIds] of model.vesselNodes) {
    add({ id: `vessel:${tag}`, kind: 'vessel', tag, nodeIds: [...nodeIds], instruments: [], controllers: [] })
  }

  // 3. Everything the canonical model still has a node for and nothing has
  //    claimed: boundaries, and junctions the drawing made between bare pipes.
  for (const n of model.nodes) {
    if (owner.has(n.id)) continue
    add({
      id: n.kind === 'boundary' ? `bnd:${n.id}` : `jct:${n.id}`,
      kind: n.kind === 'boundary' ? 'boundary' : 'junction',
      nodeIds: [n.id], instruments: [], controllers: [],
    })
  }

  // 4. PIPES become edges between whatever owns their ends.
  const edges: ViewEdge[] = []
  for (const e of model.edges) {
    if (DEVICE_KIND[e.kind] !== undefined) continue
    const from = owner.get(e.from)
    const to = owner.get(e.to)
    if (from === undefined || to === undefined) continue
    edges.push({ id: e.id, from, to, pipeIds: [...e.pipeIds], instruments: [], points: [] })
  }

  // 5. INSTRUMENTS, at the place the drawing installed them.
  //
  //    A transmitter bound to a PIPE is INLINE: it belongs to the run it is
  //    installed in and keeps its position in the sequence. One bound to a
  //    VESSEL reads that vessel. A controller is placed with the final element
  //    it drives, because that is the object an operator acts on.
  const edgeOfPipe = new Map<string, ViewEdge>()
  for (const ve of edges) for (const p of ve.pipeIds) edgeOfPipe.set(p, ve)
  const outOf = new Map<string, string>()
  for (const c of controllers) if (c.outTag) outOf.set(c.tag, c.outTag)

  for (const d of defs) {
    if (d.kind === 'controller') {
      const target = outOf.get(d.name)
      const box = target ? nodes.find((n) => n.tag === target) : undefined
      if (box) box.controllers.push(d.name)
      continue
    }
    if (d.kind !== 'display') continue
    const inst: ViewInstrument = {
      tag: d.name, ...(d.measures ? { measures: d.measures } : {}),
      ...(d.unit ? { unit: d.unit } : {}), isController: false,
    }
    if (d.bindPipe !== undefined) {
      // INLINE. Never dropped for being "only a measurement": where a reading
      // is taken is process information, and an operator who cannot see it is
      // reading a number with no place.
      edgeOfPipe.get(d.bindPipe)?.instruments.push(inst)
      continue
    }
    if (d.bindTank !== undefined) byId.get(`vessel:${d.bindTank}`)?.instruments.push(inst)
    // An unbound display has no process location. It is NOT placed here, and
    // `sim/quality.ts` already reports it as having no model behind it.
  }

  layout(nodes, edges, byId)
  const width = Math.max(...nodes.map((n) => n.x + n.w), 0) + MARGIN
  const height = Math.max(...nodes.map((n) => n.y + n.h), 0) + MARGIN
  return { nodes, edges, width, height, indexOf: new Map(nodes.map((n, i) => [n.id, i])) }
}

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * Rank nodes left to right by how far down the process they are, then spread
 * them into lanes within each rank.
 *
 * The rank is the longest nominal path from a node with nothing feeding it,
 * which is what makes a junction sit AFTER everything that feeds it rather
 * than beside one of them. Longest rather than shortest for the same reason: a
 * tee fed by a short branch and a long one belongs downstream of both.
 *
 * Nominal, because at compile time there is no flow to ask. A line that runs
 * backwards at runtime is drawn with reversed arrows in place rather than
 * relaid out — an operator watching a recycle start up should see the arrows
 * turn, not the diagram rearrange itself.
 */
function layout(nodes: ViewNode[], edges: ViewEdge[], byId: Map<string, ViewNode>): void {
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of nodes) { out.set(n.id, []); indeg.set(n.id, 0) }
  for (const e of edges) {
    if (e.from === e.to) continue
    out.get(e.from)!.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }

  // Longest-path rank by Kahn's algorithm. Anything left over is in a cycle —
  // a recirculation loop — and takes the rank after its lowest-ranked feeder,
  // so the loop reads round rather than collapsing onto one column.
  const rank = new Map<string, number>()
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  for (const id of queue) rank.set(id, 0)
  const left = new Map(indeg)
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const next of out.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1))
      const n = (left.get(next) ?? 0) - 1
      left.set(next, n)
      if (n === 0) queue.push(next)
    }
  }
  for (const n of nodes) {
    if (rank.has(n.id)) continue
    const feeders = edges.filter((e) => e.to === n.id && rank.has(e.from))
    rank.set(n.id, feeders.length > 0 ? Math.min(...feeders.map((e) => rank.get(e.from)! + 1)) : 0)
  }

  // Lanes: group by rank, then order each column by the average lane of what
  // feeds it, so branches stay near the object they came off instead of the
  // diagram crossing itself for no reason.
  const byRank = new Map<number, ViewNode[]>()
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r)!.push(n)
  }
  const lane = new Map<string, number>()
  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    const col = byRank.get(r)!
    const key = (n: ViewNode) => {
      const feeders = edges.filter((e) => e.to === n.id && lane.has(e.from))
      if (feeders.length === 0) return Number.MAX_SAFE_INTEGER
      return feeders.reduce((s, e) => s + lane.get(e.from)!, 0) / feeders.length
    }
    col.sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id))
    col.forEach((n, i) => lane.set(n.id, i))
  }

  // Centre each column vertically against the tallest, so a single-item column
  // sits level with the middle of a branched one.
  const tallest = Math.max(...[...byRank.values()].map((c) => c.length), 1)
  for (const [r, col] of byRank) {
    const offset = ((tallest - col.length) * ROW) / 2
    col.forEach((n, i) => {
      n.x = MARGIN + r * COL
      n.y = MARGIN + offset + i * ROW + (ROW - n.h) / 2
    })
  }

  // Route every edge centre-to-centre with one orthogonal dog-leg, which is
  // what a flow diagram looks like and what keeps a branch readable.
  for (const e of edges) {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) continue
    e.points = route(a, b)
  }
}

/** An orthogonal run from one box to the next: out of the right face, across,
 *  and into the left face. Same-rank and backward edges bow out below so they
 *  do not lie on top of the boxes between them. */
function route(a: ViewNode, b: ViewNode): { x: number; y: number }[] {
  const ay = a.y + a.h / 2
  const by = b.y + b.h / 2
  const forward = b.x > a.x
  if (forward) {
    const x0 = a.x + a.w
    const x1 = b.x
    if (Math.abs(ay - by) < 1) return [{ x: x0, y: ay }, { x: x1, y: by }]
    const mid = (x0 + x1) / 2
    return [{ x: x0, y: ay }, { x: mid, y: ay }, { x: mid, y: by }, { x: x1, y: by }]
  }
  // backwards or level: drop below both boxes and run there
  const below = Math.max(a.y + a.h, b.y + b.h) + ROW / 3
  return [
    { x: a.x + a.w / 2, y: a.y + a.h },
    { x: a.x + a.w / 2, y: below },
    { x: b.x + b.w / 2, y: below },
    { x: b.x + b.w / 2, y: b.y + b.h },
  ]
}

/** Midpoint of a routed polyline, where an inline instrument is drawn. */
export function midpointOf(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!
  let total = 0
  for (let i = 1; i < points.length; i++) total += seg(points[i - 1]!, points[i]!)
  let want = total / 2
  for (let i = 1; i < points.length; i++) {
    const d = seg(points[i - 1]!, points[i]!)
    if (want <= d) {
      const t = d === 0 ? 0 : want / d
      return {
        x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t,
        y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * t,
      }
    }
    want -= d
  }
  return points[points.length - 1]!
}

const seg = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
