<script setup lang="ts">
import type { AcceptableValue } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "@lucide/vue";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";
import { cn } from "@/lib/utils";
import type { ComboboxOption } from ".";

const props = defineProps<{
  items: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  class?: HTMLAttributes["class"];
  resetSearchTermOnBlur?: boolean;
  resetSearchTermOnSelect?: boolean;
}>();

const model = defineModel<AcceptableValue>();
// By default reka-ui resets this back to the selected value (via `display-value` below) on
// blur/select. Pass `:reset-search-term-on-select="false"` (and/or `-on-blur`) to keep full
// control over `searchTerm`, e.g. when driving a remote search.
const searchTerm = defineModel<string>("searchTerm", { default: "" });

const selectedLabel = computed(() => props.items.find((item) => item.value === model.value)?.label);
</script>

<template>
  <ComboboxRoot
    v-model="model"
    class="w-full"
    :reset-search-term-on-blur="resetSearchTermOnBlur ?? true"
    :reset-search-term-on-select="resetSearchTermOnSelect ?? true"
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger
        as-child
        :disabled="disabled"
      >
        <button
          type="button"
          :class="
            cn(
              'border-input bg-surface-strong flex h-14 w-full items-center justify-between gap-2 rounded-lg border px-4 text-left outline-none transition-transform duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
              props.class,
            )
          "
        >
          <span
            class="truncate text-sm"
            :class="selectedLabel ? 'text-foreground' : 'text-muted-foreground'"
          >
            {{ selectedLabel ?? placeholder ?? 'Select…' }}
          </span>
          <ChevronsUpDownIcon class="text-muted-foreground size-4 shrink-0 opacity-50" />
        </button>
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="6"
        class="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 z-100 flex max-h-80 w-(--reka-combobox-trigger-width) max-w-(--reka-combobox-content-available-width) origin-(--reka-combobox-content-transform-origin) flex-col overflow-hidden rounded-lg border border-surface-strong shadow-md outline-hidden"
      >
        <div class="border-surface-strong flex shrink-0 items-center gap-2 border-b px-3">
          <SearchIcon class="text-muted-foreground size-4 shrink-0" />
          <ComboboxInput
            v-model="searchTerm"
            :display-value="() => selectedLabel ?? ''"
            :placeholder="searchPlaceholder ?? 'Search…'"
            class="placeholder:text-muted-foreground h-11 w-full min-w-0 bg-transparent text-[16px] text-foreground outline-none"
          />
        </div>
        <ComboboxViewport class="min-h-0 flex-1 overflow-y-auto p-1">
          <ComboboxEmpty class="text-muted-foreground py-6 text-center text-sm">
            {{ emptyText ?? 'No results found.' }}
          </ComboboxEmpty>
          <ComboboxItem
            v-for="item in items"
            :key="String(item.value)"
            :value="item.value"
            :text-value="item.label"
            :disabled="item.disabled"
            class="data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm text-foreground outline-none select-none"
          >
            <span class="truncate">{{ item.label }}</span>
            <ComboboxItemIndicator>
              <CheckIcon class="text-primary size-4 shrink-0" />
            </ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
