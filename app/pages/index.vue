<script setup lang="ts">
import { DropletIcon, FlameIcon, FlameKindlingIcon, StarIcon, UtensilsIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

definePageMeta({});
const { data: profile, isLoading, error, isPending } = useProfile();
const { data: stats } = useHomeStats();
const now = useNow();
useDateFormat(now, "MMM DD, YYYY");
const timeOfDay = computed(() => {
  if (now.value.getHours() >= 5 && now.value.getHours() <= 11) return `Good Morning, `;
  else if (now.value.getHours() >= 12 && now.value.getHours() <= 17)
    return `Good afternoon, `;
  else return `Good evening, `;
});
console.log(profile.value);
console.log(stats.value);

const { data: hydration } = useHydrationStatus();
const logHydration = useLogHydration();
const hydrationPct = computed(() => {
  if (!hydration.value?.targetMl) return 0;
  return Math.min(
    100,
    Math.round((hydration.value.totalMl / hydration.value.targetMl) * 100)
  );
});

const { data: nutrition } = useNutritionToday();
const caloriePct = computed(() => {
  if (!nutrition.value?.target?.calories) return 0;
  return Math.min(100, Math.round((nutrition.value.totals.calories / nutrition.value.target.calories) * 100));
});
const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0 ? `${Math.round(remaining)} to go` : `${Math.round(-remaining)} over`;
};
</script>

<template>
  <div class="px-4 py-4 flex flex-col gap-y-4" v-if="!isLoading || !isPending">
    <span class="font-mono text-muted-foreground">
      {{ useDateFormat(now, "MMM DD, YYYY") }}
    </span>
    <span class="flex flex-col gap-y-1 text-4xl font-heading font-semibold">
      {{ timeOfDay ?? "NULL" }}
      <span>{{ profile?.profile?.displayName?.split(" ")[0] }} </span>
    </span>

    <div class="flex gap-x-2 font-heading min-h-max h-max">
      <UiCard class="w-1/2 flex flex-col gap-y-1">
        <span class="flex gap-x-2 items-center flex-row">
          <FlameIcon fill="currentColor" class="text-primary" />
          <h2 class="text-3xl">{{ stats?.streak.current ?? 0 }}</h2></span
        >
        <span class="text-muted-foreground font-thin">Day Streak</span>
      </UiCard>
      <UiCard class="w-1/2">
        <span class="flex gap-x-2 items-center flex-row font-heading">
          <StarIcon fill="currentColor" class="text-primary" />
          <h2 class="text-3xl">Level 14</h2></span
        >
      </UiCard>
    </div>

    <div>
      <div>
        <UiCard>
          <span class="font-heading text-xl">Active Goal: {{ profile?.stats.latestWeightKg }}KG </span>
        </UiCard>
      </div>
    </div>
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <DropletIcon class="size-4.5 text-cyan-pale" />
        <h2 class="font-heading text-lg uppercase text-foreground">Hydration</h2>
      </div>
      <UiCard class="w-full space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div class="flex items-end justify-between">
          <div>
            <p
              class="font-heading text-2xl text-foreground [font-variant-numeric:tabular-nums]"
            >
              {{ (hydration?.totalMl ?? 0).toLocaleString()
              }}<span class="font-sans text-sm font-normal text-muted-foreground"
                >ml</span
              >
            </p>
            <p v-if="hydration?.targetMl" class="text-xs text-muted-foreground">
              {{ hydration.remainingMl?.toLocaleString() }}ml to go
            </p>
            <p v-else class="text-xs text-muted-foreground">
              No daily target --
              <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
            </p>
          </div>
          <span
            v-if="hydration?.targetMl"
            class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
          >
            {{ hydration.targetMl.toLocaleString() }}ml goal
          </span>
        </div>
        <div
          v-if="hydration?.targetMl"
          class="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            class="h-full rounded-full bg-secondary transition-[width]"
            :style="{ width: `${hydrationPct}%` }"
          />
        </div>
        <div class="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            :disabled="logHydration.isLoading.value"
            @click="logHydration.mutate(250)"
            >+250ml</Button
          >
          <Button
            variant="secondary"
            size="sm"
            :disabled="logHydration.isLoading.value"
            @click="logHydration.mutate(500)"
            >+500ml</Button
          >
        </div>
      </UiCard>
    </div>
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <UtensilsIcon class="size-4.5 text-lime" />
        <h2 class="font-heading text-lg uppercase text-foreground">Nutrition</h2>
      </div>
      <UiCard class="w-full space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div class="flex items-end justify-between">
          <div>
            <p class="font-heading text-2xl text-foreground [font-variant-numeric:tabular-nums]">
              {{ Math.round(nutrition?.totals.calories ?? 0).toLocaleString() }}<span
                class="font-sans text-sm font-normal text-muted-foreground"
              >cal</span>
            </p>
            <p v-if="nutrition?.target" class="text-xs text-muted-foreground">
              {{ remainingLabel(nutrition.remaining?.calories) }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              No daily target --
              <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
            </p>
          </div>
          <span
            v-if="nutrition?.target"
            class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
          >
            {{ Math.round(nutrition.target.calories).toLocaleString() }}cal goal
          </span>
        </div>
        <div v-if="nutrition?.target" class="h-1.5 overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full bg-lime transition-[width]" :style="{ width: `${caloriePct}%` }" />
        </div>
        <div v-if="nutrition?.target" class="grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
          <span>P {{ Math.round(nutrition.totals.proteinG) }}g</span>
          <span>C {{ Math.round(nutrition.totals.carbsG) }}g</span>
          <span>F {{ Math.round(nutrition.totals.fatG) }}g</span>
        </div>
        <NuxtLink to="/nutrition">
          <Button variant="secondary" size="sm">Log meal</Button>
        </NuxtLink>
      </UiCard>
    </div>
  </div>
  <div v-else>Is Loading</div>
</template>
