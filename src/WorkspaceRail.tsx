// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect } from 'react'
import { WORKSPACES, navigateWorkspace, type Workspace } from './routes'
import { useStore } from './store/store'
import { qaFor } from './validate/engine'
import { useT } from './i18n'

interface Entry {
  icon: string
  label: string
  hint: string
}

/**
 * The editor's top-level navigation. It exists because the toolbar was full:
 * ~18 controls already scrolling horizontally, with nowhere to hang a second
 * screen. Workspaces go here instead, so the toolbar can stay about drawing.
 */
const ENTRIES: Record<Workspace, Entry> = {
  draw: { icon: '✎', label: 'Draw', hint: 'The P&ID sheet' },
  data: { icon: '▦', label: 'Data', hint: 'Instrument index and line list, generated from the drawing' },
  checks: { icon: '✓', label: 'Checks', hint: 'Every validation finding and suggestion, full screen' },
  hmi: { icon: '⊞', label: 'HMI', hint: 'HMI Studio — operator screens and simulation' },
}

export default function WorkspaceRail({ active }: { active: Workspace }) {
  const t = useT()
  // Only actionable counts earn a badge. Warnings and observations would cry
  // wolf on a drawing that is merely unfinished, so the badge counts CRITICALS
  // alone — the things that would stop the drawing being issued.
  const findings = qaFor(useStore((s) => s.doc)).counts.critical

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > WORKSPACES.length) return
      e.preventDefault()
      navigateWorkspace(WORKSPACES[n - 1]!)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <nav className="rail" aria-label={t('Workspaces')}>
      {WORKSPACES.map((w, i) => {
        const e = ENTRIES[w]
        const on = w === active
        const badge = w === 'checks' && findings > 0 ? findings : null
        return (
          <button
            key={w}
            type="button"
            className={`rail-btn${on ? ' on' : ''}`}
            data-testid={`rail-${w}`}
            aria-current={on ? 'page' : undefined}
            title={`${t(e.label)} — ${t(e.hint)} (Ctrl+${i + 1})`}
            onClick={() => navigateWorkspace(w)}
          >
            <span className="rail-icon" aria-hidden="true">{e.icon}</span>
            <span className="rail-label">{t(e.label)}</span>
            {badge !== null && (
              <span className="rail-badge" aria-label={badge + ' ' + t('findings')}>
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
