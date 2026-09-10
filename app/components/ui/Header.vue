<script lang="ts" setup>
import { DumbbellIcon, UserRoundIcon, ZapIcon } from "@lucide/vue";
const { data: stats } = useHomeStats();
</script>

<template>
  <nav
    class="sticky top-0 z-40 flex items-center justify-between border-b border-surface-strong bg-background/90 px-4 py-3 backdrop-blur-md motion-safe:animate-[header-in_0.5s_cubic-bezier(0.16,1,0.3,1)_backwards]"
  >
    <UiAvatar class="size-9 border border-surface-strong bg-popover">
      <UiAvatarFallback class="bg-transparent text-muted-foreground">
        <UserRoundIcon class="size-4.5" />
      </UiAvatarFallback>
    </UiAvatar>

    <div class="flex items-center gap-1.5">
      <DumbbellIcon class="size-4.5 text-primary" />
      <h1 class="font-heading text-lg uppercase tracking-[-0.02em] text-foreground">
        Hadeed
      </h1>
    </div>

    <div class="flex items-center gap-1.5 rounded-full bg-popover py-1 pl-2 pr-3">
      <ZapIcon class="size-3.5 text-primary" />
      <span
        class="font-mono text-xs flex gap-x-1 font-bold [font-variant-numeric:tabular-nums]"
      >
        <span class="text-muted-foreground">LVL</span>
        <span class="text-foreground">{{ stats?.xp.level }}</span>
      </span>
    </div>
  </nav>
</template>
