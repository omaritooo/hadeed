<script setup lang="ts">
import { Button } from "@/components/ui/button";

const props = defineProps<{ exerciseId: string }>();
const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <UiDrawer v-model:open="open">
    <UiDrawerContent>
      <ExerciseDetailContent :exercise-id="props.exerciseId" />
      <UiDrawerFooter>
        <Button size="lg" class="w-full rounded-full uppercase" @click="open = false">
          Close
        </Button>
      </UiDrawerFooter>
    </UiDrawerContent>
  </UiDrawer>
</template>
