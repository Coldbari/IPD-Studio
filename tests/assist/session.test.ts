import { beforeEach, describe, expect, it } from 'vitest'
import '../../src/symbols/lib/index'
import { runTurn, type TurnUpdate } from '../../src/assist/session'
import type { AssistEvent, AssistRequest, AssistTransport } from '../../src/assist/transport/types'
import { useStore } from '../../src/store/store'
import { createEmptyDoc } from '../../src/model/doc'
import { resetQaCache } from '../../src/validate/engine'

const st = () => useStore.getState()

/** A transport that replays a script. No network, no model, fully deterministic —
 *  which is the point of putting every provider behind one interface. */
function scripted(turns: AssistEvent[][]): AssistTransport & { seen: AssistRequest[] } {
  let i = 0
  const seen: AssistRequest[] = []
  return {
    id: 'scripted',
    label: 'scripted',
    seen,
    isConfigured: () => true,
    listModels: async () => ['scripted-model'],
    async *send(req) {
      seen.push(req)
      for (const ev of turns[i] ?? [{ type: 'stop', reason: 'end_turn' }]) yield ev
      i++
    },
  }
}

async function run(transport: AssistTransport, question = 'what is here?') {
  const updates: TurnUpdate[] = []
  await runTurn({
    transport,
    question,
    signal: new AbortController().signal,
    history: [],
    onUpdate: (u) => updates.push(u),
  })
  return updates
}

const last = (u: TurnUpdate[]) => u[u.length - 1]!

beforeEach(() => {
  st().loadIntoStore(createEmptyDoc('session'))
  resetQaCache()
  st().addNode({ symbolId: 'instr.bubble', kind: 'instrument', x: 0, y: 0, rotation: 0, tag: { letters: 'FT', loop: '101' } })
  resetQaCache()
})

describe('the assistant turn', () => {
  it('reads a tool, then answers', async () => {
    const t = scripted([
      [{ type: 'tool_use', id: 'c1', name: 'get_selection', input: {} }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'FT-101 is the only tagged item.' }, { type: 'stop', reason: 'end_turn' }],
    ])
    const u = await run(t)
    expect(last(u).status).toBe('done')
    expect(last(u).text).toContain('FT-101')
    expect(last(u).trace.map((x) => x.name)).toEqual(['get_selection'])
  })

  it('BLOCKS an invented tag and makes the model try again with real ones', async () => {
    const t = scripted([
      [{ type: 'text_delta', text: 'FT-205 is downstream.' }, { type: 'stop', reason: 'end_turn' }],
      [{ type: 'text_delta', text: 'Only FT-101 is tagged here.' }, { type: 'stop', reason: 'end_turn' }],
    ])
    const u = await run(t)
    expect(last(u).status).toBe('done')
    expect(last(u).text).toBe('Only FT-101 is tagged here.')
    // the retry was told what was wrong, and what is real
    const correction = JSON.stringify(t.seen[1]!.messages)
    expect(correction).toContain('FT-205')
    expect(correction).toContain('FT-101')
  })

  it('suppresses the answer entirely when the model invents twice', async () => {
    const t = scripted([
      [{ type: 'text_delta', text: 'FT-205 is downstream.' }, { type: 'stop', reason: 'end_turn' }],
      [{ type: 'text_delta', text: 'Actually PT-900 is downstream.' }, { type: 'stop', reason: 'end_turn' }],
    ])
    const u = await run(t)
    expect(last(u).status).toBe('error')
    expect(last(u).text).toBe('')
    expect(last(u).error).toMatch(/not on the drawing/i)
  })

  it('stops and waits for a person before any change is applied', async () => {
    // a real finding with a fix: two identical lines between the same ports
    const a = st().addNode({ symbolId: 'pump.centrifugal', kind: 'equipment', x: 0, y: 200, rotation: 0 })
    const b = st().addNode({ symbolId: 'vessel.tank', kind: 'equipment', x: 300, y: 200, rotation: 0 })
    st().addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    st().addEdge({ lineClass: 'process.major', source: { nodeId: a, portId: 'e' }, target: { nodeId: b, portId: 'w' } })
    resetQaCache()
    const key = `duplicate-parallel-line:${st().doc.sheets[0]!.edges[1]!.id}`

    const before = st().doc
    const t = scripted([
      [{ type: 'tool_use', id: 'c1', name: 'propose_fix', input: { findingKey: key } }, { type: 'stop', reason: 'tool_use' }],
    ])
    const u = await run(t, 'fix the doubled line')

    expect(last(u).status).toBe('awaiting-approval')
    expect(last(u).proposedSpec).toMatchObject({ kind: 'delete-duplicate-line' })
    // nothing was applied — the document is untouched by identity
    expect(useStore.getState().doc).toBe(before)
  })

  it('refuses a fix the rule engine never offered', async () => {
    const t = scripted([
      [{ type: 'tool_use', id: 'c1', name: 'propose_fix', input: { findingKey: 'made-up:key' } }, { type: 'stop', reason: 'tool_use' }],
      [{ type: 'text_delta', text: 'There is no automatic fix for that.' }, { type: 'stop', reason: 'end_turn' }],
    ])
    const u = await run(t)
    expect(last(u).status).toBe('done')
    expect(last(u).proposedSpec).toBeUndefined()
  })

  it('surfaces a transport error instead of inventing an answer', async () => {
    const t = scripted([[{ type: 'error', code: 'auth', message: 'Invalid API key', retryable: false }]])
    const u = await run(t)
    expect(last(u).status).toBe('error')
    expect(last(u).error).toMatch(/Invalid API key/)
  })

  it('never sends the author name to the provider', async () => {
    st().setMeta({ author: 'Praharsh Nagpure' })
    const t = scripted([[{ type: 'text_delta', text: 'ok' }, { type: 'stop', reason: 'end_turn' }]])
    await run(t)
    expect(JSON.stringify(t.seen[0])).not.toContain('Praharsh Nagpure')
  })
})
