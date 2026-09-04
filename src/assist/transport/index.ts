// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { AssistTransport } from './types'
import { groqTransport } from './openaiCompatible'
import { openRouterTransport } from './openrouter'
import { anthropicTransport } from './anthropic'

export { freeOpenRouterModels } from './openrouter'

const KEY_STORAGE = 'pid.assist.key'
const MODEL_STORAGE = 'pid.assist.model'
const FALLBACK_STORAGE = 'pid.assist.fallback'
const CONSENT_STORAGE = 'pid.assist.consent'

export type Provider = 'groq' | 'openrouter' | 'anthropic' | 'unknown'

export const PROVIDER_INFO: Record<Exclude<Provider, 'unknown'>, { name: string; free: string; signup: string }> = {
  openrouter: {
    name: 'OpenRouter',
    free: 'Open-weight models served free — Gemma, Nemotron, MiniMax and others. Rate-limited, no card.',
    signup: 'openrouter.ai/keys',
  },
  groq: {
    name: 'Groq',
    free: 'Free tier with fast open-weight models. Model availability depends on your tier.',
    signup: 'console.groq.com/keys',
  },
  anthropic: {
    name: 'Anthropic',
    free: 'Paid — no free tier.',
    signup: 'console.anthropic.com',
  },
}

/**
 * Which service a key belongs to, from its own prefix.
 *
 * One settings field rather than a provider dropdown: the user pastes whatever
 * key they have and the app works out where it goes. Getting this wrong sends a
 * key to the wrong vendor, so it is prefix matching and never a guess — an
 * unrecognised key is reported, not attempted.
 */
export function providerOf(key: string): Provider {
  const k = key.trim()
  // order matters: sk-or-v1- would also satisfy a looser sk- test
  if (k.startsWith('sk-or-')) return 'openrouter'
  if (k.startsWith('gsk_')) return 'groq'
  if (k.startsWith('sk-ant-')) return 'anthropic'
  return 'unknown'
}

export function readKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) ?? '' } catch { return '' }
}

export function saveKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim())
    else localStorage.removeItem(KEY_STORAGE)
  } catch { /* private mode — the assistant just stays unconfigured */ }
}

export function readModel(): string {
  try { return localStorage.getItem(MODEL_STORAGE) ?? '' } catch { return '' }
}

export function saveModel(model: string): void {
  try {
    if (model.trim()) localStorage.setItem(MODEL_STORAGE, model.trim())
    else localStorage.removeItem(MODEL_STORAGE)
  } catch { /* ignore */ }
}

export function readFallback(): string {
  try { return localStorage.getItem(FALLBACK_STORAGE) ?? '' } catch { return '' }
}

export function saveFallback(model: string): void {
  try {
    if (model.trim()) localStorage.setItem(FALLBACK_STORAGE, model.trim())
    else localStorage.removeItem(FALLBACK_STORAGE)
  } catch { /* ignore */ }
}

/** Recorded once, with the provider it was given for — a new provider re-asks. */
export function hasConsented(provider: Provider): boolean {
  try { return localStorage.getItem(CONSENT_STORAGE) === provider } catch { return false }
}

export function recordConsent(provider: Provider): void {
  try { localStorage.setItem(CONSENT_STORAGE, provider) } catch { /* ignore */ }
}

/**
 * Degrades exactly the way the rest of the app does (see src/auth/config.ts):
 * with no key there is no transport, the panel says so, and every other feature
 * is untouched. The assistant is additive or it is absent — never broken.
 */
/** A transport for a key the user has typed but not yet saved, so the settings
 *  panel can list that key's models before committing anything. */
export function transportForKey(key: string, model?: string): AssistTransport | null {
  switch (providerOf(key)) {
    case 'openrouter': return openRouterTransport(key.trim(), model ?? '', readFreeOnly())
    case 'groq': return groqTransport(key.trim(), model ?? '')
    case 'anthropic': return anthropicTransport(key.trim(), model || undefined)
    default: return null
  }
}

/** OpenRouter serves both free and paid models on one key. Default to free:
 *  someone who came here for a free model should not spend by accident. */
export function readFreeOnly(): boolean {
  try { return localStorage.getItem('pid.assist.freeOnly') !== '0' } catch { return true }
}

export function saveFreeOnly(on: boolean): void {
  try { localStorage.setItem('pid.assist.freeOnly', on ? '1' : '0') } catch { /* ignore */ }
}

export function pickTransport(): AssistTransport | null {
  const key = readKey()
  if (!key) return null
  const primary = transportForKey(key, readModel())
  if (!primary) return null
  const fallbackModel = readFallback()
  if (!fallbackModel || fallbackModel === readModel()) return primary
  const backup = transportForKey(key, fallbackModel)
  return backup ? withFallback(primary, backup) : primary
}

/**
 * Run the second model when the first one is out of road.
 *
 * Only on rate_limit — a quota or per-minute cap. NOT on auth (a bad key is bad
 * on both) and NOT on bad_request (a malformed call fails identically twice,
 * and retrying would just spend the fallback's quota to reproduce the bug).
 *
 * The switch happens before any text has been yielded, so the user never sees
 * half an answer from one model finished by another.
 */
function withFallback(primary: AssistTransport, backup: AssistTransport): AssistTransport {
  return {
    id: primary.id,
    label: `${primary.label} → ${backup.label}`,
    isConfigured: () => primary.isConfigured(),
    listModels: () => primary.listModels(),
    async *send(req, signal) {
      const buffered: Parameters<typeof Array.prototype.push>[0][] = []
      let rateLimited = false
      for await (const ev of primary.send(req, signal)) {
        if (ev.type === 'error' && ev.code === 'rate_limit' && buffered.length === 0) { rateLimited = true; break }
        buffered.push(ev)
        yield ev
      }
      if (!rateLimited || signal.aborted) return
      yield { type: 'text_delta', text: `[${primary.label} is rate-limited — switching to ${backup.label}]\n\n` }
      yield* backup.send(req, signal)
    },
  }
}

export type { AssistTransport } from './types'
