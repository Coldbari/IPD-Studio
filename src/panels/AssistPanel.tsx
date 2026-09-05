// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { qaFor } from '../validate/engine'
import { selectionBrief } from '../assist/context'
import { matchIntent, runQuery, suggestionsFor, type QuestionId } from '../assist/intent'
import type { Answer, AnswerRow } from '../assist/answer'
import { applyFix, describeFix } from '../assist/fixes'
import { runTurn, type TurnUpdate } from '../assist/session'
import { disclosureFor } from '../assist/redact'
import type { AssistMessage } from '../assist/transport/types'
import {
  hasConsented, pickTransport, providerOf, readFallback, readFreeOnly, readKey,
  readModel, recordConsent, saveFallback, saveFreeOnly, saveKey, saveModel,
  transportForKey, PROVIDER_INFO,
} from '../assist/transport'
import { clearHighlight, setHighlight } from '../store/highlight'
import { locateCell } from '../canvas/locate'
import { showStatus } from '../feedback/notices'

/** One entry in the conversation. A query answer and a model turn are both
 *  just assistant messages, so the transcript reads as one thread rather than
 *  as two features bolted together. */
type ChatBody =
  | { role: 'user'; text: string }
  | { role: 'assistant'; kind: 'answer'; answer: Answer }
  | { role: 'assistant'; kind: 'turn'; turn: TurnUpdate }

/** Intersection, not Omit: Omit<Union, 'id'> collapses the union's branches
 *  into one non-discriminated shape and rejects every literal. */
type ChatItem = ChatBody & { id: number }

/**
 * The engineering assistant.
 *
 * Two layers, in this order on purpose. Questions the drawing can answer
 * exactly are answered exactly — instantly, free, and unable to name an object
 * that is not on a sheet. Only what the queries cannot match reaches a model,
 * and even then it acts through read tools and may not change anything without
 * a person approving it.
 */
export default function AssistPanel({ onCollapse }: { onCollapse?: () => void }) {
  const doc = useStore((s) => s.doc)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const selection = useStore((s) => s.selection)

  const [question, setQuestion] = useState('')
  const [chat, setChat] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [keyDraft, setKeyDraft] = useState(() => readKey())
  const [showSetup, setShowSetup] = useState(false)
  const history = useRef<AssistMessage[]>([])
  const abort = useRef<AbortController | null>(null)
  const nextId = useRef(1)
  const scroller = useRef<HTMLDivElement>(null)

  const brief = useMemo(() => selectionBrief(doc, activeSheetId, selection), [doc, activeSheetId, selection])
  const suggestions = useMemo(() => suggestionsFor(brief), [brief])
  const transport = useMemo(() => pickTransport(), [keyDraft, showSetup])
  const provider = providerOf(readKey())

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [chat, busy])

  const push = (b: ChatBody) => setChat((c) => [...c, { ...b, id: nextId.current++ }])

  const askQuery = (id: QuestionId, asked: string) => {
    push({ role: 'user', text: asked })
    push({ role: 'assistant', kind: 'answer', answer: runQuery(id, qaFor(doc).index, brief) })
  }

  const askModel = async (asked: string) => {
    if (!transport || !hasConsented(provider)) { setShowSetup(true); return }
    push({ role: 'user', text: asked })
    abort.current?.abort()
    abort.current = new AbortController()
    const turnId = nextId.current++
    setChat((c) => [...c, { id: turnId, role: 'assistant', kind: 'turn', turn: { status: 'thinking', text: '', trace: [] } }])
    setBusy(true)
    await runTurn({
      transport,
      question: asked,
      signal: abort.current.signal,
      history: history.current,
      onUpdate: (u) => setChat((c) => c.map((b) => (b.id === turnId ? { ...b, kind: 'turn', turn: u } as ChatItem : b))),
    })
    setBusy(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || busy) return
    setQuestion('')
    const id = matchIntent(q)
    if (id) askQuery(id, q)
    else void askModel(q)
  }

  const subject = brief.focus?.ref
    ?? (brief.selection.kind === 'many' ? `${brief.selection.count} objects` : null)

  return (
    <aside className="assist" data-testid="assist-panel">
      <div className="panel-head">
        <h2>Assistant</h2>
        <span className="sp" />
        {chat.length > 0 && (
          <button className="panel-collapse" title="Clear the conversation"
            onClick={() => { setChat([]); history.current = [] }}>⟲</button>
        )}
        <button className="panel-collapse" title="Model settings" onClick={() => setShowSetup((v) => !v)}>⚙</button>
        {onCollapse && <button className="panel-collapse" title="Hide the panel" onClick={onCollapse}>▸</button>}
      </div>

      <div className="assist-context" data-testid="assist-context">
        {subject ? (
          <>
            <span className="assist-chip subject">{subject}</span>
            {brief.loop && <span className="assist-chip">loop {brief.loop.ref}</span>}
            {brief.findings.length > 0 && <span className="assist-chip warn">{brief.findings.length} flagged</span>}
          </>
        ) : (
          <span className="assist-muted">
            Nothing selected — I'll answer about sheet <b>{brief.project.activeSheet.name}</b>.
          </span>
        )}
      </div>

      <div className="assist-thread" ref={scroller}>
        {showSetup && (
          <ModelSetup keyDraft={keyDraft} setKeyDraft={setKeyDraft}
            disclosure={disclosureFor(doc)} onDone={() => setShowSetup(false)} />
        )}

        {chat.length === 0 && !showSetup && (
          <div className="assist-intro">
            <p>Ask me about this drawing. I read it directly, so I can only tell you what's actually on it.</p>
            <p className="assist-muted">
              {transport
                ? 'Questions I recognise are answered from the drawing instantly. Anything else goes to your model.'
                : 'These need no model and no key.'}
            </p>
          </div>
        )}

        {chat.map((b) => (
          b.role === 'user'
            ? <div key={b.id} className="bubble user" data-testid="bubble-user">{b.text}</div>
            : b.kind === 'answer'
              ? <AnswerBubble key={b.id} answer={b.answer} />
              : <TurnBubble key={b.id} turn={b.turn} />
        ))}

        <div className="assist-suggest">
          {suggestions.slice(0, chat.length === 0 ? 6 : 3).map((s) => (
            <button key={`${s.id}:${s.label}`} className="assist-sugg" disabled={busy}
              onClick={() => askQuery(s.id, s.label)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <form className="assist-composer" onSubmit={submit}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={busy ? 'Thinking…' : 'Ask about the drawing…'}
          aria-label="Ask the assistant"
          data-testid="assist-input"
          disabled={busy}
        />
        {busy
          ? <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
          : <button type="submit" disabled={!question.trim()}>Ask</button>}
      </form>
    </aside>
  )
}

function AssistantBubble({ children, testid }: { children: React.ReactNode; testid: string }) {
  return <div className="bubble assistant" data-testid={testid}>{children}</div>
}

function TurnBubble({ turn }: { turn: TurnUpdate }) {
  const doc = useStore((s) => s.doc)
  const [resolved, setResolved] = useState<null | 'allowed' | 'denied'>(null)
  const spec = turn.proposedSpec
  const described = spec ? describeFix(spec, doc) : null

  return (
    <AssistantBubble testid="assist-turn">
      {turn.status === 'thinking' && !turn.text && <span className="assist-typing"><i /><i /><i /></span>}
      {turn.text && <p className="bubble-text">{turn.text}</p>}

      {turn.trace.length > 0 && (
        <details className="assist-trace" data-testid="assist-trace">
          <summary>Read {turn.trace.length} thing{turn.trace.length === 1 ? '' : 's'} from the drawing</summary>
          <ul>{turn.trace.map((t, i) => <li key={i}>{t.name} — {t.summary}</li>)}</ul>
        </details>
      )}

      {turn.error && <div className="assist-gap" data-testid="assist-error">{turn.error}</div>}

      {described && spec && resolved === null && (
        <div className="assist-consent" data-testid="assist-consent-card">
          <b>{described.title}</b>
          <p>{described.blastRadius}</p>
          <div className="prop-row">
            <button data-testid="assist-approve" onClick={() => {
              const r = applyFix(spec)
              if (!r.ok) {
                showStatus(
                  r.message ?? 'That suggestion no longer applies — the drawing has changed since it was made.',
                  { kind: 'warning' },
                )
              }
              if (r.ok && r.changedIds.length > 0) setHighlight(r.changedIds)
              setResolved('allowed')
            }}>Allow</button>
            <button data-testid="assist-deny" onClick={() => setResolved('denied')}>Deny</button>
          </div>
        </div>
      )}
      {resolved && <div className="assist-muted">{resolved === 'allowed' ? '✓ Applied — Ctrl+Z undoes it.' : 'Not applied.'}</div>}
    </AssistantBubble>
  )
}

function AnswerBubble({ answer }: { answer: Answer }) {
  return (
    <AssistantBubble testid="assist-answer">
      <p className="bubble-text">{answer.headline}</p>

      {answer.gap && (
        <div className="assist-gap">
          <b>The drawing does not say.</b> {answer.gap.missing}
          {answer.gap.fieldKey && <div className="assist-muted">Would live in: <code>{answer.gap.fieldKey}</code></div>}
        </div>
      )}

      {answer.rows.length > 0 && (
        <>
          <ul className="assist-rows">
            {answer.rows.map((r) => <Row key={r.id} row={r} />)}
          </ul>
          <button className="assist-showall"
            onMouseEnter={() => setHighlight(answer.focus)}
            onMouseLeave={clearHighlight}
            onClick={() => setHighlight(answer.focus)}>
            Show all {answer.rows.length} on drawing
          </button>
        </>
      )}
    </AssistantBubble>
  )
}

function Row({ row }: { row: AnswerRow }) {
  return (
    <li>
      <button
        className={`assist-row${row.tone ? ` ${row.tone}` : ''}`}
        onMouseEnter={() => setHighlight([row.id])}
        onMouseLeave={clearHighlight}
        onClick={() => locateCell(row.id, row.sheetId)}
        title="Show this on the drawing"
      >
        <span className="assist-ref">{row.ref}</span>
        {row.note && <span className="assist-note">{row.note}</span>}
      </button>
    </li>
  )
}

function ModelSetup({ keyDraft, setKeyDraft, disclosure, onDone }: {
  keyDraft: string; setKeyDraft: (v: string) => void; disclosure: string; onDone: () => void
}) {
  const provider = providerOf(keyDraft)
  const [ack, setAck] = useState(() => hasConsented(provider))
  const [model, setModel] = useState(() => readModel())
  const [fallback, setFallback] = useState(() => readFallback())
  const [freeOnly, setFreeOnly] = useState(() => readFreeOnly())
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Ask the account which models it can reach. Providers retire ids and gate
  // them by tier, so this is the only answer that is actually true for a
  // given key — a shipped default is a guess with a shelf life.
  const loadModels = async () => {
    const t = transportForKey(keyDraft)
    if (!t) return
    setLoading(true)
    setLoadError(null)
    try {
      const list = await t.listModels()
      setModels(list)
      if (list.length > 0 && !list.includes(model)) setModel(list[0]!)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (provider !== 'unknown' && models.length === 0 && !loading && !loadError) void loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, freeOnly])

  return (
    <section className="assist-setup" data-testid="assist-setup">
      <div className="prop-title">Connect a model</div>
      <p className="assist-muted">Optional. The suggested questions already work without one.</p>

      <div className="assist-free" data-testid="assist-free-note">
        <b>Want it free?</b> <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a> serves
        open-weight models (Gemma, Nemotron, MiniMax…) at no cost — no card, just rate limits. Paste an
        <code> sk-or-…</code> key and only the free models are offered.
      </div>

      <input
        type="password"
        value={keyDraft}
        placeholder="sk-or-… (OpenRouter, free) · gsk_… (Groq) · sk-ant-… (Anthropic)"
        aria-label="API key"
        data-testid="assist-key"
        onChange={(e) => setKeyDraft(e.target.value)}
      />
      <div className="assist-muted">
        {keyDraft.trim() === '' ? 'No key set.'
          : provider === 'unknown' ? '⚠ Unrecognised key format — nothing will be sent.'
            : `Detected: ${PROVIDER_INFO[provider].name} — ${PROVIDER_INFO[provider].free}`}
      </div>

      {provider === 'openrouter' && (
        <label className="assist-ack">
          <input type="checkbox" checked={freeOnly} data-testid="assist-free-only"
            onChange={(e) => { setFreeOnly(e.target.checked); saveFreeOnly(e.target.checked); setModels([]) }} />
          Only offer models that cost nothing
        </label>
      )}

      {provider !== 'unknown' && keyDraft.trim() !== '' && (
        <div className="assist-models">
          <div className="prop-row">
            <button type="button" data-testid="assist-load-models" disabled={loading} onClick={() => void loadModels()}>
              {loading ? 'Loading…' : 'Load models'}
            </button>
          </div>
          {models.length > 0 && (
            <>
              <select value={model} aria-label="Model" data-testid="assist-model"
                onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <label className="assist-muted" style={{ display: 'block', marginTop: 6 }}>
                Fallback when the first is rate-limited or out of credit
                <select value={fallback} aria-label="Fallback model" data-testid="assist-fallback"
                  onChange={(e) => setFallback(e.target.value)}>
                  <option value="">None — just report the error</option>
                  {models.filter((m) => m !== model).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </>
          )}
          {models.length === 0 && !loadError && (
            <div className="assist-muted">
              Press <b>Load models</b> to see what this key can use. Without it the default is tried,
              which may not exist on your tier.
            </div>
          )}
          {loadError && <div className="assist-gap" data-testid="assist-model-error">Could not list models: {loadError}</div>}
        </div>
      )}

      <div className="assist-gap">
        <b>What leaves your browser.</b> {disclosure} Your key is stored in this browser only —
        never in the drawing, never on our servers. Requests go straight from your browser to the provider,
        so the key is visible to anyone with access to this machine.
      </div>
      <label className="assist-ack">
        <input type="checkbox" checked={ack} data-testid="assist-consent" onChange={(e) => setAck(e.target.checked)} />
        I'm authorised to send this drawing outside my organisation.
      </label>
      <div className="prop-row">
        <button disabled={!ack || provider === 'unknown'}
          onClick={() => { saveKey(keyDraft); saveModel(model); saveFallback(fallback); recordConsent(provider); onDone() }}>
          Save
        </button>
        <button onClick={() => { saveKey(''); saveModel(''); saveFallback(''); setKeyDraft(''); onDone() }}>Remove key</button>
      </div>
    </section>
  )
}
