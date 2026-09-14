<script setup lang="ts">
import type { ComponentExposed } from "vue-component-type-helpers";
import { ArrowRightIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useOnboardingStore } from "@/store/onboarding";
import { useUiStore } from "@/store/ui";
import { useCompleteOnboarding } from "@/composables/useCompleteOnboarding";
import type { OnboardingForm as OnboardingFormData } from "~~/shared/schemas/onboarding";
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

// --- Draft persistence -------------------------------------------------
// Onboarding only actually creates the account at the final step's submit,
// so closing mid-flow previously lost everything. There's no userId to key
// by pre-signup, so a single fixed localStorage key is used, cleared on a
// successful final submit.
//
// The password/confirmPassword fields are deliberately EXCLUDED from what
// gets written to localStorage: even though this is client-side-only,
// writing a plaintext password to disk is not good practice, and the app
// doesn't need to persist it to make resuming useful. Everything else
// (name, email, date of birth, gender, and every later step's answers) is
// persisted and restored.
//
// One consequence: if a draft is restored past step 1, the password is
// missing from the store when the user reaches final submit. That's handled
// below in handleContinue - onboardingStore.submitForm() throws (zod parse
// failure), which is caught and treated as "bounce back to step 1 (already
// prefilled with their other answers) and ask them to re-enter a password."
const DRAFT_STORAGE_KEY = "hadeed:onboarding-draft";
// A very old abandoned draft (e.g. from a signup attempt weeks ago) probably
// reflects stale answers a returning visitor wouldn't expect to resurface -
// discard anything older than this rather than resuming it.
const DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

type DraftForm = Omit<Partial<OnboardingFormData>, "password" | "confirmPassword">;

interface OnboardingDraft {
  step: number;
  form: DraftForm;
  savedAt: number;
}

const readDraft = (): OnboardingDraft | null => {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<OnboardingDraft> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.savedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }

    return parsed as OnboardingDraft;
  } catch {
    return null;
  }
};

const writeDraft = (draft: OnboardingDraft) => {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // localStorage unavailable (private browsing, full quota, etc.) - draft
    // persistence is best-effort and shouldn't block onboarding.
  }
};

const clearDraft = () => {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
  }
};

const ui = useUiStore();
const { onboardingStep } = storeToRefs(ui);
const onboardingStore = useOnboardingStore();
const { mutateAsync: completeOnboarding, isLoading, error } = useCompleteOnboarding();
const submitError = ref<string | null>(null);

const current = computed(() => steps[onboardingStep.value - 1]);

type StepHandle = ComponentExposed<typeof OnboardingFirstStep>;
const stepRef = useTemplateRef<StepHandle>("step");

// Disabled right before we intentionally wipe the form/draft post-signup, so
// the reactive reset below doesn't get picked up by the watcher and
// re-written to localStorage after clearDraft() runs.
let draftPersistenceEnabled = true;

onMounted(() => {
  if (!import.meta.client) return;

  const draft = readDraft();
  if (!draft) return;

  Object.assign(onboardingStore.form, draft.form);
  onboardingStep.value = Math.min(Math.max(draft.step, 1), steps.length);
});

watch(
  [() => onboardingStore.form, onboardingStep],
  ([form, step]) => {
    if (!import.meta.client || !draftPersistenceEnabled) return;
    const { password: _password, confirmPassword: _confirmPassword, ...rest } = form;
    writeDraft({ step, form: rest, savedAt: Date.now() });
  },
  { deep: true },
);

const handleContinue = async () => {
  submitError.value = null;
  if (!stepRef.value?.validate()) return;

  if (onboardingStep.value === steps.length) {
    let data: ReturnType<typeof onboardingStore.submitForm>;
    try {
      data = onboardingStore.submitForm();
    } catch {
      // The password was never persisted, so a draft restored past step 1
      // won't have one - send the user back to re-enter it.
      onboardingStep.value = 1;
      submitError.value = "Please re-enter your password to finish signing up.";
      return;
    }

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
        limitations: data.limitations ?? [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      draftPersistenceEnabled = false;
      onboardingStore.resetForm();
      clearDraft();
      await navigateTo("/");
    } catch {
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
      <p v-if="submitError" class="mb-2 text-center text-sm text-destructive">
        {{ submitError }}
      </p>
      <p v-else-if="error" class="mb-2 text-center text-sm text-destructive">
        {{ error.data?.statusMessage ?? "Something went wrong. Please try again." }}
      </p>
      <Button class="w-full" size="lg" :disabled="isLoading" @click="handleContinue">
        Continue
        <ArrowRightIcon class="size-4" />
      </Button>
    </div>
  </div>
</template>
