<script setup lang="ts">
import {
  ActivityIcon,
  FootprintsIcon,
  LampDeskIcon,
  Settings2Icon,
  SofaIcon,
  WeightTildeIcon,
} from "@lucide/vue";
import { experienceOptions } from "@/lib/onboarding-options";
import { useOnboardingStore } from "~/store/onboarding";
import { stepSchemas } from "~~/shared/schemas/onboarding";

const store = useOnboardingStore();

const { form, errors, validateAll } = useZodForm(stepSchemas[2], {
  experienceLevel: store.form.experienceLevel ?? "beginner",
  activityLevel: store.form.activityLevel ?? "sedentary",
});

const activityOptions = [
  { value: "sedentary", icon: SofaIcon, title: "Mostly Sitting", description: "Desk job, little intentional exercise" },
  { value: "lightly_active", icon: FootprintsIcon, title: "On my feet all day", description: "Retail, nursing, teaching etc" },
  {
    value: "very_active",
    icon: WeightTildeIcon,
    title: "Physically demanding job",
    description: "A job that requires heavy lifting or a lot of moving",
  },
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
    <div class="flex flex-col gap-y-4 py-3">
      <h2 class="flex gap-x-2 items-center font-heading text-headline-lg-mobile">
        <Settings2Icon /> Experience Level
      </h2>
      <UiFieldFormField name="experienceLevel" label="" class="mb-4">
        <UiOptionCardGroup
          v-model="form.experienceLevel"
          default-value="beginner"
          :options="experienceOptions"
        />
      </UiFieldFormField>
    </div>
    <div class="flex flex-col gap-y-4 py-3">
      <h2 class="flex gap-x-2 mt-4 items-center font-heading text-headline-lg-mobile">
        <ActivityIcon /> Activity Level
      </h2>
      <UiFieldFormField name="activityLevel" label="">
        <UiOptionCardGroup
          v-model="form.activityLevel"
          default-value="sedentary"
          :options="activityOptions"
        />
      </UiFieldFormField>
    </div>
  </div>
</template>
