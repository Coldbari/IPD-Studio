// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useSyncExternalStore } from 'react'

/**
 * Which symbols this person reaches for.
 *
 * Deliberately NOT in the document. A drawing is an engineering deliverable
 * that gets exported, diffed, issued and handed to a contractor; whose palette
 * had a butterfly valve in it last Tuesday is not part of that, and putting it
 * there would change the bytes of a .pnid for a reason no reviewer could
 * explain. It lives in localStorage beside the panel widths, under the same
 * `pid.` prefix.
 *
 * A **recent** is earned by placing a symbol on the sheet — not by searching
 * for it, hovering it, or seeing it in a result list. Anything looser and the
 * list fills with things the engineer looked at and rejected, which is the
 * opposite of useful.
 *
 * A **favourite** is chosen explicitly and stays until it is unchosen.
 */

const RECENT_KEY = 'pid.ui.recentSymbols'
const FAV_KEY = 'pid.ui.favouriteSymbols'

/** Short enough to stay a shortcut rather than becoming a second library. */
export const RECENT_MAX = 8

/** A placeable thing: a symbol, or the instrument bubble with preset letters.
 *  Stored as one string so the whole list is a plain array of keys. */
export type ComponentKey = string

export function componentKey(symbolId: string, presetLetters?: string): ComponentKey {
  return presetLetters ? `${symbolId}#${presetLetters}` : symbolId
}

export function splitKey(key: ComponentKey): { symbolId: string; presetLetters?: string } {
  const at = key.indexOf('#')
  return at < 0
    ? { symbolId: key }
    : { symbolId: key.slice(0, at), presetLetters: key.slice(at + 1) }
}

function read(key: string): ComponentKey[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // Anything else in the slot is someone else's data or a corrupted write;
    // an empty list is always a safe answer for a preference.
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, list: ComponentKey[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* private mode, or the quota is full — the palette still works */
  }
}

// Module-level store with a subscriber set, the shape validate/live.ts and
// feedback/notices.ts already use: only the components that read this
// re-render, and the canvas never hears about it at all.
const listeners = new Set<() => void>()
let recent: ComponentKey[] = read(RECENT_KEY)
let favourites: ComponentKey[] = read(FAV_KEY)

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function recentSnapshot(): ComponentKey[] {
  return recent
}

export function favouritesSnapshot(): ComponentKey[] {
  return favourites
}

/**
 * Record a placement. Called from the ONE place a symbol actually lands on the
 * sheet, so a search that finds a pump and a drag that is cancelled halfway
 * both leave the list alone.
 */
export function notePlacement(symbolId: string, presetLetters?: string): void {
  const key = componentKey(symbolId, presetLetters)
  const next = [key, ...recent.filter((k) => k !== key)].slice(0, RECENT_MAX)
  if (next.length === recent.length && next.every((k, i) => k === recent[i])) return
  recent = next
  write(RECENT_KEY, recent)
  emit()
}

export function isFavourite(symbolId: string, presetLetters?: string): boolean {
  return favourites.includes(componentKey(symbolId, presetLetters))
}

export function toggleFavourite(symbolId: string, presetLetters?: string): void {
  const key = componentKey(symbolId, presetLetters)
  favourites = favourites.includes(key)
    ? favourites.filter((k) => k !== key)
    : [...favourites, key]
  write(FAV_KEY, favourites)
  emit()
}

export function useRecentComponents(): ComponentKey[] {
  return useSyncExternalStore(subscribe, recentSnapshot, recentSnapshot)
}

export function useFavouriteComponents(): ComponentKey[] {
  return useSyncExternalStore(subscribe, favouritesSnapshot, favouritesSnapshot)
}

/** Test seam. */
export function resetComponentPrefs(): void {
  recent = []
  favourites = []
  write(RECENT_KEY, recent)
  write(FAV_KEY, favourites)
  emit()
}
