// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { navigate, useRoute } from './routes'
import { tr } from './i18n'

// Split at the route boundary: the homepage must not ship JointJS, the symbol
// catalog and the HMI simulator just to render a headline.
const EditorRoot = lazy(() => import('./EditorRoot'))
const Home = lazy(() => import('./home/Home'))

function Loading({ label }: { label: string }) {
  return <div className="route-loading">{label}</div>
}

function Root() {
  const route = useRoute()

  if (route === 'app') {
    return (
      <Suspense fallback={<Loading label={tr('Loading the editor…')} />}>
        <EditorRoot />
      </Suspense>
    )
  }

  // Signing in and opening the editor are the same journey now: the editor
  // route puts the sign-in screen in front of anyone without an account.
  return (
    <Suspense fallback={<Loading label={tr('Loading…')} />}>
      <Home onSignIn={() => navigate('/app')} onOpenEditor={() => navigate('/app')} />
    </Suspense>
  )
}

// Dev/e2e hook: drive the store from the console or Playwright. Awaited at
// module top level on purpose — the editor is a lazy chunk now, so an effect
// or a floating promise would set this after `load` fires, and the e2e specs
// evaluate `__pid` the instant page.goto() resolves. `import.meta.env.DEV` is
// substituted at build time, so this whole branch is dropped from production
// and neither the store nor JointJS reaches the entry chunk.
if (import.meta.env.DEV) {
  const [{ useStore }, { canvasRef }, { firebaseReady }] = await Promise.all([
    import('./store/store'),
    import('./canvas/paperSetup'),
    // env-only, no firebase/* imports — costs the dev entry chunk nothing
    import('./auth/config'),
  ])
  ;(window as unknown as Record<string, unknown>).__pid = { useStore, canvasRef, firebaseReady }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
