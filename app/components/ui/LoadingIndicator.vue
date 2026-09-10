<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Accessible (and, unless `inline`, visible) description of what's loading. */
    label?: string;
    /** Horizontal row for in-flow use next to other content, rather than a centred block. */
    inline?: boolean;
  }>(),
  { label: "Loading", inline: false }
);

// Two <use> references share one shape definition, so the id has to be unique per instance
// or a second loader on the same page would point at the first one's geometry.
const uid = useId();
</script>

<template>
  <div
    role="status"
    :class="
      inline
        ? 'flex items-center gap-x-2'
        : 'flex flex-col items-center justify-center gap-y-3 py-10'
    "
  >
    <svg
      class="dumbbell h-auto"
      :class="inline ? 'w-8' : 'w-16'"
      viewBox="0 0 48 24"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <g :id="`${uid}-shape`">
          <rect x="1" y="4" width="5" height="16" rx="2" />
          <rect x="7.5" y="7" width="4" height="10" rx="1.5" />
          <rect x="11.5" y="10.5" width="25" height="3" rx="1.5" />
          <rect x="36.5" y="7" width="4" height="10" rx="1.5" />
          <rect x="42" y="4" width="5" height="16" rx="2" />
        </g>
        <clipPath :id="`${uid}-clip`">
          <rect class="dumbbell__wipe" x="0" y="0" width="48" height="24" />
        </clipPath>
      </defs>

      <!-- Unfilled track, then the same geometry in primary revealed by the wiping clip. -->
      <use :href="`#${uid}-shape`" class="text-surface-strong" fill="currentColor" />
      <use
        :href="`#${uid}-shape`"
        class="text-primary"
        fill="currentColor"
        :clip-path="`url(#${uid}-clip)`"
      />
    </svg>

    <p
      :class="
        inline
          ? 'text-sm text-muted-foreground'
          : 'font-mono text-xs uppercase tracking-[1.2px] text-muted-foreground'
      "
    >
      {{ label }}
    </p>
  </div>
</template>

<style scoped>
.dumbbell__wipe {
  /* fill-box makes the origin the rect's own geometry rather than the SVG user space, so
     the sweep starts at the left plate instead of the viewBox origin. */
  transform-box: fill-box;
  transform-origin: left center;
  animation: dumbbell-fill 1.2s cubic-bezier(0.65, 0, 0.35, 1) infinite alternate;
}

@keyframes dumbbell-fill {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* A loader is the one place motion shouldn't simply be removed -- the app's usual
   `motion-safe:` gating would freeze the wipe mid-sweep, leaving what reads as a broken,
   half-drawn icon. Slowing it keeps the busy state legible without the fast sweep. */
@media (prefers-reduced-motion: reduce) {
  .dumbbell__wipe {
    animation-duration: 4s;
  }
}
</style>
