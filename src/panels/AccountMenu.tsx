// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import Popover from './Popover'
import { useStore } from '../store/store'
import { useAuthStore, signOutUser } from '../auth/authStore'
import { authErrorMessage } from '../auth/errors'
import CloudDialog from '../cloud/CloudDialog'
import { saveToCloud } from '../cloud/sync'
import { language, useT } from '../i18n'

/** Toolbar account control. Signed out it is a single Sign in button; signed
 *  in it opens a small menu over the cloud drawings. Sign-in is never required
 *  to draw — this is additive to the local-first editor, not a gate. */
export default function AccountMenu() {
  const t = useT()
  const user = useAuthStore((s) => s.user)
  const ready = useAuthStore((s) => s.ready)
  const [cloudOpen, setCloudOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)


  useEffect(() => {
    if (!status) return
    const id = window.setTimeout(() => setStatus(null), 4000)
    return () => window.clearTimeout(id)
  }, [status])

  const saveCurrent = async () => {
    if (!user) return
    setMenuOpen(false)
    setSaving(true)
    try {
      const { doc, cloudId, setCloudId, markSaved } = useStore.getState()
      const saved = await saveToCloud(user.uid, doc, { id: cloudId ?? undefined, name: doc.meta.name })
      setCloudId(saved.id)
      markSaved()
      setStatus(t('Saved to your account'))
    } catch (err) {
      setStatus(authErrorMessage(err, language()))
    } finally {
      setSaving(false)
    }
  }

  // The editor sits behind the sign-in screen, so there is normally a user by
  // the time this renders. The guard is for the moment between signing out and
  // the route swapping back to the gate.
  if (!ready || !user) return null

  const label = user.displayName?.trim() || user.email || t('Account')

  return (
    <div className="tb-account-wrap">
      <button ref={btnRef} className="tb-account" data-testid="account-menu" aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)} title={`${t('Signed in as')} ${label}`} aria-label={`${t('Account:')} ${label}`}>
        <span className="tb-account-dot" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
        <span className="tb-account-caret" aria-hidden="true">▾</span>
      </button>
      {menuOpen && (
        <Popover anchor={btnRef} onClose={() => setMenuOpen(false)} className="tb-account-menu" testId="account-pop">
          <div className="tb-account-who" title={label}>{label}</div>
          <div className="tb-account-sep" />
          <button role="menuitem" data-testid="account-drawings" onClick={() => { setMenuOpen(false); setCloudOpen(true) }}>
            {t('My drawings…')}
          </button>
          <button role="menuitem" data-testid="account-save" onClick={() => void saveCurrent()} disabled={saving}>
            {saving ? t('Saving…') : t('Save to cloud')}
          </button>
          <div className="tb-account-sep" />
          <a role="menuitem" className="tb-account-link" href="https://github.com/sponsors/Coldbari"
            target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
            {t('Buy me a coffee ☕')}
          </a>
          <button role="menuitem" onClick={() => { setMenuOpen(false); void signOutUser() }}>{t('Sign out')}</button>
        </Popover>
      )}
      {status && <span className="tb-account-status" role="status">{status}</span>}
      {cloudOpen && <CloudDialog open onClose={() => setCloudOpen(false)} />}
    </div>
  )
}
