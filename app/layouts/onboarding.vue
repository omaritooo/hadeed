<script setup lang="ts">
definePageMeta({
  name: "onboarding",
});
import { useUiStore } from "~/store/ui";

const store = useUiStore();
const { stepMover } = store;
const { onboardingStep } = storeToRefs(store);
</script>
<template>
  <main class="flex min-h-dvh flex-col justify-center bg-linear-to-b from-background from-0% via-primary/6 via-30% to-background to-70% px-5 py-5">
    <UiSteps
      :steps="5"
      :current-step="onboardingStep"
      :prev-function="() => stepMover('prev')"
      :next-function="() => stepMover('next')"
    />
    <NuxtPage />
  </main>
</template>
