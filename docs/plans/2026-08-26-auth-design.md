# Authentication — design

## Problem

There is no auth anywhere in this app today. `server/utils/get-request-context.ts`
trusts a raw, unverified `x-user-id` header; the frontend hardcodes
`x-user-id: test-user` on every request (`app/plugins/api.ts`); the `users`
table has no password column; and both `OnboardingForm.vue` and the recently
added `LoginForm.vue` collect email+password but call nothing (the latter
explicitly: `// No auth backend yet — nothing to call.`, per
`docs/plans/2026-08-26-login-page-design.md`).

This design adds real signup (folded into onboarding completion), login,
logout, and session-based request identification, replacing the header
entirely.

## Goals

- Password-based signup, login, logout.
- Sessions backed by the existing Turso DB, identified by an httpOnly cookie.
- `getRequestContext` authenticates via that cookie instead of the
  `x-user-id` header — no client-supplied identity is trusted anywhere.
- "Remember me" (already a dormant checkbox in `LoginForm.vue`) controls
  cookie persistence.
- A minimal logged-in/logged-out route guard, now that there's something to
  guard (the prior login-page design explicitly deferred this until an auth
  backend existed).
- The 5 existing seeded dummy users get a known test password so they're
  reachable through the real login page, not just via a header.

## Non-goals

- Password reset / "forgot password".
- Email verification.
- OAuth / social login.
- Login rate-limiting or account lockout.
- "Log out everywhere" / multi-session management UI.
- Account settings / change-password screen.

These are all real gaps for a production app, but out of scope for this
round — this design is about closing the "collects a password, does nothing
with it" gap, not building a full identity system.

## 1. Data model

```sql
ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,        -- random token; also the cookie value
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
```

`password_hash` is nullable: it stays `NULL` for any row created before this
change (none exist in production; only the seeded dummy rows, which get
backfilled — see §5). A `users` row with a `NULL` password_hash simply can't
log in.

Session `id` is a cryptographically random token (`crypto.randomBytes(32)`,
base64url-encoded), generated server-side and never derived from anything
guessable. It IS the cookie value — there's no separate signing step,
because the token's entropy alone makes it unguessable, and the DB row is
the source of truth for validity (so a stolen cookie can be invalidated by
deleting the row, unlike a self-contained signed JWT).

## 2. Password hashing

`node:crypto`'s `scrypt` — no new dependency, consistent with this
codebase's existing minimal-dependency style (raw SQL over an ORM, etc.).
`shared/lib/password.ts` (or `server/utils/password.ts`, since it only ever
runs server-side):

```ts
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, 64)
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)
  return timingSafeEqual(derived, Buffer.from(hashHex, 'hex'))
}
```

`timingSafeEqual` (also `node:crypto`) avoids a timing side-channel on the
comparison.

## 3. Signup — folded into onboarding completion

No separate signup endpoint. `POST /api/profile/onboarding` already creates
the `users` row on first write (`UserRepository.ensureExists`, added in the
onboarding/DB-mismatch fix earlier) — but that logic identified the caller
via `ctx.userId`, sourced from `getRequestContext(event)`. Once §5 rewrites
`getRequestContext` to require a valid session, that becomes circular for
signup specifically: a brand-new account has no session yet, so a call that
*requires* one first would 401 before ever creating the account.

So `POST /api/profile/onboarding` stops calling `getRequestContext` and
becomes the one route that establishes identity itself instead of reading
it:

1. Look up `users` by the submitted email (`UserRepository.findByEmail`). If
   found, `409 Conflict` — "An account with this email already exists,"
   pointing the client at `/login` instead. (Every other field mismatch is
   the existing `400`/Zod-validation path; this is new because email
   uniqueness can only be checked against the DB, not the request shape.)
2. Otherwise generate a fresh `userId` (`crypto.randomUUID()`) — never
   client-supplied, since there's no prior identity to trust here.
3. Build a `RequestContext` by hand (`{ userId, roles: [], permissions: [] }`,
   same shape `getRequestContext` would have produced) and proceed exactly
   as today: `ProfileService.completeOnboarding` hashes the password
   (`CompleteOnboardingInput` gains `password: string`) and passes the hash
   into `ensureExists`, which now also accepts `passwordHash` and sets it on
   creation. `ensureExists` keeps its `ON CONFLICT (id) DO NOTHING` as a
   harmless safety net, but with `userId` now always freshly generated
   per-signup, the id conflict it was originally guarding against (the old
   client-supplied `x-user-id` reusing an id) can no longer happen through
   this route — it's only still relevant for direct-SQL seeding
   (`seed-dummy.ts`), which keeps using fixed ids like `test-user`.
4. After the existing profile/body-metrics/target writes succeed, the route
   creates a session row for the new `userId` and sets the cookie (§4), then
   returns the profile — the client is fully logged in the moment onboarding
   finishes, no separate login step required.

Every *other* route keeps calling `getRequestContext` unchanged and
continues to reject unauthenticated requests — onboarding is a deliberate,
narrow exception because it's the one place identity doesn't exist yet.

`shared/schemas/onboarding.ts` already validates `password`/`confirmPassword`
(step 1) — `OnboardingForm.vue`'s submit handler adds `password: data.password`
to the payload it already sends (it currently sends `email` but not
`password`, per the onboarding/DB review).

## 4. Login / logout endpoints

**`POST /api/auth/login`** — body `{ email, password, rememberMe? }`.
Looks up `users` by email, 401s on no match or `verifyPassword` failure
(same generic "invalid email or password" message either way, so the
response doesn't reveal whether the email exists). On success: create a
`sessions` row (`expires_at` = now + 30 days, regardless of `rememberMe`),
set an httpOnly, `SameSite=Lax`, `Secure` (in production) cookie holding the
session id. `rememberMe` controls only the cookie's `maxAge` — set it for
"remember me" (persists 30 days), omit it otherwise (session-only, cleared
when the browser closes); the DB row's own 30-day expiry is an independent
backstop either way.

**`POST /api/auth/logout`** — deletes the session row for the cookie's id
(if any) and clears the cookie. No-ops cleanly if already logged out.

**`GET /api/auth/me`** — returns `{ userId } | null` for the current
session; used by the frontend to know whether it's logged in without being
able to read the httpOnly cookie directly (see §6).

## 5. `getRequestContext` rewrite

```ts
export async function getRequestContext(event: H3Event): Promise<RequestContext> {
  const sessionId = getCookie(event, 'session')
  if (!sessionId) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })

  const db = useDb()
  const session = await new AuthSessionRepository(db).findValid(sessionId) // checks expires_at > now
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })

  return buildRequestContext(db, session.userId)
}
```

No fallback to `x-user-id` — every route except `POST /api/profile/onboarding`
(§3) already goes through this function, so this is the only place that
changes for them. Confirmed no test currently depends on the header
(`tests/` constructs `RequestContext` directly and calls services, never
goes through `getRequestContext`), so nothing in the suite breaks.

`app/plugins/api.ts` drops the hardcoded header entirely; the browser sends
the httpOnly cookie automatically on same-origin requests.

## 6. Route guard

- `GET /api/auth/me` (§4), fetched once via a `useAuthUser` composable
  (pinia-colada query, matching the existing composable style).
- A global Nuxt route middleware: unauthenticated + visiting anything other
  than `/login` or `/onboarding` → redirect to `/login`. Authenticated +
  visiting `/login` or `/onboarding` → redirect to `/`.

## 7. Seed script

`server/database/seed-dummy.ts` hashes a single known password
(`'password123'`) once and sets it on all 5 users it creates/updates
(`test-user`, `test-user-2`, `test-user-3`, `test-user-empty`, and going
forward any new ones), so each is logged in as `<email> / password123`
through the real `/login` page. The script's closing log message states the
password explicitly, the same way it currently documents the `x-user-id`
testing workaround.

## 8. Testing

- `hashPassword`/`verifyPassword`: round-trip succeeds, wrong password
  rejected, two hashes of the same password differ (salted).
- Auth service/route level (against `createTestDb()`, same pattern as
  `profile.service.test.ts`): login succeeds with correct credentials,
  fails on wrong password, fails on unknown email, session lookup resolves
  the right user, expired session is rejected, logout deletes the session.
- `completeOnboarding` extended: creates a `password_hash` on first signup,
  does not overwrite it on a repeat call.

## Net shape of changed/new files

```
server/database/schema.sql          -- password_hash column, sessions table
server/utils/password.ts            -- hash/verify (new)
server/repositories/auth-session.repository.ts -- session CRUD (new; named
                                     -- to avoid colliding with the existing
                                     -- workout SessionRepository)
server/repositories/user.repository.ts -- + findByEmail, ensureExists gains passwordHash
server/utils/get-request-context.ts -- cookie-based, no header fallback
server/api/auth/login.post.ts       -- new
server/api/auth/logout.post.ts      -- new
server/api/auth/me.get.ts           -- new
server/services/profile.service.ts  -- CompleteOnboardingInput.password
server/api/profile/onboarding.post.ts -- generates userId itself (no longer
                                     -- calls getRequestContext), checks email
                                     -- uniqueness, sets the session cookie
app/plugins/api.ts                  -- drop hardcoded x-user-id header
app/composables/useAuthUser.ts      -- new
app/composables/useLogin.ts         -- new
app/middleware/auth.global.ts       -- new
app/components/auth/LoginForm.vue   -- wire submit to POST /api/auth/login
app/components/onboarding/OnboardingForm.vue -- send password
server/database/seed-dummy.ts       -- backfill password_hash
```
