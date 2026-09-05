<script setup lang="ts">
import { PlayIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

const { data: summary, isLoading } = useWorkoutsSummary();
const startSession = useStartSession();

const startWorkout = async () => {
  const workout = summary.value?.todaysWorkout;
  if (!workout) return;
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
};

const resumeWorkout = async () => {
  const sessionId = summary.value?.activeSession?.sessionId;
  if (!sessionId) return;
  await navigateTo(`/workouts/session/${sessionId}`);
};
</script>

<template>
  <div class="px-4 py-4 flex flex-col gap-y-4" v-if="!isLoading">
    <span class="font-mono text-muted-foreground">{{ useDateFormat(useNow(), "MMM DD, YYYY") }}</span>
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
    </UiCard>

    <UiCard v-else class="space-y-2">
      <p class="font-heading text-xl text-foreground">No active program</p>
      <p class="text-sm text-muted-foreground">Set up a training split to see today's workout here.</p>
    </UiCard>
  </div>
</template>
