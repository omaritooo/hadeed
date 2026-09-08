<script setup lang="ts">
import { ArrowLeftIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateSplitDayInput } from "~~/server/repositories/block.repository";
import { checkRecoveryConflicts } from "~~/shared/lib/recovery-checker";

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
const exerciseCatalogCache = useExerciseCatalogCache();

// Recovery-conflict check is advisory only and, per the design doc, runs off whatever days array is
// already held in this page's state — no new endpoint needed. That's only available for the custom path
// today: the preset path never loads a preset's day/exercise list client-side (`PresetPicker.vue` only
// fetches scored recommendations), so there's nothing to check there yet.
const recoveryConflicts = computed(() => {
  if (mode.value !== "custom") return [];
  const days = customDays.value.map(day => ({
    isRestDay: day.isRestDay ?? false,
    exercises: day.exercises.flatMap((exercise) => {
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

const chooseMode = (chosen: Exclude<Mode, null>) => {
  mode.value = chosen;
  step.value = "build";
};

const backToMode = () => {
  mode.value = null;
  step.value = "mode";
  selectedPresetId.value = null;
  customDays.value = [];
  exerciseCatalogCache.value.clear();
};

const proceedToConfirm = () => {
  step.value = "confirm";
};

const goBack = () => {
  if (step.value === "confirm") {
    step.value = "build";
  } else {
    backToMode();
  }
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
        days: customDays.value.map((day, index) => ({ ...day, dayOfWeek: index })),
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
    <button v-if="step !== 'mode'" class="flex items-center gap-1 text-sm text-muted-foreground" @click="goBack">
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
      <p
        v-for="conflict in recoveryConflicts"
        :key="`${conflict.muscle}-${conflict.dayIndexes.join('-')}`"
        class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
      >
        {{ formatMuscle(conflict.muscle) }} is targeted with heavy compound work on back-to-back days — consider
        spacing these out or inserting a lower-body/rest day.
      </p>
      <Button size="lg" :disabled="submitting || !confirmName" @click="submit">Save Split</Button>
    </div>
  </main>
</template>
