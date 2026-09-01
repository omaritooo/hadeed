<script setup lang="ts">
import { DropletIcon, FlameIcon, FlameKindlingIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";

definePageMeta({});
const { data: profile, isLoading, error, isPending } = useProfile();
const { data } = useHomeStats();
const now = useNow();
useDateFormat(now, "MMM DD, YYYY");
const timeOfDay = computed(() => {
  if (now.value.getHours() >= 5 && now.value.getHours() <= 11) return `Good Morning, `;
  else if (now.value.getHours() >= 12 && now.value.getHours() <= 17)
    return `Good afternoon, `;
  else return `Good evening, `;
});
console.log(profile.value);
console.log(data.value);

const { data: hydration } = useHydrationStatus();
const logHydration = useLogHydration();
const hydrationPct = computed(() => {
  if (!hydration.value?.targetMl) return 0;
  return Math.min(
    100,
    Math.round((hydration.value.totalMl / hydration.value.targetMl) * 100)
  );
});
</script>

<template>
  <div class="px-4 py-4 flex flex-col gap-y-4" v-if="!isLoading || !isPending">
    <span class="font-mono text-muted-foreground">
      {{ useDateFormat(now, "MMM DD, YYYY") }}
    </span>
    <span class="flex flex-col gap-y-1 text-4xl font-heading font-semibold">
      {{ timeOfDay ?? "NULL" }}
      <span>{{ profile?.profile?.displayName?.split(" ")[0] }} </span>
    </span>

    <div class="flex gap-x-2">
      <UiCard>
        <span class="flex gap-x-2 items-center flex-row">
          <FlameIcon fill="currentColor" class="text-primary" />
          <h2 class="text-3xl">{{ data?.streak.current ?? 0 }}</h2></span
        >
      </UiCard>
      <UiCard>
        <span class="flex gap-x-2 items-center flex-row">
          <FlameIcon fill="currentColor" class="text-primary" />
          <h2 class="text-3xl">14</h2></span
        >
      </UiCard>
    </div>

    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <DropletIcon class="size-4.5 text-md-secondary" />
        <h2 class="font-heading text-lg uppercase text-foreground">Hydration</h2>
      </div>
      <div class="space-y-4 rounded-xl border border-md-surface-variant bg-card p-5">
        <div class="flex items-end justify-between">
          <div>
            <p
              class="font-heading text-2xl text-foreground [font-variant-numeric:tabular-nums]"
            >
              {{ (hydration?.totalMl ?? 0).toLocaleString()
              }}<span class="font-sans text-sm font-normal text-muted-foreground"
                >ml</span
              >
            </p>
            <p v-if="hydration?.targetMl" class="text-xs text-muted-foreground">
              {{ hydration.remainingMl?.toLocaleString() }}ml to go
            </p>
            <p v-else class="text-xs text-muted-foreground">
              No daily target --
              <NuxtLink to="/profile" class="text-md-secondary underline"
                >set one</NuxtLink
              >
            </p>
          </div>
          <span
            v-if="hydration?.targetMl"
            class="font-mono text-xs text-muted-foreground [font-variant-numeric:tabular-nums]"
          >
            {{ hydration.targetMl.toLocaleString() }}ml goal
          </span>
        </div>
        <div
          v-if="hydration?.targetMl"
          class="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            class="h-full rounded-full bg-md-secondary-container transition-[width]"
            :style="{ width: `${hydrationPct}%` }"
          />
        </div>
        <div class="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            :disabled="logHydration.isLoading.value"
            @click="logHydration.mutate(250)"
            >+250ml</Button
          >
          <Button
            variant="secondary"
            size="sm"
            :disabled="logHydration.isLoading.value"
            @click="logHydration.mutate(500)"
            >+500ml</Button
          >
        </div>
      </div>
    </div>
  </div>
  <div v-else>Is Loading</div>
</template>
