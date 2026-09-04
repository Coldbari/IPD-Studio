// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

export type AssistBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface AssistMessage {
  role: 'user' | 'assistant'
  content: AssistBlock[]
}

export interface AssistToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AssistRequest {
  system: string
  messages: AssistMessage[]
  tools: AssistToolDef[]
  maxTokens: number
}

export type AssistErrorCode = 'auth' | 'rate_limit' | 'network' | 'server' | 'bad_request'

/**
 * Provider-neutral stream events.
 *
 * The load-bearing decision of this file: `send` yields THESE, never raw SSE.
 * All wire-format knowledge — OpenAI-shaped tool_calls, Anthropic content
 * blocks, whatever a hosted proxy chooses to emit — stays behind the iterator,
 * so swapping providers is one line in pickTransport() and the session loop
 * never learns which vendor answered.
 */
export type AssistEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; code: AssistErrorCode; message: string; retryable: boolean }

export interface AssistTransport {
  readonly id: string
  readonly label: string
  /** Mirrors firebaseReady (src/auth/config.ts): the UI asks before offering. */
  isConfigured(): boolean
  send(req: AssistRequest, signal: AbortSignal): AsyncIterable<AssistEvent>
  /** Model ids this ACCOUNT can actually use. Providers retire ids and gate
   *  them by tier, so a hardcoded default is a guess with a shelf life — ask
   *  the account instead of shipping another one. */
  listModels(): Promise<string[]>
}

/** Providers return errors as JSON; showing the raw body is a shrug. */
export function messageFromBody(body: string, fallback: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string }; message?: string }
    return j.error?.message ?? j.message ?? body.slice(0, 300) ?? fallback
  } catch {
    return body.slice(0, 300) || fallback
  }
}

/** Read an SSE body as `data:` payload strings, one per event. */
export async function* sseLines(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim()
      }
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
}

export function errorFor(status: number, message: string): AssistEvent {
  if (status === 401 || status === 403) return { type: 'error', code: 'auth', message, retryable: false }
  if (status === 429) return { type: 'error', code: 'rate_limit', message, retryable: true }
  if (status >= 500) return { type: 'error', code: 'server', message, retryable: true }
  return { type: 'error', code: 'bad_request', message, retryable: false }
}
