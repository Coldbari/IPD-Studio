// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { lazy, Suspense, useEffect } from 'react'
import App from './App'
import AuthScreen from './auth/AuthScreen'
import { useStore } from './store/store'
import { useAuthStore } from './auth/authStore'
import { firebaseReady } from './auth/config'
import { ensureAuth } from './auth/session'
import { startAutosave, restoreAutosave } from './persist/autosave'
import { startCloudAutosave } from './cloud/autosave'
import WorkspaceRail from './WorkspaceRail'
import CommandPalette from './panels/CommandPalette'
import UpdateToast from './panels/UpdateToast'
import { navigateWorkspace, useWorkspace } from './routes'
import { tr, useT } from './i18n'

// Split at the workspace boundary, the way the homepage is already split from
// the editor: Draw must not pay for the HMI simulator or the report tables.
const DataWorkspace = lazy(() => import('./workspaces/DataWorkspace'))
const ChecksWorkspace = lazy(() => import('./workspaces/ChecksWorkspace'))
const HmiWorkspace = lazy(() => import('./hmi/HmiWorkspace'))

/**
 * The editor shell. The rail and the command palette live out here so they
 * persist across workspaces — switching screens must never cost you Ctrl+K.
 */
function Workspaces() {
  const t = useT()
  const workspace = useWorkspace()
  return (
    <div className="shell">
      <WorkspaceRail active={workspace} />
      <div className="shell-body">
        {workspace === 'draw' ? (
          <App />
        ) : (
          <Suspense fallback={<div className="route-loading">{t('Loading…')} {workspace}…</div>}>
            {workspace === 'data' && <DataWorkspace />}
            {workspace === 'checks' && <ChecksWorkspace />}
            {workspace === 'hmi' && <HmiWorkspace onExit={() => navigateWorkspace('draw')} />}
          </Suspense>
        )}
      </div>
      <CommandPalette />
      <UpdateToast />
    </div>
  )
}

/** Editor-only bootstrapping. This used to run at module scope in main.tsx,
 *  which meant a visitor reading the homepage paid for autosave restore and a
 *  file-handler registration they will never use. It now runs only once
 *  someone is actually through the door. */
let booted = false

function bootEditor(): void {
  if (booted) return
  booted = true

  startAutosave()
  startCloudAutosave()
  void restoreAutosave().then((saved) => {
    if (saved && window.confirm(`${tr('Restore autosaved drawing?')} ${saved.meta.name}`)) {
      useStore.getState().loadIntoStore(saved)
    }
  })

  // Installed-PWA file handling: double-clicked .pnid files arrive here.
  interface LaunchQueueWindow extends Window {
    launchQueue?: { setConsumer(cb: (params: { files: { getFile(): Promise<File> }[] }) => void): void }
  }
  ;(window as LaunchQueueWindow).launchQueue?.setConsumer((params) => {
    void (async () => {
      const handle = params.files?.[0]
      if (!handle) return
      const file = await handle.getFile()
      const { loadAnyText } = await import('./persist/file')
      loadAnyText(file.name, await file.text())
    })()
  })
}

/**
 * Test seam, development builds only. Firebase keeps its session in IndexedDB,
 * which Playwright's storageState cannot carry between contexts, so without
 * this every editor spec would have to drive the sign-in form first. The branch
 * is compiled out of production — `import.meta.env.DEV` is substituted at build
 * time — so it can never open the real app.
 */
function devBypass(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return localStorage.getItem('pid.dev.skipAuth') === '1'
  } catch {
    return false
  }
}

export default function EditorRoot() {
  const t = useT()
  const user = useAuthStore((s) => s.user)
  const ready = useAuthStore((s) => s.ready)
  // With no Firebase project configured — a fork, or a local build with no
  // .env.local — there is no account system to gate on, so the editor opens
  // straight into fully local mode. Gating on an account that can never exist
  // would leave a fork with a permanently locked door.
  const allowed = !firebaseReady || Boolean(user) || devBypass()

  useEffect(() => {
    if (firebaseReady) ensureAuth()
  }, [])

  useEffect(() => {
    if (allowed) bootEditor()
  }, [allowed])

  if (firebaseReady && !ready && !devBypass()) {
    return <div className="route-loading">{t('Checking your account…')}</div>
  }
  if (!allowed) return <AuthScreen />
  return <Workspaces />
}
