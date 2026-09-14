<script setup lang="ts">
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  HistoryIcon,
  InfoIcon,
  PersonStandingIcon,
  TrophyIcon,
} from "@lucide/vue";
import type { CarouselApi } from "@/components/ui/carousel";
import { kgToLbs, round1 } from "~~/shared/lib/formulas";

const props = defineProps<{ exerciseId: string }>();
const exerciseId = toRef(props, "exerciseId");

const { data: exercise, refetch: refetchExercise } = useExercise(exerciseId);
const { data: exerciseHistory, refetch: refetchHistory } = useExerciseHistory(exerciseId);
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

watch(
  exerciseId,
  () => {
    refetchExercise();
    refetchHistory();
  },
  { immediate: true },
);

const titleCase = (value: string): string => {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
};

// One decimal rather than whole numbers: plate jumps are often 2.5kg/1.25kg, and with every
// set listed side by side, 102.5 rounding to 103 would misreport what was lifted.
const formatWeight = (weightKg: number): string => {
  if (profileData.value?.profile?.unitSystem === "imperial") {
    return `${round1(kgToLbs(weightKg))} lbs`;
  }
  return `${round1(weightKg)} kg`;
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
  <div class="flex flex-col gap-8 overflow-y-auto p-5 pt-6">
    <div v-if="exercise" class="space-y-3">
      <!-- Exercises added beyond free-exercise-db have no start/end ROM photos,
           so the muscle map stands in as the hero visual and the copy further
           down is dropped rather than shown twice. -->
      <div
        v-if="!exercise.images.length"
        class="rounded-xl bg-card py-2"
        style="
          background: radial-gradient(
            ellipse at center,
            var(--popover),
            transparent 70%
          );
        "
      >
        <ExerciseMuscleMap
          :primary-muscles="exercise.primaryMuscles"
          :secondary-muscles="exercise.secondaryMuscles"
        />
      </div>
      <div v-else class="relative">
        <UiCarousel class="w-full" @init-api="onImageCarouselInit">
          <UiCarouselContent>
            <UiCarouselItem v-for="image in exercise.images" :key="image">
              <div
                class="aspect-4/3 w-full overflow-hidden rounded-xl bg-card"
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
          class="gap-1 rounded-full bg-popover px-3 py-1 font-mono text-xs font-bold uppercase tracking-[1.2px] text-muted-foreground"
        >
          <ArrowUpRightIcon class="size-3.5" />
          {{ exercise.primaryMuscles[0] }}
        </UiBadge>
        <UiBadge
          v-if="exercise.mechanic"
          class="rounded-full bg-popover px-3 py-1 font-mono text-xs font-bold uppercase tracking-[1.2px] text-muted-foreground"
        >
          {{ exercise.mechanic }}
        </UiBadge>
      </div>
    </div>

    <div
      v-if="personalRecord"
      class="relative flex items-center h-fit min-h-22 justify-between overflow-hidden rounded-xl border border-popover bg-card p-5 shadow-[0_0_20px_0_rgba(255,87,34,0.2)]"
    >
      <div class="flex items-center gap-4">
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <TrophyIcon class="size-4.5" />
        </div>
        <div class="space-y-0.5">
          <p
            class="font-mono text-[11px] font-bold uppercase tracking-[1px] text-peach"
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
          class="flex gap-4 border-b border-surface-strong pb-5 last:border-b-0 last:pb-0 motion-safe:group-data-[state=open]/drawer-content:animate-[step-in_0.45s_cubic-bezier(0.16,1,0.3,1)_backwards]"
          :style="{ animationDelay: `${index * 90}ms` }"
        >
          <span
            class="w-9 shrink-0 font-heading text-3xl leading-8 [font-variant-numeric:tabular-nums]"
            :class="index === 0 ? 'text-primary' : 'text-popover'"
          >
            {{ String(index + 1).padStart(2, "0") }}
          </span>
          <div class="min-w-0 flex-1 space-y-2 pt-1">
            <p class="text-sm leading-6 text-muted-foreground">{{ step.text }}</p>
            <p
              v-if="step.tip"
              class="flex items-start gap-1.5 rounded-lg bg-popover px-3 py-2 text-xs leading-5"
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
        <PersonStandingIcon class="size-5 text-lime" />
        <h2 class="font-heading text-xl uppercase text-foreground">Target Areas</h2>
      </div>
      <div
        class="space-y-5 rounded-xl border border-surface-strong bg-card p-5"
      >
        <div
          v-if="exercise.images.length"
          class="rounded-lg py-2"
          style="
            background: radial-gradient(
              ellipse at center,
              var(--popover),
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
          class="flex flex-wrap gap-x-6 gap-y-3 border-t border-surface-strong pt-4"
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
        <span class="font-mono text-xs uppercase tracking-[1.2px] text-peach"
          >View All</span
        >
      </div>
      <p v-if="history.length === 0" class="text-sm text-muted-foreground">
        No sets logged for this exercise yet.
      </p>
      <div
        v-for="entry in history"
        :key="entry.sessionId"
        class="flex items-center justify-between gap-3 rounded-xl border border-surface-strong bg-card p-4 sm:p-5"
      >
        <div class="min-w-0">
          <p class="mb-1 font-mono text-xs text-muted-foreground">
            {{ formatHistoryDate(entry.date) }} · {{ entry.setsCount }} {{ entry.setsCount === 1 ? "set" : "sets" }}
          </p>
          <!-- Every working set, since weights usually differ set to set; the top set is
               highlighted rather than shown alone. -->
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              v-for="set in entry.sets"
              :key="set.setNumber"
              class="whitespace-nowrap font-heading text-base [font-variant-numeric:tabular-nums]"
              :class="set.weightKg === entry.topSetWeightKg && set.reps === entry.topSetReps ? 'text-foreground' : 'text-muted-foreground'"
            >{{ formatWeight(set.weightKg) }} × {{ set.reps }}</span>
          </div>
        </div>
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-popover"
        >
          <ChevronRightIcon class="size-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  </div>
</template>
