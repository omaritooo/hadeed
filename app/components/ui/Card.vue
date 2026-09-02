<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <article :class="cn('rounded-md border-[0.5px] border-outline-warm px-4 py-4', props.class)">
    <slot></slot>
  </article>
</template>
