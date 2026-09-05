// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useState } from 'react'
import { useStore } from '../store/store'
import { confirmAction } from '../feedback/notices'

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
  const dirty = useStore((s) => s.dirty)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    if (dirty) {
      const ok = await confirmAction({
        title: 'Reload for the latest version?',
        body: 'This drawing has unsaved changes. They are autosaved on this machine and will be offered back when the page returns, but an edit from the last few seconds may not have reached the autosave yet.',
        confirmLabel: 'Reload',
      })
      if (!ok) return
    }
    setBusy(true)
    void forceRefresh()
  }

  return (
    <button type="button" className="version-chip" data-testid="version-chip"
      onClick={() => void refresh()} disabled={busy} title={BLURB}>
      v{__APP_VERSION__} · {busy ? 'refreshing…' : 'updates often'}
    </button>
  )
}

/** Homepage strip. Same message, room to say it in full. */
export function VersionBanner() {
  return (
    <div className="version-banner" role="status">
      <strong>In active development</strong>
      <span>
        v{__APP_VERSION__} — new versions ship often. If something looks out of date, reload the page
        (or press {navigator.platform.toLowerCase().includes('mac') ? '⌘⇧R' : 'Ctrl+Shift+R'}).
      </span>
      <button type="button" onClick={() => void forceRefresh()} data-testid="version-refresh">
        Get the latest
      </button>
    </div>
  )
}
