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

// Hide the card as soon as an accept succeeds. The estimate refetch after setting a target is
// fire-and-forget, so without this the stale suggestion stays on screen for a moment and a tap
// on "Not now" in that window would silently snooze future suggestions for two weeks. Holds the
// accepted calories so a later, genuinely different suggestion can bring the card back.
const acceptedCalories = ref<number | null>(null);
watch(() => ready.value?.suggestedTarget.calories, (calories) => {
  if (calories !== undefined && acceptedCalories.value !== null && calories !== acceptedCalories.value) acceptedCalories.value = null;
});

const accept = async () => {
  if (!ready.value) return;
  const { suggestedTarget } = ready.value;
  try {
    await setTarget.mutateAsync(suggestedTarget);
    acceptedCalories.value = suggestedTarget.calories;
  } catch {
    // Swallow: the error line below the buttons tells the user, and the card stays up to retry.
  }
};
</script>

<template>
  <UiCard v-if="ready && acceptedCalories === null" role="region" :aria-labelledby="labelId" class="space-y-3 border-lime/60">
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
      <Button variant="ghost" aria-label="Not now, hide this suggestion for two weeks" :disabled="busy" @click="dismiss.mutate()">Not now</Button>
    </div>
    <p v-if="setTarget.error.value" class="text-xs text-destructive">Couldn't update your target. Try again.</p>
    <p v-if="dismiss.error.value" class="text-xs text-destructive">Couldn't hide this suggestion. Try again.</p>
  </UiCard>
</template>
