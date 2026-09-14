<script setup lang="ts">
import { SparklesIcon } from "@lucide/vue";
import { describeTdeeEstimate, formatWeightTrend } from "~~/shared/lib/tdee-estimate-copy";
import { Button } from "@/components/ui/button";

const { data: estimate } = useTdeeEstimate();
const { data: profile } = useProfile();
// Same query (and cache entry) as the Today tab's macros card, so this adds no request.
const { data: nutrition } = useNutritionToday();
const setTarget = useSetNutritionTarget();
const dismiss = useDismissTdeeSuggestion();

const labelId = useId();

const ready = computed(() => {
  const value = estimate.value;
  return value?.status === "ready" && value.shouldSuggest && value.suggestedTarget ? { ...value, suggestedTarget: value.suggestedTarget } : null;
});

const headline = computed(() => (ready.value ? describeTdeeEstimate(ready.value) : ""));

const trendLabel = computed(() => {
  if (!ready.value) return "";
  return formatWeightTrend(ready.value.trendKgPerWeek, profile.value?.profile?.unitSystem === "imperial" ? "imperial" : "metric");
});

const currentTargetLabel = computed(() => {
  const current = nutrition.value?.target;
  return current ? `now ${Math.round(current.calories).toLocaleString()}` : "no target yet";
});

const busy = computed(() => setTarget.isLoading.value || dismiss.isLoading.value);

const accept = async () => {
  if (!ready.value) return;
  try {
    await setTarget.mutateAsync(ready.value.suggestedTarget);
  } catch {
    // Swallow: the error line below the buttons tells the user, and the card stays up to retry.
  }
};
</script>

<template>
  <UiCard v-if="ready" role="region" :aria-labelledby="labelId" class="space-y-3 border-lime/60">
    <div class="flex items-center gap-2">
      <SparklesIcon class="size-4 text-lime" aria-hidden="true" />
      <p :id="labelId" class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">From your logs</p>
    </div>
    <p class="text-sm text-foreground [font-variant-numeric:tabular-nums]">{{ headline }}</p>
    <p class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
      Avg {{ ready.avgIntake.toLocaleString() }} cal/day · trend {{ trendLabel }}
    </p>
    <div class="flex flex-col gap-2 sm:flex-row">
      <Button class="h-auto min-h-9 whitespace-normal sm:flex-1" :disabled="busy" @click="accept">
        Update target to {{ ready.suggestedTarget.calories.toLocaleString() }} cal ({{ currentTargetLabel }})
      </Button>
      <Button variant="ghost" aria-label="Hide this suggestion for two weeks" :disabled="busy" @click="dismiss.mutate()">Not now</Button>
    </div>
    <p v-if="setTarget.error.value" class="text-xs text-destructive">Couldn't update your target. Try again.</p>
    <p v-if="dismiss.error.value" class="text-xs text-destructive">Couldn't hide this suggestion. Try again.</p>
  </UiCard>
</template>
