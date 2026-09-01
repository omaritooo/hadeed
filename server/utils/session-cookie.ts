import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'

export const SESSION_COOKIE_NAME = 'session'
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30

export const setSessionCookie = (event: H3Event, sessionId: string, options: { persist: boolean }): void => {
  setCookie(event, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    ...(options.persist ? { maxAge: THIRTY_DAYS_SECONDS } : {}),
  })
}

export const clearSessionCookie = (event: H3Event): void => {
  deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' })
}

export const getSessionCookie = (event: H3Event): string | undefined => {
  return getCookie(event, SESSION_COOKIE_NAME)
}
