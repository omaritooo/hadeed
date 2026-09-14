<script setup lang="ts">
import { ArrowLeftRightIcon, ShuffleIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { Exercise } from "~~/shared/types/exercise.types";
import type { PresetExerciseOverride } from "~~/shared/types/preset.types";
import { equipmentValuesForTier } from "~~/shared/lib/equipment";
import { conflictingAreas, firstCleanCandidate, type JointArea } from "~~/shared/lib/joint-areas";

const props = defineProps<{ presetId: number }>();
const emit = defineEmits<{ continue: [overrides: PresetExerciseOverride[]] }>();

const presetIdRef = toRef(props, "presetId");
const { data: preset, isLoading, error } = usePresetSplitDetails(presetIdRef);

// Local editable copy: exerciseId (and its display name) mutable per row, everything else
// read-only — keyed by dayIndex/position so a swap can be applied in place without losing the
// original day/format/rounds context, which is never shown as editable here.
interface ReviewExercise {
  exerciseId: string;
  name: string;
  position: number;
  // Empty until exercisesById resolves (and for an Exercise cached from before stressors existed).
  stressors: JointArea[];
}
interface ReviewDay {
  dayIndex: number;
  name: string;
  exercises: ReviewExercise[];
}

const reviewDays = ref<ReviewDay[]>([]);
const exerciseCatalogCache = useExerciseCatalogCache();

// PresetSplitExercise only carries exerciseId, not a display name/image — batch-resolve every
// exercise across the whole preset in one request rather than one per exercise.
const allExerciseIds = computed(() => {
  if (!preset.value) return [];
  const ids = new Set<string>();
  for (const day of preset.value.days) {
    for (const exercise of day.exercises) ids.add(exercise.exerciseId);
  }
  return [...ids];
});
const { data: exercisesById } = useExercisesByIds(allExerciseIds);

watch(preset, (value) => {
  if (!value) return;
  reviewDays.value = value.days.map(day => ({
    dayIndex: day.dayIndex,
    name: day.name,
    exercises: day.exercises.map(exercise => ({
      exerciseId: exercise.exerciseId,
      name: exercise.exerciseId,
      position: exercise.position,
      stressors: [],
    })),
  }));
}, { immediate: true });

// Patches names into whatever's currently in reviewDays rather than rebuilding it wholesale, so
// a swap made before this resolves (unlikely, but possible) isn't clobbered — this only ever
// matches rows still holding one of the preset's original exercise ids.
watch(exercisesById, (exercises) => {
  if (!exercises) return;
  const byId = new Map(exercises.map(exercise => [exercise.id, exercise] as const));
  for (const exercise of exercises) exerciseCatalogCache.value.set(exercise.id, exercise);
  for (const day of reviewDays.value) {
    for (const exercise of day.exercises) {
      const resolved = byId.get(exercise.exerciseId);
      if (!resolved) continue;
      exercise.name = resolved.name;
      exercise.stressors = resolved.stressors ?? [];
    }
  }
}, { immediate: true });

const { data: profile } = useProfile();
const equipmentTiers = computed(() => {
  const tier = profile.value?.profile?.equipment;
  return tier ? equipmentValuesForTier(tier).filter((value): value is string => value !== null) : [];
});

// Swap sheet: one shared instance toggled via swapDayIndex/swapPosition/swapExerciseId, same
// single-shared-instance pattern as DayExercisePicker.vue's own swap sheet usage.
const swapSheetOpen = ref(false);
const swapDayIndex = ref<number | null>(null);
const swapPosition = ref<number | null>(null);
const swapExerciseId = ref("");

const openSwap = (dayIndex: number, position: number, exerciseId: string) => {
  swapDayIndex.value = dayIndex;
  swapPosition.value = position;
  swapExerciseId.value = exerciseId;
  swapSheetOpen.value = true;
};

const applySwap = (dayIndex: number | null, position: number | null, exercise: Exercise) => {
  const day = reviewDays.value.find(d => d.dayIndex === dayIndex);
  const row = day?.exercises.find(e => e.position === position);
  if (!row) return;
  row.exerciseId = exercise.id;
  row.name = exercise.name;
  row.stressors = exercise.stressors ?? [];
  exerciseCatalogCache.value.set(exercise.id, exercise);
};

const onSwapSelect = (exercise: Exercise) => applySwap(swapDayIndex.value, swapPosition.value, exercise);

// "Swap flagged": replaces every row that loads a limited joint with its closest equipment-compatible
// fallback that doesn't, one request per flagged row (a preset has a handful at most). Rows with no
// clean fallback are kept and named, rather than swapped for something that's also flagged.
const limitations = computed(() => profile.value?.profile?.limitations ?? []);
const flaggedRows = computed(() => reviewDays.value.flatMap(day =>
  day.exercises
    .filter(exercise => conflictingAreas(exercise.stressors, limitations.value).length > 0)
    .map(exercise => ({ dayIndex: day.dayIndex, position: exercise.position, exerciseId: exercise.exerciseId, name: exercise.name }))));
const swappingAll = ref(false);
const unswappable = ref<string[]>([]);
const swapAllError = ref(false);
const { $api } = useNuxtApp();

const swapAllFlagged = async () => {
  swappingAll.value = true;
  unswappable.value = [];
  swapAllError.value = false;
  // Snapshot: applySwap mutates reviewDays, which recomputes flaggedRows mid-loop.
  const rows = [...flaggedRows.value];
  try {
    for (const row of rows) {
      const candidates = await $api<Exercise[]>(`/api/exercises/${row.exerciseId}/fallbacks`, {
        query: { equipmentTiers: equipmentTiers.value.join(","), avoid: limitations.value.join(",") },
      });
      const clean = firstCleanCandidate(candidates, limitations.value);
      if (clean) applySwap(row.dayIndex, row.position, clean);
      else unswappable.value.push(row.name);
    }
  } catch {
    swapAllError.value = true;
  } finally {
    swappingAll.value = false;
  }
};

const overrides = computed<PresetExerciseOverride[]>(() => {
  if (!preset.value) return [];
  const result: PresetExerciseOverride[] = [];
  for (const reviewDay of reviewDays.value) {
    const originalDay = preset.value.days.find(d => d.dayIndex === reviewDay.dayIndex);
    if (!originalDay) continue;
    for (const exercise of reviewDay.exercises) {
      const original = originalDay.exercises.find(o => o.position === exercise.position);
      if (original && original.exerciseId !== exercise.exerciseId) {
        result.push({ dayIndex: reviewDay.dayIndex, position: exercise.position, exerciseId: exercise.exerciseId });
      }
    }
  }
  return result;
});
</script>

<template>
  <div class="flex flex-col gap-y-4">
    <UiLoadingIndicator v-if="isLoading" inline label="Loading preset…" />
    <p v-else-if="error" class="text-sm text-destructive">Couldn't load preset. Please try again.</p>

    <template v-else>
      <Button
        v-if="flaggedRows.length"
        variant="secondary"
        class="w-full"
        :disabled="swappingAll || equipmentTiers.length === 0"
        @click="swapAllFlagged"
      >
        <ShuffleIcon class="size-4" aria-hidden="true" />
        {{ swappingAll ? "Swapping…" : `Swap ${flaggedRows.length} flagged exercise${flaggedRows.length === 1 ? "" : "s"}` }}
      </Button>
      <p v-if="flaggedRows.length && equipmentTiers.length === 0" class="text-xs text-muted-foreground">
        Set your equipment in your profile to find swaps.
      </p>
      <!-- Always rendered so screen readers announce the outcome when its text appears. -->
      <div aria-live="polite" class="empty:hidden">
        <p v-if="unswappable.length" class="text-xs text-muted-foreground">
          No clean alternative for {{ unswappable.join(", ") }}. Kept as-is.
        </p>
        <p v-if="swapAllError" class="text-xs text-destructive">
          Couldn't finish swapping. Any swaps already made are kept.
        </p>
      </div>

      <div v-for="day in reviewDays" :key="day.dayIndex" class="flex flex-col gap-y-2">
        <p class="font-heading text-lg text-foreground">{{ day.name }}</p>
        <div
          v-for="exercise in day.exercises"
          :key="exercise.position"
          class="flex items-center gap-3 rounded-xl border border-surface-strong bg-card p-3"
        >
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span class="min-w-0 truncate text-sm text-foreground">{{ exercise.name }}</span>
            <ExerciseLimitationBadge :stressors="exercise.stressors" />
          </div>
          <button
            type="button"
            aria-label="Swap exercise"
            :disabled="swappingAll"
            class="flex items-center gap-1 text-sm text-muted-foreground disabled:opacity-50"
            @click="openSwap(day.dayIndex, exercise.position, exercise.exerciseId)"
          >
            <ArrowLeftRightIcon class="size-4" /> Swap
          </button>
        </div>
      </div>

      <Button size="lg" @click="emit('continue', overrides)">Continue</Button>
    </template>

    <BuilderExerciseSwapSheet
      v-model:open="swapSheetOpen"
      :exercise-id="swapExerciseId"
      :equipment-tiers="equipmentTiers"
      @select="onSwapSelect"
    />
  </div>
</template>
