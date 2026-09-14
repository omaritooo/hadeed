# Backend API Reference

All routes live under `server/api/` (Nuxt/Nitro file-based routing) and return JSON. `defineRouteMeta({ openAPI: ... })` on each handler drives the generated OpenAPI doc.

## Authentication

Auth is session-cookie based, not token based.

- `POST /api/auth/login` and `POST /api/profile/onboarding` (signup) set an httpOnly `session` cookie (`server/utils/session-cookie.ts`). `rememberMe`/onboarding sign-ups get a 30-day `Max-Age`; a plain login without `rememberMe` is a browser-session cookie. The underlying session row always expires in 30 days server-side regardless.
- Every other authenticated route calls `getRequestContext(event)` (`server/utils/get-request-context.ts`), which reads that cookie, loads the session, and resolves a `RequestContext { userId, roles, permissions }`. No cookie or an expired/unknown session → `401 Not authenticated`.
- The frontend's `app/middleware/auth.global.ts` calls `GET /api/auth/me` to decide whether to redirect to `/login`; it caches the result client-side for 30s.
- One route is unauthenticated by design: `POST /api/hydration/reminders/dispatch`, which is meant to be hit by an external scheduler (see `.github/`) and instead requires `Authorization: Bearer <CRON_SECRET>`.

## Conventions

- Request/response bodies are JSON. Nullable fields are explicit (`null`, not omitted) in responses.
- Not-found vs. not-yours is generally `404` vs `403` (see Sessions below for where this is deliberately asymmetric for perf/security reasons).
- Optimistic concurrency: session/set mutations that can race (`complete`, `PATCH .../sets/:setId`) take an `expectedVersion` and return `409` on a stale write instead of silently overwriting.

---

## Auth — `server/api/auth/`

### `POST /api/auth/login`
Verifies email/password, sets the session cookie.
- Body: `{ email: string, password: string, rememberMe?: boolean }`
- 200: `{ userId: string }`
- 400 if email/password missing or non-string. 401 `Invalid email or password` for both "no such user" and "wrong password" — same message and same response time either way (a dummy scrypt hash is verified on the no-such-user path) so the endpoint can't be used to enumerate registered emails.

### `POST /api/auth/logout`
Deletes the current session row (if any) and clears the cookie.
- No body.
- 200: `{ success: true }` — always succeeds, even with no active session.

### `GET /api/auth/me`
Returns the current session's user id, or `null`. Used by the frontend route guard on every navigation.
- 200: `{ userId: string | null }` — never throws for "not logged in"; a missing/invalid session just yields `userId: null`.

---

## Profile & Onboarding — `server/api/profile/`

### `POST /api/profile/onboarding`
The app's signup flow: creates the `users` row, the profile, an initial body-metrics weigh-in, and (optionally) a starting weight target — then logs the new user in. Persistent session cookie always set (onboarding ignores `rememberMe`).
- Body: `{ email, password, displayName?, dateOfBirth, gender: 'male'|'female', height, weight, targetWeight?, activityLevel?, experienceLevel?, primaryGoal?, trainingDaysPerWeek?, equipment?, unitSystem?: 'metric'|'imperial', timezone? }`
  - `height`/`weight`/`targetWeight` are in cm/kg if `unitSystem` is metric or omitted, inches/lbs if imperial.
- 200: the new `{ profile, targets }` shape from `getProfile()` (see below).
- 400 if email/password missing, or height/weight not positive numbers.
- 409 if the email is already registered (checked up front, and again if a race loses to a concurrent signup — the partially-created `users` row is cleaned up first so the email can be retried).

### `GET /api/profile`
Returns the caller's profile plus computed stats.
- 200: `{ profile: UserProfile & { displayName: string | null, targets: UserTarget[] } | null, stats: { bmi: number, tdee: number | null, latestWeightKg: number } | null }`
  - `stats` is `null` if there's no profile or no recorded body-metrics yet. `tdee` is `null` if `activityLevel` isn't set.

---

## Body Metrics — `server/api/body-metrics/`

### `GET /api/body-metrics`
All recorded weigh-ins for the caller, most recent first.
- 200: `BodyMetric[]` (`{ id, userId, recordedAt, weightKg, bodyFatPct, visceralFat, muscleMassKg, source: 'manual'|'inbody'|'wearable', measurements: { id, bodyMetricId, key, valueCm }[] }`)

### `POST /api/body-metrics`
Records a new weigh-in.
- Body: `{ recordedAt, weightKg, bodyFatPct?, visceralFat?, muscleMassKg?, source: 'manual'|'inbody'|'wearable', measurements: { key, valueCm }[] }`
- 200: the created `BodyMetric`.

---

## Exercises — `server/api/exercises/`

### `GET /api/exercises/:id`
Exercise library lookup by id (e.g. `Barbell_Bench_Press_-_Medium_Grip`).
- 200: exercise detail (name, instructions, images, primary/secondary muscles, mechanic, etc.)
- 404 if the id isn't in the library.

### `GET /api/exercises/:id/history`
The caller's logging history for one exercise, plus their all-time PR for it.
- 200: `{ personalRecord: { weightKg, reps, date } | null, history: { sessionId, date, topSetWeightKg, topSetReps, setsCount }[] }`
  - `history` is one entry per session (heaviest set that session), most recent first. PR ties break on higher reps, then most recent.

---

## Training Blocks — `server/api/blocks/`

A **block** is a user's active training program instance (a set of `SplitDay`s with target exercises), created either from scratch or copied from a preset split.

### `POST /api/blocks`
Creates a block from a caller-authored day/exercise structure.
- Body: `{ name, startDate, endDate?, trainingDayMacroTarget?, restDayMacroTarget?, days: CreateSplitDayInput[] }`
- 200: the created `Block`.

### `POST /api/blocks/from-preset`
Creates a block by copying a `PresetSplit`'s days/exercises.
- Body: `{ presetSplitId: number, name: string, startDate: string, endDate: string | null }`
- 200: the created `Block`.
- 404 if `presetSplitId` doesn't exist.

---

## Preset Splits — `server/api/preset-splits/`

Reusable, shareable split templates (independent of any one user's block).

### `POST /api/preset-splits`
Creates a preset split.
- Body: `{ name, description?, frequencyMinDays, frequencyMaxDays, goal?, experienceLevel?, equipment: 'gym'|'home'|'both', isPublished, days: CreatePresetDayInput[] }`
- 200: the created `PresetSplit`.

### `GET /api/preset-splits/recommend`
Scores and ranks published preset splits against a training profile. Unspecified query params fall back to the caller's own profile.
- Query: `daysPerWeek` (required unless set on profile), `experienceLevel?`, `goal?`, `equipment?`
- 200: `{ preset: PresetSplit, score: number, reasons: string[] }[]`
- 400 for an invalid enum value or non-positive `daysPerWeek` with none on the profile either.

---

## Sessions — `server/api/sessions/`

A **workout session** is a single training-day run: started, exercises/sets logged against it, then completed.

### `POST /api/sessions`
Starts a new session. Also silently expires any of the caller's stale in-progress sessions first.
- Body: `{ id: string, splitDayId?: number | null, exercises: { id, exerciseId, splitExerciseId?, position, setType: 'weight_reps'|'bodyweight_reps'|'time', targetSets?, targetRepsMin?, targetRepsMax?, targetRpe? }[] }`
- 200: the created `WorkoutSession`.

### `POST /api/sessions/:id/exercises`
Adds a freeform (not pre-planned) exercise to an in-progress session. `sessionId` is read from the body, not the path.
- Body: `{ id, sessionId, exerciseId, position, setType }`
- 200: the created `ExerciseLog`.
- 404 if the session doesn't exist, 403 if it's not the caller's.

### `POST /api/sessions/:id/sets`
Logs a set. Idempotent on `(id, exerciseLogId)` — replaying the same pair returns the existing set log rather than erroring or double-logging. If the set is a new PR for that exercise, best-effort awards XP/achievements (a gamification failure never fails the request).
- Body: `{ id, exerciseLogId, setNumber, weightKg?, reps?, rpe? }`
- 200: the `SetLog`.
- 404 if `exerciseLogId` doesn't exist, 403 if its session isn't the caller's.

### `PATCH /api/sessions/:id/sets/:setId`
Corrects an already-logged set. `:id` (session id) is in the path but unused — `:setId` is looked up directly. Only fields present in the body are updated (an explicit `null` clears a value; an omitted key leaves it alone).
- Body: `{ expectedVersion: number, weightKg?: number | null, reps?: number | null, rpe?: number | null }`
- 200: the updated `SetLog`.
- 404 if the set log doesn't exist, 403 if not the caller's, 409 if `expectedVersion` is stale (someone/something else modified it first — the response includes nothing to auto-resolve with, caller must re-fetch).

### `POST /api/sessions/:id/complete`
Marks a session complete. Then (best-effort, non-blocking on failure) updates XP/streaks/achievements for the week.
- Body: `{ expectedVersion: number }`
- 200: the completed `WorkoutSession`.
- 409 if `expectedVersion` is stale. Also 422 server-side if the session has no sets logged (not completable) — see `SessionService.completeSession`.

---

## Home Dashboard — `server/api/home/`

### `GET /api/home`
Single aggregate call backing the home screen: streak, XP/level, next-up workout, any in-progress session, this week's progress, most recent completed session, recent PRs, recent achievement unlocks, and a body-weight sparkline. Returns `HomeSummary` (`shared/types/home.types.ts`):
```
{
  streak: { current: number, longest: number }
  xp: { total: number, level: number, xpIntoLevel: number, xpForNextLevel: number }
  todaysWorkout: { splitDayId, blockId, dayName, exercises: { exerciseId, exerciseName, targetSets, targetRepsMin, targetRepsMax }[] } | null
  activeSession: { sessionId, splitDayId, startedAt, setsLogged } | null
  weeklyProgress: { trainedDays: number, scheduledDays: number, volumeKg: number }
  recentSession: { sessionId, startedAt, completedAt, durationMinutes, topExerciseName, topWeightKg, topReps } | null
  recentPrs: { exerciseName, weightKg, reps, achievedAt }[]
  recentAchievements: { key, name, icon, unlockedAt }[]
  weightTrend: { recordedAt, weightKg }[]
}
```
`todaysWorkout` is null when there's no active block; otherwise it's the in-progress session's day if one exists, else the next day in the block's rotation after the last one completed.

Client: `app/composables/useHomeStats.ts`.

---

## Hydration — `server/api/hydration/`

### `GET /api/hydration`
Today's water intake summary (UTC calendar day).
- 200: `{ totalMl: number, targetMl: number | null, remainingMl: number | null, logs: HydrationLog[] }`

### `POST /api/hydration`
Logs a water intake entry.
- Body: `{ amountMl: number }`
- 200: the created `HydrationLog`.
- 400 if `amountMl` isn't a positive number.

### `DELETE /api/hydration/:id`
Deletes one log entry. Deleting someone else's id, or one that's already gone, is a silent no-op rather than an error (avoids leaking whether an id exists).
- 200: `{ success: true }`

### `POST /api/hydration/target`
Sets (or clears, with `null`) the caller's daily hydration target.
- Body: `{ targetMl: number | null }`
- 200: `{ targetMl: number | null }`
- 400 if `targetMl` is present, non-null, and not a positive number.

### `POST /api/hydration/reminders/settings`
Enables/disables hydration push reminders and sets the reminder interval.
- Body: `{ enabled: boolean, intervalMinutes: number }`
- 200: `{ enabled: boolean, intervalMinutes: number }`
- 400 if `intervalMinutes` isn't a positive number.

### `POST /api/hydration/reminders/dispatch`
**Not user-authenticated.** Meant to be triggered by an external cron/scheduler on a fixed interval. Requires `Authorization: Bearer <CRON_SECRET>`. Finds every user due a reminder (opted in, within their local 08:00–22:00 waking-hour window, and past their configured interval since last reminded), sends a web-push notification to each of their registered devices, and prunes subscriptions the push service reports as permanently gone (404/410).
- 200: `{ usersDue: number, notificationsSent: number, expiredSubscriptionsRemoved: number }`
- 401 if the bearer token is missing or wrong.

---

## Push Subscriptions — `server/api/push/`

Browser Web Push registration, used by hydration reminders (and any future push notifications).

### `POST /api/push/subscribe`
Registers a device's push subscription for the caller. Body is exactly the browser's `PushSubscription.toJSON()`.
- Body: `{ endpoint: string, keys: { p256dh: string, auth: string } }`
- 200: the saved `PushSubscriptionRecord`.

### `POST /api/push/unsubscribe`
Removes a subscription by endpoint.
- Body: `{ endpoint: string }`
- 200: `{ success: true }` — a no-op success if the endpoint was already gone.

Client: `app/composables/useHydrationReminders.ts` drives the browser Notification permission + `pushManager.subscribe()` flow, then calls these two routes.
