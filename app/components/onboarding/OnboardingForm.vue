<script setup lang="ts">
import type { ComponentExposed } from "vue-component-type-helpers";
import { ArrowRightIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useOnboardingStore } from "@/store/onboarding";
import { useUiStore } from "@/store/ui";
import { useCompleteOnboarding } from "@/composables/useCompleteOnboarding";
import OnboardingFirstStep from "@/components/onboarding/FirstStep.vue";
import SecondStep from "./SecondStep.vue";
import ThirdStep from "./ThirdStep.vue";
import FourthStep from "./FourthStep.vue";
import FifthStep from "./FifthStep.vue";

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
  {
    component: ThirdStep,
    title: "Tell us about your goals",
    description:
      "Select the primary objective for your training program to tailor your experience.",
  },
  {
    component: FourthStep,
    title: "What are your measurements?",
    description:
      "Used to calculate your initial targets and track your progress accurately.",
  },
  {
    component: FifthStep,
    title: "Training Logistics",
    description: "Let's build a plan that fits your life",
  },
];

const ui = useUiStore();
const { onboardingStep } = storeToRefs(ui);
const onboardingStore = useOnboardingStore();
const { mutateAsync: completeOnboarding, isLoading, error } = useCompleteOnboarding();

const current = computed(() => steps[onboardingStep.value - 1]);

type StepHandle = ComponentExposed<typeof OnboardingFirstStep>;
const stepRef = useTemplateRef<StepHandle>("step");

async function handleContinue() {
  if (!stepRef.value?.validate()) return;

  if (onboardingStep.value === steps.length) {
    const data = onboardingStore.submitForm();

    // email/password are sent to create the users row and its login credentials on this
    // caller's first write; confirmPassword was only ever a client-side equality check.
    try {
      await completeOnboarding({
        email: data.email,
        password: data.password,
        displayName: data.fullName,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        height: data.height,
        weight: data.weight,
        targetWeight: data.targetWeight,
        activityLevel: data.activityLevel,
        experienceLevel: data.experienceLevel,
        primaryGoal: data.primaryGoal,
        trainingDaysPerWeek: data.frequency,
        equipment: data.equipment,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      onboardingStore.resetForm();
      await navigateTo("/");
    } catch {
      // `error` (from useCompleteOnboarding) is already reactive and rendered below.
    }
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
      <p v-if="error" class="mb-2 text-center text-sm text-destructive">
        {{ error.data?.statusMessage ?? "Something went wrong. Please try again." }}
      </p>
      <Button class="w-full" size="lg" :disabled="isLoading" @click="handleContinue">
        Continue
        <ArrowRightIcon class="size-4" />
      </Button>
    </div>
  </div>
</template>
