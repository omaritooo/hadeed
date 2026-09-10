<script setup lang="ts">
import { goalOptions } from "@/lib/onboarding-options";
import { useOnboardingStore } from "~/store/onboarding";
import { stepSchemas } from "~~/shared/schemas/onboarding";
const store = useOnboardingStore();
const { form, validateAll } = useZodForm(stepSchemas[3], {
  primaryGoal: store.form.primaryGoal ?? "muscle_gain",
});
defineExpose({
  validate() {
    if (!validateAll()) return false;
    store.mergeStep({ ...form });
    return true;
  },
});
</script>

<template>
  <div class="w-full">
    <UiFieldFormField label="" name="primaryGoal">
      <UiOptionCardGroup
        v-model="form.primaryGoal"
        default-value="muscle_gain"
        class="space-y-3"
        :options="goalOptions"
      />
    </UiFieldFormField>
  </div>
</template>
