<script setup lang="ts">
import { CheckIcon, InfoIcon, Trash2Icon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SetLog } from "~~/shared/types/session.types";

const route = useRoute();
const sessionId = computed(() => route.params.id as string);

const { data: session, refetch, isLoading } = useSession(sessionId);
const logSet = useLogSet();
const completeSession = useCompleteSession();
const editSetLog = useEditSetLog();
const deleteSetLog = useDeleteSetLog();

const { data: profile } = useProfile();
const unitSystem = computed(() => profile.value?.profile?.unitSystem ?? "metric");

const now = useNow({ interval: 1000 });
const elapsed = computed(() => {
  if (!session.value) return "0:00";
  const startedAt = new Date(`${session.value.startedAt.replace(" ", "T")}Z`);
  const totalSeconds = Math.max(0, Math.floor((now.value.getTime() - startedAt.getTime()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

const drafts = reactive<Record<string, { weightKg: string, reps: string, rpe: string, isWarmup: boolean }>>({});
const draftFor = (exerciseLogId: string) => {
  drafts[exerciseLogId] ??= { weightKg: "", reps: "", rpe: "", isWarmup: false };
  return drafts[exerciseLogId];
};

// Per-exercise "last time" reference. useExerciseHistory doesn't support
// batching multiple exercise IDs in one request, and a session typically has
// a handful of exercises, so one query per exercise (memoized here) is an
// acceptable cost — the info drawer already does this same per-exercise
// fetch on open.
const exerciseHistoryQueries = new Map<string, ReturnType<typeof useExerciseHistory>>();
watch(
  () => session.value?.exercises.map(exercise => exercise.exerciseId) ?? [],
  (exerciseIds) => {
    for (const exerciseId of exerciseIds) {
      if (!exerciseHistoryQueries.has(exerciseId)) {
        exerciseHistoryQueries.set(exerciseId, useExerciseHistory(exerciseId));
      }
    }
  },
  { immediate: true },
);

const formatTarget = (targetSets: number | null, targetReps: number | null, targetRpe: number | null) => {
  if (targetSets === null && targetReps === null && targetRpe === null) return null;
  const setsReps = `${targetSets ?? "–"}×${targetReps ?? "–"}`;
  return targetRpe === null ? `Target: ${setsReps}` : `Target: ${setsReps} @ RPE ${targetRpe}`;
};

const formatLastPerformance = (exerciseId: string) => {
  const lastEntry = exerciseHistoryQueries.get(exerciseId)?.data.value?.history[0];
  if (!lastEntry) return null;
  return `Last: ${lastEntry.topSetWeightKg}kg × ${lastEntry.topSetReps}`;
};

const formatSetsProgress = (loggedSets: number, targetSets: number | null) => {
  return targetSets === null ? `${loggedSets} sets` : `${loggedSets}/${targetSets} sets`;
};

// Batched exercise metadata (currently just `equipment`, needed to gate the plate calculator to
// barbell exercises) for every exercise in the session. useExercisesByIds resolves them all in
// one request rather than one per exercise — this page can have several, and a per-exercise
// query here (like the useExerciseHistory one above) would be an avoidable N+1.
const sessionExerciseIds = computed(() => [...new Set(session.value?.exercises.map(exercise => exercise.exerciseId) ?? [])]);
const { data: sessionExerciseDetails } = useExercisesByIds(sessionExerciseIds);
const equipmentByExerciseId = computed(() => {
  const map = new Map<string, string | null>();
  for (const exercise of sessionExerciseDetails.value ?? []) map.set(exercise.id, exercise.equipment);
  return map;
});

const exerciseDisplayInfo = computed(() => {
  return (session.value?.exercises ?? []).map(exercise => ({
    ...exercise,
    targetLabel: formatTarget(exercise.targetSets, exercise.targetReps, exercise.targetRpe),
    lastPerformanceLabel: formatLastPerformance(exercise.exerciseId),
    setsProgressLabel: formatSetsProgress(exercise.sets.length, exercise.targetSets),
    isBarbell: equipmentByExerciseId.value.get(exercise.exerciseId) === "barbell",
  }));
});

const draftWeightKgNumber = (exerciseLogId: string) => {
  const parsed = Number(draftFor(exerciseLogId).weightKg);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Circuit-format sessions ("Round 1 of 4" cycling through every exercise in order) present as a
// state machine, but that state is derived from the logged sets rather than tracked in local
// refs — a page refresh, or simply the query refetch that follows every logged set, always
// reflects the true position with no local state to fall out of sync.
const isCircuitSession = computed(() => session.value?.format === "circuit");

// Fully-completed rounds: the fewest sets any circuit exercise has logged so far. Once every
// exercise has at least this many sets, that round is done.
const circuitRoundsCompleted = computed(() => {
  const exercises = session.value?.exercises ?? [];
  if (exercises.length === 0) return 0;
  return Math.min(...exercises.map(exercise => exercise.sets.length));
});

const circuitComplete = computed(() => {
  if (!session.value || session.value.exercises.length === 0) return false;
  return circuitRoundsCompleted.value >= session.value.rounds;
});

const circuitCurrentRound = computed(() => {
  if (!session.value) return 1;
  return Math.min(circuitRoundsCompleted.value + 1, session.value.rounds);
});

// The first exercise (in split-day order) that hasn't yet logged a set for the round in
// progress — i.e. whose set count still equals the number of fully-completed rounds.
const circuitCurrentExerciseIndex = computed(() => {
  if (circuitComplete.value) return -1;
  const exercises = session.value?.exercises ?? [];
  const index = exercises.findIndex(exercise => exercise.sets.length === circuitRoundsCompleted.value);
  return index === -1 ? 0 : index;
});

const infoDrawerOpen = ref(false);
const infoExerciseId = ref("");
const openInfo = (exerciseId: string) => {
  infoExerciseId.value = exerciseId;
  infoDrawerOpen.value = true;
};

const finishError = ref<string | null>(null);
const logErrors = reactive<Record<string, string | null>>({});

const REST_FALLBACK_SECONDS = 90;
const restTimerKey = ref(0);
const restTimerDuration = ref<number | null>(null);
const startRestTimer = (exerciseLogId: string) => {
  const exercise = session.value?.exercises.find(e => e.id === exerciseLogId);
  restTimerDuration.value = exercise?.restSeconds ?? REST_FALLBACK_SECONDS;
  restTimerKey.value += 1;
};
const dismissRestTimer = () => {
  restTimerDuration.value = null;
};

const editingSetId = ref<string | null>(null);
const editError = ref<string | null>(null);
const editDrafts = reactive<Record<string, { weightKg: string, reps: string, rpe: string, isWarmup: boolean }>>({});
// Only ever read from the template while editingSetId === set.id, i.e. after startEdit has
// populated this set's draft — the fallback here just satisfies noUncheckedIndexedAccess.
const editDraftFor = (setId: string) => editDrafts[setId] ?? { weightKg: "", reps: "", rpe: "", isWarmup: false };

const startEdit = (set: SetLog) => {
  editingSetId.value = set.id;
  editError.value = null;
  editDrafts[set.id] = {
    weightKg: set.weightKg === null ? "" : String(set.weightKg),
    reps: set.reps === null ? "" : String(set.reps),
    rpe: set.rpe === null ? "" : String(set.rpe),
    isWarmup: set.isWarmup,
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
      isWarmup: draft.isWarmup,
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

const deleteErrors = reactive<Record<string, string | null>>({});
const deleteSet = async (set: SetLog) => {
  if (!confirm("Delete this set? This can't be undone.")) return;
  deleteErrors[set.id] = null;
  try {
    await deleteSetLog.mutateAsync({ sessionId: sessionId.value, setLogId: set.id });
  } catch {
    deleteErrors[set.id] = "Couldn't delete that set. Please try again.";
  }
};

const submitSet = async (exerciseLogId: string, values: { weightKg: string, reps: string, rpe: string, isWarmup: boolean }) => {
  const exercise = session.value?.exercises.find(e => e.id === exerciseLogId);
  if (!exercise) return false;
  logErrors[exerciseLogId] = null;
  try {
    await logSet.mutateAsync({
      sessionId: sessionId.value,
      exerciseLogId,
      setNumber: exercise.sets.length + 1,
      weightKg: values.weightKg === "" ? null : Number(values.weightKg),
      reps: values.reps === "" ? null : Number(values.reps),
      rpe: values.rpe === "" ? null : Number(values.rpe),
      isWarmup: values.isWarmup,
    });
    return true;
  } catch {
    logErrors[exerciseLogId] = "Couldn't log that set. Please try again.";
    return false;
  }
};

const logNextSet = async (exerciseLogId: string) => {
  const draft = draftFor(exerciseLogId);
  const success = await submitSet(exerciseLogId, draft);
  if (success) {
    draft.weightKg = "";
    draft.reps = "";
    draft.rpe = "";
    draft.isWarmup = false;
    startRestTimer(exerciseLogId);
  }
};

const logSameAsLast = async (exerciseLogId: string) => {
  const exercise = session.value?.exercises.find(e => e.id === exerciseLogId);
  if (!exercise) return;
  const lastSet = exercise.sets[exercise.sets.length - 1];
  if (!lastSet) return;
  const draft = draftFor(exerciseLogId);
  draft.weightKg = lastSet.weightKg === null ? "" : String(lastSet.weightKg);
  draft.reps = lastSet.reps === null ? "" : String(lastSet.reps);
  draft.rpe = lastSet.rpe === null ? "" : String(lastSet.rpe);
  draft.isWarmup = lastSet.isWarmup;
  await logNextSet(exerciseLogId);
};

const finish = async () => {
  if (!session.value) return;
  const hasSkippedExercises = session.value.exercises.some(exercise => exercise.sets.length === 0);
  if (hasSkippedExercises && !confirm("Some exercises have no logged sets. Finish anyway?")) return;
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

    <SessionRestTimer
      v-if="restTimerDuration !== null"
      :key="restTimerKey"
      :duration-seconds="restTimerDuration"
      @dismiss="dismissRestTimer"
    />

    <template v-if="!isCircuitSession">
    <UiCard v-for="exercise in exerciseDisplayInfo" :key="exercise.id" class="space-y-3">
      <div class="space-y-1 border-b border-surface-strong pb-3">
        <div class="flex items-center justify-between">
          <p class="font-heading text-lg text-foreground">{{ exercise.exerciseName ?? exercise.exerciseId }}</p>
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">{{ exercise.setsProgressLabel }}</span>
            <button @click="openInfo(exercise.exerciseId)"><InfoIcon class="size-4 text-muted-foreground" /></button>
          </div>
        </div>
        <div
          v-if="exercise.targetLabel || exercise.lastPerformanceLabel"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
        >
          <span v-if="exercise.targetLabel">{{ exercise.targetLabel }}</span>
          <span v-if="exercise.lastPerformanceLabel">{{ exercise.lastPerformanceLabel }}</span>
        </div>
      </div>

      <div class="space-y-2">
        <div v-for="set in exercise.sets" :key="set.id" class="space-y-1">
          <div v-if="editingSetId === set.id" class="space-y-1.5">
            <label class="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              Warm-up
              <UiCheckbox
                :model-value="editDraftFor(set.id).isWarmup"
                @update:model-value="(value) => (editDraftFor(set.id).isWarmup = !!value)"
              />
            </label>
            <div class="flex items-center gap-2">
              <span class="w-6 shrink-0 text-sm text-muted-foreground">{{ set.setNumber }}</span>
              <div class="flex flex-1 flex-wrap items-center justify-end gap-1">
                <UiNumberStepper v-model="editDraftFor(set.id).weightKg" :step="2.5" placeholder="kg" />
                <UiNumberStepper v-model="editDraftFor(set.id).reps" :step="1" placeholder="reps" />
                <Input v-model="editDraftFor(set.id).rpe" type="number" placeholder="RPE" class="w-12 shrink-0 text-right text-sm" />
              </div>
              <Button size="icon-lg" class="shrink-0 rounded-full" :disabled="editSetLog.isLoading.value" @click="saveEdit(set)">
                <CheckIcon class="size-4" />
              </Button>
            </div>
            <button class="block w-full text-right text-xs text-muted-foreground underline" @click="cancelEdit">Cancel</button>
          </div>
          <div v-else class="flex w-full items-center gap-1">
            <button
              class="flex flex-1 items-center gap-2 text-left text-sm"
              :class="set.isWarmup ? 'text-muted-foreground/50' : 'text-muted-foreground'"
              @click="startEdit(set)"
            >
              <span class="w-6 shrink-0">{{ set.setNumber }}</span>
              <UiBadge
                v-if="set.isWarmup"
                class="shrink-0 rounded-full bg-popover px-1.5 py-0 font-mono text-[9px] font-bold uppercase tracking-[1px] text-muted-foreground"
              >
                W
              </UiBadge>
              <span class="flex flex-1 items-center justify-end gap-1">
                <span class="w-16 shrink-0 whitespace-nowrap text-right">{{ set.weightKg ?? "–" }}kg</span>
                <span class="w-16 shrink-0 whitespace-nowrap text-right">{{ set.reps ?? "–" }} reps</span>
                <span class="w-16 shrink-0 whitespace-nowrap text-right">{{ set.rpe ? `RPE ${set.rpe}` : "RPE –" }}</span>
              </span>
            </button>
            <button
              class="shrink-0 p-1 text-muted-foreground/70"
              :disabled="deleteSetLog.isLoading.value"
              aria-label="Delete set"
              @click="deleteSet(set)"
            >
              <Trash2Icon class="size-3.5" />
            </button>
          </div>
          <p v-if="editingSetId === set.id && editError" class="text-sm text-destructive">{{ editError }}</p>
          <p v-if="deleteErrors[set.id]" class="text-sm text-destructive">{{ deleteErrors[set.id] }}</p>
        </div>
      </div>

      <div class="border-t border-surface-strong pt-3">
        <button
          v-if="exercise.sets.length > 0"
          class="mb-2 block w-full text-right text-xs text-muted-foreground underline"
          :disabled="logSet.isLoading.value"
          @click="logSameAsLast(exercise.id)"
        >
          Same as last set
        </button>
        <label class="mb-2 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
          Warm-up
          <UiCheckbox
            :model-value="draftFor(exercise.id).isWarmup"
            @update:model-value="(value) => (draftFor(exercise.id).isWarmup = !!value)"
          />
        </label>
        <div class="flex items-center gap-2">
          <span class="w-6 shrink-0 text-sm font-semibold text-foreground">{{ exercise.sets.length + 1 }}</span>
          <div class="flex flex-1 flex-wrap items-center justify-end gap-1">
            <UiNumberStepper v-model="draftFor(exercise.id).weightKg" :step="2.5" placeholder="kg" />
            <UiNumberStepper v-model="draftFor(exercise.id).reps" :step="1" placeholder="reps" />
            <Input v-model="draftFor(exercise.id).rpe" type="number" placeholder="RPE" class="w-12 shrink-0 text-right text-sm" />
          </div>
          <SessionPlateCalculator
            v-if="exercise.isBarbell"
            :target-weight-kg="draftWeightKgNumber(exercise.id)"
            :unit-system="unitSystem"
          />
          <Button size="icon-lg" class="shrink-0 rounded-full" :disabled="logSet.isLoading.value" @click="logNextSet(exercise.id)">
            <CheckIcon class="size-4" />
          </Button>
        </div>
      </div>
      <p v-if="logErrors[exercise.id]" class="text-sm text-destructive">{{ logErrors[exercise.id] }}</p>
    </UiCard>
    </template>

    <template v-else>
      <UiCard v-if="exerciseDisplayInfo.length === 0" class="space-y-1">
        <p class="text-sm text-muted-foreground">No exercises in this circuit.</p>
      </UiCard>
      <UiCard v-else class="space-y-3">
        <div class="flex items-center justify-between border-b border-surface-strong pb-3">
          <p class="font-heading text-lg text-foreground">
            {{ circuitComplete ? "Circuit complete" : `Round ${circuitCurrentRound} of ${session.rounds}` }}
          </p>
          <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">
            {{ circuitRoundsCompleted }}/{{ session.rounds }} rounds
          </span>
        </div>

        <div class="space-y-2">
          <div
            v-for="(exercise, index) in exerciseDisplayInfo"
            :key="exercise.id"
            class="rounded-lg border p-3"
            :class="index === circuitCurrentExerciseIndex ? 'border-foreground' : 'border-surface-strong opacity-60'"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <span class="shrink-0 font-mono text-xs text-muted-foreground">{{ index + 1 }}.</span>
                <p class="truncate text-sm font-medium text-foreground">{{ exercise.exerciseName ?? exercise.exerciseId }}</p>
                <button class="shrink-0" @click="openInfo(exercise.exerciseId)"><InfoIcon class="size-3.5 text-muted-foreground" /></button>
              </div>
              <span class="shrink-0 font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">
                {{ exercise.sets.length }}/{{ session.rounds }}
              </span>
            </div>
            <p
              v-if="exercise.targetLabel || exercise.lastPerformanceLabel"
              class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
            >
              <span v-if="exercise.targetLabel">{{ exercise.targetLabel }}</span>
              <span v-if="exercise.lastPerformanceLabel">{{ exercise.lastPerformanceLabel }}</span>
            </p>

            <div v-if="!circuitComplete && index === circuitCurrentExerciseIndex" class="mt-3 border-t border-surface-strong pt-3">
              <label class="mb-2 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                Warm-up
                <UiCheckbox
                  :model-value="draftFor(exercise.id).isWarmup"
                  @update:model-value="(value) => (draftFor(exercise.id).isWarmup = !!value)"
                />
              </label>
              <div class="flex items-center gap-2">
                <span class="w-6 shrink-0 text-sm font-semibold text-foreground">{{ circuitCurrentRound }}</span>
                <div class="flex flex-1 flex-wrap items-center justify-end gap-1">
                  <UiNumberStepper v-model="draftFor(exercise.id).weightKg" :step="2.5" placeholder="kg" />
                  <UiNumberStepper v-model="draftFor(exercise.id).reps" :step="1" placeholder="reps" />
                  <Input v-model="draftFor(exercise.id).rpe" type="number" placeholder="RPE" class="w-12 shrink-0 text-right text-sm" />
                </div>
                <SessionPlateCalculator
                  v-if="exercise.isBarbell"
                  :target-weight-kg="draftWeightKgNumber(exercise.id)"
                  :unit-system="unitSystem"
                />
                <Button size="icon-lg" class="shrink-0 rounded-full" :disabled="logSet.isLoading.value" @click="logNextSet(exercise.id)">
                  <CheckIcon class="size-4" />
                </Button>
              </div>
              <p v-if="logErrors[exercise.id]" class="mt-1 text-sm text-destructive">{{ logErrors[exercise.id] }}</p>
            </div>
          </div>
        </div>

        <p v-if="circuitComplete" class="text-sm text-muted-foreground">
          All {{ session.rounds }} rounds complete — hit Finish above when you're done.
        </p>
      </UiCard>
    </template>

    <ExerciseDetailDrawer v-model:open="infoDrawerOpen" :exercise-id="infoExerciseId" />
  </div>
  <div v-else-if="isLoading" class="px-4 py-4 text-muted-foreground">Loading...</div>
  <div v-else class="flex flex-col gap-y-2 px-4 py-4">
    <p class="text-sm text-destructive">Couldn't load this session.</p>
    <NuxtLink to="/workouts" class="text-sm text-muted-foreground underline">Back to Workouts</NuxtLink>
  </div>
</template>
