<script setup lang="ts">
import { DumbbellIcon, FlameIcon, HeartIcon, WrenchIcon } from "@lucide/vue";
import { useOnboardingStore } from "~/store/onboarding";
import { stepSchemas } from "~~/shared/schemas/onboarding";
const store = useOnboardingStore();
const { form, validateAll } = useZodForm(stepSchemas[3], {
  primaryGoal: store.form.primaryGoal ?? "muscle_gain",
});

const goalOptions = [
  { value: "fat_loss", icon: FlameIcon, title: "Fat Loss", description: "New to exercising" },
  { value: "muscle_gain", icon: DumbbellIcon, title: "Muscle Gain", description: "Hypertrophy & Size" },
  { value: "maintenance", icon: WrenchIcon, title: "Maintenance", description: "3+ years" },
  { value: "general_fitness", icon: HeartIcon, title: "General Health", description: "3+ years" },
];
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
