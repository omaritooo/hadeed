<script setup lang="ts">
import { ActivityIcon, ShieldAlertIcon } from "@lucide/vue";
import { equipmentOptions } from "@/lib/onboarding-options";
import { useOnboardingStore } from "~/store/onboarding";
import { stepSchemas } from "~~/shared/schemas/onboarding";
const store = useOnboardingStore();

const { form, errors, validateAll } = useZodForm(stepSchemas[5], {
  frequency: store.form.frequency ?? 2,
  equipment: store.form.equipment ?? "full_gym",
  // Copied: store.form is reactive, and useZodForm structuredClones its initial values, which throws on a proxy.
  limitations: [...(store.form.limitations ?? [])],
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
    <h2
      id="onboarding-limitations-heading"
      class="flex gap-x-2 mt-4 pt-4 items-center font-mono text-muted-foreground text-2xl"
    >
      <ShieldAlertIcon aria-hidden="true" /> Anything to work around?
    </h2>
    <p class="mb-3 text-sm text-muted-foreground">Optional. Skip if nothing bothers you.</p>
    <ProfileLimitationChips
      labelledby="onboarding-limitations-heading"
      :model-value="form.limitations ?? []"
      @update:model-value="(value) => form.limitations = value"
    />
  </div>
</template>
