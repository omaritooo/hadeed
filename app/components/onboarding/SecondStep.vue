<script setup lang="ts">
import { DumbbellIcon, FlameIcon, PersonStandingIcon } from "@lucide/vue";
import { useOnboardingStore } from "~/store/onboarding";
import { stepSchemas } from "~~/shared/schemas/onboarding";

const store = useOnboardingStore();

const { form, errors, validateAll, validateField } = useZodForm(stepSchemas[2], {
  experienceLevel: store.form.experienceLevel ?? "beginner",
});
</script>
<template>
  <div class="w-full">
    <UiRadioGroup default-value="feet" class="space-y-3">
      <UiOptionCard
        value="beginner"
        :icon="PersonStandingIcon"
        title="Beginner"
        description="New to exercising"
      />
      <UiOptionCard
        value="intermediate"
        :icon="DumbbellIcon"
        title="Intermediate"
        description="1-3 years"
      />
      <UiOptionCard
        value="experienced"
        :icon="FlameIcon"
        title="Experienced"
        description="3+ years"
      />
    </UiRadioGroup>
  </div>
</template>
