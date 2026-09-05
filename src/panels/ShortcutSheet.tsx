// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import Modal from './Modal'
import { GROUP_ORDER, byGroup, displayAll, matches } from '../shortcuts/registry'

/**
 * The list of what the keyboard does.
 *
 * The canvas has bound thirteen shortcuts and a handful of pointer gestures
 * since v0.3; the application named six of them, in scattered button tooltips.
 * `R` rotated the selection and appeared nowhere at all. Everything an
 * experienced engineer would use to go fast was there and unfindable.
 *
 * It reads straight off shortcuts/registry.ts rather than repeating it, so a
 * binding cannot drift out of the sheet — adding a shortcut adds a row here,
 * and a shortcut that is removed leaves.
 *
 * Pointer gestures are in the same table as the keys on purpose. "How do I
 * pan?" and "what does ⌘D do?" are one question to a user, and splitting the
 * answer across two surfaces answers it in neither.
 */
export function useShortcutSheet(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return
      if (!matches(e, 'app.shortcuts')) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return [open, setOpen]
}

export default function ShortcutSheet() {
  const [open, setOpen] = useShortcutSheet()

  // Opened from the command palette as well as from `?`, so the one surface
  // that lists every command can also list the way to find every key.
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('pid:shortcuts', show)
    return () => window.removeEventListener('pid:shortcuts', show)
  }, [setOpen])

  if (!open) return null

  return (
    <Modal title="Keyboard &amp; mouse" onClose={() => setOpen(false)} width={560}>
      <div className="ks">
        {GROUP_ORDER.map((group) => {
          const rows = byGroup(group)
          if (!rows.length) return null
          return (
            <section key={group} className="ks-group">
              <h3 className="ks-head">{group}</h3>
              <dl className="ks-list">
                {rows.map((s) => (
                  <div className="ks-row" key={s.id}>
                    <dt className="ks-keys">
                      {displayAll(s.id).map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="ks-or">or</span>}
                          <kbd className={s.gesture ? 'ks-gesture' : undefined}>{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="ks-what">
                      {s.label}
                      {s.note && <span className="ks-note">{s.note}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}
