<script setup lang="ts">
import type { WithClassAsProps } from "./interface"
import type { ButtonVariants } from '@/components/ui/button'
import { ArrowLeft } from "@lucide/vue"
import { cn } from "@/lib/utils"
import { Button } from '@/components/ui/button'
import { useCarousel } from "./useCarousel"

const props = withDefaults(defineProps<{
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
}
& WithClassAsProps>(), {
  variant: "outline",
  size: "icon",
})

const { orientation, canScrollPrev, scrollPrev } = useCarousel()
</script>

<template>
  <Button
    data-slot="carousel-previous"
    :disabled="!canScrollPrev"
    :class="cn(
      'absolute size-8 rounded-full',
      // See CarouselNext: the horizontal pair follows the reading direction, the vertical one
      // is centred with `inset-x-0 mx-auto` so nothing physical is left to mirror.
      orientation === 'horizontal'
        ? 'top-1/2 -start-12 -translate-y-1/2'
        : '-top-12 inset-x-0 mx-auto rotate-90',
      props.class,
    )"
    :variant="variant"
    :size="size"
    @click="scrollPrev"
  >
    <slot>
      <ArrowLeft class="rtl:-scale-x-100" />
      <span class="sr-only">Previous Slide</span>
    </slot>
  </Button>
</template>
