<script setup lang="ts">
import { MinusIcon, PlusIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// v-model is string-typed (not number) to match the string-based draft
// convention used by the pages that consume this component (values are only
// converted to numbers at submit time).
const model = defineModel<string>({ required: true });

const props = withDefaults(defineProps<{
  step: number;
  min?: number;
  placeholder?: string;
}>(), {
  min: 0,
});

const toNumber = (value: string) => {
  const parsed = Number(value);
  return value.trim() === "" || Number.isNaN(parsed) ? 0 : parsed;
};

// Round away float dust (e.g. 0 + 2.5 + 2.5 should read as 5, not
// 4.999999999999999) without imposing a fixed decimal format.
const round = (value: number) => Math.round(value * 100) / 100;

const adjust = (delta: number) => {
  const next = round(toNumber(model.value) + delta);
  model.value = String(Math.max(props.min, next));
};
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      class="shrink-0 rounded-full"
      :aria-label="`Decrease by ${step}`"
      @click="adjust(-step)"
    >
      <MinusIcon class="size-3" />
    </Button>
    <Input v-model="model" type="number" :placeholder="placeholder" class="w-10 shrink-0 text-center text-sm" />
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      class="shrink-0 rounded-full"
      :aria-label="`Increase by ${step}`"
      @click="adjust(step)"
    >
      <PlusIcon class="size-3" />
    </Button>
  </div>
</template>
