<script setup lang="ts">
import {
  AwardIcon,
  DropletIcon,
  FlameIcon,
  HistoryIcon,
  PlayIcon,
  PlusIcon,
  StarIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TrophyIcon,
  UtensilsIcon,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kgToLbs } from "~~/shared/lib/formulas";
import { buildSparkline } from "~~/shared/lib/sparkline";
import { formatPrTypes } from "~~/shared/lib/suggestion-copy";

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

// Hydration was the only progress metric on this page rendered as a bare "1.2/2.5L" with
// no bar, while calories, XP and the weight goal all had one.
const hydrationPct = computed(() => {
  if (!hydration.value?.targetMl) return 0;
  return Math.min(
    100,
    Math.round((hydration.value.totalMl / hydration.value.targetMl) * 100)
  );
});

const { data: nutrition } = useNutritionToday();
const caloriePct = computed(() => {
  if (!nutrition.value?.target?.calories) return 0;
  return Math.min(
    100,
    Math.round((nutrition.value.totals.calories / nutrition.value.target.calories) * 100)
  );
});
// Wording matches nutrition.vue's own remainingLabel -- the two rendered "326 left" and
// "326 to go" for the identical figure.
const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0
    ? `${Math.round(remaining)} left`
    : `${Math.round(-remaining)} over`;
};

// Protein/carbs/fat get the same consumed-against-target treatment calories already had;
// previously they rendered as flat text with no target and no bar. The row is deliberately
// NOT gated on a target existing -- without one the bars are dropped but the raw grams
// still show, since they're then the only nutrition figure the card can offer.
const MACRO_META = [
  { key: "proteinG", label: "Protein", indicatorClass: "bg-primary" },
  { key: "carbsG", label: "Carbs", indicatorClass: "bg-lime" },
  { key: "fatG", label: "Fat", indicatorClass: "bg-peach" },
] as const;

const macroBreakdown = computed(() => {
  return MACRO_META.map((meta) => {
    const consumed = Math.round(nutrition.value?.totals[meta.key] ?? 0);
    const target = nutrition.value?.target
      ? Math.round(nutrition.value.target[meta.key])
      : null;
    return {
      ...meta,
      consumed,
      target,
      pct: target ? Math.min(100, Math.round((consumed / target) * 100)) : 0,
    };
  });
});
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
  return buildSparkline(trend.map((point) => point.weightKg));
});

const xpProgress = computed(() => {
  const total = stats.value
    ? stats.value?.xp?.xpIntoLevel + stats?.value?.xp?.xpForNextLevel
    : 0;
  return stats.value ? (stats.value?.xp.xpIntoLevel / total) * 100 : 0;
});

// Distinguishes "rest day" from "no split at all" for the hero card's empty state.
// `weeklyProgress.scheduledDays` is the active block's non-rest day count, so 0 means no
// active block (or one made entirely of rest days) rather than a day off.
const hasScheduledTraining = computed(() => (stats.value?.weeklyProgress.scheduledDays ?? 0) > 0);

const consistencyWeeks = computed(() => {
  const days = stats.value?.consistency ?? [];
  const weeks: boolean[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7).map(day => day.active));
  }
  return weeks;
});

const unitSystem = computed(() => profile.value?.profile?.unitSystem ?? "metric");

const formatWeight = (weightKg: number): string => {
  if (unitSystem.value === "imperial") {
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
      format: workout.format,
      rounds: workout.rounds,
      exercises: workout.exercises.map(exercise => ({
        id: crypto.randomUUID(),
        exerciseId: exercise.exerciseId,
        splitExerciseId: exercise.splitExerciseId,
        position: exercise.position,
        setType: exercise.setType,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
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
  <div v-if="!isLoading && !isPending" class="px-4 py-4 flex flex-col gap-y-4">
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
    <!-- Without this branch the hero slot renders nothing at all on a rest day or before a
         split exists, silently removing the largest card on the page. The two cases need
         different copy (and different destinations), so they're split on whether the active
         block schedules any training days at all rather than lumped into one empty state. -->
    <UiCard v-else class="space-y-3">
      <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">
        {{ hasScheduledTraining ? "Today" : "Get Started" }}
      </span>
      <p class="font-heading text-2xl font-semibold text-foreground">
        {{ hasScheduledTraining ? "Rest Day" : "No Split Yet" }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{
          hasScheduledTraining
            ? "Nothing scheduled today. Recovery is part of the programme."
            : "Build a split to get a workout scheduled for you each day."
        }}
      </p>
      <NuxtLink :to="hasScheduledTraining ? '/workouts' : '/builder'">
        <Button size="lg" variant="secondary" class="w-full">
          {{ hasScheduledTraining ? "View This Week" : "Build A Split" }}
        </Button>
      </NuxtLink>
    </UiCard>

    <div class="flex gap-x-2 font-heading min-h-max h-max">
      <NuxtLink to="/profile" class="contents">
        <UiCard class="flex min-w-0 flex-1 flex-col gap-y-1">
          <span class="flex gap-x-2 items-center flex-row">
            <FlameIcon fill="currentColor" class="text-primary" />
            <h2 class="text-3xl">{{ stats?.streak.current ?? 0 }}</h2></span
          >
          <span class="text-muted-foreground font-thin"
            >Day Streak<template v-if="stats?.streak.longest">
              &middot; Best {{ stats.streak.longest }}</template
            ></span
          >
        </UiCard>
      </NuxtLink>
      <NuxtLink to="/profile" class="contents">
        <UiCard class="flex min-w-0 flex-1 flex-col gap-y-4">
          <span class="flex gap-x-2 items-center flex-row font-heading">
            <StarIcon fill="currentColor" class="shrink-0 text-primary" />
            <h2 class="whitespace-nowrap text-2xl min-[400px]:text-3xl">Level {{ stats?.xp.level }}</h2></span
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
      <UiCard v-if="profile?.stats" class="min-w-0 flex-1 space-y-3">
        <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground"
          >Body Metrics</span
        >
        <p
          class="font-heading text-3xl font-semibold text-foreground [font-variant-numeric:tabular-nums]"
        >
          {{ Math.round(profile.stats.latestWeightKg ?? 0)
          }}<span class="font-sans text-base font-normal text-muted-foreground">kg</span>
        </p>
        <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
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
      <div class="flex min-w-0 flex-1 flex-col gap-y-2">
        <div v-if="weightGoal">
          <div>
            <UiCard class="space-y-2">
              <span class="flex items-center gap-x-2 font-heading text-base min-[400px]:text-xl">
                <component
                  :is="weightGoal.isBulking ? TrendingUpIcon : TrendingDownIcon"
                  :class="weightGoal.isBulking ? 'text-peach' : 'text-accent'"
                  class="size-5 shrink-0"
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
          <div class="flex flex-wrap items-center justify-between gap-x-2">
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
          <div class="flex flex-wrap items-center justify-between gap-x-2">
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
              <!-- Kept mounted and hidden rather than v-if'd, so the row doesn't reflow
                   every time the 5s undo window opens and closes. -->
              <button
                type="button"
                class="font-mono text-xs uppercase tracking-[1.2px] text-cyan-pale underline disabled:opacity-50"
                :class="lastLoggedHydrationId ? '' : 'invisible'"
                :aria-hidden="!lastLoggedHydrationId"
                :tabindex="lastLoggedHydrationId ? undefined : -1"
                :disabled="deleteHydration.isLoading.value || !lastLoggedHydrationId"
                @click="undoLastHydrationLog"
              >
                Undo
              </button>
            </div>
            <UiProgress
              :model-value="hydrationPct"
              class="h-1.5 bg-muted"
              indicator-class="bg-cyan-pale"
            />
            <div class="flex flex-wrap items-center gap-1.5">
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
        <div class="grid grid-cols-3 gap-3">
          <div v-for="macro in macroBreakdown" :key="macro.key" class="min-w-0 space-y-1">
            <!-- Label over value: side by side, three columns left no room on a phone. -->
            <div class="flex flex-col">
              <span
                class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground"
                >{{ macro.label }}</span
              >
              <span
                class="font-heading text-xs text-foreground [font-variant-numeric:tabular-nums]"
              >
                {{ macro.consumed
                }}<span v-if="macro.target" class="text-muted-foreground"
                  >/{{ macro.target }}</span
                >g
              </span>
            </div>
            <UiProgress
              v-if="macro.target"
              :model-value="macro.pct"
              class="h-1 bg-muted"
              :indicator-class="macro.indicatorClass"
            />
          </div>
        </div>
        <NuxtLink to="/nutrition" class="block">
          <Button variant="secondary" size="lg" class="w-full">
            <PlusIcon class="size-4" />
            Log meal
          </Button>
        </NuxtLink>
      </UiCard>
    </div>

    <div v-if="stats?.recentPrs?.length" class="space-y-2">
      <div class="flex items-center gap-2">
        <TrophyIcon class="size-4.5 text-lime" />
        <h2 class="font-heading text-lg uppercase text-foreground">Recent PRs</h2>
      </div>
      <UiCard class="space-y-2.5">
        <div v-for="pr in stats.recentPrs.slice(0, 3)" :key="`${pr.exerciseName}-${pr.achievedAt}`" class="space-y-0.5">
          <div class="flex items-baseline justify-between gap-3">
            <span class="min-w-0 truncate text-sm text-foreground">{{ pr.exerciseName }}</span>
            <span class="flex shrink-0 items-baseline gap-2">
              <span
                class="font-heading text-base text-lime [font-variant-numeric:tabular-nums]"
                >{{ formatWeight(pr.weightKg) }} &times; {{ pr.reps }}</span
              >
              <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                {{ useDateFormat(new Date(`${pr.achievedAt.replace(" ", "T")}Z`), "MMM DD") }}
              </span>
            </span>
          </div>
          <p v-if="pr.prTypes.length > 0" class="text-right font-mono text-[10px] uppercase leading-tight tracking-[1px] text-muted-foreground">
            {{ formatPrTypes(pr.prTypes, pr.e1rmKg, unitSystem) }}
          </p>
        </div>
      </UiCard>
    </div>

    <div v-if="stats?.recentAchievements?.length" class="space-y-2">
      <div class="flex items-center gap-2">
        <AwardIcon class="size-4.5 text-primary" />
        <h2 class="font-heading text-lg uppercase text-foreground">Just Unlocked</h2>
      </div>
      <div class="flex gap-x-2 overflow-x-auto">
        <NuxtLink
          v-for="achievement in stats.recentAchievements.slice(0, 3)"
          :key="achievement.key"
          to="/profile"
          class="min-w-0 flex-1"
        >
          <UiCard class="flex h-full w-full flex-col items-center gap-y-1 px-2 text-center">
            <span class="text-2xl">{{ achievement.icon ?? "🏅" }}</span>
            <span class="max-w-full truncate text-xs text-foreground">{{ achievement.name }}</span>
          </UiCard>
        </NuxtLink>
      </div>
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
  <UiLoadingIndicator v-else />
</template>
