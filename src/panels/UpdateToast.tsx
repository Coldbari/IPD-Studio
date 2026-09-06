// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'
import { forceRefresh } from './VersionNote'
import { useT } from '../i18n'

let doUpdate: (() => Promise<void>) | null = null

/** Unmissable new-version prompt. Fixes the two stale-PWA gaps: the service
 *  worker now re-checks hourly and on tab focus (not only at page load), and
 *  the toast renders in BOTH workspaces (the old status-bar chip never
 *  existed in the HMI). */
export default function UpdateToast() {
  const t = useT()
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!import.meta.env.PROD) return
    let iv: number | undefined
    let visListener: (() => void) | null = null
    void import('virtual:pwa-register').then(({ registerSW }) => {
      const update = registerSW({
        onNeedRefresh: () => setReady(true),
        onRegisteredSW: (_url, reg) => {
          if (!reg) return
          const check = () => void reg.update().catch(() => undefined)
          iv = window.setInterval(check, 60 * 60 * 1000)
          visListener = () => { if (!document.hidden) check() }
          document.addEventListener('visibilitychange', visListener)
        },
      })
      doUpdate = () => update(true)
    }).catch(() => undefined)
    return () => {
      if (iv !== undefined) clearInterval(iv)
      if (visListener) document.removeEventListener('visibilitychange', visListener)
    }
  }, [])
  if (!ready) return null

  /**
   * "Reload now" has to actually reload.
   *
   * vite-plugin-pwa's updateSW ignores its reloadPage argument in prompt mode:
   * all it does is post SKIP_WAITING, and the reload rides on a `controlling`
   * event that only fires when there IS a waiting worker to skip. If the new
   * worker already activated, or workbox-window failed to import (leaving the
   * skip-waiting sender undefined), the click was a silent no-op. So ask
   * nicely first, then guarantee it.
   */
  const reload = () => {
    setBusy(true)
    void (async () => {
      try {
        await doUpdate?.()
      } catch {
        // the fallback below is the thing that actually gets the user unstuck
      }
    })()
    // If the service worker handshake works, the page is gone long before
    // this fires. If it does not, this clears the caches and reloads anyway.
    window.setTimeout(() => { void forceRefresh() }, 1500)
  }

  return (
    <div className="update-toast" role="status">
      <span>⟳ {t('A new version of IPD Studio is ready')}</span>
      <button onClick={reload} disabled={busy} data-testid="update-reload">
        {busy ? t('Reloading…') : t('Reload now')}
      </button>
    </div>
  )
}
