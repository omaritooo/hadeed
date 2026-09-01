<script setup lang="ts">
import { BellIcon, DumbbellIcon, FlameIcon, LockIcon, TrendingUpIcon, WeightIcon } from "@lucide/vue";
import type { Component } from "vue";

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

const groups: AchievementGroup[] = [
  {
    key: "streaks",
    label: "Streaks",
    icon: FlameIcon,
    iconClass: "text-primary",
    items: [
      { key: "week_streak", icon: "🔥", name: "7-Day Streak", description: "Hit every scheduled day for a week straight.", unlocked: false, progress: { current: 3, target: 7, unit: "days" } },
      { key: "month_streak", icon: "🏆", name: "30-Day Streak", description: "A full month of hitting every scheduled day.", unlocked: false, progress: { current: 3, target: 30, unit: "days" } },
      { key: "iron_will", icon: "⚡", name: "100-Day Streak", description: "Trained every scheduled day for 100 days straight.", unlocked: false, progress: { current: 3, target: 100, unit: "days" } },
    ],
  },
  {
    key: "sessions",
    label: "Sessions",
    icon: DumbbellIcon,
    iconClass: "text-foreground",
    items: [
      { key: "first_session", icon: "🎉", name: "First Session Logged", description: "Logged your first workout session.", unlocked: true },
      { key: "ten_sessions", icon: "💪", name: "Regular", description: "Completed 10 workout sessions.", unlocked: true },
      { key: "fifty_sessions", icon: "🐀", name: "Gym Rat", description: "Completed 50 workout sessions.", unlocked: false, progress: { current: 16, target: 50, unit: "sessions" } },
      { key: "hundred_sessions", icon: "🛡️", name: "Iron Veteran", description: "Completed 100 workout sessions.", unlocked: false, progress: { current: 16, target: 100, unit: "sessions" } },
    ],
  },
  {
    key: "prs",
    label: "Personal Records",
    icon: TrendingUpIcon,
    iconClass: "text-md-tertiary",
    items: [
      { key: "first_pr", icon: "🥇", name: "First PR", description: "Logged your first personal record.", unlocked: true },
      { key: "pr_five", icon: "📈", name: "Personal Best Club", description: "Set 5 personal records.", unlocked: false, progress: { current: 2, target: 5, unit: "PRs" } },
      { key: "pr_twenty", icon: "🚀", name: "Record Breaker", description: "Set 20 personal records.", unlocked: false, progress: { current: 2, target: 20, unit: "PRs" } },
    ],
  },
  {
    key: "volume",
    label: "Volume",
    icon: WeightIcon,
    iconClass: "text-foreground",
    items: [
      { key: "volume_car", icon: "🚗", name: "Lifted a Car", description: "Lifted a cumulative 1,500 kg -- about the weight of a small car.", unlocked: true },
      { key: "volume_elephant", icon: "🐘", name: "Lifted an Elephant", description: "Lifted a cumulative 5,400 kg -- about the weight of an African elephant.", unlocked: true },
      { key: "volume_bus", icon: "🚌", name: "Lifted a School Bus", description: "Lifted a cumulative 12,000 kg -- about the weight of a school bus.", unlocked: true },
    ],
  },
];

const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
const unlockedCount = groups.reduce((sum, group) => sum + group.items.filter((item) => item.unlocked).length, 0);
const unlockedPct = Math.round((unlockedCount / totalCount) * 100);

const progressPct = (card: AchievementCard): number => {
  if (!card.progress) return 0;
  return Math.min(100, Math.round((card.progress.current / card.progress.target) * 100));
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
      <div class="space-y-4 rounded-xl border border-md-surface-variant bg-card p-4">
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
        <div v-if="remindersEnabled" class="flex items-center justify-between gap-4 border-t border-md-surface-variant pt-4">
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
      <div class="flex items-center justify-between">
        <h2 class="font-heading text-xl uppercase text-foreground">Achievements</h2>
        <span class="font-mono text-xs font-bold uppercase tracking-[1.2px] text-md-primary [font-variant-numeric:tabular-nums]">
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
          class="relative flex flex-col gap-2 rounded-xl border border-md-surface-variant bg-card p-4"
          :class="!card.unlocked && 'opacity-70'"
        >
          <div
            v-if="!card.unlocked"
            class="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-md-surface-container-high"
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
              <div class="h-full rounded-full bg-md-outline" :style="{ width: `${progressPct(card)}%` }" />
            </div>
            <p class="font-mono text-[10px] text-muted-foreground [font-variant-numeric:tabular-nums]">
              {{ card.progress.current }}/{{ card.progress.target }} {{ card.progress.unit }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
