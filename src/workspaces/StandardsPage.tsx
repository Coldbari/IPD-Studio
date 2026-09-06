// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { navigateWorkspace } from '../routes'
import {
  DEFAULT_STANDARD,
  LINE_NUMBER_PARTS,
  LINE_PART_LABELS,
  standardOf,
  type LineNumberPart,
  type RuleSeverityOverride,
  type StandardProfile,
} from '../model/standard'
import { FIELD_CATALOG, labelForField } from '../model/fields'
import type { EntityKind } from '../model/registry'
import { ALL_RULES } from '../validate/rules/index'
import { previewStandard } from '../validate/impact'
import { downloadStandard, parseStandardFile } from '../persist/standard'
import type { ProfileProblem } from '../model/standard'
import './standards.css'

const KINDS: { id: EntityKind; label: string }[] = [
  { id: 'instrument', label: 'Instruments' },
  { id: 'valve', label: 'Valves' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'line', label: 'Lines' },
]

const SEVERITY_CHOICES: { value: RuleSeverityOverride | 'default'; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'off', label: 'Off' },
]

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The company standard, as a settings page rather than a modal.
 *
 * The load-bearing element here is the impact panel, not the form. Nobody
 * switches a new convention on over a live project on faith — the first
 * question is always "how much does this light up?", and a checker that cannot
 * answer it gets turned on once, floods the report, and is turned off for good.
 * So every edit below recomputes the real QA report against the draft and says
 * exactly what would appear and what would go quiet, before Apply is pressed.
 *
 * Nothing here ever rewrites the drawing. Adopting a standard changes what is
 * REPORTED, never a tag, a line number or a record — renaming an engineering
 * identity is a decision an engineer makes one object at a time.
 */
export default function StandardsPage() {
  const doc = useStore((s) => s.doc)
  const setStandard = useStore((s) => s.setStandard)
  const active = standardOf(doc)

  const [draft, setDraft] = useState<StandardProfile>(active)
  const [problems, setProblems] = useState<ProfileProblem[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // Re-seed when the project's standard changes underneath us — an undo, a
  // different file opened, or a standard imported in another tab.
  useEffect(() => setDraft(active), [active])

  const dirty = !same(draft, active)

  // Only while there is something to compare. Running the engine twice on every
  // render of an unchanged page would be pure cost on a large project.
  const impact = useMemo(
    () => (dirty ? previewStandard(doc, draft, active) : null),
    [dirty, doc, draft, active],
  )

  const patch = (p: Partial<StandardProfile>) => setDraft((d) => ({ ...d, ...p }))
  const patchTag = (p: Partial<StandardProfile['tagFormat']>) =>
    setDraft((d) => ({ ...d, tagFormat: { ...d.tagFormat, ...p } }))
  const patchLine = (p: Partial<StandardProfile['lineNumber']>) =>
    setDraft((d) => ({ ...d, lineNumber: { ...d.lineNumber, ...p } }))
  const patchConv = (p: Partial<StandardProfile['conventions']>) =>
    setDraft((d) => ({ ...d, conventions: { ...d.conventions, ...p } }))

  function toggleRequired(kind: EntityKind, key: string) {
    setDraft((d) => {
      const current = d.required[kind] ?? []
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
      return { ...d, required: { ...d.required, [kind]: next } }
    })
  }

  function moveLinePart(part: LineNumberPart, by: -1 | 1) {
    setDraft((d) => {
      const order = [...d.lineNumber.order]
      const i = order.indexOf(part)
      const j = i + by
      if (i < 0 || j < 0 || j >= order.length) return d
      ;[order[i], order[j]] = [order[j]!, order[i]!]
      return { ...d, lineNumber: { ...d.lineNumber, order } }
    })
  }

  function toggleLinePart(part: LineNumberPart) {
    setDraft((d) => {
      const has = d.lineNumber.order.includes(part)
      const order = has
        ? d.lineNumber.order.filter((p) => p !== part)
        : [...d.lineNumber.order, part]
      return { ...d, lineNumber: { ...d.lineNumber, order } }
    })
  }

  function setSeverity(ruleId: string, value: RuleSeverityOverride | 'default') {
    setDraft((d) => {
      const overrides = { ...(d.severityOverrides ?? {}) }
      if (value === 'default') delete overrides[ruleId]
      else overrides[ruleId] = value
      const next = { ...d }
      if (Object.keys(overrides).length) next.severityOverrides = overrides
      else delete next.severityOverrides
      return next
    })
  }

  async function onImport(file: File) {
    const result = parseStandardFile(await file.text())
    if (result.ok) {
      setProblems([])
      setDraft(result.profile)
    } else {
      setProblems(result.problems)
    }
  }

  const byDiscipline = useMemo(() => {
    const map = new Map<string, typeof ALL_RULES>()
    for (const rule of ALL_RULES) {
      const list = map.get(rule.discipline) ?? []
      list.push(rule)
      map.set(rule.discipline, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [])

  return (
    <div className="ws">
      <header className="ws-head">
        <h1>Standards</h1>
        <span className="std-sub">
          {doc.standard ? `This project follows “${active.name}”` : 'This project follows the built-in default'}
        </span>
        <span className="ws-sp" />
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <button onClick={() => downloadStandard(draft)}>Export</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void onImport(file)
          }}
        />
      </header>

      <div className="ws-body std-body">
        {problems.length > 0 && (
          <div className="std-problems" role="alert">
            <strong>That file could not be used.</strong>
            <ul>
              {problems.map((p, i) => (
                <li key={i}><code>{p.field}</code> — {p.message}</li>
              ))}
            </ul>
          </div>
        )}

        <ImpactPanel
          dirty={dirty}
          impact={impact}
          onApply={() => setStandard(same(draft, DEFAULT_STANDARD) ? undefined : draft)}
          onRevert={() => setDraft(active)}
        />

        <section className="std-card">
          <h2>Identity</h2>
          <label className="std-row">
            <span>Standard name</span>
            <input
              value={draft.name}
              maxLength={120}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Acme Engineering — Rev 3"
            />
          </label>
        </section>

        <section className="std-card">
          <h2>Tag format</h2>
          <label className="std-row">
            <span>Pattern</span>
            <select value={draft.tagFormat.pattern} onChange={(e) => patchTag({ pattern: e.target.value as 'LL-NNN' | 'LL-NNNA' })}>
              <option value="LL-NNN">LL-NNN — FT-101</option>
              <option value="LL-NNNA">LL-NNNA — FT-101A (suffix allowed)</option>
            </select>
          </label>
          <label className="std-row">
            <span>Separator</span>
            <select value={draft.tagFormat.separator} onChange={(e) => patchTag({ separator: e.target.value as '-' | '' })}>
              <option value="-">Hyphen — FT-101</option>
              <option value="">None — FT101</option>
            </select>
          </label>
          <label className="std-row">
            <span>Loop number digits</span>
            <select value={draft.tagFormat.digits} onChange={(e) => patchTag({ digits: Number(e.target.value) as 3 | 4 })}>
              <option value={3}>3 — FT-101</option>
              <option value={4}>4 — FT-0101</option>
            </select>
          </label>
          <label className="std-row">
            <span>Auto-numbering starts at</span>
            <select value={draft.tagFormat.numberStart} onChange={(e) => patchTag({ numberStart: Number(e.target.value) as 100 | 1 })}>
              <option value={100}>100</option>
              <option value={1}>1</option>
            </select>
          </label>
          <p className="std-note">
            Changing this never renames anything. Tags that do not match are reported so you can decide
            object by object.
          </p>
        </section>

        <section className="std-card">
          <h2>Line numbering</h2>
          <p className="std-note">The order these appear in a line number, top first.</p>
          <ol className="std-order">
            {draft.lineNumber.order.map((part, i) => (
              <li key={part}>
                <span className="std-order-name">{LINE_PART_LABELS[part]}</span>
                <button type="button" disabled={i === 0} title="Move earlier" onClick={() => moveLinePart(part, -1)}>↑</button>
                <button
                  type="button"
                  disabled={i === draft.lineNumber.order.length - 1}
                  title="Move later"
                  onClick={() => moveLinePart(part, 1)}
                >↓</button>
                <button type="button" title="Do not require this component" onClick={() => toggleLinePart(part)}>Remove</button>
              </li>
            ))}
          </ol>
          {LINE_NUMBER_PARTS.filter((p) => !draft.lineNumber.order.includes(p)).length > 0 && (
            <div className="std-chips">
              {LINE_NUMBER_PARTS.filter((p) => !draft.lineNumber.order.includes(p)).map((p) => (
                <button key={p} type="button" className="std-chip add" onClick={() => toggleLinePart(p)}>
                  + {LINE_PART_LABELS[p]}
                </button>
              ))}
            </div>
          )}
          <label className="std-row">
            <span>Separator</span>
            <input value={draft.lineNumber.separator} maxLength={3} onChange={(e) => patchLine({ separator: e.target.value })} />
          </label>
          <label className="std-row">
            <span>Size unit</span>
            <select value={draft.lineNumber.sizeUnit} onChange={(e) => patchLine({ sizeUnit: e.target.value as 'in' | 'DN' })}>
              <option value="in">Inches</option>
              <option value="DN">DN</option>
            </select>
          </label>
        </section>

        <section className="std-card">
          <h2>Required data</h2>
          <p className="std-note">
            What an object must carry before its record is usable. These are the fields a datasheet, an
            I/O list or a purchase enquiry cannot be produced without.
          </p>
          {KINDS.map(({ id, label }) => (
            <div key={id} className="std-kind">
              <h3>{label}</h3>
              <div className="std-fields">
                {FIELD_CATALOG[id].flatMap((section) => section.fields).map((f) => {
                  const on = (draft.required[id] ?? []).includes(f.key)
                  return (
                    <label key={f.key} className={`std-field${on ? ' on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleRequired(id, f.key)} />
                      {labelForField(f.key)}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="std-card">
          <h2>Conventions</h2>
          <label className="std-row">
            <span>Valve fail position</span>
            <select
              value={draft.conventions.valveFailPosition}
              onChange={(e) => patchConv({ valveFailPosition: e.target.value as 'required' | 'optional' })}
            >
              <option value="required">Required on the P&amp;ID</option>
              <option value="optional">Recorded on the datasheet only</option>
            </select>
          </label>
          <label className="std-row">
            <span>Default signal</span>
            <input value={draft.conventions.defaultSignal} onChange={(e) => patchConv({ defaultSignal: e.target.value })} />
          </label>
        </section>

        <section className="std-card">
          <h2>Checks</h2>
          <p className="std-note">
            Force a check to another severity, or switch it off. Off removes it from the report entirely —
            use it for a rule your house genuinely does not apply, not to hide a finding you have not dealt
            with. A single finding can be accepted with a reason from the Checks screen instead.
          </p>
          {byDiscipline.map(([discipline, rules]) => (
            <div key={discipline} className="std-kind">
              <h3>{discipline}</h3>
              {rules.map((rule) => (
                <label key={rule.id} className="std-row std-rule">
                  <span title={rule.why}>{rule.title}</span>
                  <select
                    value={draft.severityOverrides?.[rule.id] ?? 'default'}
                    onChange={(e) => setSeverity(rule.id, e.target.value as RuleSeverityOverride | 'default')}
                  >
                    {SEVERITY_CHOICES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value === 'default' ? `Default (${rule.severity})` : c.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function ImpactPanel({
  dirty,
  impact,
  onApply,
  onRevert,
}: {
  dirty: boolean
  impact: ReturnType<typeof previewStandard> | null
  onApply: () => void
  onRevert: () => void
}) {
  if (!dirty || !impact) {
    return (
      <div className="std-impact quiet">
        <span>No unsaved changes. The report on the Checks screen reflects this standard.</span>
      </div>
    )
  }

  const nothing = impact.added.length === 0 && impact.removed.length === 0
    && impact.totalBefore === impact.totalAfter

  return (
    <div className="std-impact" role="status">
      <div className="std-impact-head">
        <strong>If you apply this</strong>
        <span className="ws-sp" />
        <button onClick={onRevert}>Revert</button>
        <button className="primary" onClick={onApply}>Apply to this project</button>
      </div>

      {nothing ? (
        <p className="std-impact-line">Nothing on this drawing would be reported differently.</p>
      ) : (
        <>
          <p className="std-impact-line">
            {impact.added.length > 0 && (
              <span className="std-delta up">+{impact.added.length} new finding{impact.added.length === 1 ? '' : 's'}</span>
            )}
            {impact.removed.length > 0 && (
              <span className="std-delta down">−{impact.removed.length} silenced</span>
            )}
            <span className="std-total">
              {impact.totalBefore} → {impact.totalAfter} total
            </span>
          </p>
          <ul className="std-impact-rules">
            {impact.byRule.map((d) => (
              <li key={d.rule.id}>
                <span className="std-impact-rule">{d.rule.title}</span>
                {d.added > 0 && <span className="std-delta up">+{d.added}</span>}
                {d.removed > 0 && <span className="std-delta down">−{d.removed}</span>}
              </li>
            ))}
          </ul>
          <p className="std-note">
            Applying changes what is reported. It never edits a tag, a line number or a record —{' '}
            <button className="std-link" onClick={() => navigateWorkspace('checks')}>open the Checks screen</button>{' '}
            to work through what it finds.
          </p>
        </>
      )}
    </div>
  )
}
