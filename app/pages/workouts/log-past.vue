<script setup lang="ts">
import { ArrowLeftIcon, TrashIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { kgToLbs, lbsToKg } from "~~/shared/lib/formulas";
import { PAST_SESSION_MAX_DAYS } from "~~/shared/lib/past-session";
import type { SetType } from "~~/shared/types/split.types";
import type { TodaysWorkoutExercise } from "~~/shared/types/home.types";

// Form drafts are strings (same convention as NumberStepper) and become numbers at submit.
interface Row {
  key: string;
  exerciseId: string;
  exerciseName: string;
  splitExerciseId: number | null;
  setType: SetType;
  targetSets: number | null;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetRpe: number | null;
  sets: string;
  reps: string;
  weight: string;
}

const { data: options, isLoading } = usePastWorkoutOptions();
const { data: profileData } = useProfile();
const logPast = useLogPastSession();

const unitSystem = computed(() => profileData.value?.profile?.unitSystem ?? "metric");
const unitLabel = computed(() => (unitSystem.value === "imperial" ? "lbs" : "kg"));
const toDisplay = (kg: number) => (unitSystem.value === "imperial" ? Math.round(kgToLbs(kg)) : kg);
const toKg = (value: number) => (unitSystem.value === "imperial" ? lbsToKg(value) : value);

const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const dateChoices = Array.from({ length: PAST_SESSION_MAX_DAYS + 1 }, (_, daysBack) => {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  const label = daysBack === 0 ? "Today" : daysBack === 1 ? "Yesterday"
    : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
  return { value: localDate(date), label };
});

// Missed logs are usually from a previous day, so the form opens on yesterday.
const selectedDate = ref(dateChoices[1]!.value);
const selectedDay = ref("freeform");
const rows = ref<Row[]>([]);
// One id per form: a double-tap or retry of Save replays the same session instead of duplicating it.
const sessionId = crypto.randomUUID();
const saveError = ref<string | null>(null);

const rowFromSplit = (exercise: TodaysWorkoutExercise): Row => ({
  key: crypto.randomUUID(),
  exerciseId: exercise.exerciseId,
  exerciseName: exercise.exerciseName,
  splitExerciseId: exercise.splitExerciseId,
  setType: exercise.setType,
  targetSets: exercise.targetSets,
  targetRepsMin: exercise.targetRepsMin,
  targetRepsMax: exercise.targetRepsMax,
  targetRpe: exercise.targetRpe,
  sets: String(exercise.targetSets ?? 3),
  reps: String(exercise.lastPerformed?.reps ?? exercise.targetRepsMin ?? 10),
  weight: exercise.lastPerformed ? String(toDisplay(exercise.lastPerformed.weightKg)) : "",
});

watch(selectedDay, (value) => {
  const day = options.value?.days.find(d => String(d.splitDayId) === value);
  rows.value = day ? day.exercises.map(rowFromSplit) : [];
});

// Add-exercise picker: same combobox + useExerciseSearch pattern as stats.vue.
const picked = ref<string | undefined>(undefined);
const searchTerm = ref("");
const { data: searchResults, isLoading: searching } = useExerciseSearch(searchTerm);
const searchOptions = computed<ComboboxOption[]>(
  () => searchResults.value?.map(exercise => ({ value: exercise.id, label: exercise.name })) ?? [],
);
watch(picked, (id) => {
  if (!id || typeof id !== "string") return;
  const exercise = searchResults.value?.find(e => e.id === id);
  picked.value = undefined;
  searchTerm.value = "";
  if (!exercise) return;
  rows.value = [...rows.value, {
    key: crypto.randomUUID(), exerciseId: exercise.id, exerciseName: exercise.name, splitExerciseId: null,
    setType: "weight_reps", targetSets: null, targetRepsMin: null, targetRepsMax: null, targetRpe: null,
    sets: "3", reps: "10", weight: "",
  }];
});

const removeRow = (key: string) => {
  rows.value = rows.value.filter(row => row.key !== key);
};

const parse = (value: string | number) => (String(value).trim() === "" ? null : Number(value));

const save = async () => {
  saveError.value = null;
  const [year, month, day] = selectedDate.value.split("-").map(Number);
  const now = new Date();
  // The chosen day at the current time of day: the form has no time picker, and the exact hour
  // only affects ordering against other sessions that same day.
  const startedAt = new Date(year!, month! - 1, day!, now.getHours(), now.getMinutes()).toISOString();
  try {
    await logPast.mutateAsync({
      id: sessionId,
      startedAt,
      splitDayId: selectedDay.value === "freeform" ? null : Number(selectedDay.value),
      exercises: rows.value.map((row) => {
        const weight = parse(row.weight);
        return {
          id: crypto.randomUUID(),
          exerciseId: row.exerciseId,
          splitExerciseId: row.splitExerciseId,
          setType: row.setType,
          targetSets: row.targetSets,
          targetRepsMin: row.targetRepsMin,
          targetRepsMax: row.targetRepsMax,
          targetRpe: row.targetRpe,
          sets: parse(row.sets) ?? 0,
          reps: parse(row.reps),
          weightKg: weight === null ? null : toKg(weight),
        };
      }),
    });
    await navigateTo("/workouts");
  } catch (error) {
    const message = (error as { data?: { statusMessage?: string } }).data?.statusMessage;
    saveError.value = message ?? "Couldn't save the workout. Please try again.";
  }
};
</script>

<template>
  <div v-if="!isLoading" class="flex flex-col gap-y-4 px-4 py-4">
    <NuxtLink to="/workouts" class="flex items-center gap-1 text-sm text-muted-foreground">
      <ArrowLeftIcon class="size-4" /> Workouts
    </NuxtLink>
    <h1 class="font-heading text-3xl font-semibold text-foreground">Log a past workout</h1>

    <!-- NativeSelect's wrapper is w-fit; widen it so both selects fill their column. -->
    <UiCard class="grid grid-cols-2 gap-3 **:data-[slot=native-select-wrapper]:w-full">
      <label class="space-y-1.5">
        <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Date</span>
        <NativeSelect v-model="selectedDate">
          <NativeSelectOption v-for="choice in dateChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</NativeSelectOption>
        </NativeSelect>
      </label>
      <label class="space-y-1.5">
        <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Workout</span>
        <NativeSelect v-model="selectedDay">
          <NativeSelectOption value="freeform">Freeform</NativeSelectOption>
          <NativeSelectOption v-for="day in options?.days ?? []" :key="day.splitDayId" :value="String(day.splitDayId)">{{ day.dayName }}</NativeSelectOption>
        </NativeSelect>
      </label>
    </UiCard>

    <UiCard v-for="row in rows" :key="row.key" class="space-y-2">
      <div class="flex items-start justify-between gap-2">
        <p class="font-heading text-lg text-foreground">{{ row.exerciseName }}</p>
        <Button variant="ghost" size="icon" :aria-label="`Remove ${row.exerciseName}`" @click="removeRow(row.key)">
          <TrashIcon class="size-4" />
        </Button>
      </div>
      <!-- UiMetricInput's label is a <p>; wrapping each in <label> gives its input an accessible name. -->
      <div class="grid grid-cols-3 gap-2">
        <label class="min-w-0"><UiMetricInput v-model="row.sets" label="Sets" unit="×" /></label>
        <label v-if="row.setType !== 'time'" class="min-w-0"><UiMetricInput v-model="row.reps" label="Reps" unit="reps" /></label>
        <label v-if="row.setType === 'weight_reps'" class="min-w-0"><UiMetricInput v-model="row.weight" label="Weight" :unit="unitLabel" /></label>
      </div>
    </UiCard>

    <Combobox
      v-model="picked"
      v-model:search-term="searchTerm"
      :items="searchOptions"
      :reset-search-term-on-select="false"
      placeholder="Add an exercise…"
      search-placeholder="Search exercises…"
      :empty-text="searching ? 'Searching…' : 'No results found.'"
    />

    <p v-if="saveError" class="text-sm text-destructive">{{ saveError }}</p>
    <Button size="lg" class="w-full" :disabled="rows.length === 0 || logPast.isLoading.value" @click="save">
      Save workout
    </Button>
  </div>
  <UiLoadingIndicator v-else />
</template>
