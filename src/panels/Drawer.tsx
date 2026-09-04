// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import IssuesPanel from './IssuesPanel'
import LoopPanel from './LoopPanel'
import { useQa } from '../validate/live'

export default function Drawer() {
  const [tab, setTab] = useState<'issues' | 'loops' | null>(null)
  const { total } = useQa()
  return (
    <div className="drawer">
      <div className="drawer-tabs">
        <button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab(tab === 'issues' ? null : 'issues')}>
          Issues{total ? ` (${total})` : ''}
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
