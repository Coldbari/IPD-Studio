// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import './hmi.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { THEMES } from './theme'
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
import Modal from '../panels/Modal'
import { VersionChip } from '../panels/VersionNote'
import Faceplate from './Faceplate'
import AlarmBanner from './AlarmBanner'
import { useT } from '../i18n'

// The sim store rides the lazy HMI chunk, so the dev/e2e hook gains it here,
// not in main.tsx (which must not pull sim code into the eager bundle).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __pid?: Record<string, unknown> }
  w.__pid = { ...w.__pid, useSimStore }
}

export default function HmiWorkspace({ onExit }: { onExit(): void }) {
  const tr = useT()
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
  const [faceplate, setFaceplate] = useState<string | null>(null)
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
      showNotice((dir === 'undo' ? tr('Undid') : tr('Redid')) + tr(' a P&ID-side change (shared history)'))
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
  const history = useSimStore((s) => s.history)
  const historyT = useSimStore((s) => s.historyT)
  const allScreens = useStore((s) => s.doc.hmiScreens)
  const navAlarms = useMemo(
    () => (mode === 'run' ? worstAlarmByScreen(allScreens, alarms) : undefined),
    [mode, allScreens, alarms],
  )

  useEffect(() => {
    setSelection([])
    setTool('select')
    setFaceplate(null)
    setArmedPick(null)
    setView(null)
    // In RUN the sim is compiled plant-wide (every screen), so switching
    // screens is navigation, not a model change — keep simulating.
  }, [activeScreenId])
  // RUN is fit-locked, the way a real operator station presents a page
  useEffect(() => { setFaceplate(null); setArmedPick(null); setView(null) }, [mode])
  /** Alarm click-through: land on the screen AND show which widget it was. */
  const jumpToTag = (tag: string) => {
    const s = useStore.getState()
    const sc = s.doc.hmiScreens.find((x) => x.widgets.some((w) => w.tag === tag))
    if (sc) s.setActiveScreen(sc.id)
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
    <div className={`hmi${mode === 'run' ? ' run-mode' : ''}`}>
      <HmiToolbar onExit={onExit} tool={tool} setTool={setTool} onImport={runImport}
        onUndo={() => undoRedo('undo')} onRedo={() => undoRedo('redo')}
        zoomed={view !== null} onFit={() => setView(null)} />
      <div className="hmi-side"><HmiPalette /></div>
      <div className="hmi-center">
        {screen ? (
          <>
            {mode === 'run' && <AlarmBanner onJump={jumpToTag} />}
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
                historyT={mode === 'run' ? historyT : undefined}
                alarms={mode === 'run' ? alarms : undefined}
                navAlarms={navAlarms}
                flashTag={flashTag}
                onWidgetClick={(w) => setFaceplate(w.id)}
              />
            </div>
            {mode === 'run' && faceplate && (() => {
              const w = screen.widgets.find((x) => x.id === faceplate)
              return w ? <Faceplate widget={w} onClose={() => setFaceplate(null)} /> : null
            })()}
            <ScreenTabs />
          </>
        ) : (
          <div className="hmi-empty">
            <p>{tr('No HMI screens yet.')}</p>
            <button onClick={addScreen}>{tr('New screen')}</button>
            <button data-testid="hmi-import-empty" onClick={runImport}>{tr('Build from P&ID sheet…')}</button>
            <p style={{ fontSize: 12, opacity: 0.7 }}>{tr('Tip: load the “HMI demo” template from the P&ID toolbar, then come back here and press RUN.')}</p>
          </div>
        )}
      </div>
      <div className="hmi-props">
        <HmiPropertyPanel selection={selection} onSelect={setSelection} armedPick={armedPick} onArmPick={setArmedPick} />
      </div>
      {pickingSheet && (
        <Modal title={tr('Build HMI from the P&ID')} onClose={() => setPickingSheet(false)}>
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
                <span style={{ opacity: 0.6 }}>{sh.nodes.length} {tr('symbols')} · {sh.edges.length} {tr('lines')}</span>
              </label>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 2px 2px', cursor: 'pointer', borderTop: '1px solid #e2e2e8', marginTop: 4 }}>
              <input type="checkbox" data-testid="import-overview" checked={withOverview}
                onChange={(e) => setWithOverview(e.target.checked)} />
              <span>{tr('Generate a plant overview')} ({tr('one tile per sheet, becomes ★ home')})</span>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setPickingSheet(false)}>{tr('Cancel')}</button>
              <button data-testid="import-go" disabled={pickedSheets.size === 0}
                style={{ background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 14px' }}
                onClick={() => {
                  const order = useStore.getState().doc.sheets.filter((sh) => pickedSheets.has(sh.id)).map((sh) => sh.id)
                  void importFrom(order, withOverview)
                }}>
                {tr('Import')} {pickedSheets.size} {tr(pickedSheets.size === 1 ? 'sheet' : 'sheets')}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <StatusBar screenName={screen?.name} selection={selection.length}
        notice={armedPick ? tr('Click a') + ' ' + tr(armedPick.kind === 'tank' ? 'tank widget' : 'pipe') + ' ' + tr('on the canvas to bind — Esc cancels') : notice} />
    </div>
  )
}

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function StatusBar({ screenName, selection, notice }: { screenName?: string; selection: number; notice?: string | null }) {
  const tr = useT()
  const mode = useSimStore((s) => s.mode)
  const t = useSimStore((s) => s.t)
  const playing = useSimStore((s) => s.playing)
  const alarms = useSimStore((s) => s.alarms)
  const live = alarms.filter((a) => !a.sup && a.phase !== 'pending' && a.phase !== 'acked')
  const unacked = live.length
  const nBy = (p: 'high' | 'medium' | 'low') => live.filter((a) => a.priority === p).length
  return (
    <div className="hmi-status">
      <span>{tr('HMI workspace')}</span>
      <VersionChip />
      {screenName && <span>· {screenName}</span>}
      {notice && <span className="hmi-notice" data-testid="hmi-notice">{notice}</span>}
      {mode === 'run' ? (
        <>
          <span data-testid="sim-clock">⏱ {mmss(t)}{playing ? '' : tr(' (paused)')}</span>
          <span>{unacked > 0 ? `⚠ ${unacked} ${tr('unacked')}` : tr('no unacked alarms')}</span>
          {nBy('high') > 0 && <span className="al-prio al-prio-high">■ {nBy('high')}</span>}
          {nBy('medium') > 0 && <span className="al-prio al-prio-medium">▲ {nBy('medium')}</span>}
          {nBy('low') > 0 && <span className="al-prio al-prio-low">● {nBy('low')}</span>}
          <span style={{ marginLeft: 'auto' }}>{tr('RUNNING plant-wide — tabs navigate, click equipment to operate')}</span>
        </>
      ) : (
        screenName && (
          <>
            {selection > 0 && <span>{selection} {tr('selected')}</span>}
            <span style={{ marginLeft: 'auto' }}>{tr('EDIT — preview values shown; press ▶ RUN to simulate')}</span>
          </>
        )
      )}
    </div>
  )
}
