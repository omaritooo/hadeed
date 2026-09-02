<script setup lang="ts">
import { PlusIcon, TrashIcon, UtensilsIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Drawer as UiDrawer,
  DrawerContent as UiDrawerContent,
  DrawerHeader as UiDrawerHeader,
  DrawerTitle as UiDrawerTitle,
  DrawerTrigger as UiDrawerTrigger,
} from "@/components/ui/drawer";

definePageMeta({});

type Tab = "today" | "ingredients" | "presets";
const tab = ref<Tab>("today");

const { data: nutrition } = useNutritionToday();
const deleteMealLog = useDeleteMealLog();

const remainingLabel = (remaining: number | undefined): string => {
  if (remaining === undefined) return "";
  return remaining >= 0 ? `${Math.round(remaining)} left` : `${Math.round(-remaining)} over`;
};
const macroPct = (consumed: number, target: number | undefined): number => {
  if (!target) return 0;
  return Math.min(100, Math.round((consumed / target) * 100));
};

const { data: ingredients } = useIngredients();
const { mutateAsync: createIngredientAsync, isLoading: creatingIngredient } = useCreateIngredient();
const deleteIngredient = useDeleteIngredient();

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
const logPresetMeal = useLogPresetMeal();

const logDrawerOpen = ref(false);
const draftItems = ref<{ ingredientId: number, quantity: number }[]>([]);
// NativeSelect's model type includes `null` (reka-ui's AcceptableValue), unlike
// UiMetricInput which only accepts `number | string | undefined` -- so the ingredient
// picker keeps `null` as its "nothing selected" sentinel while quantity uses `undefined`.
const draftIngredientId = ref<number | null>(null);
const draftQuantity = ref<number | undefined>(undefined);

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
    const scale = ingredient.unitType === "weight_100g" ? item.quantity / 100 : item.quantity;
    sum.calories += ingredient.calories * scale;
    sum.proteinG += ingredient.proteinG * scale;
    return sum;
  }, { calories: 0, proteinG: 0 });
});

const onSaveMeal = async () => {
  try {
    await logMealAsync({ items: draftItems.value });
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
  showNewPresetForm.value = false;
  newPresetName.value = "";
});
</script>

<template>
  <main class="mx-auto max-w-xl space-y-6 p-6 pb-24">
    <div class="flex items-center gap-2">
      <UtensilsIcon class="size-5 text-lime" />
      <h1 class="font-heading text-2xl uppercase text-foreground">Nutrition</h1>
    </div>

    <div class="flex gap-2 border-b border-surface-strong">
      <button
        v-for="t in (['today', 'ingredients', 'presets'] as Tab[])"
        :key="t"
        class="px-3 py-2 font-mono text-xs uppercase tracking-[1px]"
        :class="tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'"
        @click="tab = t"
      >
        {{ t }}
      </button>
    </div>

    <section v-if="tab === 'today'" class="space-y-4">
      <UiCard class="space-y-4 rounded-xl border border-surface-strong bg-card p-5">
        <div v-if="nutrition?.target" class="grid grid-cols-2 gap-4">
          <div v-for="(label, key) in { calories: 'Calories', proteinG: 'Protein', carbsG: 'Carbs', fatG: 'Fat' }" :key="key" class="space-y-1">
            <div class="flex items-baseline justify-between">
              <span class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">{{ label }}</span>
              <span class="font-mono text-[10px] text-muted-foreground">{{ remainingLabel(nutrition.remaining?.[key]) }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div class="h-full rounded-full bg-lime transition-[width]" :style="{ width: `${macroPct(nutrition.totals[key], nutrition.target?.[key])}%` }" />
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
      </UiCard>

      <div class="space-y-2">
        <div v-for="meal in nutrition?.meals ?? []" :key="meal.id" class="rounded-xl border border-surface-strong bg-card p-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-sm font-semibold text-foreground">{{ meal.name ?? "Meal" }}</p>
              <p class="font-mono text-[10px] text-muted-foreground">
                {{ Math.round(meal.items.reduce((s, i) => s + i.calories, 0)) }}cal --
                {{ meal.items.map((i) => i.ingredientName).join(", ") }}
              </p>
            </div>
            <button :disabled="deleteMealLog.isLoading.value" @click="deleteMealLog.mutate(meal.id)">
              <TrashIcon class="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>
        <p v-if="!nutrition?.meals.length" class="text-center text-sm text-muted-foreground">No meals logged today.</p>
      </div>

      <UiDrawer v-model:open="logDrawerOpen">
        <UiDrawerTrigger as-child>
          <Button variant="secondary" class="w-full gap-2"><PlusIcon class="size-4" />Log Meal</Button>
        </UiDrawerTrigger>
        <UiDrawerContent>
          <UiDrawerHeader>
            <UiDrawerTitle>Log a meal</UiDrawerTitle>
          </UiDrawerHeader>
          <div class="space-y-4 px-4 pb-4">
            <div v-if="presetMeals?.length" class="space-y-2">
              <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Presets</p>
              <div class="flex flex-wrap gap-2">
                <Button
                  v-for="preset in presetMeals"
                  :key="preset.id"
                  variant="secondary"
                  size="sm"
                  :disabled="logPresetMeal.isLoading.value"
                  @click="onQuickLogPreset(preset.id)"
                >
                  {{ preset.name }}
                </Button>
              </div>
            </div>

            <div class="space-y-2">
              <p class="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">Build a meal</p>
              <div class="flex gap-2">
                <UiNativeSelect v-model="draftIngredientId" class="flex-1">
                  <UiNativeSelectOption :value="null" disabled>Pick an ingredient</UiNativeSelectOption>
                  <UiNativeSelectOption v-for="ingredient in ingredients ?? []" :key="ingredient.id" :value="ingredient.id">
                    {{ ingredient.name }}
                  </UiNativeSelectOption>
                </UiNativeSelect>
                <UiMetricInput
                  v-model="draftQuantity"
                  :unit="ingredients?.find((i) => i.id === draftIngredientId)?.unitType === 'count' ? (ingredients?.find((i) => i.id === draftIngredientId)?.unitLabel ?? 'x') : 'g'"
                  class="w-32"
                />
                <Button size="sm" :disabled="draftIngredientId === null || !draftQuantity || draftQuantity <= 0" @click="addDraftItem">Add</Button>
              </div>

              <div v-for="(item, index) in draftItems" :key="index" class="flex items-center justify-between text-sm text-foreground">
                <span>{{ item.quantity }} -- {{ ingredients?.find((i) => i.id === item.ingredientId)?.name }}</span>
                <button @click="removeDraftItem(index)"><TrashIcon class="size-3.5 text-muted-foreground" /></button>
              </div>

              <p v-if="draftItems.length" class="font-mono text-xs text-muted-foreground">
                {{ Math.round(draftTotals.calories) }}cal / {{ Math.round(draftTotals.proteinG) }}g protein
              </p>
            </div>

            <div class="flex gap-2">
              <Button :disabled="!draftItems.length || loggingMeal" @click="onSaveMeal">Log meal</Button>
              <Button
                v-if="!showNewPresetForm"
                variant="secondary"
                :disabled="!draftItems.length"
                @click="showNewPresetForm = true"
              >
                Save as preset
              </Button>
            </div>
            <div v-if="showNewPresetForm" class="flex gap-2">
              <UiInput v-model="newPresetName" placeholder="Preset name" class="flex-1" />
              <Button :disabled="!draftItems.length || !newPresetName.trim() || creatingPresetMeal" @click="onCreatePreset">Save</Button>
            </div>
          </div>
        </UiDrawerContent>
      </UiDrawer>
    </section>

    <section v-if="tab === 'ingredients'" class="space-y-4">
      <div v-for="ingredient in ingredients ?? []" :key="ingredient.id" class="flex items-center justify-between rounded-xl border border-surface-strong bg-card p-4">
        <div>
          <p class="text-sm font-semibold text-foreground">{{ ingredient.name }}</p>
          <p class="font-mono text-[10px] text-muted-foreground">
            {{ ingredient.calories }}cal / {{ ingredient.unitType === 'weight_100g' ? '100g' : `1 ${ingredient.unitLabel}` }}
            -- P{{ ingredient.proteinG }} C{{ ingredient.carbsG }} F{{ ingredient.fatG }}
          </p>
        </div>
        <button :disabled="deleteIngredient.isLoading.value" @click="deleteIngredient.mutate(ingredient.id)">
          <TrashIcon class="size-4 text-muted-foreground" />
        </button>
      </div>
      <p v-if="!ingredients?.length" class="text-center text-sm text-muted-foreground">No ingredients yet.</p>

      <Button v-if="!showNewIngredientForm" variant="secondary" class="w-full gap-2" @click="showNewIngredientForm = true">
        <PlusIcon class="size-4" />Add Ingredient
      </Button>
      <div v-else class="space-y-3 rounded-xl border border-surface-strong bg-card p-4">
        <UiInput v-model="newIngredient.name" placeholder="Name (e.g. Chicken breast)" />
        <UiNativeSelect v-model="newIngredient.unitType">
          <UiNativeSelectOption value="weight_100g">Per 100g</UiNativeSelectOption>
          <UiNativeSelectOption value="count">Per count (cup, can, scoop...)</UiNativeSelectOption>
        </UiNativeSelect>
        <UiInput v-if="newIngredient.unitType === 'count'" v-model="newIngredient.unitLabel" placeholder="Unit label (e.g. can)" />
        <div class="grid grid-cols-2 gap-3">
          <UiMetricInput v-model="newIngredient.calories" unit="cal" />
          <UiMetricInput v-model="newIngredient.proteinG" unit="g protein" />
          <UiMetricInput v-model="newIngredient.carbsG" unit="g carbs" />
          <UiMetricInput v-model="newIngredient.fatG" unit="g fat" />
        </div>
        <div class="flex gap-2">
          <Button
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
      <div v-for="preset in presetMeals ?? []" :key="preset.id" class="flex items-center justify-between rounded-xl border border-surface-strong bg-card p-4">
        <div>
          <p class="text-sm font-semibold text-foreground">{{ preset.name }}</p>
          <p class="font-mono text-[10px] text-muted-foreground">{{ preset.items.length }} ingredient(s)</p>
        </div>
        <div class="flex items-center gap-3">
          <Button size="sm" variant="secondary" :disabled="logPresetMeal.isLoading.value" @click="onQuickLogPreset(preset.id)">Log now</Button>
          <button :disabled="deletePresetMeal.isLoading.value" @click="deletePresetMeal.mutate(preset.id)">
            <TrashIcon class="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>
      <p v-if="!presetMeals?.length" class="text-center text-sm text-muted-foreground">No preset meals yet -- build one from the Today tab's "Log Meal" drawer and save it.</p>
    </section>
  </main>
</template>
