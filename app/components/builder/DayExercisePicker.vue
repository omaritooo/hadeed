<script setup lang="ts">
import { TrashIcon } from "@lucide/vue";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import type { CreateSplitExerciseInput } from "~~/server/repositories/block.repository";

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

watch(picked, (exerciseId) => {
  if (!exerciseId || typeof exerciseId !== "string") return;
  const exercise = results.value?.find(e => e.id === exerciseId);
  const label = exercise?.name ?? options.value.find(o => o.value === exerciseId)?.label ?? exerciseId;
  exercises.value = [
    ...exercises.value,
    { exerciseId, position: exercises.value.length, setType: "weight_reps", targetSets: 3, targetReps: 10, targetRpe: null },
  ];
  exerciseRowIds.value = [...exerciseRowIds.value, crypto.randomUUID()];
  exerciseNames.value[exerciseId] = label;
  // Cache tier/primaryMuscles now, while we have the full Exercise from search results — the confirm
  // step's recovery-conflict check needs this later but CreateSplitExerciseInput only carries the id.
  if (exercise) exerciseCatalogCache.set(exerciseId, exercise);
  picked.value = undefined;
  searchTerm.value = "";
});

const removeExercise = (index: number) => {
  exercises.value = exercises.value.filter((_, i) => i !== index);
  exerciseRowIds.value = exerciseRowIds.value.filter((_, i) => i !== index);
};
</script>

<template>
  <div class="flex flex-col gap-y-2">
    <div v-for="(exercise, index) in exercises" :key="exerciseRowIds[index]" class="flex items-center gap-2">
      <span class="flex-1 text-sm text-foreground">{{ exerciseNames[exercise.exerciseId] ?? exercise.exerciseId }}</span>
      <Input
        :model-value="exercise.targetSets ?? ''"
        type="number"
        placeholder="sets"
        class="w-16"
        @update:model-value="(v) => exercise.targetSets = v === '' ? null : Number(v)"
      />
      <Input
        :model-value="exercise.targetReps ?? ''"
        type="number"
        placeholder="reps"
        class="w-16"
        @update:model-value="(v) => exercise.targetReps = v === '' ? null : Number(v)"
      />
      <button aria-label="Remove exercise" @click="removeExercise(index)"><TrashIcon class="size-4 text-muted-foreground" /></button>
    </div>

    <Combobox
      v-model="picked"
      v-model:search-term="searchTerm"
      :items="options"
      :reset-search-term-on-select="false"
      placeholder="Add an exercise"
      search-placeholder="Search exercises…"
      :empty-text="error ? 'Couldn\'t search exercises.' : isLoading ? 'Searching…' : 'No results found.'"
    />
  </div>
</template>
