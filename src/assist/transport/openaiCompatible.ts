// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { AssistEvent, AssistMessage, AssistRequest, AssistTransport } from './types'
import { errorFor, messageFromBody, sseLines } from './types'

/** Our neutral message shape -> OpenAI chat-completions messages. */
function toOpenAiMessages(system: string, messages: AssistMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('')
    const calls = m.content.filter((b) => b.type === 'tool_use')
    const results = m.content.filter((b) => b.type === 'tool_result')

    // tool results are their own role in the OpenAI shape, one message each
    for (const r of results) {
      if (r.type !== 'tool_result') continue
      out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content })
    }
    if (m.role === 'assistant' && calls.length > 0) {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((c) => c.type === 'tool_use' ? {
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        } : null).filter(Boolean),
      })
    } else if (text) {
      out.push({ role: m.role, content: text })
    }
  }
  return out
}

interface PartialCall { id: string; name: string; args: string }

export interface OpenAiCompatibleConfig {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  model: string
  /** Provider-specific headers (OpenRouter wants attribution, for example). */
  extraHeaders?: Record<string, string>
  /** Overrides the default GET {baseUrl}/models listing. */
  listModels?: () => Promise<string[]>
  /** Listing works without a key on some providers (OpenRouter's is public). */
  keylessListing?: boolean
}

/**
 * Every OpenAI-shaped chat-completions provider, once.
 *
 * Groq, OpenRouter, Cerebras, Together and friends all speak the same wire
 * format, so they share one adapter and differ only in a base URL, a key
 * prefix and how they answer "what models may I use". Adding the next one is a
 * config object, not another 120 lines of SSE parsing to get subtly wrong.
 *
 * Tool arguments arrive as a stream of JSON *fragments* keyed by index, so they
 * are accumulated and parsed only at the end — parsing a fragment yields
 * plausible-looking garbage, which is the one thing this feature must not do.
 */
export function openAiCompatibleTransport(cfg: OpenAiCompatibleConfig): AssistTransport {
  const headers = () => ({
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.apiKey}`,
    ...cfg.extraHeaders,
  })

  return {
    id: cfg.id,
    label: `${cfg.label} (${cfg.model || 'no model chosen'})`,
    isConfigured: () => cfg.apiKey.length > 0 && cfg.model.length > 0,

    async listModels(): Promise<string[]> {
      if (cfg.listModels) return cfg.listModels()
      const res = await fetch(`${cfg.baseUrl}/models`, { headers: headers() })
      if (!res.ok) throw new Error(messageFromBody(await res.text().catch(() => ''), res.statusText))
      const body = await res.json() as { data?: { id?: string }[] }
      return (body.data ?? [])
        .map((m) => m.id ?? '')
        .filter((id) => id && !/whisper|tts|guard|embed/i.test(id))
        .sort()
    },

    async *send(req: AssistRequest, signal: AbortSignal): AsyncIterable<AssistEvent> {
      if (!cfg.model) {
        yield { type: 'error', code: 'bad_request', retryable: false, message: 'No model selected — open ⚙ and press "Load models".' }
        return
      }
      let res: Response
      try {
        res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          signal,
          headers: headers(),
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: req.maxTokens,
            stream: true,
            messages: toOpenAiMessages(req.system, req.messages),
            ...(req.tools.length > 0
              ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.inputSchema },
                })),
                tool_choice: 'auto',
              }
              : {}),
          }),
        })
      } catch (e) {
        yield { type: 'error', code: 'network', message: (e as Error).message, retryable: true }
        return
      }

      if (!res.ok) {
        const detail = messageFromBody(await res.text().catch(() => ''), res.statusText)
        // The single most likely failure: a model id this account cannot use.
        // Say what to do about it rather than echoing the provider's JSON.
        const hint = /model/i.test(detail) && /not exist|not found|access|invalid/i.test(detail)
          ? ' — open ⚙ and press "Load models" to pick one your key can actually use.'
          : ''
        yield errorFor(res.status, detail + hint)
        return
      }

      const calls = new Map<number, PartialCall>()
      let stop: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'

      for await (const data of sseLines(res, signal)) {
        if (data === '[DONE]') break
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(data) } catch { continue }

        // some providers stream an error object mid-stream instead of a status
        const streamErr = parsed.error as { message?: string } | undefined
        if (streamErr?.message) {
          yield { type: 'error', code: 'server', message: streamErr.message, retryable: true }
          return
        }

        const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
        if (usage) yield { type: 'usage', inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 }

        const choice = (parsed.choices as { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined)?.[0]
        if (!choice) continue

        const content = choice.delta?.content
        if (typeof content === 'string' && content) yield { type: 'text_delta', text: content }

        for (const tc of (choice.delta?.tool_calls as { index: number; id?: string; function?: { name?: string; arguments?: string } }[] | undefined) ?? []) {
          const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' }
          calls.set(tc.index, {
            id: tc.id ?? cur.id,
            name: tc.function?.name ?? cur.name,
            args: cur.args + (tc.function?.arguments ?? ''),
          })
        }

        if (choice.finish_reason === 'tool_calls') stop = 'tool_use'
        else if (choice.finish_reason === 'length') stop = 'max_tokens'
      }

      for (const call of calls.values()) {
        let input: unknown = {}
        try { input = call.args ? JSON.parse(call.args) : {} } catch {
          yield { type: 'error', code: 'bad_request', message: `Tool "${call.name}" arrived with unparseable arguments.`, retryable: false }
          continue
        }
        yield { type: 'tool_use', id: call.id || `call_${call.name}`, name: call.name, input }
      }

      yield { type: 'stop', reason: calls.size > 0 ? 'tool_use' : stop }
    },
  }
}

export const groqTransport = (apiKey: string, model = ''): AssistTransport =>
  openAiCompatibleTransport({ id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey, model })
