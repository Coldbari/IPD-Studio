// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * THE CANONICAL ENGINEERING DIAGNOSTIC MODEL.
 *
 * One pure derivation that answers "where do the P&ID, the engineering
 * registry, the process simulation and the operator screens disagree?", in
 * seven categories, as structured data.
 *
 * WHY IT LIVES IN `model/`. It is consumed by three surfaces that must not
 * disagree — the Checks workspace (through thin `Rule` adapters in
 * `validate/rules/diagnostics.ts`), the HMI Diagnostics page, and the
 * reconciliation view — and `model/` is already where this codebase puts a
 * pure derivation with several consumers (`references.ts`, `signalData.ts`,
 * `ioList.ts`, `conformance.ts`). Putting it under `hmi/` would make the
 * validation engine import the operator layer to validate the drawing.
 *
 * WHAT IT IS NOT. It is not a second validation engine. Every category below
 * either delegates to the existing canonical helper (`collectHmiBindings`,
 * `parseRange`, `processFor`, `buildTagDefs`, `buildSimModel`) or reports
 * something no existing rule reports. Where an existing rule already covers
 * ground — `alarm-order`, `alarm-outside-range`, `range-unreadable`,
 * `orphan-record`, `dangling-end`, `duplicate-tag` — this module deliberately
 * stays silent and the mapping is written down in `docs/HMI.md`.
 *
 * TWO SEVERITIES, DELIBERATELY, because they answer different questions.
 *
 *  - `DiagnosticFinding.severity` (ERROR / WARNING / INFO) is the OPERATOR
 *    LAYER's seriousness: can the running plant work? A widget bound to a
 *    deleted tag is an ERROR — it reads nothing, for ever.
 *  - The `Rule.severity` each adapter in `validate/rules/diagnostics.ts`
 *    declares is the DRAWING's seriousness: does this stop the P&ID being
 *    issued? A house standard can gate issue on `critical` findings
 *    (`model/conformance.ts` `issueBlockers`), so the same dead HMI binding is
 *    a `warning` there: an operator screen must never block a drawing.
 *
 * Collapsing them would make one of the two lie. The mapping is stated per
 * rule in the adapter and summarised in `docs/HMI.md`.
 *
 * DETERMINISM. Everything here is derived from the document and sorted by
 * (severity, category, tag, objectId, id). No iteration order of a plain
 * object reaches the output unsorted, no random ids, no runtime values, no
 * clock. The same document always produces the same findings in the same
 * order — which is what makes the tests, the UI and any future CI gate
 * meaningful.
 *
 * NO RUNTIME STATE. A PV, a quality flag, an alarm and the simulation clock
 * are all deliberately absent. Those belong to the LIVE diagnostics the
 * operator page already shows; mixing them in would make an engineering
 * finding blink on and off as the plant runs.
 */

import type { ProjectIndex } from './projectIndex'
import type { FixSpec } from '../assist/fixes'
import type { HmiScreen, HmiWidget, WidgetType } from '../hmi/model'
import { isPortEnd } from './types'
import { collectHmiBindings } from './references'
import { parseRange } from './signalData'
import { parseQuantity } from './processData'
import { listPlantTags } from '../hmi/tagIndex'
import type { TagDef, Measures } from '../hmi/sim/tags'
import { measuresOf, tagDefMap } from '../hmi/sim/tags'
import { buildSimModel } from '../hmi/sim/engine'
import type { ControllerSpec } from '../hmi/sim/engine'
import type { FlowNetwork } from '../hmi/sim/network'

/** The seven categories Step I defines. Ordered as they are reported. */
export const DIAGNOSTIC_CATEGORIES = [
  'missing-tag',
  'broken-connection',
  'missing-instrument',
  'invalid-range',
  'invalid-unit',
  'missing-simulation-model',
  'unbound-hmi-object',
] as const

export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number]

/**
 * Every Checks rule these diagnostics feed, and the category each carries.
 *
 * A LEDGER, not a lookup: a category whose findings differ in how serious they
 * are FOR THE DRAWING maps onto more than one rule, and this is where that is
 * written down. `tests/validate/diagnosticRules.test.ts` fails if a rule
 * emitted here has no adapter, or an adapter has no rule.
 */
export const DIAGNOSTIC_RULE_CATEGORY: Record<string, DiagnosticCategory> = {
  'orphaned-binding': 'missing-tag',
  'broken-process-connection': 'broken-connection',
  'broken-hmi-binding': 'broken-connection',
  'missing-instrument': 'missing-instrument',
  'controller-no-measurement': 'missing-instrument',
  'invalid-range': 'invalid-range',
  'invalid-unit': 'invalid-unit',
  'unit-advisory': 'invalid-unit',
  'missing-simulation-model': 'missing-simulation-model',
  'unbound-hmi-object': 'unbound-hmi-object',
  /** The contained-failure report. Never fires on a healthy build. */
  'diagnostics-engine': 'missing-tag',
}

export const CATEGORY_LABEL: Record<DiagnosticCategory, string> = {
  'missing-tag': 'Missing tag',
  'broken-connection': 'Broken connection',
  'missing-instrument': 'Missing instrument',
  'invalid-range': 'Invalid range',
  'invalid-unit': 'Invalid unit',
  'missing-simulation-model': 'Missing simulation model',
  'unbound-hmi-object': 'Unbound HMI object',
}

/** Why each category exists, in one sentence, for the report headings. */
export const CATEGORY_WHY: Record<DiagnosticCategory, string> = {
  'missing-tag': 'The operator screen reads a tag the engineering source no longer carries. It still draws, reads nothing, and says so nowhere.',
  'broken-connection': 'A reference in the process model points at an endpoint that is not there. A visual line is not evidence of a valid connection.',
  'missing-instrument': 'The engineering source has an object the operator layer was built to represent and does not.',
  'invalid-range': 'A range that cannot be read as an ascending pair of numbers cannot scale a display, place a limit tick, or check an alarm.',
  'invalid-unit': 'A unit that does not match what the tag measures means the number on the screen is not the quantity the label claims.',
  'missing-simulation-model': 'The object exists in engineering configuration, and nothing in the runtime can produce its value or its state.',
  'unbound-hmi-object': 'The widget looks like a process object and is connected to no canonical engineering or runtime data.',
}

/** Where a finding points, in machine-addressable form. */
export interface DiagnosticLocation {
  kind: 'hmi-widget' | 'hmi-pipe' | 'sheet-node' | 'sheet-edge' | 'record'
  screenId?: string
  widgetId?: string
  pipeId?: string
  sheetId?: string
  nodeId?: string
  edgeId?: string
  recordKey?: string
}

/** Which layer the finding is ABOUT — not where the evidence came from. */
export type DiagnosticSource = 'pid' | 'registry' | 'hmi' | 'simulation'

/**
 * How serious this is FOR THE OPERATOR LAYER. See the header: the Checks
 * report's `Severity` answers a different question and is declared per rule.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  error: 'ERROR', warning: 'WARNING', info: 'INFO',
}

export interface DiagnosticFinding {
  /**
   * Stable identity, deterministic from the document. Doubles as the
   * acceptance key when a finding reaches the Checks report, so it must not
   * contain anything that changes between runs.
   */
  id: string
  category: DiagnosticCategory
  severity: DiagnosticSeverity
  /**
   * Which Checks rule reports this finding.
   *
   * Carried as DATA rather than re-derived by the adapters, so the mapping
   * from category to rule is stated once, here, beside the detection. A
   * category whose findings genuinely differ in drawing-seriousness maps onto
   * more than one rule — see `validate/rules/diagnostics.ts`.
   */
  ruleId: string
  /** The engineering tag this is about, where there is one. */
  tag?: string
  /** Widget / node / edge / pipe id, for navigation. */
  objectId?: string
  source: DiagnosticSource
  /** One sentence, in engineering language, naming the object. */
  message: string
  /** The evidence: what was found where. Optional second line. */
  details?: string
  /** What the engineer should do. Never a promise the app will do it. */
  suggestedAction: string
  location: DiagnosticLocation
  /** A repair the Checks report can offer, where one is unambiguous. Carried
   *  as DATA — label and spec — for the reason `validate/rules.ts` gives: a fix
   *  has to be showable before it is run. */
  fix?: { label: string; spec: FixSpec }
}

export interface DiagnosticReport {
  findings: DiagnosticFinding[]
  counts: Record<DiagnosticSeverity, number>
  byCategory: Record<DiagnosticCategory, number>
  /** Total, so a summary line does not have to add three numbers up. */
  total: number
}

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 }
const CATEGORY_RANK: Record<DiagnosticCategory, number> =
  Object.fromEntries(DIAGNOSTIC_CATEGORIES.map((c, i) => [c, i])) as Record<DiagnosticCategory, number>

const byTag = (a: string | undefined, b: string | undefined) =>
  (a ?? '').localeCompare(b ?? '', undefined, { numeric: true })

/** THE ordering. Documented here and asserted in the tests. */
export function sortFindings(list: DiagnosticFinding[]): DiagnosticFinding[] {
  return [...list].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      byTag(a.tag, b.tag) ||
      (a.objectId ?? '').localeCompare(b.objectId ?? '') ||
      a.id.localeCompare(b.id),
  )
}

// ── Units ───────────────────────────────────────────────────────────────────

/**
 * What quantity a written unit names.
 *
 * `null` means "recognised, and dimensionless" — per cent, which is a valid
 * unit for a level, a valve position and a controller output and tells you
 * nothing about pressure or flow. `undefined` means "not recognised", which is
 * reported as INFO rather than as an error: an engineer may legitimately write
 * a unit this software has never heard of, and refusing to judge is better
 * than judging wrongly.
 *
 * Deliberately NOT derived from `processData.ts`'s conversion tables. Those
 * answer "how do I convert this to m³", which is a different question — they
 * contain no level units and no per cent, and reading them backwards would
 * give `m` as a head unit rather than as a level one.
 */
const UNIT_QUANTITY: Record<string, Measures | null> = {
  // dimensionless
  '%': null, 'pct': null, 'percent': null, '': null,
  // level
  'm': 'level', 'mm': 'level', 'cm': 'level', 'ft': 'level', 'in': 'level',
  // flow
  'm3/h': 'flow', 'm³/h': 'flow', 'm3/hr': 'flow', 'cmh': 'flow', 'm3h': 'flow',
  'l/s': 'flow', 'lps': 'flow', 'l/min': 'flow', 'lpm': 'flow', 'm3/s': 'flow',
  'gpm': 'flow', 'kg/h': 'flow', 't/h': 'flow',
  // pressure
  'bar': 'pressure', 'barg': 'pressure', 'bara': 'pressure', 'mbar': 'pressure',
  'kpa': 'pressure', 'mpa': 'pressure', 'pa': 'pressure', 'psi': 'pressure',
  'psig': 'pressure', 'psia': 'pressure', 'atm': 'pressure', 'kg/cm2': 'pressure',
  // temperature
  '°c': 'temperature', 'degc': 'temperature', 'c': 'temperature',
  '°f': 'temperature', 'degf': 'temperature', 'f': 'temperature',
  'k': 'temperature', 'degk': 'temperature',
}

/** Normalise the ways people write a unit, without changing what it means. */
export function canonUnit(u: string): string {
  return u.trim().toLowerCase().replace(/\^/g, '').replace(/²/g, '2').replace(/\s+/g, '')
}

/** The quantity a unit names: `null` dimensionless, `undefined` unrecognised. */
export function quantityOfUnit(unit: string | undefined): Measures | null | undefined {
  if (unit === undefined) return undefined
  const key = canonUnit(unit)
  if (key === '') return null
  // `m³/h` survives canon as itself; the table carries both spellings.
  return key in UNIT_QUANTITY ? UNIT_QUANTITY[key] : undefined
}

/** What a tag measures FROM ITS ISA LETTER ALONE.
 *
 *  `measuresOf` falls back to the stated unit, which is exactly wrong here:
 *  asking whether the unit matches the quantity, and deriving the quantity
 *  from the unit, always agrees with itself. */
export const quantityOfTag = (tag: string): Measures | undefined => measuresOf(tag, undefined)

// ── Context ─────────────────────────────────────────────────────────────────

/**
 * Everything the seven detectors read, compiled ONCE.
 *
 * `model` is the simulator's own `buildSimModel` over the same screens and the
 * same registry a RUN would compile. Not a re-implementation: asking a second
 * compiler whether the first one has a model for something is how a diagnostic
 * starts lying about the runtime it is describing.
 */
interface Ctx {
  ix: ProjectIndex
  screens: HmiScreen[]
  /** Every widget with the screen it lives on, in document order. */
  placed: { screen: HmiScreen; widget: HmiWidget }[]
  defs: Record<string, TagDef>
  net: FlowNetwork
  controllers: ControllerSpec[]
  /** Tags that appear as a widget tag anywhere. */
  represented: Set<string>
  /** Pipe ids that exist on some screen. */
  pipeIds: Set<string>
  /** Widget ids that exist, per screen. */
  widgetIds: Map<string, Set<string>>
}

function buildCtx(ix: ProjectIndex): Ctx {
  const screens = ix.doc.hmiScreens ?? []
  const placed = screens.flatMap((screen) => screen.widgets.map((widget) => ({ screen, widget })))
  const model = buildSimModel(screens, ix.doc.registry)
  const pipeIds = new Set(screens.flatMap((sc) => sc.pipes.map((p) => p.id)))
  const widgetIds = new Map(screens.map((sc) => [sc.id, new Set(sc.widgets.map((w) => w.id))]))
  return {
    ix,
    screens,
    placed,
    defs: tagDefMap(model.defs),
    net: model.net,
    controllers: model.controllers,
    represented: new Set(placed.map((p) => p.widget.tag).filter((t): t is string => t !== undefined)),
    pipeIds,
    widgetIds,
  }
}

/** A widget's name in a sentence. Never an id: an engineer reads tags. */
const widgetName = (w: HmiWidget): string => w.tag || w.label?.trim() || w.type

/**
 * Widget types that REPRESENT a process object, and so are expected to carry a
 * tag. `label`, `panel` and `nav` are chrome; `symbol` is a graphic the
 * importer places for hardware that has no measurable identity (a VFD, a sight
 * glass, an I/P converter), and demanding a tag of one would fire on every
 * imported screen.
 */
const PROCESS_WIDGETS = new Set<WidgetType>([
  'tank', 'pump', 'valve', 'display', 'gauge', 'trend', 'bar', 'equip',
])

/** Widget types that WRITE — a control with nowhere to write is inert. */
const CONTROL_WIDGETS = new Set<WidgetType>(['lamp', 'button', 'switch'])

// ── 1. MISSING TAG ──────────────────────────────────────────────────────────

/**
 * An HMI reference to a tag the engineering source does not carry.
 *
 * Checked against `liveKeys` — the tags actually DRAWN — and deliberately not
 * against the registry, for the reason `orphaned-binding` records: an
 * engineering record is optional, and testing the registry would report every
 * binding of a drawing nobody has written datasheets for yet.
 *
 * ONE FINDING PER BINDING, not per tag: the same missing tag read by four
 * widgets is four separate repairs, and accepting one must not silence the
 * other three. The id below is the key `orphaned-binding` has always used, so
 * an acceptance recorded before Step I keeps working.
 */
function missingTag(ctx: Ctx): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []
  for (const b of collectHmiBindings(ctx.ix.doc)) {
    if (ctx.ix.liveKeys.has(b.tag)) continue
    const slot = b.where === 'hmi-pen' ? `pen${b.path.penIndex}` : b.path.field ?? 'tag'
    out.push({
      id: `orphaned-binding:${b.tag}@${b.path.screenId}/${b.path.widgetId}/${slot}`,
      category: 'missing-tag',
      ruleId: 'orphaned-binding',
      severity: 'error',
      tag: b.tag,
      objectId: b.path.widgetId,
      source: 'hmi',
      message: `${b.label} reads ${b.tag}, which nothing on any sheet carries`,
      details: 'The widget still draws. It reads nothing, for ever, and says so nowhere.',
      suggestedAction: `Rebind it to a tag that exists, or clear the binding. Do not delete the widget — if ${b.tag} was renamed, remapping keeps the screen you laid out.`,
      location: { kind: 'hmi-widget', screenId: b.path.screenId, widgetId: b.path.widgetId },
      fix: {
        label: 'Clear the binding',
        spec: {
          kind: 'clear-binding',
          screenId: b.path.screenId,
          widgetId: b.path.widgetId,
          where: b.where,
          tag: b.tag,
          ...(b.path.field ? { field: b.path.field } : {}),
          ...(b.path.penIndex !== undefined ? { penIndex: b.path.penIndex } : {}),
        },
      },
    })
  }
  return out
}

// ── 2. BROKEN CONNECTION ────────────────────────────────────────────────────

/**
 * A reference in the PROCESS MODEL that points at an endpoint which is not
 * there. Not a visual check: a line that looks connected and a line the solver
 * can walk are different claims, and this reports the second.
 *
 * The four real cases:
 *
 *  1. `bindPipe` naming a pipe id no screen holds. THE WORST ONE, and the
 *     reason this category exists: `sim/engine.ts` sums the branches crossing
 *     that pipe, finds none, and the transmitter reads a confident 0.00 with
 *     GOOD quality for ever. `sim/quality.ts` cannot catch it — the binding is
 *     present, so the "no process model" test passes.
 *  2. `bindTank` naming a tag with no vessel behind it. The measurement comes
 *     back `undefined` and the tag never gets a PV.
 *  3. An HMI pipe anchored to a widget that has been deleted. The network
 *     attaches that end by geometry instead, which is the guess the anchors
 *     exist to avoid.
 *  4. A P&ID edge whose port end names a node that is not on the sheet. The
 *     drawing still renders the line; nothing can walk it. `dangling-end`
 *     reports FREE ends and deliberately not this one.
 */
function brokenConnection(ctx: Ctx): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []

  for (const { screen, widget } of ctx.placed) {
    const props = widget.props ?? {}
    const bindPipe = typeof props.bindPipe === 'string' ? props.bindPipe : undefined
    if (bindPipe !== undefined && !ctx.pipeIds.has(bindPipe)) {
      out.push({
        id: `broken-connection:bind-pipe:${screen.id}/${widget.id}`,
        category: 'broken-connection',
        ruleId: 'broken-hmi-binding',
        severity: 'error',
        ...(widget.tag ? { tag: widget.tag } : {}),
        objectId: widget.id,
        source: 'hmi',
        message: `${widgetName(widget)} on ${screen.name} is bound to a line that is not on any screen`,
        details: 'The simulation sums the flow of every branch crossing that line, finds none, and the measurement reads zero with GOOD quality — a silent wrong number rather than a missing one.',
        suggestedAction: 'Rebind it to a line that exists, or clear the binding so the value is reported as having no process model.',
        location: { kind: 'hmi-widget', screenId: screen.id, widgetId: widget.id },
      })
    }
    const bindTank = typeof props.bindTank === 'string' ? props.bindTank : undefined
    if (bindTank !== undefined && ctx.defs[bindTank]?.kind !== 'tank') {
      out.push({
        id: `broken-connection:bind-tank:${screen.id}/${widget.id}`,
        category: 'broken-connection',
        ruleId: 'broken-hmi-binding',
        severity: 'error',
        ...(widget.tag ? { tag: widget.tag } : {}),
        objectId: widget.id,
        source: 'hmi',
        message: `${widgetName(widget)} on ${screen.name} is bound to vessel ${bindTank}, which is not a vessel in this plant`,
        details: ctx.defs[bindTank]
          ? `${bindTank} exists but the runtime compiles it as a ${ctx.defs[bindTank]!.kind}, not a vessel.`
          : `Nothing on any screen defines ${bindTank}.`,
        suggestedAction: 'Bind the measurement to a tank widget, or clear the binding.',
        location: { kind: 'hmi-widget', screenId: screen.id, widgetId: widget.id },
      })
    }
  }

  for (const screen of ctx.screens) {
    const ids = ctx.widgetIds.get(screen.id) ?? new Set<string>()
    for (const pipe of screen.pipes) {
      for (const [end, id] of [['upstream', pipe.aId], ['downstream', pipe.bId]] as const) {
        if (id === undefined || ids.has(id)) continue
        out.push({
          id: `broken-connection:pipe-anchor:${screen.id}/${pipe.id}/${end}`,
          category: 'broken-connection',
          ruleId: 'broken-hmi-binding',
          severity: 'warning',
          objectId: pipe.id,
          source: 'hmi',
          message: `A line on ${screen.name} is anchored at its ${end} end to equipment that is no longer on the screen`,
          details: 'The flow network falls back to attaching that end by geometry, which is the guess the anchor exists to prevent.',
          suggestedAction: 'Redraw the end onto the equipment it serves, or delete the line.',
          location: { kind: 'hmi-pipe', screenId: screen.id, pipeId: pipe.id },
        })
      }
    }
  }

  for (const sheet of ctx.ix.doc.sheets) {
    const nodeIds = new Set(sheet.nodes.map((n) => n.id))
    for (const edge of sheet.edges) {
      for (const [side, end] of [['source', edge.source], ['target', edge.target]] as const) {
        if (!isPortEnd(end) || nodeIds.has(end.nodeId)) continue
        out.push({
          id: `broken-connection:edge-end:${sheet.id}/${edge.id}/${side}`,
          category: 'broken-connection',
          ruleId: 'broken-process-connection',
          severity: 'error',
          objectId: edge.id,
          source: 'pid',
          message: `A line on ${sheet.name} names a symbol at its ${side} end that is not on the sheet`,
          details: 'The line still draws. Nothing — the run derivation, the loop derivation, the HMI import — can walk through that end.',
          suggestedAction: 'Reattach the end to a symbol, or delete the line.',
          location: { kind: 'sheet-edge', sheetId: sheet.id, edgeId: edge.id },
        })
      }
    }
  }

  return out
}

// ── 3. MISSING INSTRUMENT ───────────────────────────────────────────────────

/**
 * Something the engineering source has that the operator layer was built to
 * represent, and does not.
 *
 * THE FALSE-POSITIVE GUARD, which is most of the work here. Not every
 * instrument on a P&ID belongs on an operator screen — a local gauge, a
 * sample point, a test connection are engineering-only, and a rule that
 * reported every undrawn tag would fire dozens of times on a real project and
 * be switched off within the hour.
 *
 * So this only reports a tag on a sheet SOME SCREEN CLAIMS TO REPRESENT
 * (`screen.fromSheetId`). A screen built from Sheet 2 is a statement that
 * Sheet 2's bindable objects belong on it; a sheet nobody imported is outside
 * the operator layer's scope and says nothing.
 *
 * Plus the one case the brief names explicitly, which has nothing to do with
 * screens: a controller that reached the runtime with no measurement wired to
 * it. `wireControllers` is the authority — the same pairing the simulation
 * runs on, asked once.
 */
function missingInstrument(ctx: Ctx): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []

  const claimed = new Map<string, HmiScreen>()
  for (const sc of ctx.screens) {
    if (sc.fromSheetId && !claimed.has(sc.fromSheetId)) claimed.set(sc.fromSheetId, sc)
  }

  if (claimed.size > 0) {
    for (const t of listPlantTags(ctx.ix.doc)) {
      const screen = claimed.get(t.sheetId)
      if (!screen || ctx.represented.has(t.display)) continue
      out.push({
        id: `missing-instrument:${t.display}@${screen.id}`,
        category: 'missing-instrument',
        ruleId: 'missing-instrument',
        severity: 'warning',
        tag: t.display,
        objectId: t.nodeId,
        source: 'pid',
        message: `${t.display} is on ${t.sheetName} but no HMI object represents it`,
        details: `${t.description}. ${screen.name} was built from that sheet, so this tag is inside the operator layer's scope.`,
        suggestedAction: `Reconcile ${screen.name} and choose Add to place it, or Ignore if this instrument is engineering-only.`,
        location: { kind: 'sheet-node', sheetId: t.sheetId, nodeId: t.nodeId },
      })
    }
  }

  const wired = new Set(ctx.controllers.map((c) => c.tag))
  for (const d of Object.values(ctx.defs).sort((a, b) => byTag(a.name, b.name))) {
    if (d.kind !== 'controller' || wired.has(d.name)) continue
    out.push({
      id: `controller-no-measurement:${d.name}`,
      category: 'missing-instrument',
      ruleId: 'controller-no-measurement',
      severity: 'error',
      tag: d.name,
      source: 'simulation',
      message: `Controller ${d.name} has no measurement to control`,
      details: 'A controller takes its PV from the tag that shares its ISA family and loop number and measures the same quantity. Nothing in this plant does.',
      suggestedAction: `Place the loop's transmitter on a screen, or check its tag — ${d.name} needs a partner such as ${d.name[0] ?? 'X'}T-${d.name.replace(/^[A-Za-z]+-?/, '')}.`,
      location: { kind: 'record', recordKey: d.name },
    })
  }

  return out
}

// ── 4. INVALID RANGE ────────────────────────────────────────────────────────

/**
 * A range that cannot mean what it says.
 *
 * `min >= max` is the one nothing caught. `parseRange` reads "10-0" happily,
 * `alarm-outside-range` normalises with Math.min/max so it never notices, and
 * the compiled `TagDef` carries min 10 / max 0 into every bar, gauge, trend
 * and limit tick — where the span is negative and every value pins to one end.
 *
 * Physical quantities are checked the same way: a vessel of zero capacity
 * makes the level integrator meaningless, and a pump rated at zero flow
 * delivers nothing whatever the operator does.
 *
 * DELIBERATELY ABSENT, because existing rules already own them: alarm limits
 * out of order (`alarm-order`), a limit outside the range (`alarm-outside-range`),
 * a range that is not numeric at all (`range-unreadable`), a vessel with no
 * stated capacity (`tank-capacity-defaulted`).
 */
function invalidRange(ctx: Ctx): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []

  for (const key of Object.keys(ctx.ix.records).sort()) {
    const record = ctx.ix.records[key]!
    const raw = record.fields['signal.range']
    const range = parseRange(raw)
    if (range && range.min >= range.max) {
      out.push({
        id: `invalid-range:record:${key}`,
        category: 'invalid-range',
        ruleId: 'invalid-range',
        severity: 'error',
        tag: key,
        source: 'registry',
        message: `${key} has a calibrated range of ${range.min}–${range.max}, which does not ascend`,
        details: range.min === range.max
          ? 'A zero-width range gives every reading the same position on every scale.'
          : 'Every display built from this range draws a negative span: values pin to one end and limit ticks land outside the scale.',
        suggestedAction: 'Write the range low value first, as "0-10 bar".',
        location: { kind: 'record', recordKey: key },
      })
    }

    for (const [field, label, why] of [
      ['construction.volume', 'capacity', 'The simulation integrates level as volume over capacity; a capacity of zero or less has no meaning.'],
      ['duty.capacity', 'rated flow', 'The pump curve is built on the rated duty point; at zero rated flow the machine delivers nothing whatever the operator does.'],
      ['duty.power', 'power', 'Heater duty is taken from this; at zero or less it adds no heat.'],
    ] as const) {
      const q = parseQuantity(record.fields[field])
      if (q === null || q.value > 0) continue
      out.push({
        id: `invalid-range:quantity:${key}/${field}`,
        category: 'invalid-range',
        ruleId: 'invalid-range',
        severity: 'error',
        tag: key,
        source: 'registry',
        message: `${key} states a ${label} of ${record.fields[field]}`,
        details: why,
        suggestedAction: `Set a positive ${label} on the engineering record, or clear the field so the simulation uses its stated default.`,
        location: { kind: 'record', recordKey: key },
      })
    }
  }

  // The COMPILED range, which is what every widget actually draws against. A
  // legacy widget prop can produce an inverted span with no record at all.
  for (const d of Object.values(ctx.defs).sort((a, b) => byTag(a.name, b.name))) {
    if (d.min < d.max) continue
    // Already reported against the record; saying it twice is noise.
    const fromRecord = parseRange(ctx.ix.records[d.name]?.fields['signal.range'])
    if (fromRecord && fromRecord.min >= fromRecord.max) continue
    out.push({
      id: `invalid-range:compiled:${d.name}`,
      category: 'invalid-range',
      ruleId: 'invalid-range',
      severity: 'error',
      tag: d.name,
      source: 'hmi',
      message: `${d.name} runs on a scale of ${d.min}–${d.max}, which does not ascend`,
      details: 'The range resolved from a widget property rather than from the engineering record. Every bar, gauge and trend using this tag draws a negative span.',
      suggestedAction: `State the range on ${d.name}'s engineering record, which overrides the widget.`,
      location: { kind: 'record', recordKey: d.name },
    })
  }

  return out
}

// ── 5. INVALID UNIT ─────────────────────────────────────────────────────────

/**
 * A unit that does not name what the tag measures.
 *
 * The ISA-5.1 first letter says what the instrument measures — that is what
 * the letter is FOR, and the simulation already relies on it to decide which
 * process variable a bound transmitter reads. So `PT-101` in m³/h is not a
 * matter of taste: the number the operator reads is a pressure and the label
 * says flow.
 *
 * Three verdicts, and the middle one matters most:
 *
 *  - a unit of a DIFFERENT quantity          → critical. Nothing is converted.
 *  - per cent on a dimensioned measurement   → warning. Legitimate as a signal
 *    scale, and the brief names it: 0–10 bar must not silently become 0–100 %.
 *  - a unit this software does not recognise → info. It prints as written; it
 *    simply cannot be checked or converted. Refusing to judge beats judging
 *    wrongly.
 */
function invalidUnit(ctx: Ctx): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []

  for (const d of Object.values(ctx.defs).sort((a, b) => byTag(a.name, b.name))) {
    // A vessel reads per cent full by definition, and a motor or valve state
    // has no engineering unit at all.
    if (d.kind !== 'display' && d.kind !== 'controller') continue
    const measures = quantityOfTag(d.name)
    if (!measures || d.unit === undefined) continue
    const q = quantityOfUnit(d.unit)
    if (q === measures) continue

    const stated = ctx.ix.records[d.name]?.fields['signal.units']?.trim()
    const where = stated ? 'its engineering record' : 'a widget property'

    if (q === undefined) {
      out.push({
        id: `unit-advisory:unknown:${d.name}`,
        category: 'invalid-unit',
        ruleId: 'unit-advisory',
        severity: 'info',
        tag: d.name,
        source: stated ? 'registry' : 'hmi',
        message: `${d.name} states a unit of "${d.unit}", which this software does not recognise`,
        details: `${d.name} measures ${measures} by its ISA letter. The unit prints exactly as written, but nothing can check a limit against it or convert it.`,
        suggestedAction: `Write a ${measures} unit this build knows, or leave it if the spelling is deliberate.`,
        location: { kind: 'record', recordKey: d.name },
      })
      continue
    }

    // PER CENT IS THE CANONICAL UNIT FOR LEVEL, not a loose one: `UNITS.level`
    // is '%', the simulation produces per cent full, and an ISA level
    // transmitter is conventionally ranged 0-100 %. Reporting it would have
    // fired on the bundled HMI demo — which is how this was caught. The brief's
    // case is a DIMENSIONED quantity losing its unit ("0-10 bar must not become
    // 0-100 %"), and that is what the test below is.
    if (q === null && measures === 'level') continue

    if (q === null) {
      out.push({
        id: `unit-advisory:dimensionless:${d.name}`,
        category: 'invalid-unit',
        ruleId: 'unit-advisory',
        severity: 'warning',
        tag: d.name,
        source: stated ? 'registry' : 'hmi',
        message: `${d.name} measures ${measures} but is scaled in ${d.unit}`,
        details: `The simulation produces ${measures} for this tag and the screen labels it ${d.unit}. A ${measures} range must not silently become a percentage scale.`,
        suggestedAction: `State the engineering unit on ${d.name}, or confirm the per cent scale is deliberate and accept this finding.`,
        location: { kind: 'record', recordKey: d.name },
      })
      continue
    }

    out.push({
      id: `invalid-unit:mismatch:${d.name}`,
      category: 'invalid-unit',
      ruleId: 'invalid-unit',
      severity: 'error',
      tag: d.name,
      source: stated ? 'registry' : 'hmi',
      message: `${d.name} measures ${measures} but its unit "${d.unit}" is a ${q} unit`,
      details: `The ISA first letter of ${d.name} says ${measures}, and the simulation produces ${measures} for it. The unit comes from ${where}. Nothing is converted — the number is a ${measures} reading wearing a ${q} label.`,
      suggestedAction: `Correct the unit on ${d.name}, or retag the instrument if it really measures ${q}.`,
      location: { kind: 'record', recordKey: d.name },
    })
  }

  // The range's trailing unit contradicting the explicit one. `engineeringFor`
  // prefers the explicit field, so this is a value that silently loses.
  for (const key of Object.keys(ctx.ix.records).sort()) {
    const fields = ctx.ix.records[key]!.fields
    const explicit = fields['signal.units']?.trim()
    const trailing = parseRange(fields['signal.range'])?.unit
    if (!explicit || !trailing) continue
    const a = quantityOfUnit(explicit)
    const b = quantityOfUnit(trailing)
    if (a === b || a === undefined || b === undefined) continue
    out.push({
      id: `unit-advisory:range-conflict:${key}`,
      category: 'invalid-unit',
      ruleId: 'unit-advisory',
      severity: 'warning',
      tag: key,
      source: 'registry',
      message: `${key} is ranged in "${trailing}" but its unit field says "${explicit}"`,
      details: 'The explicit unit field wins everywhere it is read, so the unit written after the range is discarded without a word.',
      suggestedAction: 'Make the two agree, or drop the unit from the range text.',
      location: { kind: 'record', recordKey: key },
    })
  }

  return out
}

// ── 6. MISSING SIMULATION MODEL ─────────────────────────────────────────────

/**
 * The object is configured, and the runtime cannot produce anything for it.
 *
 * NOT THE SAME AS BAD QUALITY, and the distinction is the point (Step I §32).
 * A forced transmitter has a model and an operator has overridden it; a
 * transmitter with nothing behind it has no model at all. Both can be true at
 * once, independently, and neither implies the other. Nothing here reads a
 * runtime value — that is what makes it possible to say so.
 *
 * Two shapes:
 *
 *  1. A measurement with neither a vessel nor a line behind it. Its PV is a
 *     seeded walk around an idle figure. `sim/quality.ts` already reports this
 *     live as UNCERTAIN; here it is the ENGINEERING statement of the same
 *     fact, which is what a reconciliation and a Checks report need.
 *  2. A device on no flow path. A pump that drives nothing, a valve that
 *     throttles nothing, a vessel nothing fills or drains. The operator can
 *     press START and the plant will not move.
 */
function missingSimulationModel(ctx: Ctx): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []

  const onAPath = new Set<string>()
  const tanksOnAPath = new Set<string>()
  for (const b of ctx.net.branches) {
    for (const t of [...b.pumps, ...b.heaters, ...b.valves]) onAPath.add(t)
    for (const end of [b.from, b.to]) if (end.kind === 'tank') tanksOnAPath.add(end.tag)
  }

  const KIND_WORD: Record<string, string> = {
    tank: 'Vessel', motor: 'Driven equipment', valve: 'Control valve',
    valveOnOff: 'On/off valve', display: 'Measurement', controller: 'Controller',
  }

  for (const d of Object.values(ctx.defs).sort((a, b) => byTag(a.name, b.name))) {
    if (d.kind === 'display' || d.kind === 'controller') {
      if (d.bindTank !== undefined || d.bindPipe !== undefined) continue
      // A controller takes its PV from its wired partner, not from a binding.
      if (d.kind === 'controller' && ctx.controllers.some((c) => c.tag === d.name)) continue
      out.push({
        id: `missing-simulation-model:measurement:${d.name}`,
        category: 'missing-simulation-model',
        ruleId: 'missing-simulation-model',
        severity: 'warning',
        tag: d.name,
        source: 'simulation',
        message: `${d.name} — ${KIND_WORD[d.kind]} — has no process model behind it`,
        details: `Nothing produces ${d.name}. Its value drifts near an idle figure and the runtime reports it UNCERTAIN rather than presenting it as a reading. This is a missing model, not bad data: a forced or failed instrument is a different finding.`,
        suggestedAction: 'Bind it to a vessel or a line in the editor, so the value it shows comes from the process.',
        location: { kind: 'record', recordKey: d.name },
      })
      continue
    }

    if (d.kind === 'tank' && !tanksOnAPath.has(d.name)) {
      out.push({
        id: `missing-simulation-model:vessel:${d.name}`,
        category: 'missing-simulation-model',
        ruleId: 'missing-simulation-model',
        severity: 'warning',
        tag: d.name,
        source: 'simulation',
        message: `${d.name} — Vessel — is on no flow path`,
        details: 'No line reaches this vessel, so nothing fills or drains it and its level can never change.',
        suggestedAction: 'Draw the lines that serve it on the HMI screen, or accept that it is a static graphic.',
        location: { kind: 'record', recordKey: d.name },
      })
      continue
    }

    if ((d.kind === 'motor' || d.kind === 'valve' || d.kind === 'valveOnOff') && !onAPath.has(d.name)) {
      const word = d.heaterKw !== undefined ? 'Heater' : KIND_WORD[d.kind]!
      out.push({
        id: `missing-simulation-model:device:${d.name}`,
        category: 'missing-simulation-model',
        ruleId: 'missing-simulation-model',
        severity: 'warning',
        tag: d.name,
        source: 'simulation',
        message: `${d.name} — ${word} — is on no flow path`,
        details: 'The flow network compiled from this plant contains no branch through this device. The operator can command it and nothing in the process responds.',
        suggestedAction: 'Draw the lines through it on the HMI screen, so it sits in a path between a source and a destination.',
        location: { kind: 'record', recordKey: d.name },
      })
    }
  }

  return out
}

// ── 7. UNBOUND HMI OBJECT ───────────────────────────────────────────────────

/**
 * A widget that presents itself as a process object and is wired to nothing
 * canonical.
 *
 * This is the category the Phase 0 audit asked for by name: the risk of
 * VISUAL-ONLY PROCESS VALUES — a display that looks exactly like a live
 * reading and is not one.
 *
 * Distinct from `missing-tag`, which is about a binding that names a tag the
 * drawing has lost. Here there is no binding at all, or the binding names
 * something the runtime does not serve.
 */
function unboundHmiObject(ctx: Ctx): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []

  for (const { screen, widget } of ctx.placed) {
    if (PROCESS_WIDGETS.has(widget.type) && !widget.tag) {
      out.push({
        id: `unbound-hmi-object:no-tag:${screen.id}/${widget.id}`,
        category: 'unbound-hmi-object',
        ruleId: 'unbound-hmi-object',
        severity: 'warning',
        objectId: widget.id,
        source: 'hmi',
        message: `A ${widget.type} on ${screen.name} carries no tag`,
        details: 'It draws as a process object and is connected to no engineering identity, so nothing can produce a value or a state for it.',
        suggestedAction: 'Bind it to a tag, or delete it if it is decoration.',
        location: { kind: 'hmi-widget', screenId: screen.id, widgetId: widget.id },
      })
      continue
    }

    if (CONTROL_WIDGETS.has(widget.type)) {
      const raw = widget.props?.signal
      const ref = typeof raw === 'string' ? raw.trim() : ''
      if (ref === '') {
        out.push({
          id: `unbound-hmi-object:no-signal:${screen.id}/${widget.id}`,
          category: 'unbound-hmi-object',
          ruleId: 'unbound-hmi-object',
          severity: 'warning',
          objectId: widget.id,
          source: 'hmi',
          message: `A ${widget.type} on ${screen.name} writes to no signal`,
          details: 'The control renders and responds to a click. Nothing in the plant changes.',
          suggestedAction: 'Bind it to a signal, or delete it.',
          location: { kind: 'hmi-widget', screenId: screen.id, widgetId: widget.id },
        })
        continue
      }
      const dot = ref.lastIndexOf('.')
      const tag = dot > 0 ? ref.slice(0, dot) : ref
      // A tag no widget defines has no runtime object: the write lands in a
      // value nothing reads. A tag that is simply not DRAWN is `missing-tag`'s
      // finding, reported there and not repeated here.
      if (!ctx.defs[tag] && ctx.ix.liveKeys.has(tag)) {
        out.push({
          id: `unbound-hmi-object:dead-signal:${screen.id}/${widget.id}`,
          category: 'unbound-hmi-object',
          ruleId: 'unbound-hmi-object',
          severity: 'error',
          tag,
          objectId: widget.id,
          source: 'hmi',
          message: `A ${widget.type} on ${screen.name} writes ${ref}, and no runtime object carries ${tag}`,
          details: `${tag} is drawn on a sheet but nothing on any screen makes it part of the running plant, so the write has no destination.`,
          suggestedAction: `Place ${tag} on a screen, or bind the control to a signal the plant serves.`,
          location: { kind: 'hmi-widget', screenId: screen.id, widgetId: widget.id },
        })
      }
    }
  }

  // Trend pens naming a tag no runtime object carries. The pen draws an empty
  // line for ever with a legend that looks exactly like the others.
  for (const { screen, widget } of ctx.placed) {
    widget.pens?.forEach((pen, i) => {
      const dot = pen.ref.lastIndexOf('.')
      if (dot <= 0) return
      const tag = pen.ref.slice(0, dot)
      if (ctx.defs[tag] || !ctx.ix.liveKeys.has(tag)) return
      out.push({
        id: `unbound-hmi-object:dead-pen:${screen.id}/${widget.id}/${i}`,
        category: 'unbound-hmi-object',
        ruleId: 'unbound-hmi-object',
        severity: 'warning',
        tag,
        objectId: widget.id,
        source: 'hmi',
        message: `A trend pen on ${screen.name} plots ${pen.ref}, and no runtime object carries ${tag}`,
        details: `${tag} is drawn on a sheet but is on no screen, so the plant never records it. The pen draws nothing, with a legend that reads like the others.`,
        suggestedAction: `Place ${tag} on a screen so it is recorded, or remove the pen.`,
        location: { kind: 'hmi-widget', screenId: screen.id, widgetId: widget.id },
      })
    })
  }

  return out
}

// ── The report ──────────────────────────────────────────────────────────────

const DETECTORS: ((ctx: Ctx) => DiagnosticFinding[])[] = [
  missingTag,
  brokenConnection,
  missingInstrument,
  invalidRange,
  invalidUnit,
  missingSimulationModel,
  unboundHmiObject,
]

const emptyByCategory = (): Record<DiagnosticCategory, number> =>
  Object.fromEntries(DIAGNOSTIC_CATEGORIES.map((c) => [c, 0])) as Record<DiagnosticCategory, number>

/**
 * Every engineering diagnostic for one project state.
 *
 * A detector that throws is contained exactly as `validate/engine.ts` contains
 * a rule that throws: one bad edge case must never hide the other six
 * categories. It is reported against itself instead.
 */
export function diagnose(ix: ProjectIndex): DiagnosticReport {
  const ctx = buildCtx(ix)
  const findings: DiagnosticFinding[] = []
  for (const detect of DETECTORS) {
    try {
      findings.push(...detect(ctx))
    } catch (err) {
      findings.push({
        id: `diagnostics-engine:${detect.name}`,
        category: 'missing-tag',
        ruleId: 'diagnostics-engine',
        severity: 'error',
        source: 'simulation',
        message: `The ${detect.name} diagnostic could not run: ${err instanceof Error ? err.message : String(err)}`,
        suggestedAction: 'Report this — the other categories still ran.',
        location: { kind: 'record' },
      })
    }
  }

  const sorted = sortFindings(findings)
  const counts: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 }
  const byCategory = emptyByCategory()
  for (const f of sorted) {
    counts[f.severity] += 1
    byCategory[f.category] += 1
  }
  return { findings: sorted, counts, byCategory, total: sorted.length }
}

/**
 * One report per index, however many surfaces ask.
 *
 * The same cache shape `validate/engine.ts` uses, and for the same reason:
 * the Checks rules, the Diagnostics page and the reconciliation view all want
 * this, and compiling the simulation model three times per document would be
 * three times the work for one answer.
 */
let cache: { ix: ProjectIndex; value: DiagnosticReport } | null = null

export function diagnosticsFor(ix: ProjectIndex): DiagnosticReport {
  if (cache && cache.ix === ix) return cache.value
  const value = diagnose(ix)
  cache = { ix, value }
  return value
}

/** Test seam — the cache would otherwise leak between cases. */
export function resetDiagnosticsCache(): void {
  cache = null
}
