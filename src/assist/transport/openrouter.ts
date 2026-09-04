// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { AssistTransport } from './types'
import { messageFromBody } from './types'
import { openAiCompatibleTransport } from './openaiCompatible'

const BASE = 'https://openrouter.ai/api/v1'

interface OrModel {
  id?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
}

/**
 * Every model OpenRouter will serve for nothing, that can also call tools.
 *
 * Both filters matter. Free-but-toolless is useless here — the assistant works
 * by calling tools to read the drawing, and a model that cannot call one has
 * nothing to ground an answer on and will simply invent a P&ID.
 *
 * The listing endpoint is PUBLIC, so this works before the user has a key —
 * they can see what they would get before signing up for anything. Pricing is
 * read live rather than hardcoded, because a model that is free today is a
 * paid model next quarter and a baked-in id is a guess with a shelf life.
 */
export async function freeOpenRouterModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/models`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(messageFromBody(await res.text().catch(() => ''), res.statusText))
  const body = await res.json() as { data?: OrModel[] }
  return (body.data ?? [])
    .filter((m) =>
      Number(m.pricing?.prompt) === 0
      && Number(m.pricing?.completion) === 0
      && (m.supported_parameters ?? []).includes('tools'))
    // biggest context first: this assistant sends a selection brief plus tool
    // results, and the roomier models simply fail less often
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
    .map((m) => m.id ?? '')
    .filter(Boolean)
}

/** Every model on OpenRouter, free or paid, that can call tools. */
export async function allOpenRouterModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/models`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(messageFromBody(await res.text().catch(() => ''), res.statusText))
  const body = await res.json() as { data?: OrModel[] }
  return (body.data ?? [])
    .filter((m) => (m.supported_parameters ?? []).includes('tools'))
    .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
    .map((m) => m.id ?? '')
    .filter(Boolean)
}

export function openRouterTransport(apiKey: string, model = '', freeOnly = true): AssistTransport {
  return openAiCompatibleTransport({
    id: 'openrouter',
    label: freeOnly ? 'OpenRouter (free)' : 'OpenRouter',
    baseUrl: BASE,
    apiKey,
    model,
    // OpenRouter asks callers to identify themselves; it also puts the app on
    // their leaderboard rather than showing up as anonymous traffic.
    extraHeaders: {
      'HTTP-Referer': 'https://pid-studio-praharsh.web.app',
      'X-Title': 'IPD Studio',
    },
    listModels: freeOnly ? freeOpenRouterModels : allOpenRouterModels,
    keylessListing: true,
  })
}
