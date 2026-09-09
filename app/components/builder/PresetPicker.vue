<script setup lang="ts">
import type { Equipment, SplitRecommendation } from "~~/shared/types/preset.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { equipmentSatisfies } from "~~/shared/lib/equipment";

const selectedPresetId = defineModel<number | null>("selectedPresetId", { required: true });
const emit = defineEmits<{ continue: [] }>();

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  full_gym: "Requires full gym",
  home_barbell_dumbbell: "Requires barbell + dumbbells",
  home_dumbbell_only: "Requires dumbbells",
  bodyweight: "Bodyweight only",
  both: "",
};

const { data: profile } = useProfile();
const daysPerWeek = ref(3);
const daysPerWeekInitialized = ref(false);

watchEffect(() => {
  if (!daysPerWeekInitialized.value && profile.value?.profile?.trainingDaysPerWeek) {
    daysPerWeek.value = profile.value.profile.trainingDaysPerWeek;
    daysPerWeekInitialized.value = true;
  }
});

const recommendationInput = computed(() => ({
  daysPerWeek: Math.min(7, Math.max(1, daysPerWeek.value || 1)),
  experienceLevel: null,
  goal: null,
  equipment: profile.value?.profile?.equipment ?? null,
}));

const { data: recommendations, isLoading, error } = useRecommendedSplits(recommendationInput);

const isEquipmentMismatch = (rec: SplitRecommendation): boolean => {
  const userTier = profile.value?.profile?.equipment;
  if (!userTier) return false;
  return !equipmentSatisfies({ userTier, required: rec.preset.equipment });
};

watch(recommendations, (list) => {
  if (list && !list.some(rec => rec.preset.id === selectedPresetId.value)) {
    selectedPresetId.value = null;
  }
});
</script>

<template>
  <div class="flex flex-col gap-y-4">
    <label class="flex flex-col gap-y-1 text-sm text-muted-foreground">
      Days per week
      <Input v-model.number="daysPerWeek" type="number" min="1" max="7" class="w-24" />
    </label>

    <p v-if="isLoading" class="text-sm text-muted-foreground">Loading recommendations…</p>
    <p v-else-if="error" class="text-sm text-destructive">Couldn't load recommendations. Please try again.</p>
    <p v-else-if="!recommendations?.length" class="text-sm text-muted-foreground">
      No presets match yet — try a different days-per-week value, or build your own instead.
    </p>

    <UiCard
      v-for="rec in recommendations"
      :key="rec.preset.id"
      class="cursor-pointer space-y-1"
      :class="selectedPresetId === rec.preset.id ? 'border-primary' : ''"
      @click="selectedPresetId = rec.preset.id"
    >
      <p class="font-heading text-lg text-foreground">{{ rec.preset.name }}</p>
      <p v-if="rec.preset.description" class="text-sm text-muted-foreground">{{ rec.preset.description }}</p>
      <UiBadge
        v-if="isEquipmentMismatch(rec)"
        class="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      >
        {{ EQUIPMENT_LABELS[rec.preset.equipment] }}
      </UiBadge>
      <p v-if="rec.reasons.length" class="text-xs text-muted-foreground">{{ rec.reasons.join(" · ") }}</p>
    </UiCard>

    <Button size="lg" :disabled="selectedPresetId === null" @click="emit('continue')">Continue</Button>
  </div>
</template>
