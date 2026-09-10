<script setup lang="ts">
import { WeightIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kgToLbs, round1 } from "~~/shared/lib/formulas";
import { calculatePlatesPerSide, defaultBarWeightForUnitSystem, plateSetForUnitSystem } from "~~/shared/lib/plate-calculator";
import type { UnitSystem } from "~~/shared/types/profile.types";

// Only meaningfully useful for barbell exercises — callers gate this component on the
// exercise's `equipment === 'barbell'` rather than this component gating itself, so it stays
// a pure "given a target weight, show me the plates" widget.
const props = defineProps<{
  targetWeightKg: number;
  unitSystem: UnitSystem;
}>();

const unitLabel = computed(() => (props.unitSystem === "imperial" ? "lb" : "kg"));

// The session always logs weight in kg regardless of the user's display preference (see the
// weight steppers elsewhere on this page) — an imperial user's gym plates are in lb, so the
// target gets converted before plate math runs, and the bar-weight override below is entered
// in the same display unit.
const targetInDisplayUnit = computed(() => {
  return props.unitSystem === "imperial" ? kgToLbs(props.targetWeightKg) : props.targetWeightKg;
});

// A plain ref rather than a computed default: the user may override it, and re-deriving from
// unitSystem on every render would stomp that override. It's set once per popover instance,
// which is fine since a given exercise's unit system doesn't change while the calculator is open.
const barWeightInput = ref(String(defaultBarWeightForUnitSystem(props.unitSystem)));
const barWeight = computed(() => {
  const parsed = Number(barWeightInput.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultBarWeightForUnitSystem(props.unitSystem);
});

const result = computed(() => calculatePlatesPerSide({
  targetTotal: targetInDisplayUnit.value,
  barWeight: barWeight.value,
  plateSet: plateSetForUnitSystem(props.unitSystem),
}));

const hasRemainder = computed(() => Math.abs(result.value.remainder) >= 0.01);

// Rough visual sizing for the plate diagram — bigger plates render taller, purely cosmetic.
const plateHeightPx = (plate: number) => 24 + Math.min(plate, 25) * 1.6;
</script>

<template>
  <UiPopover>
    <UiPopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        class="shrink-0 rounded-full"
        aria-label="Plate calculator"
      >
        <WeightIcon class="size-3.5" />
      </Button>
    </UiPopoverTrigger>
    <UiPopoverContent class="w-64 space-y-3">
      <div class="flex items-center justify-between gap-2">
        <p class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">Plates / side</p>
        <label class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          Bar
          <Input v-model="barWeightInput" type="number" class="h-6 w-14 px-1.5 text-right text-xs" />
          {{ unitLabel }}
        </label>
      </div>

      <p v-if="result.platesPerSide.length === 0" class="text-sm text-muted-foreground">
        No plates needed — bar only.
      </p>
      <template v-else>
        <div class="flex min-h-16 flex-wrap items-end justify-center gap-1">
          <div
            v-for="(plate, index) in result.platesPerSide"
            :key="index"
            class="flex w-6 shrink-0 items-center justify-center rounded-sm bg-primary/80 text-[9px] font-semibold text-primary-foreground"
            :style="{ height: `${plateHeightPx(plate)}px` }"
          >
            {{ plate }}
          </div>
        </div>
        <p class="text-center text-sm text-foreground">{{ result.platesPerSide.join(" + ") }} {{ unitLabel }}</p>
      </template>

      <p class="text-center text-xs text-muted-foreground">
        Target: {{ round1(targetInDisplayUnit) }} {{ unitLabel }}
        <template v-if="hasRemainder">
          — closest: {{ round1(result.achievedTotal) }} {{ unitLabel }}
        </template>
      </p>
    </UiPopoverContent>
  </UiPopover>
</template>
