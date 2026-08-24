<script setup lang="ts">
import type { ComponentExposed } from "vue-component-type-helpers";
import { ArrowRightIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useOnboardingStore } from "@/store/onboarding";
import { useUiStore } from "@/store/ui";
import OnboardingFirstStep from "@/components/onboarding/FirstStep.vue";
import SecondStep from "./SecondStep.vue";

const steps = [
  {
    component: OnboardingFirstStep,
    title: "Tell us about yourself",
    description: "The foundation of your journey.",
  },
  {
    component: SecondStep,
    title: "What is your experience",
    description: "This helps us calibrate your starting weights and volume correctly.",
  },
];

const ui = useUiStore();
const { onboardingStep } = storeToRefs(ui);
const onboardingStore = useOnboardingStore();

const current = computed(() => steps[onboardingStep.value - 1]);

type StepHandle = ComponentExposed<typeof OnboardingFirstStep>;
const stepRef = useTemplateRef<StepHandle>("step");

function handleContinue() {
  if (!stepRef.value?.validate()) return;

  if (onboardingStep.value === steps.length) {
    onboardingStore.submitForm();
    return;
  }

  ui.stepMover("next");
}
</script>

<template>
  <div class="flex flex-1 flex-col">
    <div v-if="current" class="flex flex-1 flex-col gap-6 px-2 pt-4 pb-8">
      <div class="space-y-1 text-center">
        <h1 class="font-heading text-headline-lg-mobile text-foreground">
          {{ current.title }}
        </h1>
        <p class="text-muted-foreground">{{ current.description }}</p>
      </div>

      <component :is="current.component" ref="step" />
    </div>

    <div class="">
      <Button class="w-full" size="lg" @click="handleContinue">
        Continue
        <ArrowRightIcon class="size-4" />
      </Button>
    </div>
  </div>
</template>
