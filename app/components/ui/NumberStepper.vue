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
  <!-- Grows to fill whatever it's placed in, so the value field (not the fixed-size
       buttons) absorbs the space -- a fixed w-10 field clipped weights like 102.5. -->
  <div class="flex min-w-0 items-center gap-1">
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      class="shrink-0 rounded-full"
      :aria-label="`Decrease by ${step}`"
      @click="adjust(-step)"
    >
      <MinusIcon class="size-3" />
    </Button>
    <Input v-model="model" type="number" :placeholder="placeholder" class="h-9 min-w-0 flex-1 px-1 py-0 text-center text-sm" />
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      class="shrink-0 rounded-full"
      :aria-label="`Increase by ${step}`"
      @click="adjust(step)"
    >
      <PlusIcon class="size-3" />
    </Button>
  </div>
</template>
