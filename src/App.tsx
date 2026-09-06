// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import Canvas from './canvas/Canvas'
import Toolbar from './panels/Toolbar'
import Palette from './panels/Palette'
import PropertyPanel from './panels/PropertyPanel'
import Drawer from './panels/Drawer'
import SheetTabs from './panels/SheetTabs'
import StatusBar from './panels/StatusBar'
import QuickLineEditor from './panels/QuickLineEditor'
import WelcomeOverlay from './panels/WelcomeOverlay'
import { useT } from './i18n'
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

/** The Draw workspace: the drawing sheet and everything that serves it.
 *  Workspace switching, the command palette and the update toast belong to the
 *  shell (EditorRoot) so they survive moving between workspaces. */
export default function App() {
  const t = useT()
  const [showPalette, setShowPalette] = useState(() => readPref('pid.ui.palette', true))
  const [showProps, setShowProps] = useState(() => readPref('pid.ui.props', true))
  const togglePalette = (v: boolean) => { setShowPalette(v); writePref('pid.ui.palette', v) }
  const toggleProps = (v: boolean) => { setShowProps(v); writePref('pid.ui.props', v) }

  return (
    <div className={`${showPalette ? 'app' : 'app no-palette'}${showProps ? '' : ' no-props'}`}>
      <Toolbar />
      {showPalette ? (
        <Palette onCollapse={() => togglePalette(false)} />
      ) : (
        <button className="panel-strip strip-left" title={t('Show symbol palette')} onClick={() => togglePalette(true)}>
          {t('Symbols')} ▸
        </button>
      )}
      <div className="center">
        <Canvas />
        <SheetTabs />
        <Drawer />
      </div>
      {showProps ? (
        <PropertyPanel onCollapse={() => toggleProps(false)} />
      ) : (
        <button className="panel-strip strip-right" title={t('Show properties')} onClick={() => toggleProps(true)}>
          ◂ {t('Properties')}
        </button>
      )}
      <StatusBar />
      <QuickLineEditor />
      <WelcomeOverlay />
    </div>
  )
}
