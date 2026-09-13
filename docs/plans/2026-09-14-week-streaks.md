# Week Streaks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken, never-resetting "day" streak counter with a week streak derived from session history, with a one-session-per-week grace.

**Architecture:** Two pure functions in `shared/lib/streak.ts`: `buildStreakWeeks` assembles weekly scheduled/completed counts, and `computeWeekStreak` walks them. `GamificationService.getStreak` feeds them from two grouped queries. `StreakRepository` and all streak writes are deleted; Home, the session summary and achievements read the derived value.

**Tech Stack:** Nuxt 4 / Nitro, libSQL, Vitest.

**Design doc:** `docs/plans/2026-09-14-week-streaks-design.md`

---

## Before you start

- **Run after** `docs/plans/2026-09-14-progression-and-prs.md`. This plan edits the
  `server/utils/session-service.ts` helper and the `SessionService` constructor that plan
  introduces. If it hasn't landed, apply the constructor changes below to the routes directly.
- `npx vitest run` must be green before Task 1.
- Commit on `main`; end messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
  Stage explicit paths. Other sessions may have unrelated dirty files.

---

### Task 1: `computeWeekStreak` and `buildStreakWeeks`

**Files:**
- Create: `shared/lib/streak.ts`
- Create: `tests/shared/lib/streak.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/shared/lib/streak.test.ts
import { describe, expect, it } from 'vitest'
import { buildStreakWeeks, computeWeekStreak, requiredSessions, type StreakWeek } from '~~/shared/lib/streak'

const week = (weekStart: string, scheduled: number, completed: number): StreakWeek => ({ weekStart, scheduled, completed })

describe('requiredSessions', () => {
  it('allows one missed session per week, never requiring fewer than one', () => {
    expect(requiredSessions(1)).toBe(1)
    expect(requiredSessions(2)).toBe(1)
    expect(requiredSessions(5)).toBe(4)
  })
})

describe('computeWeekStreak', () => {
  it('counts consecutive hit weeks ending at the last finished week', () => {
    const result = computeWeekStreak([
      week('2026-08-17', 3, 0),
      week('2026-08-24', 3, 2),
      week('2026-08-31', 3, 3),
    ], '2026-09-07')
    expect(result.current).toBe(2)
    expect(result.longest).toBe(2)
  })

  it('resets on a missed week', () => {
    expect(computeWeekStreak([week('2026-08-24', 3, 3), week('2026-08-31', 3, 1)], '2026-09-07').current).toBe(0)
  })

  it('skips neutral weeks without breaking the streak', () => {
    expect(computeWeekStreak([
      week('2026-08-17', 3, 3),
      week('2026-08-24', 0, 0),
      week('2026-08-31', 3, 2),
    ], '2026-09-07').current).toBe(2)
  })

  it('adds the in-progress week once it is hit', () => {
    const result = computeWeekStreak([week('2026-08-31', 3, 3), week('2026-09-07', 3, 2)], '2026-09-07')
    expect(result.current).toBe(2)
    expect(result.thisWeek).toEqual({ completed: 2, required: 2, scheduled: 3 })
  })

  it('never breaks the streak with an in-progress week that is not yet hit', () => {
    const result = computeWeekStreak([week('2026-08-31', 3, 3), week('2026-09-07', 3, 0)], '2026-09-07')
    expect(result.current).toBe(1)
    expect(result.thisWeek).toEqual({ completed: 0, required: 2, scheduled: 3 })
  })

  it('tracks a longest streak longer than the current one', () => {
    const result = computeWeekStreak([
      week('2026-08-03', 2, 1),
      week('2026-08-10', 2, 2),
      week('2026-08-17', 2, 1),
      week('2026-08-24', 2, 0),
      week('2026-08-31', 2, 2),
    ], '2026-09-07')
    expect(result).toMatchObject({ current: 1, longest: 3 })
  })

  it('reports zeros with no history', () => {
    expect(computeWeekStreak([], '2026-09-07')).toEqual({ current: 0, longest: 0, thisWeek: { completed: 0, required: 0, scheduled: 0 } })
  })
})

describe('buildStreakWeeks', () => {
  it('spans from the earliest trained week to the current week, resolving each week\'s block', () => {
    const weeks = buildStreakWeeks({
      schedules: [
        { startDate: '2026-08-01', endDate: '2026-08-26', trainingDays: 3 },
        { startDate: '2026-08-27', endDate: null, trainingDays: 5 },
      ],
      completedDaysByWeek: { '2026-08-17': 3, '2026-08-31': 4 },
      currentWeekStart: '2026-09-07',
    })
    expect(weeks).toEqual([
      { weekStart: '2026-08-17', scheduled: 3, completed: 3 },
      // Monday 2026-08-24 is covered by the first block
      { weekStart: '2026-08-24', scheduled: 3, completed: 0 },
      { weekStart: '2026-08-31', scheduled: 5, completed: 4 },
      { weekStart: '2026-09-07', scheduled: 5, completed: 0 },
    ])
  })

  it('falls back to the block active on Sunday when none was active Monday', () => {
    const weeks = buildStreakWeeks({
      schedules: [{ startDate: '2026-09-03', endDate: null, trainingDays: 4 }],
      completedDaysByWeek: { '2026-08-31': 2 },
      currentWeekStart: '2026-08-31',
    })
    expect(weeks).toEqual([{ weekStart: '2026-08-31', scheduled: 4, completed: 2 }])
  })

  it('marks weeks with no block as neutral', () => {
    const weeks = buildStreakWeeks({ schedules: [], completedDaysByWeek: { '2026-08-31': 2 }, currentWeekStart: '2026-09-07' })
    expect(weeks.every(w => w.scheduled === 0)).toBe(true)
  })

  it('crosses a year boundary', () => {
    const weeks = buildStreakWeeks({ schedules: [], completedDaysByWeek: { '2025-12-22': 1 }, currentWeekStart: '2026-01-05' })
    expect(weeks.map(w => w.weekStart)).toEqual(['2025-12-22', '2025-12-29', '2026-01-05'])
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/shared/lib/streak.test.ts`
Expected: FAIL, module not found.

**Step 3: Implement**

```ts
// shared/lib/streak.ts

export interface StreakWeek {
  weekStart: string   // Monday, YYYY-MM-DD (UTC)
  scheduled: number   // non-rest days in that week's block; 0 = neutral week
  completed: number   // distinct days with a completed session
}

export interface WeekStreak {
  current: number
  longest: number
  thisWeek: { completed: number, required: number, scheduled: number }
}

export interface BlockSchedule {
  startDate: string
  endDate: string | null
  trainingDays: number
}

// One session of grace per week: a 4-day split counts with 3. Never below one, so a 1-day
// split still needs its session.
export const requiredSessions = (scheduled: number): number => Math.max(1, scheduled - 1)

const isNeutral = (week: StreakWeek) => week.scheduled === 0
const isHit = (week: StreakWeek) => !isNeutral(week) && week.completed >= requiredSessions(week.scheduled)

export const computeWeekStreak = (weeks: StreakWeek[], currentWeekStart: string): WeekStreak => {
  const sorted = [...weeks].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  const thisWeekEntry = sorted.find(w => w.weekStart === currentWeekStart)

  let current = 0
  const finished = sorted.filter(w => w.weekStart < currentWeekStart)
  for (let i = finished.length - 1; i >= 0; i--) {
    const week = finished[i]!
    if (isNeutral(week)) continue
    if (!isHit(week)) break
    current++
  }
  // The in-progress week can only add to the streak; it can't break it until it has finished.
  if (thisWeekEntry && isHit(thisWeekEntry)) current++

  let longest = 0
  let run = 0
  for (const week of sorted) {
    if (week.weekStart > currentWeekStart || isNeutral(week)) continue
    if (isHit(week)) {
      run++
      longest = Math.max(longest, run)
    } else if (week.weekStart < currentWeekStart) {
      run = 0
    }
  }

  const scheduled = thisWeekEntry?.scheduled ?? 0
  return {
    current,
    longest,
    thisWeek: { completed: thisWeekEntry?.completed ?? 0, required: scheduled === 0 ? 0 : requiredSessions(scheduled), scheduled },
  }
}

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const activeOn = (schedules: BlockSchedule[], isoDate: string): BlockSchedule | undefined =>
  schedules
    .filter(s => s.startDate <= isoDate && (s.endDate === null || s.endDate >= isoDate))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]

// Every week from the earliest trained week to the current one, so missed weeks in between
// appear (as scheduled > 0, completed 0) rather than silently vanishing.
export const buildStreakWeeks = (input: {
  schedules: BlockSchedule[]
  completedDaysByWeek: Record<string, number>
  currentWeekStart: string
}): StreakWeek[] => {
  const trainedWeeks = Object.keys(input.completedDaysByWeek).sort()
  const firstWeek = trainedWeeks[0]
  if (!firstWeek) return []

  const weeks: StreakWeek[] = []
  for (let weekStart = firstWeek; weekStart <= input.currentWeekStart; weekStart = addDays(weekStart, 7)) {
    const block = activeOn(input.schedules, weekStart) ?? activeOn(input.schedules, addDays(weekStart, 6))
    weeks.push({ weekStart, scheduled: block?.trainingDays ?? 0, completed: input.completedDaysByWeek[weekStart] ?? 0 })
  }
  return weeks
}
```

`buildStreakWeeks` returns `[]` for a user who has never trained. Task 3's `getStreak`
seeds the current week into `completedDaysByWeek` so `thisWeek` still reflects the active
block.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/shared/lib/streak.test.ts`
Expected: PASS (12 tests).

**Step 5: Commit**

```bash
git add shared/lib/streak.ts tests/shared/lib/streak.test.ts
git commit -m "feat(streak): derive week streaks with a one-session grace from weekly counts"
```

---

### Task 2: Weekly completed-days and schedule-history queries

**Files:**
- Modify: `server/repositories/session.repository.ts` (add `completedDaysByWeek`)
- Modify: `server/repositories/block.repository.ts` (add `findScheduleHistory`)
- Test: `tests/server/repositories/session.repository.test.ts`, `tests/server/repositories/block.repository.test.ts`

**Step 1: Write the failing tests**

```ts
// session.repository.test.ts
describe('SessionRepository.completedDaysByWeek', () => {
  it('counts distinct completed days per Monday-start week, across a year boundary', async () => {
    const db = await createTestDb()
    const repo = new SessionRepository(db)
    await seedUserAndBlock(db)
    const complete = async (id: string, startedAt: string) => {
      await repo.startSession('user-1', { id, splitDayId: null, exercises: [] })
      await repo.completeSession(id, 1)
      await db.execute({ sql: 'UPDATE workout_sessions SET started_at = ? WHERE id = ?', args: [startedAt, id] })
    }
    await complete('a', '2025-12-29 09:00:00') // Monday
    await complete('b', '2026-01-01 09:00:00') // Thursday, same week
    await complete('c', '2026-01-01 18:00:00') // same day as b
    await complete('d', '2026-01-04 09:00:00') // Sunday, same week
    await complete('e', '2026-01-05 09:00:00') // next Monday
    await repo.startSession('user-1', { id: 'live', splitDayId: null, exercises: [] }) // in progress, ignored

    expect(await repo.completedDaysByWeek('user-1')).toEqual({ '2025-12-29': 3, '2026-01-05': 1 })
  })
})
```

```ts
// block.repository.test.ts
describe('BlockRepository.findScheduleHistory', () => {
  it('returns every block with its non-rest day count', async () => {
    const db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
    const repo = new BlockRepository(db)
    await repo.createWithDays('user-1', {
      programId: null, name: 'A', startDate: '2026-01-01', endDate: '2026-02-01', trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [
        { name: 'Push', dayOfWeek: 0, location: 'gym', exercises: [] },
        { name: 'Rest', dayOfWeek: 1, location: 'home', isRestDay: true, exercises: [] },
      ],
    })
    await repo.createWithDays('user-1', {
      programId: null, name: 'B', startDate: '2026-02-02', endDate: null, trainingDayMacroTarget: null, restDayMacroTarget: null,
      days: [],
    })

    expect(await repo.findScheduleHistory('user-1')).toEqual([
      { startDate: '2026-01-01', endDate: '2026-02-01', trainingDays: 1 },
      { startDate: '2026-02-02', endDate: null, trainingDays: 0 },
    ])
  })
})
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/repositories/session.repository.test.ts tests/server/repositories/block.repository.test.ts`
Expected: FAIL, not a function.

**Step 3: Implement**

```ts
  // Keyed by the week's Monday (UTC), matching startOfWeek in server/utils/date.ts:
  // date(x, 'weekday 0') moves forward to Sunday (or stays on one), then -6 days lands on Monday.
  async completedDaysByWeek(userId: string): Promise<Record<string, number>> {
    const result = await this.db.execute({
      sql: `SELECT date(started_at, 'weekday 0', '-6 days') AS week_start, COUNT(DISTINCT date(started_at)) AS days
            FROM workout_sessions
            WHERE user_id = ? AND status = 'completed'
            GROUP BY week_start`,
      args: [userId],
    })
    return Object.fromEntries(result.rows.map(row => [row.week_start as string, row.days as number]))
  }
```

```ts
  async findScheduleHistory(userId: string): Promise<BlockSchedule[]> {
    const result = await this.db.execute({
      sql: `SELECT b.start_date, b.end_date,
                   COALESCE(SUM(CASE WHEN sd.is_rest_day = 0 THEN 1 ELSE 0 END), 0) AS training_days
            FROM blocks b
            LEFT JOIN split_days sd ON sd.block_id = b.id
            WHERE b.user_id = ?
            GROUP BY b.id
            ORDER BY b.start_date, b.id`,
      args: [userId],
    })
    return result.rows.map(row => ({
      startDate: row.start_date as string,
      endDate: row.end_date as string | null,
      trainingDays: row.training_days as number,
    }))
  }
```

(Import `BlockSchedule` from `~~/shared/lib/streak`.)

**Step 4: Run to verify pass**

Run: same as Step 2. Expected: PASS.

**Step 5: Commit**

```bash
git add server/repositories/session.repository.ts server/repositories/block.repository.ts tests/server/repositories/session.repository.test.ts tests/server/repositories/block.repository.test.ts
git commit -m "feat(streak): query completed days per week and block schedule history"
```

---

### Task 3: `GamificationService.getStreak` and weeks-based achievements

**Files:**
- Modify: `server/services/gamification.service.ts`
- Modify: `shared/types/gamification.types.ts` (remove `Streak`, re-export `WeekStreak`)
- Test: `tests/server/services/gamification.service.test.ts`

New constructor: `(xp: XpRepository, achievements: AchievementRepository, sessions: SessionRepository, blocks: BlockRepository)`.
`streaks` is removed.

**Step 1: Rewrite the streak tests**

In `gamification.service.test.ts`:
- `beforeEach`: `new GamificationService(new XpRepository(db), achievements, new SessionRepository(db), new BlockRepository(db))`.
- Delete "does not increment the streak when a scheduled day was missed" and "leaves the streak unchanged for a mid-week session".
- Replace "unlocks a streak_length achievement…" with:

```ts
  const seedBlock = (trainingDays: number) => new BlockRepository(db).createWithDays('user-1', {
    programId: null, name: 'Block', startDate: '2020-01-01', endDate: null, trainingDayMacroTarget: null, restDayMacroTarget: null,
    days: Array.from({ length: trainingDays }, (_, i) => ({ name: `Day ${i}`, dayOfWeek: i, location: 'gym' as const, exercises: [] })),
  })

  const completeOn = async (id: string, startedAt: string) => {
    const sessions = new SessionRepository(db)
    await sessions.startSession('user-1', { id, splitDayId: null, exercises: [] })
    await sessions.completeSession(id, 1)
    await db.execute({ sql: 'UPDATE workout_sessions SET started_at = ? WHERE id = ?', args: [startedAt, id] })
  }

  it('derives the streak from completed sessions and the block schedule', async () => {
    await seedBlock(2)
    await completeOn('a', '2026-08-24 09:00:00')
    await completeOn('b', '2026-08-31 09:00:00')

    const streak = await service.getStreak('user-1', new Date('2026-09-08T12:00:00Z'))

    expect(streak).toEqual({ current: 2, longest: 2, thisWeek: { completed: 0, required: 1, scheduled: 2 } })
  })

  it('reports this week\'s requirement from the active block before any training', async () => {
    await seedBlock(4)
    expect((await service.getStreak('user-1', new Date('2026-09-08T12:00:00Z'))).thisWeek).toEqual({ completed: 0, required: 3, scheduled: 4 })
  })

  it('unlocks a streak_length achievement from the derived week streak', async () => {
    await achievements.create({
      key: 'week-streak', name: 'Two Weeks', description: null, icon: null,
      criteriaType: 'streak_length', criteriaValue: { weeks: 2 }, isPublished: true,
    })
    await seedBlock(1)

    await completeOn('a', '2026-08-24 09:00:00')
    await service.onSessionCompleted('user-1', 'a', new Date('2026-08-25T12:00:00Z'))
    expect(await achievements.findUnlockedKeys('user-1')).not.toContain('week-streak')

    await completeOn('c', '2026-08-31 09:00:00')
    await service.onSessionCompleted('user-1', 'c', new Date('2026-09-02T12:00:00Z'))
    expect(await achievements.findUnlockedKeys('user-1')).toContain('week-streak')
  })
```

`onSessionCompleted` and `evaluateAchievements` take an optional `now: Date` (default
`new Date()`) passed through to `getStreak`, so these tests don't depend on the real clock.

- Update the `getAchievementProgress` streak test (if present) to `criteriaValue: { weeks: N }` and `unit: 'weeks'`.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/services/gamification.service.test.ts`
Expected: FAIL (constructor shape, `getStreak` missing).

**Step 3: Implement**

```ts
import { buildStreakWeeks, computeWeekStreak, type WeekStreak } from '~~/shared/lib/streak'
import { startOfWeek } from '~~/server/utils/date'
import type { BlockRepository } from '~~/server/repositories/block.repository'

export class GamificationService {
  constructor(
    private xp: XpRepository,
    private achievements: AchievementRepository,
    private sessions: SessionRepository,
    private blocks: BlockRepository,
  ) {}

  async onSetLogged(userId: string, setId: string): Promise<void> { /* unchanged */ }
  async onPrHit(userId: string, prId: string): Promise<void> { /* unchanged */ }

  async onSessionCompleted(userId: string, sessionId: string, now: Date = new Date()): Promise<void> {
    await this.xp.award(userId, XP_SESSION_COMPLETE_BONUS, 'session_completed', sessionId)
    await this.evaluateAchievements(userId, now)
  }

  // Derived on every read from session history and block schedules -- there is no stored
  // counter to drift. See shared/lib/streak.ts for the rules.
  async getStreak(userId: string, now: Date = new Date()): Promise<WeekStreak> {
    const currentWeekStart = startOfWeek(now).toISOString().slice(0, 10)
    const [schedules, completedDaysByWeek] = await Promise.all([
      this.blocks.findScheduleHistory(userId),
      this.sessions.completedDaysByWeek(userId),
    ])
    // Ensure the current week is present so thisWeek reflects the active block even before the
    // user has trained at all.
    const weeks = buildStreakWeeks({ schedules, completedDaysByWeek: { [currentWeekStart]: 0, ...completedDaysByWeek }, currentWeekStart })
    return computeWeekStreak(weeks, currentWeekStart)
  }
```

Adding `{ [currentWeekStart]: 0 }` makes `buildStreakWeeks` start no later than this week,
and the spread keeps real counts. A user with no history still gets one week, so
`thisWeek.scheduled` comes from the active block.

- `AchievementFacts.streak: WeekStreak`. `gatherAchievementFacts(userId, now)` calls `this.getStreak(userId, now)` instead of the streaks repo.
- `computeProgress` streak case: `return { current: facts.streak.current, target: achievement.criteriaValue.weeks as number, unit: 'weeks' }`
- `evaluateAchievements` streak case: `met = facts.streak.current >= (achievement.criteriaValue.weeks as number)`
- Delete `SessionCompletionFacts`.
- In `gamification.types.ts`, delete `interface Streak` and add `export type { WeekStreak } from '~~/shared/lib/streak'`.

**Step 4: Run to verify pass**

Run: `npx vitest run tests/server/services/gamification.service.test.ts`
Expected: PASS.

**Step 5: Commit** (the full suite is red until Task 4; commit anyway, don't push)

```bash
git add server/services/gamification.service.ts shared/types/gamification.types.ts tests/server/services/gamification.service.test.ts
git commit -m "feat(streak): compute streaks in GamificationService and measure streak achievements in weeks"
```

---

### Task 4: Rewire callers, delete `StreakRepository`

**Files:**
- Modify: `server/services/session.service.ts`
- Modify: `server/services/home.service.ts`
- Modify: `shared/types/home.types.ts`
- Modify: `server/utils/session-service.ts`, `server/api/achievements.get.ts`, `server/api/home/index.get.ts` (and any other `new GamificationService` / `new HomeService` / `new SessionService`: `grep -rn "new GamificationService\|new HomeService\|new SessionService" server tests`)
- Delete: `server/repositories/streak.repository.ts`, `tests/server/repositories/streak.repository.test.ts`
- Modify: `server/database/seed-dummy.ts` (streak insert + `week_streak` unlock)
- Tests: `tests/server/services/session.service.test.ts`, `tests/server/services/home.service.test.ts`

**Step 1: Update tests first**

`session.service.test.ts`:
- `SessionService` constructor is now `(ctx, sessions, gamification, xp, deps)`. `blocks` and `streaks` are gone. Update every `new SessionService(...)`.
- Delete "calls GamificationService.onSessionCompleted with the computed weekly facts", "excludes rest days from scheduledDaysThisWeek", and "reports zero scheduled days when the user has no active block…". That logic no longer exists.
- Add:

```ts
  it('calls onSessionCompleted with just the user and session', async () => {
    await sessions.startSession('user-1', { id: 'session-1', splitDayId: null, exercises: [] })
    await service.completeSession('session-1', 1)
    expect(onSessionCompleted).toHaveBeenCalledWith('user-1', 'session-1')
  })
```

- For the summary test, stub `getStreak` on the gamification double:
  `{ onSessionCompleted, getStreak: vi.fn().mockResolvedValue({ current: 3, longest: 5, thisWeek: { completed: 1, required: 2, scheduled: 3 } }) }`,
  and expect `summary.currentStreak` toBe `3`.

`home.service.test.ts`:
- Construct `HomeService` with a real `GamificationService(xp, achievements, sessions, blocks)` in place of `new StreakRepository(db)`.
- `expect(summary.streak).toEqual({ current: 0, longest: 0, thisWeek: { completed: 0, required: 0, scheduled: 0 } })` for a user without a block.

**Step 2: Run to verify failure**

Run: `npx vitest run tests/server/services`
Expected: FAIL on constructor shapes.

**Step 3: Implement**

`SessionService`:
- Constructor: remove `blocks` and `streaks` params.
- `completeSession`: delete the week/scheduled/completed computation and `missedScheduledDay`; call `this.gamification.onSessionCompleted(this.ctx.userId, sessionId)` inside the existing try/catch.
- Summary: replace `this.streaks.findForUser(...)` in the `Promise.all` with `this.gamification.getStreak(this.ctx.userId)`, and set `currentStreak: streak.current`.
- Remove now-unused imports (`startOfWeek`, `toSqliteDatetime`, `BlockRepository`, `StreakRepository`).

`HomeService`:
- Replace the `streaks: StreakRepository` constructor param with `gamification: GamificationService` (same position).
- In `getSummary`'s first `Promise.all`, use `this.gamification.getStreak(userId, now)`.
- Return `streak` as-is (`{ current, longest, thisWeek }`).

`home.types.ts`: `streak: WeekStreak`.

Routes: construct `new GamificationService(xp, new AchievementRepository(db), sessions, new BlockRepository(db))` and drop `StreakRepository` imports. In `server/utils/session-service.ts`: `new SessionService(ctx, sessions, gamification, xp, { ... })`.

Delete `server/repositories/streak.repository.ts` and its test.

`seed-dummy.ts`: delete the `INSERT INTO streaks` block and the `currentStreak >= 7` unlock of `week_streak` (lines around the `streaks` insert). Achievements are evaluated live now.

**Step 4: Verify**

Run: `grep -rn "StreakRepository\|missedScheduledDay\|scheduledDaysThisWeek\|currentStreak >=" server shared tests app`
Expected: no output.

Run: `npx vitest run && npx nuxi typecheck`
Expected: tests pass. Type errors only in `app/` streak displays (fixed in Task 6).

**Step 5: Commit**

```bash
git add -A server/services server/api server/utils server/repositories server/database/seed-dummy.ts shared/types tests/server
git commit -m "refactor(streak): read derived streaks everywhere and remove the stored streak counter"
```

(Check `git status` first. `-A` on these directories must not pick up another session's files.)

---

### Task 5: Re-seed streak achievements in weeks

**Files:**
- Modify: `server/database/seed.ts` (the three `streak_length` entries in `starterAchievements`)

**Step 1: Replace the entries**

```ts
    { key: 'week_streak', name: 'First Full Week', description: 'Hit your training week: every scheduled session, give or take one.', icon: '🔥', criteriaType: 'streak_length' as const, criteriaValue: { weeks: 1 }, isPublished: true },
    { key: 'month_streak', name: 'Four Weeks Strong', description: 'Four training weeks in a row.', icon: '🏆', criteriaType: 'streak_length' as const, criteriaValue: { weeks: 4 }, isPublished: true },
    { key: 'iron_will', name: 'Iron Quarter', description: 'Twelve training weeks in a row.', icon: '⚡', criteriaType: 'streak_length' as const, criteriaValue: { weeks: 12 }, isPublished: true },
```

Keys are unchanged, so `upsertByKey` updates existing rows and existing unlocks are kept.

**Step 2: Verify** against a dev database: `npm run db:seed`, then
`SELECT key, criteria_value FROM achievements WHERE criteria_type = 'streak_length'` shows
`{"weeks":…}` for all three.

**Step 3: Commit**

```bash
git add server/database/seed.ts
git commit -m "feat(achievements): measure streak achievements in training weeks"
```

---

### Task 6: UI copy

**Files:**
- Modify: `app/pages/index.vue` (streak card)
- Modify: `app/pages/workouts/session/[id].vue` (summary streak card)

**Step 1: Home streak card.** Replace the label span:

```vue
<span class="text-muted-foreground font-thin">
  Week Streak<template v-if="stats?.streak.longest">
    &middot; Best {{ stats.streak.longest }}</template>
</span>
<span v-if="stats?.streak.thisWeek.scheduled" class="text-xs text-muted-foreground font-mono">
  {{ stats.streak.thisWeek.completed }} of {{ stats.streak.thisWeek.required }} this week
</span>
```

**Step 2: Session summary.** `{{ completionSummary.currentStreak }} {{ completionSummary.currentStreak === 1 ? "week" : "weeks" }}`.

**Step 3: Verify manually.** `npm run dev`. Home shows "N Week Streak · Best M" and
"x of y this week" when a split is active. Finishing a workout shows "N weeks". The Profile
achievements grid shows streak progress as "1/4 weeks".

**Step 4: Commit**

```bash
git add app/pages/index.vue "app/pages/workouts/session/[id].vue"
git commit -m "feat(home): show the week streak and this week's progress"
```

---

### Task 7: Final verification

1. `npx vitest run`: all pass.
2. `npx nuxi typecheck`: no new errors.
3. `npx eslint .`: clean.
4. README "Gamification → Streaks" bullet: "A week counts when you complete at least your scheduled sessions minus one (never fewer than one), on any days. Weeks without a split are skipped. Derived from session history, not stored."
5. `git add README.md && git commit -m "docs: describe week streaks"`.
