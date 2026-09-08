<script setup lang="ts">
import { DumbbellIcon } from "@lucide/vue";
import type { Exercise } from "~~/shared/types/exercise.types";

// Mount one shared instance and toggle exerciseId/open — same pattern as
// ExerciseDetailDrawer — do not mount per-row in a list (queries fire eagerly on mount).
const props = defineProps<{ exerciseId: string; equipmentTiers: string[] }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ select: [exercise: Exercise] }>();

const exerciseId = toRef(props, "exerciseId");
const equipmentTiers = toRef(props, "equipmentTiers");
const { data: alternatives, isLoading, error } = useExerciseAlternatives(exerciseId, equipmentTiers);

const selectAlternative = (exercise: Exercise) => {
  emit("select", exercise);
  open.value = false;
};
</script>

<template>
  <UiDrawer v-model:open="open">
    <UiDrawerContent>
      <div class="flex flex-col gap-4 overflow-y-auto p-5 pt-6">
        <UiDrawerTitle class="font-heading text-2xl uppercase text-foreground">Swap Exercise</UiDrawerTitle>

        <p v-if="isLoading" class="text-sm text-muted-foreground">Finding alternatives…</p>
        <p v-else-if="error" class="text-sm text-muted-foreground">Couldn't load alternatives.</p>
        <p v-else-if="!alternatives?.length" class="text-sm text-muted-foreground">No alternatives found.</p>

        <button
          v-for="exercise in alternatives"
          :key="exercise.id"
          type="button"
          class="flex items-center gap-3 rounded-xl border border-surface-strong bg-card p-3 text-left"
          @click="selectAlternative(exercise)"
        >
          <div class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-popover">
            <NuxtImg v-if="exercise.images[0]" :src="exercise.images[0]" class="size-full object-cover" />
            <DumbbellIcon v-else class="size-5 text-muted-foreground" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-foreground">{{ exercise.name }}</p>
            <p v-if="exercise.primaryMuscles[0]" class="text-xs text-muted-foreground">
              {{ exercise.primaryMuscles[0] }}
            </p>
          </div>
        </button>
      </div>
    </UiDrawerContent>
  </UiDrawer>
</template>
