// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { create } from 'zustand'

export type HighlightTone = 'cite' | 'warn'

interface HighlightState {
  ids: string[]
  tone: HighlightTone
}

/**
 * The assistant's pointer, kept deliberately separate from the user's.
 *
 * Selection belongs to the person drawing: `interactions.ts` uses it for real
 * editing gestures, so an assistant that hovered a citation and stole the
 * selection would destroy the very context its answer was about. This is a
 * second, read-only channel — hovering a chip lights the object up and nothing
 * else changes.
 *
 * It is its OWN store, not a slice of `useStore`, so it can never reach the
 * document, autosave, cloud sync, or the zundo history. A highlight is not an
 * edit and must never appear in undo.
 */
export const useHighlight = create<HighlightState>(() => ({ ids: [], tone: 'cite' }))

export function setHighlight(ids: string[], tone: HighlightTone = 'cite'): void {
  useHighlight.setState({ ids, tone })
}

export function clearHighlight(): void {
  useHighlight.setState({ ids: [], tone: 'cite' })
}
