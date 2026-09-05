<script setup lang="ts">
import { CheckIcon, InfoIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const route = useRoute();
const sessionId = computed(() => route.params.id as string);

const { data: session, refetch } = useSession(sessionId);
const logSet = useLogSet();
const completeSession = useCompleteSession();

const now = useNow({ interval: 1000 });
const elapsed = computed(() => {
  if (!session.value) return "0:00";
  const startedAt = new Date(`${session.value.startedAt.replace(" ", "T")}Z`);
  const totalSeconds = Math.max(0, Math.floor((now.value.getTime() - startedAt.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

const drafts = reactive<Record<string, { weightKg: string, reps: string, rpe: string }>>({});
const draftFor = (exerciseLogId: string) => {
  drafts[exerciseLogId] ??= { weightKg: "", reps: "", rpe: "" };
  return drafts[exerciseLogId];
};

const infoDrawerOpen = ref(false);
const infoExerciseId = ref("");
const openInfo = (exerciseId: string) => {
  infoExerciseId.value = exerciseId;
  infoDrawerOpen.value = true;
};

const finishError = ref<string | null>(null);
const logErrors = reactive<Record<string, string | null>>({});

const logNextSet = async (exerciseLogId: string) => {
  const exercise = session.value?.exercises.find(e => e.id === exerciseLogId);
  if (!exercise) return;
  const draft = draftFor(exerciseLogId);
  logErrors[exerciseLogId] = null;
  try {
    await logSet.mutateAsync({
      sessionId: sessionId.value,
      exerciseLogId,
      setNumber: exercise.sets.length + 1,
      weightKg: draft.weightKg === "" ? null : Number(draft.weightKg),
      reps: draft.reps === "" ? null : Number(draft.reps),
      rpe: draft.rpe === "" ? null : Number(draft.rpe),
    });
    draft.weightKg = "";
    draft.reps = "";
    draft.rpe = "";
  } catch {
    logErrors[exerciseLogId] = "Couldn't log that set. Please try again.";
  }
};

const finish = async () => {
  if (!session.value) return;
  finishError.value = null;
  try {
    await completeSession.mutateAsync({ sessionId: sessionId.value, expectedVersion: session.value.version });
    await navigateTo("/workouts");
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 422) {
      finishError.value = "Log the remaining target sets before finishing this workout.";
    } else if (statusCode === 409) {
      finishError.value = "This session was updated elsewhere — refreshing.";
    } else {
      finishError.value = "Something went wrong. Please try again.";
    }
    await refetch();
  }
};
</script>

<template>
  <div v-if="session" class="flex flex-col gap-y-4 px-4 py-4">
    <div class="flex items-center justify-between">
      <div>
        <ClientOnly>
          <p class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">{{ elapsed }}</p>
          <template #fallback>
            <p class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">--:--</p>
          </template>
        </ClientOnly>
        <h1 class="font-heading text-2xl font-semibold text-foreground">
          {{ session.splitDayId ? "Workout" : "Freeform Workout" }}
        </h1>
      </div>
      <Button :disabled="completeSession.isLoading.value" @click="finish">Finish</Button>
    </div>

    <p v-if="finishError" class="text-sm text-destructive">{{ finishError }}</p>

    <UiCard v-for="exercise in session.exercises" :key="exercise.id" class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="font-heading text-lg text-foreground">{{ exercise.exerciseName ?? exercise.exerciseId }}</p>
        <button @click="openInfo(exercise.exerciseId)"><InfoIcon class="size-4 text-muted-foreground" /></button>
      </div>

      <div v-for="set in exercise.sets" :key="set.id" class="flex items-center gap-3 text-sm text-muted-foreground">
        <span class="w-6">{{ set.setNumber }}</span>
        <span>{{ set.weightKg ?? "–" }}kg</span>
        <span>{{ set.reps ?? "–" }} reps</span>
        <span v-if="set.rpe">RPE {{ set.rpe }}</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="w-6 text-sm text-muted-foreground">{{ exercise.sets.length + 1 }}</span>
        <Input v-model="draftFor(exercise.id).weightKg" type="number" placeholder="kg" class="w-20" />
        <Input v-model="draftFor(exercise.id).reps" type="number" placeholder="reps" class="w-20" />
        <Input v-model="draftFor(exercise.id).rpe" type="number" placeholder="RPE" class="w-16" />
        <Button size="icon" :disabled="logSet.isLoading.value" @click="logNextSet(exercise.id)">
          <CheckIcon class="size-4" />
        </Button>
      </div>
      <p v-if="logErrors[exercise.id]" class="text-sm text-destructive">{{ logErrors[exercise.id] }}</p>
    </UiCard>

    <ExerciseDetailDrawer v-model:open="infoDrawerOpen" :exercise-id="infoExerciseId" />
  </div>
</template>
