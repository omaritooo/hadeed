<script setup lang="ts">
import {
  AppleIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlameIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UtensilsIcon,
} from "@lucide/vue";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { MealLog, MealType } from "~~/shared/types/nutrition.types";
import { Button } from "@/components/ui/button";
import {
  Drawer as UiDrawer,
  DrawerContent as UiDrawerContent,
  DrawerFooter as UiDrawerFooter,
  DrawerHeader as UiDrawerHeader,
  DrawerTitle as UiDrawerTitle,
  DrawerTrigger as UiDrawerTrigger,
} from "@/components/ui/drawer";

definePageMeta({});

type Tab = "today" | "ingredients" | "presets";
const tabs: Tab[] = ["today", "ingredients", "presets"];
const tab = ref<Tab>("today");

// Day-navigation for the Today tab (Task 25). `undefined` means "today" -- the same
// sentinel useNutritionToday/the endpoint already use to default there, so returning to
// today from a past day just clears this rather than tracking today's date string
// explicitly (which would go stale across midnight while the tab stays open).
const todayDateString = () => new Date().toISOString().slice(0, 10);
const selectedDate = ref<string | undefined>(undefined);
const isViewingToday = computed(() => selectedDate.value === undefined);
const shiftDateString = (dateString: string, deltaDays: number): string => {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
};
const goToPreviousDay = () => {
  selectedDate.value = shiftDateString(selectedDate.value ?? todayDateString(), -1);
};
const goToNextDay = () => {
  if (isViewingToday.value) return;
  const next = shiftDateString(selectedDate.value as string, 1);
  // Snap back to "today" (undefined) rather than an explicit date string once we'd land on
  // it, so the next-day arrow disables itself the same way it does when never navigated.
  selectedDate.value = next === todayDateString() ? undefined : next;
};

const { data: nutrition } = useNutritionToday(selectedDate);
const deleteMealLog = useDeleteMealLog();

// Prefer the server-resolved `date` (authoritative, UTC) once it's loaded; falls back to
// the locally-selected date so the header doesn't flash "Today" while a past day loads.
const macrosSectionLabel = computed(() => {
  if (isViewingToday.value && !nutrition.value) return "Today's Macros";
  const resolvedDate = nutrition.value?.date ?? selectedDate.value;
  if (!resolvedDate || resolvedDate === todayDateString()) return "Today's Macros";
  const parsed = new Date(`${resolvedDate}T00:00:00Z`);
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
});

const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0 ? `${Math.round(remaining)} left` : `${Math.round(-remaining)} over`;
};
const macroPct = (consumed: number, target: number | undefined): number => {
  if (!target) return 0;
  return Math.min(100, Math.round((consumed / target) * 100));
};

// Groups today's meals under breakfast/lunch/dinner/snack section headers instead of one
// flat list. A null mealType only happens on rows logged before this column existed, so
// they get their own trailing bucket rather than being silently dropped.
const MEAL_TYPE_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
const groupedMeals = computed(() => {
  const meals = nutrition.value?.meals ?? [];
  const groups = MEAL_TYPE_ORDER.map((type) => ({
    key: type as string,
    label: MEAL_TYPE_LABELS[type],
    meals: meals.filter((meal) => meal.mealType === type),
  })).filter((group) => group.meals.length);
  const uncategorized = meals.filter((meal) => meal.mealType === null);
  if (uncategorized.length) groups.push({ key: "uncategorized", label: "Uncategorized", meals: uncategorized });
  return groups;
});

const { data: ingredients } = useIngredients();
const { mutateAsync: createIngredientAsync, isLoading: creatingIngredient } = useCreateIngredient();
const deleteIngredient = useDeleteIngredient();

const ingredientOptions = computed<ComboboxOption[]>(() => {
  return (ingredients.value ?? []).map((ingredient) => ({ value: ingredient.id, label: ingredient.name }));
});
const ingredientMacros = (ingredient: { unitType: string, unitLabel: string | null, calories: number, proteinG: number, carbsG: number, fatG: number }, quantity: number) => {
  const scale = ingredient.unitType === "weight_100g" ? quantity / 100 : quantity;
  return {
    calories: ingredient.calories * scale,
    proteinG: ingredient.proteinG * scale,
    carbsG: ingredient.carbsG * scale,
    fatG: ingredient.fatG * scale,
  };
};

// UiMetricInput's model type is `number | string | undefined` (no `null`), matching the
// convention already established in profile.vue's target fields, so these use `undefined`
// for "empty" rather than the plan's literal `null`.
const newIngredient = ref({
  name: "",
  unitType: "weight_100g" as "weight_100g" | "count",
  unitLabel: "",
  calories: undefined as number | undefined,
  proteinG: undefined as number | undefined,
  carbsG: undefined as number | undefined,
  fatG: undefined as number | undefined,
});
const showNewIngredientForm = ref(false);

const onCreateIngredient = async () => {
  try {
    await createIngredientAsync({
      name: newIngredient.value.name.trim(),
      unitType: newIngredient.value.unitType,
      unitLabel: newIngredient.value.unitType === "count" ? newIngredient.value.unitLabel.trim() : null,
      calories: newIngredient.value.calories ?? 0,
      proteinG: newIngredient.value.proteinG ?? 0,
      carbsG: newIngredient.value.carbsG ?? 0,
      fatG: newIngredient.value.fatG ?? 0,
    });
    newIngredient.value = { name: "", unitType: "weight_100g", unitLabel: "", calories: undefined, proteinG: undefined, carbsG: undefined, fatG: undefined };
    showNewIngredientForm.value = false;
  } catch {
    // Swallow: on failure the form stays open with the user's input intact.
  }
};

const { data: presetMeals } = usePresetMeals();
const { mutateAsync: createPresetMealAsync, isLoading: creatingPresetMeal } = useCreatePresetMeal();
const deletePresetMeal = useDeletePresetMeal();
const { mutateAsync: logMealAsync, isLoading: loggingMeal } = useLogMeal();
const { mutateAsync: editMealAsync, isLoading: editingMealSaving } = useEditMeal();
const logPresetMeal = useLogPresetMeal();
const savingMeal = computed(() => loggingMeal.value || editingMealSaving.value);

const presetMacros = (preset: { items: { ingredientId: number, quantity: number }[] }) => {
  return preset.items.reduce((sum, item) => {
    const ingredient = ingredients.value?.find((i) => i.id === item.ingredientId);
    if (!ingredient) return sum;
    const macros = ingredientMacros(ingredient, item.quantity);
    sum.calories += macros.calories;
    return sum;
  }, { calories: 0 });
};

const logDrawerOpen = ref(false);
// Non-null while the drawer is editing an already-logged meal rather than logging a new
// one -- set by openEditMeal, reset whenever the drawer closes. The drawer UI is otherwise
// identical between the two modes, just pre-filled and re-labelled.
const editingMealLogId = ref<number | null>(null);
const draftItems = ref<{ ingredientId: number, quantity: number }[]>([]);
// The combobox's model type is reka-ui's `AcceptableValue` (includes `null`), unlike
// UiMetricInput which only accepts `number | string | undefined` -- so the ingredient
// picker keeps `null` as its "nothing selected" sentinel while quantity uses `undefined`.
const draftIngredientId = ref<number | null>(null);
const draftQuantity = ref<number | undefined>(undefined);
const draftIngredient = computed(() => ingredients.value?.find((i) => i.id === draftIngredientId.value));
// "auto" defers to the server's time-of-day inference (see shared/lib/meal-type.ts) --
// only meaningful when logging a new meal, not editing an existing one's items.
const draftMealTypeSelect = ref<MealType | "auto">("auto");

const addDraftItem = () => {
  if (draftIngredientId.value === null || !draftQuantity.value || draftQuantity.value <= 0) return;
  draftItems.value.push({ ingredientId: draftIngredientId.value, quantity: draftQuantity.value });
  draftIngredientId.value = null;
  draftQuantity.value = undefined;
};
const removeDraftItem = (index: number) => draftItems.value.splice(index, 1);

const draftTotals = computed(() => {
  return draftItems.value.reduce((sum, item) => {
    const ingredient = ingredients.value?.find((i) => i.id === item.ingredientId);
    if (!ingredient) return sum;
    const macros = ingredientMacros(ingredient, item.quantity);
    sum.calories += macros.calories;
    sum.proteinG += macros.proteinG;
    sum.carbsG += macros.carbsG;
    sum.fatG += macros.fatG;
    return sum;
  }, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
});

// A meal's items can lose their ingredientId (ON DELETE SET NULL) if the underlying
// ingredient was later deleted -- those items keep their historical snapshot in the log
// but can't be re-resolved into an editable draft line, so they're dropped from the draft.
// Editing and saving would then irreversibly drop them from the meal too, but that's the
// unavoidable cost of the ingredient no longer existing.
const openEditMeal = (meal: MealLog) => {
  editingMealLogId.value = meal.id;
  draftItems.value = meal.items
    .filter((item) => item.ingredientId !== null)
    .map((item) => ({ ingredientId: item.ingredientId as number, quantity: item.quantity }));
  logDrawerOpen.value = true;
};

const onSaveMeal = async () => {
  try {
    if (editingMealLogId.value !== null) {
      await editMealAsync({ id: editingMealLogId.value, items: draftItems.value });
    } else {
      const mealType = draftMealTypeSelect.value === "auto" ? undefined : draftMealTypeSelect.value;
      await logMealAsync({ items: draftItems.value, mealType });
    }
    draftItems.value = [];
    logDrawerOpen.value = false;
  } catch {
    // Swallow: on failure the drawer stays open with the draft items intact.
  }
};

const onQuickLogPreset = (presetMealId: number) => logPresetMeal.mutate(presetMealId);

const newPresetName = ref("");
const showNewPresetForm = ref(false);
const onCreatePreset = async () => {
  try {
    await createPresetMealAsync({ name: newPresetName.value.trim(), items: draftItems.value });
    newPresetName.value = "";
    draftItems.value = [];
    showNewPresetForm.value = false;
  } catch {
    // Swallow: on failure the form stays open with the user's input intact.
  }
};

// The drawer can also be dismissed without saving (outside-press, Escape, swipe --
// DrawerRoot defaults to modal: true), which isn't distinguished from a save-driven
// close. Reset all draft/preset-form state whenever it closes so a stale, already-valid
// draft can't resurface the next time "Log Meal" is opened. This also covers the case
// where "Log meal" succeeds while the preset-name form is still open, since onSaveMeal
// closes the drawer on success (onCreatePreset resets this state itself and leaves the
// drawer open, so it's unaffected either way).
watch(logDrawerOpen, (open) => {
  if (open) return;
  draftItems.value = [];
  draftIngredientId.value = null;
  draftQuantity.value = undefined;
  draftMealTypeSelect.value = "auto";
  showNewPresetForm.value = false;
  newPresetName.value = "";
  editingMealLogId.value = null;
});
</script>

<template>
  <main class="mx-auto max-w-xl space-y-6 p-6 pb-24">
    <div class="flex items-center gap-2">
      <UtensilsIcon class="size-5 text-lime" />
      <h1 class="font-heading text-2xl uppercase text-foreground">Nutrition</h1>
    </div>

    <div class="relative grid grid-cols-3 border-b border-surface-strong">
      <button
        v-for="t in tabs"
        :key="t"
        class="px-3 py-2 font-mono text-xs uppercase tracking-[1px] transition-colors"
        :class="tab === t ? 'text-foreground' : 'text-muted-foreground'"
        @click="tab = t"
      >
        {{ t }}
      </button>
      <div
        class="absolute -bottom-px h-0.5 w-1/3 rounded-full bg-primary transition-transform duration-200 ease-out"
        :style="{ transform: `translateX(${tabs.indexOf(tab) * 100}%)` }"
      />
    </div>

    <section v-if="tab === 'today'" class="space-y-4">
      <div class="flex items-center justify-between gap-2">
        <button
          class="rounded-full p-1.5 transition-transform active:scale-90"
          aria-label="Previous day"
          @click="goToPreviousDay"
        >
          <ChevronLeftIcon class="size-4.5 text-muted-foreground" />
        </button>
        <span class="font-mono text-xs uppercase tracking-[1px] text-muted-foreground">{{ macrosSectionLabel }}</span>
        <button
          class="rounded-full p-1.5 transition-transform active:scale-90 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Next day"
          :disabled="isViewingToday"
          @click="goToNextDay"
        >
          <ChevronRightIcon class="size-4.5 text-muted-foreground" />
        </button>
      </div>

      <div class="space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div class="flex items-center gap-2">
          <FlameIcon class="size-4.5 text-peach" />
          <h2 class="font-heading text-lg uppercase text-foreground">{{ macrosSectionLabel }}</h2>
        </div>
        <div v-if="nutrition?.target" class="grid grid-cols-2 gap-4">
          <div v-for="(label, key) in { calories: 'Calories', proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' }" :key="key" class="space-y-1.5">
            <div class="flex items-baseline justify-between">
              <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{{ label }}</span>
              <UiBadge
                class="rounded-full bg-popover px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[1px]"
                :class="(nutrition.remaining?.[key] ?? 0) < 0 ? 'text-destructive' : 'text-muted-foreground'"
              >
                {{ remainingLabel(nutrition.remaining?.[key]) }}
              </UiBadge>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full bg-lime transition-[width] duration-250 ease-in-out"
                :style="{ width: `${macroPct(nutrition.totals[key], nutrition.target?.[key])}%` }"
              />
            </div>
            <p class="font-heading text-lg text-foreground [font-variant-numeric:tabular-nums]">
              {{ Math.round(nutrition.totals[key]) }}<span class="text-xs text-muted-foreground">/{{ Math.round(nutrition.target[key]) }}{{ key === 'calories' ? 'cal' : 'g' }}</span>
            </p>
          </div>
        </div>
        <p v-else class="text-sm text-muted-foreground">
          No daily target set --
          <NuxtLink to="/profile" class="text-cyan-pale underline">set one</NuxtLink>
        </p>
      </div>

      <div v-for="group in groupedMeals" :key="group.key" class="space-y-2">
        <h3 class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{{ group.label }}</h3>
        <TransitionGroup tag="div" name="row" class="space-y-2">
          <div
            v-for="meal in group.meals"
            :key="meal.id"
            role="button"
            tabindex="0"
            class="flex cursor-pointer items-start gap-3 rounded-xl border border-surface-strong bg-card p-4 transition-transform active:scale-[0.99]"
            @click="openEditMeal(meal)"
            @keydown.enter="openEditMeal(meal)"
          >
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-popover">
              <UtensilsIcon class="size-4.5 text-lime" />
            </div>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-center justify-between gap-2">
                <p class="truncate font-heading text-base text-foreground">{{ meal.name ?? "Meal" }}</p>
                <UiBadge class="shrink-0 rounded-full bg-popover px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[1px] text-muted-foreground">
                  {{ meal.items.length }} item{{ meal.items.length === 1 ? '' : 's' }} · {{ Math.round(meal.items.reduce((s, i) => s + i.calories, 0)) }}cal
                </UiBadge>
              </div>
              <p class="truncate text-xs text-muted-foreground">{{ meal.items.map((i) => i.ingredientName).join(", ") }}</p>
            </div>
            <button
              class="shrink-0 rounded-md p-1 transition-transform active:scale-90"
              aria-label="Edit meal"
              @click.stop="openEditMeal(meal)"
            >
              <PencilIcon class="size-4 text-muted-foreground" />
            </button>
            <button
              class="shrink-0 rounded-md p-1 transition-transform active:scale-90"
              aria-label="Delete meal"
              :disabled="deleteMealLog.isLoading.value"
              @click.stop="deleteMealLog.mutate(meal.id)"
            >
              <TrashIcon class="size-4 text-muted-foreground" />
            </button>
          </div>
        </TransitionGroup>
      </div>
      <p v-if="!nutrition?.meals.length" class="text-center text-sm text-muted-foreground">
        {{ isViewingToday ? "No meals logged today." : "No meals logged on this day." }}
      </p>

      <UiDrawer v-model:open="logDrawerOpen">
        <UiDrawerTrigger v-if="isViewingToday" as-child>
          <Button size="lg" class="w-full gap-2 rounded-full uppercase"><PlusIcon class="size-4" />Log Meal</Button>
        </UiDrawerTrigger>
        <!-- New meals always log against "now", not the day being browsed, so the
             "Log Meal" CTA only shows on today -- editing an existing past-day meal (via
             openEditMeal) still opens this same drawer programmatically regardless. -->
        <p v-else class="text-center text-xs text-muted-foreground">
          Viewing a past day -- <button class="underline" @click="selectedDate = undefined">go to today</button> to log a new meal.
        </p>
        <UiDrawerContent class="mx-auto w-full max-w-xl">
          <UiDrawerHeader>
            <UiDrawerTitle class="font-heading text-[28px] uppercase tracking-[-0.5px] text-foreground">
              {{ editingMealLogId !== null ? "Edit Meal" : "Log a Meal" }}
            </UiDrawerTitle>
          </UiDrawerHeader>
          <div class="space-y-6 overflow-y-auto px-4 pb-4">
            <div v-if="editingMealLogId === null" class="space-y-1.5">
              <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Meal type</span>
              <UiNativeSelect v-model="draftMealTypeSelect" class="w-full">
                <UiNativeSelectOption value="auto">Auto (based on time)</UiNativeSelectOption>
                <UiNativeSelectOption value="breakfast">Breakfast</UiNativeSelectOption>
                <UiNativeSelectOption value="lunch">Lunch</UiNativeSelectOption>
                <UiNativeSelectOption value="dinner">Dinner</UiNativeSelectOption>
                <UiNativeSelectOption value="snack">Snack</UiNativeSelectOption>
              </UiNativeSelect>
            </div>

            <div v-if="presetMeals?.length && editingMealLogId === null" class="space-y-3">
              <div class="flex items-center gap-2">
                <BookmarkIcon class="size-4 text-cyan-pale" />
                <h2 class="font-heading text-base uppercase text-foreground">Presets</h2>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="preset in presetMeals"
                  :key="preset.id"
                  class="flex flex-col items-start gap-0.5 rounded-xl border border-surface-strong bg-card px-4 py-2.5 text-left transition-transform active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                  :disabled="logPresetMeal.isLoading.value"
                  @click="onQuickLogPreset(preset.id)"
                >
                  <span class="text-sm font-semibold text-foreground">{{ preset.name }}</span>
                  <span class="font-mono text-[10px] text-muted-foreground">{{ Math.round(presetMacros(preset).calories) }}cal</span>
                </button>
              </div>
            </div>

            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <UtensilsIcon class="size-4 text-lime" />
                <h2 class="font-heading text-base uppercase text-foreground">Build a Meal</h2>
              </div>

              <div class="flex gap-2">
                <UiCombobox
                  v-model="draftIngredientId"
                  :items="ingredientOptions"
                  placeholder="Pick an ingredient"
                  search-placeholder="Search ingredients…"
                  empty-text="No ingredients found."
                  class="flex-1"
                />
                <UiMetricInput
                  v-model="draftQuantity"
                  :unit="draftIngredient?.unitType === 'count' ? (draftIngredient?.unitLabel ?? 'x') : 'g'"
                  class="w-28"
                />
                <Button
                  size="lg"
                  class="shrink-0 rounded-lg"
                  aria-label="Add ingredient to meal"
                  :disabled="draftIngredientId === null || !draftQuantity || draftQuantity <= 0"
                  @click="addDraftItem"
                >
                  <PlusIcon class="size-5" />
                </Button>
              </div>

              <TransitionGroup tag="div" name="row" class="space-y-2">
                <div v-for="(item, index) in draftItems" :key="index" class="flex items-center justify-between gap-2 rounded-lg border border-surface-strong bg-popover px-3 py-2">
                  <span class="min-w-0 truncate text-sm text-foreground">
                    {{ item.quantity }}{{ ingredients?.find((i) => i.id === item.ingredientId)?.unitType === 'weight_100g' ? 'g' : '' }}
                    -- {{ ingredients?.find((i) => i.id === item.ingredientId)?.name }}
                  </span>
                  <button class="shrink-0 rounded-md p-1 transition-transform active:scale-90" aria-label="Remove item" @click="removeDraftItem(index)">
                    <TrashIcon class="size-3.5 text-muted-foreground" />
                  </button>
                </div>
              </TransitionGroup>

              <div v-if="draftItems.length" class="flex gap-2 rounded-lg bg-popover p-3">
                <div v-for="(label, key) in { calories: 'Cal', proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' }" :key="key" class="flex-1 space-y-0.5 text-center">
                  <p class="font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">{{ label }}</p>
                  <p class="font-heading text-sm text-foreground [font-variant-numeric:tabular-nums]">{{ Math.round(draftTotals[key]) }}{{ key === 'calories' ? '' : 'g' }}</p>
                </div>
              </div>
            </div>

            <div v-if="showNewPresetForm && editingMealLogId === null" class="flex gap-2">
              <UiInput v-model="newPresetName" placeholder="Preset name" class="flex-1" />
              <Button :disabled="!draftItems.length || !newPresetName.trim() || creatingPresetMeal" @click="onCreatePreset">Save</Button>
            </div>
          </div>
          <UiDrawerFooter class="gap-2">
            <Button size="lg" class="w-full rounded-full uppercase" :disabled="!draftItems.length || savingMeal" @click="onSaveMeal">
              {{ editingMealLogId !== null ? "Save changes" : "Log meal" }}
            </Button>
            <Button
              v-if="!showNewPresetForm && editingMealLogId === null"
              size="lg"
              variant="secondary"
              class="w-full rounded-full uppercase"
              :disabled="!draftItems.length"
              @click="showNewPresetForm = true"
            >
              Save as preset
            </Button>
          </UiDrawerFooter>
        </UiDrawerContent>
      </UiDrawer>
    </section>

    <section v-if="tab === 'ingredients'" class="space-y-4">
      <TransitionGroup tag="div" name="row" class="space-y-2">
        <div v-for="ingredient in ingredients ?? []" :key="ingredient.id" class="flex items-center gap-3 rounded-xl border border-surface-strong bg-card p-4">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-popover">
            <AppleIcon class="size-4.5 text-lime" />
          </div>
          <div class="min-w-0 flex-1 space-y-1">
            <p class="font-heading text-base text-foreground">{{ ingredient.name }}</p>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-[10px] text-muted-foreground">
                {{ ingredient.calories }}cal / {{ ingredient.unitType === 'weight_100g' ? '100g' : `1 ${ingredient.unitLabel}` }}
              </span>
              <UiBadge class="rounded-full bg-popover px-2 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">P{{ ingredient.proteinG }}</UiBadge>
              <UiBadge class="rounded-full bg-popover px-2 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">C{{ ingredient.carbsG }}</UiBadge>
              <UiBadge class="rounded-full bg-popover px-2 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">F{{ ingredient.fatG }}</UiBadge>
            </div>
          </div>
          <button class="shrink-0 rounded-md p-1 transition-transform active:scale-90" aria-label="Delete ingredient" :disabled="deleteIngredient.isLoading.value" @click="deleteIngredient.mutate(ingredient.id)">
            <TrashIcon class="size-4 text-muted-foreground" />
          </button>
        </div>
      </TransitionGroup>
      <p v-if="!ingredients?.length" class="text-center text-sm text-muted-foreground">No ingredients yet.</p>

      <Button v-if="!showNewIngredientForm" variant="secondary" size="lg" class="w-full gap-2 rounded-full uppercase" @click="showNewIngredientForm = true">
        <PlusIcon class="size-4" />Add Ingredient
      </Button>
      <div v-else class="space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div class="flex items-center gap-2">
          <AppleIcon class="size-4.5 text-lime" />
          <h2 class="font-heading text-lg uppercase text-foreground">Add Ingredient</h2>
        </div>
        <UiInput v-model="newIngredient.name" placeholder="Name (e.g. Chicken breast)" />
        <UiNativeSelect v-model="newIngredient.unitType" class="w-full">
          <UiNativeSelectOption value="weight_100g">Per 100g</UiNativeSelectOption>
          <UiNativeSelectOption value="count">Per count (cup, can, scoop...)</UiNativeSelectOption>
        </UiNativeSelect>
        <UiInput v-if="newIngredient.unitType === 'count'" v-model="newIngredient.unitLabel" placeholder="Unit label (e.g. can)" />
        <div class="grid grid-cols-2 gap-3">
          <UiMetricInput v-model="newIngredient.calories" label="Calories" unit="cal" />
          <UiMetricInput v-model="newIngredient.proteinG" label="Protein" unit="g" />
          <UiMetricInput v-model="newIngredient.carbsG" label="Carbs" unit="g" />
          <UiMetricInput v-model="newIngredient.fatG" label="Fat" unit="g" />
        </div>
        <div class="flex gap-2">
          <Button
            class="flex-1"
            :disabled="creatingIngredient || !newIngredient.name.trim() || (newIngredient.unitType === 'count' && !newIngredient.unitLabel.trim())"
            @click="onCreateIngredient"
          >
            Save
          </Button>
          <Button variant="secondary" @click="showNewIngredientForm = false">Cancel</Button>
        </div>
      </div>
    </section>

    <section v-if="tab === 'presets'" class="space-y-4">
      <TransitionGroup tag="div" name="row" class="space-y-2">
        <div v-for="preset in presetMeals ?? []" :key="preset.id" class="flex items-center gap-3 rounded-xl border border-surface-strong bg-card p-4">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-popover">
            <BookmarkIcon class="size-4.5 text-cyan-pale" />
          </div>
          <div class="min-w-0 flex-1 space-y-1">
            <p class="font-heading text-base text-foreground">{{ preset.name }}</p>
            <UiBadge class="rounded-full bg-popover px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[1px] text-muted-foreground">
              {{ preset.items.length }} ingredient{{ preset.items.length === 1 ? '' : 's' }}
            </UiBadge>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <Button size="sm" variant="secondary" class="rounded-full" :disabled="logPresetMeal.isLoading.value" @click="onQuickLogPreset(preset.id)">Log now</Button>
            <button class="rounded-md p-1 transition-transform active:scale-90" aria-label="Delete preset" :disabled="deletePresetMeal.isLoading.value" @click="deletePresetMeal.mutate(preset.id)">
              <TrashIcon class="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </TransitionGroup>
      <p v-if="!presetMeals?.length" class="text-center text-sm text-muted-foreground">No preset meals yet -- build one from the Today tab's "Log Meal" drawer and save it.</p>
    </section>
  </main>
</template>

<style scoped>
.row-enter-active,
.row-leave-active,
.row-move {
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}
.row-enter-from,
.row-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.row-leave-active {
  position: absolute;
  width: 100%;
}
</style>
