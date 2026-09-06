// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { getSymbol } from '../symbols/registry'
import { activeSheet, pauseHistory, resumeHistory, useStore } from '../store/store'
import type { EdgeEnd, LineClass, PlantEdge, PlantNode, SheetSize } from '../model/types'
import { isJunctionEnd, isPortEnd } from '../model/types'
import { LINE_CLASS_LABELS } from '../canvas/lineStyle'
import TagEditor from './TagEditor'
import { applyAlignment, duplicateSelection } from '../canvas/interactions'
import { nextLineSeq } from '../isa/autonumber'
import { DEFAULT_PRICES, priceKeyFor, unitCost } from '../model/costs'
import { currencyOf, money, toDisplay, toUsd } from '../model/currency'
import DatasheetEditor from './DatasheetEditor'
import FluidsDialog from './FluidsDialog'
import InspectorWhereUsed from './InspectorWhereUsed'
import InspectorEngineering from './InspectorEngineering'
import { useT } from '../i18n'

const SHEETS: SheetSize[] = ['A4', 'A3', 'A2', 'A1', 'ANSI_B', 'ANSI_D']

function SheetProps() {
  const t = useT()
  const meta = useStore((s) => s.doc.meta)
  const sheet = useStore((s) => activeSheet(s))
  const numberStart = useStore((s) => s.doc.settings.numberStart ?? 100)
  const setMeta = useStore((s) => s.setMeta)
  const setSettings = useStore((s) => s.setSettings)
  const setSheetMeta = useStore((s) => s.setSheetMeta)
  return (
    <>
      <div className="prop-title">{t('Project')}</div>
      <label className="prop-field">{t('Name')}<input value={meta.name} onChange={(e) => { setMeta({ name: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">{t('Author')}<input value={meta.author} onChange={(e) => { setMeta({ author: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">{t('Tag numbering starts at')}
        <select
          value={String(numberStart)}
          onChange={(e) => setSettings({ numberStart: e.target.value === '1' ? 1 : 100 })}
        >
          <option value="100">100, 101, 102…</option>
          <option value="1">001, 002, 003…</option>
        </select>
      </label>
      <div className="prop-title">{sheet.name}</div>
      <label className="prop-field">{t('Drawing number')}<input value={sheet.drawingNumber} onChange={(e) => { setSheetMeta({ drawingNumber: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">{t('Revision')}<input value={sheet.revision} onChange={(e) => { setSheetMeta({ revision: e.target.value }); pauseHistory() }} onBlur={resumeHistory} /></label>
      <label className="prop-field">{t('Sheet size')}
        <select value={sheet.sheetSize} onChange={(e) => setSheetMeta({ sheetSize: e.target.value as SheetSize })}>
          {SHEETS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </label>
    </>
  )
}

function OffPageLink({ node }: { node: PlantNode }) {
  const t = useT()
  const doc = useStore((s) => s.doc)
  const currentSheetId = useStore((s) => s.activeSheetId)
  const setNodeLink = useStore((s) => s.setNodeLink)
  const setActiveSheet = useStore((s) => s.setActiveSheet)
  const setSelection = useStore((s) => s.setSelection)
  const targetSheets = doc.sheets.filter((sh) => sh.id !== currentSheetId)
  const linkedSheet = node.link ? doc.sheets.find((sh) => sh.id === node.link!.sheetId) : undefined
  return (
    <div className="prop-group">
      <div className="prop-title">{t('Linked To')}</div>
      <label className="prop-field">{t('Sheet')}
        <select
          value={node.link?.sheetId ?? ''}
          onChange={(e) => {
            const sheetId = e.target.value
            if (!sheetId) setNodeLink(node.id, undefined)
            else setNodeLink(node.id, { sheetId, nodeId: '' })
          }}
        >
          <option value="">{t('— not linked —')}</option>
          {targetSheets.map((sh) => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
        </select>
      </label>
      {linkedSheet && (
        <label className="prop-field">{t('Connector')}
          <select
            value={node.link?.nodeId ?? ''}
            onChange={(e) => setNodeLink(node.id, { sheetId: linkedSheet.id, nodeId: e.target.value })}
          >
            <option value="">{t('— pick —')}</option>
            {linkedSheet.nodes.filter((n) => n.symbolId === 'ann.offpage').map((n) => (
              <option key={n.id} value={n.id}>{n.label || n.id.slice(0, 8)}</option>
            ))}
          </select>
        </label>
      )}
      {node.link?.nodeId && (
        <button onClick={() => { setActiveSheet(node.link!.sheetId); setSelection([node.link!.nodeId]) }}>
          {t('Go to linked connector')}
        </button>
      )}
    </div>
  )
}

function NodeProps({ node }: { node: PlantNode }) {
  const t = useT()
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
      <div className="prop-title">{t(def.name)}</div>
      {def.configOptions &&
        Object.entries(def.configOptions).map(([key, values]) => (
          <label className="prop-field" key={key}>
            {t(key)}
            <select
              value={node.config?.[key] ?? def.defaultConfig?.[key] ?? values[0]}
              onChange={(e) => setNodeConfig(node.id, { ...def.defaultConfig, ...node.config, [key]: e.target.value })}
            >
              {values.map((v) => <option key={v} value={v}>{t(v)}</option>)}
            </select>
          </label>
        ))}
      {def.tagRule !== 'none' && <TagEditor node={node} />}
      {node.kind !== 'annotation' && <CostField node={node} />}
      {node.symbolId === 'ann.offpage' && <OffPageLink node={node} />}
      <label className="prop-field">{t('Label')}
        <input value={node.label ?? ''} onChange={(e) => { setLabel(node.id, e.target.value); pauseHistory() }} onBlur={resumeHistory} placeholder={t('Service / name')} />
      </label>
      {(node.label ?? '') !== '' && (
        <label className="prop-field">{t('Label position')}
          <select
            title={t('Label position')}
            value={node.labelPos ?? 'below'}
            onChange={(e) => setLabelPos(node.id, e.target.value as 'below' | 'center')}
          >
            <option value="below">{t('below the symbol')}</option>
            <option value="center">{t('inside, centered')}</option>
          </select>
        </label>
      )}
      <div className="prop-row">
        <button onClick={() => rotateNode(node.id)}>{t('Rotate 90°')}</button>
        <button onClick={duplicateSelection} title="Ctrl+D">{t('Duplicate')}</button>
        <span className="prop-hint">{node.rotation}°</span>
      </div>
      <div className="prop-row">
        <span className="prop-hint">{t('Size')}</span>
        <button title={t('Smaller')} disabled={sx <= 0.5 && sy <= 0.5} onClick={() => setNodeStretch(node.id, sx - 0.25, sy - 0.25)}>−</button>
        <span className="scale-value">{sx === sy ? `${sx}×` : `${sx}/${sy}×`}</span>
        <button title={t('Larger')} disabled={sx >= 4 || sy >= 4} onClick={() => setNodeStretch(node.id, sx + 0.25, sy + 0.25)}>＋</button>
        {(sx !== 1 || sy !== 1) && <button title={t('Reset size')} onClick={() => setNodeStretch(node.id, 1, 1)}>{t('reset')}</button>}
      </div>
      <div className="prop-row">
        <span className="prop-hint">{t('Width')}</span>
        <button title={t('Narrower')} disabled={sx <= 0.5} onClick={() => setNodeStretch(node.id, sx - 0.25, sy)}>−</button>
        <span className="scale-value">{sx}×</span>
        <button title={t('Wider')} disabled={sx >= 4} onClick={() => setNodeStretch(node.id, sx + 0.25, sy)}>＋</button>
      </div>
      <div className="prop-row">
        <span className="prop-hint">{t('Height')}</span>
        <button title={t('Shorter')} disabled={sy <= 0.5} onClick={() => setNodeStretch(node.id, sx, sy - 0.25)}>−</button>
        <span className="scale-value">{sy}×</span>
        <button title={t('Taller')} disabled={sy >= 4} onClick={() => setNodeStretch(node.id, sx, sy + 0.25)}>＋</button>
      </div>
      {node.kind !== 'annotation' && (
        <div className="prop-row">
          <span className="prop-hint">{t('Pins')}</span>
          <button
            className={armPin === node.id ? 'arm-on' : ''}
            title={t('Add a connection pin: click this button, then click the spot on the symbol')}
            onClick={() => setArmPin(armPin === node.id ? null : node.id)}
          >
            {armPin === node.id ? t('Click the symbol… (Esc cancels)') : `＋ ${t('Add pin')}`}
          </button>
        </div>
      )}
      {(node.extraPorts ?? []).map((p) => (
        <div className="prop-row" key={p.id}>
          <span className="prop-hint">{p.id} · ({p.x}, {p.y})</span>
          <button title={t('Remove this pin (its lines go with it)')} onClick={() => removeExtraPort(node.id, p.id)}>✕</button>
        </div>
      ))}
      {(node.tagOffset || node.labelOffset) && (
        <div className="prop-row">
          <button onClick={() => { setTagOffset(node.id, undefined); setLabelOffset(node.id, undefined) }}>
            {t('Reset text position')}
          </button>
        </div>
      )}
      {node.kind === 'instrument' && (
        <div className="prop-row">
          <button onClick={() => setDatasheetOpen(true)}>{t('Datasheet…')}</button>
        </div>
      )}
      {datasheetOpen && <DatasheetEditor node={node} onClose={() => setDatasheetOpen(false)} />}
    </>
  )
}

function EdgeProps({ edge }: { edge: PlantEdge }) {
  const t = useT()
  const setEdge = useStore((s) => s.setEdge)
  const setEdgeFluid = useStore((s) => s.setEdgeFluid)
  const doc = useStore((s) => s.doc)
  const [fluidsOpen, setFluidsOpen] = useState(false)
  const isProcess = edge.lineClass.startsWith('process')
  const isPipe = isProcess || edge.lineClass.startsWith('pipe.')
  const fluid = (doc.fluids ?? []).find((f) => f.id === edge.fluidId)
  const arrowOn = edge.arrow === 'flow'
  const ln = edge.lineNumber ?? { size: '', spec: '', service: '', seq: '' }
  const setLn = (patch: Partial<typeof ln>) => { setEdge(edge.id, { lineNumber: { ...ln, ...patch } }); pauseHistory() }
  const setPendingTag = (end: 'source' | 'target', value: string) => {
    const current = edge[end]
    if (isPortEnd(current)) return
    const next: EdgeEnd = value.trim()
      ? { ...current, pendingTag: value }
      : { x: current.x, y: current.y, ...(current.junctionId ? { junctionId: current.junctionId } : {}) }
    setEdge(edge.id, { [end]: next })
  }
  return (
    <>
      <div className="prop-title">{t('Line')}</div>
      {(['source', 'target'] as const).map((end) => {
        const point = edge[end]
        if (isPortEnd(point) || isJunctionEnd(point)) return null
        return (
          <label className="prop-field" key={end}>
            {t('Pending device tag')} ({t(end === 'source' ? 'Source' : 'Target')})
            <input
              value={point.pendingTag ?? ''}
              placeholder={t('e.g. V-101')}
              onChange={(e) => { setPendingTag(end, e.target.value); pauseHistory() }}
              onBlur={resumeHistory}
            />
          </label>
        )
      })}
      <label className="prop-field">{t('Class')}
        <select value={edge.lineClass} onChange={(e) => setEdge(edge.id, { lineClass: e.target.value as LineClass })}>
          {Object.entries(LINE_CLASS_LABELS).map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}
        </select>
      </label>
      <label className="prop-check">
        <input
          type="checkbox"
          checked={arrowOn}
          onChange={(e) => setEdge(edge.id, { arrow: e.target.checked ? 'flow' : 'none' })}
        />
        {t('Flow arrow')}
      </label>
      {isPipe && (
        <label className="prop-field">{t('Fluid')}
          <div className="tag-row">
            <span
              aria-hidden
              style={{ width: 14, height: 14, borderRadius: 3, alignSelf: 'center', flex: '0 0 auto',
                background: fluid?.color ?? 'transparent', border: '1px solid #b5b5c5' }}
            />
            <select
              data-testid="edge-fluid"
              value={edge.fluidId ?? ''}
              title={t('Assigning a fluid colors this line section')}
              onChange={(e) => setEdgeFluid(edge.id, e.target.value === '' ? undefined : e.target.value)}
            >
              <option value="">{t('— none —')}</option>
              {(doc.fluids ?? []).map((f) => <option key={f.id} value={f.id}>{t(f.name)}</option>)}
            </select>
            <button title={t('Edit fluids…')} onClick={() => setFluidsOpen(true)}>✎</button>
          </div>
        </label>
      )}
      {fluidsOpen && <FluidsDialog onClose={() => setFluidsOpen(false)} />}
      {isProcess && (
        <div className="prop-group">
          <div className="prop-title">{t('Line Number')}</div>
          <div className="tag-row">
            <input placeholder={t('size (2")')} value={ln.size} onChange={(e) => setLn({ size: e.target.value })} onBlur={resumeHistory} />
            <input placeholder={t('spec')} value={ln.spec} onChange={(e) => setLn({ spec: e.target.value })} onBlur={resumeHistory} />
          </div>
          <div className="tag-row">
            <input placeholder={t('service')} value={ln.service} onChange={(e) => setLn({ service: e.target.value })} onBlur={resumeHistory} />
            <input placeholder={t('seq')} value={ln.seq} onChange={(e) => setLn({ seq: e.target.value })} onBlur={resumeHistory} />
            <button className="tag-auto" title={t('Next free sequence')} onClick={() => setLn({ seq: nextLineSeq(doc) })}>№</button>
          </div>
        </div>
      )}
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
  const t = useT()
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const deleteSelected = useStore((s) => s.deleteSelected)
  const [tab, setTab] = useState<InspectorTab>('symbol')

  const sheet = activeSheet({ doc, activeSheetId })
  const single = selection.length === 1 ? selection[0]! : null
  const node = single ? sheet.nodes.find((n) => n.id === single) : undefined
  const edge = single ? sheet.edges.find((e) => e.id === single) : undefined

  let body
  if (selection.length === 0) {
    body = <SheetProps />
  } else if (single) {
    body = node
      ? tab === 'used'
        ? <InspectorWhereUsed key={single} node={node} />
        : tab === 'eng'
          ? <InspectorEngineering key={single} node={node} />
          : <NodeProps key={single} node={node} />
      : edge
        ? <EdgeProps key={single} edge={edge} />
        : <SheetProps />
  } else {
    body = (
      <>
        <div className="prop-title">{selection.length} {t('items selected')}</div>
        <div className="prop-title">{t('Align')}</div>
        <div className="align-grid">
          <button onClick={() => applyAlignment('left')}>⇤ {t('Left')}</button>
          <button onClick={() => applyAlignment('center-v')}>⇹ {t('Centers')}</button>
          <button onClick={() => applyAlignment('right')}>⇥ {t('Right')}</button>
          <button onClick={() => applyAlignment('top')}>⤒ {t('Top')}</button>
          <button onClick={() => applyAlignment('center-h')}>⇳ {t('Middles')}</button>
          <button onClick={() => applyAlignment('bottom')}>⤓ {t('Bottom')}</button>
          <button onClick={() => applyAlignment('distribute-h')}>↔ {t('Distribute')}</button>
          <button onClick={() => applyAlignment('distribute-v')}>↕ {t('Distribute')}</button>
        </div>
        <div className="prop-row">
          <button onClick={duplicateSelection} title={t('Duplicate (Ctrl+D)')}>{t('Duplicate')}</button>
          <button onClick={deleteSelected}>{t('Delete selection')}</button>
        </div>
      </>
    )
  }

  return (
    <aside className="props">
      <div className="panel-head">
        <h2>{t('Properties')}</h2>
        <span className="sp" />
        {onCollapse && (
          <button className="panel-collapse" title={t('Hide the properties panel')} onClick={onCollapse}>▸</button>
        )}
      </div>
      {node && (
        <div className="insp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'symbol'} data-testid="insp-symbol"
            className={tab === 'symbol' ? 'on' : ''} onClick={() => setTab('symbol')}>
            {t('Symbol')}
          </button>
          <button role="tab" aria-selected={tab === 'eng'} data-testid="insp-eng"
            className={tab === 'eng' ? 'on' : ''} onClick={() => setTab('eng')}
            title={t('The engineering record for this object')}>
            {t('Engineering')}
          </button>
          <button role="tab" aria-selected={tab === 'used'} data-testid="insp-used"
            className={tab === 'used' ? 'on' : ''} onClick={() => setTab('used')}
            title={t('Every place this object is referenced')}>
            {t('Where used')}
          </button>
        </div>
      )}
      <div className="props-body">{body}</div>
    </aside>
  )
}


function CostField({ node }: { node: PlantNode }) {
  const t = useT()
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
        {t('Cost')} ({cur.code})
        {entry?.ev === 'est' && (
          <span className="prop-est" title={t('No published price found — this default comes from a cost correlation or a component build-up, not a vendor listing.')}>est</span>
        )}
      </span>
      <span className="prop-cost-row">
        <input
          data-testid="node-cost" type="number" min={0} step="any"
          value={node.cost === undefined ? '' : Math.round(toDisplay(node.cost, cur))}
          placeholder={String(Math.round(toDisplay(fallback, cur)))}
          title={cur.code === 'USD'
            ? t('Your price for this component. Leave empty to use the budgetary default.')
            : t('Your price for this component. Leave empty to use the budgetary default.') + ' ' + t('Entered in') + ' ' + cur.code + ', ' + t('stored in USD.')}
          onChange={(e) => { setNodeCost(node.id, e.target.value === '' ? undefined : toUsd(Number(e.target.value), cur)); pauseHistory() }}
          onBlur={resumeHistory}
        />
        {overridden && (
          <button
            className="prop-cost-reset" data-testid="node-cost-reset"
            title={t('Clear your price and go back to the budgetary default')}
            onClick={() => setNodeCost(node.id, undefined)}
          >↺</button>
        )}
      </span>
      <span className={`prop-cost-note${overridden ? ' prop-cost-on' : ''}`}>
        {overridden
          ? t('Your price — overriding') + ' ' + money(fallback, cur) + ' ' + t(projectOverride !== undefined ? 'project' : 'budgetary')
          : money(fallback, cur) + ' ' + t(projectOverride !== undefined ? 'project price' : 'budgetary')}
      </span>
      {entry?.low !== undefined && entry.high !== undefined && (
        <span className="prop-cost-note">{t('Range')} {money(entry.low, cur)} – {money(entry.high, cur)}</span>
      )}
      {entry?.basis && <span className="prop-cost-basis" title={t(entry.basis)}>{t(entry.basis)}</span>}
    </div>
  )
}
