<script setup lang="ts">
import { CheckIcon, InfoIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SetLog } from "~~/shared/types/session.types";

const route = useRoute();
const sessionId = computed(() => route.params.id as string);

const { data: session, refetch, isLoading } = useSession(sessionId);
const logSet = useLogSet();
const completeSession = useCompleteSession();
const editSetLog = useEditSetLog();

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

const editingSetId = ref<string | null>(null);
const editError = ref<string | null>(null);
const editDrafts = reactive<Record<string, { weightKg: string, reps: string, rpe: string }>>({});

const startEdit = (set: SetLog) => {
  editingSetId.value = set.id;
  editError.value = null;
  editDrafts[set.id] = {
    weightKg: set.weightKg === null ? "" : String(set.weightKg),
    reps: set.reps === null ? "" : String(set.reps),
    rpe: set.rpe === null ? "" : String(set.rpe),
  };
};

const cancelEdit = () => {
  editingSetId.value = null;
  editError.value = null;
};

const saveEdit = async (set: SetLog) => {
  const draft = editDrafts[set.id];
  if (!draft) return;
  editError.value = null;
  try {
    await editSetLog.mutateAsync({
      sessionId: sessionId.value,
      setLogId: set.id,
      expectedVersion: set.version,
      weightKg: draft.weightKg === "" ? null : Number(draft.weightKg),
      reps: draft.reps === "" ? null : Number(draft.reps),
      rpe: draft.rpe === "" ? null : Number(draft.rpe),
    });
    editingSetId.value = null;
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 409) {
      editError.value = "This set was updated elsewhere — refreshing.";
      await refetch();
    } else {
      editError.value = "Couldn't save that correction. Please try again.";
    }
  }
};

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
    if (statusCode === 409) {
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
      <div class="flex items-center justify-between border-b border-surface-strong pb-3">
        <p class="font-heading text-lg text-foreground">{{ exercise.exerciseName ?? exercise.exerciseId }}</p>
        <button @click="openInfo(exercise.exerciseId)"><InfoIcon class="size-4 text-muted-foreground" /></button>
      </div>

      <div class="space-y-2">
        <div v-for="set in exercise.sets" :key="set.id" class="space-y-1">
          <div v-if="editingSetId === set.id" class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="w-6 shrink-0 text-sm text-muted-foreground">{{ set.setNumber }}</span>
              <div class="flex flex-1 items-center justify-end gap-1">
                <Input v-model="editDrafts[set.id].weightKg" type="number" placeholder="kg" class="w-16 shrink-0 text-right text-sm" />
                <Input v-model="editDrafts[set.id].reps" type="number" placeholder="reps" class="w-12 shrink-0 text-right text-sm" />
                <Input v-model="editDrafts[set.id].rpe" type="number" placeholder="RPE" class="w-12 shrink-0 text-right text-sm" />
              </div>
              <Button size="icon-lg" class="shrink-0 rounded-full" :disabled="editSetLog.isLoading.value" @click="saveEdit(set)">
                <CheckIcon class="size-4" />
              </Button>
            </div>
            <button class="block w-full text-right text-xs text-muted-foreground underline" @click="cancelEdit">Cancel</button>
          </div>
          <button
            v-else
            class="flex w-full items-center gap-2 text-left text-sm text-muted-foreground"
            @click="startEdit(set)"
          >
            <span class="w-6 shrink-0">{{ set.setNumber }}</span>
            <span class="flex flex-1 items-center justify-end gap-1">
              <span class="w-16 shrink-0 whitespace-nowrap text-right">{{ set.weightKg ?? "–" }}kg</span>
              <span class="w-16 shrink-0 whitespace-nowrap text-right">{{ set.reps ?? "–" }} reps</span>
              <span class="w-16 shrink-0 whitespace-nowrap text-right">{{ set.rpe ? `RPE ${set.rpe}` : "RPE –" }}</span>
            </span>
          </button>
          <p v-if="editingSetId === set.id && editError" class="text-sm text-destructive">{{ editError }}</p>
        </div>
      </div>

      <div class="flex items-center gap-2 border-t border-surface-strong pt-3">
        <span class="w-6 shrink-0 text-sm font-semibold text-foreground">{{ exercise.sets.length + 1 }}</span>
        <div class="flex flex-1 items-center justify-end gap-1">
          <Input v-model="draftFor(exercise.id).weightKg" type="number" placeholder="kg" class="w-16 shrink-0 text-right text-sm" />
          <Input v-model="draftFor(exercise.id).reps" type="number" placeholder="reps" class="w-12 shrink-0 text-right text-sm" />
          <Input v-model="draftFor(exercise.id).rpe" type="number" placeholder="RPE" class="w-12 shrink-0 text-right text-sm" />
        </div>
        <Button size="icon-lg" class="shrink-0 rounded-full" :disabled="logSet.isLoading.value" @click="logNextSet(exercise.id)">
          <CheckIcon class="size-4" />
        </Button>
      </div>
      <p v-if="logErrors[exercise.id]" class="text-sm text-destructive">{{ logErrors[exercise.id] }}</p>
    </UiCard>

    <ExerciseDetailDrawer v-model:open="infoDrawerOpen" :exercise-id="infoExerciseId" />
  </div>
  <div v-else-if="isLoading" class="px-4 py-4 text-muted-foreground">Loading...</div>
  <div v-else class="flex flex-col gap-y-2 px-4 py-4">
    <p class="text-sm text-destructive">Couldn't load this session.</p>
    <NuxtLink to="/workouts" class="text-sm text-muted-foreground underline">Back to Workouts</NuxtLink>
  </div>
</template>
