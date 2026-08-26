<script setup lang="ts">
import { stepSchemas } from "~~/shared/schemas/onboarding";
import { FormField } from "@/components/ui/field";
import { useOnboardingStore } from "@/store/onboarding";

const store = useOnboardingStore();

const { form, errors, validateField, validateAll } = useZodForm(stepSchemas[4], {
  weight: store.form.weight ?? 88,
  height: store.form.height ?? 180,
  targetWeight: store.form.targetWeight,
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
  <div
    class="flex flex-col gap-5 rounded-2xl bg-card p-5 **:data-[slot=field-label]:text-xs **:data-[slot=field-label]:uppercase **:data-[slot=field-label]:tracking-wide **:data-[slot=field-label]:text-muted-foreground"
  >
    <FormField
      label="Weight"
      name="weight"
      :errors="errors.weight"
      v-slot="{ id, ariaInvalid }"
    >
      <UiMetricInput
        :id="id"
        v-model="form.weight"
        unit="KG"
        :aria-invalid="ariaInvalid"
        @blur="validateField('weight')"
      />
    </FormField>
    <FormField
      label="Height"
      name="height"
      :errors="errors.height"
      v-slot="{ id, ariaInvalid }"
    >
      <UiMetricInput
        :id="id"
        v-model="form.height"
        unit="CM"
        :aria-invalid="ariaInvalid"
        @blur="validateField('height')"
      />
    </FormField>
    <FormField
      label="Target weight (optional)"
      name="targetWeight"
      :errors="errors.targetWeight"
      v-slot="{ id, ariaInvalid }"
    >
      <UiMetricInput
        :id="id"
        v-model="form.targetWeight"
        unit="KG"
        :aria-invalid="ariaInvalid"
        @blur="validateField('targetWeight')"
      />
    </FormField>
  </div>
</template>
