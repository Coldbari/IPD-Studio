// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useStore, activeHmiScreen } from '../store/store'
import { useSimStore } from './simStore'
import Modal from '../panels/Modal'
import { useT } from '../i18n'

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/** Training scenario injector: trip pumps, stick valves, freeze bound
 *  transmitters, choke the busiest line. Everything is journaled and Reset
 *  restores the plant. */
function EventsModal({ onClose }: { onClose(): void }) {
  const tr = useT()
  const doc = useStore((s) => s.doc)
  const tags = useSimStore((s) => s.tags)
  const plugged = useSimStore((s) => s.plugged)
  const write = useSimStore((s) => s.writeTag)
  const plugArtery = useSimStore((s) => s.plugArtery)
  const clearPlugs = useSimStore((s) => s.clearPlugs)
  const seen = new Set<string>()
  const pumps: string[] = []
  const valves: string[] = []
  const bound: string[] = []
  for (const sc of doc.hmiScreens) {
    for (const w of sc.widgets) {
      if (!w.tag || seen.has(w.tag)) continue
      seen.add(w.tag)
      if (w.type === 'pump' || w.type === 'equip') pumps.push(w.tag)
      else if (w.type === 'valve' && w.props?.throttle === true) valves.push(w.tag)
      else if (typeof w.props?.bindTank === 'string' || typeof w.props?.bindPipe === 'string') bound.push(w.tag)
    }
  }
  const toggle = (tag: string, sig: string) => write(tag, sig, (tags[tag]?.[sig] ?? 0) >= 0.5 ? 0 : 1)
  const row = (label: string, active: boolean, onClick: () => void, key: string) => (
    <button key={key} data-testid="event-row" onClick={onClick}
      style={{ textAlign: 'left', padding: '6px 10px', ...(active ? { background: '#fde8e8', border: '1px solid #c53030', color: '#9b1c1c', fontWeight: 600 } : {}) }}>
      {active ? '↩ ' : '⚡ '}{label}
    </button>
  )
  return (
    <Modal title={tr('Process events (training)')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pumps.slice(0, 6).map((t) => row(
          (tags[t]?.FAULT ?? 0) >= 0.5 ? tr('Clear') + ' ' + t + ' ' + tr('trip') : tr('Trip') + ' ' + t,
          (tags[t]?.FAULT ?? 0) >= 0.5, () => toggle(t, 'FAULT'), `f-${t}`))}
        {valves.slice(0, 6).map((t) => row(
          (tags[t]?.STUCK ?? 0) >= 0.5 ? tr('Free valve') + ' ' + t : tr('Stick valve') + ' ' + t,
          (tags[t]?.STUCK ?? 0) >= 0.5, () => toggle(t, 'STUCK'), `s-${t}`))}
        {bound.slice(0, 6).map((t) => row(
          (tags[t]?.FROZEN ?? 0) >= 0.5 ? tr('Unfreeze') + ' ' + t : tr('Freeze transmitter') + ' ' + t,
          (tags[t]?.FROZEN ?? 0) >= 0.5, () => toggle(t, 'FROZEN'), `z-${t}`))}
        {row(plugged.length > 0 ? tr('Clear plugged lines') + ' (' + plugged.length + ')' : tr('Plug the busiest line'),
          plugged.length > 0, () => (plugged.length > 0 ? clearPlugs() : plugArtery()), 'plug')}
        <p style={{ fontSize: 11, color: '#889', margin: '6px 0 0' }}>
          {tr('Injected upsets land in the journal; Reset restores the plant.')}
        </p>
      </div>
    </Modal>
  )
}

export default function HmiToolbar({ onExit, tool, setTool, onImport, onUndo, onRedo, zoomed, onFit }: {
  onExit(): void
  tool: 'select' | 'pipe'
  setTool(t: 'select' | 'pipe'): void
  onImport(): void
  /** Workspace-provided undo/redo (adds the shared-history notice). */
  onUndo?(): void
  onRedo?(): void
  zoomed?: boolean
  onFit?(): void
}) {
  const tr = useT()
  const storeUndo = useStore((s) => s.undo)
  const storeRedo = useStore((s) => s.redo)
  const undo = onUndo ?? storeUndo
  const redo = onRedo ?? storeRedo
  const name = useStore((s) => s.doc.meta.name)
  const doc = useStore((s) => s.doc)
  const screen = useStore(activeHmiScreen)
  const setScreenTheme = useStore((s) => s.setScreenTheme)
  const replaceScreen = useStore((s) => s.replaceScreen)

  const [confirmReimport, setConfirmReimport] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const reimport = async () => {
    if (!screen?.fromSheetId) return
    const { importSheet } = await import('./importFromPid')
    replaceScreen({ ...importSheet(doc, screen.fromSheetId), id: screen.id, name: screen.name, theme: screen.theme })
    setConfirmReimport(false)
  }
  const mode = useSimStore((s) => s.mode)
  const playing = useSimStore((s) => s.playing)
  const speed = useSimStore((s) => s.speed)
  const sim = useSimStore.getState
  const toggleRun = () => {
    if (!screen) return
    if (mode === 'run') return sim().exitRun()
    // plant-wide: every screen compiles into one model, so navigating
    // between pages while running keeps the same live plant
    sim().enterRun(doc.hmiScreens)
    // an operator station comes up on its home page
    const home = doc.hmiScreens.find((sc) => sc.home)
    if (home) useStore.getState().setActiveScreen(home.id)
  }
  const t = useSimStore((s) => s.t)
  const alarms = useSimStore((s) => s.alarms)
  const live = alarms.filter((a) => !a.sup && a.phase !== 'pending' && a.phase !== 'acked')
  const nBy = (p: 'high' | 'medium' | 'low') => live.filter((a) => a.priority === p).length
  const home = doc.hmiScreens.find((sc) => sc.home)
  return (
    <header className="hmi-toolbar">
      <strong>HMI Studio</strong>
      <span style={{ opacity: 0.7 }}>{name}</span>
      <button onClick={onExit} title={tr('Back to the P&ID editor')}>⇄ P&ID</button>
      {screen && (
        <button data-testid="hmi-run-toggle" className={mode === 'run' ? 'active' : ''} onClick={toggleRun}>
          {mode === 'run' ? '■ ' + tr('Stop (edit)') : '▶ ' + tr('RUN')}
        </button>
      )}
      {mode === 'run' ? (
        <>
          <span data-testid="run-title" style={{ fontSize: 14, fontWeight: 700, marginLeft: 6 }}>{screen?.name}</span>
          <span style={{ opacity: 0.8 }}>⏱ {mmss(t)}</span>
          {nBy('high') > 0 && <span className="al-prio al-prio-high">■ {nBy('high')}</span>}
          {nBy('medium') > 0 && <span className="al-prio al-prio-medium">▲ {nBy('medium')}</span>}
          {nBy('low') > 0 && <span className="al-prio al-prio-low">● {nBy('low')}</span>}
          {home && (
            <button data-testid="run-home" title={tr('Home screen')} disabled={home.id === screen?.id}
              onClick={() => useStore.getState().setActiveScreen(home.id)}>⌂ {home.name}</button>
          )}
          <button data-testid="hmi-play" onClick={() => sim().playPause()}>{playing ? tr('Pause') : tr('Play')}</button>
          <button data-testid="hmi-speed" onClick={() => sim().setSpeed(speed === 1 ? 5 : 1)}>{speed}×</button>
          <button data-testid="hmi-reset" onClick={() => sim().reset()}>{tr('Reset')}</button>
          <button data-testid="hmi-events" onClick={() => setEventsOpen(true)}
            title={tr('Inject a process upset (training scenarios)')}>⚡ {tr('Events')}</button>
        </>
      ) : (
        <>
          <button
            className={tool === 'pipe' ? 'active' : ''}
            data-testid="hmi-pipe-tool"
            onClick={() => setTool(tool === 'pipe' ? 'select' : 'pipe')}
            title={tr('Draw a pipe: click points, double-click or Enter to finish, Esc to cancel')}
          >
            {tr('Pipe')}
          </button>
          <button onClick={undo} title={tr('Undo (Ctrl+Z)')}>↩</button>
          <button onClick={redo} title={tr('Redo (Ctrl+Y)')}>↪</button>
          <button data-testid="hmi-fit" className={zoomed ? 'active' : ''} onClick={onFit}
            title={tr('Fit view (Ctrl+0) — wheel zooms, Space/middle-drag pans')}>⛶</button>
          <button data-testid="hmi-import" onClick={onImport} title={tr('Build an HMI screen from a P&ID sheet')}>{tr('From P&ID…')}</button>
          {screen?.fromSheetId && doc.sheets.some((sh) => sh.id === screen.fromSheetId) && (
            <button data-testid="hmi-reimport" onClick={() => setConfirmReimport(true)} title={tr('Rebuild this screen from its source sheet')}>{tr('Re-import')}</button>
          )}
        </>
      )}
      {screen && (
        <button data-testid="hmi-theme" onClick={() => setScreenTheme(screen.id, screen.theme === 'classic' ? 'hp' : 'classic')}
          title={tr('Toggle classic / ISA-101 high-performance theme')}>{screen.theme === 'classic' ? tr('Classic') : 'ISA-101'}</button>
      )}
      <span className="grow" />
      <span className="demo-note">{tr('Training / demo simulation — not for operations')}</span>
      {eventsOpen && mode === 'run' && (
        <EventsModal onClose={() => setEventsOpen(false)} />
      )}
      {confirmReimport && screen && (
        <Modal title={tr('Re-import screen')} onClose={() => setConfirmReimport(false)}>
          <p style={{ margin: '4px 0 12px' }}>
            {tr('Rebuild')} <strong>{screen.name}</strong> {tr('from its P&ID sheet? Your HMI edits to this screen are replaced (Ctrl+Z undoes).')}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmReimport(false)}>{tr('Cancel')}</button>
            <button data-testid="reimport-confirm" style={{ background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 14px' }}
              onClick={() => void reimport()}>{tr('Re-import')}</button>
          </div>
        </Modal>
      )}
    </header>
  )
}
