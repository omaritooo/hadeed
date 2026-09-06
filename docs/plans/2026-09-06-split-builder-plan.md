# Split Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the actual `/builder` page (currently a 5-line stub) so a user can create a split — from a
recommended preset or fully from scratch — both for a first-time setup and to replace an already-active
split. Separately, restyle the exercise cards on the workout session page.

**Architecture:** `/builder` is one page with local (non-Pinia) step state — a `reactive` step object, not
a store, since (unlike onboarding) this flow never leaves the page. Creating a replacement split reuses
the existing `POST /api/blocks` / `POST /api/blocks/from-preset` endpoints unconditionally: `SplitService`
now retires whatever block is currently active for the user (sets its `end_date` to the day before the new
block's `start_date`) before creating the new one, which is a no-op when there's nothing to retire. A new
`GET /api/exercises?search=` endpoint backs the custom builder's exercise picker, built on the `Combobox`
component already in the repo (extended with an optional `search-term` v-model so a parent can drive it
from a remote query instead of only filtering a static list).

**Tech Stack:** Nuxt/Nitro, `@libsql/client`, Vitest, Pinia Colada (`useQuery`/`useMutation`), reka-ui
`Combobox` primitives already wrapped in `app/components/ui/combobox/`.

**Context this plan assumes:**
- Design doc: `docs/plans/2026-09-06-split-builder-design.md` — read it first for the rationale behind
  "replace, don't edit-in-place" and the retire-then-create approach.
- Existing conventions: tests live under `tests/server/**` mirroring `server/**`, import via `~~/` alias;
  `server/utils/test/create-test-db.ts` gives an in-memory schema-applied DB for tests. Route handlers
  (`server/api/**`) are conventionally left untested directly in this codebase — only repositories and
  services get unit tests — so no new route-level test files are added here.
- Seeded test accounts (`npm run db:seed:dummy`, password from `DUMMY_PASSWORD` in
  `server/database/seed-dummy.ts`): `test-user@hadeed.dev` and `test-user-2@hadeed.dev` have an active
  block; `test-user-empty@hadeed.dev` has none. Use the empty one for the "first split" path and one of
  the others for the "replace" path.
- `queryKeys` (`app/composables/query-keys.ts`) is auto-imported everywhere as `queryKeys.xxx()` — no
  explicit import needed in `.vue`/`.ts` files under `app/`.

---

## Task 1: `dayBefore` date helper

**Files:**
- Modify: `server/utils/date.ts`
- Test: `tests/server/utils/date.test.ts` (new file)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { dayBefore } from '~~/server/utils/date'

describe('dayBefore', () => {
  it('returns the previous calendar day as YYYY-MM-DD', () => {
    expect(dayBefore('2026-09-06')).toBe('2026-09-05')
  })

  it('rolls back across a month boundary', () => {
    expect(dayBefore('2026-09-01')).toBe('2026-08-31')
  })

  it('rolls back across a year boundary', () => {
    expect(dayBefore('2026-01-01')).toBe('2025-12-31')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/utils/date.test.ts`
Expected: FAIL — `dayBefore` is not exported.

**Step 3: Implement**

Append to `server/utils/date.ts`:

```ts
export const dayBefore = (dateString: string): string => {
  const date = new Date(`${dateString}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/utils/date.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add server/utils/date.ts tests/server/utils/date.test.ts
git commit -m "feat: add dayBefore date helper"
```

---

## Task 2: `SplitService` retires the active block before creating a replacement

**Files:**
- Modify: `server/services/split.service.ts`
- Test: `tests/server/services/split.service.test.ts`

**Step 1: Write the failing tests**

Add to `tests/server/services/split.service.test.ts` (new `describe` block; keep existing ones intact):

```ts
describe('SplitService — retiring the previously active block', () => {
  let db: Client
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-1', 'a@example.com'] })
  })

  it('end-dates the currently active block the day before a new from-scratch block starts', async () => {
    const service = new SplitService(ctx, new BlockRepository(db))
    const original = await service.createFromScratch({ name: 'Old', startDate: '2026-01-01', endDate: null, days: [] })

    await service.createFromScratch({ name: 'New', startDate: '2026-09-06', endDate: null, days: [] })

    const retired = await service.getOwnedBlock(original.id)
    expect(retired?.endDate).toBe('2026-09-05')
  })

  it('does nothing to retire when there is no currently active block', async () => {
    const service = new SplitService(ctx, new BlockRepository(db))
    const block = await service.createFromScratch({ name: 'First', startDate: '2026-09-06', endDate: null, days: [] })
    expect(block.endDate).toBeNull()
  })

  it('only retires a block belonging to the same user', async () => {
    await db.execute({ sql: 'INSERT INTO users (id, email) VALUES (?, ?)', args: ['user-2', 'b@example.com'] })
    const otherCtx: RequestContext = { userId: 'user-2', roles: [], permissions: [] }
    const owner = new SplitService(ctx, new BlockRepository(db))
    const intruder = new SplitService(otherCtx, new BlockRepository(db))

    const original = await owner.createFromScratch({ name: 'Mine', startDate: '2026-01-01', endDate: null, days: [] })
    await intruder.createFromScratch({ name: 'Theirs', startDate: '2026-09-06', endDate: null, days: [] })

    const untouched = await owner.getOwnedBlock(original.id)
    expect(untouched?.endDate).toBeNull()
  })

  it('also retires the active block when replacing via createFromPreset', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    const presets = new PresetSplitRepository(db)
    const preset = await presets.createWithDays({
      name: 'PPL', description: null, frequencyMinDays: 6, frequencyMaxDays: 6,
      goal: null, experienceLevel: null, equipment: 'gym', isPublished: true,
      days: [{ name: 'Push', dayIndex: 0, location: 'gym', targetMuscleIds: [], exercises: [] }],
    })
    const presetWithDays = await presets.findWithDays(preset.id)

    const service = new SplitService(ctx, new BlockRepository(db))
    const original = await service.createFromScratch({ name: 'Old', startDate: '2026-01-01', endDate: null, days: [] })

    await service.createFromPreset(presetWithDays!, { name: 'New', startDate: '2026-09-06', endDate: null })

    const retired = await service.getOwnedBlock(original.id)
    expect(retired?.endDate).toBe('2026-09-05')
  })
})
```

Add the `PresetSplitRepository` import if not already present at the top of the test file (it already is,
from the existing `createFromPreset` describe block).

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/services/split.service.test.ts`
Expected: FAIL — retired blocks still have `endDate: null`.

**Step 3: Implement**

`BlockRepository` has no update method yet. Add one to `server/repositories/block.repository.ts`, right
after `createWithDays`:

```ts
  async setEndDate(blockId: number, endDate: string): Promise<void> {
    await this.db.execute({
      sql: 'UPDATE blocks SET end_date = ? WHERE id = ?',
      args: [endDate, blockId],
    })
  }
```

Then, in `server/services/split.service.ts`, add a private helper and call it from both create methods:

```ts
import { dayBefore } from '~~/server/utils/date'
// ...existing imports...

export class SplitService extends BaseService {
  constructor(ctx: RequestContext, private blocks: BlockRepository) {
    super(ctx)
  }

  private async retireActiveBlock(newStartDate: string): Promise<void> {
    const active = await this.blocks.findActiveForUser(this.ctx.userId, newStartDate)
    if (!active) return
    await this.blocks.setEndDate(active.id, dayBefore(newStartDate))
  }

  async createFromScratch(input: CreateFromScratchInput) {
    await this.retireActiveBlock(input.startDate)
    return this.blocks.createWithDays(this.ctx.userId, {
      programId: null,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      trainingDayMacroTarget: input.trainingDayMacroTarget ?? null,
      restDayMacroTarget: input.restDayMacroTarget ?? null,
      days: input.days,
    })
  }

  async createFromPreset(
    preset: PresetSplitWithDays,
    overrides: { name: string, startDate: string, endDate: string | null },
  ) {
    await this.retireActiveBlock(overrides.startDate)
    return this.blocks.createWithDays(this.ctx.userId, {
      programId: null,
      name: overrides.name,
      startDate: overrides.startDate,
      endDate: overrides.endDate,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: preset.days.map(day => ({
        name: day.name,
        dayOfWeek: day.dayIndex,
        location: day.location,
        exercises: day.exercises.map(ex => ({
          exerciseId: ex.exerciseId,
          position: ex.position,
          setType: 'weight_reps' as const,
          targetSets: ex.targetSets,
          targetReps: ex.targetReps,
          targetRpe: ex.targetRpe,
        })),
      })),
    })
  }

  async getOwnedBlock(blockId: number) {
    const block = await this.blocks.findWithDays(blockId)
    if (!block) return null
    this.requireOwner(block.userId)
    return block
  }
}
```

Note `findActiveForUser` is called with `newStartDate` (not "today") as the as-of date — retiring is about
"whatever block would otherwise be active on the day the new one starts," which for this flow is always
today, but using the new block's own `startDate` keeps the method correct if it's ever called with a
future-dated replacement.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/services/split.service.test.ts tests/server/repositories/block.repository.test.ts`
Expected: PASS, all tests including the pre-existing ones.

**Step 5: Commit**

```bash
git add server/services/split.service.ts server/repositories/block.repository.ts tests/server/services/split.service.test.ts
git commit -m "feat(splits): retire the active block when a replacement is created"
```

---

## Task 3: `ExerciseRepository.search`

**Files:**
- Modify: `server/repositories/exercise.repository.ts`
- Test: `tests/server/repositories/exercise.repository.test.ts`

**Step 1: Write the failing tests**

Add to the existing `describe('ExerciseRepository', ...)` block in
`tests/server/repositories/exercise.repository.test.ts`:

```ts
  it('searches exercises by a case-insensitive name substring', async () => {
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('bench-press', 'Bench Press', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })
    await db.execute({
      sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES ('squat', 'Barbell Squat', 'strength', 'barbell', 'push', 'beginner', 'compound', '[]')`,
    })

    const results = await repo.search('bench')
    expect(results.map(e => e.id)).toEqual(['bench-press'])

    const caseInsensitive = await repo.search('BARBELL')
    expect(caseInsensitive.map(e => e.id).sort()).toEqual(['bench-press', 'squat'])
  })

  it('search results are ordered by name and respect the limit', async () => {
    for (const name of ['Zercise C', 'Zercise A', 'Zercise B']) {
      await db.execute({
        sql: `INSERT INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
              VALUES (?, ?, 'strength', null, 'push', 'beginner', 'compound', '[]')`,
        args: [name, name],
      })
    }

    const results = await repo.search('zercise', 2)
    expect(results.map(e => e.name)).toEqual(['Zercise A', 'Zercise B'])
  })

  it('search returns an empty array for an empty query', async () => {
    expect(await repo.search('')).toEqual([])
  })
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/repositories/exercise.repository.test.ts`
Expected: FAIL — `repo.search` is not a function.

**Step 3: Implement**

Add to `server/repositories/exercise.repository.ts`, alongside `findByIds`:

```ts
  async search(query: string, limit = 30): Promise<Exercise[]> {
    if (query.trim() === '') return []
    const result = await this.db.execute({
      sql: 'SELECT * FROM exercises WHERE name LIKE ? ORDER BY name LIMIT ?',
      args: [`%${query}%`, limit],
    })
    const exercises = result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
    return this.attachDetails(exercises)
  }
```

(SQLite's `LIKE` is case-insensitive for ASCII by default, matching the case-insensitive test above.)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/repositories/exercise.repository.test.ts`
Expected: PASS, all tests including the pre-existing ones.

**Step 5: Commit**

```bash
git add server/repositories/exercise.repository.ts tests/server/repositories/exercise.repository.test.ts
git commit -m "feat(exercises): add name-search to ExerciseRepository"
```

---

## Task 4: `GET /api/exercises` search endpoint

**Files:**
- Create: `server/api/exercises/index.get.ts`

No test file — route handlers are conventionally left untested directly in this codebase (see the header
note); the logic under test is entirely in `ExerciseRepository.search`, covered by Task 3.

**Step 1: Implement**

```ts
import { getQuery } from 'h3'
import { useDb } from '~~/server/utils/db'
import { getRequestContext } from '~~/server/utils/get-request-context'
import { ExerciseRepository } from '~~/server/repositories/exercise.repository'

defineRouteMeta({
  openAPI: {
    summary: 'Search exercises by name',
    parameters: [
      { name: 'search', in: 'query', required: true, schema: { type: 'string' } },
    ],
    responses: {
      200: { description: 'Matching exercises, ordered by name, capped at 30' },
    },
  },
})

export default defineEventHandler(async (event) => {
  await getRequestContext(event)
  const query = getQuery(event)
  const search = typeof query.search === 'string' ? query.search : ''
  return new ExerciseRepository(useDb()).search(search)
})
```

`getRequestContext` is called (and its result discarded) purely to enforce the existing
authenticated-session requirement every other route has — exercise data isn't user-scoped, but an
unauthenticated search endpoint would be the only unauthenticated API route in the app.

**Step 2: Manual verification**

Run: `npm run dev`, log in as any seeded user, then in the browser console or a second tab hit
`/api/exercises?search=bench` while the session cookie is set.
Expected: a JSON array of exercises whose names contain "bench" (case-insensitively), each with
`primaryMuscles`/`secondaryMuscles`/`images` populated like other exercise endpoints.

**Step 3: Commit**

```bash
git add server/api/exercises/index.get.ts
git commit -m "feat(exercises): add GET /api/exercises search endpoint"
```

---

## Task 5: Query key + `useExerciseSearch` composable

**Files:**
- Modify: `app/composables/query-keys.ts`
- Create: `app/composables/useExerciseSearch.ts`

**Step 1: Add the query key**

In `app/composables/query-keys.ts`, add one entry to the `queryKeys` object:

```ts
  exerciseSearch: (query: string) => ['exercise-search', query] as const,
```

**Step 2: Write the composable**

```ts
import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { Exercise } from '~~/shared/types/exercise.types'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export const useExerciseSearch = (search: MaybeRefOrGetter<string>) => {
  const { $api } = useNuxtApp()

  return useQuery<Exercise[], FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.exerciseSearch(toValue(search)),
    query: () => $api<Exercise[]>('/api/exercises', { query: { search: toValue(search) } }),
    enabled: () => toValue(search).trim() !== '',
  })
}
```

**Step 3: Manual verification**

No dedicated test — this mirrors `useExerciseHistory`/`useSession`'s existing untested-composable
pattern exactly. It gets exercised end-to-end in Task 11's manual verification.

**Step 4: Commit**

```bash
git add app/composables/query-keys.ts app/composables/useExerciseSearch.ts
git commit -m "feat(exercises): add useExerciseSearch composable"
```

---

## Task 6: `Combobox` — optional `search-term` v-model for remote search

**Files:**
- Modify: `app/components/ui/combobox/Combobox.vue`

The component today only filters a static `items` list client-side via reka-ui's built-in matching against
each `ComboboxItem`'s `text-value`. `ComboboxInput` already has its own internal text `v-model` (separate
from `ComboboxRoot`'s selected-value `v-model`) — this task exposes it so a parent can react to what the
user is typing and swap `items` for server results, without changing anything for existing callers that
don't use it.

**Step 1: Implement**

```vue
<script setup lang="ts">
// ...existing imports unchanged...

const props = defineProps<{
  items: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  class?: HTMLAttributes["class"];
}>();

const model = defineModel<AcceptableValue>();
const searchTerm = defineModel<string>("searchTerm", { default: "" });

const selectedLabel = computed(() => props.items.find((item) => item.value === model.value)?.label);
</script>
```

And bind it on the input in the template:

```vue
          <ComboboxInput
            v-model="searchTerm"
            :placeholder="searchPlaceholder ?? 'Search…'"
            class="placeholder:text-muted-foreground h-11 w-full min-w-0 bg-transparent text-[16px] text-foreground outline-none"
          />
```

No other existing usages of `<Combobox>` pass `v-model:search-term`, so this is additive — they keep
working with fully local, unmanaged search text exactly as before (`defineModel` with a default falls back
to local state when the parent doesn't bind it).

**Step 2: Manual verification**

Run: `npm run dev`, exercise any existing page that already uses `<Combobox>` (check with
`grep -rl "Combobox" app/pages app/components` if none come to mind) and confirm typing/selecting still
works unchanged. This gets exercised for real, bound to remote state, in Task 11.

**Step 3: Commit**

```bash
git add app/components/ui/combobox/Combobox.vue
git commit -m "feat(combobox): expose optional search-term v-model for remote search"
```

---

## Task 7: Workouts page — "Edit Split" entry point

**Files:**
- Modify: `app/pages/workouts/index.vue`

**Step 1: Add the icon link next to the day name**

In the `summary?.todaysWorkout` card's header (the block starting `<span class="font-mono text-xs...">Today</span>`), add a link to `/builder` next to the day name. Import `SettingsIcon` (or reuse `PencilIcon`) from
`@lucide/vue` alongside the existing icon imports, and change:

```vue
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">Today</span>
      <p class="font-heading text-2xl font-semibold text-foreground">{{ summary.todaysWorkout.dayName }}</p>
```

to:

```vue
      <div class="flex items-center justify-between">
        <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">Today</span>
        <NuxtLink to="/builder" class="text-muted-foreground" aria-label="Edit split">
          <SettingsIcon class="size-4" />
        </NuxtLink>
      </div>
      <p class="font-heading text-2xl font-semibold text-foreground">{{ summary.todaysWorkout.dayName }}</p>
```

Leave the existing "No active program" empty-state `NuxtLink to="/builder"` untouched — both paths now
reach the same page.

**Step 2: Manual verification**

Run: `npm run dev`, log in as `test-user@hadeed.dev` (has an active block), go to `/workouts`.
Expected: a small settings icon appears next to "Today"'s day name; clicking it navigates to `/builder`
(still the stub until Task 8 — that's expected at this point in the plan).

**Step 3: Commit**

```bash
git add app/pages/workouts/index.vue
git commit -m "feat(workouts): add Edit Split entry point when a program is active"
```

---

## Task 8: `/builder` page shell — mode choice and name/date step

**Files:**
- Modify: `app/pages/builder.vue`

This task replaces the stub with the page shell and the two steps that don't depend on preset/custom
content: choosing a mode, and (after either path produces a draft) naming it and picking a start date.
Tasks 9 and 10 fill in the middle step.

**Step 1: Implement the shell**

```vue
<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateSplitDayInput } from "~~/server/repositories/block.repository";

type Mode = "preset" | "custom" | null;

const mode = ref<Mode>(null);
const step = ref<"mode" | "build" | "confirm">("mode");

const selectedPresetId = ref<number | null>(null);
const customDays = ref<CreateSplitDayInput[]>([]);

const confirmName = ref("");
const confirmStartDate = ref(new Date().toISOString().slice(0, 10));
const submitError = ref<string | null>(null);

const createFromPreset = useCreateBlockFromPreset();
const createFromScratch = useCreateBlock();

const chooseMode = (chosen: Exclude<Mode, null>) => {
  mode.value = chosen;
  step.value = "build";
};

const backToMode = () => {
  mode.value = null;
  step.value = "mode";
};

const proceedToConfirm = () => {
  step.value = "confirm";
};

const submitting = computed(() => createFromPreset.isLoading.value || createFromScratch.isLoading.value);

const submit = async () => {
  submitError.value = null;
  try {
    if (mode.value === "preset" && selectedPresetId.value !== null) {
      await createFromPreset.mutateAsync({
        presetSplitId: selectedPresetId.value,
        name: confirmName.value,
        startDate: confirmStartDate.value,
        endDate: null,
      });
    } else if (mode.value === "custom") {
      await createFromScratch.mutateAsync({
        name: confirmName.value,
        startDate: confirmStartDate.value,
        endDate: null,
        days: customDays.value,
      });
    } else {
      return;
    }
    await navigateTo("/workouts");
  } catch {
    submitError.value = "Couldn't save your split. Please try again.";
  }
};
</script>

<template>
  <main class="mx-auto flex max-w-xl flex-col gap-y-4 p-4">
    <button v-if="step !== 'mode'" class="flex items-center gap-1 text-sm text-muted-foreground" @click="step === 'confirm' ? (step = 'build') : backToMode()">
      <ArrowLeftIcon class="size-4" /> Back
    </button>

    <h1 class="font-heading text-2xl uppercase text-foreground">Build Your Split</h1>

    <div v-if="step === 'mode'" class="flex flex-col gap-y-3">
      <UiCard class="cursor-pointer space-y-1" @click="chooseMode('preset')">
        <p class="font-heading text-lg text-foreground">Use a recommended split</p>
        <p class="text-sm text-muted-foreground">Answer a couple questions and pick from splits that fit your goals.</p>
      </UiCard>
      <UiCard class="cursor-pointer space-y-1" @click="chooseMode('custom')">
        <p class="font-heading text-lg text-foreground">Build my own</p>
        <p class="text-sm text-muted-foreground">Choose every day and exercise yourself.</p>
      </UiCard>
    </div>

    <BuilderPresetPicker
      v-else-if="step === 'build' && mode === 'preset'"
      v-model:selected-preset-id="selectedPresetId"
      @continue="proceedToConfirm"
    />

    <BuilderCustomSplitEditor
      v-else-if="step === 'build' && mode === 'custom'"
      v-model:days="customDays"
      @continue="proceedToConfirm"
    />

    <div v-else-if="step === 'confirm'" class="flex flex-col gap-y-3">
      <Input v-model="confirmName" placeholder="Split name" />
      <Input v-model="confirmStartDate" type="date" />
      <p v-if="submitError" class="text-sm text-destructive">{{ submitError }}</p>
      <Button size="lg" :disabled="submitting || !confirmName" @click="submit">Save Split</Button>
    </div>
  </main>
</template>
```

`BuilderPresetPicker` and `BuilderCustomSplitEditor` don't exist yet — Tasks 9 and 10 create them.
`app/components/` is auto-imported by Nuxt convention (same as `ExerciseDetailDrawer`, `UiCard` elsewhere
in this codebase), so no explicit import is needed once those files exist under
`app/components/builder/`.

**Step 2: Manual verification**

Run: `npm run dev`, go to `/builder`. Expected: the mode-choice screen renders; clicking either option
navigates to a blank spot (component-not-found warning in the console) until Tasks 9/10 land — expected
at this point.

**Step 3: Commit**

```bash
git add app/pages/builder.vue
git commit -m "feat(builder): add page shell (mode choice, name/date, submit)"
```

---

## Task 9: Preset picker step

**Files:**
- Create: `app/components/builder/PresetPicker.vue`

**Step 1: Implement**

```vue
<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const selectedPresetId = defineModel<number | null>("selectedPresetId", { required: true });
const emit = defineEmits<{ continue: [] }>();

const { data: profile } = useProfile();
const daysPerWeek = ref(3);

watchEffect(() => {
  if (profile.value?.profile?.trainingDaysPerWeek) {
    daysPerWeek.value = profile.value.profile.trainingDaysPerWeek;
  }
});

const recommendationInput = computed(() => ({
  daysPerWeek: daysPerWeek.value,
  experienceLevel: null,
  goal: null,
  equipment: null,
}));

const { data: recommendations, isLoading } = useRecommendedSplits(recommendationInput);
</script>

<template>
  <div class="flex flex-col gap-y-4">
    <label class="flex flex-col gap-y-1 text-sm text-muted-foreground">
      Days per week
      <Input v-model.number="daysPerWeek" type="number" min="1" max="7" class="w-24" />
    </label>

    <p v-if="isLoading" class="text-sm text-muted-foreground">Loading recommendations…</p>
    <p v-else-if="!recommendations?.length" class="text-sm text-muted-foreground">
      No presets match yet — try a different days-per-week value, or build your own instead.
    </p>

    <UiCard
      v-for="rec in recommendations"
      :key="rec.preset.id"
      class="cursor-pointer space-y-1"
      :class="selectedPresetId === rec.preset.id ? 'border-primary' : ''"
      @click="selectedPresetId = rec.preset.id"
    >
      <p class="font-heading text-lg text-foreground">{{ rec.preset.name }}</p>
      <p v-if="rec.preset.description" class="text-sm text-muted-foreground">{{ rec.preset.description }}</p>
      <p class="text-xs text-muted-foreground">{{ rec.reasons.join(" · ") }}</p>
    </UiCard>

    <Button size="lg" :disabled="selectedPresetId === null" @click="emit('continue')">Continue</Button>
  </div>
</template>
```

**Step 2: Manual verification**

Run: `npm run dev`, go to `/builder` → "Use a recommended split". Expected: a days-per-week input
(pre-filled from your seeded profile if set) and a list of recommended presets with reasons; selecting one
enables Continue, which moves to the name/date step from Task 8.

**Step 3: Commit**

```bash
git add app/components/builder/PresetPicker.vue
git commit -m "feat(builder): add preset picker step"
```

---

## Task 10: Custom split editor — day management

**Files:**
- Create: `app/components/builder/CustomSplitEditor.vue`

This task and Task 11 build one component incrementally: day add/remove/rest-toggle first, then the
per-day exercise picker.

**Step 1: Implement day management**

```vue
<script setup lang="ts">
import { PlusIcon, TrashIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateSplitDayInput } from "~~/server/repositories/block.repository";

const days = defineModel<CreateSplitDayInput[]>("days", { required: true });
const emit = defineEmits<{ continue: [] }>();

const addDay = () => {
  days.value = [
    ...days.value,
    { name: `Day ${days.value.length + 1}`, dayOfWeek: days.value.length, location: "gym", isRestDay: false, exercises: [] },
  ];
};

const removeDay = (index: number) => {
  days.value = days.value.filter((_, i) => i !== index);
};

const canContinue = computed(() => days.value.some(day => !day.isRestDay && day.exercises.length > 0));
</script>

<template>
  <div class="flex flex-col gap-y-4">
    <UiCard v-for="(day, index) in days" :key="index" class="space-y-3">
      <div class="flex items-center gap-2">
        <Input v-model="day.name" placeholder="Day name" class="flex-1" />
        <button @click="removeDay(index)"><TrashIcon class="size-4 text-muted-foreground" /></button>
      </div>
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" v-model="day.isRestDay" />
        Rest day
      </label>

      <BuilderDayExercisePicker v-if="!day.isRestDay" v-model:exercises="day.exercises" />
    </UiCard>

    <Button variant="secondary" @click="addDay"><PlusIcon class="size-4" /> Add Day</Button>
    <Button size="lg" :disabled="!canContinue" @click="emit('continue')">Continue</Button>
  </div>
</template>
```

`BuilderDayExercisePicker` doesn't exist yet — Task 11 creates it. `dayOfWeek` is assigned by array
position at add-time; if days are ever reordered later that'd need revisiting, but reordering isn't in
scope for v1 (design doc explicitly scopes this to add/remove/rest-toggle, not drag-reorder).

**Step 2: Manual verification**

Run: `npm run dev`, go to `/builder` → "Build my own". Expected: can add/remove days, toggle rest day
(hides the exercise section for that day); Continue stays disabled until at least one non-rest day has an
exercise — which isn't possible yet until Task 11 lands (expected at this point).

**Step 3: Commit**

```bash
git add app/components/builder/CustomSplitEditor.vue
git commit -m "feat(builder): add custom split editor day management"
```

---

## Task 11: Custom split editor — per-day exercise picker

**Files:**
- Create: `app/components/builder/DayExercisePicker.vue`

**Step 1: Implement**

```vue
<script setup lang="ts">
import { TrashIcon } from "@lucide/vue";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import type { CreateSplitExerciseInput } from "~~/server/repositories/block.repository";

const exercises = defineModel<CreateSplitExerciseInput[]>("exercises", { required: true });

const searchTerm = ref("");
const { data: results } = useExerciseSearch(searchTerm);

const options = computed<ComboboxOption[]>(
  () => results.value?.map(exercise => ({ value: exercise.id, label: exercise.name })) ?? [],
);

const picked = ref<string | undefined>(undefined);

watch(picked, (exerciseId) => {
  if (!exerciseId || typeof exerciseId !== "string") return;
  const label = options.value.find(o => o.value === exerciseId)?.label ?? exerciseId;
  exercises.value = [
    ...exercises.value,
    { exerciseId, position: exercises.value.length, setType: "weight_reps", targetSets: 3, targetReps: 10, targetRpe: null },
  ];
  exerciseNames.value[exerciseId] = label;
  picked.value = undefined;
});

const exerciseNames = ref<Record<string, string>>({});

const removeExercise = (index: number) => {
  exercises.value = exercises.value.filter((_, i) => i !== index);
};
</script>

<template>
  <div class="flex flex-col gap-y-2">
    <div v-for="(exercise, index) in exercises" :key="index" class="flex items-center gap-2">
      <span class="flex-1 text-sm text-foreground">{{ exerciseNames[exercise.exerciseId] ?? exercise.exerciseId }}</span>
      <Input v-model.number="exercise.targetSets" type="number" placeholder="sets" class="w-16" />
      <Input v-model.number="exercise.targetReps" type="number" placeholder="reps" class="w-16" />
      <button @click="removeExercise(index)"><TrashIcon class="size-4 text-muted-foreground" /></button>
    </div>

    <Combobox
      v-model="picked"
      v-model:search-term="searchTerm"
      :items="options"
      placeholder="Add an exercise"
      search-placeholder="Search exercises…"
    />
  </div>
</template>
```

Note `exerciseNames` is declared after its first use in the `watch` above only because `<script setup>`
hoists `const`/`ref` bindings within the same block scope at parse time for template/other-statement
references — but to avoid relying on that subtlety, declare `exerciseNames` **before** the `watch` call
when you write this file (reorder those two statements from how they're listed above).

**Step 2: Manual verification**

Run: `npm run dev`, go to `/builder` → "Build my own" → add a day → type into "Add an exercise" (e.g.
"bench"). Expected: a debounce-free live search (search fires on every keystroke via
`useExerciseSearch`'s reactive `search` param — acceptable at this data size/latency; add debouncing later
if it feels laggy against the real Turso endpoint) shows matching exercises; picking one adds a row with
editable sets/reps; Continue on the day-management step is now enabled. Complete the flow through to
Save Split and confirm `test-user-empty@hadeed.dev` now has an active split on `/workouts`.

**Step 3: Commit**

```bash
git add app/components/builder/DayExercisePicker.vue
git commit -m "feat(builder): add per-day exercise picker"
```

---

## Task 12: Full regression pass

**Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every pre-existing suite (this plan never modified session/nutrition
code, so a failure there indicates an unrelated regression worth stopping and investigating, not something
to paper over).

**Step 2: Manual end-to-end pass**

Run: `npm run dev`.
- `test-user-empty@hadeed.dev`: `/workouts` shows the empty state → "Build a Program" → complete the
  preset path → `/workouts` now shows today's workout from the new split.
- `test-user@hadeed.dev` (already has an active split): `/workouts` shows the "Edit Split" icon →
  `/builder` → complete the custom path → `/workouts` shows the new split's plan for today, and the old
  block's `end_date` is set (spot-check via the same inspection approach used earlier in this session,
  querying `workout_sessions`/`blocks` directly, or simply trust Task 2's test coverage).

**Step 3: Commit** (only if Step 1/2 surfaced fixes)

```bash
git add -A
git commit -m "fix: address issues found in split builder regression pass"
```

---

## Task 13: Card redesign — workout session page (independent of Tasks 1–12)

**Files:**
- Modify: `app/pages/workouts/session/[id].vue`

This task has no dependency on the builder work above and can be done first, last, or in parallel — it's
purely visual, on a different concern (logging an in-progress session, not building one).

**Step 1: Restyle the exercise card**

Current structure (`app/pages/workouts/session/[id].vue:146-186`) puts the exercise name, sets, and the
next-set input row all at the same visual weight inside one `UiCard`. Tighten the hierarchy:

- Give the exercise name row a bottom border separating it from the set rows, so the card reads as
  "header, then a table," not a flat stack.
- Right-align the three numeric inputs (kg/reps/RPE) as a fixed-width group so logged sets and the
  next-set row line up in columns instead of each row centering independently.
- Bump the log/check button to a clearer filled-circle affordance at a slightly larger touch target
  (`size-10` instead of the implicit default) since it's the primary action on this screen, tapped once
  per set.
- Dim already-logged set rows very slightly (e.g. `text-muted-foreground` on the whole row, already
  partially true) versus the active next-set row, so it's obvious at a glance which row is "in progress."

Apply directly in the template — this is a Tailwind-class-only change, no new script logic, so there's no
failing-test step here; verify visually per Step 2.

**Step 2: Manual verification**

Run: `npm run dev`, start or resume a session, confirm: set rows align in columns, the header is visually
separated from the sets, the log button is easy to tap, and nothing regresses editing an existing set
(click a set row → inline edit fields from `startEdit`/`saveEdit` still work).

**Step 3: Commit**

```bash
git add app/pages/workouts/session/[id].vue
git commit -m "style(workouts): tighten exercise card hierarchy on the session page"
```
