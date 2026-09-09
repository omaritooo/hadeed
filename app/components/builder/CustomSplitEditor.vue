<script setup lang="ts">
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateSplitDayInput } from "~~/server/repositories/block.repository";

const days = defineModel<CreateSplitDayInput[]>("days", { required: true });
withDefaults(defineProps<{ showContinue?: boolean }>(), { showContinue: true });
const emit = defineEmits<{ continue: [] }>();

const dayIds = ref<string[]>(days.value.map(() => crypto.randomUUID()));

const addDay = () => {
  days.value = [
    ...days.value,
    { name: `Day ${days.value.length + 1}`, dayOfWeek: days.value.length, location: "gym", isRestDay: false, exercises: [] },
  ];
  dayIds.value = [...dayIds.value, crypto.randomUUID()];
};

const removeDay = (index: number) => {
  days.value = days.value.filter((_, i) => i !== index);
  dayIds.value = dayIds.value.filter((_, i) => i !== index);
};

const moveDay = (index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= days.value.length) return;
  const newDays = [...days.value];
  const newIds = [...dayIds.value];
  [newDays[index], newDays[target]] = [newDays[target]!, newDays[index]!];
  [newIds[index], newIds[target]] = [newIds[target]!, newIds[index]!];
  days.value = newDays;
  dayIds.value = newIds;
};

const canContinue = computed(() => days.value.some(day => !day.isRestDay && day.exercises.length > 0));
</script>

<template>
  <div class="flex flex-col gap-y-4">
    <UiCard v-for="(day, index) in days" :key="dayIds[index]" class="space-y-3">
      <div class="flex items-center gap-2">
        <Input v-model="day.name" placeholder="Day name" class="flex-1" />
        <button aria-label="Move day up" :disabled="index === 0" class="disabled:opacity-30" @click="moveDay(index, -1)">
          <ChevronUpIcon class="size-4 text-muted-foreground" />
        </button>
        <button aria-label="Move day down" :disabled="index === days.length - 1" class="disabled:opacity-30" @click="moveDay(index, 1)">
          <ChevronDownIcon class="size-4 text-muted-foreground" />
        </button>
        <button aria-label="Remove day" @click="removeDay(index)"><TrashIcon class="size-4 text-muted-foreground" /></button>
      </div>
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        <input v-model="day.isRestDay" type="checkbox">
        Rest day
      </label>

      <BuilderDayExercisePicker v-if="!day.isRestDay" v-model:exercises="day.exercises" />
    </UiCard>

    <Button variant="secondary" @click="addDay"><PlusIcon class="size-4" /> Add Day</Button>
    <Button v-if="showContinue" size="lg" :disabled="!canContinue" @click="emit('continue')">Continue</Button>
  </div>
</template>
