<script setup lang="ts">
import { Input } from "@/components/ui/input";

// The weight/reps/RPE/warm-up inputs shared by the log-next-set row, the edit-a-logged-set
// row and the circuit row. Laid out over two lines so it fits a ~320px phone card: weight and
// reps each get half the width on the first line (so a value like 102.5 stays readable),
// while RPE, warm-up and the row's actions (plate calculator, save) share the second.
const weightKg = defineModel<string>("weightKg", { required: true });
const reps = defineModel<string>("reps", { required: true });
const rpe = defineModel<string>("rpe", { required: true });
const isWarmup = defineModel<boolean>("isWarmup", { required: true });

defineProps<{
  setLabel: string | number;
  // e.g. "Last: 70kg × 8" -- what this same set was last session.
  hint?: string | null;
  emphasized?: boolean;
}>();
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-end gap-2">
      <span
        class="w-6 shrink-0 pb-2 text-sm"
        :class="emphasized ? 'font-semibold text-foreground' : 'text-muted-foreground'"
      >{{ setLabel }}</span>
      <div class="grid min-w-0 flex-1 grid-cols-2 gap-2">
        <div class="min-w-0 space-y-1">
          <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">kg</p>
          <UiNumberStepper v-model="weightKg" :step="2.5" placeholder="kg" />
        </div>
        <div class="min-w-0 space-y-1">
          <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Reps</p>
          <UiNumberStepper v-model="reps" :step="1" placeholder="reps" />
        </div>
      </div>
    </div>
    <p v-if="hint" class="pl-8 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{{ hint }}</p>
    <div class="flex flex-wrap items-center gap-2 pl-8">
      <Input v-model="rpe" type="number" placeholder="RPE" aria-label="RPE" class="h-9 w-16 shrink-0 px-2 py-0 text-center text-sm" />
      <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UiCheckbox :model-value="isWarmup" @update:model-value="(value) => (isWarmup = !!value)" />
        Warm-up
      </label>
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
