# Reusable option-card radio component — design

## Problem

The onboarding-style radio choices (e.g. activity level: "Mostly sitting" /
"On my feet all day" / "Physically demanding job") are currently prototyped
ad hoc inside `app/pages/index.vue`, wired directly to the raw
`UiRadioGroup`/`UiRadioGroupItem` primitives with no icon/title/description
layout. There's no reusable component that renders the icon-box + title +
description + trailing radio-indicator card shown in the target design.

Separately, `app/components/ui/radio-group/RadioGroupItem.vue` (currently
open in the editor) is mid-experiment: it has a leftover debug
`<div class="bg-blue-500 right-1/2">` and conflicting size classes
(`h-[200px] w-full` alongside `aspect-square size-4`), so it doesn't
currently render as a sane small radio dot.

## Goals

- A reusable `UiOptionCard` component that renders the full card design
  (icon box, title, description, trailing radio indicator) and slots into
  a `UiRadioGroup` the same way `UiRadioGroupItem` does today.
- Visual states (unchecked/checked) driven declaratively via Tailwind
  `data-[state=checked]:` variants, no manual class binding.
- Fix `RadioGroupItem.vue` back to a sane, minimal circular radio primitive.
- Update the `index.vue` scratch demo to use the new component so there's a
  working example.

## Non-goals

- No new component library abstraction beyond this one composite component.
- `OptionCard` does not depend on / reuse `RadioGroupItem.vue` — it builds
  directly on reka-ui's unstyled `RadioGroupItem`/`RadioGroupIndicator`,
  the same primitives `RadioGroupItem.vue` itself wraps.

## Design

### `app/components/ui/OptionCard.vue`

Auto-imports as `UiOptionCard` (matches the existing `UiSteps`,
`UiRadioGroup`, `UiLabel` flat/prefixed naming convention).

Props:
- `value: string` — forwarded to the underlying `RadioGroupItem`
- `icon: Component` — a lucide icon component, rendered via
  `<component :is="icon" />`
- `title: string`
- `description?: string` — optional; the description line is omitted
  entirely when not provided

Structure: the card's outer element *is* reka-ui's `RadioGroupItem`
(rendered as the full-width card, not a small dot), giving native
button semantics, keyboard nav, and a `data-state="checked"` attribute
for free. Inside: icon box (left) · title + description stack (middle,
flex-1) · radio indicator circle (right), laid out as a flex row to match
the screenshot proportions.

State styling via `data-[state=checked]:` Tailwind variants on each part:
- Card border: `border-border` → `border-primary`
- Icon box: `bg-muted` (icon in default foreground) →
  `bg-primary` (icon in `text-primary-foreground`)
- Radio indicator: plain outlined circle (`border-2 border-md-outline`) →
  filled `bg-primary` circle containing a `CheckIcon` in
  `text-primary-foreground`, rendered through `RadioGroupIndicator` so it
  only mounts when checked

Colors come from existing design-system tokens (`--primary` already
resolves to the spec's `#FF5722` via `--md-primary-container`), no new
hardcoded hex values.

Usage stays inside a `UiRadioGroup` parent, same pattern as today:

```vue
<UiRadioGroup v-model="activityLevel">
  <UiOptionCard value="sitting" :icon="CouchIcon" title="Mostly sitting" description="Desk job, little intentional exercise" />
  <UiOptionCard value="feet" :icon="FootprintsIcon" title="On my feet all day" description="Retail, nursing, teaching" />
  <UiOptionCard value="physical" :icon="DumbbellIcon" title="Physically demanding job" description="Construction, heavy lifting" />
</UiRadioGroup>
```

### `RadioGroupItem.vue` cleanup

Remove the stray debug div and the conflicting size classes; restore it to
a plain small circular radio dot (`border`, `rounded-full`, fixed
small size, `CircleIcon` indicator) — the standard shadcn-style primitive.
Not consumed by `OptionCard`; fixed independently since it's mid-edit.

### `index.vue` demo update

Replace the current ad-hoc `UiRadioGroup`/`UiRadioGroupItem`/inline-SVG
block with three `UiOptionCard`s (activity-level example) inside a
`UiRadioGroup`, so there's a working example matching the target screenshot.

## Testing

Manual/visual only — start the dev server and check both states
(unchecked/checked, keyboard nav, click-anywhere-on-card) render like the
screenshot. No new business logic to unit test.
