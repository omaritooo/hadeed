<script setup lang="ts">
import { CircleChevronLeft, CircleChevronRight } from "@lucide/vue";
type Props = {
  steps: number;
  currentStep: number;
  prevFunction: () => void;
  nextFunction: () => void;
};
const props = withDefaults(defineProps<Props>(), {
  steps: 5,
  currentStep: 1,
});
</script>

<template>
  <div class="flex w-full justify-center items-start gap-x-4">
    <div class="flex flex-col gap-y-2 w-full max-w-5xl px-2">
      <div class="w-full flex justify-between py-2 relative">
        <button
          v-show="currentStep > 1"
          @click="prevFunction"
          class="text-3xl absolute top-2 left-3"
        >
          <CircleChevronLeft :size="32" />
        </button>
        <span
          class="justify-center-safe mx-auto text-muted-foreground font-heading text-2xl"
          >Step {{ currentStep }} out of {{ steps }}</span
        >
        <button
          v-show="currentStep < 5"
          @click="nextFunction"
          class="text-3xl absolute top-2 right-3"
        >
          <CircleChevronRight :size="32" />
        </button>
      </div>

      <div class="h-12 flex gap-x-2 max-w-5xl mx-auto w-full">
        <div
          v-for="(step, index) in steps"
          class="px-2 py-1 max-h-0.5 w-1/5 rounded-lg"
          :class="index + 1 <= currentStep ? 'bg-primary' : 'bg-muted'"
        />
      </div>
    </div>
  </div>
</template>
