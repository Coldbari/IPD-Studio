// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState } from 'react'

/** The marketing homepage lives at `/`; the editor at `/app`. Anything else
 *  falls back to the homepage — Firebase Hosting rewrites `**` to index.html,
 *  so an unknown deep link still lands here rather than 404ing. */
export type Route = 'home' | 'app'

/**
 * The editor is no longer one screen. Each workspace is a real route so it is
 * linkable, survives the back button, and can be a lazy chunk of its own —
 * `draw` must not pay for the tables or the HMI simulator.
 */
export type Workspace = 'draw' | 'data' | 'checks' | 'standards' | 'hmi' | 'project'

/**
 * Order is the navigation contract: the rail binds Ctrl+1…Ctrl+N by POSITION.
 * `project` is APPENDED rather than placed first, where an overview screen
 * would otherwise belong, so every existing shortcut keeps the workspace it
 * has always opened. Muscle memory is not worth a tidier list.
 */
export const WORKSPACES: readonly Workspace[] = ['draw', 'data', 'checks', 'standards', 'hmi', 'project']

export function routeFor(pathname: string): Route {
  return /^\/app(\/|$)/.test(pathname) ? 'app' : 'home'
}

/** `/app/data` → 'data'. Anything unrecognised — including bare `/app` and the
 *  older `/app/sheet/2` style deep links — opens the drawing, which is what
 *  someone typing a URL into the editor almost always wants. */
export function workspaceFor(pathname: string): Workspace {
  const m = /^\/app\/([^/]+)/.exec(pathname)
  const found = WORKSPACES.find((w) => w === m?.[1])
  return found ?? 'draw'
}

export function currentRoute(): Route {
  return routeFor(window.location.pathname)
}

export function currentWorkspace(): Workspace {
  return workspaceFor(window.location.pathname)
}

const listeners = new Set<() => void>()

export function navigate(path: string): void {
  if (path === window.location.pathname) return
  window.history.pushState(null, '', path)
  listeners.forEach((fn) => fn())
}

export function navigateWorkspace(workspace: Workspace): void {
  navigate(`/app/${workspace}`)
}

/** Shared subscription plumbing: both hooks re-read on pushState and popstate. */
function useLocationValue<T>(read: () => T): T {
  const [value, setValue] = useState(read)
  useEffect(() => {
    const sync = () => setValue(read())
    listeners.add(sync)
    window.addEventListener('popstate', sync)
    return () => {
      listeners.delete(sync)
      window.removeEventListener('popstate', sync)
    }
    // `read` is a stable module function at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}

export function useRoute(): Route {
  return useLocationValue(currentRoute)
}

export function useWorkspace(): Workspace {
  return useLocationValue(currentWorkspace)
}
