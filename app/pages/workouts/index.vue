<script setup lang="ts">
import { LayoutGridIcon, PlayIcon, TrophyIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { kgToLbs } from "~~/shared/lib/formulas";

const { data: summary, isLoading } = useWorkoutsSummary();
const startSession = useStartSession();
const { data: profileData } = useProfile();
const now = useNow();
const startError = ref<string | null>(null);

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

const startWorkout = async () => {
  startError.value = null;
  const workout = summary.value?.todaysWorkout;
  if (!workout) return;
  try {
    const session = await startSession.mutateAsync({
      splitDayId: workout.splitDayId,
      exercises: workout.exercises.map(exercise => ({
        id: crypto.randomUUID(),
        exerciseId: exercise.exerciseId,
        splitExerciseId: exercise.splitExerciseId,
        position: exercise.position,
        setType: exercise.setType,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        targetRpe: exercise.targetRpe,
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
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">Today</span>
      <p class="font-heading text-2xl font-semibold text-foreground">{{ summary.todaysWorkout.dayName }}</p>
      <ul class="space-y-1 text-sm text-muted-foreground">
        <li v-for="exercise in summary.todaysWorkout.exercises" :key="exercise.splitExerciseId">
          {{ exercise.exerciseName }}
          <span v-if="exercise.targetSets">— {{ exercise.targetSets }}×{{ exercise.targetReps }}</span>
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
  </div>
  <div v-else class="px-4 py-4 text-muted-foreground">Loading...</div>
</template>
