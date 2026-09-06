// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import Modal from './Modal'
import { useStore } from '../store/store'
import { DEFAULT_FLUIDS } from '../model/doc'
import { useLanguage, useT } from '../i18n'

/** Manage the document's process services: name + line color. Assigning a
 *  fluid to a line spreads it along the connected run automatically. */
export default function FluidsDialog({ onClose }: { onClose(): void }) {
  const t = useT()
  const lang = useLanguage()
  // NB: select the raw field — `?? []` inside the selector mints a new array
  // every snapshot and loops React when the doc has no fluids yet
  const fluids = useStore((s) => s.doc.fluids) ?? []
  const addFluid = useStore((s) => s.addFluid)
  const updateFluid = useStore((s) => s.updateFluid)
  const removeFluid = useStore((s) => s.removeFluid)
  return (
    <Modal title={t('Fluids / services')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 280 }}>
        {fluids.map((f) => (
          <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={f.color}
              title={t('Line color')}
              onChange={(e) => updateFluid(f.id, { color: e.target.value })}
              style={{ width: 34, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            />
            <input
              value={lang === 'zh-CN' ? t(f.name) : f.name}
              onChange={(e) => {
                const known = DEFAULT_FLUIDS.find((d) => t(d.name) === e.target.value)
                updateFluid(f.id, { name: known?.name ?? e.target.value })
              }}
              style={{ flex: 1 }}
            />
            <button title={t('Delete (clears it from all lines)')} onClick={() => removeFluid(f.id)}>✕</button>
          </div>
        ))}
        {fluids.length === 0 && (
          <button onClick={() => DEFAULT_FLUIDS.forEach((f) => addFluid(f.name, f.color))}>
            {t('Add starter set (Water, Steam, Air…)')}
          </button>
        )}
        <button data-testid="fluid-add" onClick={() => addFluid(t('New fluid'), '#607d8b')}>＋ {t('Add fluid')}</button>
        <p style={{ fontSize: 11, color: '#889', margin: 0 }}>
          {t('Pick a fluid on a selected line section — it colors only that section.')}
        </p>
      </div>
    </Modal>
  )
}
