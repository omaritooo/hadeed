<script setup lang="ts">
const model = defineModel<number | string>();

defineProps<{
  unit: string;
  label?: string;
  id?: string;
  ariaInvalid?: boolean;
}>();

const emit = defineEmits<{
  blur: [];
}>();
</script>

<template>
  <div class="min-w-0 space-y-1.5">
    <p v-if="label" class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{{ label }}</p>
    <div
      class="bg-surface-strong border border-input flex h-14 items-center overflow-hidden rounded-lg"
      :class="ariaInvalid && 'border-destructive'"
    >
      <input
        :id="id"
        v-model="model"
        type="number"
        inputmode="decimal"
        :aria-invalid="ariaInvalid"
        class="text-foreground font-heading placeholder:text-muted-foreground h-full w-full min-w-0 flex-1 bg-transparent px-2 text-center text-xl tracking-tight outline-none sm:text-2xl"
        @blur="emit('blur')"
      />
      <!-- Kept narrow: in two-column grids on a phone this addon used to eat most of the
           field, leaving the number itself a few pixels wide. -->
      <!-- Capped so a long count label like "can (~185g)" truncates instead of collapsing the
           input to zero width (which made those ingredients impossible to add to a meal). -->
      <div class="border-l border-input flex h-full min-w-0 max-w-[55%] shrink-0 items-center px-3 sm:px-5" :title="unit">
        <span class="text-peach truncate whitespace-nowrap font-mono text-xs sm:text-sm">{{ unit }}</span>
      </div>
    </div>
  </div>
</template>
