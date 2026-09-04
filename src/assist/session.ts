// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { qaFor } from '../validate/engine'
import { useStore } from '../store/store'
import { selectionBrief } from './context'
import { executeTool, TOOL_DEFS } from './tools'
import { validateGrounding, violationFeedback } from './grounding'
import { redactBrief, disclosureFor } from './redact'
import type { FixSpec } from './fixes'
import type { AssistMessage, AssistTransport } from './transport/types'

/** Hard ceiling per turn. A model that has not answered in eight tool calls is
 *  lost, and letting it keep going spends the user's money to no end. */
const MAX_TOOL_CALLS = 8

/** One retry when the grounding validator rejects the answer. Two failures
 *  means stop generating and show the raw findings instead. */
const MAX_REGENERATIONS = 1

const SYSTEM = `You are an instrumentation and process engineer's assistant inside IPD Studio, a P&ID editor.

You answer questions about ONE specific drawing. You have tools that read it. Follow these rules exactly:

1. Assert nothing that did not come back from a tool result in this turn. If you did not read a tag, you do not know it exists. Never write a tag, line number or symbol id you composed yourself.
2. Call get_selection first for any question about "this", "here", or the current selection.
3. Findings come only from list_findings. Never diagnose a problem the rule engine did not report; instead say what you observe and that no rule covers it.
4. Flow DIRECTION is only known where a line carries a flow arrow. If arrows are unmarked, say you can report adjacency but not direction. Never infer upstream/downstream from position.
5. If the drawing does not hold what was asked — relief sizing, revision history, trip logic, hazard analysis — say so plainly, name what is missing, and stop. A confident answer built on absent data is the worst thing you can produce here.
6. To offer a repair, call propose_fix with a finding key from list_findings where hasFix is true. You cannot invent a repair. The user must approve it; say that you are proposing, not that you have done it.
7. You CAN add things, by proposing them for approval:
   - place_typical — a whole pre-wired, pre-tagged control loop. Prefer this whenever the user wants a control loop; every member shares one loop number and the signal lines are drawn already.
   - place_symbol — one symbol. Call find_symbols FIRST and use an id it returned; ids you invent are rejected. It lands unconnected, so always say which lines the user still needs to draw.
   Nothing is applied until the user presses Allow. Say you are proposing, never that you have done it.
8. What you still cannot do: route or connect lines, move or delete anything, or edit an existing symbol's configuration. When asked for one of those, say so in one plain sentence and then be USEFUL — say exactly what to do by hand and where. Never mention "the rule engine", "hasFix", "finding keys" or any other internal machinery; the user does not have those words and it makes a plain limitation sound like a malfunction.

Good: "I've proposed a globe control valve — approve it and it'll land beside the tank. You'll need to draw the process line from the tank outlet into it yourself; I can't route lines."
Bad: "I'm unable to add a control valve because the rule engine has not generated a hasFix finding for this request."

HOW TO WRITE THE ANSWER — this matters as much as being correct:

- NEVER print an internal id, a "_id" value, a port name like "w1"/"e2", or a finding key. They are handles for the tools, meaningless to an engineer, and printing them makes the answer unreadable. Refer to every object the way the drawing labels it: its tag ("FT-101"), else its label ("Crude Feed"), else its type and where it is ("the untagged storage tank on Sheet 1").
- Do not output tables of properties. Answer the question that was asked, in prose, in two or three sentences.
- Lead with the answer, not with a restatement of the question.
- Say what an engineer would care about — what it is, what it connects to, what is missing or wrong. Not coordinates, not port counts, not ids.

Good: "It's an untagged storage tank on Sheet 1, feeding two gate valves and a globe control valve. It has no tag and no engineering record yet, which is why Checks is flagging it."
Bad: a property table containing IDs, port names, and node handles.

Be brief. Engineers want the answer and the tags involved, not an essay.`

export interface TurnUpdate {
  status: 'thinking' | 'calling' | 'awaiting-approval' | 'done' | 'error'
  text: string
  /** Tool calls made so far, for the transcript. */
  trace: { name: string; summary: string }[]
  proposedSpec?: FixSpec
  error?: string
}

export interface RunOptions {
  transport: AssistTransport
  question: string
  signal: AbortSignal
  onUpdate: (u: TurnUpdate) => void
  /** Conversation so far, so follow-ups keep context. Mutated in place. */
  history: AssistMessage[]
}

/**
 * One turn of the assistant.
 *
 * The shape is: read freely, answer once. Read tools loop unattended because
 * their failure mode is a wrong answer, not a wrong drawing — and nearly all
 * the value of re-planning lives in the read phase. Anything that would CHANGE
 * the drawing stops the turn and waits for a person.
 */
export async function runTurn(opts: RunOptions): Promise<void> {
  const { transport, question, signal, onUpdate, history } = opts
  const trace: { name: string; summary: string }[] = []
  const allowedRefs = new Set<string>()
  let regenerations = 0

  history.push({ role: 'user', content: [{ type: 'text', text: question }] })

  const emit = (u: Partial<TurnUpdate> & { status: TurnUpdate['status'] }) =>
    onUpdate({ text: '', trace: [...trace], ...u })

  for (let call = 0; call <= MAX_TOOL_CALLS; call++) {
    if (signal.aborted) return

    const s = useStore.getState()
    const report = qaFor(s.doc)
    const ix = report.index
    const brief = selectionBrief(s.doc, s.activeSheetId, s.selection)

    emit({ status: call === 0 ? 'thinking' : 'calling' })

    let text = ''
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = []
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'
    let failure: string | null = null

    const stream = transport.send(
      {
        system: `${SYSTEM}\n\nCurrent selection:\n${JSON.stringify(redactBrief(brief))}`,
        messages: history,
        tools: TOOL_DEFS,
        maxTokens: 2048,
      },
      signal,
    )

    for await (const ev of stream) {
      if (signal.aborted) return
      if (ev.type === 'text_delta') { text += ev.text; emit({ status: 'thinking', text }) }
      else if (ev.type === 'tool_use') toolCalls.push({ id: ev.id, name: ev.name, input: (ev.input ?? {}) as Record<string, unknown> })
      else if (ev.type === 'stop') stopReason = ev.reason
      else if (ev.type === 'error') failure = ev.message
    }

    if (failure) { emit({ status: 'error', text, error: failure }); return }

    // --- the model wants to read something -------------------------------
    if (stopReason === 'tool_use' && toolCalls.length > 0) {
      if (call === MAX_TOOL_CALLS) {
        emit({ status: 'error', text, error: `Stopped after ${MAX_TOOL_CALLS} tool calls without an answer.` })
        return
      }
      history.push({ role: 'assistant', content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })),
      ] })

      const results = []
      let proposed: FixSpec | undefined
      for (const c of toolCalls) {
        const outcome = executeTool(c.name, c.input, ix, brief)
        trace.push({ name: c.name, summary: outcome.isError ? 'no match' : 'ok' })
        // Anything a tool returned is fair game for the answer to mention.
        for (const m of outcome.content.match(/\b[A-Za-z]{1,5}-\d{1,6}[A-Za-z]?\b/g) ?? []) allowedRefs.add(m.toUpperCase())
        if (outcome.proposedSpec) proposed = outcome.proposedSpec
        results.push({ type: 'tool_result' as const, toolUseId: c.id, content: outcome.content, ...(outcome.isError ? { isError: true } : {}) })
      }
      history.push({ role: 'user', content: results })

      if (proposed) { emit({ status: 'awaiting-approval', text, proposedSpec: proposed }); return }
      continue
    }

    // --- the model has answered ------------------------------------------
    const violations = validateGrounding(text, ix, allowedRefs)
    if (violations.length > 0 && regenerations < MAX_REGENERATIONS) {
      regenerations++
      history.push({ role: 'assistant', content: [{ type: 'text', text }] })
      history.push({ role: 'user', content: [{ type: 'text', text: violationFeedback(violations, ix) }] })
      emit({ status: 'thinking', text: '' })
      continue
    }
    if (violations.length > 0) {
      emit({
        status: 'error',
        text: '',
        error: `The answer referred to objects that are not on the drawing (${violations.map((v) => v.text).join(', ')}), so I have not shown it. Open the Checks workspace for what the rule engine actually found.`,
      })
      return
    }

    history.push({ role: 'assistant', content: [{ type: 'text', text }] })
    emit({ status: 'done', text })
    return
  }
}

export { disclosureFor }
