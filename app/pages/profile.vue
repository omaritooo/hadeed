<script setup lang="ts">
import { BellIcon, DumbbellIcon, FlameIcon, LockIcon, LogOutIcon, PlusIcon, ScaleIcon, TrashIcon, TrendingUpIcon, TrophyIcon, UtensilsIcon, WeightIcon } from "@lucide/vue";
import type { Component } from "vue";
import type { AchievementCriteriaType } from "~~/shared/types/gamification.types";
import { Button } from "@/components/ui/button";

const remindersEnabled = ref(false);
const reminderInterval = ref(120);
const { isLoading: reminderLoading, errorMessage: reminderError, enable: enableReminders, disable: disableReminders } = useHydrationReminders();

const { data: profileData } = useProfile();
let seededFromProfile = false;
watch(profileData, (data) => {
  if (seededFromProfile || !data?.profile) return;
  remindersEnabled.value = data.profile.hydrationRemindersEnabled;
  reminderInterval.value = data.profile.hydrationReminderIntervalMinutes;
  seededFromProfile = true;
}, { immediate: true });

const onRemindersToggle = async (nextEnabled: boolean) => {
  const succeeded = nextEnabled
    ? await enableReminders(reminderInterval.value)
    : await disableReminders(reminderInterval.value);
  if (succeeded) remindersEnabled.value = nextEnabled;
};

const onIntervalChange = async () => {
  if (remindersEnabled.value) await enableReminders(reminderInterval.value);
};

const { mutateAsync: saveTarget, isLoading: targetSaving } = useSetNutritionTarget();
// UiMetricInput's model type is `number | string | undefined` (no `null`), so these use
// `undefined` for "empty" rather than the plan's literal `null`, matching how FourthStep.vue
// binds its optional targetWeight field to the same component.
const targetCalories = ref<number | undefined>(undefined);
const targetProtein = ref<number | undefined>(undefined);
const targetCarbs = ref<number | undefined>(undefined);
const targetFat = ref<number | undefined>(undefined);
let seededTargetFromProfile = false;
watch(profileData, (data) => {
  if (seededTargetFromProfile || !data?.profile) return;
  const target = data.profile.nutritionTarget;
  targetCalories.value = target?.calories ?? undefined;
  targetProtein.value = target?.proteinG ?? undefined;
  targetCarbs.value = target?.carbsG ?? undefined;
  targetFat.value = target?.fatG ?? undefined;
  seededTargetFromProfile = true;
}, { immediate: true });

const onSaveTarget = async () => {
  const hasAllFields =
    targetCalories.value !== undefined && targetProtein.value !== undefined &&
    targetCarbs.value !== undefined && targetFat.value !== undefined;
  try {
    await saveTarget(
      hasAllFields
        ? { calories: targetCalories.value!, proteinG: targetProtein.value!, carbsG: targetCarbs.value!, fatG: targetFat.value! }
        : null,
    );
    if (!hasAllFields) {
      // A partial save clears the target server-side; reflect that in the UI instead of
      // leaving stale partially-filled fields on screen.
      targetCalories.value = undefined;
      targetProtein.value = undefined;
      targetCarbs.value = undefined;
      targetFat.value = undefined;
    }
  } catch {
    // Swallow: on failure the fields simply stay as the user left them.
  }
};

// Body metrics: the read+write stack (body_metrics/body_metric_measurements tables,
// BodyMetricsRepository/Service, GET+POST routes, useRecordBodyMetric) already existed
// end to end before this section -- this is the first UI in the app that calls any of it.
//
// Relationship to the weight already shown elsewhere: Home's weightTrend sparkline
// (server/services/home.service.ts) and this page's own BMI/TDEE stats
// (server/services/profile.service.ts's getComputedStats) both already read from
// this exact same body_metrics table via BodyMetricsRepository.findForUser -- and
// onboarding's "weight" step already writes its initial value into body_metrics too
// (ProfileService.completeOnboarding). So there is only one weight-tracking system in
// this codebase, not two: this form is simply the first place a user can add a second
// (or Nth) entry to it after onboarding seeds the first one. Logging here immediately
// affects Home's sparkline and this page's own stats via the query-cache invalidation
// in useRecordBodyMetric.
const { data: bodyMetricsData } = useBodyMetrics();
const { mutateAsync: recordBodyMetricAsync, isLoading: recordingBodyMetric } = useRecordBodyMetric();

const newWeightKg = ref<number | undefined>(undefined);
const newBodyFatPct = ref<number | undefined>(undefined);
const draftMeasurements = ref<{ key: string; valueCm: number }[]>([]);
const newMeasurementKey = ref("");
const newMeasurementValueCm = ref<number | undefined>(undefined);

const recentBodyMetrics = computed(() => (bodyMetricsData.value ?? []).slice(0, 5));

const addDraftMeasurement = () => {
  const key = newMeasurementKey.value.trim();
  if (!key || !newMeasurementValueCm.value || newMeasurementValueCm.value <= 0) return;
  draftMeasurements.value.push({ key, valueCm: newMeasurementValueCm.value });
  newMeasurementKey.value = "";
  newMeasurementValueCm.value = undefined;
};
const removeDraftMeasurement = (index: number) => draftMeasurements.value.splice(index, 1);

const onRecordBodyMetric = async () => {
  if (!newWeightKg.value || newWeightKg.value <= 0) return;
  try {
    await recordBodyMetricAsync({
      recordedAt: new Date().toISOString().slice(0, 10),
      weightKg: newWeightKg.value,
      bodyFatPct: newBodyFatPct.value ?? null,
      source: "manual",
      measurements: draftMeasurements.value,
    });
    newWeightKg.value = undefined;
    newBodyFatPct.value = undefined;
    draftMeasurements.value = [];
  } catch {
    // Swallow: on failure the form stays populated with the user's input intact.
  }
};

interface AchievementCard {
  key: string;
  icon: string;
  name: string;
  description: string;
  unlocked: boolean;
  progress?: { current: number; target: number; unit: string };
}

interface AchievementGroup {
  key: string;
  label: string;
  icon: Component;
  iconClass: string;
  items: AchievementCard[];
}

// Every published achievement's `criteriaType` maps onto one of the page's four
// hand-designed groups. `target_hit` has no seeded achievements yet, but is grouped under
// "Other" rather than silently dropped in case one is published later.
const GROUP_META: Record<AchievementCriteriaType, { key: string; label: string; icon: Component; iconClass: string }> = {
  streak_length: { key: "streaks", label: "Streaks", icon: FlameIcon, iconClass: "text-primary" },
  session_count: { key: "sessions", label: "Sessions", icon: DumbbellIcon, iconClass: "text-foreground" },
  pr_count: { key: "prs", label: "Personal Records", icon: TrendingUpIcon, iconClass: "text-lime" },
  total_volume_kg: { key: "volume", label: "Volume", icon: WeightIcon, iconClass: "text-foreground" },
  target_hit: { key: "other", label: "Other", icon: TrophyIcon, iconClass: "text-foreground" },
};
const GROUP_ORDER: AchievementCriteriaType[] = ["streak_length", "session_count", "pr_count", "total_volume_kg", "target_hit"];

const { data: achievementsData } = useAchievements();

const groups = computed<AchievementGroup[]>(() => {
  const byType = new Map<AchievementCriteriaType, AchievementCard[]>();
  for (const achievement of achievementsData.value ?? []) {
    const card: AchievementCard = {
      key: achievement.key,
      icon: achievement.icon ?? "🏅",
      name: achievement.name,
      description: achievement.description ?? "",
      unlocked: achievement.unlocked,
      progress: achievement.progress ?? undefined,
    };
    const items = byType.get(achievement.criteriaType) ?? [];
    items.push(card);
    byType.set(achievement.criteriaType, items);
  }
  return GROUP_ORDER
    .filter((type) => byType.has(type))
    .map((type) => ({ ...GROUP_META[type], items: byType.get(type)! }));
});

const totalCount = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0));
const unlockedCount = computed(() => groups.value.reduce((sum, group) => sum + group.items.filter((item) => item.unlocked).length, 0));
const unlockedPct = computed(() => (totalCount.value === 0 ? 0 : Math.round((unlockedCount.value / totalCount.value) * 100)));

const progressPct = (card: AchievementCard): number => {
  if (!card.progress) return 0;
  return Math.min(100, Math.round((card.progress.current / card.progress.target) * 100));
};

const { mutateAsync: logout, isLoading: loggingOut } = useLogout();

const onLogout = async () => {
  try {
    await logout();
  } catch {
    // Swallow: even if the request fails, fall through and clear the client-side session below.
  }
  await navigateTo("/login");
};
</script>

<template>
  <main class="mx-auto max-w-xl space-y-8 p-8">
    <h1 class="font-heading text-2xl uppercase text-foreground">Profile</h1>

    <section class="space-y-3">
      <div class="flex items-center gap-2">
        <BellIcon class="size-4.5 text-primary" />
        <h2 class="font-heading text-lg uppercase text-foreground">Hydration Reminders</h2>
      </div>
      <div class="space-y-4 rounded-xl border border-surface-strong bg-card p-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-semibold text-foreground">Remind me to drink water</p>
            <p class="text-xs text-muted-foreground">Push notifications while the app's installed.</p>
          </div>
          <UiCheckbox
            :model-value="remindersEnabled"
            :disabled="reminderLoading"
            @update:model-value="(value) => onRemindersToggle(!!value)"
          />
        </div>
        <div v-if="remindersEnabled" class="flex items-center justify-between gap-4 border-t border-surface-strong pt-4">
          <p class="text-sm text-muted-foreground">Every</p>
          <UiNativeSelect v-model="reminderInterval" class="w-32" :disabled="reminderLoading" @update:model-value="onIntervalChange">
            <UiNativeSelectOption :value="60">1 hour</UiNativeSelectOption>
            <UiNativeSelectOption :value="120">2 hours</UiNativeSelectOption>
            <UiNativeSelectOption :value="180">3 hours</UiNativeSelectOption>
            <UiNativeSelectOption :value="240">4 hours</UiNativeSelectOption>
          </UiNativeSelect>
        </div>
        <p v-if="reminderError" class="text-xs text-destructive">{{ reminderError }}</p>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center gap-2">
        <UtensilsIcon class="size-4.5 text-lime" />
        <h2 class="font-heading text-lg uppercase text-foreground">Nutrition Target</h2>
      </div>
      <div class="space-y-4 rounded-xl border border-surface-strong bg-card p-4">
        <p class="text-xs text-muted-foreground">Leave any field blank to clear your target entirely.</p>
        <div class="grid grid-cols-2 gap-3">
          <UiMetricInput v-model="targetCalories" unit="cal" />
          <UiMetricInput v-model="targetProtein" unit="g protein" />
          <UiMetricInput v-model="targetCarbs" unit="g carbs" />
          <UiMetricInput v-model="targetFat" unit="g fat" />
        </div>
        <Button variant="secondary" size="sm" :disabled="targetSaving" @click="onSaveTarget">Save target</Button>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center gap-2">
        <ScaleIcon class="size-4.5 text-cyan-pale" />
        <h2 class="font-heading text-lg uppercase text-foreground">Body Metrics</h2>
      </div>
      <div class="space-y-4 rounded-xl border border-surface-strong bg-card p-4">
        <div class="grid grid-cols-2 gap-3">
          <UiMetricInput v-model="newWeightKg" label="Weight" unit="KG" />
          <UiMetricInput v-model="newBodyFatPct" label="Body Fat" unit="%" />
        </div>

        <div class="space-y-2">
          <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Measurements</p>
          <TransitionGroup tag="div" name="row" class="space-y-2">
            <div
              v-for="(measurement, index) in draftMeasurements"
              :key="index"
              class="flex items-center justify-between gap-2 rounded-lg border border-surface-strong bg-popover px-3 py-2"
            >
              <span class="min-w-0 truncate text-sm capitalize text-foreground">{{ measurement.key }} -- {{ measurement.valueCm }}cm</span>
              <button class="shrink-0 rounded-md p-1 transition-transform active:scale-90" aria-label="Remove measurement" @click="removeDraftMeasurement(index)">
                <TrashIcon class="size-3.5 text-muted-foreground" />
              </button>
            </div>
          </TransitionGroup>
          <div class="flex gap-2">
            <UiInput v-model="newMeasurementKey" placeholder="e.g. waist" class="flex-1" />
            <UiMetricInput v-model="newMeasurementValueCm" unit="cm" class="w-28" />
            <Button
              size="lg"
              class="shrink-0 rounded-lg"
              aria-label="Add measurement"
              :disabled="!newMeasurementKey.trim() || !newMeasurementValueCm || newMeasurementValueCm <= 0"
              @click="addDraftMeasurement"
            >
              <PlusIcon class="size-5" />
            </Button>
          </div>
        </div>

        <Button
          size="lg"
          class="w-full rounded-full uppercase"
          :disabled="!newWeightKg || newWeightKg <= 0 || recordingBodyMetric"
          @click="onRecordBodyMetric"
        >
          Log Entry
        </Button>

        <div v-if="recentBodyMetrics.length" class="space-y-2 border-t border-surface-strong pt-4">
          <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Recent entries</p>
          <div v-for="metric in recentBodyMetrics" :key="metric.id" class="flex items-center justify-between gap-2 text-sm">
            <span class="text-muted-foreground">{{ metric.recordedAt }}</span>
            <span class="text-foreground [font-variant-numeric:tabular-nums]">
              {{ metric.weightKg }}kg<span v-if="metric.bodyFatPct !== null"> · {{ metric.bodyFatPct }}% BF</span>
            </span>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="font-heading text-xl uppercase text-foreground">Achievements</h2>
        <span class="font-mono text-xs font-bold uppercase tracking-[1.2px] text-peach [font-variant-numeric:tabular-nums]">
          {{ unlockedCount }}/{{ totalCount }}
        </span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary transition-[width]" :style="{ width: `${unlockedPct}%` }" />
      </div>
    </section>

    <section v-for="group in groups" :key="group.key" class="space-y-3">
      <div class="flex items-center gap-2">
        <component :is="group.icon" class="size-4.5" :class="group.iconClass" />
        <h2 class="font-heading text-lg uppercase text-foreground">{{ group.label }}</h2>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div
          v-for="card in group.items"
          :key="card.key"
          class="relative flex flex-col gap-2 rounded-xl border border-surface-strong bg-card p-4"
          :class="!card.unlocked && 'opacity-70'"
        >
          <div
            v-if="!card.unlocked"
            class="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-popover"
          >
            <LockIcon class="size-3 text-muted-foreground" />
          </div>
          <div
            class="flex size-11 items-center justify-center rounded-full text-xl"
            :class="card.unlocked ? 'bg-primary shadow-[0_0_16px_0_rgba(255,87,34,0.35)]' : 'bg-muted grayscale'"
          >
            {{ card.icon }}
          </div>
          <div class="space-y-0.5">
            <p class="text-sm font-semibold text-foreground">{{ card.name }}</p>
            <p class="text-xs leading-4 text-muted-foreground">{{ card.description }}</p>
          </div>
          <div v-if="!card.unlocked && card.progress" class="mt-1 space-y-1">
            <div class="h-1 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-outline-warm" :style="{ width: `${progressPct(card)}%` }" />
            </div>
            <p class="font-mono text-[10px] text-muted-foreground [font-variant-numeric:tabular-nums]">
              {{ card.progress.current }}/{{ card.progress.target }} {{ card.progress.unit }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center gap-2">
        <LogOutIcon class="size-4.5 text-destructive" />
        <h2 class="font-heading text-lg uppercase text-foreground">Account</h2>
      </div>
      <div class="space-y-4 rounded-xl border border-surface-strong bg-card p-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-semibold text-foreground">Log out</p>
            <p class="text-xs text-muted-foreground">Sign out of this device.</p>
          </div>
          <Button variant="secondary" size="sm" :disabled="loggingOut" @click="onLogout">Log Out</Button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.row-enter-active,
.row-leave-active,
.row-move {
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}
.row-enter-from,
.row-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.row-leave-active {
  position: absolute;
  width: 100%;
}
</style>
