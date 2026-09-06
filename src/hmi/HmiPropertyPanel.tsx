// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useStore, activeHmiScreen, pauseHistory, resumeHistory } from '../store/store'
import type { HmiWidget } from './model'
import type { AlignMode } from './align'
import { alignPatches, distributePatches, duplicateWidgets } from './align'
import { SignalPicker, TagPicker } from './TagPicker'
import { useT } from '../i18n'

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
  flex: '1 0 auto', fontSize: 11, padding: '3px 6px', background: '#fff',
  border: '1px solid #c8ccd4', borderRadius: 4, cursor: 'pointer',
}

function NumProp({ w, k, label }: { w: HmiWidget; k: string; label: string }) {
  const t = useT()
  const updateWidget = useStore((s) => s.updateWidget)
  const v = w.props?.[k]
  return (
    <Row label={label}>
      <input type="number" style={{ width: 70 }} value={typeof v === 'number' ? v : ''} placeholder={t('auto')}
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
  const t = useT()
  const screen = useStore(activeHmiScreen)
  const reorderWidgets = useStore((s) => s.reorderWidgets)
  const addWidgets = useStore((s) => s.addWidgets)
  const deleteHmiIds = useStore((s) => s.deleteHmiIds)
  if (!screen) return null
  const widgets = screen.widgets.filter((w) => ids.includes(w.id))
  return (
    <>
      <BtnRow>
        <button style={btnStyle} title={t('Bring to front')} onClick={() => reorderWidgets(ids, 'front')}>⬆ {t('Front')}</button>
        <button style={btnStyle} title={t('Send to back')} onClick={() => reorderWidgets(ids, 'back')}>⬇ {t('Back')}</button>
        <button style={btnStyle} title={t('Duplicate (Ctrl+D)')}
          onClick={() => { const nids = addWidgets(duplicateWidgets(widgets)); onSelect?.(nids) }}>⧉ {t('Duplicate')}</button>
        <button style={btnStyle} title={t('Delete (Del)')} onClick={() => { deleteHmiIds(ids); onSelect?.([]) }}>✕ {t('Delete')}</button>
      </BtnRow>
    </>
  )
}

function AlignTools({ ids }: { ids: string[] }) {
  const t = useT()
  const screen = useStore(activeHmiScreen)
  const updateWidgets = useStore((s) => s.updateWidgets)
  if (!screen) return null
  const widgets = screen.widgets.filter((w) => ids.includes(w.id))
  const align = (mode: AlignMode) => updateWidgets(alignPatches(widgets, mode))
  const distribute = (axis: 'h' | 'v') => updateWidgets(distributePatches(widgets, axis))
  const modes: [AlignMode, string, string][] = [
    ['left', '⇤', t('Align left')], ['centerX', '↔', t('Align centers')], ['right', '⇥', t('Align right')],
    ['top', '⤒', t('Align top')], ['middleY', '↕', t('Align middles')], ['bottom', '⤓', t('Align bottom')],
  ]
  return (
    <>
      <h5 style={{ margin: '10px 0 2px' }}>{t('Align')}</h5>
      <BtnRow>
        {modes.map(([m, icon, tip]) => (
          <button key={m} style={btnStyle} title={tip} disabled={widgets.length < 2} onClick={() => align(m)}>{icon}</button>
        ))}
      </BtnRow>
      {widgets.length >= 3 && (
        <BtnRow>
          <button style={btnStyle} title={t('Equal horizontal gaps')} onClick={() => distribute('h')}>⇹ {t('Spread H')}</button>
          <button style={btnStyle} title={t('Equal vertical gaps')} onClick={() => distribute('v')}>⇳ {t('Spread V')}</button>
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
  const t = useT()
  const updateWidget = useStore((s) => s.updateWidget)
  const bound = typeof w.props?.[k] === 'string' ? String(w.props[k]) : ''
  const kind = k === 'bindTank' ? 'tank' as const : 'pipe' as const
  const armed = armedPick?.widgetId === w.id && armedPick.kind === kind
  return (
    <Row label={label}>
      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 11, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: bound ? '#1a1a1a' : '#889' }}>
          {bound ? (k === 'bindPipe' ? t('pipe ✓') : bound) : '—'}
        </span>
        <button style={{ ...btnStyle, ...(armed ? { background: '#dbeafe', border: '1px solid #2b6cb0' } : {}) }}
          data-testid={`pick-${k}`}
          title={`${t('Click a')} ${t(kind)} ${t('on the canvas to bind this widget')}`}
          onClick={() => onArmPick?.(armed ? null : { kind, widgetId: w.id })}>
          {armed ? `… ${t('click canvas')}` : `⊙ ${t('pick')}`}
        </button>
        {bound && (
          <button style={btnStyle} title={t('Clear binding')}
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
  const t = useT()
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
        <h4>{selection.length} {t('selected')}</h4>
        <p style={{ fontSize: 11, color: '#667', margin: '4px 0' }}>
          {selectedWidgets.length} {t(selectedWidgets.length === 1 ? 'widget' : 'widgets')}, {selection.length - selectedWidgets.length} {t(selection.length - selectedWidgets.length === 1 ? 'pipe' : 'pipes')}
        </p>
        {selectedWidgets.length > 0 && <ArrangeTools ids={selectedWidgets.map((x) => x.id)} onSelect={onSelect} />}
        <AlignTools ids={selectedWidgets.map((x) => x.id)} />
      </div>
    )
  }

  if (pipe) {
    return (
      <div>
        <h4>{t('Pipe')}</h4>
        <Row label={t('Width')}>
          <input type="number" style={{ width: 70 }} value={pipe.width ?? 4}
            onChange={(e) => updateHmiPipe(pipe.id, { width: Number(e.target.value) || 4 })} />
        </Row>
        <p style={{ fontSize: 11, color: '#667' }}>{t('Drag the round handles on the canvas to adjust the run.')}</p>
      </div>
    )
  }

  if (!w) {
    return (
      <div>
        <h4>{t('Screen')}</h4>
        <Row label={t('Theme')}>
          <select value={screen.theme} onChange={(e) => setScreenTheme(screen.id, e.target.value as 'classic' | 'hp')}>
          <option value="classic">{t('classic')}</option>
            <option value="hp">{t('hp (ISA-101 gray)')}</option>
          </select>
        </Row>
        <p style={{ fontSize: 11, color: '#667' }}>
          {t('Select a widget to edit its bindings. Drag on empty canvas to rubber-band select; Shift+click adds; Ctrl+A selects all; Ctrl+D duplicates.')}
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
      <h4>{t(w.type === 'symbol' ? 'P&ID symbol' : w.type)}</h4>
      {w.type !== 'nav' && w.type !== 'panel' && w.type !== 'label' && (
        <Row label={t('Tag')}>
          <TagPicker value={w.tag ?? ''} testid="prop-tag"
            onCommit={(tag) => updateWidget(w.id, { tag })} />
        </Row>
      )}
      <Row label={t(w.type === 'panel' ? 'Title' : 'Label')}>
        <input style={{ width: 110 }} value={w.label ?? ''}
          onBlur={resumeHistory}
          onChange={(e) => burst(() => updateWidget(w.id, { label: e.target.value || undefined }))} />
      </Row>
      <Row label="X / Y">{geom('x')}{geom('y')}</Row>
      <Row label="W / H">{geom('w')}{geom('h')}</Row>
      <ArrangeTools ids={[w.id]} onSelect={onSelect} />
      {w.type === 'nav' && (
        <Row label={t('Go to')}>
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
            <option value="">{t('— pick screen —')}</option>
            {screens.filter((sc) => sc.id !== screen.id).map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.name}</option>
            ))}
          </select>
        </Row>
      )}
      {w.type === 'tank' && (<><NumProp w={w} k="capacity" label={t('Capacity')} /><NumProp w={w} k="level0" label={t('Start level %')} /></>)}
      {(w.type === 'tank' || w.type === 'display' || w.type === 'gauge' || w.type === 'bar' || w.type === 'trend') && (
        <>
          <h5 style={{ margin: '10px 0 2px' }}>{t('Alarm limits')}</h5>
          <NumProp w={w} k="LL" label="LL" /><NumProp w={w} k="L" label="L" />
          <NumProp w={w} k="H" label="H" /><NumProp w={w} k="HH" label="HH" />
          <NumProp w={w} k="deadband" label={t('Deadband')} />
          <NumProp w={w} k="alarmDelay" label={t('On-delay s')} />
          <Row label={t('Priority')}>
            <select data-testid="prop-priority"
              value={typeof w.props?.priority === 'string' ? String(w.props.priority) : ''}
              onChange={(e) => {
                const props = { ...w.props }
                if (e.target.value === '') delete props.priority
                else props.priority = e.target.value
                updateWidget(w.id, { props })
              }}>
              <option value="">{t('default')}</option>
              <option value="low">{t('low')}</option>
              <option value="medium">{t('medium')}</option>
              <option value="high">{t('high')}</option>
            </select>
          </Row>
        </>
      )}
      {w.type === 'display' && (
        <Row label={t('Sparkline')}>
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
          <Row label={t('Span')}>
            <select data-testid="prop-span" value={String(w.props?.span ?? 120)}
              onChange={(e) => updateWidget(w.id, { props: { ...w.props, span: Number(e.target.value) } })}>
              <option value="60">{t('1 min')}</option>
              <option value="120">{t('2 min')}</option>
              <option value="240">{t('4 min')}</option>
            </select>
          </Row>
          <h5 style={{ margin: '10px 0 2px' }}>{t('Extra pens')}</h5>
          {[0, 1, 2].map((i) => (
            <Row key={i} label={t('Pen') + ' ' + (i + 2)}>
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
          <p style={{ fontSize: 10, color: '#889', margin: '2px 0' }}>
            {t("Pen 1 is the widget's own tag. Extra pens take any TAG.SIGNAL — SP and OP of controllers too.")}
          </p>
        </>
      )}
      {(w.type === 'display' || w.type === 'gauge' || w.type === 'trend' || w.type === 'bar') && (
        <>
          <StrProp w={w} k="unit" label={t('Unit')} placeholder="%" /><NumProp w={w} k="min" label={t('Min')} /><NumProp w={w} k="max" label={t('Max')} />
          <h5 style={{ margin: '10px 0 2px' }}>{t('Value source')}</h5>
          <Row label={t('Controller')}>
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
              <BindRow w={w} k="bindTank" label={t('Bind tank')} armedPick={armedPick} onArmPick={onArmPick} />
              <BindRow w={w} k="bindPipe" label={t('Bind pipe')} armedPick={armedPick} onArmPick={onArmPick} />
              {typeof w.props?.bindTank !== 'string' && typeof w.props?.bindPipe !== 'string' && (
                <NumProp w={w} k="base" label={t('Idle value')} />
              )}
              <p style={{ fontSize: 10, color: '#889', margin: '2px 0' }}>
                {t('Bound values read the live plant model; unbound ones wander near the idle value.')}
              </p>
            </>
          )}
          {w.props?.controller === true && (
            <p style={{ fontSize: 10, color: '#889', margin: '2px 0' }}>
              {t('Controllers pair with their loop by tag (LIC-101 finds LT-101 / LV-101) and expose SP, OP and AUTO/MAN.')}
            </p>
          )}
        </>
      )}
      {w.type === 'valve' && (
        <Row label={t('Throttling')}>
          <input type="checkbox" checked={w.props?.throttle === true}
            onChange={(e) => updateWidget(w.id, { props: { ...w.props, throttle: e.target.checked } })} />
        </Row>
      )}
      {(w.type === 'lamp' || w.type === 'switch' || w.type === 'button') && (
        <Row label={t('Signal')}>
          <SignalPicker value={typeof w.props?.signal === 'string' ? String(w.props.signal) : ''} testid="prop-signal"
            onCommit={(signal) => {
              const props = { ...w.props }
              if (signal === undefined) delete props.signal
              else props.signal = signal
              updateWidget(w.id, { props })
            }} />
        </Row>
      )}
      {w.type === 'button' && <NumProp w={w} k="writeValue" label={t('Write value')} />}
      {w.type === 'switch' && (<><StrProp w={w} k="onLabel" label={t('On label')} /><StrProp w={w} k="offLabel" label={t('Off label')} /></>)}
      {(w.type === 'symbol' || w.type === 'equip') && <StrProp w={w} k="symbolId" label={t('Symbol id')} placeholder="valve.gate" />}
    </div>
  )
}
