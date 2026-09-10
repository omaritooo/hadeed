<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateSplitDayInput } from "~~/server/repositories/block.repository";
import { checkRecoveryConflicts } from "~~/shared/lib/recovery-checker";

// Physically lives outside app/pages/builder/ and overrides its route path here: Nuxt treats a
// page file with the same name as a sibling directory (app/pages/builder.vue + app/pages/builder/…)
// as that directory's parent layout route, which only renders nested children through a <NuxtPage/>
// of its own — builder.vue doesn't have one (and per this task's constraints, shouldn't gain one just
// for this), so a page physically nested under app/pages/builder/ never mounts at all. Confirmed by
// hitting the dev server directly: app/pages/builder/edit/[blockId].vue rendered builder.vue's own
// "Build Your Split" markup instead of this page's, even though the router's resolved path was
// correct. Living here instead sidesteps that nesting entirely while keeping the same public URL.
definePageMeta({
  path: "/builder/edit/:blockId",
});

const route = useRoute();
const blockId = computed(() => Number(route.params.blockId));

const { data: block, isLoading } = useBlock(blockId);

const exerciseIds = computed(() => {
  if (!block.value) return [];
  const ids = new Set<string>();
  for (const day of block.value.days) {
    for (const exercise of day.exercises) ids.add(exercise.exerciseId);
  }
  return [...ids];
});

// Pre-filled rows come from an existing block, not from DayExercisePicker's own search-and-add
// flow, so it has no display name for them yet. Populating the shared catalog cache here is enough
// for DayExercisePicker to resolve names for these rows (see its `exerciseName` fallback) and for
// the recovery-conflict check below, without needing to thread anything through CustomSplitEditor.
const { data: catalogExercises } = useExercisesByIds(exerciseIds);
const exerciseCatalogCache = useExerciseCatalogCache();
watch(catalogExercises, (exercises) => {
  if (!exercises) return;
  for (const exercise of exercises) exerciseCatalogCache.value.set(exercise.id, exercise);
});

const editableDays = ref<CreateSplitDayInput[]>([]);
const confirmName = ref("");
const confirmStartDate = ref(new Date().toISOString().slice(0, 10));

// Seed local editable state from the fetched block exactly once — CustomSplitEditor owns all
// further mutation via its v-model, so re-running this on every refetch would stomp on edits.
let initialized = false;
watch(block, (loaded) => {
  if (!loaded || initialized) return;
  initialized = true;
  editableDays.value = loaded.days.map(day => ({
    name: day.name,
    dayOfWeek: day.dayOfWeek,
    location: day.location,
    isRestDay: day.isRestDay,
    format: day.format,
    rounds: day.rounds,
    exercises: day.exercises.map(exercise => ({
      exerciseId: exercise.exerciseId,
      position: exercise.position,
      setType: exercise.setType,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      targetRpe: exercise.targetRpe,
      restSeconds: exercise.restSeconds,
    })),
  }));
  confirmName.value = loaded.name;
}, { immediate: true });

// Same advisory recovery-conflict check builder.vue's custom path runs at confirm time, kept in
// sync with editableDays as the user edits days/exercises here.
const recoveryConflicts = computed(() => {
  const days = editableDays.value.map(day => ({
    isRestDay: day.isRestDay ?? false,
    exercises: day.exercises.flatMap((exercise): { tier: number | null, primaryMuscle: string | null }[] => {
      const cached = exerciseCatalogCache.value.get(exercise.exerciseId);
      if (!cached || cached.primaryMuscles.length === 0) {
        return [{ tier: cached?.tier ?? null, primaryMuscle: null }];
      }
      return cached.primaryMuscles.map(primaryMuscle => ({ tier: cached.tier, primaryMuscle }));
    }),
  }));
  return checkRecoveryConflicts(days);
});

const formatMuscle = (muscle: string) => muscle.charAt(0).toUpperCase() + muscle.slice(1);

const createBlock = useCreateBlock();
const submitError = ref<string | null>(null);

const submit = async () => {
  submitError.value = null;
  try {
    await createBlock.mutateAsync({
      name: confirmName.value,
      startDate: confirmStartDate.value,
      endDate: null,
      days: editableDays.value.map((day, index) => ({ ...day, dayOfWeek: index })),
    });
    await navigateTo("/workouts");
  } catch {
    submitError.value = "Couldn't save your split. Please try again.";
  }
};
</script>

<template>
  <main class="mx-auto flex max-w-xl flex-col gap-y-4 p-4">
    <NuxtLink to="/workouts" class="flex items-center gap-1 text-sm text-muted-foreground">
      <ArrowLeftIcon class="size-4" /> Back
    </NuxtLink>

    <h1 class="font-heading text-2xl uppercase text-foreground">Edit Your Split</h1>

    <UiLoadingIndicator v-if="isLoading" inline label="Loading your split…" />

    <template v-else-if="block">
      <BuilderCustomSplitEditor v-model:days="editableDays" :show-continue="false" />

      <div class="flex flex-col gap-y-3">
        <Input v-model="confirmName" placeholder="Split name" />
        <Input v-model="confirmStartDate" type="date" />
        <p v-if="submitError" class="text-sm text-destructive">{{ submitError }}</p>
        <p
          v-for="conflict in recoveryConflicts"
          :key="`${conflict.muscle}-${conflict.dayIndexes.join('-')}`"
          class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          {{ formatMuscle(conflict.muscle) }} is targeted with heavy compound work on back-to-back days — consider
          spacing these out or inserting a lower-body/rest day.
        </p>
        <Button size="lg" :disabled="createBlock.isLoading.value || !confirmName" @click="submit">Save Split</Button>
      </div>
    </template>

    <p v-else class="text-sm text-destructive">Couldn't load this split.</p>
  </main>
</template>
