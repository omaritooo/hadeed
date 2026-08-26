<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
  valid?: boolean;
}>();
</script>

<template>
  <div
    data-slot="input-group"
    role="group"
    :class="
      cn(
        'group/input-group border-input bg-md-surface-container-highest font-mono relative flex w-full items-center rounded-lg border shadow-xs transition-[color,box-shadow] outline-none',
        'h-14 min-w-0 has-[>textarea]:h-auto',
        props.valid && 'border-md-tertiary/50 ring-1 ring-md-tertiary/20',

        // Variants based on alignment.
        'has-[>[data-align=inline-start]]:[&>input]:pl-2',
        'has-[>[data-align=inline-end]]:[&>input]:pr-2',
        'has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3',
        'has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3',

        // Focus state.
        'has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot=input-group-control]:focus-visible]:ring-3',

        // Error state.
        'has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40',

        props.class
      )
    "
  >
    <slot />
  </div>
</template>
