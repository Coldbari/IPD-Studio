// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import { getSymbol } from '../symbols/registry'
import { portLabels } from '../symbols/portLabels'
import { activeSheet, pauseHistory, resumeHistory, useStore } from '../store/store'
import type { LineClass, PlantEdge, PlantNode, SheetSize } from '../model/types'
import { isPortEnd } from '../model/types'
import { LINE_CLASS_LABELS } from '../canvas/lineStyle'
import TagEditor from './TagEditor'
import { placeTypicalAtCenter } from '../canvas/dropHandling'
import { loadDoc } from '../model/migrate'
import samplePlant from '../../examples/sample-plant.pnid.json'
import { applyAlignment, duplicateSelection } from '../canvas/interactions'
import { nextLineSeq } from '../isa/autonumber'
import { DEFAULT_PRICES, priceKeyFor, unitCost } from '../model/costs'
import { currencyOf, money, toDisplay, toUsd } from '../model/currency'
import DatasheetEditor from './DatasheetEditor'
import RevisionsDialog from './RevisionsDialog'
import { currentRevisionCode, revisionsOf } from '../model/revision'
import FluidsDialog from './FluidsDialog'
import InspectorWhereUsed from './InspectorWhereUsed'
import InspectorEngineering from './InspectorEngineering'
import { locateCell } from '../canvas/locate'
import { focusCanvas } from '../canvas/keyboardNav'
import { hint } from '../shortcuts/registry'
import { buildIndex } from '../model/projectIndex'
import { runConflicts, runEnds } from '../model/run'
import { formatTag } from '../isa/tag'
import { showStatus } from '../feedback/notices'

const SHEETS: SheetSize[] = ['A4', 'A3', 'A2', 'A1', 'ANSI_B', 'ANSI_D']

function SheetProps() {
  const meta = useStore((s) => s.doc.meta)
  const sheet = useStore((s) => activeSheet(s))
  const numberStart = useStore((s) => s.doc.settings.numberStart ?? 100)
  const setMeta = useStore((s) => s.setMeta)
  const setSettings = useStore((s) => s.setSettings)
  const setSheetMeta = useStore((s) => s.setSheetMeta)
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  return (
    <>
      <div className="prop-title">Project</div>
      <label className="prop-field">Name<input value={meta.name} onChange={(e) => { setMeta({ name: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">Author<input value={meta.author} onChange={(e) => { setMeta({ author: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      {/* The controlled-document fields. Every one is optional and every one
          prints in the title block when it is filled in — an empty field
          prints an em dash rather than anything invented. They live on the
          PROJECT because none of them changes between sheet 2 and sheet 3. */}
      <label className="prop-field">Client<input data-testid="meta-client" value={meta.client ?? ''} onChange={(e) => { setMeta({ client: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">Project №<input data-testid="meta-project-number" value={meta.projectNumber ?? ''} onChange={(e) => { setMeta({ projectNumber: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">Plant / facility<input data-testid="meta-plant" value={meta.plant ?? ''} onChange={(e) => { setMeta({ plant: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">Discipline<input data-testid="meta-discipline" value={meta.discipline ?? ''} onChange={(e) => { setMeta({ discipline: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">Document №<input data-testid="meta-document-number" value={meta.documentNumber ?? ''} placeholder="for the set" onChange={(e) => { setMeta({ documentNumber: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">Tag numbering starts at
        <select
          value={String(numberStart)}
          onChange={(e) => setSettings({ numberStart: e.target.value === '1' ? 1 : 100 })}
        >
          <option value="100">100, 101, 102…</option>
          <option value="1">001, 002, 003…</option>
        </select>
      </label>
      <div className="prop-title">{sheet.name}</div>
      <label className="prop-field">Drawing №<input value={sheet.drawingNumber} onChange={(e) => { setSheetMeta({ drawingNumber: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">Revision
        {/* Once a revision TABLE exists the code is the table's to set: an
            issue stamps it, and a box that disagrees with the history behind
            it is worse than no box. Before that, it stays the free label every
            pre-schema-6 drawing has always had. */}
        {revisionsOf(sheet).length > 0 ? (
          <input value={currentRevisionCode(sheet)} readOnly data-testid="sheet-revision-derived" />
        ) : (
          <input value={sheet.revision} onChange={(e) => { setSheetMeta({ revision: e.target.value }); pauseHistory() }} onBlur={resumeHistory} />
        )}
      </label>
      <button className="prop-btn" data-testid="open-revisions" onClick={() => setRevisionsOpen(true)}>
        Revisions{revisionsOf(sheet).length > 0 ? ` (${revisionsOf(sheet).length})` : ''}…
      </button>
      {revisionsOpen && <RevisionsDialog sheet={sheet} onClose={() => setRevisionsOpen(false)} />}
      <label className="prop-field">Sheet size
        <select value={sheet.sheetSize} onChange={(e) => setSheetMeta({ sheetSize: e.target.value as SheetSize })}>
          {SHEETS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </label>
    </>
  )
}

/**
 * What the inspector shows on a sheet with nothing on it yet.
 *
 * It used to show the project metadata form — name, author, tag numbering,
 * drawing number, revision, sheet size — permanently, in the most valuable
 * column on screen, to a person who has not yet drawn anything. That is
 * document setup answering a question nobody asked, at the one moment the
 * application has to say how to begin.
 *
 * Three ways in, and the two sentences the app never said out loud: how a
 * symbol gets onto the sheet, and how two symbols get connected. It is not a
 * tutorial — it is gone the instant the first symbol lands, and the project
 * fields are still right underneath it.
 */
function StartHere() {
  return (
    <div className="prop-start">
      <div className="prop-title">Start the drawing</div>
      <button
        className="start-act"
        onClick={() => window.dispatchEvent(new Event('pid:focus-symbols'))}
      >
        <b>Find a symbol</b>
        <span>Search the library — try “pump”, “gate valve”, “FIC”</span>
      </button>
      <button className="start-act" onClick={() => placeTypicalAtCenter('flow-control')}>
        <b>Place a flow control loop</b>
        <span>Five symbols, wired and tagged, as a starting point</span>
      </button>
      <button
        className="start-act"
        onClick={() => useStore.getState().loadIntoStore(loadDoc(samplePlant))}
      >
        <b>Open the sample plant</b>
        <span>A finished drawing to take apart</span>
      </button>
      <p className="prop-note prop-how">
        Symbols go on by <b>clicking</b> one in the palette, or <b>dragging</b> it where you
        want it. To connect two, hover a symbol to see its connection points and drag from
        one — or just drag a symbol until its point meets another, and the line is drawn
        for you.
      </p>
    </div>
  )
}

function OffPageLink({ node }: { node: PlantNode }) {
  const doc = useStore((s) => s.doc)
  const currentSheetId = useStore((s) => s.activeSheetId)
  const setNodeLink = useStore((s) => s.setNodeLink)
  const setActiveSheet = useStore((s) => s.setActiveSheet)
  const setSelection = useStore((s) => s.setSelection)
  const targetSheets = doc.sheets.filter((sh) => sh.id !== currentSheetId)
  const linkedSheet = node.link ? doc.sheets.find((sh) => sh.id === node.link!.sheetId) : undefined
  return (
    <div className="prop-group">
      <div className="prop-title">Linked To</div>
      <label className="prop-field">Sheet
        <select
          value={node.link?.sheetId ?? ''}
          onChange={(e) => {
            const sheetId = e.target.value
            if (!sheetId) setNodeLink(node.id, undefined)
            else setNodeLink(node.id, { sheetId, nodeId: '' })
          }}
        >
          <option value="">— not linked —</option>
          {targetSheets.map((sh) => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
        </select>
      </label>
      {linkedSheet && (
        <label className="prop-field">Connector
          <select
            value={node.link?.nodeId ?? ''}
            onChange={(e) => setNodeLink(node.id, { sheetId: linkedSheet.id, nodeId: e.target.value })}
          >
            <option value="">— pick —</option>
            {linkedSheet.nodes.filter((n) => n.symbolId === 'ann.offpage').map((n) => (
              <option key={n.id} value={n.id}>{n.label || n.id.slice(0, 8)}</option>
            ))}
          </select>
        </label>
      )}
      {node.link?.nodeId && (
        <button onClick={() => { setActiveSheet(node.link!.sheetId); setSelection([node.link!.nodeId]) }}>
          Go to linked connector
        </button>
      )}
    </div>
  )
}

const KIND_WORD = { process: 'process', signal: 'signal', both: 'either' } as const

/**
 * The symbol's connection points, by name.
 *
 * Behind a closed disclosure, because this is reference rather than an edit:
 * an engineer works on a symbol's tag and its config constantly and asks
 * "which nozzle have I not used yet" occasionally. A permanent eleven-row
 * table on a vertical vessel would push the tag off the top of the panel to
 * answer a question nobody asked.
 *
 * Read-only on purpose. Nothing here changes the drawing — connections are
 * made on the canvas, where you can see what you are joining.
 */
function ConnectionList({ node }: { node: PlantNode }) {
  // Mounted only while the disclosure is open, so a closed one puts no edge
  // subscription on the inspector — dragging a symbol must not re-render this.
  const edges = useStore((s) => activeSheet(s).edges)
  const def = getSymbol(node.symbolId)
  const labels = portLabels(node.symbolId, node.rotation)
  const used = new Set<string>()
  for (const e of edges) {
    for (const end of [e.source, e.target]) {
      if (isPortEnd(end) && end.nodeId === node.id) used.add(end.portId)
    }
  }
  return (
    <ul className="prop-ports">
      {def.ports.map((p) => (
        <li key={p.id} className={used.has(p.id) ? 'port-used' : ''}>
          <span className="port-name">{labels.get(p.id)?.text ?? p.id}</span>
          <span className="port-kind">{KIND_WORD[p.kind]}</span>
          <span className="port-state">{used.has(p.id) ? 'connected' : 'free'}</span>
        </li>
      ))}
    </ul>
  )
}

function Connections({ node }: { node: PlantNode }) {
  const [open, setOpen] = useState(false)
  const def = getSymbol(node.symbolId)
  if (!def.ports.length) return null
  return (
    <details
      className="prop-adv"
      data-testid="prop-ports"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>Connections ({def.ports.length})</summary>
      {open && <ConnectionList node={node} />}
    </details>
  )
}

function NodeProps({ node }: { node: PlantNode }) {
  const def = getSymbol(node.symbolId)
  const armPin = useStore((s) => s.armPin)
  const setArmPin = useStore((s) => s.setArmPin)
  const removeExtraPort = useStore((s) => s.removeExtraPort)
  const setNodeConfig = useStore((s) => s.setNodeConfig)
  const setLabel = useStore((s) => s.setLabel)
  const setLabelPos = useStore((s) => s.setLabelPos)
  const setTagOffset = useStore((s) => s.setTagOffset)
  const setLabelOffset = useStore((s) => s.setLabelOffset)
  const rotateNode = useStore((s) => s.rotateNode)
  const setNodeStretch = useStore((s) => s.setNodeStretch)
  const [datasheetOpen, setDatasheetOpen] = useState(false)
  const sx = node.scaleX ?? node.scale ?? 1
  const sy = node.scaleY ?? node.scale ?? 1
  return (
    <>
      <div className="prop-title">{def.name}</div>
      {def.configOptions &&
        Object.entries(def.configOptions).map(([key, values]) => (
          <label className="prop-field" key={key}>
            {key}
            <select
              value={node.config?.[key] ?? def.defaultConfig?.[key] ?? values[0]}
              onChange={(e) => setNodeConfig(node.id, { ...def.defaultConfig, ...node.config, [key]: e.target.value })}
            >
              {values.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        ))}
      {def.tagRule !== 'none' && <TagEditor node={node} />}
      {node.kind !== 'annotation' && <CostField node={node} />}
      {node.symbolId === 'ann.offpage' && <OffPageLink node={node} />}
      <label className="prop-field">Label
        <input value={node.label ?? ''} onChange={(e) => { setLabel(node.id, e.target.value); pauseHistory() }} onBlur={resumeHistory} placeholder="Service / name" />
      </label>
      {(node.label ?? '') !== '' && (
        <label className="prop-field">Label position
          <select
            title="Label position"
            value={node.labelPos ?? 'below'}
            onChange={(e) => setLabelPos(node.id, e.target.value as 'below' | 'center')}
          >
            <option value="below">below the symbol</option>
            <option value="center">inside, centered</option>
          </select>
        </label>
      )}
      <div className="prop-row">
        <button onClick={() => rotateNode(node.id)} title={hint('Rotate 90°', 'draw.rotate')}>Rotate 90°</button>
        <button onClick={duplicateSelection} title={hint('Duplicate', 'edit.duplicate')}>Duplicate</button>
        <span className="prop-hint">{node.rotation}°</span>
      </div>
      <div className="prop-row">
        <span className="prop-hint">Size</span>
        <button title="Smaller" disabled={sx <= 0.5 && sy <= 0.5} onClick={() => setNodeStretch(node.id, sx - 0.25, sy - 0.25)}>−</button>
        <span className="scale-value">{sx === sy ? `${sx}×` : `${sx}/${sy}×`}</span>
        <button title="Larger" disabled={sx >= 4 || sy >= 4} onClick={() => setNodeStretch(node.id, sx + 0.25, sy + 0.25)}>＋</button>
        {(sx !== 1 || sy !== 1) && <button title="Reset size" onClick={() => setNodeStretch(node.id, 1, 1)}>reset</button>}
      </div>
      {/* Per-axis stretch matters for a horizontal vessel and almost nothing
          else, but it cost two permanent rows and six buttons in front of
          every symbol's essential properties. Open when the symbol is already
          stretched, so nothing that has been used disappears. */}
      <details className="prop-adv" data-testid="prop-stretch" open={sx !== sy}>
        <summary>Stretch one axis</summary>
        <div className="prop-row">
          <span className="prop-hint">Width</span>
          <button title="Narrower" disabled={sx <= 0.5} onClick={() => setNodeStretch(node.id, sx - 0.25, sy)}>−</button>
          <span className="scale-value">{sx}×</span>
          <button title="Wider" disabled={sx >= 4} onClick={() => setNodeStretch(node.id, sx + 0.25, sy)}>＋</button>
        </div>
        <div className="prop-row">
          <span className="prop-hint">Height</span>
          <button title="Shorter" disabled={sy <= 0.5} onClick={() => setNodeStretch(node.id, sx, sy - 0.25)}>−</button>
          <span className="scale-value">{sy}×</span>
          <button title="Taller" disabled={sy >= 4} onClick={() => setNodeStretch(node.id, sx, sy + 0.25)}>＋</button>
        </div>
      </details>
      {node.kind !== 'annotation' && <Connections node={node} />}
      {node.kind !== 'annotation' && (
        <div className="prop-row">
          <span className="prop-hint">Pins</span>
          <button
            className={armPin === node.id ? 'arm-on' : ''}
            title="Add a connection pin: click this button, then click the spot on the symbol"
            onClick={() => setArmPin(armPin === node.id ? null : node.id)}
          >
            {armPin === node.id ? 'Click the symbol… (Esc cancels)' : '＋ Add pin'}
          </button>
        </div>
      )}
      {(node.extraPorts ?? []).map((p) => (
        <div className="prop-row" key={p.id}>
          <span className="prop-hint">{p.id} · ({p.x}, {p.y})</span>
          <button title="Remove this pin (its lines go with it)" onClick={() => removeExtraPort(node.id, p.id)}>✕</button>
        </div>
      ))}
      {(node.tagOffset || node.labelOffset) && (
        <div className="prop-row">
          <button onClick={() => { setTagOffset(node.id, undefined); setLabelOffset(node.id, undefined) }}>
            Reset text position
          </button>
        </div>
      )}
      {node.kind === 'instrument' && (
        <div className="prop-row">
          <button onClick={() => setDatasheetOpen(true)}>Datasheet…</button>
        </div>
      )}
      {/* Delete was offered for a multi-selection and not for a single one, so
          whether an object could be deleted from the inspector depended on how
          many friends it had. */}
      <div className="prop-row prop-destroy">
        <button className="prop-delete" title={hint('Delete this symbol and its lines', 'edit.delete')}
          onClick={() => useStore.getState().deleteSelected()}>
          Delete symbol
        </button>
      </div>
      {datasheetOpen && <DatasheetEditor node={node} onClose={() => setDatasheetOpen(false)} />}
    </>
  )
}

/**
 * RUN CONTEXT for the selected line.
 *
 * Everything here is DERIVED from `ProjectIndex` — the same runs the line list
 * prints and the same ones `duplicate-line-number` checks. Nothing about run
 * membership is stored on the edge, on the node or in the registry: a run is a
 * grouping, not an owner, and `runOfEdge` is how you look one up.
 *
 * It states no direction. `runEnds` returns extremities as a list because a
 * branched run has three, and nothing in the model says which way anything
 * flows — so the panel says "Ends", never "From / To".
 */
function RunSection({ edge }: { edge: PlantEdge }) {
  const doc = useStore((s) => s.doc)
  const applyToRun = useStore((s) => s.applyLineNumberToRun)
  // Memoised on the document, like the hierarchy in InspectorEngineering:
  // this panel re-renders on every keystroke in the fields below it.
  const ix = useMemo(() => buildIndex(doc), [doc])

  const runId = ix.runOfEdge.get(edge.id)
  const run = runId ? ix.runs.find((r) => r.id === runId) : undefined
  if (!run) {
    return (
      <div className="prop-group" data-testid="run-section">
        <div className="prop-title">Run</div>
        <p className="prop-hint">Only process and pipe lines belong to a run. A signal line is wired, not piped.</p>
      </div>
    )
  }

  const ends = runEnds(ix, run)
  const conflicts = runConflicts(ix, run)
  const sheet = ix.edges.get(run.edgeIds[0]!)?.sheet
  const nameOfEnd = (nodeId: string | undefined) => {
    const node = nodeId ? ix.nodes.get(nodeId)?.node : undefined
    if (!node) return 'free end'
    return node.tag ? formatTag(node.tag, '-') : node.label || getSymbol(node.symbolId).name
  }
  const unnumberedHere = run.edgeIds.filter((id) => !ix.edges.get(id)?.key).length
  const canSpread = Boolean(edge.lineNumber && ix.edges.get(edge.id)?.key) && unnumberedHere > 0

  return (
    <div className="prop-group" data-testid="run-section">
      <div className="prop-title">Run</div>
      <div className="run-fact" data-testid="run-number">
        <b>
          {run.number
            ? run.number
            : run.unnumbered
              ? 'Unnumbered'
              : `${run.numbers.length} line numbers`}
        </b>
        <span>
          {run.number
            ? 'one line number on this run'
            : run.unnumbered
              ? 'no segment of this pipe carries a number'
              : run.numbers.join('  ·  ')}
        </span>
      </div>
      <div className="run-fact" data-testid="run-segments">
        <b>{run.edgeIds.length} {run.edgeIds.length === 1 ? 'segment' : 'segments'}</b>
        <span>{sheet?.name ?? ''} — physically connected piping</span>
      </div>
      <div className="run-fact" data-testid="run-ends">
        <b>{ends.length === 0 ? 'No open ends' : `${ends.length} ${ends.length === 1 ? 'end' : 'ends'}`}</b>
        {/* Listed, never paired into From/To: the model states no direction. */}
        <span>{ends.map((e) => nameOfEnd(e.nodeId)).join('  ·  ')}</span>
      </div>
      {conflicts.length > 0 && (
        <div className="run-fact warn" data-testid="run-conflicts">
          <b>Also reported by QA</b>
          <span>
            {conflicts.map((c) =>
              c.kind === 'multiple-numbers'
                ? `this run carries ${c.numbers.length} line numbers`
                : `${c.number} is also on ${c.runIds.length - 1} other run${c.runIds.length === 2 ? '' : 's'}`,
            ).join('; ')}
          </span>
        </div>
      )}
      {canSpread && (
        <button
          data-testid="run-apply-number"
          title="Put this line number on the segments of this run that have none. Segments already numbered are left alone."
          onClick={() => {
            const { applied, skipped } = applyToRun(edge.id)
            showStatus(
              applied === 0
                ? 'Every other segment already carries a number'
                : `Numbered ${applied} more ${applied === 1 ? 'segment' : 'segments'}${skipped ? `, left ${skipped} already numbered` : ''}`,
            )
          }}
        >
          Number the whole run
        </button>
      )}
    </div>
  )
}

function EdgeProps({ edge }: { edge: PlantEdge }) {
  const setEdge = useStore((s) => s.setEdge)
  const setEdgeFluid = useStore((s) => s.setEdgeFluid)
  const doc = useStore((s) => s.doc)
  const [fluidsOpen, setFluidsOpen] = useState(false)
  const isProcess = edge.lineClass.startsWith('process')
  const isPipe = isProcess || edge.lineClass.startsWith('pipe.')
  const fluid = (doc.fluids ?? []).find((f) => f.id === edge.fluidId)
  const ln = edge.lineNumber ?? { size: '', spec: '', service: '', seq: '' }
  const setLn = (patch: Partial<typeof ln>) => { setEdge(edge.id, { lineNumber: { ...ln, ...patch } }); pauseHistory() }
  return (
    <>
      <div className="prop-title">Line</div>
      <label className="prop-field">Class
        <select value={edge.lineClass} onChange={(e) => setEdge(edge.id, { lineClass: e.target.value as LineClass })}>
          {Object.entries(LINE_CLASS_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label className="prop-check">
        <input
          type="checkbox"
          checked={edge.arrow === 'flow'}
          onChange={(e) => setEdge(edge.id, { arrow: e.target.checked ? 'flow' : 'none' })}
        />
        Flow arrow
      </label>
      {isPipe && (
        <label className="prop-field">Fluid
          <div className="tag-row">
            <span
              aria-hidden
              style={{ width: 14, height: 14, borderRadius: 3, alignSelf: 'center', flex: '0 0 auto',
                background: fluid?.color ?? 'transparent', border: '1px solid #b5b5c5' }}
            />
            <select
              data-testid="edge-fluid"
              value={edge.fluidId ?? ''}
              title="Assigning a fluid colors the whole connected run"
              onChange={(e) => setEdgeFluid(edge.id, e.target.value === '' ? undefined : e.target.value)}
            >
              <option value="">— none —</option>
              {(doc.fluids ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button title="Edit fluids…" onClick={() => setFluidsOpen(true)}>✎</button>
          </div>
        </label>
      )}
      {fluidsOpen && <FluidsDialog onClose={() => setFluidsOpen(false)} />}
      {isProcess && (
        <div className="prop-group">
          <div className="prop-title">Line Number</div>
          <div className="tag-row">
            <input placeholder='size (2")' value={ln.size} onChange={(e) => setLn({ size: e.target.value })} onBlur={resumeHistory} />
            <input placeholder="spec" value={ln.spec} onChange={(e) => setLn({ spec: e.target.value })} onBlur={resumeHistory} />
          </div>
          <div className="tag-row">
            <input placeholder="service" value={ln.service} onChange={(e) => setLn({ service: e.target.value })} onBlur={resumeHistory} />
            <input placeholder="seq" value={ln.seq} onChange={(e) => setLn({ seq: e.target.value })} onBlur={resumeHistory} />
            <button className="tag-auto" title="Next free sequence" onClick={() => setLn({ seq: nextLineSeq(doc) })}>№</button>
          </div>
        </div>
      )}
      {isPipe && <RunSection edge={edge} />}
    </>
  )
}

type InspectorTab = 'symbol' | 'eng' | 'used'

/**
 * The object inspector.
 *
 * With one object selected this is tabbed: the symbol's own properties, and
 * everywhere that object is referenced. The record tab — the stored engineering
 * data — slots in beside them once the registry lands (v0.15). Tabs rather than
 * a dialog on purpose: the drawing has to stay visible while you read about it,
 * which is the whole point of the P&ID being the way in.
 */
export default function PropertyPanel({ onCollapse }: { onCollapse?: () => void }) {
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const deleteSelected = useStore((s) => s.deleteSelected)
  const [tab, setTab] = useState<InspectorTab>('symbol')

  const sheet = activeSheet({ doc, activeSheetId })
  const single = selection.length === 1 ? selection[0]! : null
  const asideRef = useRef<HTMLElement>(null)

  /**
   * Enter on the canvas asks for this panel AND for the keyboard to arrive
   * somewhere useful in it.
   *
   * It used to arrive on "Hide the properties panel" — first in DOM order,
   * so first out of a query that accepted any button. Enter opened the panel
   * and put the keyboard on the control that closes it again, with the field
   * the user actually came for four Tab presses away.
   *
   * The order below is what an engineer reaches for: the tag, because that is
   * what identifies the object and what most edits change; then the first
   * real field for the symbols that carry no tag (annotation, fittings, and
   * a selected line, which lands on its class); then, only if there is
   * nothing to edit at all, a button that is not the collapse. The collapse
   * stays one Shift+Tab away.
   */
  useEffect(() => {
    const focusFirst = () => {
      const panel = asideRef.current
      if (!panel) return
      const el =
        panel.querySelector<HTMLElement>('.tag-letters:not([disabled])')
        ?? panel.querySelector<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        )
        ?? panel.querySelector<HTMLElement>('button:not([disabled]):not(.panel-collapse)')
      el?.focus()
      if (el instanceof HTMLInputElement) el.select()
    }
    window.addEventListener('pid:focus-props', focusFirst)
    return () => window.removeEventListener('pid:focus-props', focusFirst)
  }, [])
  const node = single ? sheet.nodes.find((n) => n.id === single) : undefined
  const edge = single ? sheet.edges.find((e) => e.id === single) : undefined

  // Selected, but living on another sheet. Every node/edge mutation goes
  // through patchSheet, which only ever rewrites the ACTIVE sheet — so an
  // editable inspector here would take input and silently discard it. Say
  // where the object is and offer to go there instead.
  const elsewhere = single && !node && !edge
    ? doc.sheets.find(
        (sh) => sh.id !== sheet.id
          && (sh.nodes.some((n) => n.id === single) || sh.edges.some((e) => e.id === single)),
      )
    : undefined

  let body
  if (selection.length === 0) {
    // "Nothing selected" and "nothing drawn" are different states and used to
    // render the same panel. On an empty sheet the guidance leads and the
    // document fields follow it; once there is anything to select, the fields
    // are the whole panel again, exactly as before.
    body = sheet.nodes.length === 0
      ? <><StartHere /><SheetProps /></>
      : <SheetProps />
  } else if (single) {
    body = node
      ? tab === 'used'
        ? <InspectorWhereUsed key={single} node={node} />
        : tab === 'eng'
          ? <InspectorEngineering key={single} node={node} />
          : <NodeProps key={single} node={node} />
      : edge
        ? <EdgeProps key={single} edge={edge} />
        : elsewhere
          ? (
            <div className="prop-group">
              <div className="prop-title">On another sheet</div>
              <p className="prop-note">
                This object is on <b>{elsewhere.name}</b>. Open that sheet to edit it.
              </p>
              <button onClick={() => locateCell(single, elsewhere.id)}>Go to {elsewhere.name}</button>
            </div>
          )
          : <SheetProps />
  } else {
    body = (
      <>
        <div className="prop-title">{selection.length} items selected</div>
        <div className="prop-title">Align</div>
        <div className="align-grid">
          <button onClick={() => applyAlignment('left')}>⇤ Left</button>
          <button onClick={() => applyAlignment('center-v')}>⇹ Centers</button>
          <button onClick={() => applyAlignment('right')}>⇥ Right</button>
          <button onClick={() => applyAlignment('top')}>⤒ Top</button>
          <button onClick={() => applyAlignment('center-h')}>⇳ Middles</button>
          <button onClick={() => applyAlignment('bottom')}>⤓ Bottom</button>
          <button onClick={() => applyAlignment('distribute-h')}>↔ Distribute</button>
          <button onClick={() => applyAlignment('distribute-v')}>↕ Distribute</button>
        </div>
        <div className="prop-row">
          <button onClick={duplicateSelection} title={hint('Duplicate', 'edit.duplicate')}>Duplicate</button>
          <button className="prop-delete" onClick={deleteSelected} title={hint('Delete', 'edit.delete')}>Delete selection</button>
        </div>
      </>
    )
  }

  return (
    <aside
      className="props"
      ref={asideRef}
      // Escape anywhere in the inspector hands the keyboard back to the
      // drawing, which completes the round trip Enter starts: canvas → Enter →
      // edit a field → Escape → canvas, with the same object still selected.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        focusCanvas()
      }}
    >
      <div className="panel-head">
        <h2>Properties</h2>
        <span className="sp" />
        {onCollapse && (
          <button className="panel-collapse" title="Hide the properties panel" onClick={onCollapse}>▸</button>
        )}
      </div>
      {node && (
        <div className="insp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'symbol'} data-testid="insp-symbol"
            className={tab === 'symbol' ? 'on' : ''} onClick={() => setTab('symbol')}>
            Symbol
          </button>
          <button role="tab" aria-selected={tab === 'eng'} data-testid="insp-eng"
            className={tab === 'eng' ? 'on' : ''} onClick={() => setTab('eng')}
            title="The engineering record for this object">
            Engineering
          </button>
          <button role="tab" aria-selected={tab === 'used'} data-testid="insp-used"
            className={tab === 'used' ? 'on' : ''} onClick={() => setTab('used')}
            title="Every place this object is referenced">
            Where used
          </button>
        </div>
      )}
      <div className="props-body">{body}</div>
    </aside>
  )
}


function CostField({ node }: { node: PlantNode }) {
  const doc = useStore((s) => s.doc)
  const setNodeCost = useStore((s) => s.setNodeCost)
  const cur = currencyOf(doc.budget?.currency)
  const key = priceKeyFor(node)
  const entry = key ? DEFAULT_PRICES[key] : undefined
  const projectOverride = key ? doc.budget?.overrides?.[key] : undefined
  /** The budgetary price this component would use with no cost of its own. */
  const fallback = unitCost({ ...node, cost: undefined }, doc.budget)
  const overridden = node.cost !== undefined
  return (
    <div className="prop-field prop-cost">
      <span className="prop-cost-head">
        Cost ({cur.code})
        {entry?.ev === 'est' && (
          <span className="prop-est" title="No published price found — this default comes from a cost correlation or a component build-up, not a vendor listing.">est</span>
        )}
      </span>
      <span className="prop-cost-row">
        <input
          data-testid="node-cost" type="number" min={0} step="any"
          value={node.cost === undefined ? '' : Math.round(toDisplay(node.cost, cur))}
          placeholder={String(Math.round(toDisplay(fallback, cur)))}
          title={`Your price for this component. Leave empty to use the budgetary default.${
            cur.code === 'USD' ? '' : ` Entered in ${cur.code}, stored in USD.`}`}
          onChange={(e) => { setNodeCost(node.id, e.target.value === '' ? undefined : toUsd(Number(e.target.value), cur)); pauseHistory() }}
          onBlur={resumeHistory}
        />
        {overridden && (
          <button
            className="prop-cost-reset" data-testid="node-cost-reset"
            title="Clear your price and go back to the budgetary default"
            onClick={() => setNodeCost(node.id, undefined)}
          >↺</button>
        )}
      </span>
      <span className={`prop-cost-note${overridden ? ' prop-cost-on' : ''}`}>
        {overridden
          ? `Your price — overriding ${money(fallback, cur)} ${projectOverride !== undefined ? 'project' : 'budgetary'}`
          : `${money(fallback, cur)} ${projectOverride !== undefined ? 'project price' : 'budgetary'}`}
      </span>
      {entry?.low !== undefined && entry.high !== undefined && (
        <span className="prop-cost-note">Range {money(entry.low, cur)} – {money(entry.high, cur)}</span>
      )}
      {entry?.basis && <span className="prop-cost-basis" title={entry.basis}>{entry.basis}</span>}
    </div>
  )
}
