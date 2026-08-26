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
          aria-label="Previous step"
          class="text-muted-foreground hover:bg-md-surface-container-high hover:text-foreground absolute top-1/2 left-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
        >
          <CircleChevronLeft :size="20" />
        </button>
        <span
          class="justify-center-safe mx-auto text-muted-foreground font-heading text-2xl"
          >Step {{ currentStep }} out of {{ steps }}</span
        >
        <button
          v-show="currentStep < steps"
          @click="nextFunction"
          aria-label="Next step"
          class="text-muted-foreground hover:bg-md-surface-container-high hover:text-foreground absolute top-1/2 right-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
        >
          <CircleChevronRight :size="20" />
        </button>
      </div>

      <div class="flex gap-x-2 max-w-5xl mx-auto w-full">
        <div
          v-for="(step, index) in steps"
          :key="index"
          class="flex-1 h-2 rounded-full"
          :class="
            index + 1 <= currentStep
              ? 'bg-primary shadow-[0px_0px_8px_0px_rgba(255,87,34,0.5)]'
              : 'bg-md-surface-container-high'
          "
        />
      </div>
    </div>
  </div>
</template>
