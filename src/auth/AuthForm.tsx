// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { register, resetPassword, signIn, signInWithGoogle } from './authStore'
import { authErrorMessage } from './errors'
import './auth.css'
import { useLanguage, useT } from '../i18n'

type Mode = 'signin' | 'register'

/** Firebase rejects anything shorter, and only after a round trip. Checked in
 *  JS rather than with minLength so the message lands in the dialog's own error
 *  area, next to everything else that can go wrong here. */
const MIN_PASSWORD = 6

/** Sign in, create an account, or reset a password. Rendered by AuthScreen,
 *  which stands in front of the editor — so `onDone` means "you are in", not
 *  "close me". Kept separate from the screen so the form can be dropped
 *  anywhere else later without dragging the page chrome with it. */
export default function AuthForm({ onDone, initialMode = 'signin' }: {
  onDone(): void
  initialMode?: Mode
}) {
  const t = useT()
  const lang = useLanguage()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const first = mode === 'register' ? nameRef.current : emailRef.current
    first?.focus()
  }, [mode])

  const attempt = async (action: () => Promise<void>) => {
    setError('')
    setNotice('')
    setPending(true)
    try {
      await action()
    } catch (err) {
      setError(authErrorMessage(err, lang))
    } finally {
      setPending(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(t('Passwords need at least {count} characters.').replace('{count}', String(MIN_PASSWORD)))
      return
    }
    void attempt(async () => {
      if (mode === 'signin') await signIn(email, password)
      else await register(email, password, name)
      onDone()
    })
  }

  const onGoogle = () => {
    void attempt(async () => {
      await signInWithGoogle()
      onDone()
    })
  }

  const onForgot = () => {
    if (!email.trim()) {
      setError(t('Enter your email address first, then choose Forgot password.'))
      emailRef.current?.focus()
      return
    }
    void attempt(async () => {
      await resetPassword(email)
      setNotice(t('Reset link sent. Check your inbox, and the spam folder.'))
    })
  }

  // Switching tabs drops the last message: a sign-in error is not an answer to
  // the form the user just moved to.
  const switchTo = (next: Mode) => {
    setMode(next)
    setError('')
    setNotice('')
  }

  const signup = mode === 'register'

  return (
    <div className="auth" data-testid="auth-dialog">
      <div className="auth-tabs" role="tablist" aria-label={t('Account')}>
          <button
            type="button" role="tab" className="auth-tab" id="auth-tab-signin"
            aria-selected={!signup} aria-controls="auth-form" data-testid="auth-tab-signin"
            onClick={() => switchTo('signin')}
          >
            {t('Sign in')}
          </button>
          <button
            type="button" role="tab" className="auth-tab" id="auth-tab-register"
            aria-selected={signup} aria-controls="auth-form" data-testid="auth-tab-register"
            onClick={() => switchTo('register')}
          >
            {t('Create account')}
          </button>
        </div>

        <form
          className="auth-form" id="auth-form" onSubmit={onSubmit}
          role="tabpanel" aria-labelledby={signup ? 'auth-tab-register' : 'auth-tab-signin'}
        >
          {signup && (
            <div className="auth-field">
              <label htmlFor="auth-name">{t('Name')}</label>
              <input
                id="auth-name" ref={nameRef} data-testid="auth-name"
                type="text" autoComplete="name" placeholder={t('Optional')}
                value={name} onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">{t('Email')}</label>
            <input
              id="auth-email" ref={emailRef} data-testid="auth-email"
              type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">{t('Password')}</label>
            <input
              id="auth-password" data-testid="auth-password"
              type="password" required
              autoComplete={signup ? 'new-password' : 'current-password'}
              value={password} onChange={(e) => setPassword(e.target.value)}
            />
            {signup && <span className="auth-hint">{t('At least 6 characters.')}</span>}
          </div>

          {error && <p className="auth-error" role="alert" data-testid="auth-error">{error}</p>}
          {notice && <p className="auth-note" role="status" data-testid="auth-notice">{notice}</p>}

          <button className="auth-submit" type="submit" disabled={pending} data-testid="auth-submit">
            {pending ? t('Working…') : signup ? t('Create account') : t('Sign in')}
          </button>

          {!signup && (
            <div className="auth-row">
              <button className="auth-link" type="button" onClick={onForgot}
                disabled={pending} data-testid="auth-forgot">
                {t('Forgot password?')}
              </button>
            </div>
          )}
        </form>

        <div className="auth-or"><span>{t('or')}</span></div>

        <button className="auth-google" type="button" onClick={onGoogle}
          disabled={pending} data-testid="auth-google">
          <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
            <path fill="#4285f4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
            <path fill="#34a853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
            <path fill="#fbbc05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
            <path fill="#ea4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
          </svg>
          {t('Continue with Google')}
        </button>

        <p className="auth-fine">
          {t('IPD Studio is free for personal, academic, nonprofit and government use.')}
          {t('Commercial use requires a paid licence.')}
        </p>
    </div>
  )
}
