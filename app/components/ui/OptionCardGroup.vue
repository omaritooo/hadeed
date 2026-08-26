<script setup lang="ts">
import type { Component, HTMLAttributes } from "vue";

export type OptionCardGroupOption = {
  value: string;
  icon: Component;
  title: string;
  description?: string;
};

defineProps<{
  options: OptionCardGroupOption[];
  defaultValue?: string;
  class?: HTMLAttributes["class"];
}>();

const model = defineModel<string>();
</script>

<template>
  <UiRadioGroup v-model="model" :default-value="defaultValue" :class="class">
    <UiOptionCard
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :icon="option.icon"
      :title="option.title"
      :description="option.description"
    />
  </UiRadioGroup>
</template>
