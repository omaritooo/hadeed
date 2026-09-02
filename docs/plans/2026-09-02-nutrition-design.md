# Nutrition tracking — design

## Goal

Log meals, have the app calculate their macros from a personal ingredient catalog (grams for weight-based items, count for canned/unit-based items — same math as the user's existing Excel sheet), track daily totals against a standalone daily macro target, and support saving/reusing preset meals.

## Data model

Additions to `server/database/schema.sql`.

```sql
CREATE TABLE ingredients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  unit_type   TEXT NOT NULL CHECK (unit_type IN ('weight_100g', 'count')),
  unit_label  TEXT,               -- e.g. 'cup', 'can', 'scoop'; null when unit_type = 'weight_100g'
  calories    REAL NOT NULL,      -- per 100g if weight_100g, per 1 unit_label if count
  protein_g   REAL NOT NULL,
  carbs_g     REAL NOT NULL,
  fat_g       REAL NOT NULL
);

CREATE TABLE meal_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT,                -- optional label, e.g. "Breakfast"
  logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meal_log_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_log_id      INTEGER NOT NULL REFERENCES meal_logs(id) ON DELETE CASCADE,
  ingredient_id    INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  ingredient_name  TEXT NOT NULL,   -- snapshot: survives ingredient rename/delete
  quantity         REAL NOT NULL,   -- grams if weight_100g, count if count
  calories         REAL NOT NULL,   -- snapshot: this line's computed macros
  protein_g        REAL NOT NULL,
  carbs_g          REAL NOT NULL,
  fat_g            REAL NOT NULL
);

CREATE TABLE preset_meals (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL
);

CREATE TABLE preset_meal_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_meal_id   INTEGER NOT NULL REFERENCES preset_meals(id) ON DELETE CASCADE,
  ingredient_id    INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity         REAL NOT NULL
);

ALTER TABLE user_profiles ADD COLUMN nutrition_target_calories REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_protein_g REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_carbs_g REAL;
ALTER TABLE user_profiles ADD COLUMN nutrition_target_fat_g REAL;

CREATE INDEX idx_ingredients_user       ON ingredients(user_id);
CREATE INDEX idx_meal_logs_user         ON meal_logs(user_id, logged_at);
CREATE INDEX idx_meal_log_items_meal    ON meal_log_items(meal_log_id);
CREATE INDEX idx_preset_meals_user      ON preset_meals(user_id);
CREATE INDEX idx_preset_meal_items_meal ON preset_meal_items(preset_meal_id);
```

Meal log items snapshot their computed macros (and the ingredient name) at log time rather than re-deriving from the live `ingredients` row, so editing an ingredient later doesn't silently rewrite past totals — same reasoning as why `exercise_logs`/`set_logs` don't recompute from a changed exercise definition.

**Macro calculation**: `scale = unit_type === 'weight_100g' ? quantity / 100 : quantity`; each macro = `ingredient.macro * scale`. Computed server-side whenever a meal is logged (ad-hoc or from a preset).

Daily target is standalone (`user_profiles.nutrition_target_*`), independent of the existing (currently unused) `Block.trainingDayMacroTarget`/`restDayMacroTarget`.

## Backend

New repositories/service, mirroring `hydration.repository.ts` / `hydration.service.ts`:

- `ingredient.repository.ts` — CRUD, scoped to `user_id`
- `meal-log.repository.ts` — `log(userId, name, items)` (transactional insert of `meal_logs` + `meal_log_items`), `findForRange(userId, start, end)`, `delete(id, userId)`
- `preset-meal.repository.ts` — CRUD for presets + their items
- `nutrition.service.ts` — macro-scaling math, plus `getToday()`: sums today's items, joins the profile's target, returns `{ totals, target, remaining, meals }` (same shape as `HydrationService.getToday()`)

API routes under `/api/nutrition`, following the existing filename convention:

```
GET    /api/nutrition                    today's summary
POST   /api/nutrition                    log an ad-hoc meal {name?, items:[{ingredientId, quantity}]}
DELETE /api/nutrition/[id]               delete a meal log
POST   /api/nutrition/target             set daily macro target (null clears it)
GET    /api/nutrition/ingredients
POST   /api/nutrition/ingredients
PATCH  /api/nutrition/ingredients/[id]
DELETE /api/nutrition/ingredients/[id]
GET    /api/nutrition/presets
POST   /api/nutrition/presets            {name, items}
DELETE /api/nutrition/presets/[id]
POST   /api/nutrition/presets/[id]/log   quick-log a preset as today's meal
```

Each route gets a `defineRouteMeta({ openAPI: ... })` block. Repository + service tests follow the existing `tests/server/repositories/*.test.ts` / `tests/server/services/*.test.ts` pattern (in-memory libsql).

## Frontend

**Types & composables** (`shared/types/nutrition.types.ts`, `app/composables/*`) mirror the hydration set: `useNutritionToday` (query), `useLogMeal`, `useLogPresetMeal`, `useSetNutritionTarget` (mutations invalidating `queryKeys.nutrition()`), plus `useIngredients`/`useCreateIngredient`/`useDeleteIngredient` and `usePresetMeals`/`useCreatePresetMeal`/`useDeletePresetMeal`.

**Home page (`index.vue`)** — a "Nutrition" card after the Hydration card, same visual language: big `calories consumed / target` number, thin progress bar, small protein/carbs/fat readout, "Log meal" link. No target set → "No daily target — set one" linking to `/profile`, matching the hydration card's existing pattern.

**New `/nutrition` page** (not in the bottom nav — reached via the home card, same as hydration's target flow going through `/profile`), three tabs:
- **Today** — macro progress (calories + P/C/F bars), today's logged meals with delete. "Log Meal" opens a Drawer: tap a preset to quick-log it, or build ad-hoc by picking ingredients + quantity with a live running total, then save.
- **Ingredients** — catalog list; add (name, weight-based-per-100g or count-based-with-label, macros), edit, delete.
- **Presets** — saved preset meals (name + total macros); create from ingredients, delete, "log now".

**Profile page** — a "Nutrition Target" section (calories/protein/carbs/fat inputs), same layout as the existing "Hydration Reminders" section, posting to `/api/nutrition/target`.
