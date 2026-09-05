<script setup lang="ts">
const drawerOpen = ref(true);
</script>

<template>
  <main class="mx-auto max-w-xl p-8">
    <ExerciseDetailDrawer v-model:open="drawerOpen" exercise-id="Barbell_Bench_Press_-_Medium_Grip" />
  </main>
</template>
