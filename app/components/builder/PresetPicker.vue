<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const selectedPresetId = defineModel<number | null>("selectedPresetId", { required: true });
const emit = defineEmits<{ continue: [] }>();

const { data: profile } = useProfile();
const daysPerWeek = ref(3);

watchEffect(() => {
  if (profile.value?.profile?.trainingDaysPerWeek) {
    daysPerWeek.value = profile.value.profile.trainingDaysPerWeek;
  }
});

const recommendationInput = computed(() => ({
  daysPerWeek: daysPerWeek.value,
  experienceLevel: null,
  goal: null,
  equipment: null,
}));

const { data: recommendations, isLoading } = useRecommendedSplits(recommendationInput);
</script>

<template>
  <div class="flex flex-col gap-y-4">
    <label class="flex flex-col gap-y-1 text-sm text-muted-foreground">
      Days per week
      <Input v-model.number="daysPerWeek" type="number" min="1" max="7" class="w-24" />
    </label>

    <p v-if="isLoading" class="text-sm text-muted-foreground">Loading recommendations…</p>
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
      <p class="text-xs text-muted-foreground">{{ rec.reasons.join(" · ") }}</p>
    </UiCard>

    <Button size="lg" :disabled="selectedPresetId === null" @click="emit('continue')">Continue</Button>
  </div>
</template>
