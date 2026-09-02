<script setup lang="ts">
import { PlusIcon, TrashIcon, UtensilsIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

definePageMeta({});

type Tab = "today" | "ingredients" | "presets";
const tab = ref<Tab>("today");

const { data: nutrition } = useNutritionToday();
const deleteMealLog = useDeleteMealLog();

const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0 ? `${Math.round(remaining)} left` : `${Math.round(-remaining)} over`;
};
const macroPct = (consumed: number, target: number | undefined): number => {
  if (!target) return 0;
  return Math.min(100, Math.round((consumed / target) * 100));
};
</script>

<template>
  <main class="mx-auto max-w-xl space-y-6 p-6 pb-24">
    <div class="flex items-center gap-2">
      <UtensilsIcon class="size-5 text-lime" />
      <h1 class="font-heading text-2xl uppercase text-foreground">Nutrition</h1>
    </div>

    <div class="flex gap-2 border-b border-surface-strong">
      <button
        v-for="t in (['today', 'ingredients', 'presets'] as Tab[])"
        :key="t"
        class="px-3 py-2 font-mono text-xs uppercase tracking-[1px]"
        :class="tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'"
        @click="tab = t"
      >
        {{ t }}
      </button>
    </div>

    <section v-if="tab === 'today'" class="space-y-4">
      <UiCard class="space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div v-if="nutrition?.target" class="grid grid-cols-2 gap-4">
          <div v-for="(label, key) in { calories: 'Calories', proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' }" :key="key" class="space-y-1">
            <div class="flex items-baseline justify-between">
              <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{{ label }}</span>
              <span class="font-mono text-[10px] text-muted-foreground">{{ remainingLabel(nutrition.remaining?.[key]) }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-lime transition-[width]" :style="{ width: `${macroPct(nutrition.totals[key], nutrition.target?.[key])}%` }" />
            </div>
            <p class="font-heading text-lg text-foreground [font-variant-numeric:tabular-nums]">
              {{ Math.round(nutrition.totals[key]) }}<span class="text-xs text-muted-foreground">/{{ Math.round(nutrition.target[key]) }}{{ key === 'calories' ? 'cal' : 'g' }}</span>
            </p>
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground">
          No daily target set --
          <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
        </p>
      </UiCard>

      <div class="space-y-2">
        <div v-for="meal in nutrition?.meals ?? []" :key="meal.id" class="rounded-xl border border-surface-strong bg-card p-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-sm font-semibold text-foreground">{{ meal.name ?? "Meal" }}</p>
              <p class="font-mono text-[10px] text-muted-foreground">
                {{ Math.round(meal.items.reduce((s, i) => s + i.calories, 0)) }}cal --
                {{ meal.items.map((i) => i.ingredientName).join(", ") }}
              </p>
            </div>
            <button :disabled="deleteMealLog.isLoading.value" @click="deleteMealLog.mutate(meal.id)">
              <TrashIcon class="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>
        <p v-if="!nutrition?.meals.length" class="text-center text-sm text-muted-foreground">No meals logged today.</p>
      </div>

      <NuxtLink to="/nutrition/log">
        <Button variant="secondary" class="w-full gap-2"><PlusIcon class="size-4" />Log Meal</Button>
      </NuxtLink>
    </section>
  </main>
</template>
