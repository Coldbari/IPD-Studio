// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useStore, activeHmiScreen, pauseHistory, resumeHistory } from '../store/store'
import type { HmiWidget } from './model'
import type { AlignMode } from './align'
import { alignPatches, distributePatches, duplicateWidgets } from './align'
import { SignalPicker, TagPicker } from './TagPicker'
import { engineeringFor } from '../model/signalData'
import { keyOfNode } from '../model/registry'
import { navigateWorkspace } from '../routes'
import { locateCell } from '../canvas/locate'
import type { ProjectDoc } from '../model/types'
import { TREND_SPANS } from './sim/history'
import { DEFAULT_SPAN_S } from './widgets/trend'

/** One armed pick-on-canvas request: the next canvas click binds, not selects. */
export interface ArmedPick { kind: 'tank' | 'pipe'; widgetId: string }

/** Group a typing burst into one undo step (same pattern as the P&ID panels). */
const burst = (apply: () => void) => { apply(); pauseHistory() }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0', fontSize: 12, gap: 6 }}>
      <span>{label}</span>{children}
    </label>
  )
}

function BtnRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 4, margin: '6px 0', flexWrap: 'wrap' }}>{children}</div>
}

const btnStyle: React.CSSProperties = {
  flex: '1 0 auto', fontSize: 11, padding: '3px 6px', background: 'var(--hmi-surface-raised)',
  color: 'var(--hmi-text)', border: '1px solid var(--hmi-border)',
  borderRadius: 'var(--hmi-radius-sm)', cursor: 'pointer',
}

function NumProp({ w, k, label }: { w: HmiWidget; k: string; label: string }) {
  const updateWidget = useStore((s) => s.updateWidget)
  const v = w.props?.[k]
  return (
    <Row label={label}>
      <input type="number" style={{ width: 70 }} value={typeof v === 'number' ? v : ''} placeholder="auto"
        onBlur={resumeHistory}
        onChange={(e) => burst(() => {
          const props = { ...w.props }
          if (e.target.value === '') delete props[k]
          else props[k] = Number(e.target.value)
          updateWidget(w.id, { props })
        })} />
    </Row>
  )
}

/**
 * ALARM LIMITS — the engineering record owns these.
 *
 * LL / L / H / HH and the alarm priority are ISA-18.2 engineering decisions.
 * They live in `doc.registry`, and `sim/tags.ts` reads them from there in
 * preference to anything a widget carries. Until now this panel still offered
 * them as ordinary editable widget properties, so an engineer could type
 * `H = 80`, watch it save, and have the run keep using the record's 95 — the
 * value accepted, stored, and silently inert.
 *
 * So: where the record states a value, the field shows THAT value, read-only,
 * says where it came from, and offers the way to change it. Where the record
 * says nothing, the legacy widget property is still editable and still works
 * exactly as it did — which is what keeps every drawing made before the
 * registry owned this running unchanged.
 *
 * Nothing is migrated. A widget's own value is left in `props` untouched; it
 * simply stops being the answer while the record has one.
 */
function OverriddenProp({ label, value, testId }: { label: string; value: number | string; testId: string }) {
  return (
    <Row label={label}>
      <span
        data-testid={testId}
        title="Set on the engineering record, which is what the run and every deliverable use"
        style={{
          width: 70, textAlign: 'right', fontSize: 12, color: 'var(--hmi-text-secondary)',
          background: 'var(--hmi-surface-sunken)', border: '1px solid var(--hmi-border)',
          borderRadius: 'var(--hmi-radius-sm)', padding: '2px 5px',
        }}
      >
        {value}
      </span>
    </Row>
  )
}

/** Jump to the instrument on the drawing, where its record is edited. */
function openRecord(doc: ProjectDoc, tag: string): void {
  for (const sheet of doc.sheets) {
    for (const node of sheet.nodes) {
      if (keyOfNode(node) !== tag) continue
      navigateWorkspace('draw')
      locateCell(node.id, sheet.id)
      return
    }
  }
  // Bound to a tag nothing on any sheet carries. `orphaned-binding` already
  // reports that; the Checks page is where it is resolved.
  navigateWorkspace('checks')
}

function AlarmLimits({ w }: { w: HmiWidget }) {
  const doc = useStore((s) => s.doc)
  const eng = engineeringFor(doc.registry, w.tag)
  const owned = [eng.limits.LL, eng.limits.L, eng.limits.H, eng.limits.HH].some((v) => v !== undefined) ||
    eng.priority !== undefined
  const limitRow = (k: 'LL' | 'L' | 'H' | 'HH') => {
    const fromRecord = eng.limits[k]
    return fromRecord === undefined
      ? <NumProp key={k} w={w} k={k} label={k} />
      : <OverriddenProp key={k} label={k} value={fromRecord} testId={`prop-${k}-owned`} />
  }
  return (
    <>
      <h5 style={{ margin: '10px 0 2px' }}>Alarm limits</h5>
      {owned && (
        <p data-testid="alarm-owned-note" style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--hmi-text-secondary)', lineHeight: 1.45 }}>
          Set on the engineering record for <b>{w.tag}</b> — that is what the run, the I/O list and every
          export use. {w.tag && (
            <button
              data-testid="alarm-open-record"
              onClick={() => w.tag && openRecord(doc, w.tag)}
              style={{ ...btnStyle, flex: 'none', marginTop: 4, display: 'block' }}
            >
              Edit the engineering record…
            </button>
          )}
        </p>
      )}
      {(['LL', 'L', 'H', 'HH'] as const).map(limitRow)}
      {/* Deadband and on-delay stay HMI-owned for now: they are annunciation
          behaviour, the registry has no field for them, and inventing one here
          would be P1-A's scope creeping into a hardening pass. */}
      <NumProp w={w} k="deadband" label="Deadband" />
      <NumProp w={w} k="alarmDelay" label="On-delay s" />
      {eng.priority !== undefined ? (
        <OverriddenProp label="Priority" value={eng.priority} testId="prop-priority-owned" />
      ) : (
        <PriorityProp w={w} />
      )}
    </>
  )
}

/**
 * RANGE AND UNIT — the engineering record owns these too.
 *
 * The same rule `AlarmLimits` above applies to LL/L/H/HH, for the same reason
 * and with the same failure if it is not applied: `signal.range` and
 * `signal.units` are what `sim/tags.ts` compiles into the TagDef, and since
 * Step A that TagDef is also what every gauge, bar, trend and faceplate draws
 * with. An editable Min/Max here while the record states a range would accept
 * the number, store it, and change nothing anywhere.
 *
 * The range is owned as a PAIR: `parseRange` only yields min and max together,
 * so there is no state in which one is stated and the other is not.
 */
function RangeAndUnit({ w }: { w: HmiWidget }) {
  const doc = useStore((s) => s.doc)
  const eng = engineeringFor(doc.registry, w.tag)
  const rangeOwned = eng.min !== undefined && eng.max !== undefined
  const unitOwned = eng.units !== undefined
  return (
    <>
      {(rangeOwned || unitOwned) && (
        <p data-testid="range-owned-note" style={{ margin: '6px 0', fontSize: 11, color: 'var(--hmi-text-secondary)', lineHeight: 1.45 }}>
          {rangeOwned && unitOwned ? 'Range and unit are' : rangeOwned ? 'The range is' : 'The unit is'} set on the
          engineering record for <b>{w.tag}</b> — the run, the mimic and the faceplate all read it from there.
        </p>
      )}
      {unitOwned
        ? <OverriddenProp label="Unit" value={eng.units!} testId="prop-unit-owned" />
        : <StrProp w={w} k="unit" label="Unit" placeholder="%" />}
      {rangeOwned
        ? <><OverriddenProp label="Min" value={eng.min!} testId="prop-min-owned" />
            <OverriddenProp label="Max" value={eng.max!} testId="prop-max-owned" /></>
        : <><NumProp w={w} k="min" label="Min" /><NumProp w={w} k="max" label="Max" /></>}
    </>
  )
}

function PriorityProp({ w }: { w: HmiWidget }) {
  const updateWidget = useStore((s) => s.updateWidget)
  return (
    <Row label="Priority">
      <select data-testid="prop-priority"
        value={typeof w.props?.priority === 'string' ? String(w.props.priority) : ''}
        onChange={(e) => {
          const props = { ...w.props }
          if (e.target.value === '') delete props.priority
          else props.priority = e.target.value
          updateWidget(w.id, { props })
        }}>
        <option value="">default</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
    </Row>
  )
}

function StrProp({ w, k, label, placeholder }: { w: HmiWidget; k: string; label: string; placeholder?: string }) {
  const updateWidget = useStore((s) => s.updateWidget)
  return (
    <Row label={label}>
      <input style={{ width: 110 }} value={typeof w.props?.[k] === 'string' ? String(w.props[k]) : ''} placeholder={placeholder}
        onBlur={resumeHistory}
        onChange={(e) => burst(() => updateWidget(w.id, { props: { ...w.props, [k]: e.target.value } }))} />
    </Row>
  )
}

/** Arrange tools shared by single and multi selection. */
function ArrangeTools({ ids, onSelect }: { ids: string[]; onSelect?(ids: string[]): void }) {
  const screen = useStore(activeHmiScreen)
  const reorderWidgets = useStore((s) => s.reorderWidgets)
  const addWidgets = useStore((s) => s.addWidgets)
  const deleteHmiIds = useStore((s) => s.deleteHmiIds)
  if (!screen) return null
  const widgets = screen.widgets.filter((w) => ids.includes(w.id))
  return (
    <>
      <BtnRow>
        <button style={btnStyle} title="Bring to front" onClick={() => reorderWidgets(ids, 'front')}>⬆ Front</button>
        <button style={btnStyle} title="Send to back" onClick={() => reorderWidgets(ids, 'back')}>⬇ Back</button>
        <button style={btnStyle} title="Duplicate (Ctrl+D)"
          onClick={() => { const nids = addWidgets(duplicateWidgets(widgets)); onSelect?.(nids) }}>⧉ Duplicate</button>
        <button style={btnStyle} title="Delete (Del)" onClick={() => { deleteHmiIds(ids); onSelect?.([]) }}>✕ Delete</button>
      </BtnRow>
    </>
  )
}

function AlignTools({ ids }: { ids: string[] }) {
  const screen = useStore(activeHmiScreen)
  const updateWidgets = useStore((s) => s.updateWidgets)
  if (!screen) return null
  const widgets = screen.widgets.filter((w) => ids.includes(w.id))
  const align = (mode: AlignMode) => updateWidgets(alignPatches(widgets, mode))
  const distribute = (axis: 'h' | 'v') => updateWidgets(distributePatches(widgets, axis))
  const modes: [AlignMode, string, string][] = [
    ['left', '⇤', 'Align left'], ['centerX', '↔', 'Align centers'], ['right', '⇥', 'Align right'],
    ['top', '⤒', 'Align top'], ['middleY', '↕', 'Align middles'], ['bottom', '⤓', 'Align bottom'],
  ]
  return (
    <>
      <h5 style={{ margin: '10px 0 2px' }}>Align</h5>
      <BtnRow>
        {modes.map(([m, icon, tip]) => (
          <button key={m} style={btnStyle} title={tip} disabled={widgets.length < 2} onClick={() => align(m)}>{icon}</button>
        ))}
      </BtnRow>
      {widgets.length >= 3 && (
        <BtnRow>
          <button style={btnStyle} title="Equal horizontal gaps" onClick={() => distribute('h')}>⇹ Spread H</button>
          <button style={btnStyle} title="Equal vertical gaps" onClick={() => distribute('v')}>⇳ Spread V</button>
        </BtnRow>
      )}
    </>
  )
}

/** Bind-to-model row: shows the bound target, arms a pick-on-canvas click. */
function BindRow({ w, k, label, armedPick, onArmPick }: {
  w: HmiWidget; k: 'bindTank' | 'bindPipe'; label: string
  armedPick?: ArmedPick | null; onArmPick?(pick: ArmedPick | null): void
}) {
  const updateWidget = useStore((s) => s.updateWidget)
  const bound = typeof w.props?.[k] === 'string' ? String(w.props[k]) : ''
  const kind = k === 'bindTank' ? 'tank' as const : 'pipe' as const
  const armed = armedPick?.widgetId === w.id && armedPick.kind === kind
  return (
    <Row label={label}>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 11, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: bound ? 'var(--hmi-text)' : 'var(--hmi-text-muted)' }}>
          {bound ? (k === 'bindPipe' ? 'pipe ✓' : bound) : '—'}
        </span>
        <button style={{ ...btnStyle, ...(armed ? { background: 'var(--hmi-accent)', color: 'var(--hmi-text-on-accent)', border: '1px solid var(--hmi-accent)' } : {}) }}
          data-testid={`pick-${k}`}
          title={`Click a ${kind} on the canvas to bind this widget`}
          onClick={() => onArmPick?.(armed ? null : { kind, widgetId: w.id })}>
          {armed ? '… click canvas' : '⊙ pick'}
        </button>
        {bound && (
          <button style={btnStyle} title="Clear binding"
            onClick={() => { const props = { ...w.props }; delete props[k]; updateWidget(w.id, { props }) }}>✕</button>
        )}
      </span>
    </Row>
  )
}

export default function HmiPropertyPanel({ selection, onSelect, armedPick, onArmPick }: {
  selection: string[]
  onSelect?(ids: string[]): void
  armedPick?: ArmedPick | null
  onArmPick?(pick: ArmedPick | null): void
}) {
  const screen = useStore(activeHmiScreen)
  const screens = useStore((s) => s.doc.hmiScreens)
  const updateWidget = useStore((s) => s.updateWidget)
  const updateHmiPipe = useStore((s) => s.updateHmiPipe)
  const setScreenTheme = useStore((s) => s.setScreenTheme)
  if (!screen) return <div />
  const w = selection.length === 1 ? screen.widgets.find((x) => x.id === selection[0]) : undefined
  const pipe = !w && selection.length === 1 ? screen.pipes.find((p) => p.id === selection[0]) : undefined
  const selectedWidgets = screen.widgets.filter((x) => selection.includes(x.id))

  if (selection.length > 1) {
    return (
      <div>
        <h4>{selection.length} selected</h4>
        <p style={{ fontSize: 11, color: 'var(--hmi-text-muted)', margin: '4px 0' }}>
          {selectedWidgets.length} widget{selectedWidgets.length === 1 ? '' : 's'}, {selection.length - selectedWidgets.length} pipe{selection.length - selectedWidgets.length === 1 ? '' : 's'}
        </p>
        {selectedWidgets.length > 0 && <ArrangeTools ids={selectedWidgets.map((x) => x.id)} onSelect={onSelect} />}
        <AlignTools ids={selectedWidgets.map((x) => x.id)} />
      </div>
    )
  }

  if (pipe) {
    return (
      <div>
        <h4>Pipe</h4>
        <Row label="Width">
          <input type="number" style={{ width: 70 }} value={pipe.width ?? 4}
            onChange={(e) => updateHmiPipe(pipe.id, { width: Number(e.target.value) || 4 })} />
        </Row>
        <p style={{ fontSize: 11, color: 'var(--hmi-text-muted)' }}>Drag the round handles on the canvas to adjust the run.</p>
      </div>
    )
  }

  if (!w) {
    return (
      <div>
        <h4>Screen</h4>
        <Row label="Theme">
          <select value={screen.theme} onChange={(e) => setScreenTheme(screen.id, e.target.value as 'classic' | 'hp')}>
            <option value="classic">classic</option>
            <option value="hp">hp (ISA-101 gray)</option>
          </select>
        </Row>
        <p style={{ fontSize: 11, color: 'var(--hmi-text-muted)' }}>
          Select a widget to edit its bindings. Drag on empty canvas to rubber-band select; Shift+click adds; Ctrl+A selects all; Ctrl+D duplicates.
        </p>
      </div>
    )
  }

  const geom = (k: 'x' | 'y' | 'w' | 'h') => (
    <input key={k} type="number" style={{ width: 56 }} value={w[k]}
      onBlur={resumeHistory}
      onChange={(e) => burst(() => updateWidget(w.id, { [k]: Number(e.target.value) || 0 }))} />
  )

  return (
    <div>
      <h4>{w.type}</h4>
      {w.type !== 'nav' && w.type !== 'panel' && w.type !== 'label' && (
        <Row label="Tag">
          <TagPicker value={w.tag ?? ''} testid="prop-tag"
            onCommit={(tag) => updateWidget(w.id, { tag })} />
        </Row>
      )}
      <Row label={w.type === 'panel' ? 'Title' : 'Label'}>
        <input style={{ width: 110 }} value={w.label ?? ''}
          onBlur={resumeHistory}
          onChange={(e) => burst(() => updateWidget(w.id, { label: e.target.value || undefined }))} />
      </Row>
      <Row label="X / Y">{geom('x')}{geom('y')}</Row>
      <Row label="W / H">{geom('w')}{geom('h')}</Row>
      <ArrangeTools ids={[w.id]} onSelect={onSelect} />
      {w.type === 'nav' && (
        <Row label="Go to">
          <select
            value={typeof w.props?.screen === 'string' ? w.props.screen : ''}
            onChange={(e) => {
              const target = screens.find((sc) => sc.id === e.target.value)
              updateWidget(w.id, {
                props: { ...w.props, screen: e.target.value },
                // keep the button text in sync unless the user typed their own
                ...(target && (!w.label || screens.some((sc) => sc.name === w.label)) ? { label: target.name } : {}),
              })
            }}
          >
            <option value="">— pick screen —</option>
            {screens.filter((sc) => sc.id !== screen.id).map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.name}</option>
            ))}
          </select>
        </Row>
      )}
      {w.type === 'tank' && (<><NumProp w={w} k="capacity" label="Capacity" /><NumProp w={w} k="level0" label="Start level %" /></>)}
      {(w.type === 'tank' || w.type === 'display' || w.type === 'gauge' || w.type === 'bar' || w.type === 'trend') && (
        <AlarmLimits w={w} />
      )}
      {w.type === 'display' && (
        <Row label="Sparkline">
          <input type="checkbox" data-testid="prop-spark" checked={w.props?.spark === true}
            onChange={(e) => {
              const props = { ...w.props }
              if (e.target.checked) props.spark = true
              else delete props.spark
              updateWidget(w.id, { props })
            }} />
        </Row>
      )}
      {w.type === 'trend' && (
        <>
          <Row label="Span">
            <select data-testid="prop-span" value={String(w.props?.span ?? DEFAULT_SPAN_S)}
              onChange={(e) => updateWidget(w.id, { props: { ...w.props, span: Number(e.target.value) } })}>
              {TREND_SPANS.map((s) => (
                <option key={s} value={s}>{s < 3600 ? `${s / 60} min` : `${s / 3600} hr`}</option>
              ))}
            </select>
          </Row>
          <h5 style={{ margin: '10px 0 2px' }}>Extra pens</h5>
          {[0, 1, 2].map((i) => (
            <Row key={i} label={`Pen ${i + 2}`}>
              <SignalPicker value={w.pens?.[i]?.ref ?? ''} testid={`prop-pen-${i}`}
                onCommit={(ref) => {
                  const pens = [...(w.pens ?? [])]
                  if (ref === undefined) pens.splice(i, 1)
                  else pens[i] = { ...pens[i], ref }
                  const cleaned = pens.filter((p) => p?.ref)
                  updateWidget(w.id, { pens: cleaned.length > 0 ? cleaned : undefined })
                }} />
            </Row>
          ))}
          <p style={{ fontSize: 10, color: 'var(--hmi-text-muted)', margin: '2px 0' }}>
            Pen 1 is the widget's own tag. Extra pens take any TAG.SIGNAL — SP and OP of controllers too.
          </p>
        </>
      )}
      {(w.type === 'display' || w.type === 'gauge' || w.type === 'trend' || w.type === 'bar') && (
        <>
          <RangeAndUnit w={w} />
          <h5 style={{ margin: '10px 0 2px' }}>Value source</h5>
          <Row label="Controller">
            <input type="checkbox" data-testid="prop-controller" checked={w.props?.controller === true}
              onChange={(e) => {
                const props = { ...w.props }
                if (e.target.checked) props.controller = true
                else delete props.controller
                updateWidget(w.id, { props })
              }} />
          </Row>
          {w.props?.controller !== true && (
            <>
              <BindRow w={w} k="bindTank" label="Bind tank" armedPick={armedPick} onArmPick={onArmPick} />
              <BindRow w={w} k="bindPipe" label="Bind pipe" armedPick={armedPick} onArmPick={onArmPick} />
              {typeof w.props?.bindTank !== 'string' && typeof w.props?.bindPipe !== 'string' && (
                <NumProp w={w} k="base" label="Idle value" />
              )}
              <p style={{ fontSize: 10, color: 'var(--hmi-text-muted)', margin: '2px 0' }}>
                Bound values read the live plant model; unbound ones wander near the idle value.
              </p>
            </>
          )}
          {w.props?.controller === true && (
            <p style={{ fontSize: 10, color: 'var(--hmi-text-muted)', margin: '2px 0' }}>
              Controllers pair with their loop by tag (LIC-101 finds LT-101 / LV-101) and expose SP, OP and AUTO/MAN.
            </p>
          )}
        </>
      )}
      {w.type === 'valve' && (
        <Row label="Throttling">
          <input type="checkbox" checked={w.props?.throttle === true}
            onChange={(e) => updateWidget(w.id, { props: { ...w.props, throttle: e.target.checked } })} />
        </Row>
      )}
      {(w.type === 'lamp' || w.type === 'switch' || w.type === 'button') && (
        <Row label="Signal">
          <SignalPicker value={typeof w.props?.signal === 'string' ? String(w.props.signal) : ''} testid="prop-signal"
            onCommit={(signal) => {
              const props = { ...w.props }
              if (signal === undefined) delete props.signal
              else props.signal = signal
              updateWidget(w.id, { props })
            }} />
        </Row>
      )}
      {w.type === 'button' && <NumProp w={w} k="writeValue" label="Write value" />}
      {w.type === 'switch' && (<><StrProp w={w} k="onLabel" label="On label" /><StrProp w={w} k="offLabel" label="Off label" /></>)}
      {(w.type === 'symbol' || w.type === 'equip') && <StrProp w={w} k="symbolId" label="Symbol id" placeholder="valve.gate" />}
    </div>
  )
}
