<script setup lang="ts">
import { CombineIcon, DumbbellIcon, HomeIcon } from "@lucide/vue";
import { useOnboardingStore } from "~/store/onboarding";
import { stepSchemas } from "~~/shared/schemas/onboarding";
const store = useOnboardingStore();

const { form, errors, validateAll } = useZodForm(stepSchemas[5], {
  frequency: store.form.frequency ?? 2,
  equipment: store.form.equipment ?? "gym",
});

const equipmentOptions = [
  { value: "gym", icon: DumbbellIcon, title: "Gym", description: "Full gym access" },
  { value: "home", icon: HomeIcon, title: "Home", description: "Dumbbells or limited equipment" },
  { value: "both", icon: CombineIcon, title: "Both", description: "Gym and home equipment" },
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
  <div>
    <UiFrequency v-model="form.frequency" :min="2" :max="6" :range="5" />
    <h2
      class="flex gap-x-2 mt-4 pt-4 items-center font-mono text-muted-foreground text-2xl"
    >
      <ActivityIcon /> Equipment
    </h2>
    <UiFieldFormField name="equipment" label="" :errors="errors.equipment">
      <UiOptionCardGroup
        v-model="form.equipment"
        default-value="gym"
        :options="equipmentOptions"
      />
    </UiFieldFormField>
  </div>
</template>
