# Onboarding/profile backend completion — Design

Date: 2026-08-23
Status: Approved, ready for implementation planning

> **Post-implementation amendment (2026-08-23):** §2 and §6 below describe converting imperial
> height/weight at the route layer, ahead of a service that only ever sees canonical metric. That
> is not what shipped. A holistic review found this created a real race: the route's own
> `unitSystem` resolution (a separate, untransactioned read) could be stale relative to a
> concurrent `ProfileRepository.upsert` call, silently corrupting `height_cm`. The fix (commit
> `8138aee`) moved `unitSystem` resolution and height conversion **inside `upsert`'s own
> transaction** — `CompleteOnboardingInput`/`UpsertProfileInput` now carry a raw `height` (unit
> determined by the resolved `unitSystem`, not the request alone), and weight is converted in the
> service *after* `upsert` returns, using its authoritative post-commit `unitSystem` rather than
> the request's. The route is now a thin validate-and-pass-through layer with no conversion logic
> at all. See `server/repositories/profile.repository.ts`, `server/services/profile.service.ts`,
> and `server/api/profile/onboarding.post.ts` for the actual shipped shape.

## Context

The onboarding UI is currently scaffolding only: one step component (`FirstStep.vue`) whose
form schema doesn't match what it renders, an untyped Pinia store (`useOnboardingStore.form =
ref({})`), and zero calls to any API anywhere in `app/components/onboarding/`,
`app/pages/onboarding.vue`, or `app/store/`. Before building the real onboarding steps and their
frontend schemas, the backend they'll submit to needs to actually support everything those steps
are meant to collect.

Two research passes against the existing `user_profiles`/`body_metrics` layer
(`server/services/profile.service.ts`, `server/repositories/profile.repository.ts`,
`server/database/schema.sql`) found it already persists `dateOfBirth`/`gender`/`heightCm`/
`activityLevel`/`experienceLevel`/`primaryGoal` plus a weight time-series, correctly feeding
`bmi()`/`tdee()` in `shared/lib/formulas.ts`. But six real gaps remain: no write path for
`users.display_name`; `Gender` typed narrower than the DB column already allows; no field for
training-days-per-week or equipment/home-vs-gym access; no unit-system preference or imperial
conversion (metric-only end to end); no timezone field. This design closes all six.

Deliberately out of scope, staying narrow: reworking `GamificationService`/`SessionService`'s
UTC-only day/week-boundary math to actually use the new timezone field — that touches already-
shipped, already-reviewed logic from the session-logging branch and is a separate follow-up.
This round only captures and persists `timezone`; using it correctly is future work. Also out of
scope, per the original session-logging design's own list: injury/limitation exclusions, real
authentication (the hardcoded `x-user-id` header stays as-is — confirmed there is no production
`INSERT INTO users` anywhere in this codebase today; user rows exist only via test seeding).

## 1. Schema changes

```sql
ALTER TABLE users ADD COLUMN display_name TEXT; -- column already exists; no schema change here,
                                                  -- included only to make explicit that it's now written to

ALTER TABLE user_profiles ADD COLUMN training_days_per_week INTEGER;
ALTER TABLE user_profiles ADD COLUMN equipment TEXT CHECK (equipment IN ('gym','home','both'));
ALTER TABLE user_profiles ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial'));
ALTER TABLE user_profiles ADD COLUMN timezone TEXT;
```

`equipment` deliberately reuses the exact `'gym' | 'home' | 'both'` enum already used by
`preset_splits.equipment` (`shared/types/preset.types.ts`'s `Equipment` type), so a stored
preference plugs directly into the existing recommendation-scoring logic in
`PresetSplitService.recommend()` with no new enum to reconcile. All four new columns are
nullable or defaulted — no backfill needed, since nothing has ever written through
`completeOnboarding` yet (confirmed zero API calls anywhere in the onboarding UI).

`Gender` (`shared/lib/formulas.ts`) widens from `'male' | 'female'` to `'male' | 'female' |
'other'` — no DB change; the `user_profiles.gender` CHECK constraint already allows `'other'`,
and `bmrFor()` already has a working fallback branch for it (`base + (5 + -161) / 2`) that was
simply unreachable through the narrower type.

Per the schema-idempotency convention this codebase already uses (`server/utils/test/
create-test-db.ts`, `server/database/seed.ts` swallow "duplicate column name" on repeated
`ALTER TABLE` runs), these four new statements follow the same pattern.

## 2. Unit conversion — server-side, canonical storage stays metric

`heightCm`/`weightKg` remain the only values ever persisted in `user_profiles`/`body_metrics`.
`CompleteOnboardingInput` gains `unitSystem: 'metric' | 'imperial'`. When `imperial`, the caller
sends height/weight already-converted-to-metric is *not* required of the client — instead the
service accepts the imperial raw values and converts server-side, so the conversion logic lives
in exactly one place rather than being duplicated (and risking drift) on the frontend.

New pure functions in `shared/lib/formulas.ts` (alongside `bmi`/`tdee`, same file so both server
and any future frontend consumer share identical math):

```ts
export function cmToIn(cm: number): number { return cm / 2.54 }
export function inToCm(inches: number): number { return inches * 2.54 }
export function kgToLbs(kg: number): number { return kg * 2.20462262185 }
export function lbsToKg(lbs: number): number { return lbs / 2.20462262185 }
```

`unit_system` itself is persisted as a standing display preference (not just a one-time
onboarding input) — future profile reads can use it to decide whether to convert stored metric
values back to imperial for display, using the same shared functions in reverse.

## 3. Training frequency + equipment — straight persistence

`trainingDaysPerWeek?: number` and `equipment?: Equipment` are added to `CompleteOnboardingInput`
and persisted via `ProfileRepository.upsert`, following the exact same optional-field/`?? null`
pattern the repository already uses for `activityLevel`/`experienceLevel`/`primaryGoal`.

`GET /api/preset-splits/recommend` (`server/api/preset-splits/recommend.get.ts`) changes so that
any of `daysPerWeek`, `equipment`, `experienceLevel`, `goal` not supplied as a query param falls
back to the caller's stored `user_profiles` row (looked up via the request context's `userId`)
instead of being required every call. An explicit query param always overrides the stored value.
If no profile exists yet and no query param is given for a field, that field is simply omitted
from scoring (as today).

## 4. Timezone — capture and persist only

`timezone?: string` is added to `CompleteOnboardingInput` and persisted to `user_profiles.
timezone` as a plain IANA zone string (e.g. `America/New_York`), which the frontend is expected
to detect via `Intl.DateTimeFormat().resolvedOptions().timeZone` and submit as-is — the backend
does no validation beyond accepting a string, since libsql/SQLite has no timezone-aware type to
check against and rejecting a malformed zone name is better handled by whatever eventually reads
and interprets it.

Explicitly not done here: `GamificationService.onSessionCompleted`'s `new Date().
toISOString().slice(0, 10)` and `SessionService.completeSession`'s `startOfWeek(new Date())` both
remain UTC-only. Making streak/week-boundary calculation genuinely timezone-correct requires
reworking both of those call sites, which are already-shipped, already-reviewed logic from a
separate branch — that's a deliberate, explicit follow-up, not an oversight.

## 5. `users.display_name` — new minimal repository

No `UserRepository` exists today (there is no production code path that inserts into `users` at
all — rows only exist via test seeding, consistent with real auth being out of scope). A small
`UserRepository` is added with a single method:

```ts
async updateDisplayName(userId: string, displayName: string): Promise<void> {
  await this.db.execute({
    sql: 'UPDATE users SET display_name = ? WHERE id = ?',
    args: [displayName, userId],
  })
}
```

`ProfileService.completeOnboarding` calls this alongside its existing `ProfileRepository.upsert`
and `BodyMetricsRepository.record` calls, only when `input.displayName` is provided.

## 6. Net shape of `CompleteOnboardingInput`

```ts
export interface CompleteOnboardingInput {
  displayName?: string
  dateOfBirth: string
  gender: Gender                    // now 'male' | 'female' | 'other'
  heightCm: number                  // always canonical metric at this layer
  weightKg: number                  // always canonical metric at this layer
  unitSystem?: 'metric' | 'imperial'  // display preference; does not change the two fields above
  activityLevel?: ActivityLevel
  experienceLevel?: ExperienceLevel
  primaryGoal?: Goal
  trainingDaysPerWeek?: number
  equipment?: Equipment
  timezone?: string
}
```

Since nothing calls `POST /api/profile/onboarding` yet (confirmed zero API wiring anywhere in the
onboarding UI as it currently stands), this is a free change with no backward-compatibility
concern — no existing caller to migrate.

Where the raw client input is in *imperial* units (height in inches, weight in lbs) rather than
already-metric, the route layer (not the service) is responsible for converting via `inToCm`/
`lbsToKg` before constructing `CompleteOnboardingInput` — keeping the service's contract "always
canonical metric in, always canonical metric stored" simple and matching how `bmi`/`tdee` already
expect their inputs.

## Explicitly out of scope (unchanged from the prior design's list, plus this round's own)

1. Wiring the new `timezone` field into `GamificationService`/`SessionService`'s day/week-
   boundary math — separate follow-up.
2. Injury/limitation/exclusion system, real authentication, food/calorie logging — all as
   previously scoped in `docs/plans/2026-08-21-workout-session-logging-design.md`.
3. The onboarding UI itself — this design is backend-only, per standing instruction for this
   project's development sessions.
