import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'

export const SESSION_COOKIE_NAME = 'session'
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30

/**
 * `persist: true` sets a 30-day Max-Age (survives browser close — "remember me", and always used
 * on signup). `persist: false` omits Max-Age entirely, making it a true session cookie that's
 * cleared when the browser closes. Either way, the underlying `sessions` row always expires in 30
 * days (see AuthSessionRepository.create) — that's an independent backstop, not tied to this.
 */
export function setSessionCookie(event: H3Event, sessionId: string, options: { persist: boolean }): void {
  setCookie(event, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    ...(options.persist ? { maxAge: THIRTY_DAYS_SECONDS } : {}),
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' })
}

export function getSessionCookie(event: H3Event): string | undefined {
  return getCookie(event, SESSION_COOKIE_NAME)
}
