// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import './hmi.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { THEMES, cssVars } from './theme'
import { useStore, activeHmiScreen } from '../store/store'
import { useSimStore, useSimEngine } from './simStore'
import HmiToolbar from './HmiToolbar'
import ScreenTabs from './ScreenTabs'
import HmiPalette from './HmiPalette'
import HmiCanvas from './HmiCanvas'
import HmiPropertyPanel from './HmiPropertyPanel'
import type { ArmedPick } from './HmiPropertyPanel'
import type { View } from './view'
import { copySelection, pastePayload } from './clipboard'
import { HMI_WORLD } from './model'
import { worstAlarmByScreen } from './navAlarms'
import { clearHmiLocate, useHmiLocate } from './locate'
import { planFor, reconcileScreen } from '../model/reconcile'
import { buildTagDefs, tagDefMap } from './sim/tags'
import Modal from '../panels/Modal'
import { VersionChip } from '../panels/VersionNote'
import { FeedbackChip } from '../panels/FeedbackDialog'
import Faceplate from './Faceplate'
import AlarmBanner from './AlarmBanner'
import { clockText } from './sim/units'
import './operator/operator.css'
import OperatorNav from './operator/nav'
import type { OperatorPage } from './operator/nav'
import Overview from './operator/Overview'
import AlarmsPage from './operator/AlarmsPage'
import EquipmentPage from './operator/EquipmentPage'
import TrendsPage from './operator/TrendsPage'
import DiagnosticsPage from './operator/DiagnosticsPage'
import ProcessView from './operator/ProcessView'
import ScenarioPage from './operator/ScenarioPage'

// The sim store rides the lazy HMI chunk, so the dev/e2e hook gains it here,
// not in main.tsx (which must not pull sim code into the eager bundle).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __pid?: Record<string, unknown>; __reconcile?: unknown }
  w.__pid = { ...w.__pid, useSimStore }
  // The reconciliation model, for the one e2e assertion that has to apply a
  // document transaction while the simulation runs — which the dialog cannot
  // do, because it is deliberately edit-only.
  w.__reconcile = { reconcileScreen, planFor }
}

export default function HmiWorkspace({ onExit }: { onExit(): void }) {
  const screen = useStore(activeHmiScreen)
  const activeScreenId = useStore((s) => s.activeScreenId)
  const addScreen = useStore((s) => s.addScreen)

  const [pickingSheet, setPickingSheet] = useState(false)
  const [pickedSheets, setPickedSheets] = useState<Set<string>>(new Set())
  const [withOverview, setWithOverview] = useState(true)
  const importFrom = async (sheetIds: string[], overview: boolean) => {
    const s = useStore.getState()
    const { importSheet } = await import('./importFromPid')
    const { buildOverview } = await import('./overview')
    const imported = sheetIds.map((id) => importSheet(s.doc, id))
    if (imported.length === 0) return
    // overview first: it is home and becomes the active tab
    const screens = overview && imported.length > 1 ? [buildOverview(imported), ...imported] : imported
    s.addImportedScreens(screens)
    setPickingSheet(false)
  }
  /** Build HMI screens from P&ID sheets (modal pick when several). */
  const runImport = () => {
    const s = useStore.getState()
    if (s.doc.sheets.length > 1) {
      setPickedSheets(new Set(s.doc.sheets.map((sh) => sh.id)))
      setWithOverview(true)
      setPickingSheet(true)
    } else {
      void importFrom([s.doc.sheets[0]!.id], false)
    }
  }
  const [selection, setSelection] = useState<string[]>([])
  const [tool, setTool] = useState<'select' | 'pipe'>('select')
  /** Keyed by TAG, not widget id: opening a faceplate from the Equipment page
   *  also changes screens, and a widget id would be cleared by that navigation
   *  before the plate ever rendered. */
  const [faceplateTag, setFaceplateTag] = useState<string | null>(null)
  /** Which operator page is open. RUNTIME UI STATE — never persisted, never
   *  in undo, and meaningless in EDIT where the canvas is the whole workspace. */
  const [page, setPage] = useState<OperatorPage>('overview')
  const [armedPick, setArmedPick] = useState<ArmedPick | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [flashTag, setFlashTag] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showNotice = (msg: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice(msg)
    noticeTimer.current = setTimeout(() => setNotice(null), 2600)
  }
  /** Undo/redo with a heads-up when the step belonged to the P&ID side — the
   *  two workspaces share one history stack and that surprises people. */
  const undoRedo = (dir: 'undo' | 'redo') => {
    const before = useStore.getState().doc
    useStore.getState()[dir]()
    const after = useStore.getState().doc
    if (after !== before && after.hmiScreens === before.hmiScreens) {
      showNotice(`${dir === 'undo' ? 'Undid' : 'Redid'} a P&ID-side change (shared history)`)
    }
  }

  useSimEngine()
  const mode = useSimStore((s) => s.mode)
  // clipboard works window-wide like the P&ID shortcuts — the canvas doesn't
  // need focus; refs give the once-registered handler current state
  const cursorPt = useRef<{ x: number; y: number } | null>(null)
  const clipCtx = useRef({ selection, screen, mode })
  clipCtx.current = { selection, screen, mode }
  const simTags = useSimStore((s) => s.tags)
  const pipeFlows = useSimStore((s) => s.pipeFlows)
  const alarms = useSimStore((s) => s.alarms)
  const quality = useSimStore((s) => s.quality)
  const oos = useSimStore((s) => s.oos)
  const history = useSimStore((s) => s.history)
  const historyVersion = useSimStore((s) => s.historyVersion)
  const allScreens = useStore((s) => s.doc.hmiScreens)
  const registry = useStore((s) => s.doc.registry)
  const runDefs = useSimStore((s) => s.defs)
  /**
   * The engineering definitions every widget draws against.
   *
   * In RUN this is the simulation's OWN compiled map, so the mimic, the
   * faceplates and the alarm engine cannot disagree about a range, a unit or
   * a limit. In EDIT the same compiler runs over the same inputs, so a screen
   * previews on the ranges it will actually run on.
   */
  const editDefs = useMemo(
    () => tagDefMap(buildTagDefs(allScreens, registry)),
    [allScreens, registry],
  )
  const defs = mode === 'run' ? runDefs : editDefs
  const navAlarms = useMemo(
    () => (mode === 'run' ? worstAlarmByScreen(allScreens, alarms) : undefined),
    [mode, allScreens, alarms],
  )

  useEffect(() => {
    setSelection([])
    setTool('select')
    setArmedPick(null)
    setView(null)
    // In RUN the sim is compiled plant-wide (every screen), so switching
    // screens is navigation, not a model change — keep simulating. The
    // faceplate is NOT cleared here: it is keyed by tag and simply stops
    // rendering when its tag is not on the screen in front of the operator.
  }, [activeScreenId])
  /**
   * A "show me that widget" request from the Checks report.
   *
   * Honoured in an effect rather than by the caller, because the screen change
   * it asks for has to land first: selecting a widget on a screen that is not
   * mounted yet selects nothing. `clearHmiLocate` releases the request so a
   * later re-entry to the workspace does not re-select a stale object.
   */
  const locate = useHmiLocate((s) => s.request)
  useEffect(() => {
    if (!locate) return
    if (activeScreenId !== locate.screenId) return
    if (locate.widgetId) setSelection([locate.widgetId])
    clearHmiLocate()
  }, [locate, activeScreenId])

  // RUN is fit-locked, the way a real operator station presents a page
  useEffect(() => { setFaceplateTag(null); setArmedPick(null); setView(null) }, [mode])
  /**
   * Entering RUN lands where a real station does: the ★ home screen when the
   * project names one, and the dynamic Overview when it does not.
   */
  useEffect(() => {
    if (mode !== 'run') return
    const home = useStore.getState().doc.hmiScreens.find((sc) => sc.home)
    setPage(home ? 'process' : 'overview')
  }, [mode])

  /**
   * Click-through: land on the process screen that shows this tag, pulse the
   * widget, and optionally open its faceplate.
   *
   * One path for every page — the alarm banner, the alarm list, the overview,
   * the equipment list and diagnostics all arrive here, so "show me that" means
   * the same thing everywhere.
   */
  const jumpToTag = (tag: string, withFaceplate = false) => {
    const s = useStore.getState()
    const sc = s.doc.hmiScreens.find((x) => x.widgets.some((w) => w.tag === tag))
    if (sc) s.setActiveScreen(sc.id)
    setPage('process')
    setFaceplateTag(withFaceplate && sc ? tag : null)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlashTag(null)
    // out-in so a repeat click restarts the CSS animation
    requestAnimationFrame(() => setFlashTag(tag))
    flashTimer.current = setTimeout(() => setFlashTag(null), 2300)
  }
  // leaving the workspace (unmount) stops any running simulation
  useEffect(() => () => useSimStore.getState().exitRun(), [])
  // the P&ID canvas owns these shortcuts normally; it is unmounted here
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc cancels an armed binding pick from anywhere (the arming button
      // usually still holds focus, so the canvas handler never sees the key)
      if (e.key === 'Escape') { setArmedPick(null); return }
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z') { e.preventDefault(); undoRedo(e.shiftKey ? 'redo' : 'undo') }
      else if (k === 'y') { e.preventDefault(); undoRedo('redo') }
      else if (k === 's') { e.preventDefault(); void import('../cloud/autosave').then((m) => m.saveNow()) }
      else if (k === 'c' || k === 'x' || k === 'v') {
        const c = clipCtx.current
        if (c.mode !== 'edit' || !c.screen) return
        e.preventDefault()
        if (k === 'v') {
          const payload = pastePayload(cursorPt.current ?? { x: HMI_WORLD.w / 2, y: HMI_WORLD.h / 2 })
          if (payload) {
            const { widgetIds, pipeIds } = useStore.getState().addHmiBatch(payload.widgets, payload.pipes)
            setSelection([...widgetIds, ...pipeIds])
          }
        } else if (copySelection(c.screen, c.selection) && k === 'x') {
          useStore.getState().deleteHmiIds(c.selection)
          setSelection([])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    /* The design system, applied once. Every panel, table, control and
       faceplate below reads `var(--hmi-*)`; the SVG widgets take the same
       values as `ThemeTokens`. One source of truth, two consumers. */
    <div className={`hmi${mode === 'run' ? ' run-mode' : ''}`}
      data-hmi-theme={screen?.theme ?? 'classic'}
      style={cssVars(THEMES[screen?.theme ?? 'classic'])}>
      <HmiToolbar onExit={onExit} tool={tool} setTool={setTool} onImport={runImport}
        onUndo={() => undoRedo('undo')} onRedo={() => undoRedo('redo')}
        zoomed={view !== null} onFit={() => setView(null)} />
      <div className="hmi-side"><HmiPalette /></div>
      <div className="hmi-center">
        {/* The compact always-available alarm summary. It renders nothing at
            all on a quiet plant, which is what keeps normal operation calm. */}
        {mode === 'run' && <AlarmBanner onJump={(t) => jumpToTag(t)} />}
        {mode === 'run' && <OperatorNav page={page} onPage={setPage} crumb={screen?.name} />}
        {mode === 'run' && page === 'overview' && (
          <Overview
            onPage={setPage}
            onGoToScreen={(id) => { useStore.getState().setActiveScreen(id); setPage('process') }}
            onJumpTag={(t) => jumpToTag(t)}
          />
        )}
        {mode === 'run' && page === 'flow' && <ProcessView onOpen={(t) => jumpToTag(t, true)} />}
        {mode === 'run' && page === 'equipment' && <EquipmentPage onOpen={(t) => jumpToTag(t, true)} />}
        {mode === 'run' && page === 'alarms' && <AlarmsPage onJumpTag={(t) => jumpToTag(t)} />}
        {mode === 'run' && page === 'trends' && <TrendsPage />}
        {mode === 'run' && page === 'scenario' && <ScenarioPage />}
        {mode === 'run' && page === 'diagnostics' && <DiagnosticsPage onJumpTag={(t) => jumpToTag(t)} />}
        {(mode === 'edit' || page === 'process') && (screen ? (
          <>
            <div className="hmi-canvas-wrap" style={{ background: THEMES[screen.theme].bg }}>
              <HmiCanvas
                screen={screen}
                selection={selection}
                onSelect={setSelection}
                mode={mode}
                tool={tool}
                onToolDone={() => setTool('select')}
                armedPick={armedPick}
                onPicked={() => setArmedPick(null)}
                view={view}
                onViewChange={setView}
                onCursor={(pt) => { cursorPt.current = pt }}
                sim={mode === 'run' ? simTags : undefined}
                flows={mode === 'run' ? pipeFlows : undefined}
                history={mode === 'run' ? history : undefined}
                historyVersion={mode === 'run' ? historyVersion : undefined}
                alarms={mode === 'run' ? alarms : undefined}
                defs={defs}
                quality={mode === 'run' ? quality : undefined}
                oos={mode === 'run' ? oos : undefined}
                navAlarms={navAlarms}
                flashTag={flashTag}
                onWidgetClick={(w) => setFaceplateTag(w.tag ?? null)}
              />
            </div>
            {mode === 'run' && (() => {
              // resolved by TAG each render: a plate whose tag is not on the
              // screen in front of the operator simply is not shown
              const w = faceplateTag ? screen.widgets.find((x) => x.tag === faceplateTag) : undefined
              return w ? <Faceplate widget={w} theme={screen.theme} onClose={() => setFaceplateTag(null)} /> : null
            })()}
            <ScreenTabs />
          </>
        ) : (
          <div className="hmi-empty">
            <p>No HMI screens yet.</p>
            <button onClick={addScreen}>New screen</button>
            <button data-testid="hmi-import-empty" onClick={runImport}>Build from P&ID sheet…</button>
            <p style={{ fontSize: 12, opacity: 0.7 }}>Tip: load the “HMI demo” template from the P&ID toolbar, then come back here and press RUN.</p>
          </div>
        ))}
      </div>
      <div className="hmi-props">
        <HmiPropertyPanel selection={selection} onSelect={setSelection} armedPick={armedPick} onArmPick={setArmedPick} />
      </div>
      {pickingSheet && (
        <Modal title="Build HMI from the P&ID" onClose={() => setPickingSheet(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {useStore.getState().doc.sheets.map((sh) => (
              <label key={sh.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 2px', cursor: 'pointer' }}>
                <input type="checkbox" data-testid="pick-sheet" checked={pickedSheets.has(sh.id)}
                  onChange={(e) => {
                    const next = new Set(pickedSheets)
                    if (e.target.checked) next.add(sh.id)
                    else next.delete(sh.id)
                    setPickedSheets(next)
                  }} />
                <strong>{sh.name}</strong>
                <span style={{ opacity: 0.6 }}>{sh.nodes.length} symbols · {sh.edges.length} lines</span>
              </label>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 2px 2px', cursor: 'pointer', borderTop: '1px solid var(--hmi-border)', marginTop: 4 }}>
              <input type="checkbox" data-testid="import-overview" checked={withOverview}
                onChange={(e) => setWithOverview(e.target.checked)} />
              <span>Generate a <strong>plant overview</strong> screen (one tile per sheet, becomes ★ home)</span>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setPickingSheet(false)}>Cancel</button>
              <button data-testid="import-go" disabled={pickedSheets.size === 0}
                style={{ background: 'var(--hmi-accent)', color: 'var(--hmi-text-on-accent)', border: 'none', borderRadius: 2, padding: '4px 14px' }}
                onClick={() => {
                  const order = useStore.getState().doc.sheets.filter((sh) => pickedSheets.has(sh.id)).map((sh) => sh.id)
                  void importFrom(order, withOverview)
                }}>
                Import {pickedSheets.size} sheet{pickedSheets.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <StatusBar screenName={screen?.name} selection={selection.length}
        notice={armedPick ? `Click a ${armedPick.kind === 'tank' ? 'tank widget' : 'pipe'} on the canvas to bind — Esc cancels` : notice} />
    </div>
  )
}


function StatusBar({ screenName, selection, notice }: { screenName?: string; selection: number; notice?: string | null }) {
  const mode = useSimStore((s) => s.mode)
  const t = useSimStore((s) => s.t)
  const playing = useSimStore((s) => s.playing)
  const alarms = useSimStore((s) => s.alarms)
  const live = alarms.filter((a) => !a.sup && a.phase !== 'pending' && a.phase !== 'acked')
  const unacked = live.length
  const nBy = (p: 'high' | 'medium' | 'low') => live.filter((a) => a.priority === p).length
  return (
    <div className="hmi-status">
      <span>HMI workspace</span>
      <VersionChip />
      <FeedbackChip />
      {screenName && <span>· {screenName}</span>}
      {notice && <span className="hmi-notice" data-testid="hmi-notice">{notice}</span>}
      {mode === 'run' ? (
        <>
          <span data-testid="sim-clock" title="Simulated process time">⏱ {clockText(t)}{playing ? '' : ' (paused)'}</span>
          <span>{unacked > 0 ? `⚠ ${unacked} unacked` : 'no unacked alarms'}</span>
          {nBy('high') > 0 && <span className="al-prio al-prio-high">■ {nBy('high')}</span>}
          {nBy('medium') > 0 && <span className="al-prio al-prio-medium">▲ {nBy('medium')}</span>}
          {nBy('low') > 0 && <span className="al-prio al-prio-low">● {nBy('low')}</span>}
          <span style={{ marginLeft: 'auto' }}>RUNNING plant-wide — tabs navigate, click equipment to operate</span>
        </>
      ) : (
        screenName && (
          <>
            {selection > 0 && <span>{selection} selected</span>}
            <span style={{ marginLeft: 'auto' }}>EDIT — preview values shown; press ▶ RUN to simulate</span>
          </>
        )
      )}
    </div>
  )
}
