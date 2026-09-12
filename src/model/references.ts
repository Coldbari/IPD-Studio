// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Every place an engineering key is written down, and how a rename moves them.
 *
 * A tag is not stored once. It is stored on the symbol, as the key of its
 * engineering record, inside HMI widget bindings, inside trend pen refs, inside
 * accepted QA findings, and — as prose an engineer typed — inside record text
 * fields. Before this module, a rename moved the record and nothing else, so
 * renaming LT-101 left every HMI widget bound to LT-101 reading a tag that no
 * longer existed, with no warning anywhere. That is the single most expensive
 * class of P&ID error: the silent mismatch.
 *
 * The rule this module exists to enforce: a rename updates every
 * MACHINE-WRITTEN reference, or it updates none of them.
 *
 * What it deliberately does NOT do is rewrite text a person wrote. A record
 * whose note reads "from LT-101 header" is prose, not a reference, and an
 * automatic search-and-replace through human sentences is how a tool loses
 * trust. Those are returned as `deferred` for a review step to offer later.
 */

import type { ProjectDoc } from './types'
import type { HmiWidget } from '../hmi/model'
import { TAG_PROP_KINDS, WIDGET_SCHEMA, parseSignalRef } from '../hmi/model'
import { liveKeys, retagRegistry } from './registry'

export type RefClass = 'auto' | 'review' | 'manual' | 'broken'

export type RefWhere =
  | 'registry'
  | 'hmi-widget'
  | 'hmi-pen'
  | 'hmi-signal'
  /** A widget prop holding a bare tag — `bindTank`. Distinct from `hmi-signal`
   *  because the value has no `.SIGNAL` suffix and is rewritten whole. */
  | 'hmi-bind'
  | 'qa-ignored'
  | 'record-field'

export interface TagRef {
  class: RefClass
  where: RefWhere
  /** For display only. Never address anything by this string. */
  label: string
  /** Machine-addressable location. The applier uses only these. */
  path: {
    screenId?: string
    widgetId?: string
    recordKey?: string
    field?: string
    penIndex?: number
    findingKey?: string
  }
}

/**
 * Record fields an engineer fills in by hand that may name another object.
 *
 * These are `review` class everywhere, including when the value is exactly the
 * old key: whether "LT-101" in a free-text Line field is a reference or a note
 * is a judgement only the engineer can make.
 */
export const REVIEW_FIELDS = ['general.line', 'general.pid', 'general.area'] as const

/** `finding()` builds `${ruleId}:${entityKey}`; rule ids carry no colon, so the
 *  first one splits it. An entityKey may contain colons (`__unassigned:…`). */
function splitFindingKey(k: string): { ruleId: string; entityKey: string } | null {
  const i = k.indexOf(':')
  if (i <= 0 || i === k.length - 1) return null
  return { ruleId: k.slice(0, i), entityKey: k.slice(i + 1) }
}

/**
 * Does free text mention this key as a whole word?
 *
 * The boundary excludes hyphens as well as alphanumerics, because tags contain
 * hyphens: searching for LT-101 must not match LT-1011 (longer number) or
 * LT-101-A (a different, suffixed tag).
 */
function mentions(text: string, key: string): boolean {
  if (!text) return false
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9-])${esc}([^A-Za-z0-9-]|$)`).test(text)
}

const screenLabel = (name: string, w: HmiWidget) =>
  `${w.label || w.tag || w.type} (${name})`

/** One tag reference stored inside an HMI screen. */
export interface HmiTagRef {
  /** The engineering tag this binding names. */
  tag: string
  where: Extract<RefWhere, 'hmi-widget' | 'hmi-pen' | 'hmi-signal' | 'hmi-bind'>
  label: string
  path: { screenId: string; widgetId: string; field?: string; penIndex?: number }
}

/**
 * Every tag reference stored in every HMI screen, in document order.
 *
 * ONE traversal, shared by the rename collector and the orphaned-binding rule.
 * A binding must either both follow a rename AND be validated, or neither: two
 * walks that drift apart is how a reference starts renaming but stops being
 * checked, which is the bug this whole area exists to prevent.
 *
 * Driven by WIDGET_SCHEMA + TAG_PROP_KINDS, so a tag-bearing prop added to a
 * widget type later is discovered here without editing this function.
 */
export function collectHmiBindings(doc: ProjectDoc): HmiTagRef[] {
  const out: HmiTagRef[] = []
  for (const screen of doc.hmiScreens ?? []) {
    for (const w of screen.widgets) {
      if (w.tag) {
        out.push({
          tag: w.tag,
          where: 'hmi-widget',
          label: screenLabel(screen.name, w),
          path: { screenId: screen.id, widgetId: w.id },
        })
      }

      w.pens?.forEach((pen, i) => {
        const parsed = parseSignalRef(pen.ref)
        if (!parsed) return
        out.push({
          tag: parsed.tag,
          where: 'hmi-pen',
          label: `${pen.ref} on ${screenLabel(screen.name, w)}`,
          path: { screenId: screen.id, widgetId: w.id, penIndex: i },
        })
      })

      const schema = WIDGET_SCHEMA[w.type] ?? {}
      for (const [field, value] of Object.entries(w.props ?? {})) {
        if (typeof value !== 'string') continue
        const kind = schema[field]
        const mode = kind ? TAG_PROP_KINDS[kind] : undefined
        if (!mode) continue
        const tag = mode === 'bare' ? value : parseSignalRef(value)?.tag
        if (!tag) continue
        out.push({
          tag,
          where: mode === 'bare' ? 'hmi-bind' : 'hmi-signal',
          label: `${field} = ${value} on ${screenLabel(screen.name, w)}`,
          path: { screenId: screen.id, widgetId: w.id, field },
        })
      }
    }
  }
  return out
}

/**
 * Every reference to `key` in the document.
 *
 * Pure: reads the document and reports. Callers decide what to do with each
 * class. Collection is driven by `WIDGET_SCHEMA` + `TAG_PROP_KINDS` rather than
 * a hardcoded list of prop names, so a tag-bearing prop added to a widget type
 * later is picked up here without a change to this file.
 */
export function collectTagRefs(doc: ProjectDoc, key: string): TagRef[] {
  const out: TagRef[] = []
  if (!key) return out

  // 1. The engineering record filed under this key.
  const record = doc.registry?.[key]
  if (record) {
    // A record is more than its `fields` bag: a Unit assignment is engineering
    // content that moves with the rename like everything else, and counting
    // only fields made a record that holds one read as "0 fields" — a preview
    // telling the user there is nothing to carry when there is.
    const fieldCount = Object.keys(record.fields).length
    const parts = [`${fieldCount} field${fieldCount === 1 ? '' : 's'}`]
    if (record.unitId) parts.push('unit assignment')
    out.push({
      class: 'auto',
      where: 'registry',
      label: `Engineering record (${parts.join(', ')})`,
      path: { recordKey: key },
    })
  }

  // 2. HMI bindings: the widget tag, trend pens, and tag-bearing props — the
  //    same walk the orphaned-binding rule validates, filtered to this key.
  for (const b of collectHmiBindings(doc)) {
    if (b.tag !== key) continue
    out.push({ class: 'auto', where: b.where, label: b.label, path: b.path })
  }

  // 3. Accepted QA findings, keyed rule + engineering key.
  for (const findingKey of Object.keys(doc.qa?.ignored ?? {})) {
    const parts = splitFindingKey(findingKey)
    if (parts?.entityKey !== key) continue
    out.push({
      class: 'auto',
      where: 'qa-ignored',
      label: `Accepted finding: ${parts.ruleId}`,
      path: { findingKey },
    })
  }

  // 4. Human-written record text that names this key. Never auto-rewritten.
  for (const [recordKey, record] of Object.entries(doc.registry ?? {})) {
    for (const field of REVIEW_FIELDS) {
      const value = record.fields[field]
      if (!value || !mentions(value, key)) continue
      out.push({
        class: 'review',
        where: 'record-field',
        label: `${recordKey} · ${field} — "${value}"`,
        path: { recordKey, field },
      })
    }
  }

  return out
}

/** Rewrite every tag reference inside one widget. Returns `w` itself when
 *  nothing matched, so unchanged widgets keep identity and React skips them. */
function renameInWidget(w: HmiWidget, oldKey: string, newKey: string): HmiWidget {
  let next = w

  if (w.tag === oldKey) next = { ...next, tag: newKey }

  if (w.pens?.some((p) => parseSignalRef(p.ref)?.tag === oldKey)) {
    next = {
      ...next,
      pens: w.pens.map((p) => {
        const s = parseSignalRef(p.ref)
        return s && s.tag === oldKey ? { ...p, ref: `${newKey}.${s.signal}` } : p
      }),
    }
  }

  const schema = WIDGET_SCHEMA[w.type] ?? {}
  if (w.props) {
    let changed = false
    const props: Record<string, string | number | boolean> = { ...w.props }
    for (const [field, value] of Object.entries(w.props)) {
      if (typeof value !== 'string') continue
      const kind = schema[field]
      const mode = kind ? TAG_PROP_KINDS[kind] : undefined
      if (!mode) continue
      if (mode === 'bare') {
        if (value !== oldKey) continue
        props[field] = newKey
        changed = true
      } else {
        const s = parseSignalRef(value)
        if (!s || s.tag !== oldKey) continue
        props[field] = `${newKey}.${s.signal}`
        changed = true
      }
    }
    if (changed) next = { ...next, props }
  }

  return next
}

export interface RenameResult {
  doc: ProjectDoc
  /** Machine references moved to the new key. */
  applied: TagRef[]
  /** Human text that names the old key — surfaced, never rewritten. */
  deferred: TagRef[]
  /** Nothing moved: the new key already owns a record. */
  broken: TagRef[]
}

/**
 * Carry every machine-written reference from `oldKey` to `newKey`.
 *
 * CONTRACT: `doc` is the document whose SHEETS ALREADY carry the new name —
 * the object was renamed, and this moves everything that pointed at it. That
 * matches how the store has always worked (build the new sheets, then move the
 * record) and means `oldKeyStillUsed` can be derived here instead of being
 * passed in and eventually passed in wrongly.
 *
 * Collision — the new key already has a record — refuses everything. Merging
 * two engineering records is unrecoverable, and moving the HMI bindings onto a
 * key whose record stayed put would be a half-done rename, which is worse than
 * none. The document comes back exactly as handed in and `broken` says what
 * could not move.
 */
export function applyRename(doc: ProjectDoc, oldKey: string | null, newKey: string | null): RenameResult {
  if (!oldKey || !newKey || oldKey === newKey) {
    return { doc, applied: [], deferred: [], broken: [] }
  }

  const refs = collectTagRefs(doc, oldKey)
  const auto = refs.filter((r) => r.class === 'auto')
  const deferred = refs.filter((r) => r.class === 'review')

  // The one existing rule this must not change: a tag still worn by another
  // symbol keeps its record, so the record is COPIED rather than moved.
  const stillUsed = liveKeys(doc.sheets).has(oldKey)
  const moved = retagRegistry(doc.registry, oldKey, newKey, { oldKeyStillUsed: stillUsed })
  if (moved.collision) {
    return { doc, applied: [], deferred: [], broken: auto.map((r) => ({ ...r, class: 'broken' as const })) }
  }

  let next = doc
  if (moved.registry !== doc.registry) next = { ...next, registry: moved.registry }

  const touchedScreens = new Set(
    auto.filter((r) => r.path.screenId !== undefined).map((r) => r.path.screenId as string),
  )
  if (touchedScreens.size) {
    next = {
      ...next,
      hmiScreens: doc.hmiScreens.map((screen) =>
        touchedScreens.has(screen.id)
          ? { ...screen, widgets: screen.widgets.map((w) => renameInWidget(w, oldKey, newKey)) }
          : screen,
      ),
    }
  }

  const qaRefs = auto.filter((r) => r.where === 'qa-ignored')
  if (qaRefs.length && doc.qa?.ignored) {
    const ignored = { ...doc.qa.ignored }
    for (const ref of qaRefs) {
      const from = ref.path.findingKey
      if (!from) continue
      const parts = splitFindingKey(from)
      if (!parts) continue
      const accepted = ignored[from]
      if (!accepted) continue
      const to = `${parts.ruleId}:${newKey}`
      // An acceptance already recorded under the new key wins: it was a
      // deliberate decision about the object that is staying.
      if (!(to in ignored)) ignored[to] = accepted
      delete ignored[from]
    }
    next = { ...next, qa: { ignored } }
  }

  return { doc: next, applied: auto, deferred, broken: [] }
}

/**
 * What a rename WOULD do, computed without doing any of it.
 *
 * Safe to call on every keystroke: it reads the document and returns a
 * description. Nothing here mutates, records history, or touches the store.
 *
 * The collision verdict comes from `retagRegistry` itself rather than a
 * re-implementation of its rule, for the reason `validate/impact.ts` gives
 * about the standards preview: a preview derived separately from the thing it
 * predicts is a second implementation that will eventually disagree, and the
 * moment it does the preview is worthless. A test pins preview.auto to the
 * count applyRename actually applies.
 */
export interface RenameImpact {
  oldKey: string
  newKey: string
  /** Machine-written references that will be rewritten. */
  auto: TagRef[]
  /** Human-written fields naming the old key. Listed, never rewritten. */
  review: TagRef[]
  /** On a collision, the auto references that will NOT move — because nothing will. */
  blocked: TagRef[]
  /** The new key already owns an engineering record: the rename is refused whole. */
  collision: boolean
  counts: {
    auto: number
    review: number
    blocked: number
    /** Per location, for the "4 HMI widgets, 2 trend pens" breakdown. */
    byWhere: Record<RefWhere, number>
  }
}

const emptyByWhere = (): Record<RefWhere, number> => ({
  registry: 0, 'hmi-widget': 0, 'hmi-pen': 0, 'hmi-signal': 0,
  'hmi-bind': 0, 'qa-ignored': 0, 'record-field': 0,
})

export function renameImpact(
  doc: ProjectDoc,
  oldKey: string | null,
  newKey: string | null,
): RenameImpact {
  const from = oldKey ?? ''
  const to = newKey ?? ''
  const counts = emptyByWhere()
  if (!from || !to || from === to) {
    return {
      oldKey: from, newKey: to, auto: [], review: [], blocked: [], collision: false,
      counts: { auto: 0, review: 0, blocked: 0, byWhere: counts },
    }
  }

  const refs = collectTagRefs(doc, from)
  for (const r of refs) counts[r.where] += 1

  const auto = refs.filter((r) => r.class === 'auto')
  const review = refs.filter((r) => r.class === 'review')

  // The one collision rule, asked of the function that owns it. `oldKeyStillUsed`
  // does not affect the verdict — only whether a record is moved or copied —
  // so the preview needs no candidate document to answer this.
  const collision = retagRegistry(doc.registry, from, to, { oldKeyStillUsed: false }).collision

  return {
    oldKey: from,
    newKey: to,
    auto: collision ? [] : auto,
    review,
    blocked: collision ? auto.map((r) => ({ ...r, class: 'broken' as const })) : [],
    collision,
    counts: {
      auto: collision ? 0 : auto.length,
      review: review.length,
      blocked: collision ? auto.length : 0,
      byWhere: counts,
    },
  }
}

/**
 * What clearing a tag would strand.
 *
 * Clearing is not a rename and is not described as one: there is no
 * destination, nothing is carried, and inventing a fake target to reuse the
 * rename preview would be a lie about what is going to happen.
 *
 * It is also the more destructive of the two. A rename moves every reference
 * with it; a clear leaves all of them pointing at a tag no object wears any
 * more — the engineering record loses its object, every HMI binding goes quiet
 * (P0-B reports them afterwards), and accepted findings go stale. Same
 * traversal as the rename, opposite outcome.
 */
export interface ClearImpact {
  key: string
  /** Machine references that will be left pointing at nothing. */
  orphaned: TagRef[]
  /** Human-written text naming the key. Untouched by a clear, as by a rename. */
  review: TagRef[]
  counts: { orphaned: number; review: number; byWhere: Record<RefWhere, number> }
}

export function clearTagImpact(doc: ProjectDoc, key: string | null): ClearImpact {
  const counts: Record<RefWhere, number> = {
    registry: 0, 'hmi-widget': 0, 'hmi-pen': 0, 'hmi-signal': 0,
    'hmi-bind': 0, 'qa-ignored': 0, 'record-field': 0,
  }
  if (!key) return { key: '', orphaned: [], review: [], counts: { orphaned: 0, review: 0, byWhere: counts } }

  const refs = collectTagRefs(doc, key)
  for (const r of refs) counts[r.where] += 1
  const orphaned = refs.filter((r) => r.class === 'auto')
  const review = refs.filter((r) => r.class === 'review')
  return {
    key,
    orphaned,
    review,
    counts: { orphaned: orphaned.length, review: review.length, byWhere: counts },
  }
}
