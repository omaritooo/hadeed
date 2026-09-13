# Arabic & RTL — design

## Goal

Ship Hadeed in Arabic with a correct right-to-left layout. `@nuxtjs/i18n` is installed and
listed in `nuxt.config.ts` modules, but has no configuration, no locale files, and no
`$t` / `useI18n` call anywhere. All 111 `.vue` files hardcode English.

## Scope

**Translated:** all app UI, validation messages, user-facing server-produced text,
achievements, the 51 global preset foods, and push notification copy.

**Stays English:** exercise names and instructions (973 rows). Most Arabic-speaking
lifters already say "bench press" and "squat". Arabic search aliases can come later.

## Approach

`strategy: 'no_prefix'`, with the locale on the user profile, and `_ar` columns for the
little database content that is translated.

Rejected:

- **URL prefix (`/ar/...`).** Every `navigateTo`/`NuxtLink` becomes locale-aware and the
  PWA `start_url` gets complicated, for SEO that barely matters behind a login.
- **Generic `translations(entity, entity_id, locale, field, value)` table.** Scales to many
  languages at the cost of a join on every read. One extra language doesn't need it.

---

## Setup

- `i18n` config: locales `en` (`dir: 'ltr'`) and `ar` (`dir: 'rtl'`), lazy-loaded from
  `i18n/locales/{en,ar}.json`, keys namespaced by area (`common.*`, `nav.*`, `home.*`,
  `session.*`, `workouts.*`, `builder.*`, `nutrition.*`, `profile.*`, `stats.*`,
  `onboarding.*`, `auth.*`, `errors.*`).
- **Arabic pluralization** needs a custom `pluralRules.ar` covering the six CLDR categories
  (zero, one, two, few, many, other). Without it, strings like "3 sets" are wrong.
- **Locale resolution**: `user_profiles.locale` (new, `TEXT NOT NULL DEFAULT 'en' CHECK
  (locale IN ('en','ar'))`), then an `i18n_locale` cookie, then `Accept-Language`, so the
  login page is already right. Switching is on Profile and onboarding step 1, and writes
  both the profile and the cookie.
- **Direction**: `app/app.vue` sets `<html :lang :dir>` via `useHead` and wraps the app in
  Reka UI's `ConfigProvider :dir`, which flips drawers, popovers, comboboxes and radio
  groups.

## String extraction

Staged so each step is reviewable and behavior-preserving:

1. **English keys first**, one PR per page group, with no visible change:
   shared UI and nav → Home → Session → Workouts & Builder → Nutrition → Profile & Stats →
   Onboarding & Login.
2. **Lint guard**: `@intlify/eslint-plugin-vue-i18n` `no-raw-text` at `warn`, raised to
   `error` once extraction is done.
3. **`ar.json`**, reviewed by a native speaker.

## Server-produced text

- API `statusMessage` stays English. It is developer-facing; the client maps known
  failures to `errors.*` keys.
- User-facing prose becomes `{ key, params }`:
  - preset recommendation `reasons` (currently English strings in
    `preset-split.service.ts`)
  - progression `suggestion_reason` (already a key in the progression design)
  - adaptive-TDEE copy
  - Zod schema messages in `shared/schemas/`, via a shared error map emitting keys
- Hydration push notifications are rendered in the recipient's `user_profiles.locale`.

## Database content

- `ALTER TABLE ingredients ADD COLUMN name_ar TEXT;` (populated only for global preset rows,
  from a `nameAr` field added to `preset_foods.json`)
- `ALTER TABLE achievements ADD COLUMN name_ar TEXT;` and `description_ar TEXT`, populated
  from `seed.ts`
- Repositories take the request locale and select `COALESCE(name_ar, name)` when it is
  `ar`. User-created ingredients are never translated.

## Numbers & dates

- **Arabic-Indic digits** (٠١٢٣٤٥٦٧٨٩) in the Arabic locale: numbers display through
  `Intl.NumberFormat('ar-u-nu-arab')` and `$n()`. Raw `{{ value }}` number interpolations
  are converted during extraction. `no-raw-text` doesn't catch numbers, so each page PR
  checks for them explicitly.
- **Inputs.** `type="number"` accepts only Latin digits, and Arabic mobile keyboards type
  ٠–٩. `UiNumberStepper`, `UiMetricInput` and the remaining numeric inputs become
  `type="text" inputmode="decimal"`. A shared `parseLocaleNumber` (`shared/lib/locale-number.ts`)
  normalizes Arabic-Indic ٠–٩, Persian ۰–۹, and the Arabic decimal separator `٫` before
  parsing, and values are displayed back in the locale's digits.
- **Unit labels** (kg, lb, ml, kcal, g) are translated keys.
- **Dates and durations** use `Intl.DateTimeFormat` with the locale (Gregorian calendar),
  including the session elapsed timer, which is currently hand-formatted.
- **Charts** keep a left-to-right time axis inside a `dir="ltr"` wrapper, with tick labels
  formatted in the locale's digits. The plate calculator and steppers are also `dir="ltr"`
  islands, so − / + don't swap sides.

## RTL styling

- Convert the ~30 physical-direction Tailwind classes to logical ones: `ml/mr → ms/me`,
  `pl/pr → ps/pe`, `left/right → inset-s/inset-e`, `text-left/right → text-start/end`,
  `rounded-l/r → rounded-s/e`, `border-l/r → border-s/e`.
- `npm run lint:rtl`: a grep check failing on physical-direction classes, run in the lint
  step.
- Directional icons (chevrons, arrows, back buttons) get `rtl:-scale-x-100`.
- **Letter-spacing breaks Arabic.** Arabic is cursive, and tracking disconnects its letters.
  The app's label style is `font-mono uppercase tracking-[1.2px]` throughout, so a global
  rule resets it:

  ```css
  :lang(ar) { letter-spacing: normal !important; text-transform: none !important; }
  ```

- **Fonts**: add IBM Plex Sans Arabic (body) and Noto Kufi Arabic (heading) through
  `@nuxt/fonts`, appended after Inter and Anybody in the font stacks, so Latin rendering is
  unchanged and Arabic falls through to the Arabic faces. JetBrains Mono labels fall
  back to IBM Plex Sans Arabic.

## Testing

- `en.json` and `ar.json` have identical key sets (a test walks both).
- Unit tests for `pluralRules.ar` across the six categories, and for `parseLocaleNumber`
  (Arabic-Indic, Persian, `٫`, mixed input, invalid input).
- Repository tests: `_ar` is selected for `ar` and falls back to English when null; user
  ingredients are unaffected.
- `lint:rtl` runs with `npm run lint`.

## Out of scope

- Translating the exercise catalog, and Arabic exercise search aliases.
- Languages beyond English and Arabic.
- Hijri calendar display.
