# Reusable Option-Card Radio Component Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reusable `UiOptionCard` component (icon box + title + description + trailing radio indicator) matching the target screenshot, fix up `RadioGroupItem.vue`, and demo it in `index.vue`.

**Architecture:** `OptionCard.vue` builds directly on reka-ui's unstyled `RadioGroupItem`/`RadioGroupIndicator` primitives (bypassing the app's small-dot `UiRadioGroupItem` wrapper), rendering the whole card as the clickable radio button. Visual state (unchecked/checked) is driven entirely by Tailwind `data-[state=checked]:` variants against reka-ui's own `data-state` attribute — no manual class binding or local state.

**Tech Stack:** Vue 3 `<script setup>`, reka-ui (`RadioGroupItem`, `RadioGroupIndicator`), Tailwind v4 (`data-[state=checked]:` variants, existing `--primary`/`--muted`/`--border` design tokens), `@lucide/vue` icons, `cn()` from `@/lib/utils`.

Full design context: `docs/plans/2026-08-21-option-card-design.md`.

---

### Task 1: Clean up `RadioGroupItem.vue`

**Files:**
- Modify: `app/components/ui/radio-group/RadioGroupItem.vue`

**Step 1: Fix the template**

Remove the stray debug `<div class="bg-blue-500 right-1/2"></div>` and the conflicting size classes (`h-[200px] w-full` alongside `aspect-square size-4`). Restore it to a plain small circular radio dot — a fixed small size, no `h-[200px]`/`w-full`.

Replace the `:class` string (lines 20-25) with:

```
'border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
props.class
```

Remove the `<div class="bg-blue-500 right-1/2"></div>` line entirely, so the only child of `RadioGroupItem` is `RadioGroupIndicator`.

**Step 2: Visually verify**

Run: `npm run dev`, open `http://localhost:3000`, confirm the existing "Default / Comfortable / Compact" radio group in `index.vue` still renders as small circular dots and toggles correctly (this file's usage in `index.vue` gets replaced in Task 3, but verify before that edit lands).

**Step 3: Commit**

```bash
git add app/components/ui/radio-group/RadioGroupItem.vue
git commit -m "fix: restore RadioGroupItem to a plain circular radio primitive"
```

---

### Task 2: Create `OptionCard.vue`

**Files:**
- Create: `app/components/ui/OptionCard.vue`

**Step 1: Write the component**

```vue
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
        'border-border bg-card data-[state=checked]:border-primary flex w-full items-center gap-4 rounded-xl border p-4 text-left shadow-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        props.class
      )
    "
  >
    <div
      class="bg-muted text-foreground data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-lg"
    >
      <component :is="icon" class="size-6" />
    </div>

    <div class="flex-1 space-y-1">
      <p class="text-foreground font-semibold">{{ title }}</p>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </div>

    <div
      class="border-md-outline flex size-8 shrink-0 items-center justify-center rounded-full border-2 data-[state=checked]:border-none data-[state=checked]:bg-primary"
    >
      <RadioGroupIndicator data-slot="option-card-indicator">
        <CheckIcon class="text-primary-foreground size-4" />
      </RadioGroupIndicator>
    </div>
  </RadioGroupItem>
</template>
```

Note: `data-state` lives on the `RadioGroupItem` root element only, so the inner icon-box and indicator-circle `div`s can't read it directly via `data-[state=checked]:` (that variant matches the element's *own* attribute, not an ancestor's). Fix in Step 2 below.

**Step 2: Fix the state-selector scoping**

Tailwind's `data-[state=checked]:` only matches the element carrying the attribute. Since only the outer `RadioGroupItem` gets `data-state`, use group state instead: add `group` to the root's class list, and change the icon-box and indicator-circle classes to use `group-data-[state=checked]:` instead of `data-[state=checked]:`.

Updated root class list:

```
'border-border bg-card group data-[state=checked]:border-primary flex w-full items-center gap-4 rounded-xl border p-4 text-left shadow-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'
```

Icon box:

```
'bg-muted text-foreground group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground flex size-14 shrink-0 items-center justify-center rounded-lg'
```

Indicator circle:

```
'border-md-outline flex size-8 shrink-0 items-center justify-center rounded-full border-2 group-data-[state=checked]:border-none group-data-[state=checked]:bg-primary'
```

(`data-[state=checked]:border-primary` on the root itself is fine as-is — that one *is* matching its own attribute.)

**Step 3: Visually verify**

Temporarily add to `index.vue` (this gets replaced properly in Task 3, just for a quick check now):

```vue
<UiRadioGroup default-value="feet" class="space-y-3">
  <UiOptionCard value="sitting" :icon="SofaIcon" title="Mostly sitting" description="Desk job, little intentional exercise" />
  <UiOptionCard value="feet" :icon="FootprintsIcon" title="On my feet all day" description="Retail, nursing, teaching" />
  <UiOptionCard value="physical" :icon="DumbbellIcon" title="Physically demanding job" description="Construction, heavy lifting" />
</UiRadioGroup>
```

with `import { SofaIcon, FootprintsIcon, DumbbellIcon } from "@lucide/vue";` added to the script.

Run: `npm run dev`, open `http://localhost:3000`, confirm:
- The "On my feet all day" card renders pre-checked: orange border, orange icon box, filled orange indicator circle with a checkmark.
- Clicking either other card moves the checked state and updates all three visuals.
- Clicking anywhere on a card (not just the indicator) selects it.
- Tab/arrow-key keyboard navigation moves selection between cards.

**Step 4: Commit**

```bash
git add app/components/ui/OptionCard.vue
git commit -m "feat: add reusable OptionCard radio component"
```

---

### Task 3: Replace the scratch demo in `index.vue`

**Files:**
- Modify: `app/pages/index.vue:49-81`

**Step 1: Replace the block**

Replace the entire `<div class="bg-red-500 w-full py-5 px-4"> ... </div>` block (lines 49-81, the inline-SVG couch icon + Default/Comfortable/Compact radio group) with:

```vue
<div class="w-full">
  <UiRadioGroup default-value="feet" class="space-y-3">
    <UiOptionCard
      value="sitting"
      :icon="SofaIcon"
      title="Mostly sitting"
      description="Desk job, little intentional exercise"
    />
    <UiOptionCard
      value="feet"
      :icon="FootprintsIcon"
      title="On my feet all day"
      description="Retail, nursing, teaching"
    />
    <UiOptionCard
      value="physical"
      :icon="DumbbellIcon"
      title="Physically demanding job"
      description="Construction, heavy lifting"
    />
  </UiRadioGroup>
</div>
```

Add the icon import to the `<script setup>` block:

```ts
import { DumbbellIcon, FootprintsIcon, SofaIcon } from "@lucide/vue";
```

(Remove this same temporary import/markup from Task 2 Step 3 first if it's still there, so there's no duplication — this task is the permanent version.)

**Step 2: Visually verify**

Run: `npm run dev`, open `http://localhost:3000`, confirm the page renders the three-card activity-level picker matching the screenshot, with "On my feet all day" pre-selected, and the rest of the page (stepper, fetch-exercise form) still works.

**Step 3: Commit**

```bash
git add app/pages/index.vue
git commit -m "refactor: demo OptionCard in the index page activity-level picker"
```
