// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import IssuesPanel from './IssuesPanel'
import LoopPanel from './LoopPanel'
import { useQa } from '../validate/live'

export default function Drawer() {
  const [tab, setTab] = useState<'issues' | 'loops' | null>(null)
  const { total, counts } = useQa()
  // Count what the panel actually lists. The tab used to show the WHOLE
  // report — "Issues (5)" opening onto a single row, with no account of the
  // other four — because the panel shows criticals and warnings while the tab
  // counted informational findings too. A checker that visibly miscounts is a
  // checker people stop reading; the observations get their own line inside.
  const actionable = total - counts.info
  return (
    <div className={`drawer${tab ? ' drawer-open' : ''}`}>
      <div className="drawer-tabs">
        <button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab(tab === 'issues' ? null : 'issues')}>
          Issues{actionable ? ` (${actionable})` : ''}
        </button>
        <button className={tab === 'loops' ? 'active' : ''} onClick={() => setTab(tab === 'loops' ? null : 'loops')}>
          Loops
        </button>
      </div>
      {tab === 'issues' && <IssuesPanel />}
      {tab === 'loops' && <LoopPanel />}
    </div>
  )
}
