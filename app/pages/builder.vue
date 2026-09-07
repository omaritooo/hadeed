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
  selectedPresetId.value = null;
  customDays.value = [];
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
      <Button size="lg" :disabled="submitting || !confirmName" @click="submit">Save Split</Button>
    </div>
  </main>
</template>
