<script setup lang="ts">
import {
  ChartLineIcon,
  DumbbellIcon,
  HomeIcon,
  LayoutGridIcon,
  UserIcon,
} from "@lucide/vue";
import { cn } from "@/lib/utils";

const route = useRoute();

const items = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/workouts", label: "Workouts", icon: DumbbellIcon },
  { to: "/builder", label: "Builder", icon: LayoutGridIcon },
  { to: "/stats", label: "Stats", icon: ChartLineIcon },
  { to: "/profile", label: "Profile", icon: UserIcon },
];
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-50 border-t border-md-surface-variant/40 bg-md-surface-container-low/80 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
  >
    <div class="mx-auto flex max-w-xl items-center justify-around px-2 py-2">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :class="
          cn(
            'flex flex-col items-center gap-1 px-4 py-1.5 transition-colors',
            route.path === item.to ? 'text-primary' : 'text-muted-foreground'
          )
        "
      >
        <component
          :is="item.icon"
          class="size-5"
          :stroke-width="route.path === item.to ? 2.5 : 1.75"
        />
        <span
          class="font-mono text-[10px] uppercase tracking-[1px]"
          :class="route.path === item.to ? 'font-bold' : 'font-medium'"
          >{{ item.label }}</span
        >
      </NuxtLink>
    </div>
  </nav>
</template>
