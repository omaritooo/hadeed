<script setup lang="ts">
import type { RadioGroupItemProps } from "reka-ui";
import type { Component, HTMLAttributes } from "vue";
import { CheckIcon } from "@lucide/vue";
import { reactiveOmit } from "@vueuse/core";
import { RadioGroupIndicator, RadioGroupItem, useForwardProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<
  RadioGroupItemProps & {
    icon: Component;
    title: string;
    description?: string;
    class?: HTMLAttributes["class"];
  }
>();

const delegatedProps = reactiveOmit(props, "class", "icon", "title", "description");

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <RadioGroupItem
    data-slot="option-card"
    v-bind="forwardedProps"
    :class="
      cn(
        'border-border bg-card group data-[state=checked]:border-primary flex w-full items-center gap-4 rounded-xl border p-4 text-left shadow-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        props.class
      )
    "
  >
    <div
      class="bg-muted text-foreground group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-lg"
    >
      <component :is="icon" class="size-6" />
    </div>

    <div class="flex-1 space-y-1">
      <p class="text-foreground font-semibold">{{ title }}</p>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </div>

    <div
      class="border-md-outline flex size-8 shrink-0 items-center justify-center rounded-full border-2 group-data-[state=checked]:border-none group-data-[state=checked]:bg-primary"
    >
      <RadioGroupIndicator data-slot="option-card-indicator">
        <CheckIcon class="text-primary-foreground size-4" />
      </RadioGroupIndicator>
    </div>
  </RadioGroupItem>
</template>
