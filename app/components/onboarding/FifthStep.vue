<script setup lang="ts">
import { DumbbellIcon, HomeIcon, PersonStandingIcon, WeightIcon } from "@lucide/vue";
import { useOnboardingStore } from "~/store/onboarding";
import { stepSchemas } from "~~/shared/schemas/onboarding";
const store = useOnboardingStore();

const { form, errors, validateAll } = useZodForm(stepSchemas[5], {
  frequency: store.form.frequency ?? 2,
  equipment: store.form.equipment ?? "full_gym",
});

const equipmentOptions = [
  { value: "full_gym", icon: DumbbellIcon, title: "Full Gym", description: "Barbells, machines, and full equipment access" },
  { value: "home_barbell_dumbbell", icon: HomeIcon, title: "Home Gym", description: "Barbell and dumbbells at home" },
  { value: "home_dumbbell_only", icon: WeightIcon, title: "Dumbbells Only", description: "Dumbbells at home, no barbell" },
  { value: "bodyweight", icon: PersonStandingIcon, title: "Bodyweight", description: "No equipment at all" },
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
        default-value="full_gym"
        :options="equipmentOptions"
      />
    </UiFieldFormField>
  </div>
</template>
