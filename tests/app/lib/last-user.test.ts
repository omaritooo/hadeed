import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lastKnownUser, rememberUser, resolveAuthFailure } from '~~/app/lib/last-user'

// A real localStorage, minus the browser: the only behaviour these tests care about is that a
// value written survives to the next read, and that a store which throws is survivable.
const memoryStorage = () => {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
    get size() { return entries.size },
  }
}

const throwingStorage = {
  getItem: () => { throw new DOMException('denied', 'SecurityError') },
  setItem: () => { throw new DOMException('quota', 'QuotaExceededError') },
  removeItem: () => { throw new DOMException('quota', 'QuotaExceededError') },
}

const install = (storage: unknown) => {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
}

let store: ReturnType<typeof memoryStorage>

beforeEach(() => {
  store = memoryStorage()
  install(store)
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

// ofetch only sets `response` when a server replied; a request that never reached one leaves it
// undefined, which is the offline case the marker exists for.
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), {
  response: { status },
  statusCode: status,
})
const networkError = () => new Error('fetch failed')

describe('rememberUser / lastKnownUser', () => {
  it('round-trips the marker and removes it on sign-out', () => {
    rememberUser('user-1')
    expect(lastKnownUser()).toBe('user-1')

    rememberUser(null)
    expect(lastKnownUser()).toBeNull()
    expect(store.size).toBe(0)
  })

  it('reports no marker rather than throwing when storage is unavailable', () => {
    install(throwingStorage)
    expect(() => rememberUser('user-1')).not.toThrow()
    expect(() => rememberUser(null)).not.toThrow()
    expect(lastKnownUser()).toBeNull()
  })
})

describe('resolveAuthFailure', () => {
  it('keeps the last known user when the request never reached a server', () => {
    expect(resolveAuthFailure(networkError(), 'user-1')).toEqual({ userId: 'user-1', forget: false })
  })

  it('forgets the user only when the server says the session is not theirs', () => {
    expect(resolveAuthFailure(httpError(401), 'user-1')).toEqual({ userId: null, forget: true })
    expect(resolveAuthFailure(httpError(403), 'user-1')).toEqual({ userId: null, forget: true })
  })

  it('keeps the user through a server having a bad day, so the next offline navigation still has a marker', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(resolveAuthFailure(httpError(status), 'user-1')).toEqual({ userId: 'user-1', forget: false })
    }
  })

  it('still redirects when there is no marker to fall back on', () => {
    expect(resolveAuthFailure(networkError(), null)).toEqual({ userId: null, forget: false })
  })
})
