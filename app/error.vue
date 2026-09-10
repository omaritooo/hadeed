<script setup lang="ts">
import type { NuxtError } from "#app";
import { Button } from "@/components/ui/button";

const props = defineProps<{
  error: NuxtError;
}>();

const isNotFound = computed(() => props.error.statusCode === 404);
const heading = computed(() => (isNotFound.value ? "Page not found" : "Something went wrong"));

const goHome = () => clearError({ redirect: "/" });
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
    <h1 class="font-heading text-2xl uppercase text-foreground">{{ heading }}</h1>
    <p v-if="error.message" class="text-muted-foreground">{{ error.message }}</p>
    <Button @click="goHome">Back to Home</Button>
  </main>
</template>
