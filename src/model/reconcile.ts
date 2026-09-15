// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * ENGINEERING ↔ HMI RECONCILIATION.
 *
 * THE PROJECT DECISION THIS IMPLEMENTS: the HMI is a SNAPSHOT of the P&ID, not
 * a view derived from it. An operator screen is laid out by a person — things
 * are moved, grouped, resized and added because that is what makes a screen
 * readable — and regenerating it from the drawing throws that work away. So
 * the drawing and the screen are allowed to diverge, and this module makes the
 * divergence visible, explainable and repairable one item at a time.
 *
 * Nothing here applies anything on its own. `reconcileScreen` reads and
 * reports; `applyReconcile` acts only on the choices it is handed, and returns
 * a new document rather than touching a store. That separation is what makes
 * the whole thing previewable, testable and undoable in one step.
 *
 * ── THE THREE STATES ──────────────────────────────────────────────────────
 *
 *  CURRENT ENGINEERING STATE   the sheet named by `screen.fromSheetId`, plus
 *                              the registry records of the tags on it. Read
 *                              live from the document; never cached.
 *  CURRENT HMI SNAPSHOT STATE  the widgets on that screen, and the tags they
 *                              are bound to. Read live.
 *  LAST RECONCILED STATE       `screen.baseline` — tag -> a fingerprint of the
 *                              engineering facts as they stood at the last
 *                              import or apply.
 *
 * ADDED and REMOVED need only the first two, so they work on every screen,
 * including one built before Step I. CHANGED needs the third, and a screen
 * with no baseline reports no changes rather than inventing them — which is
 * what stops a project reporting a wall of false changes the first time it is
 * opened in this build.
 *
 * ── WHAT IS NOT IN THE FINGERPRINT ────────────────────────────────────────
 *
 * No PV, no history, no alarm state, no simulation clock, no widget geometry,
 * no selection, no document timestamp. Running the plant changes nothing here,
 * and neither does dragging a widget across the screen. The fingerprint is a
 * statement about the ENGINEERING↔HMI relationship only.
 */

import type { ProjectDoc } from './types'
import type { HmiScreen, HmiWidget } from '../hmi/model'
import { HMI_WORLD } from '../hmi/model'
import { listPlantTags } from '../hmi/tagIndex'
import { BIND_ORDER, findBinding, mapNodes, readsProcess } from '../hmi/importFromPid'
import { keyOfNode } from './registry'
import { TRACKED_LABEL, fingerprintTag, parseFingerprint } from './fingerprint'

export * from './fingerprint'

export type ReconcileStatus = 'added' | 'removed' | 'changed' | 'unchanged'

/**
 * What may be done about one item.
 *
 * `ignore` is always offered and is always the default: the safe outcome of
 * looking at a difference is to leave both sides alone. Nothing else is
 * offered unless it can be performed exactly — an action that might do the
 * wrong thing is not shown at all (Step I §19).
 *
 * `remap` is offered ONLY when there is a bounded set of destinations to
 * choose from — the tags this same sheet gained while this one was lost, which
 * is precisely the "it was renumbered" case. It is never offered with a
 * destination the software picked: choosing which tag a widget should read is
 * an engineering decision, and guessing at it is the silent fallback this step
 * exists to remove.
 */
export type ReconcileAction = 'ignore' | 'add' | 'remove' | 'remap' | 'update'

/** A chosen action, with its destination where the action needs one. */
export interface ReconcileChoice {
  action: ReconcileAction
  /** `remap` only: the tag to bind to. Must be one of the item's candidates. */
  target?: string
}

export interface EngineeringChange {
  field: string
  label: string
  from: string
  to: string
}

export interface ReconcileItem {
  tag: string
  status: ReconcileStatus
  /** What the engineering source says. Absent for a REMOVED item. */
  pid?: { nodeId: string; sheetId: string; description: string }
  /** What the screen holds. Absent for an ADDED item. */
  hmi?: { widgetId: string; type: string }
  /** CHANGED only: the fields that differ, sorted by field id. */
  changes?: EngineeringChange[]
  /** REMOVED only: tags this sheet gained that this widget could be pointed
   *  at instead. Empty when there is nothing to choose from, in which case
   *  `remap` is not offered. */
  remapTo?: string[]
  /** Actions that can be performed safely, `ignore` first. */
  actions: ReconcileAction[]
  message: string
}

export interface ReconcileReport {
  screenId: string
  screenName: string
  sheetId: string
  sheetName: string
  items: ReconcileItem[]
  counts: Record<ReconcileStatus, number>
  /** True when this screen has never recorded a baseline, so CHANGED could not
   *  be computed. Surfaced rather than hidden: a zero that means "not measured"
   *  must not read as "nothing changed". */
  baselineMissing: boolean
}

// ── The comparison ──────────────────────────────────────────────────────────

const numericCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/**
 * Compare one screen against the sheet it was built from.
 *
 * Returns null when the screen was not built from a sheet — a hand-built
 * screen or a generated overview has no engineering source to be reconciled
 * against, and pretending otherwise would report every one of its widgets as
 * an addition from nowhere.
 */
export function reconcileScreen(doc: ProjectDoc, screenId: string): ReconcileReport | null {
  const screen = doc.hmiScreens.find((sc) => sc.id === screenId)
  if (!screen?.fromSheetId) return null
  const sheet = doc.sheets.find((sh) => sh.id === screen.fromSheetId)
  if (!sheet) return null

  // The importer's own answer to "what on this sheet belongs on a screen".
  // Asking a second time, differently, is how a reconciliation starts
  // reporting objects the import would never have placed.
  const onSheet = listPlantTags(doc).filter((t) => t.sheetId === sheet.id)
  const bySheetTag = new Map(onSheet.map((t) => [t.display, t]))

  const onScreen = new Map<string, HmiWidget>()
  for (const w of screen.widgets) if (w.tag && !onScreen.has(w.tag)) onScreen.set(w.tag, w)

  const baseline = screen.baseline
  const items: ReconcileItem[] = []

  for (const t of onSheet) {
    if (onScreen.has(t.display)) continue
    items.push({
      tag: t.display,
      status: 'added',
      pid: { nodeId: t.nodeId, sheetId: sheet.id, description: t.description },
      actions: ['ignore', 'add'],
      message: `${t.display} — ${t.description} — is on ${sheet.name} and not on this screen.`,
    })
  }

  // What this sheet GAINED, which is the candidate set for a remap. Computed
  // once, from the additions already found above.
  const gained = items.filter((i) => i.status === 'added').map((i) => i.tag).sort(numericCompare)

  for (const [tag, widget] of onScreen) {
    if (bySheetTag.has(tag)) continue
    // Where did it go? A tag that moved to another sheet is a different
    // situation from one that has left the project, and an engineer deciding
    // between REMOVE and REMAP needs to know which.
    const elsewhere = listPlantTags(doc).find((t) => t.display === tag)
    items.push({
      tag,
      status: 'removed',
      hmi: { widgetId: widget.id, type: widget.type },
      ...(gained.length ? { remapTo: gained } : {}),
      actions: gained.length ? ['ignore', 'remap', 'remove'] : ['ignore', 'remove'],
      message: elsewhere
        ? `${tag} is no longer on ${sheet.name} — it is on ${elsewhere.sheetName}. This screen still shows it.`
        : `${tag} is on no sheet any more. This screen still shows it, and it reads nothing.`,
    })
  }

  for (const [tag, widget] of onScreen) {
    const t = bySheetTag.get(tag)
    if (!t) continue
    const was = baseline?.[tag]
    const now = fingerprintTag(doc, tag, sheet)
    if (was === undefined || was === now) {
      items.push({
        tag,
        status: 'unchanged',
        pid: { nodeId: t.nodeId, sheetId: sheet.id, description: t.description },
        hmi: { widgetId: widget.id, type: widget.type },
        actions: ['ignore'],
        message: `${tag} matches the engineering source.`,
      })
      continue
    }
    const before = parseFingerprint(was)
    const after = parseFingerprint(now)
    const changes: EngineeringChange[] = []
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const from = before[field] ?? ''
      const to = after[field] ?? ''
      if (from === to) continue
      changes.push({ field, label: TRACKED_LABEL[field] ?? field, from, to })
    }
    items.push({
      tag,
      status: 'changed',
      pid: { nodeId: t.nodeId, sheetId: sheet.id, description: t.description },
      hmi: { widgetId: widget.id, type: widget.type },
      changes,
      actions: ['ignore', 'update'],
      message: `${tag}: ${changes.map((c) => c.label.toLowerCase()).join(', ')} changed since this screen was last reconciled.`,
    })
  }

  const STATUS_RANK: Record<ReconcileStatus, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 }
  items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || numericCompare(a.tag, b.tag))

  const counts: Record<ReconcileStatus, number> = { added: 0, removed: 0, changed: 0, unchanged: 0 }
  for (const i of items) counts[i.status] += 1

  return {
    screenId: screen.id,
    screenName: screen.name,
    sheetId: sheet.id,
    sheetName: sheet.name,
    items,
    counts,
    baselineMissing: baseline === undefined,
  }
}

/** Every screen that has an engineering source, reconciled. */
export function reconcileAll(doc: ProjectDoc): ReconcileReport[] {
  return doc.hmiScreens
    .map((sc) => reconcileScreen(doc, sc.id))
    .filter((r): r is ReconcileReport => r !== null)
}

// ── Applying ────────────────────────────────────────────────────────────────

/** Deterministic placement grid for widgets reconciliation adds. */
const PLACE = { x0: 40, pitchX: 168, pitchY: 64, columns: 8, gap: 48 }

/**
 * Where a newly added widget goes.
 *
 * DOCUMENTED AND DETERMINISTIC (Step I §24): a clear band BELOW everything
 * already on the screen, filled left to right in tag order. It deliberately
 * does not look for gaps in the existing layout and deliberately does not move
 * anything that is already there — a reconciliation that rearranged an
 * engineer's screen to make room would be doing exactly what this whole design
 * exists to prevent. The engineer drags them where they belong; that is one
 * gesture, and it is theirs.
 */
export function placementBand(screen: HmiScreen): number {
  let bottom = 0
  for (const w of screen.widgets) bottom = Math.max(bottom, w.y + w.h)
  for (const p of screen.pipes) for (const q of p.points) bottom = Math.max(bottom, q.y)
  return bottom > 0 ? bottom + PLACE.gap : PLACE.gap
}

function placeAt(top: number, index: number, w: number, h: number): { x: number; y: number } {
  const col = index % PLACE.columns
  const row = Math.floor(index / PLACE.columns)
  return {
    x: Math.min(PLACE.x0 + col * PLACE.pitchX, Math.max(0, HMI_WORLD.w - w)),
    y: Math.min(top + row * PLACE.pitchY, Math.max(0, HMI_WORLD.h - h)),
  }
}

export interface ReconcilePlan {
  screenId: string
  /** Tags to place, in order. */
  add: string[]
  /** Widget ids to delete, with the tag each carried. */
  remove: { tag: string; widgetId: string }[]
  /** Widgets to point at a different tag, with the tag each carried before. */
  remap: { tag: string; widgetId: string; to: string }[]
  /** Tags whose baseline is being brought up to date. */
  update: string[]
  /** Everything the plan leaves alone, so a preview can say so. */
  ignored: string[]
}

/**
 * Turn choices into a plan.
 *
 * Choices name an ACTION per tag; anything unnamed, or named with an action
 * the item does not offer, is ignored. A plan is data: it prints as a preview
 * and applies exactly what it printed.
 */
export function planFor(
  report: ReconcileReport,
  choices: Record<string, ReconcileChoice>,
): ReconcilePlan {
  const plan: ReconcilePlan = { screenId: report.screenId, add: [], remove: [], remap: [], update: [], ignored: [] }
  for (const item of report.items) {
    const choice = choices[item.tag]
    const action = choice?.action
    if (!action || action === 'ignore' || !item.actions.includes(action)) {
      if (item.status !== 'unchanged') plan.ignored.push(item.tag)
      continue
    }
    if (action === 'add') plan.add.push(item.tag)
    else if (action === 'remove' && item.hmi) plan.remove.push({ tag: item.tag, widgetId: item.hmi.widgetId })
    else if (action === 'update') plan.update.push(item.tag)
    else if (action === 'remap' && item.hmi && choice.target && item.remapTo?.includes(choice.target)) {
      plan.remap.push({ tag: item.tag, widgetId: item.hmi.widgetId, to: choice.target })
    } else if (item.status !== 'unchanged') plan.ignored.push(item.tag)
  }
  // A tag that an existing widget is being pointed AT must not also be placed
  // as a new object: that would leave the screen showing it twice.
  const remapped = new Set(plan.remap.map((r) => r.to))
  plan.add = plan.add.filter((t) => !remapped.has(t))
  plan.add.sort(numericCompare)
  plan.update.sort(numericCompare)
  plan.remove.sort((a, b) => numericCompare(a.tag, b.tag))
  plan.remap.sort((a, b) => numericCompare(a.tag, b.tag))
  return plan
}

export const planIsEmpty = (p: ReconcilePlan): boolean =>
  p.add.length === 0 && p.remove.length === 0 && p.update.length === 0 && p.remap.length === 0

/** A preview line per change, in the order they will be applied. */
export function previewLines(plan: ReconcilePlan): string[] {
  return [
    ...plan.add.map((t) => `+ Add ${t}`),
    ...plan.remap.map((r) => `→ Point the ${r.tag} object at ${r.to}`),
    ...plan.update.map((t) => `~ Update ${t} to the current engineering data`),
    ...plan.remove.map((r) => `− Remove ${r.tag} from this screen`),
  ]
}

/**
 * Apply a plan, purely.
 *
 * ONE new document, so the caller records ONE undo step and `undo` returns
 * exactly the document that went in. Nothing in the simulation, the history or
 * the alarm list is reachable from here — they live outside `doc` entirely,
 * which is why reconciling a running plant cannot disturb it.
 *
 * HAND-LAID WORK SURVIVES. Existing widgets are never moved, resized,
 * relabelled or regenerated. The only widgets touched are the ones the plan
 * names, and the only ones removed are those the engineer explicitly chose.
 */
export function applyReconcile(doc: ProjectDoc, plan: ReconcilePlan): ProjectDoc {
  const screen = doc.hmiScreens.find((sc) => sc.id === plan.screenId)
  if (!screen?.fromSheetId || planIsEmpty(plan)) return doc
  const sheet = doc.sheets.find((sh) => sh.id === screen.fromSheetId)
  if (!sheet) return doc

  const removing = new Set(plan.remove.map((r) => r.widgetId))
  let widgets = screen.widgets.filter((w) => !removing.has(w.id))

  if (plan.remap.length > 0) {
    // ONLY the widget's primary tag moves. A remap is not a rename: the
    // engineering record stays where it is, nothing on any sheet changes, and
    // `model/references.ts` remains the one mechanism that carries a record
    // and every reference across a renaming (Step I §22).
    const to = new Map(plan.remap.map((r) => [r.widgetId, r.to]))
    widgets = widgets.map((w) => (to.has(w.id) ? { ...w, tag: to.get(w.id)! } : w))
  }

  if (plan.add.length > 0) {
    // The IMPORTER decides what widget a symbol becomes, and what it binds to.
    // Reconciliation asks it rather than deciding again: a tag added here must
    // arrive as the same kind of object a fresh import would have produced.
    const { widgets: mapped, ctx } = mapNodes(sheet, doc.settings.tagSeparator)
    const byTag = new Map(mapped.map((w) => [w.tag, w]))
    const pipeByEdge = new Map(
      screen.pipes.filter((p) => p.flowRef !== undefined).map((p) => [p.flowRef!, p.id]),
    )
    const top = placementBand(screen)
    const taken = new Set(widgets.map((w) => w.id))
    plan.add.forEach((tag, i) => {
      const proto = byTag.get(tag)
      if (!proto) return
      const node = sheet.nodes.find((n) => keyOfNode(n) === tag)
      let props = proto.props
      const letters = node?.tag?.letters ?? ''
      if (node && readsProcess(letters)) {
        for (const want of BIND_ORDER[letters[0] ?? ''] ?? []) {
          const found = findBinding(sheet, node.id, ctx, want)
          // `findBinding` answers with a P&ID EDGE id; the screen's pipes carry
          // the edge they came from, so this resolves to a pipe that exists on
          // THIS screen or the binding is not made at all. A binding that
          // pointed at a pipe the screen does not have would be exactly the
          // silent breakage the diagnostics exist to report.
          const pipeId = found.bindPipe !== undefined ? pipeByEdge.get(found.bindPipe) : undefined
          if (found.bindTank !== undefined) { props = { ...props, bindTank: found.bindTank }; break }
          if (pipeId !== undefined) { props = { ...props, bindPipe: pipeId }; break }
        }
      }
      const at = placeAt(top, i, proto.w, proto.h)
      // The importer's id is `imp-<nodeId>`, which is stable and is what a
      // re-import would use. Reuse it unless this screen already has one.
      const id = taken.has(proto.id) ? `${proto.id}-r${i}` : proto.id
      taken.add(id)
      widgets = [...widgets, { ...proto, id, x: at.x, y: at.y, ...(props ? { props } : {}) }]
    })
  }

  // The baseline moves forward for every tag the screen now represents whose
  // item was acted on, and ONLY those: ignoring a change must leave it
  // reportable next time, or "ignore" would quietly become "accept".
  //
  // THE ONE EXCEPTION is a screen that has never had a baseline — one built
  // before Step I. There, nothing was reportable in the first place, so
  // recording the current state for every tag it shows accepts nothing and
  // loses nothing; it simply starts tracking. Without this, applying one
  // addition to such a screen would leave every OTHER tag on it permanently
  // untrackable, which is a trap rather than a safeguard.
  const nextBaseline = { ...(screen.baseline ?? {}) }
  if (screen.baseline === undefined) {
    // Same question `reconcileScreen` asks, asked of the same function, so the
    // set recorded here is exactly the set that will be compared later.
    const onSheet = new Set(listPlantTags(doc).filter((t) => t.sheetId === sheet.id).map((t) => t.display))
    for (const w of widgets) {
      if (w.tag && onSheet.has(w.tag)) nextBaseline[w.tag] = fingerprintTag(doc, w.tag, sheet)
    }
  }
  for (const tag of [...plan.add, ...plan.update]) nextBaseline[tag] = fingerprintTag(doc, tag, sheet)
  for (const r of plan.remap) {
    delete nextBaseline[r.tag]
    nextBaseline[r.to] = fingerprintTag(doc, r.to, sheet)
  }
  for (const r of plan.remove) delete nextBaseline[r.tag]
  const baseline = Object.fromEntries(Object.keys(nextBaseline).sort().map((k) => [k, nextBaseline[k]!]))

  return {
    ...doc,
    hmiScreens: doc.hmiScreens.map((sc) =>
      sc.id === screen.id ? { ...sc, widgets, baseline } : sc,
    ),
  }
}
