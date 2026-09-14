<script setup lang="ts">
import { CheckIcon } from "@lucide/vue";
import { JOINT_AREAS, JOINT_AREA_LABELS, type JointArea } from "~~/shared/lib/joint-areas";

const model = defineModel<JointArea[]>({ required: true });

const toggle = (area: JointArea) => {
  model.value = model.value.includes(area) ? model.value.filter(a => a !== area) : [...model.value, area];
};
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap gap-2">
      <button
        v-for="area in JOINT_AREAS"
        :key="area"
        type="button"
        :aria-pressed="model.includes(area)"
        class="flex min-h-9 items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        :class="model.includes(area) ? 'border-foreground bg-foreground text-background' : 'border-surface-strong text-muted-foreground'"
        @click="toggle(area)"
      >
        <CheckIcon v-if="model.includes(area)" class="size-3.5" aria-hidden="true" />
        {{ JOINT_AREA_LABELS[area] }}
      </button>
    </div>
    <p class="text-xs text-muted-foreground">Hadeed flags exercises that commonly load these areas. It isn't medical advice.</p>
  </div>
</template>
