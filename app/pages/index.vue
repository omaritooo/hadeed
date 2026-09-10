<script setup lang="ts">
import {
  DropletIcon,
  FlameIcon,
  HistoryIcon,
  PlayIcon,
  PlusIcon,
  StarIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UtensilsIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kgToLbs } from "~~/shared/lib/formulas";

const HYDRATION_PRESETS_ML = [250, 500, 750] as const;
const HYDRATION_UNDO_WINDOW_MS = 5000;

definePageMeta({});
const { data: profile, isLoading, isPending } = useProfile();
const { data: stats } = useHomeStats();
const startSession = useStartSession();
const startError = ref<string | null>(null);
const now = useNow();
const timeOfDay = computed(() => {
  if (now.value.getHours() >= 5 && now.value.getHours() <= 11) return `Good Morning, `;
  else if (now.value.getHours() >= 12 && now.value.getHours() <= 17)
    return `Good afternoon, `;
  else return `Good evening, `;
});
const { data: hydration } = useHydrationStatus();
const logHydration = useLogHydration();
const deleteHydration = useDeleteHydration();
const customHydrationAmount = ref<number | undefined>(undefined);
const lastLoggedHydrationId = ref<number | null>(null);
let undoHydrationTimeout: ReturnType<typeof setTimeout> | null = null;

const clearHydrationUndo = () => {
  if (undoHydrationTimeout) clearTimeout(undoHydrationTimeout);
  undoHydrationTimeout = null;
};

const logHydrationAmount = async (amountMl: number) => {
  if (!Number.isFinite(amountMl) || amountMl <= 0) return;
  const log = await logHydration.mutateAsync(amountMl);
  clearHydrationUndo();
  lastLoggedHydrationId.value = log.id;
  undoHydrationTimeout = setTimeout(() => {
    lastLoggedHydrationId.value = null;
  }, HYDRATION_UNDO_WINDOW_MS);
};

const logCustomHydrationAmount = () => {
  const amountMl = customHydrationAmount.value;
  customHydrationAmount.value = undefined;
  if (amountMl) logHydrationAmount(amountMl);
};

const undoLastHydrationLog = async () => {
  const id = lastLoggedHydrationId.value;
  if (!id) return;
  lastLoggedHydrationId.value = null;
  clearHydrationUndo();
  await deleteHydration.mutateAsync(id);
};

onBeforeUnmount(clearHydrationUndo);

const { data: nutrition } = useNutritionToday();
const caloriePct = computed(() => {
  if (!nutrition.value?.target?.calories) return 0;
  return Math.min(
    100,
    Math.round((nutrition.value.totals.calories / nutrition.value.target.calories) * 100)
  );
});
const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0
    ? `${Math.round(remaining)} to go`
    : `${Math.round(-remaining)} over`;
};
const weightGoal = computed(() => {
  const target = profile.value?.profile?.targets[0];
  const current = profile.value?.stats?.latestWeightKg;
  if (!target || current == null) return null;

  const { startingValue, targetValue } = target;
  const span = targetValue - startingValue;
  const isBulking = span >= 0;
  const rawProgress = span === 0 ? 100 : ((current - startingValue) / span) * 100;
  const progress = Math.min(100, Math.max(0, rawProgress));

  const remainingKg = Math.abs(targetValue - current);
  const statusLabel =
    rawProgress >= 100
      ? remainingKg > 0.05
        ? `Goal reached — ${remainingKg.toFixed(1)}kg past target`
        : "Goal reached"
      : `${remainingKg.toFixed(1)}kg to go`;

  return { targetValue, isBulking, progress, statusLabel };
});

const weightSparkline = computed(() => {
  const trend = stats.value?.weightTrend ?? [];
  if (trend.length < 2) return null;

  const width = 100;
  const height = 32;
  const values = trend.map((point) => point.weightKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min || 1) * 0.15;
  const paddedMin = min - padding;
  const paddedRange = max + padding - paddedMin || 1;

  const toX = (index: number) => (index / (values.length - 1)) * width;
  const toY = (value: number) => height - ((value - paddedMin) / paddedRange) * height;

  const linePoints = values
    .map((value, index) => `${toX(index)},${toY(value)}`)
    .join(" ");
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;

  return { width, height, linePoints, averageY: toY(average) };
});

const xpProgress = computed(() => {
  const total = stats.value
    ? stats.value?.xp?.xpIntoLevel + stats?.value?.xp?.xpForNextLevel
    : 0;
  return stats.value ? (stats.value?.xp.xpIntoLevel / total) * 100 : 0;
});

const consistencyWeeks = computed(() => {
  const days = stats.value?.consistency ?? [];
  const weeks: boolean[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7).map(day => day.active));
  }
  return weeks;
});

const formatWeight = (weightKg: number): string => {
  if (profile.value?.profile?.unitSystem === "imperial") {
    return `${Math.round(kgToLbs(weightKg)).toLocaleString()} lbs`;
  }
  return `${Math.round(weightKg).toLocaleString()} kg`;
};

const lastSession = computed(() => {
  const session = stats.value?.recentSession;
  if (!session) return null;

  const completedAt = new Date(`${session.completedAt.replace(" ", "T")}Z`);
  const durationLabel = session.durationMinutes != null ? `${Math.round(session.durationMinutes)}m` : null;
  const topLiftLabel = session.topExerciseName
    ? `Top Lift: ${formatWeight(session.topWeightKg ?? 0)} ${session.topExerciseName}`
    : null;

  return {
    dayName: session.dayName ?? "Freeform Workout",
    completedAt,
    durationLabel,
    topLiftLabel,
  };
});

const lastSessionTimeAgo = useTimeAgo(() => lastSession.value?.completedAt ?? new Date());

const startTodaysWorkout = async () => {
  startError.value = null;
  const workout = stats.value?.todaysWorkout;
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
        restSeconds: exercise.restSeconds,
      })),
    });
    await navigateTo(`/workouts/session/${session.id}`);
  } catch {
    startError.value = "Couldn't start the workout. Please try again.";
  }
};

const continueWorkout = async () => {
  const sessionId = stats.value?.activeSession?.sessionId;
  if (!sessionId) return;
  await navigateTo(`/workouts/session/${sessionId}`);
};
</script>

<template>
  <div class="px-4 py-4 flex flex-col gap-y-4" v-if="!isLoading && !isPending">
    <span class="font-mono text-muted-foreground">
      {{ useDateFormat(now, "MMM DD, YYYY") }}
    </span>
    <span class="flex flex-col gap-y-1 text-4xl font-heading font-semibold">
      {{ timeOfDay ?? "NULL" }}
      <span>{{ profile?.profile?.displayName?.split(" ")[0] }} </span>
    </span>

    <UiCard v-if="stats?.activeSession" class="space-y-3">
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
        >In Progress</span
      >
      <p class="font-heading text-2xl font-semibold text-foreground">
        {{ stats.todaysWorkout?.dayName ?? "Freeform Workout" }}
      </p>
      <Button size="lg" class="w-full" @click="continueWorkout">
        <PlayIcon class="size-4" />
        Continue Workout
      </Button>
    </UiCard>
    <UiCard v-else-if="stats?.todaysWorkout" class="space-y-3">
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
        >Today</span
      >
      <p class="font-heading text-2xl font-semibold text-foreground">
        {{ stats.todaysWorkout.dayName }}
      </p>
      <Button
        size="lg"
        class="w-full"
        :disabled="startSession.isLoading.value"
        @click="startTodaysWorkout"
      >
        <PlayIcon class="size-4" />
        Start Today's Workout
      </Button>
      <p v-if="startError" class="text-sm text-destructive">{{ startError }}</p>
    </UiCard>

    <div class="flex gap-x-2 font-heading min-h-max h-max">
      <NuxtLink to="/profile" class="contents">
        <UiCard class="w-1/2 flex flex-col gap-y-1">
          <span class="flex gap-x-2 items-center flex-row">
            <FlameIcon fill="currentColor" class="text-primary" />
            <h2 class="text-3xl">{{ stats?.streak.current ?? 0 }}</h2></span
          >
          <span class="text-muted-foreground font-thin">Day Streak</span>
        </UiCard>
      </NuxtLink>
      <NuxtLink to="/profile" class="contents">
        <UiCard class="w-1/2 flex flex-col gap-y-4">
          <span class="flex gap-x-2 items-center flex-row font-heading">
            <StarIcon fill="currentColor" class="text-primary" />
            <h2 class="text-3xl">Level {{ stats?.xp.level }}</h2></span
          >
          <UiProgress :model-value="xpProgress" class="h-1.5 bg-muted" />
        </UiCard>
      </NuxtLink>
    </div>

    <UiCard v-if="stats?.consistency?.length" class="space-y-4">
      <div class="flex items-end justify-between">
        <h2 class="font-heading text-xl font-bold text-foreground">Consistency</h2>
        <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
          >Last 28 Days</span
        >
      </div>
      <div class="flex flex-col gap-y-1.5">
        <div v-for="(week, weekIndex) in consistencyWeeks" :key="weekIndex" class="flex gap-x-1.5">
          <div
            v-for="(active, dayIndex) in week"
            :key="dayIndex"
            class="h-3 flex-1 rounded-full"
            :class="active ? 'bg-primary' : 'bg-surface-strong'"
          />
        </div>
      </div>
    </UiCard>

    <article class="flex w-full gap-x-2">
      <UiCard v-if="profile?.stats" class="space-y-3 w-1/2">
        <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
          >Body Metrics</span
        >
        <p
          class="font-heading text-3xl font-semibold text-foreground [font-variant-numeric:tabular-nums]"
        >
          {{ Math.round(profile.stats.latestWeightKg ?? 0)
          }}<span class="font-sans text-base font-normal text-muted-foreground">kg</span>
        </p>
        <div class="flex gap-x-4 font-mono text-xs text-muted-foreground">
          <span>BMI {{ profile.stats.bmi.toFixed(1) }}</span>
          <span
            >TDEE {{ profile.stats.tdee ? Math.round(profile.stats.tdee) : "—" }}</span
          >
        </div>
        <svg
          v-if="weightSparkline"
          :viewBox="`0 0 ${weightSparkline.width} ${weightSparkline.height}`"
          preserveAspectRatio="none"
          class="h-10 w-full"
        >
          <line
            x1="0"
            :y1="weightSparkline.averageY"
            :x2="weightSparkline.width"
            :y2="weightSparkline.averageY"
            class="text-border"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="3 3"
            vector-effect="non-scaling-stroke"
          />
          <polyline
            :points="weightSparkline.linePoints"
            class="text-primary"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <p v-else class="text-xs text-muted-foreground">
          Log a weigh-in to see your trend
        </p>
      </UiCard>
      <div class="w-1/2 flex-col flex gap-y-2">
        <div v-if="weightGoal">
          <div>
            <UiCard class="space-y-2">
              <span class="flex items-center gap-x-2 font-heading text-xl">
                <component
                  :is="weightGoal.isBulking ? TrendingUpIcon : TrendingDownIcon"
                  :class="weightGoal.isBulking ? 'text-peach' : 'text-accent'"
                  class="size-5"
                />
                Active Goal: {{ weightGoal.targetValue }}KG
              </span>
              <UiProgress
                :model-value="weightGoal.progress"
                class="h-1.5 bg-muted"
                :indicator-class="weightGoal.isBulking ? 'bg-peach' : 'bg-accent'"
              />
              <span class="text-xs text-muted-foreground">{{
                weightGoal.statusLabel
              }}</span>
            </UiCard>
          </div>
        </div>
        <UiCard v-if="stats?.weeklyProgress" class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
              >Weekly Vol</span
            >
            <span class="font-mono text-xs text-muted-foreground"
              >{{ stats.weeklyProgress.trainedDays }}/{{
                stats.weeklyProgress.scheduledDays
              }}
              Days</span
            >
          </div>
          <p
            class="font-heading text-2xl font-semibold text-foreground [font-variant-numeric:tabular-nums]"
          >
            {{ formatWeight(stats.weeklyProgress.volumeKg) }}
          </p>
        </UiCard>
        <UiCard class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
              >Hydration</span
            >
            <span v-if="hydration?.targetMl" class="font-mono text-xs text-muted-foreground"
              >{{ (hydration.targetMl / 1000).toFixed(1) }}L Goal</span
            >
          </div>
          <div v-if="hydration?.targetMl" class="space-y-2">
            <div class="flex items-center justify-between">
              <span
                class="flex items-center gap-x-2 font-heading text-2xl font-semibold text-foreground [font-variant-numeric:tabular-nums]"
              >
                <DropletIcon class="size-5 text-cyan-pale" />
                {{ (hydration.totalMl / 1000).toFixed(1)
                }}<span class="text-base font-normal text-muted-foreground"
                  >/{{ (hydration.targetMl / 1000).toFixed(1) }}L</span
                >
              </span>
              <button
                v-if="lastLoggedHydrationId"
                type="button"
                class="font-mono text-xs uppercase tracking-[1.2px] text-cyan-pale underline disabled:opacity-50"
                :disabled="deleteHydration.isLoading.value"
                @click="undoLastHydrationLog"
              >
                Undo
              </button>
            </div>
            <div class="flex items-center gap-x-1.5">
              <Button
                v-for="preset in HYDRATION_PRESETS_ML"
                :key="preset"
                size="sm"
                variant="secondary"
                :disabled="logHydration.isLoading.value"
                @click="logHydrationAmount(preset)"
              >
                +{{ preset }}
              </Button>
              <div class="ml-auto flex items-center gap-x-1">
                <Input
                  v-model="customHydrationAmount"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  placeholder="mL"
                  class="h-8 w-16 px-2 py-1 text-xs"
                />
                <Button
                  size="icon-sm"
                  variant="secondary"
                  class="rounded-full"
                  :disabled="logHydration.isLoading.value || !customHydrationAmount"
                  @click="logCustomHydrationAmount"
                >
                  <PlusIcon class="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <p v-else class="text-xs text-muted-foreground">
            No daily target --
            <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
          </p>
        </UiCard>
      </div>
    </article>

    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <UtensilsIcon class="size-4.5 text-lime" />
        <h2 class="font-heading text-lg uppercase text-foreground">Nutrition</h2>
      </div>
      <UiCard
        class="w-full space-y-4 rounded-xl border border-surface-strong bg-card p-5"
      >
        <div class="flex items-end justify-between">
          <div>
            <p
              class="font-heading text-2xl text-foreground [font-variant-numeric:tabular-nums]"
            >
              {{ Math.round(nutrition?.totals.calories ?? 0).toLocaleString()
              }}<span class="font-sans text-sm font-normal text-muted-foreground"
                >cal</span
              >
            </p>
            <p v-if="nutrition?.target" class="text-xs text-muted-foreground">
              {{ remainingLabel(nutrition.remaining?.calories) }}
            </p>
            <p v-else class="text-xs text-muted-foreground">
              No daily target --
              <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
            </p>
          </div>
          <span
            v-if="nutrition?.target"
            class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
          >
            {{ Math.round(nutrition.target.calories).toLocaleString() }}cal goal
          </span>
        </div>
        <UiProgress
          v-if="nutrition?.target"
          :model-value="caloriePct"
          class="h-1.5 bg-muted"
          indicator-class="bg-lime"
        />
        <div
          v-if="nutrition?.target"
          class="grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
        >
          <span>P {{ Math.round(nutrition.totals.proteinG) }}g</span>
          <span>C {{ Math.round(nutrition.totals.carbsG) }}g</span>
          <span>F {{ Math.round(nutrition.totals.fatG) }}g</span>
        </div>
        <NuxtLink to="/nutrition">
          <Button variant="secondary" size="sm">Log meal</Button>
        </NuxtLink>
      </UiCard>
    </div>

    <div v-if="lastSession" class="space-y-2">
      <div class="flex items-center gap-2">
        <HistoryIcon class="size-4.5 text-peach" />
        <h2 class="font-heading text-lg uppercase text-foreground">Last Session</h2>
      </div>
      <UiCard class="w-full space-y-1 rounded-xl border border-surface-strong bg-card p-5">
        <div class="flex items-start justify-between">
          <p class="font-heading text-2xl text-foreground">{{ lastSession.dayName }}</p>
          <span
            v-if="lastSession.durationLabel"
            class="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
            >{{ lastSession.durationLabel }}</span
          >
        </div>
        <p class="text-sm text-muted-foreground">
          <span class="capitalize">{{ lastSessionTimeAgo }}</span>
          <template v-if="lastSession.topLiftLabel"> • {{ lastSession.topLiftLabel }}</template>
        </p>
      </UiCard>
    </div>
  </div>
  <div v-else class="px-4 py-4 text-muted-foreground">Loading...</div>
</template>
