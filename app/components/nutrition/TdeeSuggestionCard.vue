<script setup lang="ts">
import { SparklesIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

const { data: estimate } = useTdeeEstimate();
const setTarget = useSetNutritionTarget();
const dismiss = useDismissTdeeSuggestion();

const ready = computed(() => {
  const value = estimate.value;
  return value?.status === "ready" && value.shouldSuggest && value.suggestedTarget ? { ...value, suggestedTarget: value.suggestedTarget } : null;
});

const trendLabel = computed(() => {
  if (!ready.value) return "";
  const trend = ready.value.trendKgPerWeek;
  const sign = trend > 0 ? "+" : trend < 0 ? "−" : "±";
  return `${sign}${Math.abs(trend)} kg/week`;
});

const busy = computed(() => setTarget.isLoading.value || dismiss.isLoading.value);

const accept = async () => {
  if (!ready.value) return;
  try {
    await setTarget.mutateAsync(ready.value.suggestedTarget);
  } catch {
    // Swallow: on failure the card stays up so the user can try again.
  }
};
</script>

<template>
  <UiCard v-if="ready" class="space-y-3 border-lime/60">
    <div class="flex items-center gap-2">
      <SparklesIcon class="size-4 text-lime" />
      <p class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">From your logs</p>
    </div>
    <p class="text-sm text-foreground">
      Your intake and weight suggest maintenance is about
      <span class="font-semibold [font-variant-numeric:tabular-nums]">{{ ready.estimate.toLocaleString() }} cal</span><template v-if="ready.formulaTdee !== null"> (the formula said {{ Math.round(ready.formulaTdee).toLocaleString() }})</template>.
    </p>
    <p class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
      Avg {{ ready.avgIntake.toLocaleString() }} cal/day · trend {{ trendLabel }}
    </p>
    <div class="flex flex-col gap-2 min-[400px]:flex-row">
      <Button class="min-[400px]:flex-1" :disabled="busy" @click="accept">
        Update target to {{ ready.suggestedTarget.calories.toLocaleString() }} cal
      </Button>
      <Button variant="ghost" :disabled="busy" @click="dismiss.mutate()">Not now</Button>
    </div>
  </UiCard>
</template>
