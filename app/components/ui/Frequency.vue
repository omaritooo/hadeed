<script setup lang="ts">
const model = defineModel<number | string>();
type Props = {
  min: number;
  max: number;
  range: number;
};
withDefaults(defineProps<Props>(), {
  min: 2,
  max: 6,
  range: 5,
});

const increment = () => (model.value as number)++;
const decrement = () => (model.value as number)--;
</script>

<template>
  <div class="flex flex-col gap-y-3">
    <h2 class="uppercase text-xl text-muted-foreground font-mono">Days Per Week</h2>
    <div
      class="bg-card flex flex-col justify-center px-4 py-4 h-32 gap-y-4 border border-white/10 w-full rounded-lg"
    >
      <div
        class="bg-md-surface-variant py-1 w-full flex-1 rounded-md flex justify-between items-center px-3"
      >
        <button
          class="bg-card px-3 py-2 rounded-md"
          @click="decrement"
          :disabled="model as number <= min"
        >
          -
        </button>
        <span class="flex flex-col items-center text-3xl font-mono font-bold">
          {{ model }} <span class="text-[8px]"> Days</span>
        </span>
        <button
          class="bg-card px-3 py-2 rounded-md"
          @click="increment"
          :disabled="model as number >= max"
        >
          +
        </button>
      </div>
      <div class="flex gap-x-1">
        <div
          class="flex-1 py-1.5 rounded-full"
          v-for="i in range"
          :class="i < (model as number) ? 'bg-primary ' : ' bg-md-surface-variant'"
        />
      </div>
    </div>
  </div>
</template>
