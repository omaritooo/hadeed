<script setup lang="ts">
import { Button } from "@/components/ui/button";

const props = defineProps<{ durationSeconds: number }>();
const emit = defineEmits<{ dismiss: [] }>();

const ADD_SECONDS = 15;

const now = useNow({ interval: 1000 });
const endAt = ref(new Date(Date.now() + props.durationSeconds * 1000));

const remainingSeconds = computed(() => Math.max(0, Math.ceil((endAt.value.getTime() - now.value.getTime()) / 1000)));
const isComplete = computed(() => remainingSeconds.value <= 0);

const formattedRemaining = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60);
  const seconds = remainingSeconds.value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

// Best-effort completion buzz — feature-detected, so this is a silent no-op on
// browsers/devices (e.g. iOS Safari) that don't implement the Vibration API.
watch(isComplete, (complete) => {
  if (complete && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(200);
  }
});

const addTime = () => {
  endAt.value = new Date(endAt.value.getTime() + ADD_SECONDS * 1000);
};

const dismiss = () => emit("dismiss");
</script>

<template>
  <UiCard class="flex items-center justify-between gap-3 border-lime/60">
    <div>
      <p class="font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground">
        {{ isComplete ? "Rest complete" : "Resting" }}
      </p>
      <p class="font-heading text-2xl font-semibold text-foreground">
        {{ isComplete ? "0:00" : formattedRemaining }}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <Button v-if="!isComplete" variant="outline" size="sm" @click="addTime">+{{ ADD_SECONDS }}s</Button>
      <Button variant="ghost" size="sm" @click="dismiss">{{ isComplete ? "Dismiss" : "Skip" }}</Button>
    </div>
  </UiCard>
</template>
