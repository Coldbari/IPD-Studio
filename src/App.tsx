// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import Canvas from './canvas/Canvas'
import Toolbar from './panels/Toolbar'
import Palette from './panels/Palette'
import RightColumn, { PROPS_MIN } from './panels/RightColumn'
import Drawer from './panels/Drawer'
import SheetTabs from './panels/SheetTabs'
import StatusBar from './panels/StatusBar'
import QuickLineEditor from './panels/QuickLineEditor'
import WelcomeOverlay from './panels/WelcomeOverlay'
import CanvasContextMenu from './panels/CanvasContextMenu'
import CanvasAnnouncer from './panels/CanvasAnnouncer'

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

/**
 * What the panels do on a window this size, before the user has an opinion.
 *
 * The three side panels were fixed widths that never yielded: 584px of rail,
 * palette and inspector on every screen, so the canvas got 54% of a 1280
 * laptop and 70% of a 1920 monitor — the drawing absorbed all the variance,
 * in the wrong direction. Fit landed an A3 at 40%, where an ISA bubble's
 * letters are a smear.
 *
 * So the smaller the window, the more of it the drawing gets. Decided once, at
 * mount: a panel that collapsed itself under a user who was using it would be
 * worse than one that is merely narrow, and a stored preference always wins —
 * `readPref` returns this only when nothing is stored.
 */
function panelDefaults(): { palette: boolean; props: boolean; propsW: number } {
  const w = typeof window === 'undefined' ? 1440 : window.innerWidth
  return {
    palette: w >= 1200,
    props: w >= 1024,
    propsW: w < 1400 ? PROPS_MIN : 288,
  }
}

/** The Draw workspace: the drawing sheet and everything that serves it.
 *  Workspace switching, the command palette and the update toast belong to the
 *  shell (EditorRoot) so they survive moving between workspaces. */
export default function App() {
  const [showPalette, setShowPalette] = useState(() => readPref('pid.ui.palette', panelDefaults().palette))
  const [showProps, setShowProps] = useState(() => readPref('pid.ui.props', panelDefaults().props))
  const [propsW, setPropsW] = useState(() => readWidth('pid.ui.propsW', panelDefaults().propsW))
  const togglePalette = (v: boolean) => { setShowPalette(v); writePref('pid.ui.palette', v) }
  const toggleProps = (v: boolean) => { setShowProps(v); writePref('pid.ui.props', v) }
  const resizeProps = (px: number) => {
    setPropsW(px)
    try { localStorage.setItem('pid.ui.propsW', String(px)) } catch { /* ignore */ }
  }

  // "Find a symbol" has to work from a collapsed palette too, so the panel is
  // opened here and the request re-fired once the Palette that answers it has
  // mounted. Sending the user to a panel that isn't on screen is not guidance.
  useEffect(() => {
    const onFocusSymbols = () => {
      if (showPalette) return
      togglePalette(true)
      setTimeout(() => window.dispatchEvent(new Event('pid:focus-symbols')), 0)
    }
    window.addEventListener('pid:focus-symbols', onFocusSymbols)
    return () => window.removeEventListener('pid:focus-symbols', onFocusSymbols)
  }, [showPalette])

  // Same contract for the inspector: "Properties" in the context menu has to
  // put the panel on screen, not just assume it is.
  useEffect(() => {
    const onShowProps = () => { if (!showProps) toggleProps(true) }
    window.addEventListener('pid:show-props', onShowProps)
    return () => window.removeEventListener('pid:show-props', onShowProps)
  }, [showProps])

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
        {/* The drawer floats over the canvas rather than taking a row of the
            column. Closed, its tab strip was costing ~32px of drawing height
            on every screen for two buttons; open, it resized the canvas
            container, which re-fitted the view underneath the user. */}
        <div className="canvas-wrap">
          <Canvas />
          {/* Two nodes that describe the whole drawing to a screen reader —
              see CanvasAnnouncer for why it is not one node per symbol. */}
          <CanvasAnnouncer />
          <Drawer />
        </div>
        <SheetTabs />
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
      <CanvasContextMenu />
      <WelcomeOverlay />
    </div>
  )
}
