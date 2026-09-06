// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

/**
 * Firebase auth codes read like stack traces ("Firebase: Error
 * (auth/invalid-credential)."). Users see these at the exact moment they are
 * least patient, so every sentence here says what happened and what to do
 * next, and none of them blame the person typing.
 */
export const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address does not look quite right. Check it and try again.',
  'auth/user-disabled': 'This account is disabled. Get in touch if that seems wrong.',
  'auth/user-not-found': 'No account uses that email yet. Create one, or check the address.',
  'auth/wrong-password': 'That password does not match this account. Try again, or use Forgot password.',
  'auth/invalid-credential': 'That email and password do not match an account. Check both, or use Forgot password.',
  'auth/email-already-in-use': 'An account already uses that email. Sign in instead, or reset the password.',
  'auth/weak-password': 'Passwords need at least 6 characters. Pick a longer one.',
  'auth/too-many-requests': 'Too many attempts from this device. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'Could not reach the sign-in server. Check your connection and try again.',
  'auth/popup-closed-by-user': 'The Google window closed before sign-in finished. Try again when you are ready.',
  'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups for this site, then try again.',
  'auth/cancelled-popup-request': 'Only one sign-in window can be open at a time. Use the one already open.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled for this project yet.',
  'auth/requires-recent-login': 'For safety this step needs a fresh sign-in. Sign out, sign back in, then try again.',
  'auth/missing-email': 'Enter your email address first.',
  'auth/missing-password': 'Enter your password to continue.',
  'auth/unauthorized-domain': 'Sign-in is not allowed from this address yet. Open the app from its usual URL.',
  'auth/account-exists-with-different-credential':
    'That email already signs in another way. Use the method you set up first, then link Google from your account.',
}

export const AUTH_MESSAGES_ZH: Record<string, string> = {
  'auth/invalid-email': '邮箱地址格式不正确，请检查后重试。', 'auth/user-disabled': '此账号已被禁用，如有疑问请联系支持。', 'auth/user-not-found': '该邮箱尚未注册账号，请检查地址或创建账号。', 'auth/wrong-password': '密码与此账号不匹配，请重试或使用“忘记密码”。', 'auth/invalid-credential': '邮箱和密码与现有账号不匹配，请检查或使用“忘记密码”。', 'auth/email-already-in-use': '该邮箱已注册，请直接登录或重置密码。', 'auth/weak-password': '密码至少需要 6 个字符，请设置更长的密码。', 'auth/too-many-requests': '此设备尝试次数过多，请等待几分钟后重试。', 'auth/network-request-failed': '无法连接登录服务器，请检查网络后重试。', 'auth/popup-closed-by-user': 'Google 登录窗口在完成前已关闭，请准备好后重试。', 'auth/popup-blocked': '浏览器阻止了 Google 登录窗口，请允许弹窗后重试。', 'auth/cancelled-popup-request': '同一时间只能打开一个登录窗口，请使用已打开的窗口。', 'auth/operation-not-allowed': '此项目尚未启用该登录方式。', 'auth/requires-recent-login': '出于安全原因需要重新登录，请退出后重新登录再试。', 'auth/missing-email': '请先输入邮箱地址。', 'auth/missing-password': '请输入密码继续。', 'auth/unauthorized-domain': '此地址不允许登录，请从常用网址打开应用。', 'auth/account-exists-with-different-credential': '该邮箱已通过其他方式登录。请先用最初的方式登录，再在账号设置中关联 Google。',
}

const GENERIC = 'Something went wrong while signing in. Try again in a moment.'

function readString(err: unknown, key: 'code' | 'message'): string {
  if (typeof err === 'object' && err !== null && key in err) {
    const value = (err as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** A readable sentence for any auth failure: mapped code, then the raw
 *  message (SDK prefix stripped), then a generic apology. */
export function authErrorMessage(err: unknown, lang: 'zh-CN' | 'en' = 'en'): string {
  const code = readString(err, 'code')
  const mapped = (lang === 'zh-CN' ? AUTH_MESSAGES_ZH[code] : AUTH_MESSAGES[code])
  if (mapped) return mapped
  const raw = readString(err, 'message').replace(/^Firebase:\s*/, '').trim()
  return raw || (lang === 'zh-CN' ? '登录时发生错误，请稍后重试。' : GENERIC)
}
