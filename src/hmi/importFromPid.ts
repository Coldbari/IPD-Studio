// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { ulid } from 'ulid'
import type { PlantEdge, PlantNode, ProjectDoc, Sheet } from '../model/types'
import { isPortEnd } from '../model/types'
import { portWorld, scalesOf } from '../canvas/alignment'
import { segInRect } from './editGeometry'
import type { HmiPipe, HmiScreen, HmiWidget, WidgetType } from './model'
import { HMI_WORLD, WIDGET_DEFAULT_SIZE } from './model'
import { formatTag } from '../isa/tag'
import { getSymbol } from '../symbols/registry'
import { portDirection, rotateDir } from '../canvas/shapes'
import { orthogonalizeVia, routePipe } from './routePipes'
import { baselineFor } from '../model/fingerprint'
import type { Dir, Rect } from './routePipes'
// side-effect: fill the symbol registry (same import the catalog tests use)
import '../symbols/lib/index'

export interface ImportCtx { nameOf: Map<string, string> }

const AUTO_PREFIX: Partial<Record<WidgetType, string>> = {
  tank: 'TK', pump: 'P', valve: 'V', display: 'XI', symbol: 'X', equip: 'M',
}

/** Motor-driven equipment the HMI runs as an `equip` widget (Start/Stop,
 *  ramp, trip). pump.* keeps the dedicated pump widget; the ejector has no
 *  motor but drives flow, so it stays a pump; hx.* stays a passive graphic. */
const EQUIP_MOTOR = new Set([
  'comp.centrifugal', 'comp.recip', 'comp.screw', 'blower', 'fan', 'agitator', 'motor', 'turbine.steam',
  'conveyor.belt', 'conveyor.screw', 'bucket-elevator', 'feeder.rotary', 'crusher',
  'mill.ball', 'extruder', 'blender.ribbon', 'screen.vibrating', 'dryer.rotary',
  'heater.fired', 'heater.electric', 'boiler', 'cooling-tower',
])

function categoryOf(node: PlantNode): string {
  try { return getSymbol(node.symbolId).category } catch { return 'custom' }
}

/** Vessel symbols whose silhouette the HMI tank widget preserves — a cone
 *  roof or an agitator is how operators recognize which vessel is which. */
const TANK_SHAPE: Record<string, string> = {
  'vessel.horizontal': 'horizontal',
  'vessel.tank': 'cone',
  'vessel.silo': 'cone',
  'vessel.cstr': 'agitated',
}

function widgetTypeFor(node: PlantNode, category: string): { type: WidgetType; props: HmiWidget['props'] } | null {
  if (node.kind === 'annotation') return null
  const letters = node.tag?.letters ?? ''
  if (node.kind === 'equipment' && category === 'vessels') {
    const shape = TANK_SHAPE[node.symbolId]
    return { type: 'tank', props: shape ? { shape } : undefined }
  }
  // instruments are decided by their tag, never by category — a VFD box is
  // category 'rotating' but it is not a pump you can start
  if (node.kind !== 'instrument') {
    if (EQUIP_MOTOR.has(node.symbolId)) return { type: 'equip', props: { symbolId: node.symbolId } }
    if (category === 'rotating') return { type: 'pump', props: undefined }
    if (category === 'control-valves') return { type: 'valve', props: { throttle: true } }
    if (category === 'safety') return { type: 'symbol', props: { symbolId: node.symbolId } }
    if (node.kind === 'valve') return { type: 'valve', props: undefined }
  }
  if (node.kind === 'instrument') {
    // Hardware without a measurable ISA tag — VFDs, sight glasses, I/P
    // converters (…Y), anything untagged — stays a graphic: a value display
    // for it would invent numbers that mean nothing.
    if (!/^[A-Z]{1,4}$/.test(letters) || letters.endsWith('Y')) {
      return { type: 'symbol', props: { symbolId: node.symbolId } }
    }
    // No unit is written here. `sim/tags.ts` derives it from the SAME ISA
    // letter this function is already reading, so a copy in widget props would
    // be a second place for the answer to live and a second place to get it
    // wrong. The importer decides what KIND of widget this is; the engineering
    // metadata decides what it reads in.
    if (letters.endsWith('T')) return { type: 'display', props: undefined } // transmitters (incl. CT) are plain measurements
    if (letters.includes('C') && !letters.endsWith('V')) return { type: 'display', props: { controller: true } }
    return { type: 'display', props: undefined }
  }
  return { type: 'symbol', props: { symbolId: node.symbolId } }
}

/** Map a sheet's nodes to HMI widgets (positions raw; importSheet rescales). */
export function mapNodes(sheet: Sheet, separator: '-' | ''): { widgets: HmiWidget[]; ctx: ImportCtx } {
  const widgets: HmiWidget[] = []
  const nameOf = new Map<string, string>()
  const counters = new Map<string, number>()
  const used = new Set<string>()

  for (const node of sheet.nodes) {
    const category = categoryOf(node)
    const mapped = widgetTypeFor(node, category)
    if (!mapped) continue
    let name = node.tag ? formatTag(node.tag, separator) : (node.label?.trim() || '')
    if (!name || used.has(name)) {
      const prefix = AUTO_PREFIX[mapped.type] ?? 'X'
      let n = (counters.get(prefix) ?? 0) + 1
      while (used.has(`${prefix}-${n}`)) n++
      counters.set(prefix, n)
      name = `${prefix}-${n}`
    }
    used.add(name)
    nameOf.set(node.id, name)

    let w: number, h: number
    if (mapped.type === 'display') {
      ;({ w, h } = WIDGET_DEFAULT_SIZE.display)
    } else {
      ;({ w, h } = nodeSize(node))
      if (w <= 0 || h <= 0) ({ w, h } = WIDGET_DEFAULT_SIZE[mapped.type])
      if (mapped.type === 'tank') { w = Math.max(w, 64); h = Math.max(h, 80) }
      if (mapped.type === 'pump' || mapped.type === 'equip') { w = Math.max(w, 40); h = Math.max(h, 40) }
      if (mapped.type === 'symbol') { w = Math.max(w, 12); h = Math.max(h, 12) }
    }
    // a graphic with no real identity (junction dots, untagged hardware)
    // carries no tag text — auto names like "X-3" are bookkeeping, not labels
    const hasIdentity = node.tag !== undefined || !!node.label?.trim()
    // orientation matters for glyph-true widgets: a rotated gate valve must
    // stay a vertical bowtie, a rotated gauge glass must stay upside down
    const rot = (((node.rotation ?? 0) % 360) + 360) % 360
    const keepRot = (mapped.type === 'valve' || mapped.type === 'symbol' || mapped.type === 'equip') && (rot === 90 || rot === 180 || rot === 270)
    widgets.push({
      id: `imp-${node.id}`,
      type: mapped.type, x: node.x, y: node.y, w, h,
      ...(keepRot ? { rotation: rot as 90 | 180 | 270 } : {}),
      tag: mapped.type === 'symbol' && !hasIdentity ? undefined : name,
      label: node.label, props: mapped.props,
    })
  }
  return { widgets, ctx: { nameOf } }
}

const isProcess = (lc: PlantEdge['lineClass']) => lc.startsWith('process') || lc.startsWith('pipe.')

/** Edges that become HMI pipes: process/pipe runs, but NOT impulse tubing —
 *  an imported impulse stub would read as a free-ended flow source. */
const isPipeWorthy = (lc: PlantEdge['lineClass']) => isProcess(lc) && lc !== 'process.impulse'

/** Footprint honoring per-axis stretch AND rotation (a 90°-rotated pump is
 *  tall, not wide). */
function nodeSize(node: PlantNode): { w: number; h: number } {
  const { sx, sy } = scalesOf(node)
  try {
    const g = getSymbol(node.symbolId).gridSize
    const w = g.w * 8 * sx
    const h = g.h * 8 * sy
    const rot = (((node.rotation ?? 0) % 360) + 360) % 360
    return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h }
  } catch {
    return { w: 32, h: 32 }
  }
}

function endPoint(end: PlantEdge['source'], nodes: Map<string, PlantNode>): { x: number; y: number } {
  if (!isPortEnd(end)) return { x: end.x, y: end.y }
  const node = nodes.get(end.nodeId)
  if (!node) return { x: 0, y: 0 }
  const p = portWorld(node, end.portId)
  if (p) return p
  const { w, h } = nodeSize(node)
  return { x: node.x + w / 2, y: node.y + h / 2 }
}

/** How well an edge's drawn direction matches process flow: >0 keep
 *  as-drawn, <0 reverse, 0 unknown. Pumps are the strongest witnesses (flow
 *  enters suction, leaves discharge), then drains, then vessel nozzles
 *  (bottom = outlet, top = inlet, side = weakly an outlet). Uses unrotated
 *  port geometry — vessels are almost never rotated, and the scores are
 *  weak enough for chain propagation to win where it matters. */
function flowEvidence(edge: PlantEdge, nodesById: Map<string, PlantNode>): number {
  const endScore = (end: PlantEdge['source'], isSource: boolean): number => {
    if (!isPortEnd(end)) return 0
    const node = nodesById.get(end.nodeId)
    if (!node) return 0
    let def
    try { def = getSymbol(node.symbolId) } catch { return 0 }
    if (def.category === 'rotating') {
      if (end.portId === 'discharge' || end.portId === 'out') return isSource ? 4 : -4
      if (end.portId === 'suction' || end.portId === 'in') return isSource ? -4 : 4
      return 0
    }
    if (node.symbolId.startsWith('fit.drain')) return isSource ? -3 : 3
    if (def.category === 'vessels') {
      const port = def.ports.find((q) => q.id === end.portId)
      if (!port) return 0
      const h = def.gridSize.h * 8
      if (port.y >= h * 0.7) return isSource ? 2 : -2
      if (port.y <= h * 0.3) return isSource ? -2 : 2
      return isSource ? 1 : 0
    }
    return 0
  }
  return endScore(edge.source, true) + endScore(edge.target, false)
}

/** The sim's network walker reads pipes upstream -> downstream, but a P&ID
 *  edge points whichever way the user happened to drag it. Orient every
 *  imported pipe by process evidence, then propagate through inline devices
 *  (a valve with flow in on one side flows out the other; a junction with an
 *  inflow fans out) so whole chains agree. Unknowns keep the drawn arrow. */
function orientPipes(
  sheet: Sheet,
  widgets: HmiWidget[],
  pipes: HmiPipe[],
  nodesById: Map<string, PlantNode>,
): void {
  const edgeById = new Map(sheet.edges.map((e) => [e.id, e]))
  const inlineIds = new Set(
    widgets.filter((w) => w.type === 'valve' || w.type === 'pump' || w.type === 'symbol').map((w) => w.id),
  )
  interface PInfo { pipe: HmiPipe; aId?: string; bId?: string; dir: 1 | -1 | 0 }
  const infos: PInfo[] = []
  const atWidget = new Map<string, PInfo[]>()
  for (const p of pipes) {
    const edge = p.flowRef !== undefined ? edgeById.get(p.flowRef) : undefined
    if (!edge) continue
    const aId = isPortEnd(edge.source) ? `imp-${edge.source.nodeId}` : undefined
    const bId = isPortEnd(edge.target) ? `imp-${edge.target.nodeId}` : undefined
    const ev = flowEvidence(edge, nodesById)
    const info: PInfo = { pipe: p, aId, bId, dir: ev > 0 ? 1 : ev < 0 ? -1 : 0 }
    infos.push(info)
    for (const id of [aId, bId]) {
      if (id !== undefined && inlineIds.has(id)) atWidget.set(id, [...(atWidget.get(id) ?? []), info])
    }
  }
  const queue = infos.filter((i) => i.dir !== 0)
  while (queue.length > 0) {
    const cur = queue.pop()!
    for (const [end, id] of [['a', cur.aId], ['b', cur.bId]] as const) {
      if (id === undefined || !inlineIds.has(id)) continue
      // does cur flow INTO this widget? as-drawn it flows a -> b
      const into = cur.dir === 1 ? end === 'b' : end === 'a'
      for (const q of atWidget.get(id) ?? []) {
        if (q === cur || q.dir !== 0) continue
        const qEntersHere = q.bId === id
        // flow through the device: an inflow orients siblings outward, an
        // outflow orients siblings inward
        q.dir = into ? (q.aId === id ? 1 : -1) : (qEntersHere ? 1 : -1)
        queue.push(q)
      }
    }
  }
  for (const i of infos) {
    if (i.dir !== -1) continue
    i.pipe.points.reverse()
    const { aId, bId } = i.pipe
    if (bId !== undefined) i.pipe.aId = bId; else delete i.pipe.aId
    if (aId !== undefined) i.pipe.bId = aId; else delete i.pipe.bId
  }
}

/** The engine pairs a controller to its valve by tag family+loop (LIC-100
 *  drives LV-100). A P&ID usually leaves the CV body untagged and states the
 *  association through the signal lines instead — so trace them: controller
 *  bubble -> (I/P converters, solenoids) -> throttling valve, and tag that
 *  valve into the loop. A valve the user tagged themselves is never renamed. */
function wireLoopValves(sheet: Sheet, widgets: HmiWidget[], ctx: ImportCtx, sep: '-' | ''): void {
  const nodesById = new Map(sheet.nodes.map((n) => [n.id, n]))
  const widgetByNode = new Map(widgets.map((w) => [w.id, w]))
  const used = new Set(widgets.map((w) => w.tag).filter((t): t is string => t !== undefined))
  const sigEdges = sheet.edges.filter((e) => e.lineClass.startsWith('signal'))
  for (const node of sheet.nodes) {
    const letters = node.tag?.letters ?? ''
    const loop = node.tag?.loop
    if (node.kind !== 'instrument' || !loop) continue
    if (!letters.includes('C') || letters.endsWith('V')) continue // controllers only
    let frontier = [node.id]
    const seen = new Set(frontier)
    let valveNode: PlantNode | undefined
    for (let hop = 0; hop < 3 && !valveNode; hop++) {
      const next: string[] = []
      for (const edge of sigEdges) {
        const ids = [edge.source, edge.target].filter(isPortEnd).map((e) => e.nodeId)
        if (!ids.some((id) => frontier.includes(id))) continue
        for (const id of ids) {
          if (seen.has(id)) continue
          seen.add(id)
          const n = nodesById.get(id)
          const w = widgetByNode.get(`imp-${id}`)
          if (n && n.tag === undefined && w?.type === 'valve' && w.props?.throttle === true) { valveNode = n; break }
          next.push(id)
        }
        if (valveNode) break
      }
      frontier = next
    }
    if (!valveNode) continue
    const newTag = `${letters[0]}V${sep}${loop}`
    if (used.has(newTag)) continue
    const w = widgetByNode.get(`imp-${valveNode.id}`)!
    used.add(newTag)
    w.tag = newTag
    ctx.nameOf.set(valveNode.id, newTag)
  }
}

/** ≤2-hop neighborhood walk from an instrument node over ALL edges, looking
 *  for what this instrument's ISA family actually measures: 'tank' walks to
 *  the nearest vessel (level), 'pipe' to the nearest process run (flow). */
export function findBinding(sheet: Sheet, nodeId: string, ctx: ImportCtx, want: 'tank' | 'pipe'): { bindTank?: string; bindPipe?: string } {
  const nodesById = new Map(sheet.nodes.map((n) => [n.id, n]))
  let frontier = [nodeId]
  const seen = new Set(frontier)
  for (let hop = 0; hop < 2; hop++) {
    const next: string[] = []
    for (const edge of sheet.edges) {
      const ids = [edge.source, edge.target].filter(isPortEnd).map((e) => e.nodeId)
      if (!ids.some((id) => frontier.includes(id))) continue
      // only edges that became HMI pipes can be flow-bound — an impulse line
      // would fail the retarget and leave the instrument silently unbound
      if (want === 'pipe' && isPipeWorthy(edge.lineClass)) return { bindPipe: edge.id }
      for (const id of ids) {
        if (seen.has(id)) continue
        seen.add(id)
        const n = nodesById.get(id)
        if (want === 'tank' && n && n.kind === 'equipment' && categoryOf(n) === 'vessels') {
          const tank = ctx.nameOf.get(id)
          if (tank) return { bindTank: tank }
        }
        next.push(id)
      }
    }
    frontier = next
  }
  return {}
}

/**
 * Where each ISA family looks for its process, in order of preference.
 *
 * Module scope rather than a local, because RECONCILIATION binds an instrument
 * it adds to an existing screen through the same table and the same
 * `findBinding` walk. A second copy would be a second opinion about what a
 * level transmitter measures.
 */
export const BIND_ORDER: Record<string, ('tank' | 'pipe')[]> = {
  L: ['tank', 'pipe'],
  T: ['tank', 'pipe'],
  F: ['pipe'],
  P: ['pipe', 'tank'],
}

/** Instruments whose ISA letters end in T/I/E read the process directly; a
 *  controller gets its PV from loop pairing instead. */
export const readsProcess = (letters: string): boolean => /[TIE]$/.test(letters)

/** Full import: widgets + pipes + measurement bindings, scaled into HMI_WORLD. */
export function importSheet(doc: ProjectDoc, sheetId: string): HmiScreen {
  const sheet = doc.sheets.find((s) => s.id === sheetId)
  if (!sheet) throw new Error(`No sheet ${sheetId}`)
  const { widgets, ctx } = mapNodes(sheet, doc.settings.tagSeparator)
  const nodesById = new Map(sheet.nodes.map((n) => [n.id, n]))
  wireLoopValves(sheet, widgets, ctx, doc.settings.tagSeparator)

  // Measurement bindings: transmitters, indicators and primary elements all
  // read the process (a controller gets its PV from loop pairing instead).
  //
  // The ISA first letter decides WHAT is measured and therefore where to look
  // for it. Every family listed here now has a process model behind it: level
  // and temperature belong to a vessel, flow and pressure to a line — with the
  // other place as a fallback, because a level bridle is piped and a tank can
  // be tapped for pressure. A family with no model binds to nothing and keeps
  // an idle value, which sim/quality.ts reports as UNCERTAIN rather than
  // dressing up as a reading.
  for (const node of sheet.nodes) {
    const letters = node.tag?.letters ?? ''
    if (node.kind !== 'instrument' || !readsProcess(letters)) continue
    const order = BIND_ORDER[letters[0] ?? '']
    if (!order) continue
    const name = ctx.nameOf.get(node.id)
    const widget = widgets.find((w) => w.tag === name)
    if (!widget) continue
    for (const want of order) {
      const binding = findBinding(sheet, node.id, ctx, want)
      if (binding.bindTank ?? binding.bindPipe) {
        widget.props = { ...widget.props, ...binding }
        break
      }
    }
  }

  // solid graphics stay where the P&ID put them — routed pipes must go
  // around their footprints exactly like the canvas manhattan router does
  const solidRect = new Map<string, Rect>()
  for (const w of widgets) {
    if (w.type === 'tank' || w.type === 'pump' || w.type === 'valve' || w.type === 'symbol' || w.type === 'equip') {
      solidRect.set(w.id, { x: w.x, y: w.y, w: w.w, h: w.h })
    }
  }
  const endDir = (end: PlantEdge['source']): Dir | null => {
    if (!isPortEnd(end)) return null
    const node = nodesById.get(end.nodeId)
    if (!node) return null
    const dir = portDirection(node.symbolId, end.portId)
    return dir ? rotateDir(dir, node.rotation) : null
  }
  const fluidColorById = new Map((doc.fluids ?? []).map((f) => [f.id, f.color]))
  const pipes: HmiPipe[] = sheet.edges.filter((e) => isPipeWorthy(e.lineClass)).map((e) => {
    const aPt = endPoint(e.source, nodesById)
    const bPt = endPoint(e.target, nodesById)
    const ownIds = [e.source, e.target].filter(isPortEnd).map((end) => `imp-${end.nodeId}`)
    const own = ownIds.map((id) => solidRect.get(id)).filter((r): r is Rect => r !== undefined)
    const others = [...solidRect.entries()].filter(([id]) => !ownIds.includes(id)).map(([, r]) => r)
    const verts = e.vertices ?? []
    const points = verts.length > 0
      ? orthogonalizeVia([aPt, ...verts, bPt], others) // user-drawn bends are kept
      : routePipe({ ...aPt, dir: endDir(e.source) }, { ...bPt, dir: endDir(e.target) }, others, own)
    const anchor = (end: PlantEdge['source']): string | undefined => {
      if (!isPortEnd(end)) return undefined
      const id = `imp-${end.nodeId}`
      return solidRect.has(id) ? id : undefined
    }
    const aId = anchor(e.source), bId = anchor(e.target)
    const color = e.fluidId !== undefined ? fluidColorById.get(e.fluidId) : undefined
    return {
      id: ulid(), flowRef: e.id, width: 5, points,
      ...(color !== undefined ? { color } : {}),
      ...(aId !== undefined ? { aId } : {}), ...(bId !== undefined ? { bId } : {}),
    }
  })
  orientPipes(sheet, widgets, pipes, nodesById)

  // bindPipe references P&ID edge ids -> retarget to the imported pipe id
  const pipeByEdge = new Map(pipes.map((p) => [p.flowRef!, p.id]))
  for (const w of widgets) {
    if (typeof w.props?.bindPipe === 'string') {
      const pid = pipeByEdge.get(w.props.bindPipe)
      if (pid) w.props = { ...w.props, bindPipe: pid }
      else {
        const props = { ...w.props }
        delete props.bindPipe
        w.props = props
      }
    }
  }

  // uniform scale-to-fit with a 40px margin (never upscales)
  const xs = [...widgets.flatMap((w) => [w.x, w.x + w.w]), ...pipes.flatMap((p) => p.points.map((q) => q.x))]
  const ys = [...widgets.flatMap((w) => [w.y, w.y + w.h]), ...pipes.flatMap((p) => p.points.map((q) => q.y))]
  if (xs.length > 0) {
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const k = Math.min(1, (HMI_WORLD.w - 80) / Math.max(1, maxX - minX), (HMI_WORLD.h - 80) / Math.max(1, maxY - minY))
    const tx = (v: number) => 40 + (v - minX) * k
    const ty = (v: number) => 40 + (v - minY) * k
    for (const w of widgets) { w.x = tx(w.x); w.y = ty(w.y); w.w *= k; w.h *= k }
    for (const p of pipes) p.points = p.points.map((q) => ({ x: tx(q.x), y: ty(q.y) }))
  }

  deoverlap(widgets, pipes)

  // THE RECONCILIATION BASELINE, recorded at birth. A screen that knows what
  // the engineering data said when it was built can afterwards report what
  // CHANGED; one that does not can only ever report what was added or removed.
  // See model/reconcile.ts.
  const baseline = baselineFor(doc, sheet, widgets.map((w) => w.tag).filter((t): t is string => t !== undefined))

  return { id: ulid(), name: `${sheet.name} HMI`, theme: 'classic', widgets, pipes, fromSheetId: sheetId, baseline }
}

const MOVABLE = new Set<string>(['display', 'gauge', 'trend', 'lamp', 'button', 'switch'])
const MARGIN = 8

function intersects(a: HmiWidget, b: HmiWidget): boolean {
  return a.x < b.x + b.w + MARGIN && a.x + a.w + MARGIN > b.x && a.y < b.y + b.h + MARGIN && a.y + a.h + MARGIN > b.y
}

/** Imported instrument boxes land at bubble positions and pile onto
 *  equipment, each other, AND pipe runs; nudge each movable widget to the
 *  nearest spot clear of all three. */
export function deoverlap(widgets: HmiWidget[], pipes: HmiPipe[] = []): void {
  const PAD = 6
  const onPipe = (cand: HmiWidget) => {
    const r = { x: cand.x - PAD, y: cand.y - PAD, w: cand.w + 2 * PAD, h: cand.h + 2 * PAD }
    for (const p of pipes) {
      for (let k = 0; k + 1 < p.points.length; k++) {
        if (segInRect(p.points[k]!, p.points[k + 1]!, r)) return true
      }
    }
    return false
  }
  const placed: HmiWidget[] = widgets.filter((w) => !MOVABLE.has(w.type))
  for (const w of widgets) {
    if (!MOVABLE.has(w.type)) continue
    const collides = (cand: HmiWidget) => placed.some((o) => intersects(cand, o)) || onPipe(cand)
    if (collides(w)) {
      outer: for (let r = 1; r <= 15; r++) {
        const step = r * 16
        for (const [dx, dy] of [[step, 0], [-step, 0], [0, -step], [0, step], [step, -step], [step, step], [-step, -step], [-step, step]] as const) {
          const cand = { ...w, x: w.x + dx, y: w.y + dy }
          if (cand.x < 0 || cand.y < 0 || cand.x + cand.w > HMI_WORLD.w || cand.y + cand.h > HMI_WORLD.h) continue
          if (!collides(cand)) { w.x = cand.x; w.y = cand.y; break outer }
        }
      }
    }
    placed.push(w)
  }
}
