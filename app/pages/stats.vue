<script setup lang="ts">
import { ActivityIcon, DumbbellIcon, ScaleIcon, TrophyIcon } from "@lucide/vue";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { kgToLbs } from "~~/shared/lib/formulas";
import { buildSparkline } from "~~/shared/lib/sparkline";
import { formatPrTypes } from "~~/shared/lib/suggestion-copy";
import type { VolumeBand } from "~~/shared/types/workouts.types";

const { data: profile } = useProfile();
const unitSystem = computed(() => profile.value?.profile?.unitSystem ?? "metric");
const formatWeight = (weightKg: number): string => {
  if (unitSystem.value === "imperial") {
    return `${Math.round(kgToLbs(weightKg))} lbs`;
  }
  return `${Math.round(weightKg)} kg`;
};

// Session/PR timestamps are "YYYY-MM-DD HH:MM:SS" UTC (same convention as Home/Workouts) --
// body-metric `recordedAt` values are plain "YYYY-MM-DD" dates and are rendered as-is instead.
const formatDateTime = (dateString: string): string => {
  const date = new Date(`${dateString.replace(" ", "T")}Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

// --- Strength progression: search/pick an exercise (same combobox+useExerciseSearch pattern
// as DayExercisePicker), then chart its full history via the existing useExerciseHistory --
// there is no separate "strength progression" endpoint, /api/exercises/[id]/history already
// returns full, chart-ready history.
const exercisePicked = ref<string | undefined>(undefined);
const exerciseSearchTerm = ref("");
const { data: exerciseSearchResults, isLoading: exerciseSearchLoading } = useExerciseSearch(exerciseSearchTerm);
const exerciseOptions = computed<ComboboxOption[]>(
  () => exerciseSearchResults.value?.map(exercise => ({ value: exercise.id, label: exercise.name })) ?? [],
);

const selectedExerciseId = ref("");
const selectedExerciseName = ref("");

// Mirrors DayExercisePicker's watch(picked): resets the combobox back to empty right after a
// pick (rather than leaving `model` pointed at an id the now-cleared search results no longer
// contain, which would blank the trigger's label) and tracks the actual selection separately.
watch(exercisePicked, (id) => {
  if (!id || typeof id !== "string") return;
  const exercise = exerciseSearchResults.value?.find(e => e.id === id);
  exercisePicked.value = undefined;
  exerciseSearchTerm.value = "";
  if (!exercise) return;
  selectedExerciseId.value = exercise.id;
  selectedExerciseName.value = exercise.name;
});

const { data: exerciseHistory } = useExerciseHistory(selectedExerciseId);

// History comes back most-recent-first; charts read left-to-right chronologically.
const strengthTrend = computed(() => [...(exerciseHistory.value?.history ?? [])].reverse());
const strengthSparkline = computed(() => buildSparkline(strengthTrend.value.map(entry => entry.topSetWeightKg)));
const soloStrengthEntry = computed(() => (strengthTrend.value.length === 1 ? strengthTrend.value[0] : null));

// --- Volume trend: WeeklyVolumeSnapshot[] (one entry per week, oldest first, each carrying a
// muscles: MuscleVolume[]) pivoted into a per-muscle time series -- top N muscles by total sets
// across the fetched weeks, each charted as its own mini sparkline of weekly set counts.
const TOP_MUSCLES_COUNT = 4;

const volumeBandStyles: Record<VolumeBand, { text: string; label: string }> = {
  low: { text: "text-muted-foreground", label: "Low" },
  optimal: { text: "text-lime", label: "Optimal" },
  high: { text: "text-destructive", label: "High" },
};

const { data: volumeHistory } = useVolumeHistory();

const muscleTrends = computed(() => {
  const weeks = volumeHistory.value ?? [];
  if (weeks.length === 0) return [];

  const totalsByMuscle = new Map<string, number>();
  for (const week of weeks) {
    for (const muscle of week.muscles) {
      totalsByMuscle.set(muscle.muscleName, (totalsByMuscle.get(muscle.muscleName) ?? 0) + muscle.setCount);
    }
  }

  const topMuscleNames = [...totalsByMuscle.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_MUSCLES_COUNT)
    .map(([muscleName]) => muscleName);

  return topMuscleNames.map((muscleName) => {
    const weeklyEntries = weeks.map(week => week.muscles.find(muscle => muscle.muscleName === muscleName));
    const setCounts = weeklyEntries.map(entry => entry?.setCount ?? 0);
    const latest = weeklyEntries[weeklyEntries.length - 1] ?? null;
    return {
      muscleName,
      sparkline: buildSparkline(setCounts),
      latestSetCount: latest?.setCount ?? 0,
      latestBand: latest?.band ?? null,
    };
  });
});

// --- PR history: full uncapped timeline (unlike Home/Workouts' 5-item recentPrs).
const { data: prHistory } = usePrHistory();

// --- Body metrics: reuse the existing read composable, no new endpoint needed. Weight trend
// mirrors Home's weightSparkline exactly (same shared helper); body metrics list mirrors the
// "Recent entries" list already shipped on the Profile page.
const { data: bodyMetrics } = useBodyMetrics();
const bodyMetricsChrono = computed(() => [...(bodyMetrics.value ?? [])].reverse());
const weightTrendSparkline = computed(() => buildSparkline(bodyMetricsChrono.value.map(metric => metric.weightKg)));
const latestBodyMetric = computed(() => bodyMetrics.value?.[0] ?? null);
const recentBodyMetrics = computed(() => (bodyMetrics.value ?? []).slice(0, 5));
</script>

<template>
  <div class="px-4 py-4 flex flex-col gap-y-4">
    <h1 class="font-heading text-2xl uppercase text-foreground">Stats</h1>

    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <DumbbellIcon class="size-4.5 text-primary" />
        <h2 class="font-heading text-lg uppercase text-foreground">Strength Progression</h2>
      </div>
      <UiCard class="space-y-3">
        <Combobox
          v-model="exercisePicked"
          v-model:search-term="exerciseSearchTerm"
          :items="exerciseOptions"
          :reset-search-term-on-select="false"
          placeholder="Search an exercise…"
          search-placeholder="Search exercises…"
          :empty-text="exerciseSearchLoading ? 'Searching…' : 'No results found.'"
        />

        <template v-if="selectedExerciseId">
          <div class="flex items-center justify-between">
            <span class="font-heading text-lg text-foreground">{{ selectedExerciseName }}</span>
            <span v-if="exerciseHistory?.personalRecord" class="font-mono text-xs text-muted-foreground">
              PR {{ formatWeight(exerciseHistory.personalRecord.weightKg) }} × {{ exerciseHistory.personalRecord.reps }}
            </span>
          </div>

          <svg
            v-if="strengthSparkline"
            :viewBox="`0 0 ${strengthSparkline.width} ${strengthSparkline.height}`"
            preserveAspectRatio="none"
            class="h-16 w-full"
          >
            <line
              x1="0"
              :y1="strengthSparkline.averageY"
              :x2="strengthSparkline.width"
              :y2="strengthSparkline.averageY"
              class="text-border"
              stroke="currentColor"
              stroke-width="1"
              stroke-dasharray="3 3"
              vector-effect="non-scaling-stroke"
            />
            <polyline
              :points="strengthSparkline.linePoints"
              class="text-primary"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <p v-else-if="soloStrengthEntry" class="text-xs text-muted-foreground">
            One session logged so far — {{ formatWeight(soloStrengthEntry.topSetWeightKg) }} ×
            {{ soloStrengthEntry.topSetReps }} on {{ formatDateTime(soloStrengthEntry.date) }}. Log another to see a trend.
          </p>
          <p v-else class="text-xs text-muted-foreground">No sets logged for this exercise yet.</p>
        </template>
        <p v-else class="text-xs text-muted-foreground">Pick an exercise to see its weight trend over time.</p>
      </UiCard>
    </div>

    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <ActivityIcon class="size-4.5 text-lime" />
        <h2 class="font-heading text-lg uppercase text-foreground">Volume Trend</h2>
      </div>
      <UiCard v-if="muscleTrends.length" class="space-y-4">
        <span class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">
          Sets per week · last {{ volumeHistory?.length ?? 0 }} weeks
        </span>
        <div v-for="muscle in muscleTrends" :key="muscle.muscleName" class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold capitalize text-foreground">{{ muscle.muscleName }}</span>
            <span class="flex items-center gap-2">
              <span
                v-if="muscle.latestBand"
                class="font-mono text-[10px] font-bold uppercase tracking-[1px]"
                :class="volumeBandStyles[muscle.latestBand].text"
              >
                {{ volumeBandStyles[muscle.latestBand].label }}
              </span>
              <span class="font-mono text-xs text-muted-foreground">{{ muscle.latestSetCount }} sets</span>
            </span>
          </div>
          <svg
            v-if="muscle.sparkline"
            :viewBox="`0 0 ${muscle.sparkline.width} ${muscle.sparkline.height}`"
            preserveAspectRatio="none"
            class="h-6 w-full"
          >
            <polyline
              :points="muscle.sparkline.linePoints"
              class="text-lime"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <p v-else class="text-xs text-muted-foreground">Not enough weeks logged yet for a trend.</p>
        </div>
      </UiCard>
      <UiCard v-else class="space-y-1">
        <p class="text-sm text-muted-foreground">Log some sessions to see your weekly volume trend by muscle.</p>
      </UiCard>
    </div>

    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <TrophyIcon class="size-4.5 text-primary" />
        <h2 class="font-heading text-lg uppercase text-foreground">PR History</h2>
      </div>
      <div v-if="prHistory?.length" class="space-y-2">
        <UiCard
          v-for="pr in prHistory"
          :key="`${pr.exerciseName}-${pr.achievedAt}`"
          class="flex items-center gap-3"
        >
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <TrophyIcon class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-foreground">{{ pr.exerciseName }}</p>
            <p class="text-xs text-muted-foreground">{{ formatWeight(pr.weightKg) }} × {{ pr.reps }}</p>
            <p v-if="pr.prTypes.length > 0" class="font-mono text-[10px] uppercase leading-tight tracking-[1px] text-muted-foreground">
              {{ formatPrTypes(pr.prTypes, pr.e1rmKg, unitSystem) }}
            </p>
          </div>
          <span class="font-mono text-xs text-muted-foreground">{{ formatDateTime(pr.achievedAt) }}</span>
        </UiCard>
      </div>
      <UiCard v-else class="space-y-1">
        <p class="text-sm text-muted-foreground">No PRs yet — hit a new max weight to see it here.</p>
      </UiCard>
    </div>

    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <ScaleIcon class="size-4.5 text-accent" />
        <h2 class="font-heading text-lg uppercase text-foreground">Body Metrics</h2>
      </div>
      <UiCard v-if="latestBodyMetric" class="space-y-3">
        <div class="flex items-end justify-between">
          <p class="font-heading text-2xl font-semibold text-foreground [font-variant-numeric:tabular-nums]">
            {{ formatWeight(latestBodyMetric.weightKg) }}
          </p>
          <span v-if="latestBodyMetric.bodyFatPct !== null" class="font-mono text-xs text-muted-foreground">
            {{ latestBodyMetric.bodyFatPct }}% BF
          </span>
        </div>
        <svg
          v-if="weightTrendSparkline"
          :viewBox="`0 0 ${weightTrendSparkline.width} ${weightTrendSparkline.height}`"
          preserveAspectRatio="none"
          class="h-10 w-full"
        >
          <line
            x1="0"
            :y1="weightTrendSparkline.averageY"
            :x2="weightTrendSparkline.width"
            :y2="weightTrendSparkline.averageY"
            class="text-border"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="3 3"
            vector-effect="non-scaling-stroke"
          />
          <polyline
            :points="weightTrendSparkline.linePoints"
            class="text-accent"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <p v-else class="text-xs text-muted-foreground">Log another weigh-in to see your weight trend.</p>

        <div v-if="recentBodyMetrics.length" class="space-y-2 border-t border-surface-strong pt-3">
          <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Recent entries</p>
          <div v-for="metric in recentBodyMetrics" :key="metric.id" class="flex items-center justify-between gap-2 text-sm">
            <span class="text-muted-foreground">{{ metric.recordedAt }}</span>
            <span class="text-foreground [font-variant-numeric:tabular-nums]">
              {{ formatWeight(metric.weightKg) }}<span v-if="metric.bodyFatPct !== null"> · {{ metric.bodyFatPct }}% BF</span>
            </span>
          </div>
        </div>
      </UiCard>
      <UiCard v-else class="space-y-1">
        <p class="text-sm text-muted-foreground">
          No body-metric history yet —
          <NuxtLink to="/profile" class="text-cyan-pale underline">log your first entry</NuxtLink>
        </p>
      </UiCard>
    </div>
  </div>
</template>
