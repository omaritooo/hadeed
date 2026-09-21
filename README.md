# Hadeed

A mobile-first training and nutrition tracker built as a PWA. Hadeed onboards a lifter,
recommends or builds them a training split, logs the sets they actually perform, tracks
macros and hydration against goal-derived targets, and rewards consistency with XP,
streaks, and achievements.

Built with Nuxt 4, a Turso (libSQL) database, and a typed repository/service backend.

---

## Features

### Onboarding & profile

- **Five-step signup** — identity and credentials, experience level, primary goal, body
  measurements, then training logistics (days per week and equipment tier). Account
  creation happens on the final submit.
- **Draft persistence** — the in-progress onboarding form is mirrored to `localStorage`,
  so closing the tab mid-flow doesn't lose the answers. Passwords are deliberately
  excluded from what gets written to disk.
- **Derived targets** — BMI and TDEE (Mifflin-St Jeor BMR × activity multiplier) are computed
  from the profile, and a macro target is suggested from TDEE and goal: a ~17.5% deficit
  for fat loss, a ~12.5% surplus for muscle gain, TDEE itself otherwise, split 30/40/30
  protein/carbs/fat.
- **Adaptive TDEE**: once there are 10+ full days of logged meals and weigh-ins on 4+ days
  spanning 10+ days, maintenance is estimated from real data. That is average intake minus
  the least-squares weight trend × 7,700 kcal/kg, over the 28 finished days before today.
  With thin data it is blended toward the formula TDEE and bounded. When the implied target
  differs from the current one by 150+ cal, the Nutrition tab offers a one-tap update, which
  can be snoozed for 14 days.
- **Metric and imperial** — a `unitSystem` preference on the profile; cm/kg and in/lbs are
  converted at the API boundary, and stored canonically in metric.
- **Editable preferences** — goal, experience level, equipment tier, display name,
  hydration and nutrition targets are all editable post-signup from the Profile page.

### Training splits

- **Preset recommendations** — published preset splits are scored and ranked against the
  user's training profile (days per week, experience, goal, equipment tier), so the
  suggestions are reachable with the equipment they actually have.
- **Equipment tiers** — a four-tier ladder (`bodyweight` → `home_dumbbell_only` →
  `home_barbell_dumbbell` → `full_gym`) where a higher tier satisfies everything below it.
- **Custom split builder** — build a week day-by-day: name each day, mark rest days, pick
  gym or home, choose straight sets or a circuit (with rounds), then add exercises with
  target sets, reps, RPE, and rest.
- **Recovery conflict checking** — the builder flags when two back-to-back training days
  both hit the same muscle with a tier-1 (primary compound) movement.
- **Exercise swapping** — any picked exercise can be swapped for an alternative sharing its
  movement pattern and primary muscle, ranked by tier proximity. A separate fallback flow
  handles equipment mismatches automatically.
- **Joint limitations**: a user can mark knee, shoulder, lower back, wrist, elbow or ankle
  (at onboarding or on Profile). Exercises that commonly load those joints get a warning
  badge. Nothing is hidden. Swaps rank clean alternatives first, preset review can swap all
  flagged lifts at once, and recommendations softly penalise presets whose main lifts load a
  limited joint (capped at 2 points). Tags come from rules in
  `server/utils/exercise-classification.ts`, corrected by `exercise_stressor_overrides.json`.

### Exercise catalog

- **973 exercises** — 882 seeded from the free-exercise-db dataset plus 91 curated
  gap-fill movements that dataset has no counterpart for, normalized onto a muscles table
  so muscle-targeting and split-generation queries are plain joins.
- **108 search aliases** mapping what people actually type onto the catalog row that
  describes the movement — the source data has no plain "Bench Press" or "Squat" row, only
  qualified variants, and names a pec deck "Butterfly".
- **Automatic classification** — exercises are tagged with a movement pattern (horizontal
  and vertical push/pull, knee and hip dominant, elbow flexion/extension, lateral
  isolation, core) and a 1–3 tier, derived from name, force, mechanic, and primary muscles
  with word-boundary matching that avoids false hits like "row" inside "throw".
- **Detail drawer** — per-exercise instructions, range-of-motion images, an interactive
  muscle map, and personal history for that lift.

### Workout logging

- **Session logging** — start today's scheduled day (or an ad-hoc session) and log weight,
  reps, and RPE per set, with sets editable and deletable after the fact.
- **Warm-up sets** — flagging a set as a warm-up keeps it out of PR detection, "last
  performed" lookups, and weekly volume-by-muscle, rather than deleting the record.
- **PR detection** — three kinds, recorded per set: a **weight** PR beats every prior
  working weight, a **rep** PR beats the most reps done at that weight or heavier, and an
  **e1RM** PR beats the best Epley estimate (only sets at 12 reps or fewer, on either side
  of the comparison, since Epley drifts at high reps). An exercise's first working set sets
  the baseline rather than scoring a PR. A set that hits any type awards one bonus XP
  payment, not one per type.
- **Progression suggestions** — prescriptions carry a rep *range*, and at session start each
  exercise gets a suggestion computed from its last two sessions: double progression (every
  set at the top of the range earns a load increase, rounded to a loadable increment for the
  equipment and the profile's unit), RPE autoregulation in both directions, and a back-off
  when the bottom of the range was missed twice running. The suggestion is snapshotted onto
  the exercise log, so a past session still shows the advice it was logged against, and it
  pre-fills the first working set's inputs as a fill, not a lock.
- **Rest timer and plate calculator** — a per-exercise rest countdown driven by the
  session's snapshotted rest seconds, and a plate breakdown for a target barbell load with
  kg/lb plate sets and an inline bar-weight override.
- **Snapshotted prescriptions** — set type, targets, rest, format, and rounds are copied
  onto the session at start time, so later edits to a split don't retroactively rewrite
  what a past session says it prescribed.
- **Offline-ready writes** — sessions, exercise logs, and set logs use client-generated
  UUID primary keys, so a write can be created before it reaches the server.
- **Optimistic concurrency** — mutations that can race (session complete, set patch) take
  an `expectedVersion` and return `409` on a stale write instead of silently overwriting.
  A `sync_conflicts` table records the server and proposed values.

### Nutrition

- **Personal ingredient catalog** — per-user ingredients plus **51 global preset foods**,
  stored per-100g or per-count with a unit label (cup, can, scoop). Global rows are visible
  to everyone but only editable by their owner.
- **Meal logging** — build a meal from ingredient lines with quantities; macros roll up
  from the lines. Meal type is inferred from the hour of day when not given.
- **Check mode** — weigh a draft meal against what's left of the day's target *without*
  logging it, showing per-macro projected totals and overshoot. Rounds before comparing so
  float drift doesn't read as an overshoot.
- **Preset meals** — save a composed meal and re-log it in one tap.
- **Training vs. rest day targets** — a block can carry separate macro targets for training
  and rest days.

### Hydration

- **Event-based logging** — each entry is one "add N ml" action rather than a running
  counter, so individual entries stay visible and undoable and the daily total is a `SUM`.
- **Web push reminders** — opt-in reminders at a configurable interval, delivered via VAPID
  web push to any number of subscribed devices, dispatched by an external scheduler
  (a GitHub Actions cron hitting a `CRON_SECRET`-guarded endpoint every 15 minutes).

### Gamification

- **XP ledger** — 10 XP per set, 25 for completing a session, 50 for a PR. The ledger is
  uniquely keyed on `(user_id, source_type, source_id)`, so an award can't be double-counted.
  Deleting a set revokes what it earned, and editing one re-detects its PRs, so a set can't
  be logged, deleted and re-logged to farm the PR bonus.
- **Streaks** — counted in weeks, with one session of grace: a week counts when you complete
  at least your scheduled sessions minus one, never fewer than one, on whichever days suit.
  Weeks with no active split are skipped rather than breaking the run. Derived from session
  history on every read rather than stored, so backdating a forgotten workout repairs the week
  it belongs to.
- **Achievements** — published achievements are returned annotated with unlocked state and
  progress toward the next unlock, computed from the same facts used to decide unlocks, so
  displayed progress can't drift from unlock logic.

### Dashboard & stats

- **Home** — current streak and level, a consistency strip, today's workout card (or a
  rest-day state), an active-session resume card, nutrition progress, recent PRs, freshly
  unlocked achievements, last session, and a body-weight sparkline.
- **Stats** — strength progression, volume trend, PR history, and body-metric trends.
- **Body metrics** — weigh-ins with body fat, visceral fat, muscle mass, and arbitrary
  keyed circumference measurements, plus targets that track a starting value and an
  achieved date.

### Platform

- **Installable PWA** — custom service worker (`app/sw.ts`) with Workbox precaching, push
  and notification-click handling, and a themed manifest.
- **Session-cookie auth** — httpOnly cookie backed by a server-side `sessions` row, so a
  login can be revoked by deleting the row. Scrypt password hashing with
  `timingSafeEqual` verification; the login endpoint verifies a dummy hash on the
  no-such-user path so response time can't be used to enumerate registered emails.
- **RBAC** — roles carry permission lists, resolved into a `RequestContext` per request.
  Turso has no row-level security, so ownership and permission checks are enforced in the
  service layer.
- **Generated OpenAPI** — every route declares `defineRouteMeta({ openAPI })`, driving a
  generated spec from Nitro's experimental OpenAPI support.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | [Nuxt 4](https://nuxt.com) (Vue 3.5, Vue Router 5), TypeScript |
| Server | Nitro server routes with experimental OpenAPI generation |
| Database | [Turso](https://turso.tech) / libSQL via `@libsql/client`, hand-written SQL |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`), `tw-animate-css` |
| Components | [Reka UI](https://reka-ui.com) primitives in a shadcn-vue "new-york" setup, CVA + `tailwind-merge` |
| Icons / fonts | `@nuxt/icon`, Lucide, `@nuxt/fonts` (Anybody, Inter, JetBrains Mono) |
| State | Pinia 4 for local UI/form state, `@pinia/colada` for server-state queries and mutations |
| Validation | Zod 4 schemas shared between client and server |
| Auth | Session cookies + `node:crypto` scrypt, custom RBAC |
| PWA / push | `@vite-pwa/nuxt` (`injectManifest`), Workbox, `web-push` (VAPID) |
| Testing | Vitest 4 — **366 tests across 40 files** |
| Tooling | `@nuxt/eslint`, `vue-tsc`, `tsx` for scripts |
| Also enabled | `@nuxtjs/seo`, `@nuxt/a11y`, `@nuxt/image`, `@nuxt/scripts`, `@nuxtjs/device`, `@artmizu/nuxt-prometheus` metrics |

> **Note:** `@nuxtjs/supabase` and `@nuxtjs/i18n` are installed but not currently wired up —
> persistence is Turso end-to-end, and there are no locale files yet.

---

## Implementation

### Layered backend

Every API route is a thin handler; the work lives in two layers beneath it.

```
server/api/**          Nitro route handlers — parse input, declare OpenAPI, delegate
server/services/**     Business logic, authorization, cross-repository orchestration
server/repositories/** SQL, row → domain-type mapping
server/utils/**        db client, auth context, session cookies, password hashing, PRs
shared/**              Types, Zod schemas, and pure domain math used by both sides
```

- `BaseRepository<T>` supplies `findById` / `findMany` / `insert` / `update` / `delete`
  against a table name plus a `mapRow` implementation; repositories add their own queries
  on top.
- `BaseService` holds the `RequestContext` and exposes `requireOwner` and
  `requirePermission`, which throw `403` — the substitute for row-level security.
- `getRequestContext(event)` reads the session cookie, loads the session row, and resolves
  `{ userId, roles, permissions }`. No cookie or an expired session throws
  `401 Not authenticated`.

### Pure domain logic in `shared/lib`

Framework-free, individually unit-tested, and importable from both a Vue `computed()` and a
service: `formulas.ts` (BMI, TDEE, unit conversion), `nutrition-targets.ts`,
`meal-fit.ts`, `meal-type.ts`, `plate-calculator.ts`, `recovery-checker.ts`,
`equipment.ts`, `sparkline.ts`.

### Frontend data flow

Pages stay declarative: one composable per query or mutation
(`app/composables/use*.ts`, ~50 of them) wrapping `@pinia/colada` over a `$fetch` instance
that forwards cookies during SSR (`app/plugins/api.ts`). Query keys are centralized in
`app/composables/query-keys.ts`. `app/middleware/auth.global.ts` guards navigation via
`GET /api/auth/me`, cached client-side for 30s.

### Schema management

`server/database/schema.sql` is idempotent — `CREATE TABLE IF NOT EXISTS` plus `ALTER TABLE`
statements applied by the seed script, which swallows only duplicate-column errors. Genuine
reshapes (widening a `CHECK` constraint, making a column nullable) live as explicit
table-rebuild migrations in `server/database/migrations/` and run before the schema pass.

### Project structure

```
app/            Vue app — pages, layouts, components, composables, stores, service worker
server/         Nitro API routes, services, repositories, database scripts, utils
shared/         Cross-boundary types, Zod schemas, pure domain logic
tests/          Vitest suites mirroring server/ and shared/
docs/           API reference and per-feature design + implementation plans
.github/        Hydration-reminder dispatch cron
```

---

## Getting started

### Prerequisites

- Node.js 22+
- A [Turso](https://turso.tech) database (or a local libSQL / `file:` URL)

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | libSQL connection URL |
| `TURSO_AUTH_TOKEN` | Turso auth token |
| `VAPID_PUBLIC_KEY` | Web-push public key — `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Web-push private key |
| `CRON_SECRET` | Bearer token the reminder-dispatch endpoint requires |

### 3. Seed the database

```bash
npm run db:seed               # migrations + schema + exercises + preset foods + roles
npm run db:classify-exercises # tag movement patterns, tiers and joint stressors
npm run db:seed:dummy         # optional: a demo user with history
```

### 4. Run

```bash
npm run dev                   # http://localhost:3000
```

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server on `http://localhost:3000` |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build locally |
| `npm run generate` | Static generation |
| `npm test` | Run the Vitest suite once |
| `npm run db:seed` | Apply migrations + schema, seed catalog data and roles |
| `npm run db:seed:dummy` | Seed a demo user with sessions, meals, and metrics |
| `npm run db:classify-exercises` | Backfill movement patterns and tiers, and rebuild joint stressor tags (run after `db:seed`) |
| `npm run db:backfill-rep-ranges` | One-off: fill `target_reps_min`/`max` on rows an older client wrote. Idempotent |
| `npm run db:backfill-prs` | One-off: replay logged sets to populate `personal_records`. Idempotent |

---

## Testing

```bash
npm test
```

Vitest covers the repository layer against a real throwaway libSQL database
(`server/utils/test/create-test-db.ts`), the service layer, request-context and password
utilities, the migration rebuilds, and every pure function in `shared/lib`.

---

## Documentation

- [`docs/api.md`](docs/api.md) — full backend API reference: every route's body, response
  shape, and status codes, plus the auth and concurrency conventions.
- [`docs/plans/`](docs/plans/) — per-feature design documents and implementation plans.
- A generated OpenAPI spec is served by Nitro in dev at `/_openapi.json`, with browsable
  UIs at `/_swagger` and `/_scalar`.

> `docs/` is listed in `.gitignore` but tracked — commit changes there with `git add -f`.

---

## Deployment notes

- Deploy anywhere Nitro runs; set the five environment variables above.
- Hydration reminders need an external scheduler to `POST /api/hydration/reminders/dispatch`
  with `Authorization: Bearer $CRON_SECRET`. The included GitHub Actions workflow
  (`.github/workflows/hydration-reminders.yml`) does this every 15 minutes and needs an
  `APP_URL` repository variable and a `CRON_SECRET` secret. The schedule is best-effort by
  design — dispatch only checks whether enough time has elapsed per user, not that it fired
  on an exact minute.
- Prometheus metrics are exposed by `@artmizu/nuxt-prometheus`.
