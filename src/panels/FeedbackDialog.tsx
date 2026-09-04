// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { activeSheet, useStore } from '../store/store'
import { useAuthStore } from '../auth/authStore'
import { feedbackOwnerUid, firebaseReady } from '../auth/config'
import { useWorkspace } from '../routes'
import {
  BODY_MAX, TITLE_MAX, buildReport, friendly, refFrom, toPlainText, validateReport,
  type ReportErrors, type ReportKind,
} from '../feedback/report'
import { ImageRejected, MAX_FILE_BYTES, formatBytes } from '../feedback/probe'
import {
  acceptFile, canCaptureScreen, captureScreen, captureSheet, describeShot,
  imageFromTransfer, releaseScreenshot, type Screenshot,
} from '../feedback/screenshot'

// Where reports go is resolved server-side — the mail extension reads the
// address from users/{uid}.email, a document no client can read — so nothing
// in this bundle knows it. The public issue tracker is the only destination
// named here, because a string in a client bundle is a published string and an
// inbox named here would be scraped within a week.
const ISSUES_URL = 'https://github.com/Coldbari/IPD-Studio/issues'

/**
 * One entry point in the status bar for both halves of "tell me about this":
 * a bug that needs fixing and a feature that does not exist yet. They are one
 * dialog rather than two because the difference is a single field, and two
 * buttons would make people stop and classify before they can start typing —
 * which is exactly when they give up and say nothing.
 */
export function FeedbackChip() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="feedback-chip"
        data-testid="feedback-chip"
        onClick={() => setOpen(true)}
        title="Report a bug or suggest a feature — one short form, screenshot optional"
      >
        💬 Feedback
      </button>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  )
}

const PLACEHOLDER_TITLE: Record<ReportKind, string> = {
  bug: 'Line jumps to the wrong port after undo',
  suggestion: 'Let me lock a sheet so it cannot be edited',
}

const PLACEHOLDER_BODY: Record<ReportKind, string> = {
  bug: 'What you did, what you expected, what happened instead.\n\n'
    + '1. Drew a signal line from FT-101 to FIC-101\n'
    + '2. Pressed Ctrl+Z\n'
    + '3. The line reattached to the wrong port',
  suggestion: 'What you are trying to do, and why the current way does not work.\n\n'
    + 'Example: I check 40 loops a day and open each one by hand. '
    + 'A "next untagged instrument" key would save the whole pass.',
}

const HINT_BODY: Record<ReportKind, string> = {
  bug: 'Steps beat adjectives. If it only happens on one drawing, say which sheet.',
  suggestion: 'Tell us the job you are doing, not the control you want — that usually leads somewhere better.',
}

const WORKSPACE_NAME: Record<string, string> = {
  draw: 'Draw', data: 'Data', checks: 'Checks', hmi: 'HMI',
}

/** Enough to tell two browsers apart in a bug report, without shipping the
 *  full fingerprint-grade UA string into a stored record. */
function browserName(ua: string): string {
  const engine = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : 'this browser'
  const os = /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad/.test(ua) ? 'iOS'
          : /Linux/.test(ua) ? 'Linux' : 'an unknown system'
  return `${engine} on ${os}`
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform || navigator.userAgent)

type Phase = 'form' | 'sending' | 'sent'

/**
 * Report a bug or suggest a feature: type, title, description, and an optional
 * screenshot that can be chosen, dropped, pasted or captured.
 *
 * The screenshot path is the part with teeth. Nothing the user hands over is
 * stored: `feedback/probe.ts` identifies the file by its bytes rather than its
 * name or the browser's MIME guess and bounds its pixels before anything
 * decodes them, then `feedback/screenshot.ts` decodes it and re-encodes the
 * pixels through a canvas, so what is transmitted is an image the browser
 * itself wrote. The copy in the dialog says exactly that and promises nothing
 * more — no browser can prove a picture is "really a screenshot".
 */
export default function FeedbackDialog({ onClose }: { onClose(): void }) {
  const doc = useStore((s) => s.doc)
  const activeSheetId = useStore((s) => s.activeSheetId)
  const workspace = useWorkspace()
  const user = useAuthStore((s) => s.user)

  const [kind, setKind] = useState<ReportKind>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [errors, setErrors] = useState<ReportErrors>({})
  const [shot, setShot] = useState<Screenshot | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [alert, setAlert] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [ref, setRef] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const captureRef = useRef<HTMLButtonElement>(null)
  const shotRef = useRef<Screenshot | null>(null)

  shotRef.current = shot
  const busy = phase === 'sending'
  // Three things have to be true to send: a backend, an account to send from,
  // and an inbox for it to reach. The third is an opaque owner id — a fork that
  // copies this build has no reason to mail its reports here, and a Send button
  // that wrote a row nobody reads would be worse than none. Without all three
  // the dialog hands the report back as text.
  const canSend = firebaseReady && Boolean(user) && feedbackOwnerUid.length > 0

  const sheet = activeSheet({ doc, activeSheetId })
  const sheetNo = Math.max(1, doc.sheets.findIndex((s) => s.id === sheet.id) + 1)
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const viewport = typeof window === 'undefined' ? '' : `${window.innerWidth} × ${window.innerHeight}`

  const diag = {
    workspace,
    userAgent: ua,
    viewport,
    sheets: doc.sheets.length,
    nodes: sheet.nodes.length,
    edges: sheet.edges.length,
  }

  // The object URL behind the preview outlives React's render, so it is
  // revoked when the dialog goes away rather than when the element unmounts.
  useEffect(() => () => releaseScreenshot(shotRef.current), [])

  const attach = async (run: () => Promise<Screenshot | null>) => {
    setWarn(null)
    setAlert('')
    try {
      const next = await run()
      if (!next) return
      releaseScreenshot(shotRef.current)
      setShot(next)
      setNotice(`Screenshot attached — ${next.width} × ${next.height}.`)
    } catch (err) {
      setShot(null)
      setAlert(err instanceof ImageRejected || err instanceof Error
        ? err.message
        : 'That image could not be attached. Send the report without it and describe what you saw.')
    }
  }

  const take = (file: File, count: number, source: 'file' | 'paste') => {
    if (count > 1) setWarn('⚠ One screenshot at a time — the first one was used.')
    void attach(() => acceptFile(file, source))
  }

  const takeDrop = (data: DataTransfer | null) => {
    const { file, count } = imageFromTransfer(data)
    if (file) take(file, count, 'file')
  }

  // Paste is the way most people actually attach a screenshot, so it listens
  // on the document rather than on the drop zone — but only while the dialog is
  // open, and only for real files. `text/html` is never read: a pasted
  // <img src="https://…"> must not become a fetch to somebody else's server.
  useEffect(() => {
    if (phase !== 'form') return
    const onPaste = (e: ClipboardEvent) => {
      const { file, count } = imageFromTransfer(e.clipboardData)
      if (!file) return
      // Only once an image is actually found, so pasting text into the
      // description still works normally — and so the filename does not land
      // in the textarea alongside the attachment.
      e.preventDefault()
      take(file, count, 'paste')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const remove = () => {
    releaseScreenshot(shotRef.current)
    setShot(null)
    setWarn(null)
    setAlert('')
    setNotice('Screenshot removed.')
    dropRef.current?.focus()
  }

  // No await before getDisplayMedia: an await hands back the transient user
  // activation and the browser refuses the request.
  const capture = () => {
    setWarn(null)
    setAlert('')
    setCapturing(true)
    const run = canCaptureScreen() ? captureScreen() : captureSheet()
    void run.then(
      (next) => {
        if (next) {
          releaseScreenshot(shotRef.current)
          setShot(next)
          setNotice(`Screenshot attached — ${next.width} × ${next.height}.`)
        } else {
          setNotice('Screen capture was cancelled — nothing was attached.')
        }
      },
      (err: unknown) => {
        setAlert(err instanceof Error ? err.message : 'The screen could not be captured.')
      },
    ).finally(() => {
      setCapturing(false)
      // The OS picker steals focus; put it back where the user left it.
      captureRef.current?.focus()
    })
  }

  const close = () => {
    if (phase === 'sending') return
    if (phase === 'form' && (title.trim() || body.trim())
      && !window.confirm('Discard this report? What you typed will be lost.')) return
    onClose()
  }

  const send = () => {
    const found = validateReport({ kind, title, body })
    setErrors(found)
    if (found.title) { titleRef.current?.focus(); return }
    if (found.body) { bodyRef.current?.focus(); return }
    if (!canSend || !user) return

    const report = buildReport({ kind, title, body }, __APP_VERSION__, diag)
    setPhase('sending')
    setAlert('')
    setNotice('Sending your report…')
    void import('../feedback/send')
      .then(({ sendReport }) => sendReport(user.uid, report, shot))
      .then(
        ({ id }) => {
          setRef(refFrom(id))
          setNotice('')
          setPhase('sent')
        },
        (err: unknown) => {
          setPhase('form')
          setNotice('')
          setAlert(friendly(err))
        },
      )
  }

  const copyAsText = () => {
    const report = buildReport({ kind, title, body }, __APP_VERSION__, diag)
    const text = toPlainText(report, shot !== null)
    void navigator.clipboard?.writeText(text).then(
      () => setNotice('Copied. Paste it into an issue on GitHub, or send it however you like.'),
      () => setAlert('Your browser blocked the clipboard. Select the text above and copy it by hand.'),
    )
  }

  const titleLeft = title.length
  const bodyLeft = body.length
  const ready = title.trim().length > 0 && body.trim().length > 0

  return (
    <Modal title="Report a bug or suggest a feature" onClose={close} width={560} busy={busy}>
      {phase === 'sent' ? (
        <div className="fb-done" data-testid="feedback-done">
          <h3>
            Thanks — {kind === 'bug' ? 'bug report' : 'suggestion'}{' '}
            <span className="fb-ref" data-testid="feedback-ref">#{ref}</span> is in.
          </h3>
          <p>
            {kind === 'bug'
              ? 'Bugs usually get looked at within a few days. If you can reproduce it another way, send a second report and mention this number.'
              : 'Suggestions go on the list and get picked by how many people hit the same wall. If a colleague wants it too, have them send one.'}
          </p>
          <div className="fb-done-btns">
            <button
              className="fb-cancel"
              data-testid="feedback-again"
              onClick={() => {
                releaseScreenshot(shotRef.current)
                setShot(null)
                setTitle('')
                setBody('')
                setErrors({})
                setRef('')
                setNotice('')
                setPhase('form')
              }}
            >
              Send another
            </button>
            <button className="fb-send" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : (
        <div className={`fb${busy ? ' fb-busy' : ''}`} data-testid="feedback-dialog">
          <p className="fb-lead">
            This goes straight to the maintainer. One report per problem — a list of five in one
            message gets fixed slower than five reports.
          </p>

          <fieldset className="fb-seg">
            <legend className="fb-k">Report type</legend>
            <div className="fb-seg-row">
              {(['bug', 'suggestion'] as const).map((k) => (
                <label className="fb-seg-opt" key={k}>
                  <input
                    type="radio"
                    name="fb-type"
                    value={k}
                    data-testid={`feedback-type-${k}`}
                    checked={kind === k}
                    onChange={() => { setKind(k); setErrors({}) }}
                  />
                  <span>{k === 'bug' ? '🐞 Bug' : '💡 Suggestion'}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="fb-field">
            <label className="fb-label" htmlFor="fb-title">
              Title
              {titleLeft >= 60 && (
                <span
                  className={`fb-count${titleLeft >= TITLE_MAX ? ' fb-count-over' : titleLeft >= 72 ? ' fb-count-near' : ''}`}
                  data-testid="feedback-title-count"
                  aria-hidden="true"
                >
                  {titleLeft} / {TITLE_MAX}
                </span>
              )}
            </label>
            <input
              id="fb-title"
              ref={titleRef}
              data-testid="feedback-title"
              value={title}
              maxLength={TITLE_MAX}
              placeholder={PLACEHOLDER_TITLE[kind]}
              aria-invalid={errors.title ? 'true' : undefined}
              aria-describedby={errors.title ? 'fb-title-hint fb-title-err' : 'fb-title-hint'}
              onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors({ ...errors, title: undefined }) }}
            />
            <span className="fb-hint" id="fb-title-hint">
              One line. Be specific — “Undo loses the tag” beats “undo is broken”.
            </span>
            {errors.title && (
              <span className="fb-err" id="fb-title-err" data-testid="feedback-title-error">{errors.title}</span>
            )}
          </div>

          <div className="fb-field">
            <label className="fb-label" htmlFor="fb-body">
              Description
              {bodyLeft >= 1600 && (
                <span
                  className={`fb-count${bodyLeft >= BODY_MAX ? ' fb-count-over' : bodyLeft >= 1800 ? ' fb-count-near' : ''}`}
                  data-testid="feedback-body-count"
                  aria-hidden="true"
                >
                  {bodyLeft} / {BODY_MAX}
                </span>
              )}
            </label>
            <textarea
              id="fb-body"
              ref={bodyRef}
              data-testid="feedback-body"
              value={body}
              maxLength={BODY_MAX}
              placeholder={PLACEHOLDER_BODY[kind]}
              aria-invalid={errors.body ? 'true' : undefined}
              aria-describedby={errors.body ? 'fb-body-hint fb-body-err' : 'fb-body-hint'}
              onChange={(e) => { setBody(e.target.value); if (errors.body) setErrors({ ...errors, body: undefined }) }}
            />
            <span className="fb-hint" id="fb-body-hint">{HINT_BODY[kind]}</span>
            {errors.body && (
              <span className="fb-err" id="fb-body-err" data-testid="feedback-body-error">{errors.body}</span>
            )}
          </div>

          <div className="fb-shot">
            <div className="fb-shot-head">
              <span className="fb-k">Screenshot</span>
              <span className="fb-opt">optional</span>
            </div>

            <input
              ref={fileRef}
              className="fb-file"
              type="file"
              tabIndex={-1}
              data-testid="feedback-file"
              // A picker default only. It does nothing on the drop and paste
              // paths, and every OS picker has an "All files" escape — the
              // bytes are what decide, in feedback/probe.ts.
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void attach(() => acceptFile(file, 'file'))
                // so choosing the same file twice in a row still fires
                e.target.value = ''
              }}
            />

            {shot ? (
              <div className="fb-preview" data-testid="feedback-preview">
                {/* The re-encoded blob, never the original file: a blob: URL
                    inherits this origin, and an SVG or HTML polyglot opened
                    from one would run as same-origin script. */}
                <img src={shot.url} alt="Screenshot to be attached to this report" />
                <div className="fb-preview-meta">
                  <span className="fb-preview-name" data-testid="feedback-preview-name">{shot.name}</span>
                  <span className="fb-preview-dims" data-testid="feedback-preview-dims">{describeShot(shot)}</span>
                  <div className="fb-preview-btns">
                    <button data-testid="feedback-replace" onClick={() => fileRef.current?.click()}>Replace</button>
                    <button
                      data-testid="feedback-remove"
                      title="Remove this screenshot — the report still sends without it"
                      onClick={remove}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                ref={dropRef}
                className={`fb-drop${dragOver ? ' fb-drop-over' : ''}`}
                data-testid="feedback-drop"
                aria-describedby="fb-shot-fine"
                onClick={() => fileRef.current?.click()}
                // A file drag never fires :hover, so the one moment the target
                // most needs to look live is the one moment it would look dead.
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); takeDrop(e.dataTransfer) }}
              >
                {dragOver ? (
                  <span>Drop it — PNG, JPEG or WebP</span>
                ) : (
                  <>
                    <span>Drop a screenshot here, or click to choose one</span>
                    <span className="fb-drop-sub">
                      You can also press {isMac() ? '⌘V' : 'Ctrl+V'} to paste one
                    </span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              ref={captureRef}
              className="fb-capture"
              data-testid="feedback-capture"
              disabled={capturing}
              onClick={capture}
              title={canCaptureScreen()
                ? 'Your browser asks which window or tab to capture — nothing is captured until you pick one'
                : 'This browser cannot capture the screen from inside the page, so this attaches the drawing sheet instead'}
            >
              {capturing ? 'Waiting for you to pick a window…'
                : canCaptureScreen() ? 'Capture screen…' : 'Capture the drawing sheet'}
            </button>

            {warn && <p className="fb-warn" data-testid="feedback-shot-warn">{warn}</p>}

            <p className="fb-fine" id="fb-shot-fine">
              PNG, JPEG or WebP, up to {formatBytes(MAX_FILE_BYTES)}. The image is re-encoded in your
              browser before it is sent, which drops EXIF, location and anything hidden after the pixels.
            </p>
          </div>

          <details className="fb-ctx" data-testid="feedback-context">
            <summary>Sent with this report</summary>
            <dl>
              <dt>Version</dt><dd>v{__APP_VERSION__}</dd>
              <dt>Workspace</dt><dd>{WORKSPACE_NAME[workspace] ?? workspace}</dd>
              <dt>Sheet</dt>
              <dd>Sheet {sheetNo} of {doc.sheets.length}, {sheet.nodes.length} symbols, {sheet.edges.length} lines</dd>
              <dt>Browser</dt><dd>{browserName(ua)}</dd>
              <dt>Screen</dt><dd>{viewport}</dd>
            </dl>
            <p>
              No part of your drawing is sent — only the counts above, and the screenshot if you
              attach one.
            </p>
          </details>

          {/* Both regions stay mounted, and stay in the accessibility tree
              when empty: one created at the same moment as its text is not
              reliably announced. Polite for progress and attachment changes,
              assertive for rejections — those follow an action that otherwise
              silently did nothing. */}
          {/* Pinned to the bottom of the scrolling card. The form is taller
              than the dialog on a laptop, and both of these have to be seen
              without scrolling: a rejected screenshot vanishes from the zone
              above, and if the sentence explaining why is below the fold the
              attachment just silently disappeared. */}
          <div className="fb-actions">
            <div className="fb-live">
              <p className="fb-status" role="status" aria-live="polite" data-testid="feedback-status">{notice}</p>
              <p className="fb-status bad" role="alert" data-testid="feedback-alert">{alert}</p>
            </div>

            <div className="fb-foot">
              <p className="fb-fine">
                Read by one person. You will not get an automatic reply; fixes show up in the
                release notes with the version they landed in.
                {!canSend && (
                  <>
                    {' '}This build has no account to send from — copy the report and open an{' '}
                    <a href={ISSUES_URL} target="_blank" rel="noreferrer noopener">issue on GitHub</a>.
                  </>
                )}
              </p>
              {!canSend && (
                <button className="fb-cancel" data-testid="feedback-copy" onClick={copyAsText}>
                  Copy as text
                </button>
              )}
              <button className="fb-cancel" data-testid="feedback-cancel" onClick={close} disabled={busy}>
                Cancel
              </button>
              {canSend && (
                <button
                  className="fb-send"
                  data-testid="feedback-send"
                  onClick={send}
                  disabled={busy || !ready}
                  title={ready ? undefined : 'Add a title and a description first'}
                >
                  {busy ? 'Sending…' : 'Send report'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
