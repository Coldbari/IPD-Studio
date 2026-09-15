// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'
import { useStore } from '../store/store'

/**
 * "Show me that widget" — the HMI twin of `canvas/locate.ts`.
 *
 * A diagnostic about an operator screen has to be able to take you to the
 * screen and the object, the same way a drawing finding takes you to the
 * symbol. Before this, every HMI finding in the Checks report was a sentence
 * with a disabled button beside it.
 *
 * Its OWN store rather than a slice of the document store, for the reason
 * `store/highlight.ts` gives: a request to look at something is not an edit,
 * and it must never reach autosave, cloud sync or the undo history.
 *
 * `nonce` is what makes a repeat request work. Asking for the same widget
 * twice must re-select and re-flash it; without a changing value the
 * subscriber would see identical state and do nothing.
 */
interface LocateRequest {
  screenId: string
  widgetId?: string
  nonce: number
}

export const useHmiLocate = create<{ request: LocateRequest | null }>(() => ({ request: null }))

let nonce = 0

/**
 * Open the screen and ask the workspace to select the widget.
 *
 * Changing the active screen IS a store write, but `setActiveScreen` is
 * navigation state rather than document state — it does not touch `doc`, so it
 * records no undo step and marks nothing dirty.
 */
export function locateHmi(screenId: string, widgetId?: string): void {
  const s = useStore.getState()
  if (s.doc.hmiScreens.some((sc) => sc.id === screenId)) s.setActiveScreen(screenId)
  nonce += 1
  useHmiLocate.setState({ request: { screenId, ...(widgetId ? { widgetId } : {}), nonce } })
}

/** Test seam, and what the workspace calls once it has honoured a request. */
export function clearHmiLocate(): void {
  useHmiLocate.setState({ request: null })
}
