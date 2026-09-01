<script setup lang="ts">
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  HistoryIcon,
  InfoIcon,
  PersonStandingIcon,
  PlusIcon,
  TrophyIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { CarouselApi } from "@/components/ui/carousel";
import { kgToLbs } from "~~/shared/lib/formulas";

const exerciseId = ref("Barbell_Bench_Press_-_Medium_Grip");
const queriedId = ref("");

const { data: exercise, refetch } = useExercise(exerciseId);
const { data: exerciseHistory } = useExerciseHistory(exerciseId);
const { data: profileData } = useProfile();

const personalRecord = computed(() => exerciseHistory.value?.personalRecord ?? null);
const history = computed(() => exerciseHistory.value?.history ?? []);

const activeImageIndex = ref(0);
const onImageCarouselInit = (api: CarouselApi) => {
  if (!api) return;
  activeImageIndex.value = api.selectedScrollSnap();
  api.on("select", () => {
    activeImageIndex.value = api.selectedScrollSnap();
  });
};

const parsedInstructions = computed(() => {
  if (!exercise.value) return [];
  return exercise.value.instructions.map((step) => {
    const match = step.match(/\s*Tip:\s*(.+)$/);
    return match
      ? { text: step.slice(0, match.index).trim(), tip: (match[1] ?? "").trim() }
      : { text: step, tip: null };
  });
});

const fetchExercise = () => {
  if (queriedId.value === exerciseId.value) {
    refetch();
  } else {
    queriedId.value = exerciseId.value;
  }
};
fetchExercise();

const titleCase = (value: string): string => {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
};

const formatWeight = (weightKg: number): string => {
  if (profileData.value?.profile?.unitSystem === "imperial") {
    return `${Math.round(kgToLbs(weightKg))} lbs`;
  }
  return `${Math.round(weightKg)} kg`;
};

const formatHistoryDate = (dateString: string): string => {
  const date = new Date(`${dateString.replace(" ", "T")}Z`);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};
</script>

<template>
  <main class="mx-auto max-w-xl space-y-4 p-8">
    <UiDrawer>
      <UiDrawerTrigger as-child>
        <Button> Stepper </Button>
      </UiDrawerTrigger>
      <UiDrawerContent>
        <div class="flex flex-col gap-8 overflow-y-auto p-5 pt-6">
          <div v-if="exercise" class="space-y-3">
            <div v-if="exercise.images.length" class="relative">
              <UiCarousel class="w-full" @init-api="onImageCarouselInit">
                <UiCarouselContent>
                  <UiCarouselItem v-for="image in exercise.images" :key="image">
                    <div
                      class="aspect-4/3 w-full overflow-hidden rounded-xl bg-md-surface-container-low"
                    >
                      <NuxtImg :src="image" class="size-full object-cover" />
                    </div>
                  </UiCarouselItem>
                </UiCarouselContent>
              </UiCarousel>
              <div
                v-if="exercise.images.length > 1"
                class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5"
              >
                <span
                  v-for="(image, i) in exercise.images"
                  :key="image"
                  class="h-1.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-all duration-300"
                  :class="i === activeImageIndex ? 'w-5 opacity-100' : 'w-1.5 opacity-50'"
                />
              </div>
            </div>
            <UiDrawerTitle
              class="font-heading text-[36px] leading-11.25 tracking-[-0.9px] uppercase text-foreground"
            >
              {{ exercise.name }}
            </UiDrawerTitle>
            <div class="flex items-center gap-2">
              <UiBadge
                v-if="exercise.primaryMuscles[0]"
                class="gap-1 rounded-full bg-md-surface-container-high px-3 py-1 font-mono text-xs font-bold uppercase tracking-[1.2px] text-muted-foreground"
              >
                <ArrowUpRightIcon class="size-3.5" />
                {{ exercise.primaryMuscles[0] }}
              </UiBadge>
              <UiBadge
                v-if="exercise.mechanic"
                class="rounded-full bg-md-surface-container-high px-3 py-1 font-mono text-xs font-bold uppercase tracking-[1.2px] text-muted-foreground"
              >
                {{ exercise.mechanic }}
              </UiBadge>
            </div>
          </div>

          <div
            v-if="personalRecord"
            class="relative flex items-center h-fit min-h-22 justify-between overflow-hidden rounded-xl border border-md-surface-container-high bg-card p-5 shadow-[0_0_20px_0_rgba(255,87,34,0.2)]"
          >
            <div class="flex items-center gap-4">
              <div
                class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <TrophyIcon class="size-4.5" />
              </div>
              <div class="space-y-0.5">
                <p
                  class="font-mono text-[11px] font-bold uppercase tracking-[1px] text-md-primary"
                >
                  Personal Record
                </p>
                <p class="flex items-baseline gap-1.5">
                  <span
                    class="font-heading text-2xl text-foreground [font-variant-numeric:tabular-nums]"
                    >{{ formatWeight(personalRecord.weightKg) }}</span
                  >
                  <span
                    class="text-sm font-bold text-muted-foreground [font-variant-numeric:tabular-nums]"
                    >x {{ personalRecord.reps }}</span
                  >
                </p>
              </div>
            </div>
            <span
              class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
              >{{ formatHistoryDate(personalRecord.date) }}</span
            >
          </div>

          <div v-if="exercise?.instructions.length" class="space-y-4">
            <div class="flex items-center gap-2">
              <InfoIcon class="size-5 text-foreground" />
              <h2 class="font-heading text-xl uppercase text-foreground">Execution</h2>
            </div>
            <div class="space-y-5">
              <div
                v-for="(step, index) in parsedInstructions"
                :key="index"
                class="flex gap-4 border-b border-md-surface-variant pb-5 last:border-b-0 last:pb-0 motion-safe:group-data-[state=open]/drawer-content:animate-[step-in_0.45s_cubic-bezier(0.16,1,0.3,1)_backwards]"
                :style="{ animationDelay: `${index * 90}ms` }"
              >
                <span
                  class="w-9 shrink-0 font-heading text-3xl leading-8 [font-variant-numeric:tabular-nums]"
                  :class="index === 0 ? 'text-primary' : 'text-md-surface-container-high'"
                >
                  {{ String(index + 1).padStart(2, "0") }}
                </span>
                <div class="min-w-0 flex-1 space-y-2 pt-1">
                  <p class="text-sm leading-6 text-muted-foreground">{{ step.text }}</p>
                  <p
                    v-if="step.tip"
                    class="flex items-start gap-1.5 rounded-lg bg-md-surface-container-high px-3 py-2 text-xs leading-5"
                  >
                    <span
                      class="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[1px] text-primary"
                      >Tip</span
                    >
                    <span class="text-muted-foreground">{{ step.tip }}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div v-if="exercise" class="space-y-3">
            <div class="flex items-center gap-2">
              <PersonStandingIcon class="size-5 text-md-tertiary" />
              <h2 class="font-heading text-xl uppercase text-foreground">Target Areas</h2>
            </div>
            <div
              class="space-y-5 rounded-xl border border-md-surface-variant bg-card p-5"
            >
              <div
                class="rounded-lg py-2"
                style="
                  background: radial-gradient(
                    ellipse at center,
                    var(--md-surface-container-high),
                    transparent 70%
                  );
                "
              >
                <ExerciseMuscleMap
                  :primary-muscles="exercise.primaryMuscles"
                  :secondary-muscles="exercise.secondaryMuscles"
                />
              </div>
              <div
                class="flex flex-wrap gap-x-6 gap-y-3 border-t border-md-surface-variant pt-4"
              >
                <div v-if="exercise.primaryMuscles.length" class="flex items-start gap-2">
                  <span
                    class="mt-1.5 size-2 shrink-0 rounded-full"
                    style="background: #b91c1c"
                  />
                  <div>
                    <p
                      class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
                    >
                      Primary
                    </p>
                    <p class="text-sm font-semibold text-foreground">
                      {{ exercise.primaryMuscles.map(titleCase).join(", ") }}
                    </p>
                  </div>
                </div>
                <div
                  v-if="exercise.secondaryMuscles.length"
                  class="flex items-start gap-2"
                >
                  <span
                    class="mt-1.5 size-2 shrink-0 rounded-full"
                    style="background: #fb923c"
                  />
                  <div>
                    <p
                      class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
                    >
                      Secondary
                    </p>
                    <p class="text-sm font-semibold text-foreground">
                      {{ exercise.secondaryMuscles.map(titleCase).join(", ") }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <HistoryIcon class="size-4.5 text-foreground" />
                <h2 class="font-heading text-xl uppercase text-foreground">History</h2>
              </div>
              <span class="font-mono text-xs uppercase tracking-[1.2px] text-md-primary"
                >View All</span
              >
            </div>
            <p v-if="history.length === 0" class="text-sm text-muted-foreground">
              No sets logged for this exercise yet.
            </p>
            <div
              v-for="entry in history"
              :key="entry.sessionId"
              class="flex items-center justify-between rounded-xl border border-md-surface-variant bg-card p-5"
            >
              <div>
                <p class="mb-1 font-mono text-xs text-muted-foreground">
                  {{ formatHistoryDate(entry.date) }}
                </p>
                <div class="flex items-baseline gap-4">
                  <span class="font-heading text-lg text-foreground">{{
                    formatWeight(entry.topSetWeightKg)
                  }}</span>
                  <span class="font-heading text-lg text-muted-foreground"
                    >{{ entry.topSetReps }} Reps</span
                  >
                  <span class="font-heading text-lg text-muted-foreground"
                    >{{ entry.setsCount }} Sets</span
                  >
                </div>
              </div>
              <div
                class="flex size-8 shrink-0 items-center justify-center rounded-full bg-md-surface-container-high"
              >
                <ChevronRightIcon class="size-4 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>

        <UiDrawerFooter>
          <Button size="lg" class="w-full rounded-full uppercase">
            <PlusIcon class="size-4" />
            Log Set
          </Button>
        </UiDrawerFooter>
      </UiDrawerContent>
    </UiDrawer>
  </main>
</template>
