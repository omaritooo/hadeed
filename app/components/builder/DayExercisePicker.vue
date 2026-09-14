<script setup lang="ts">
import { ArrowLeftRightIcon, TrashIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import type { CreateSplitExerciseInput } from "~~/server/repositories/block.repository";
import type { Exercise } from "~~/shared/types/exercise.types";
import { equipmentValuesForTier, exerciseEquipmentSatisfiesTier } from "~~/shared/lib/equipment";

const exercises = defineModel<CreateSplitExerciseInput[]>("exercises", { required: true });

const searchTerm = ref("");
const { data: results, isLoading, error } = useExerciseSearch(searchTerm);

const options = computed<ComboboxOption[]>(
  () => results.value?.map(exercise => ({ value: exercise.id, label: exercise.name })) ?? [],
);

const picked = ref<string | undefined>(undefined);
const exerciseNames = ref<Record<string, string>>({});
const exerciseRowIds = ref<string[]>(exercises.value.map(() => crypto.randomUUID()));
const exerciseCatalogCache = useExerciseCatalogCache();

// Rows pre-filled from an existing block (e.g. the edit-split page) were never added via this
// component's own addExercise/onSwapSelect, so exerciseNames has no entry for them. Fall back to
// the shared catalog cache — populated by whoever pre-fills the rows — before falling back to the
// bare id, without changing anything about how freshly-added exercises get their names.
const exerciseName = (exerciseId: string): string =>
  exerciseNames.value[exerciseId] ?? exerciseCatalogCache.value.get(exerciseId)?.name ?? exerciseId;

// Undefined until the row's Exercise is cached; the badge then simply doesn't show.
const exerciseStressors = (exerciseId: string) => exerciseCatalogCache.value.get(exerciseId)?.stressors;
const searchResultStressors = (exerciseId: unknown) => results.value?.find(exercise => exercise.id === exerciseId)?.stressors;

const { data: profile } = useProfile();
const userEquipmentTier = computed(() => profile.value?.profile?.equipment ?? null);

// Set when a picked exercise doesn't satisfy the user's equipment tier, instead of adding
// it straight away — drives the substitution banner below rather than blocking the add.
const pendingSubstitution = ref<Exercise | null>(null);
const fallbackEquipmentValues = computed(() => {
  const tier = userEquipmentTier.value;
  if (!tier) return [];
  // findFallbacks takes exercises.equipment string values only — null can't be bound as a
  // SQL IN(...) placeholder the same way, so it's dropped here (harmless: it's still used
  // client-side above to decide whether the picked exercise itself needs a substitute).
  return equipmentValuesForTier(tier).filter((value): value is string => value !== null);
});
const pendingExerciseId = computed(() => pendingSubstitution.value?.id ?? null);
const limitations = computed(() => profile.value?.profile?.limitations ?? []);
const { data: fallbackResults, isLoading: fallbacksLoading } = useExerciseFallbacks(pendingExerciseId, fallbackEquipmentValues, limitations);
const topFallback = computed(() => fallbackResults.value?.[0] ?? null);

const addExercise = (exerciseId: string, label: string, exercise?: Exercise) => {
  exercises.value = [
    ...exercises.value,
    { exerciseId, position: exercises.value.length, setType: "weight_reps", targetSets: 3, targetReps: 10, targetRpe: null },
  ];
  exerciseRowIds.value = [...exerciseRowIds.value, crypto.randomUUID()];
  exerciseNames.value[exerciseId] = label;
  // Cache tier/primaryMuscles now, while we have the full Exercise from search results — the confirm
  // step's recovery-conflict check needs this later but CreateSplitExerciseInput only carries the id.
  if (exercise) exerciseCatalogCache.value.set(exerciseId, exercise);
};

// Preview drawer: one shared instance toggled via previewExercise (same single-instance
// pattern as the swap sheet below) — picking a search result opens a preview instead of
// adding immediately, so the equipment-tier check now happens in confirmPreview.
const previewOpen = ref(false);
const previewExercise = ref<Exercise | null>(null);

watch(picked, (exerciseId) => {
  if (!exerciseId || typeof exerciseId !== "string") return;
  const exercise = results.value?.find(e => e.id === exerciseId);
  picked.value = undefined;
  searchTerm.value = "";
  if (!exercise) return;
  previewExercise.value = exercise;
  previewOpen.value = true;
});

const confirmPreview = () => {
  const exercise = previewExercise.value;
  if (!exercise) return;
  previewOpen.value = false;
  const tier = userEquipmentTier.value;
  if (tier && !exerciseEquipmentSatisfiesTier({ equipment: exercise.equipment, tier })) {
    pendingSubstitution.value = exercise;
    return;
  }
  addExercise(exercise.id, exercise.name, exercise);
};

const acceptSubstitution = () => {
  if (!topFallback.value) return;
  addExercise(topFallback.value.id, topFallback.value.name, topFallback.value);
  pendingSubstitution.value = null;
};

const addPendingAnyway = () => {
  if (!pendingSubstitution.value) return;
  addExercise(pendingSubstitution.value.id, pendingSubstitution.value.name, pendingSubstitution.value);
  pendingSubstitution.value = null;
};

const dismissSubstitution = () => {
  pendingSubstitution.value = null;
};

const removeExercise = (index: number) => {
  exercises.value = exercises.value.filter((_, i) => i !== index);
  exerciseRowIds.value = exerciseRowIds.value.filter((_, i) => i !== index);
};

// Swap sheet: one shared instance toggled via swapRowIndex/swapExerciseId (same
// single-instance-per-list pattern as ExerciseDetailDrawer), rather than mounting a sheet
// per row. onSwapSelect below applies the swap by this index, which is only safe because
// UiDrawer is modal by default and traps focus/interaction — so no Remove-row click (which
// would shift indices) can happen while the sheet is open. If the drawer ever becomes
// non-modal, this needs a defensive check instead (e.g. confirming
// exercises.value[index]?.exerciseId === swapExerciseId.value before applying).
const swapSheetOpen = ref(false);
const swapRowIndex = ref<number | null>(null);
const swapExerciseId = ref("");

const openSwapSheet = (index: number) => {
  swapRowIndex.value = index;
  swapExerciseId.value = exercises.value[index]!.exerciseId;
  swapSheetOpen.value = true;
};

const onSwapSelect = (exercise: Exercise) => {
  const index = swapRowIndex.value;
  if (index === null) return;
  // Replace exerciseId in place — targetSets/targetReps/position on the row are untouched.
  exercises.value = exercises.value.map((item, i) => (i === index ? { ...item, exerciseId: exercise.id } : item));
  exerciseNames.value[exercise.id] = exercise.name;
  exerciseCatalogCache.value.set(exercise.id, exercise);
  swapRowIndex.value = null;
};
</script>

<template>
  <div class="flex flex-col gap-y-2">
    <!-- Name and actions on the first line, sets × reps on the second: squeezed into one line
         on a phone, long exercise names wrapped to three lines beside unlabeled boxes. -->
    <div
      v-for="(exercise, index) in exercises"
      :key="exerciseRowIds[index]"
      class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 border-b border-surface-strong pb-3"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span class="min-w-0 text-sm text-foreground">{{ exerciseName(exercise.exerciseId) }}</span>
        <ExerciseLimitationBadge :stressors="exerciseStressors(exercise.exerciseId)" />
      </div>
      <button
        aria-label="Swap exercise"
        :disabled="!!pendingSubstitution || fallbackEquipmentValues.length === 0"
        :title="fallbackEquipmentValues.length === 0 ? 'Set your equipment in your profile to find swaps' : undefined"
        class="disabled:pointer-events-none disabled:opacity-50"
        @click="openSwapSheet(index)"
      >
        <ArrowLeftRightIcon class="size-4 text-muted-foreground" />
      </button>
      <button aria-label="Remove exercise" @click="removeExercise(index)"><TrashIcon class="size-4 text-muted-foreground" /></button>
      <div class="col-span-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Input
          :model-value="exercise.targetSets ?? ''"
          type="number"
          placeholder="sets"
          aria-label="Target sets"
          class="h-9 w-16 py-0"
          @update:model-value="(v) => exercise.targetSets = v === '' ? null : Number(v)"
        />
        sets ×
        <Input
          :model-value="exercise.targetReps ?? ''"
          type="number"
          placeholder="reps"
          aria-label="Target reps"
          class="h-9 w-16 py-0"
          @update:model-value="(v) => exercise.targetReps = v === '' ? null : Number(v)"
        />
        reps
      </div>
    </div>

    <Combobox
      v-model="picked"
      v-model:search-term="searchTerm"
      :items="options"
      :reset-search-term-on-select="false"
      :disabled="!!pendingSubstitution"
      placeholder="Add an exercise"
      search-placeholder="Search exercises…"
      :empty-text="error ? 'Couldn\'t search exercises.' : isLoading ? 'Searching…' : 'No results found.'"
    >
      <template #item="{ item }">
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate">{{ item.label }}</span>
          <ExerciseLimitationBadge :stressors="searchResultStressors(item.value)" />
        </span>
      </template>
    </Combobox>

    <div
      v-if="pendingSubstitution"
      class="flex flex-col gap-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
    >
      <p v-if="fallbacksLoading">Checking for a substitute for {{ pendingSubstitution.name }}…</p>
      <p v-else-if="topFallback">
        {{ pendingSubstitution.name }} needs more equipment than your profile has — try
        <span class="font-medium">{{ topFallback.name }}</span>
        <ExerciseLimitationBadge :stressors="topFallback.stressors" class="mx-1 align-middle" /> instead?
      </p>
      <p v-else>{{ pendingSubstitution.name }} needs more equipment than your profile has, and no substitute was found.</p>

      <div class="flex flex-wrap gap-2">
        <Button v-if="topFallback" size="sm" variant="secondary" @click="acceptSubstitution">
          Use {{ topFallback.name }}
        </Button>
        <Button size="sm" variant="ghost" @click="addPendingAnyway">Add {{ pendingSubstitution.name }} anyway</Button>
        <Button size="sm" variant="ghost" @click="dismissSubstitution">Cancel</Button>
      </div>
    </div>

    <BuilderExerciseSwapSheet
      v-model:open="swapSheetOpen"
      :exercise-id="swapExerciseId"
      :equipment-tiers="fallbackEquipmentValues"
      @select="onSwapSelect"
    />

    <UiDrawer v-model:open="previewOpen">
      <UiDrawerContent>
        <ExerciseDetailContent v-if="previewExercise" :exercise-id="previewExercise.id" />
        <UiDrawerFooter>
          <Button size="lg" class="w-full rounded-full uppercase" @click="confirmPreview">
            Add to day
          </Button>
        </UiDrawerFooter>
      </UiDrawerContent>
    </UiDrawer>
  </div>
</template>
