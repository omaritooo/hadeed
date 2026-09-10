<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Render the mark alone, with the wordmark kept for screen readers only. */
    markOnly?: boolean;
  }>(),
  { markOnly: false }
);
</script>

<template>
  <span class="flex items-center gap-2">
    <!-- The mark is the letter H built as a dumbbell: the two uprights are the plates,
         the crossbar is the bar. Sized in `em` so it scales with whatever type size the
         surrounding context sets, and filled with currentColor so it inherits the theme
         rather than hard-coding the orange the standalone icon files use. -->
    <svg
      viewBox="0 0 40 46"
      class="h-[1.1em] w-auto shrink-0 text-primary"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="10" height="46" rx="4" />
      <rect x="30" y="0" width="10" height="46" rx="4" />
      <!-- Square ends, tucked 2 units inside each plate: rounding them leaves the
           shoulders poking out of the join as visible notches. -->
      <rect x="8" y="19.5" width="24" height="7" />
    </svg>
    <span
      :class="
        markOnly
          ? 'sr-only'
          : 'font-heading text-lg uppercase tracking-[-0.02em] text-foreground'
      "
      >Hadeed</span
    >
  </span>
</template>
