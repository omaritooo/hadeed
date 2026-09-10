<script setup lang="ts">
import { DumbbellIcon, LayoutGridIcon, PlayIcon, SettingsIcon, TrophyIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { kgToLbs } from "~~/shared/lib/formulas";
import type { VolumeBand } from "~~/shared/types/workouts.types";
import { WEEKLY_VOLUME_HIGH_THRESHOLD } from "~~/shared/types/workouts.types";

const { data: summary, isLoading } = useWorkoutsSummary();
const { data: weeklyVolume } = useWeeklyVolume();
const startSession = useStartSession();
const { data: profileData } = useProfile();
const now = useNow();
const startError = ref<string | null>(null);

const infoDrawerOpen = ref(false);
const infoExerciseId = ref("");
const openInfo = (exerciseId: string) => {
  infoExerciseId.value = exerciseId;
  infoDrawerOpen.value = true;
};

const formatWeight = (weightKg: number): string => {
  if (profileData.value?.profile?.unitSystem === "imperial") {
    return `${Math.round(kgToLbs(weightKg))} lbs`;
  }
  return `${Math.round(weightKg)} kg`;
};

const volumeBandStyles: Record<VolumeBand, { bar: string; text: string; label: string }> = {
  low: { bar: "bg-muted-foreground", text: "text-muted-foreground", label: "Low" },
  optimal: { bar: "bg-lime", text: "text-lime", label: "Optimal" },
  high: { bar: "bg-destructive", text: "text-destructive", label: "High" },
};

const volumeProgress = (setCount: number): number =>
  Math.min(100, (setCount / WEEKLY_VOLUME_HIGH_THRESHOLD) * 100);

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

const startWorkout = async () => {
  startError.value = null;
  const workout = summary.value?.todaysWorkout;
  if (!workout) return;
  try {
    const session = await startSession.mutateAsync({
      splitDayId: workout.splitDayId,
      format: workout.format,
      rounds: workout.rounds,
      exercises: workout.exercises.map(exercise => ({
        id: crypto.randomUUID(),
        exerciseId: exercise.exerciseId,
        splitExerciseId: exercise.splitExerciseId,
        position: exercise.position,
        setType: exercise.setType,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        targetRpe: exercise.targetRpe,
        restSeconds: exercise.restSeconds,
      })),
    });
    await navigateTo(`/workouts/session/${session.id}`);
  } catch {
    startError.value = "Couldn't start the workout. Please try again.";
  }
};

const resumeWorkout = async () => {
  const sessionId = summary.value?.activeSession?.sessionId;
  if (!sessionId) return;
  await navigateTo(`/workouts/session/${sessionId}`);
};
</script>

<template>
  <div class="px-4 py-4 flex flex-col gap-y-4" v-if="!isLoading">
    <span class="font-mono text-muted-foreground">{{ useDateFormat(now, "MMM DD, YYYY") }}</span>
    <h1 class="font-heading text-3xl font-semibold text-foreground">Workouts</h1>

    <UiCard v-if="summary?.activeSession" class="space-y-3">
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">In Progress</span>
      <p class="font-heading text-2xl font-semibold text-foreground">
        {{ summary.todaysWorkout?.dayName ?? "Freeform Workout" }}
      </p>
      <p class="text-sm text-muted-foreground">{{ summary.activeSession.setsLogged }} sets logged</p>
      <Button size="lg" class="w-full" @click="resumeWorkout">
        <PlayIcon class="size-4" />
        Continue Workout
      </Button>
    </UiCard>

    <UiCard v-else-if="summary?.todaysWorkout" class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">Today</span>
        <NuxtLink :to="`/builder/edit/${summary.todaysWorkout.blockId}`" class="text-muted-foreground" aria-label="Edit split">
          <SettingsIcon class="size-4" />
        </NuxtLink>
      </div>
      <p class="font-heading text-2xl font-semibold text-foreground">{{ summary.todaysWorkout.dayName }}</p>
      <ul class="space-y-2">
        <li
          v-for="exercise in summary.todaysWorkout.exercises"
          :key="exercise.splitExerciseId"
          class="flex cursor-pointer items-center gap-3 rounded-xl border border-surface-strong bg-card p-3"
          @click="openInfo(exercise.exerciseId)"
        >
          <div class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-popover">
            <NuxtImg v-if="exercise.thumbnailUrl" :src="exercise.thumbnailUrl" class="size-full object-cover" />
            <DumbbellIcon v-else class="size-5 text-muted-foreground" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-semibold text-foreground">{{ exercise.exerciseName }}</p>
              <UiBadge
                v-if="exercise.primaryMuscle"
                class="shrink-0 rounded-full bg-popover px-2 py-0.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
              >
                {{ exercise.primaryMuscle }}
              </UiBadge>
            </div>
            <p class="text-xs text-muted-foreground">
              <span v-if="exercise.targetSets">{{ exercise.targetSets }}×{{ exercise.targetReps }}</span>
              <template v-if="exercise.lastPerformed">
                · Last: {{ formatWeight(exercise.lastPerformed.weightKg) }} × {{ exercise.lastPerformed.reps }}
                ({{ formatHistoryDate(exercise.lastPerformed.date) }})
              </template>
            </p>
          </div>
        </li>
      </ul>
      <Button size="lg" class="w-full" :disabled="startSession.isLoading.value" @click="startWorkout">
        <PlayIcon class="size-4" />
        Start Workout
      </Button>
      <p v-if="startError" class="text-sm text-destructive">{{ startError }}</p>
    </UiCard>

    <UiCard v-else class="space-y-3">
      <p class="font-heading text-xl text-foreground">No active program</p>
      <p class="text-sm text-muted-foreground">Set up a training split to see today's workout here.</p>
      <Button size="lg" variant="secondary" class="w-full" as-child>
        <NuxtLink to="/builder">
          <LayoutGridIcon class="size-4" />
          Build a Program
        </NuxtLink>
      </Button>
    </UiCard>

    <UiCard v-if="weeklyVolume?.length" class="space-y-3">
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">Weekly Volume</span>
      <div v-for="muscle in weeklyVolume" :key="muscle.muscleName" class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold capitalize text-foreground">{{ muscle.muscleName }}</span>
          <span class="flex items-center gap-2">
            <span
              class="font-mono text-[10px] font-bold uppercase tracking-[1px]"
              :class="volumeBandStyles[muscle.band].text"
            >
              {{ volumeBandStyles[muscle.band].label }}
            </span>
            <span class="font-mono text-xs text-muted-foreground">{{ muscle.setCount }} sets</span>
          </span>
        </div>
        <UiProgress
          :model-value="volumeProgress(muscle.setCount)"
          class="h-1.5 bg-muted"
          :indicator-class="volumeBandStyles[muscle.band].bar"
        />
      </div>
    </UiCard>

    <div v-if="summary?.recentPrs.length" class="space-y-2">
      <h2 class="font-heading text-lg uppercase text-foreground">Recent PRs</h2>
      <div class="flex gap-3 overflow-x-auto pb-1">
        <UiCard
          v-for="pr in summary.recentPrs"
          :key="`${pr.exerciseName}-${pr.achievedAt}`"
          class="flex w-44 shrink-0 items-center gap-3"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <TrophyIcon class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-foreground">{{ pr.exerciseName }}</p>
            <p class="text-xs text-muted-foreground">{{ pr.weightKg }}kg × {{ pr.reps }}</p>
          </div>
        </UiCard>
      </div>
    </div>

    <div v-if="summary?.recentSessions.length" class="space-y-2">
      <h2 class="font-heading text-lg uppercase text-foreground">Recent Sessions</h2>
      <UiCard v-for="session in summary.recentSessions" :key="session.sessionId" class="space-y-1">
        <div class="flex items-start justify-between">
          <p class="font-heading text-lg text-foreground">{{ session.dayName ?? "Freeform Workout" }}</p>
          <span v-if="session.durationMinutes" class="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {{ Math.round(session.durationMinutes) }}m
          </span>
        </div>
        <p class="text-sm text-muted-foreground">
          {{ formatHistoryDate(session.completedAt) }}
          <template v-if="session.topExerciseName">
            • Top Lift: {{ formatWeight(session.topWeightKg ?? 0) }} {{ session.topExerciseName }}
          </template>
        </p>
      </UiCard>
    </div>

    <ExerciseDetailDrawer v-model:open="infoDrawerOpen" :exercise-id="infoExerciseId" />
  </div>
  <div v-else class="px-4 py-4 text-muted-foreground">Loading...</div>
</template>
