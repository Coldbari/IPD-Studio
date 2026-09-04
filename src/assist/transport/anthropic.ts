// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import type { AssistEvent, AssistMessage, AssistRequest, AssistTransport } from './types'
import { errorFor, messageFromBody, sseLines } from './types'

const BASE = 'https://api.anthropic.com/v1'
const ENDPOINT = `${BASE}/messages`

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5'

function toAnthropicMessages(messages: AssistMessage[]): unknown[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'text') return { type: 'text', text: b.text }
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} }
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) }
    }),
  }))
}

/**
 * Anthropic Messages API, called straight from the browser.
 *
 * `anthropic-dangerous-direct-browser-access` is required and is named exactly
 * what it is: the key sits in the user's browser. That is the accepted trade of
 * BYOK — stated in the first-run disclosure rather than hidden.
 */
export function anthropicTransport(apiKey: string, model = ANTHROPIC_DEFAULT_MODEL): AssistTransport {
  return {
    id: 'anthropic',
    label: `Anthropic (${model})`,
    isConfigured: () => apiKey.length > 0,

    async listModels(): Promise<string[]> {
      const res = await fetch(`${BASE}/models?limit=100`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      })
      if (!res.ok) throw new Error(messageFromBody(await res.text().catch(() => ''), res.statusText))
      const body = await res.json() as { data?: { id?: string }[] }
      return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean)
    },

    async *send(req: AssistRequest, signal: AbortSignal): AsyncIterable<AssistEvent> {
      let res: Response
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model,
            max_tokens: req.maxTokens,
            stream: true,
            system: req.system,
            messages: toAnthropicMessages(req.messages),
            ...(req.tools.length > 0
              ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }
              : {}),
          }),
        })
      } catch (e) {
        yield { type: 'error', code: 'network', message: (e as Error).message, retryable: true }
        return
      }

      if (!res.ok) {
        const detail = messageFromBody(await res.text().catch(() => ''), res.statusText)
        const hint = /model/i.test(detail) && /not exist|not found|access/i.test(detail)
          ? ` — open ⚙ and press "Load models" to pick one your key can actually use.`
          : ''
        yield errorFor(res.status, detail + hint)
        return
      }

      // tool_use input streams as partial_json fragments per content-block index
      const pending = new Map<number, { id: string; name: string; json: string }>()
      let stop: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'

      for await (const data of sseLines(res, signal)) {
        let ev: Record<string, unknown>
        try { ev = JSON.parse(data) } catch { continue }

        switch (ev.type) {
          case 'content_block_start': {
            const block = ev.content_block as { type: string; id?: string; name?: string } | undefined
            if (block?.type === 'tool_use') {
              pending.set(ev.index as number, { id: block.id ?? '', name: block.name ?? '', json: '' })
            }
            break
          }
          case 'content_block_delta': {
            const d = ev.delta as { type: string; text?: string; partial_json?: string }
            if (d.type === 'text_delta' && d.text) yield { type: 'text_delta', text: d.text }
            if (d.type === 'input_json_delta') {
              const cur = pending.get(ev.index as number)
              if (cur) cur.json += d.partial_json ?? ''
            }
            break
          }
          case 'message_delta': {
            const d = ev.delta as { stop_reason?: string } | undefined
            if (d?.stop_reason === 'tool_use') stop = 'tool_use'
            else if (d?.stop_reason === 'max_tokens') stop = 'max_tokens'
            const u = ev.usage as { output_tokens?: number } | undefined
            if (u?.output_tokens) yield { type: 'usage', inputTokens: 0, outputTokens: u.output_tokens }
            break
          }
          case 'error': {
            const e = ev.error as { message?: string } | undefined
            yield { type: 'error', code: 'server', message: e?.message ?? 'Stream error', retryable: true }
            return
          }
        }
      }

      for (const call of pending.values()) {
        let input: unknown = {}
        try { input = call.json ? JSON.parse(call.json) : {} } catch {
          yield { type: 'error', code: 'bad_request', message: `Tool "${call.name}" arrived with unparseable arguments.`, retryable: false }
          continue
        }
        yield { type: 'tool_use', id: call.id, name: call.name, input }
      }

      yield { type: 'stop', reason: pending.size > 0 ? 'tool_use' : stop }
    },
  }
}
