// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { navigateWorkspace } from '../routes'
import ImportPreview from '../panels/ImportPreview'
import { buildChangeSet, parseCsv } from '../model/bulkEdit'
import type { ChangeSet } from '../model/bulkEdit'
import { locateCell } from '../canvas/locate'
import { matches } from '../shortcuts/registry'
import { requiredFor, standardOf } from '../model/standard'
import { UNIT_FIELD, areaLabel, buildHierarchy, unitLabel } from '../model/hierarchy'
import UnitPicker from '../panels/UnitPicker'
import {
  EQUIPMENT_LIST_SPEC,
  ENGINEERING_SPEC,
  INSTRUMENT_INDEX_SPEC,
  IO_LIST_SPEC,
  LINE_LIST_SPEC,
  VALVE_LIST_SPEC,
  downloadEquipmentList,
  downloadEngineeringData,
  downloadInstrumentIndex,
  downloadIoList,
  downloadLineList,
  downloadValveList,
  equipmentListRows,
  instrumentIndexRows,
  ioListReport,
  lineListRows,
  valveListRows,
  type ReportColumn,
  type ReportRow,
  LOOP_LIST_SPEC,
  loopListRows,
  downloadLoopList,
} from '../export/csv'

type Tab = 'instruments' | 'io' | 'lines' | 'equipment' | 'valves' | 'loops'

interface Report {
  label: string
  columns: ReportColumn[]
  rows: ReportRow[]
  download(): void
  empty: string
  /** Shown above the table when the report deliberately left rows out, so an
   *  exclusion never reads as an omission. */
  note?: string
}

const TABS: Tab[] = ['instruments', 'io', 'lines', 'equipment', 'valves', 'loops']

/** Which cell is open for editing. One at a time — a table where every cell is
 *  a live input costs thousands of DOM nodes and invites edits nobody meant. */
interface EditTarget {
  rowId: string
  col: number
}

/** A cell's identity for the modified-marker set. NUL as the separator,
 *  written as an escape so this file stays plain text: a record key is
 *  user-supplied (a line number is whatever they typed) and could otherwise
 *  collide with a field key across the join. */
const cellId = (recordKey: string, field: string) => `${recordKey}\u0000${field}`

/**
 * The engineering data workspace: the four generated reports, and the place
 * to fill them in.
 *
 * These are the SAME rows the CSV writers emit, from the same registry, so
 * what you read here is what ships — the screen and the deliverable cannot
 * disagree, because there is only one of them.
 *
 * EDITING WRITES STRAIGHT TO THE REGISTRY, through the same `setRecordField`
 * action the property panel's Engineering tab uses. There is no table state
 * holding engineering values, no draft buffer that has to be flushed, and no
 * second copy to reconcile: a committed edit IS the record, and every report,
 * export, datasheet and QA rule sees it on the next read. The only local state
 * here is which cell is open and what is currently typed in it.
 *
 * Two rules decide what may be edited:
 *   - Only columns the report marks as engineering fields (`ReportColumn.field`).
 *     A tag, a symbol name, what a line connects to — those are decided on the
 *     drawing, and the table shows them read-only.
 *   - Only rows with a registry key. An untagged pump still appears, because
 *     leaving it out would under-report the plant, but it has nowhere to hang
 *     a record until it is tagged.
 *
 * All four reports are built in ONE memo keyed on the document. Each walks
 * every sheet, and the header needs a count for every tab whether or not it is
 * open — computing them in render walked the whole project seven times per
 * keystroke.
 */
export default function DataWorkspace() {
  const doc = useStore((s) => s.doc)
  const [tab, setTab] = useState<Tab>('instruments')
  const [edit, setEdit] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState('')
  /** Cells changed since this workspace was opened, for the modified marker.
   *  UI state: it describes this session's work, not the document. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  /** Sort and filter are VIEW state: they never reorder or hide anything in
   *  the document, and the CSV export always writes the report's own order so
   *  a file cannot inherit whatever the screen happened to be sorted by. */
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDesc, setSortDesc] = useState(false)
  const [query, setQuery] = useState('')
  /** Area and Unit filters, by stable id. `__none` is the explicit "nothing
   *  assigned" bucket — the rows an engineer most needs to find. */
  const [areaFilter, setAreaFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [importing, setImporting] = useState<{ changes: ChangeSet; source: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reports = useMemo<Record<Tab, Report>>(
    () => ({
      instruments: {
        label: 'Instrument index',
        columns: INSTRUMENT_INDEX_SPEC,
        rows: instrumentIndexRows(doc),
        download: downloadInstrumentIndex,
        empty: 'No tagged instruments yet. Tag a symbol on the drawing and it appears here.',
      },
      io: ((): Report => {
        const { rows, excluded } = ioListReport(doc)
        return {
          label: 'I/O list',
          columns: IO_LIST_SPEC,
          rows,
          download: downloadIoList,
          empty: 'No signals to list yet. An instrument appears here once it carries a tag and a signal line — a local gauge with no wiring is deliberately left out.',
          ...(excluded > 0
            ? {
                note: `${excluded} tagged object${excluded === 1 ? ' is' : 's are'} not I/O points — a local gauge, a relief valve or a control-system function has no field wiring of its own.`,
              }
            : {}),
        }
      })(),
      lines: {
        label: 'Line list',
        columns: LINE_LIST_SPEC,
        rows: lineListRows(doc),
        download: downloadLineList,
        empty: 'No process piping drawn yet. Every connected run of pipe appears here once one is drawn — numbered or not.',
      },
      equipment: {
        label: 'Equipment list',
        columns: EQUIPMENT_LIST_SPEC,
        rows: equipmentListRows(doc),
        download: downloadEquipmentList,
        empty: 'No equipment on the drawing yet. Place a pump, vessel or exchanger and it appears here — tagged or not.',
      },
      // READ-ONLY, and it needs no switch to make it so: every column is
      // derived, so none carries a `field`, so `editableAt` returns null for
      // every cell. A Loop is not an EngineeringRecord and there is nowhere
      // for an edit to go.
      loops: {
        label: 'Loop list',
        columns: LOOP_LIST_SPEC,
        rows: loopListRows(doc),
        download: downloadLoopList,
        empty: 'No loops declared yet. A loop is an engineering entity with a type and a number — declare one under Loops on the toolbar, or adopt what the tag numbers already imply.',
      },
      valves: {
        label: 'Valve list',
        columns: VALVE_LIST_SPEC,
        rows: valveListRows(doc),
        download: downloadValveList,
        empty: 'No valves on the drawing yet. Place one and it appears here — tagged or not.',
      },
    }),
    [doc],
  )

  const active = reports[tab]

  /** Field keys the active company standard demands for this kind of object.
   *  The same list the `required-field-empty` rule reads, so the table and the
   *  QA report cannot disagree about what is missing. */
  const required = useMemo(() => {
    const kind = active.rows[0]?.recordKind
    return new Set(kind ? requiredFor(standardOf(doc), kind) : [])
  }, [doc, active])

  /** Areas and units, indexed once per document. A table that resolved a unit
   *  by scanning the array per cell is the quadratic mistake the reports in
   *  export/csv.ts already had to have taken out of them. */
  const hierarchy = useMemo(() => buildHierarchy(doc), [doc])
  const unitIdOf = (row: ReportRow): string | undefined =>
    row.recordKey ? doc.registry?.[row.recordKey]?.unitId : undefined

  // The input is mounted by the render that opens a cell, so focus has to
  // happen after it exists.
  useEffect(() => {
    if (edit) inputRef.current?.select()
  }, [edit])

  /**
   * Undo and redo, here.
   *
   * The canvas owns the global shortcut handler, and the canvas is UNMOUNTED
   * in this workspace (EditorRoot renders one workspace at a time) — so until
   * this existed, Ctrl+Z did nothing on the screen where a CSV import lands a
   * hundred changes at once. The model always made that one undo step; the
   * user simply had no way to press it without leaving the page first.
   *
   * Which keys these are still comes from `shortcuts/registry.ts`, so the
   * shortcut sheet and this cannot disagree. Typing in a cell is left alone,
   * exactly as the canvas handler leaves a text field alone.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return
      if (matches(e, 'edit.undo')) { e.preventDefault(); useStore.getState().undo() }
      else if (matches(e, 'edit.redo')) { e.preventDefault(); useStore.getState().redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** A TEXT-editable cell. A Unit column is deliberately not one: it is a
   *  reference picked from the declared hierarchy, so it renders its own
   *  control and is excluded from typing, from Enter-moves-down and from the
   *  commit path entirely. */
  const editableAt = (row: ReportRow, col: number): string | null => {
    const column = active.columns[col]
    if (!column || column.assign) return null
    return column.field && row.recordKey ? column.field : null
  }

  const open = (row: ReportRow, col: number) => {
    if (!editableAt(row, col)) return
    setEdit({ rowId: row.id, col })
    setDraft(row.cells[col] ?? '')
  }

  /**
   * Write the cell back to the registry, if it actually changed.
   *
   * The "if it changed" is what stops tabbing through a table from minting a
   * record for every object it passes, and from filling the undo stack with
   * edits nobody made.
   *
   * Note what is deliberately absent: the `pauseHistory`/`resumeHistory` pair
   * the property panel wraps its inputs in. That pair exists to collapse a
   * BURST of writes — one per keystroke on a controlled input — into a single
   * undo step. Here the typing is local until it is committed, so a cell is
   * already exactly one write, and pausing around it would record nothing at
   * all: zundo's `pause()` drops changes rather than merging them, so the edit
   * would silently become un-undoable.
   */
  const commit = (row: ReportRow, col: number, value: string) => {
    const field = editableAt(row, col)
    setEdit(null)
    if (!field || !row.recordKey) return
    if (value === (row.cells[col] ?? '')) return
    if (!row.recordKind) return
    useStore.getState().setRecordField(row.recordKey, row.recordKind, field, value)
    setTouched((prev) => new Set(prev).add(cellId(row.recordKey!, field)))
  }

  /** Enter moves down the column, which is how a column of ranges or materials
   *  actually gets filled in. Tab is left to the browser: the cells are in DOM
   *  order, so it already walks the row. */
  const openBelow = (col: number, fromRowId: string) => {
    const i = active.rows.findIndex((r) => r.id === fromRowId)
    for (let n = i + 1; n < active.rows.length; n++) {
      const next = active.rows[n]!
      if (editableAt(next, col)) {
        open(next, col)
        return
      }
    }
  }

  /** What the table shows: the report's rows, filtered and sorted for reading.
   *  `active.rows` stays the authority for export and for Enter-moves-down. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let filtered = q ? active.rows.filter((r) => r.cells.some((c) => c.toLowerCase().includes(q))) : active.rows
    if (areaFilter || unitFilter) {
      filtered = filtered.filter((r) => {
        const unitId = r.recordKey ? doc.registry?.[r.recordKey]?.unitId : undefined
        if (unitFilter) return unitFilter === '__none' ? !unitId : unitId === unitFilter
        const unit = unitId ? hierarchy.unitById.get(unitId) : undefined
        return areaFilter === '__none' ? !unit : unit?.areaId === areaFilter
      })
    }
    if (sortCol === null) return filtered
    const dir = sortDesc ? -1 : 1
    return [...filtered].sort((a, b) => {
      const av = a.cells[sortCol] ?? ''
      const bv = b.cells[sortCol] ?? ''
      const an = Number(av)
      const bn = Number(bv)
      // Numbers sort as numbers where both sides are one; everything else is
      // compared as text, so a column of ranges does not shuffle randomly.
      if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir
      return av.localeCompare(bv) * dir
    })
  }, [active.rows, query, sortCol, sortDesc, areaFilter, unitFilter, doc.registry, hierarchy])

  const toggleSort = (col: number) => {
    if (sortCol === col) {
      if (sortDesc) { setSortCol(null); setSortDesc(false) } else setSortDesc(true)
    } else { setSortCol(col); setSortDesc(false) }
  }

  /** A file becomes a CHANGE SET, never a mutation. The dialog applies it. */
  const readFile = async (file: File) => {
    const text = await file.text()
    const doc = useStore.getState().doc
    setImporting({ changes: buildChangeSet(doc, parseCsv(text), ENGINEERING_SPEC), source: file.name })
  }

  // Invariant: every row in every report is a jump, never just text.
  const jump = (r: ReportRow) => {
    navigateWorkspace('draw')
    locateCell(r.id, r.sheetId)
  }

  const switchTab = (t: Tab) => {
    setEdit(null)
    setTab(t)
  }

  return (
    <div className="ws">
      <header className="ws-head">
        <h1>Data</h1>
        <div className="ws-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              data-testid={`data-tab-${t}`}
              className={tab === t ? 'on' : ''}
              onClick={() => switchTab(t)}
            >
              {reports[t].label} <span className="ws-count">{reports[t].rows.length}</span>
            </button>
          ))}
        </div>
        <span className="ws-sp" />
        <input
          className="ws-filter"
          data-testid="data-filter"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hierarchy.areas.length > 0 && (
          <>
            <select
              className="ws-filter-sel"
              data-testid="data-filter-area"
              aria-label="Filter by area"
              value={areaFilter}
              onChange={(e) => { setAreaFilter(e.target.value); setUnitFilter('') }}
            >
              <option value="">All areas</option>
              {hierarchy.areas.map((a) => <option key={a.id} value={a.id}>{areaLabel(a)}</option>)}
              <option value="__none">Not assigned</option>
            </select>
            <select
              className="ws-filter-sel"
              data-testid="data-filter-unit"
              aria-label="Filter by unit"
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
            >
              <option value="">All units</option>
              {/* Narrowed by the chosen area, because two areas may each hold a
                  unit numbered 101 and a flat list of codes could not tell them
                  apart. */}
              {(areaFilter && areaFilter !== '__none'
                ? hierarchy.unitsByArea.get(areaFilter) ?? []
                : hierarchy.units
              ).map((u) => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
              <option value="__none">Not assigned</option>
            </select>
          </>
        )}
        <button data-testid="data-export" onClick={() => active.download()}>
          Export CSV
        </button>
        <button data-testid="data-export-engineering" onClick={() => downloadEngineeringData()}>
          Export for editing
        </button>
        <button data-testid="data-import" onClick={() => fileRef.current?.click()}>
          Import CSV…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="ws-file"
          data-testid="data-import-file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = '' // so choosing the same file twice still fires
            if (f) void readFile(f)
          }}
        />
      </header>
      {importing && (
        <ImportPreview
          changes={importing.changes}
          source={importing.source}
          onClose={() => setImporting(null)}
        />
      )}

      <div className="ws-body">
        {active.rows.length === 0 ? (
          <p className="ws-empty">{active.empty}</p>
        ) : (
          <>
            {active.note && <p className="ws-note ws-note-excluded" data-testid="data-excluded">{active.note}</p>}
            <p className="ws-note">
              Engineering values are editable — click a cell, or Tab into it. Enter saves and moves down;
              Esc cancels. Unit is picked from the areas and units this project has declared, and Area
              follows it. Tags, symbols and connections come from the drawing and are shown read-only.
            </p>
            <div className="ws-table-wrap">
              <table className="ws-table" data-testid={`data-table-${tab}`}>
                <thead>
                  <tr>
                    {active.columns.map((c) => (
                      <th
                        key={c.label}
                        className={c.field ? 'ws-th-edit' : undefined}
                        aria-sort={sortCol === active.columns.indexOf(c) ? (sortDesc ? 'descending' : 'ascending') : 'none'}
                      >
                        <button
                          className="ws-sort"
                          data-testid={`data-sort-${c.label}`}
                          onClick={() => toggleSort(active.columns.indexOf(c))}
                        >
                          {c.label}
                          {sortCol === active.columns.indexOf(c) && <span aria-hidden>{sortDesc ? ' ▾' : ' ▴'}</span>}
                        </button>
                        {(c.field ?? (c.assign === 'unit' ? UNIT_FIELD : undefined)) &&
                          required.has(c.field ?? UNIT_FIELD) && (
                            <span className="ws-req" title="Required by the active standard"> *</span>
                          )}
                      </th>
                    ))}
                    <th aria-label="Go to the drawing" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      {r.cells.map((value, i) => {
                        const assign = active.columns[i]?.assign
                        // The Unit cell is a picker straight onto the record:
                        // what it writes is the stable id, and the code the
                        // column prints is only ever a label. Renaming a unit
                        // later cannot reinterpret an assignment made here.
                        if (assign === 'unit' && r.recordKey && r.recordKind) {
                          return (
                            <td key={i} className="ws-cell ws-cell-assign">
                              <UnitPicker
                                className="ws-cell-sel"
                                testId={`unit-${r.recordKey}`}
                                hierarchy={hierarchy}
                                value={unitIdOf(r)}
                                disabled={hierarchy.units.length === 0}
                                onChange={(unitId) => {
                                  useStore.getState().assignUnit(r.recordKey!, r.recordKind!, unitId)
                                  setTouched((prev) => new Set(prev).add(cellId(r.recordKey!, UNIT_FIELD)))
                                }}
                              />
                            </td>
                          )
                        }
                        const field = editableAt(r, i)
                        if (!field) {
                          return (
                            <td key={i} className={i === 0 ? 'ws-key' : undefined}>{value || '—'}</td>
                          )
                        }
                        const editing = edit?.rowId === r.id && edit.col === i
                        const modified = touched.has(cellId(r.recordKey!, field))
                        const missing = !value && required.has(field)
                        return (
                          <td key={i} className={`ws-cell${modified ? ' is-modified' : ''}${missing ? ' is-missing' : ''}`}>
                            {editing ? (
                              <input
                                ref={inputRef}
                                className="ws-cell-input"
                                data-testid={`cell-${r.recordKey}-${field}`}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onBlur={() => commit(r, i, draft)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    commit(r, i, draft)
                                    openBelow(i, r.id)
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault()
                                    setEdit(null)
                                  }
                                }}
                              />
                            ) : (
                              // A button, so the cell is in the Tab order and
                              // reachable by keyboard without a roving-tabindex
                              // grid. Focus opens it, which is what makes
                              // Tab-and-type work down a column.
                              <button
                                type="button"
                                className="ws-cell-btn"
                                data-testid={`cell-${r.recordKey}-${field}`}
                                title={value || 'Empty'}
                                onFocus={() => open(r, i)}
                                onClick={() => open(r, i)}
                              >
                                {value || <span className="ws-cell-empty">—</span>}
                              </button>
                            )}
                          </td>
                        )
                      })}
                      <td className="ws-jump">
                        <button title="Show this on the drawing" onClick={() => jump(r)}>Locate</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
