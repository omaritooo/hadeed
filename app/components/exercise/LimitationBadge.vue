<script setup lang="ts">
import { TriangleAlertIcon } from "@lucide/vue";
import { conflictingAreas, JOINT_AREA_LABELS, type JointArea } from "~~/shared/lib/joint-areas";

// Reads the profile itself, so call sites only pass the exercise's stressors. `undefined` covers an
// Exercise cached from before stressors existed, and exercises whose details haven't loaded yet.
const props = defineProps<{ stressors: readonly JointArea[] | undefined }>();

const { data: profile } = useProfile();
const conflicts = computed(() => conflictingAreas(props.stressors ?? [], profile.value?.profile?.limitations ?? []));
const description = computed(() =>
  `Commonly loads your ${conflicts.value.map(area => JOINT_AREA_LABELS[area].toLowerCase()).join(" and ")}`,
);
</script>

<template>
  <UiBadge
    v-if="conflicts.length"
    class="shrink-0 gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400"
    :title="description"
  >
    <TriangleAlertIcon class="size-3" aria-hidden="true" />
    <span class="sr-only">{{ description }}</span>
    <span aria-hidden="true">{{ conflicts.map(area => JOINT_AREA_LABELS[area]).join(" · ") }}</span>
  </UiBadge>
</template>
