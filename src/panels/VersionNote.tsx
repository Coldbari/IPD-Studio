// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useStore } from '../store/store'
import { useT } from '../i18n'

/**
 * Says out loud that IPD Studio ships often, and gives people the one action
 * that guarantees they are on the newest build.
 *
 * A plain reload is not always enough: the app is an installed-capable PWA, so
 * a service worker can keep serving the previous build from cache. This clears
 * the caches and drops the worker before reloading, which is what "hard
 * refresh" actually has to mean here. UpdateToast still offers the ordinary
 * prompt when a new version is detected — this is the manual escape hatch.
 */
export async function forceRefresh(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // A blocked cache or worker API must not stop the reload — that is the
    // part that actually gets the user unstuck.
  }
  window.location.reload()
}

const BLURB =
  'IPD Studio is under active development, so new versions ship often. ' +
  'You are prompted when one is ready; use this to check right now and reload.'

export function VersionChip() {
  const t = useT()
  const dirty = useStore((s) => s.dirty)
  const [busy, setBusy] = useState(false)

  const refresh = () => {
    if (dirty && !window.confirm(t('Reload to get the latest version? Your unsaved changes are autosaved, but any edit from the last moment may be lost.'))) return
    setBusy(true)
    void forceRefresh()
  }

  return (
    <button type="button" className="version-chip" data-testid="version-chip"
      onClick={refresh} disabled={busy} title={t(BLURB)}>
      v{__APP_VERSION__} · {busy ? t('refreshing…') : t('updates often')}
    </button>
  )
}

/** Homepage strip. Same message, room to say it in full. */
export function VersionBanner() {
  const t = useT()
  return (
    <div className="version-banner" role="status">
      <strong>{t('In active development')}</strong>
      <span>
        v{__APP_VERSION__} — {t('New versions ship often. If something looks out of date, reload the page')}
        ({t('or press')} {navigator.platform.toLowerCase().includes('mac') ? '⌘⇧R' : 'Ctrl+Shift+R'}).
      </span>
      <button type="button" onClick={() => void forceRefresh()} data-testid="version-refresh">
        {t('Get the latest')}
      </button>
    </div>
  )
}
