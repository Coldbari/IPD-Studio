// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * The feedback report itself: what a bug report or a suggestion is made of,
 * what makes one valid, and how a failure is explained.
 *
 * Pure on purpose, the way `cloud/sync.ts` keeps `buildPayload` free of
 * Firestore. Vitest runs `environment: 'node'` (vite.config.ts), so nothing
 * here may touch `navigator`, `window` or the build-time `__APP_VERSION__`
 * define — the caller reads those and passes them in. That is also what lets
 * the size rule be tested without a browser or a network.
 */

export type ReportKind = 'bug' | 'suggestion'

/** What is attached alongside the words. Counts and environment only: no part
 *  of the drawing travels, and the dialog shows this list verbatim so nobody
 *  has to take that on trust. */
export interface ReportContext {
  version: string
  workspace: string
  browser: string
  screen: string
  sheet: string
}

export interface ReportInput {
  kind: ReportKind
  title: string
  body: string
}

export interface BuiltReport {
  kind: ReportKind
  title: string
  body: string
  version: string
  diag: {
    workspace: string
    ua: string
    viewport: string
    sheets: number
    nodes: number
    edges: number
  }
  /** UTF-8 bytes of the text half, so an oversize report is refused here with
   *  a sentence rather than by Firestore with a permission error. */
  sizeBytes: number
}

/** Mirrored in `firestore.rules`. Keep the two in step: a rules rejection
 *  reaches the user as an opaque permission-denied, so the client has to
 *  refuse first, with something they can act on. */
export const TITLE_MAX = 80
export const TITLE_MIN = 4
export const BODY_MAX = 2000
export const BODY_MIN = 12
export const VERSION_MAX = 40
export const UA_MAX = 300

/** Firestore caps a document at 1 048 576 bytes. A screenshot is capped at
 *  500 kB by `screenshot.ts`, so the text half is given a generous 40 kB and
 *  the whole record still sits at roughly half the limit — the same "leave the
 *  cap a wide margin" reasoning as MAX_DOC_BYTES in `cloud/sync.ts`, and for
 *  the same reason: a size rejection from Firestore is unreadable. */
export const MAX_TEXT_BYTES = 40_000

const utf8 = (s: string): number => new TextEncoder().encode(s).length

/** Control characters serve no purpose in a one-line title and a plain-text
 *  body, and a NUL truncates strings in whatever C-backed tool eventually
 *  reads the inbox. Tab, newline and carriage return survive in the body.
 *  Bidi overrides go too — U+202E renders `report<U+202E>gnp.exe` as
 *  `reportexe.png`, which is display spoofing aimed at whoever triages this. */
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

export function cleanText(value: string): string {
  return value.replace(CTRL, '').replace(BIDI, '').trim()
}

/** Collapses a title to one line — a pasted multi-line title breaks every
 *  listing that shows it. */
export function cleanTitle(value: string): string {
  return cleanText(value.replace(/[\r\n\t]+/g, ' ')).replace(/ {2,}/g, ' ')
}

export interface ReportErrors {
  title?: string
  body?: string
}

/** Returns only the fields that are wrong, so a caller can ask
 *  `Object.keys(errors).length === 0`. */
export function validateReport(input: ReportInput): ReportErrors {
  const errors: ReportErrors = {}
  const title = cleanTitle(input.title)
  const body = cleanText(input.body)

  if (title.length === 0) errors.title = 'Add a title before sending.'
  else if (title.length < TITLE_MIN) {
    errors.title = 'That title is too short to file. One line naming the thing is enough.'
  }

  if (body.length < BODY_MIN) {
    errors.body = input.kind === 'bug'
      ? 'Say what happened — one sentence is the minimum.'
      : 'Say what you need — one sentence is the minimum.'
  }

  return errors
}

export interface DiagInput {
  workspace: string
  userAgent: string
  viewport: string
  sheets: number
  nodes: number
  edges: number
}

/** Everything the record carries, with no Firestore call inside. Trims,
 *  clamps and measures — the clamps are belt and braces behind the fields'
 *  own `maxLength`, which a paste can outrun on some engines. */
export function buildReport(input: ReportInput, version: string, diag: DiagInput): BuiltReport {
  const title = cleanTitle(input.title).slice(0, TITLE_MAX)
  const body = cleanText(input.body).slice(0, BODY_MAX)
  const built: BuiltReport = {
    kind: input.kind,
    title,
    body,
    version: cleanText(version).slice(0, VERSION_MAX) || 'unknown',
    diag: {
      workspace: diag.workspace,
      ua: cleanText(diag.userAgent).slice(0, UA_MAX),
      viewport: cleanText(diag.viewport).slice(0, 20),
      sheets: Math.max(0, Math.round(diag.sheets)),
      nodes: Math.max(0, Math.round(diag.nodes)),
      edges: Math.max(0, Math.round(diag.edges)),
    },
    sizeBytes: 0,
  }
  // Byte length, not string length — a report written in Devanagari or with
  // emoji costs several bytes per character on the wire, and the cap is bytes.
  built.sizeBytes = utf8(title) + utf8(body) + utf8(built.version) + utf8(built.diag.ua) + 200
  return built
}

/**
 * The short reference shown on the success screen. Derived from the Firestore
 * document id so the user's number and the row in the inbox are the same
 * thing; six characters is enough to name one report in an email and short
 * enough to read out loud.
 */
export function refFrom(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return (clean + '000000').slice(0, 6)
}

/**
 * Firestore reports rules rejections and a dead network with codes, never with
 * anything a person can act on — the same translation `cloud/sync.ts` does for
 * drawings, with the wording this dialog needs. Every message says what is
 * still true (the text has not been lost) and what to do next.
 *
 * No address appears in any of these strings. Where a report goes is decided
 * server-side: the mail extension resolves the recipient from users/{uid}.email,
 * a document no client can read. Naming an inbox here would ship it to every
 * visitor — a bundle is public, and a string in it is a published string.
 */
export function friendly(err: unknown): string {
  const code = String((err as { code?: unknown } | null | undefined)?.code ?? '')
  if (code.includes('unauthenticated')) {
    return 'Sending needs an account — sign in from the toolbar, or use Copy as text to keep what you wrote.'
  }
  if (code.includes('permission-denied')) {
    return 'The report could not be sent — permission was denied. Use Copy as text so you do not lose it, then sign in again and retry.'
  }
  if (code.includes('unavailable')) {
    return 'You are offline — nothing was sent. Your text is still here; reconnect and press Send report again.'
  }
  // Not the same as offline: the write went out and the server never answered,
  // so it may or may not have landed. Say that rather than guessing.
  if (code.includes('deadline-exceeded')) {
    return 'The network did not answer, so this may not have gone through. Your text is still here — wait a moment and press Send report again.'
  }
  if (code.includes('resource-exhausted')) {
    return 'You have sent several reports in the last minute. Wait a minute and press Send report again — nothing was lost.'
  }
  if (code.includes('invalid-argument')) {
    return 'The report was too large to send. Remove the screenshot and send the text, or crop the image and attach it again.'
  }
  const raw = err instanceof Error && err.message ? err.message : 'the connection failed'
  const reason = /[.!?]$/.test(raw) ? raw : `${raw}.`
  return `That did not send: ${reason} Your text is still here — try again, or use Copy as text to keep it.`
}

/** Longest subject worth sending; anything past this is cut by mail clients
 *  anyway, and the rules cap it so a padded one cannot ride along. */
export const SUBJECT_MAX = 140

/**
 * The subject line of the mail the extension sends.
 *
 * Deliberately says which kind and which version before it says the title, so
 * an inbox sorted by subject groups itself. The title is attacker-controlled
 * text, so it is cleaned and clamped like everything else — a newline in a
 * subject header is header injection, and `cleanTitle` has already collapsed
 * those to spaces by the time this runs.
 */
export function mailSubject(report: BuiltReport): string {
  const kind = report.kind === 'bug' ? 'Bug' : 'Suggestion'
  return `[IPD ${report.version}] ${kind}: ${report.title}`.slice(0, SUBJECT_MAX)
}

/**
 * The body of that mail. Plain text only, and that is a security decision, not
 * a stylistic one: every word of it was typed by a stranger, and `message.html`
 * would let them put markup in front of the one person who reads this. Text
 * carries exactly what the report already carries and nothing renders.
 */
export function mailText(report: BuiltReport, shot: boolean): string {
  return toPlainText(report, shot)
}

/**
 * The report as plain text, for the Copy-as-text fallback a build with no
 * Firebase project has to offer. A fork or a CI build has no inbox to write
 * to, and a dialog whose only button is dead is worse than no dialog. Where
 * the user then sends it is their choice — the public issue tracker is the
 * one destination this app is willing to name.
 */
export function toPlainText(report: BuiltReport, shot: boolean): string {
  return [
    `IPD Studio ${report.kind === 'bug' ? 'bug report' : 'suggestion'}`,
    `Title: ${report.title}`,
    '',
    report.body,
    '',
    '---',
    `Version: ${report.version}`,
    `Workspace: ${report.diag.workspace}`,
    `Sheets: ${report.diag.sheets} · Symbols: ${report.diag.nodes} · Lines: ${report.diag.edges}`,
    `Viewport: ${report.diag.viewport}`,
    `Browser: ${report.diag.ua}`,
    shot ? 'Screenshot: attached in the app — paste it into the email as well.' : 'Screenshot: none',
  ].join('\n')
}
