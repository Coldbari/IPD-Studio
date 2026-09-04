// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { feedbackOwnerUid } from '../auth/config'
import type { BuiltReport } from './report'
import { MAX_TEXT_BYTES, mailSubject, mailText } from './report'
import type { Screenshot } from './screenshot'
import { SHOT_MAX_BYTES, attachmentName, toBase64 } from './screenshot'

/**
 * Putting a report in the inbox — and into the maintainer's email, without the
 * address ever existing in this bundle.
 *
 * One Firestore document per report, which is BOTH the stored record and the
 * message the "Trigger Email from Firestore" extension picks up. The extension
 * watches this collection, resolves `toUids` against `users/{uid}.email`, and
 * sends. So the only thing shipped to a visitor is an opaque account id; the
 * address lives in one Firestore document that `firestore.rules` denies to
 * every client, and that only the extension's service account ever reads.
 *
 * The alternative — the image in a `shot` subcollection — was rejected: rules
 * cannot require that a subcollection document's parent exists, so anyone with
 * a token could write 500 kB children under report ids that will never exist,
 * invisible to a listing and findable only by a collection-group query. One
 * document has no such hole and is written in one atomic call.
 *
 * `firebase/firestore` is imported dynamically at send time, not at module
 * scope. It is the larger half of the SDK — the reason `cloud/firestore.ts`
 * exists at all — and opening this dialog to type a sentence must not download
 * it. Nothing here is loaded until Send is actually pressed.
 */

export interface SentReport {
  id: string
}

/** Long enough to cover a slow phone on a bad connection, short enough that the
 *  dialog does not sit on "Sending…" forever. Firestore's own write promise
 *  never rejects on a dead network — it waits for a server acknowledgement that
 *  may never come — so without this the busy state has no exit. */
const SEND_TIMEOUT_MS = 25_000

/** Base64 costs four characters per three bytes. The cap the rules enforce has
 *  to be stated in the units the rules count, and for base64 — which is ASCII —
 *  characters and bytes are the same number, which is exactly why the image
 *  travels in this form rather than as a raw string. */
export const SHOT_B64_MAX = Math.ceil(SHOT_MAX_BYTES / 3) * 4

class SendFailure extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SendFailure'
    this.code = code
  }
}

/** Whether a report can be mailed at all. False in a fork, in CI, and in any
 *  build whose owner never set the id — the dialog then offers Copy as text
 *  rather than a Send button that would write a row nothing ever reads. */
export function canMailReports(): boolean {
  return feedbackOwnerUid.length > 0
}

/**
 * Write the report. Throws with a Firestore-shaped `code` so `friendly()` in
 * `report.ts` can translate it the same way it translates the SDK's own.
 */
export async function sendReport(
  uid: string,
  report: BuiltReport,
  shot: Screenshot | null,
): Promise<SentReport> {
  if (report.sizeBytes > MAX_TEXT_BYTES) {
    throw new SendFailure('invalid-argument', 'The report text is too long to send.')
  }
  if (shot && shot.bytes > SHOT_MAX_BYTES) {
    throw new SendFailure('invalid-argument', 'The screenshot is too large to send.')
  }
  if (!canMailReports()) {
    throw new SendFailure('failed-precondition', 'This build has no inbox configured.')
  }
  // Checked before the write, not after: Firestore queues an offline write and
  // resolves nothing, so "press Send and watch it hang" is the alternative.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new SendFailure('unavailable', 'There is no network connection.')
  }

  // The image rides inside the attachment and nowhere else. Storing it twice —
  // once as a bytes field for the record, once as base64 for the mail — would
  // put a 500 kB screenshot over Firestore's 1 MiB document limit on its own.
  const attachments = shot
    ? [{
        filename: attachmentName(shot),
        content: await toBase64(shot.blob),
        encoding: 'base64',
        contentType: shot.mime,
      }]
    : []

  if (attachments[0] && attachments[0].content.length > SHOT_B64_MAX) {
    throw new SendFailure('invalid-argument', 'The screenshot is too large to send.')
  }

  const [{ addDoc, collection, serverTimestamp }, { db }] = await Promise.all([
    import('firebase/firestore'),
    import('../cloud/firestore'),
  ])

  const payload: Record<string, unknown> = {
    // Pinned by the rules to request.auth.uid, so this is a convenience for the
    // inbox rather than something the server takes on trust.
    uid,
    kind: report.kind,
    title: report.title,
    body: report.body,
    version: report.version,
    diag: report.diag,
    createdAt: serverTimestamp(),
    // An account id, never an address. The extension turns it into one by
    // reading users/{uid}.email, a document no client can read.
    toUids: [feedbackOwnerUid],
    message: {
      subject: mailSubject(report),
      // text, never html. Every word below was typed by a stranger, and
      // `message.html` would put their markup in front of the one person who
      // reads this. The rules refuse an html key for the same reason.
      text: mailText(report, shot !== null),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  }
  if (shot) {
    payload.shotMime = shot.mime
    payload.shotW = shot.width
    payload.shotH = shot.height
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ref = await Promise.race([
      addDoc(collection(db(), 'feedback'), payload),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SendFailure('deadline-exceeded', 'The network did not answer.')),
          SEND_TIMEOUT_MS,
        )
      }),
    ])
    return { id: ref.id }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
