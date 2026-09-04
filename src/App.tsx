// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import Canvas from './canvas/Canvas'
import Toolbar from './panels/Toolbar'
import Palette from './panels/Palette'
import RightColumn from './panels/RightColumn'
import Drawer from './panels/Drawer'
import SheetTabs from './panels/SheetTabs'
import StatusBar from './panels/StatusBar'
import QuickLineEditor from './panels/QuickLineEditor'
import WelcomeOverlay from './panels/WelcomeOverlay'

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* private mode etc. — collapse state just won't persist */
  }
}

function readWidth(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

/** The Draw workspace: the drawing sheet and everything that serves it.
 *  Workspace switching, the command palette and the update toast belong to the
 *  shell (EditorRoot) so they survive moving between workspaces. */
export default function App() {
  const [showPalette, setShowPalette] = useState(() => readPref('pid.ui.palette', true))
  const [showProps, setShowProps] = useState(() => readPref('pid.ui.props', true))
  const [propsW, setPropsW] = useState(() => readWidth('pid.ui.propsW', 288))
  const togglePalette = (v: boolean) => { setShowPalette(v); writePref('pid.ui.palette', v) }
  const toggleProps = (v: boolean) => { setShowProps(v); writePref('pid.ui.props', v) }
  const resizeProps = (px: number) => {
    setPropsW(px)
    try { localStorage.setItem('pid.ui.propsW', String(px)) } catch { /* ignore */ }
  }

  return (
    <div
      className={`app${showPalette ? '' : ' no-palette'}${showProps ? '' : ' no-props'}`}
      // Only while the column is shown: `.no-props` sets --props-w to the
      // collapsed strip width via a class, and an inline value would win over
      // it and leave a full-width panel behind the collapse button.
      style={showProps ? ({ '--props-w': `${propsW}px` } as React.CSSProperties) : undefined}
    >
      <Toolbar />
      {showPalette ? (
        <Palette onCollapse={() => togglePalette(false)} />
      ) : (
        <button className="panel-strip strip-left" title="Show symbol palette" onClick={() => togglePalette(true)}>
          Symbols ▸
        </button>
      )}
      <div className="center">
        <Canvas />
        <SheetTabs />
        <Drawer />
      </div>
      {showProps ? (
        <RightColumn onCollapse={() => toggleProps(false)} onWidth={resizeProps} />
      ) : (
        <button className="panel-strip strip-right" title="Show properties and assistant" onClick={() => toggleProps(true)}>
          ◂ Properties
        </button>
      )}
      <StatusBar />
      <QuickLineEditor />
      <WelcomeOverlay />
    </div>
  )
}
