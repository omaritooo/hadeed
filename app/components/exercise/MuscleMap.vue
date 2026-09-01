<script setup lang="ts">
import { buildMuscleBodyState } from "@/lib/muscle-body-state";
import { BodyChart, ViewSide } from "body-muscles";

const props = defineProps<{
  primaryMuscles: string[];
  secondaryMuscles: string[];
}>();

const bodyState = computed(() => buildMuscleBodyState(props.primaryMuscles, props.secondaryMuscles));

const frontContainer = ref<HTMLElement | null>(null);
const backContainer = ref<HTMLElement | null>(null);
let frontChart: BodyChart | null = null;
let backChart: BodyChart | null = null;

onMounted(() => {
  if (frontContainer.value) {
    frontChart = new BodyChart(frontContainer.value, {
      view: ViewSide.FRONT,
      bodyState: bodyState.value,
      showViewLabel: true,
    });
  }
  if (backContainer.value) {
    backChart = new BodyChart(backContainer.value, {
      view: ViewSide.BACK,
      bodyState: bodyState.value,
      showViewLabel: true,
    });
  }
});

watch(bodyState, (state) => {
  frontChart?.update({ bodyState: state });
  backChart?.update({ bodyState: state });
});

onUnmounted(() => {
  frontChart?.destroy();
  backChart?.destroy();
});
</script>

<template>
  <div class="flex justify-center gap-8">
    <div ref="frontContainer" class="w-32" />
    <div ref="backContainer" class="w-32" />
  </div>
</template>
