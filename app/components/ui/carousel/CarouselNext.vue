<script setup lang="ts">
import type { WithClassAsProps } from "./interface"
import type { ButtonVariants } from '@/components/ui/button'
import { ArrowRight } from "@lucide/vue"
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

const { orientation, canScrollNext, scrollNext } = useCarousel()
</script>

<template>
  <Button
    data-slot="carousel-next"
    :disabled="!canScrollNext"
    :class="cn(
      'absolute size-8 rounded-full',
      // The horizontal buttons flank the track, so they follow the reading direction. The
      // vertical pair only centres itself: `inset-x-0 mx-auto` does that without a physical
      // class, where the usual inset-plus-translate centring could not be mirrored (a translate
      // has no logical form, so flipping only the inset would push the button off centre).
      orientation === 'horizontal'
        ? 'top-1/2 -end-12 -translate-y-1/2'
        : '-bottom-12 inset-x-0 mx-auto rotate-90',
      props.class,
    )"
    :variant="variant"
    :size="size"
    @click="scrollNext"
  >
    <slot>
      <ArrowRight class="rtl:-scale-x-100" />
      <span class="sr-only">Next Slide</span>
    </slot>
  </Button>
</template>
