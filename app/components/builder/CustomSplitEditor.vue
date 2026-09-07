<script setup lang="ts">
import { PlusIcon, TrashIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateSplitDayInput } from "~~/server/repositories/block.repository";

const days = defineModel<CreateSplitDayInput[]>("days", { required: true });
const emit = defineEmits<{ continue: [] }>();

const addDay = () => {
  days.value = [
    ...days.value,
    { name: `Day ${days.value.length + 1}`, dayOfWeek: days.value.length, location: "gym", isRestDay: false, exercises: [] },
  ];
};

const removeDay = (index: number) => {
  days.value = days.value.filter((_, i) => i !== index);
};

const canContinue = computed(() => days.value.some(day => !day.isRestDay && day.exercises.length > 0));
</script>

<template>
  <div class="flex flex-col gap-y-4">
    <UiCard v-for="(day, index) in days" :key="index" class="space-y-3">
      <div class="flex items-center gap-2">
        <Input v-model="day.name" placeholder="Day name" class="flex-1" />
        <button @click="removeDay(index)"><TrashIcon class="size-4 text-muted-foreground" /></button>
      </div>
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        <input v-model="day.isRestDay" type="checkbox">
        Rest day
      </label>

      <BuilderDayExercisePicker v-if="!day.isRestDay" v-model:exercises="day.exercises" />
    </UiCard>

    <Button variant="secondary" @click="addDay"><PlusIcon class="size-4" /> Add Day</Button>
    <Button size="lg" :disabled="!canContinue" @click="emit('continue')">Continue</Button>
  </div>
</template>
