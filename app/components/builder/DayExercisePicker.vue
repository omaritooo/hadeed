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
const exerciseNames = ref<Record<string, string>>({});
const exerciseRowIds = ref<string[]>(exercises.value.map(() => crypto.randomUUID()));

watch(picked, (exerciseId) => {
  if (!exerciseId || typeof exerciseId !== "string") return;
  const label = options.value.find(o => o.value === exerciseId)?.label ?? exerciseId;
  exercises.value = [
    ...exercises.value,
    { exerciseId, position: exercises.value.length, setType: "weight_reps", targetSets: 3, targetReps: 10, targetRpe: null },
  ];
  exerciseRowIds.value = [...exerciseRowIds.value, crypto.randomUUID()];
  exerciseNames.value[exerciseId] = label;
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
      <Input v-model.number="exercise.targetSets" type="number" placeholder="sets" class="w-16" />
      <Input v-model.number="exercise.targetReps" type="number" placeholder="reps" class="w-16" />
      <button @click="removeExercise(index)"><TrashIcon class="size-4 text-muted-foreground" /></button>
    </div>

    <Combobox
      v-model="picked"
      v-model:search-term="searchTerm"
      :items="options"
      :reset-search-term-on-select="false"
      placeholder="Add an exercise"
      search-placeholder="Search exercises…"
    />
  </div>
</template>
