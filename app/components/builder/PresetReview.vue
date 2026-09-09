<script setup lang="ts">
import { ArrowLeftRightIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { Exercise } from "~~/shared/types/exercise.types";
import type { PresetExerciseOverride } from "~~/shared/types/preset.types";
import { equipmentValuesForTier } from "~~/shared/lib/equipment";

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
    })),
  }));
}, { immediate: true });

// Patches names into whatever's currently in reviewDays rather than rebuilding it wholesale, so
// a swap made before this resolves (unlikely, but possible) isn't clobbered — this only ever
// matches rows still holding one of the preset's original exercise ids.
watch(exercisesById, (exercises) => {
  if (!exercises) return;
  const names = new Map(exercises.map(exercise => [exercise.id, exercise.name] as const));
  for (const exercise of exercises) exerciseCatalogCache.value.set(exercise.id, exercise);
  for (const day of reviewDays.value) {
    for (const exercise of day.exercises) {
      const resolvedName = names.get(exercise.exerciseId);
      if (resolvedName) exercise.name = resolvedName;
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

const onSwapSelect = (exercise: Exercise) => {
  const day = reviewDays.value.find(d => d.dayIndex === swapDayIndex.value);
  const row = day?.exercises.find(e => e.position === swapPosition.value);
  if (!row) return;
  row.exerciseId = exercise.id;
  row.name = exercise.name;
  exerciseCatalogCache.value.set(exercise.id, exercise);
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
    <p v-if="isLoading" class="text-sm text-muted-foreground">Loading preset…</p>
    <p v-else-if="error" class="text-sm text-destructive">Couldn't load preset. Please try again.</p>

    <template v-else>
      <div v-for="day in reviewDays" :key="day.dayIndex" class="flex flex-col gap-y-2">
        <p class="font-heading text-lg text-foreground">{{ day.name }}</p>
        <div
          v-for="exercise in day.exercises"
          :key="exercise.position"
          class="flex items-center gap-3 rounded-xl border border-surface-strong bg-card p-3"
        >
          <span class="min-w-0 flex-1 truncate text-sm text-foreground">{{ exercise.name }}</span>
          <button
            type="button"
            aria-label="Swap exercise"
            class="flex items-center gap-1 text-sm text-muted-foreground"
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
