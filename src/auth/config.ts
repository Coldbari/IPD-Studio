// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Which Firebase project this build talks to — read from the environment, with
 * NO built-in fallback.
 *
 * A Firebase web config is not a secret: it identifies a project to the client
 * and ships in the bundle by design, with access enforced by `firestore.rules`
 * and the Auth authorized-domains list. The reason it is env-only is different.
 * A hardcoded default would be INHERITED BY EVERY FORK, so a fork's users would
 * silently sign into the upstream project — real accounts and real drawings
 * landing in a stranger's Firestore, against their quota. Absent config is the
 * safe default; `firebaseReady` turns the whole account layer off instead.
 *
 * Deliberately free of `firebase/*` imports so anything can ask "is there a
 * backend?" without pulling the SDK into its chunk.
 *
 * Copy `.env.example` to `.env.local` to enable accounts.
 */
const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

/**
 * Whether this build has a backend at all. False in a fork with no
 * `.env.local`, and in CI. Everything account-shaped — the sign-in gate, the
 * account menu, cloud drawings — checks this first; drawing never needed one.
 */
export const firebaseReady: boolean = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
)

/**
 * Whose inbox a feedback report is mailed to — as a Firebase UID, never as an
 * address.
 *
 * This is the whole privacy design in one constant. The "Trigger Email from
 * Firestore" extension resolves `toUids` against a users collection, reading
 * the `email` field off `users/{uid}`. So the address lives in one Firestore
 * document that no client can read — `firestore.rules` matches only
 * `users/{uid}/drawings/{id}`, and the parent document falls through to the
 * deny-all catch-all — while the bundle carries nothing but this opaque id.
 *
 * A UID is not a secret: it identifies an account to a backend that already
 * knows it, and it reveals no address. An email address in a bundle is a
 * published address, scraped within a week and impossible to take back, which
 * is why one has never appeared in this feature's source.
 *
 * Empty in a fork or in CI, exactly like the rest of the config. Feedback then
 * falls back to Copy as text.
 */
export const feedbackOwnerUid: string = env.VITE_FEEDBACK_OWNER_UID ?? ''
