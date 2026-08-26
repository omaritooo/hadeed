<script setup lang="ts">
const model = defineModel<number | string>();

defineProps<{
  unit: string;
  id?: string;
  ariaInvalid?: boolean;
}>();

const emit = defineEmits<{
  blur: [];
}>();
</script>

<template>
  <div
    class="bg-md-surface-container-highest border border-input flex h-14 items-center overflow-hidden rounded-lg"
    :class="ariaInvalid && 'border-destructive'"
  >
    <input
      :id="id"
      v-model="model"
      type="number"
      inputmode="decimal"
      :aria-invalid="ariaInvalid"
      class="text-foreground font-heading placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-center text-2xl tracking-tight outline-none"
      @blur="emit('blur')"
    />
    <div class="border-l border-input flex h-full items-center px-6">
      <span class="text-md-primary font-mono text-sm">{{ unit }}</span>
    </div>
  </div>
</template>
