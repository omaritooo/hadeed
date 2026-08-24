<script setup lang="ts">
import { DumbbellIcon, FootprintsIcon, SofaIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

const exerciseId = ref("Barbell_Squat");
const queriedId = ref("");

const { data: exercise, error, status, isLoading, refetch } = useExercise(queriedId);

function fetchExercise() {
  if (queriedId.value === exerciseId.value) {
    refetch();
  } else {
    queriedId.value = exerciseId.value;
  }
}

const currentStep = ref(1);
const stepper = () => currentStep.value++;
</script>

<template>
  <main class="mx-auto max-w-xl space-y-4 p-8">
    <Button @click="stepper"> Stepper </Button>
    <h1 class="text-lg font-semibold">Fetch an exercise</h1>

    <div class="flex gap-2">
      <input
        v-model="exerciseId"
        type="text"
        placeholder="Exercise id, e.g. Barbell_Squat"
        class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        @keyup.enter="fetchExercise"
      />
      <Button :disabled="isLoading" @click="fetchExercise">
        {{ isLoading ? "Fetching…" : "Fetch" }}
      </Button>
    </div>

    <p v-if="status === 'error'" class="text-sm text-destructive">
      {{ error?.data?.statusMessage ?? error?.message }}
    </p>

    <pre
      v-if="exercise"
      class="overflow-auto rounded-md border border-border bg-muted p-4 text-xs"
      >{{ JSON.stringify(exercise, null, 2) }}</pre
    >
    <div class="w-full">
      <UiRadioGroup default-value="feet" class="space-y-3">
        <UiOptionCard
          value="sitting"
          :icon="SofaIcon"
          title="Mostly sitting"
          description="Desk job, little intentional exercise"
        />
        <UiOptionCard
          value="feet"
          :icon="FootprintsIcon"
          title="On my feet all day"
          description="Retail, nursing, teaching"
        />
        <UiOptionCard
          value="physical"
          :icon="DumbbellIcon"
          title="Physically demanding job"
          description="Construction, heavy lifting"
        />
      </UiRadioGroup>
    </div>
  </main>
</template>
