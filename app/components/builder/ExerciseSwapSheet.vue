<script setup lang="ts">
import { ArrowLeftIcon, DumbbellIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { Exercise } from "~~/shared/types/exercise.types";

// Mount one shared instance and toggle exerciseId/open — same pattern as
// ExerciseDetailDrawer — do not mount per-row in a list (queries fire eagerly on mount).
const props = defineProps<{ exerciseId: string; equipmentTiers: string[] }>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ select: [exercise: Exercise] }>();

const exerciseId = toRef(props, "exerciseId");
const equipmentTiers = toRef(props, "equipmentTiers");
const { data: profile } = useProfile();
// Alternatives that stress a limited joint are ranked last by the server, and badged below.
const limitations = computed(() => profile.value?.profile?.limitations ?? []);
const { data: alternatives, isLoading, error } = useExerciseAlternatives(exerciseId, equipmentTiers, limitations);

const previewExercise = ref<Exercise | null>(null);

const selectAlternative = (exercise: Exercise) => {
  emit("select", exercise);
  open.value = false;
};

const confirmPreview = () => {
  if (!previewExercise.value) return;
  selectAlternative(previewExercise.value);
  previewExercise.value = null;
};

const backToList = () => {
  previewExercise.value = null;
};

watch(open, (isOpen) => {
  if (!isOpen) previewExercise.value = null;
});
</script>

<template>
  <UiDrawer v-model:open="open">
    <UiDrawerContent>
      <div class="flex flex-col gap-4 overflow-y-auto p-5 pt-6">
        <template v-if="!previewExercise">
          <UiDrawerTitle class="font-heading text-2xl uppercase text-foreground">Swap Exercise</UiDrawerTitle>

          <p v-if="isLoading" class="text-sm text-muted-foreground">Finding alternatives…</p>
          <p v-else-if="error" class="text-sm text-muted-foreground">Couldn't load alternatives.</p>
          <p v-else-if="!alternatives?.length" class="text-sm text-muted-foreground">No alternatives found.</p>

          <button
            v-for="exercise in alternatives"
            :key="exercise.id"
            type="button"
            class="flex items-center gap-3 rounded-xl border border-surface-strong bg-card p-3 text-left"
            @click="previewExercise = exercise"
          >
            <div class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-popover">
              <NuxtImg v-if="exercise.images[0]" :src="exercise.images[0]" class="size-full object-cover" />
              <DumbbellIcon v-else class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <p class="truncate text-sm font-semibold text-foreground">{{ exercise.name }}</p>
                <ExerciseLimitationBadge :stressors="exercise.stressors" />
              </div>
              <p v-if="exercise.primaryMuscles[0]" class="text-xs text-muted-foreground">
                {{ exercise.primaryMuscles[0] }}
              </p>
            </div>
          </button>
        </template>
        <template v-else>
          <button type="button" class="flex items-center gap-1 text-sm text-muted-foreground" @click="backToList">
            <ArrowLeftIcon class="size-4" /> Back
          </button>
          <ExerciseDetailContent :exercise-id="previewExercise.id" />
          <UiDrawerFooter>
            <Button size="lg" class="w-full rounded-full uppercase" @click="confirmPreview">
              Use this exercise
            </Button>
          </UiDrawerFooter>
        </template>
      </div>
    </UiDrawerContent>
  </UiDrawer>
</template>
