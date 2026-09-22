<script setup lang="ts">
import type { OutboxOp } from "~~/app/lib/outbox";
import type { UnitSystem } from "~~/shared/lib/progression";
import { Button } from "@/components/ui/button";
import { describeOp, opStatusLine, syncStatusFor } from "~~/app/lib/session-sync";

const props = defineProps<{ sessionId: string, unitSystem: UnitSystem }>();

// Client-only by construction: the page renders this inside <ClientOnly> because the outbox
// plugin isn't registered during SSR, and a server render has nothing queued to report anyway.
const outbox = useOutbox();

const status = computed(() => syncStatusFor(
  outbox.ops.value,
  props.sessionId,
  { online: outbox.online.value, paused: outbox.paused.value },
));

const open = ref(false);
// A queue that drains while the lifter is reading the drawer leaves it open over an empty list;
// closing it here means the sheet goes away at the same moment the pill behind it does.
watch(status, (current) => { if (!current) open.value = false; });

const describe = (op: OutboxOp) => describeOp(op, props.unitSystem);

// Every state is tappable, not just the failed one. A lifter who sees "Offline · 3 pending"
// mid-workout wants to know *which* three, and the same sheet answers that; Retry and Discard
// only appear on the ops that actually need a decision.
const DOT: Record<string, string> = {
  failed: "bg-destructive",
  offline: "bg-muted-foreground/60",
  paused: "bg-muted-foreground/60",
  syncing: "bg-muted-foreground motion-safe:animate-pulse",
};
</script>

<template>
  <button
    v-if="status"
    type="button"
    class="relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs uppercase tracking-[1.2px] after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']"
    :class="status.tone === 'failed' ? 'bg-destructive/15 text-destructive' : 'bg-popover text-muted-foreground'"
    :aria-label="`${status.label}. Open sync details.`"
    @click="open = true"
  >
    <span class="size-1.5 shrink-0 rounded-full" :class="DOT[status.tone]" />
    {{ status.label }}
  </button>

  <UiDrawer v-model:open="open">
    <UiDrawerContent>
      <UiDrawerHeader>
        <UiDrawerTitle class="font-heading text-lg">{{ status?.title }}</UiDrawerTitle>
        <UiDrawerDescription class="text-sm text-muted-foreground">{{ status?.blurb }}</UiDrawerDescription>
      </UiDrawerHeader>

      <div class="space-y-3 px-4">
        <div v-for="op in status?.queued ?? []" :key="op.opId" class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm text-foreground">{{ describe(op) }}</p>
            <p
              class="truncate text-xs"
              :class="op.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{ opStatusLine(op) }}
            </p>
          </div>
          <div v-if="op.status === 'failed'" class="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" @click="outbox.retry(op.opId)">
              Retry
            </Button>
            <Button size="sm" variant="ghost" @click="outbox.discard(op.opId)">
              Discard
            </Button>
          </div>
        </div>
      </div>

      <UiDrawerFooter>
        <Button size="lg" class="w-full rounded-full uppercase" @click="open = false">
          Close
        </Button>
      </UiDrawerFooter>
    </UiDrawerContent>
  </UiDrawer>
</template>
