// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import IssuesPanel from './IssuesPanel'
import LoopPanel from './LoopPanel'
import { useStore } from '../store/store'
import { qaFor } from '../validate/engine'
import { useT } from '../i18n'

export default function Drawer() {
  const t = useT()
  const [tab, setTab] = useState<'issues' | 'loops' | null>(null)
  const { total } = qaFor(useStore((s) => s.doc))
  return (
    <div className="drawer">
      <div className="drawer-tabs">
        <button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab(tab === 'issues' ? null : 'issues')}>
          {t('Issues')}{total ? ` (${total})` : ''}
        </button>
        <button className={tab === 'loops' ? 'active' : ''} onClick={() => setTab(tab === 'loops' ? null : 'loops')}>
          {t('Loops')}
        </button>
      </div>
      {tab === 'issues' && <IssuesPanel />}
      {tab === 'loops' && <LoopPanel />}
    </div>
  )
}
