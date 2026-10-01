import { FOOD_CATEGORIES } from "~~/shared/lib/food-categories"
import type { Ingredient } from "~~/shared/types/nutrition.types"

// Shaped to fit ComboboxOption, kept local so this stays importable without the Vue component.
export interface IngredientOption {
  value: number
  label: string
  hint?: string
  group: string
  searchText: string
}

const MY_FOODS = "My foods"
const OTHER_FOODS = "Other foods"
const groupOrder = [MY_FOODS, ...FOOD_CATEGORIES.map((c) => c.en), OTHER_FOODS]

const groupFor = (ingredient: Ingredient): string => {
  if (ingredient.userId !== null) return MY_FOODS
  return FOOD_CATEGORIES.find((c) => c.key === ingredient.category)?.en ?? OTHER_FOODS
}

// The food picker's options: the user's own foods first, then presets grouped in category order.
// Search matches the English name, the Arabic name and alternative spellings ("koshary").
export const ingredientOptions = (ingredients: Ingredient[]): IngredientOption[] =>
  ingredients
    .map((ingredient) => ({
      value: ingredient.id,
      label: ingredient.name,
      hint: ingredient.nameAr ?? undefined,
      group: groupFor(ingredient),
      searchText: [ingredient.name, ingredient.nameAr, ingredient.keywords].filter(Boolean).join(" "),
    }))
    .sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group))
