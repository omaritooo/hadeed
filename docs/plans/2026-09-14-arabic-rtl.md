# Arabic & RTL Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Hadeed in English and Arabic, with a correct RTL layout, Arabic-Indic digits, translated preset foods, achievements and push copy. Exercise names stay English.

**Architecture:** `@nuxtjs/i18n` (already installed, v10) with `strategy: 'no_prefix'`, lazy JSON locale files, a custom Arabic plural rule, and number formats using `numberingSystem: 'arab'`. `<html lang dir>` comes from `useLocaleHead`, and Reka's `ConfigProvider` flips primitives. Strings are extracted page group by page group behind an ESLint `no-raw-text` guard. Server prose becomes `{ key, params }`. Database content gets `_ar` columns. Numeric inputs accept any digit system through `parseLocaleNumber`.

**Tech Stack:** Nuxt 4, `@nuxtjs/i18n` 10 / vue-i18n, Reka UI, Tailwind 4, `@nuxt/fonts`, `@intlify/eslint-plugin-vue-i18n`, Vitest.

**Design doc:** `docs/plans/2026-09-14-arabic-rtl-design.md`

---

## Before you start

- **Run last** of the 2026-09-14 plans. It converts strings those plans add (progression
  reasons, streak copy, sync status, TDEE card, limitation chips). If one hasn't landed,
  skip its strings and leave a `TODO(i18n)` noting the plan name.
- The in-flight `UiNumberStepper` / `UiMetricInput` / session page edits from another
  session (see the progression plan) must be landed before Task 4.
- Commit on `main`, explicit paths, messages ending
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Native-speaker review** of `i18n/locales/ar.json` is a release gate (Task 12). Machine
  drafts are fine until then.

---

### Task 1: i18n configuration, plural rule, number formats

**Files:**
- Create: `i18n/i18n.config.ts`, `i18n/locales/en.json`, `i18n/locales/ar.json`
- Create: `shared/lib/arabic-plural.ts`, `tests/shared/lib/arabic-plural.test.ts`
- Modify: `nuxt.config.ts`

**Step 1: Write the failing plural test**

```ts
// tests/shared/lib/arabic-plural.test.ts
import { describe, expect, it } from 'vitest'
import { arabicPluralIndex } from '~~/shared/lib/arabic-plural'

// Message forms, in order: zero | one | two | few | many | other
describe('arabicPluralIndex', () => {
  it.each([
    [0, 0], [1, 1], [2, 2],
    [3, 3], [10, 3], [103, 3],
    [11, 4], [99, 4], [111, 4],
    [100, 5], [101, 5], [102, 5], [200, 5],
  ])('%i -> form %i', (n, form) => {
    expect(arabicPluralIndex(n, 6)).toBe(form)
  })

  it('falls back to the last form when a message has fewer than six', () => {
    expect(arabicPluralIndex(5, 2)).toBe(1)
    expect(arabicPluralIndex(1, 2)).toBe(1)
  })
})
```

Run: `npx vitest run tests/shared/lib/arabic-plural.test.ts` → FAIL (module not found).

**Step 2: Implement**

```ts
// shared/lib/arabic-plural.ts
// CLDR plural categories for Arabic, as vue-i18n choice indexes:
// zero | one | two | few (3–10) | many (11–99) | other (100–102, …).
// Messages that don't provide all six forms use their last form for anything past what they
// define, so a two-form message still reads sensibly.
export const arabicPluralIndex = (choice: number, choicesLength: number): number => {
  const n = Math.abs(choice)
  const mod100 = n % 100
  const index = n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : mod100 >= 3 && mod100 <= 10 ? 3 : mod100 >= 11 && mod100 <= 99 ? 4 : 5
  return choicesLength < 6 ? Math.min(index, choicesLength - 1) : index
}
```

Run the test → PASS (14 tests).

**Step 3: Config**

```ts
// i18n/i18n.config.ts
import { arabicPluralIndex } from '~~/shared/lib/arabic-plural'

const numberFormats = (numberingSystem: 'latn' | 'arab') => ({
  integer: { maximumFractionDigits: 0, numberingSystem },
  decimal: { maximumFractionDigits: 1, numberingSystem },
  percent: { style: 'percent', maximumFractionDigits: 0, numberingSystem },
}) as const

export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'en',
  pluralRules: { ar: arabicPluralIndex },
  numberFormats: { en: numberFormats('latn'), ar: numberFormats('arab') },
  datetimeFormats: {
    en: { short: { day: 'numeric', month: 'short' }, long: { day: 'numeric', month: 'short', year: 'numeric' } },
    ar: { short: { day: 'numeric', month: 'short', numberingSystem: 'arab' }, long: { day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'arab' } },
  },
}))
```

`nuxt.config.ts`, add a top-level key:

```ts
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', language: 'en', dir: 'ltr', file: 'en.json', name: 'English' },
      { code: 'ar', language: 'ar', dir: 'rtl', file: 'ar.json', name: 'العربية' },
    ],
    vueI18n: './i18n.config.ts',
    detectBrowserLanguage: { useCookie: true, cookieKey: 'i18n_locale', redirectOn: 'root', alwaysRedirect: false, fallbackLocale: 'en' },
  },
```

`i18n/locales/en.json` and `ar.json` start as `{ "common": { "appName": "Hadeed" } }` /
`{ "common": { "appName": "حديد" } }`.

**Step 4: Verify**

`npm run dev`. The app renders unchanged. In the browser console,
`useNuxtApp().$i18n.locale.value` is `'en'`.

**Step 5: Commit**

```bash
git add i18n shared/lib/arabic-plural.ts tests/shared/lib/arabic-plural.test.ts nuxt.config.ts
git commit -m "feat(i18n): configure English and Arabic locales with Arabic plurals and digits"
```

---

### Task 1b: Precache locale messages for offline Arabic (found during Task 1) — DONE (`139ee8a`)

**Not in the original plan.** The plan assumed lazy locale JSON is emitted as a client asset that
`injectManifest.globPatterns` could precache by adding `json`. `@nuxtjs/i18n` v10 does not work
that way: messages are bundled into the Nitro server and served on demand from
`/_i18n/<build-hash>/<locale>/messages.json`. No such file exists in `.output/public`, so widening
the glob would precache nothing, and the service worker's `OFFLINE_READS` patterns don't match
`/_i18n/` either.

**What already works:** `experimental.stripMessagesPayload` defaults to `false`, so SSR-rendered
messages ride along in the Nuxt payload. A page cached by the service worker while the user was in
Arabic replays in Arabic offline.

**The gap:** a cold client-side locale switch while offline, and any client-side load of a locale
whose messages were never installed. Both fetch `/_i18n/...` and fail. Offline session logging
shipped, so a lifter in a basement gym is the normal case, not the edge one.

**Fix, either:**
- `i18n.experimental.prerenderMessages: true`, which pushes the messages route into nitro's
  prerender routes so it lands in `.output/public` as a static file, then add `json` to
  `injectManifest.globPatterns`; or
- a workbox `registerRoute` for `/_i18n/`. `CacheFirst` is safe — the URL carries a build hash, so
  it is immutable.

Done alongside Task 2 in `139ee8a`, via `prerenderMessages: true` plus a narrow
`_i18n/**/*.json` glob (rather than a blanket `json`, which would adopt whatever future build
step drops a JSON file into `.output/public`). Verified in the build output: both
`.output/public/_i18n/<hash>/{en,ar}/messages.json` exist and both appear in `sw.js`'s precache
manifest.

---

### Task 2: Direction, fonts, letter-spacing

**Files:**
- Modify: `app/app.vue`
- Modify: `nuxt.config.ts` (`fonts.families`)
- Modify: `app/assets/css/index.css`

**Step 1: `app.vue`**

```vue
<script setup lang="ts">
import { ConfigProvider } from "reka-ui";

const head = useLocaleHead();
const dir = computed(() => (head.value.htmlAttrs?.dir as "ltr" | "rtl" | undefined) ?? "ltr");

useHead(() => ({
  htmlAttrs: { lang: head.value.htmlAttrs?.lang, dir: dir.value },
}));
</script>

<template>
  <ConfigProvider :dir="dir">
    <NuxtLayout />
  </ConfigProvider>
</template>
```

**Step 2: Fonts.** Append to `fonts.families`:

```ts
      { name: 'IBM Plex Sans Arabic', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'Noto Kufi Arabic', provider: 'google', weights: [600, 700, 800] },
```

**Step 3: CSS.** Change the three font tokens so Arabic glyphs fall through to Arabic faces
while Latin rendering is unchanged:

```css
  --font-heading: "Anybody", "Noto Kufi Arabic", sans-serif;
  --font-sans: "Inter", "IBM Plex Sans Arabic", sans-serif;
  --font-mono: "JetBrains Mono", "IBM Plex Sans Arabic", monospace;
```

Append at the end of the file:

```css
/*
 * Arabic is cursive: letter-spacing pulls joined letters apart, and uppercase is meaningless.
 * The app's label style (font-mono uppercase tracking-[…]) is used everywhere, so reset both
 * globally for Arabic rather than touching every label. `lang` inherits from <html>.
 */
:lang(ar) {
  letter-spacing: normal !important;
  text-transform: none !important;
}
```

**Step 4: Verify.** Temporarily force Arabic with
`useNuxtApp().$i18n.setLocale('ar')` in the console:
- `<html>` has `lang="ar" dir="rtl"`
- the layout mirrors (bottom nav order, drawers slide from the correct side)
- no console errors
- switching back with `setLocale('en')` restores everything

**Step 5: Commit**

```bash
git add app/app.vue nuxt.config.ts app/assets/css/index.css
git commit -m "feat(i18n): set document direction and add Arabic font fallbacks"
```

---

### Task 3: RTL class lint and logical-property conversion — DONE (`e5f520a`)

**Files:**
- Create: `scripts/lint-rtl.ts`, `tests/scripts/lint-rtl.test.ts`
- Modify: `package.json` (scripts)
- Modify: every `.vue`/`.ts` file the lint reports

> **Corrections made while implementing.** The original draft of this task is kept honest
> below; three things in it were wrong or too narrow.
>
> 1. **`inset-s-*` was not the class to standardise on.** It does exist — Tailwind 4.3.3
>    registers `inset-s`/`inset-e` next to `inset-x`/`inset-y`, and `inset-s-1` compiles to
>    `inset-inline-start: var(--spacing)` — so the draft was not producing dead classes. But
>    `start-*`/`end-*` is the spelling Tailwind documents, and it has existed since v3.3 where
>    `inset-s-*` is recent, so a downgrade would silently kill it. The table below uses
>    `start-*`/`end-*`. Everything else in the table was verified against the installed
>    Tailwind by compiling each candidate and reading the generated rule:
>    `rounded-ss`/`se`/`es`/`ee` → `border-start-start-radius` etc., `border-s`/`border-e` →
>    `border-inline-start-width`, `text-start`/`text-end` → `text-align: start|end`.
> 2. **`app/**/*.vue` misses real hits.** `app/components/ui/input-group/index.ts` holds a
>    `cva()` map with `pl-3` and `has-[>button]:ml-[-0.45rem]` in it. The lint globs
>    `app/**/*.{vue,ts,css}` (`.css` so an `@apply` cannot smuggle one in).
> 3. **The draft regex missed several real classes.** It could not see variant chains with
>    brackets in them (`**:data-[slot=native-select-icon]:right-1`,
>    `has-[>[data-align=inline-start]]:[&>input]:pl-2`), arbitrary values with a negative
>    inside (`ml-[-0.45rem]`), or `float-*`/`clear-*`/`scroll-m*`/`scroll-p*` at all. Those
>    four blind spots accounted for 4 of the 54 hits, and a missed class is an unmirrored
>    layout that nothing downstream catches.

**Step 1: Write the failing test**

`tests/scripts/lint-rtl.test.ts` covers, beyond the obvious cases: negative, fractional,
arbitrary and `(--var)` values; stacked, arbitrary, container-query, `group-*`/`peer-*`,
`has-[...]`, `*:`/`**:` variants; both spellings of the important marker; every corner-radius
and border side; classes in `:class` object/array/ternary syntax, in `<script>` blocks and in
`@apply`; `--spacing-*` theme names; and the escape-hatch markers. It also pins the
false-positive side, which matters as much here: this codebase is full of `pr` (personal
record), `pl`, `profile`, `preset` and the words "left"/"right" in prose, and a lint that
cried wolf would push someone into a wrong conversion.

**Step 2: Implement**

`scripts/lint-rtl.ts` exports `scanSource` (hits with line numbers),
`findPhysicalDirectionClasses` (the class names) and `themeSpacingNames` (reads `--spacing-*`
keys out of `app/assets/css/index.css`, so `pl-edge-margin` cannot slip past a hand-kept value
list). Word-shaped values are a closed list on purpose — opening them to `[a-z]+` matches
`pr-history` and `left-handed`.

It walks with `readdirSync(..., { recursive: true })` rather than `fs.globSync`, which is still
experimental on Node 22 and prints a warning over otherwise clean lint output.

**Escape hatch.** Some physical classes are right, so the lint takes
`lint-rtl-ignore-next-line` and `lint-rtl-ignore-line` markers (spelled like ESLint's, so a
reader never has to guess which line one covers), each expected to carry a reason.

**Step 3: Wire and convert**

`package.json`: `"lint:rtl": "tsx scripts/lint-rtl.ts"`.

| Physical | Logical |
| --- | --- |
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `left-*` / `right-*` | `start-*` / `end-*` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `rounded-l*` / `rounded-r*` | `rounded-s*` / `rounded-e*` |
| `rounded-tl` / `tr` / `bl` / `br` | `rounded-ss` / `se` / `es` / `ee` |
| `border-l` / `border-r` | `border-s` / `border-e` |
| `float-left` / `float-right` | `float-start` / `float-end` |
| `clear-left` / `clear-right` | `clear-start` / `clear-end` |
| `scroll-ml-*` / `scroll-mr-*` | `scroll-ms-*` / `scroll-me-*` |
| `scroll-pl-*` / `scroll-pr-*` | `scroll-ps-*` / `scroll-pe-*` |

54 hits across 24 files. Three did not convert one-for-one:

- **Centring pairs.** `left-1/2` paired with `-translate-x-1/2` cannot be half-converted: a
  translate has no logical form, so mirroring only the inset moves the element off centre.
  The carousel's vertical buttons and the radio dot use `inset-x-0 mx-auto` instead, which
  centres with nothing physical left to mirror.
- **Physically-keyed APIs.** `DrawerContent`'s `data-[swipe-direction=right]:right-0` is keyed
  to Reka's physical `direction` prop, which also drives the swipe gesture and the
  `slide-in-from-right` animation. `end-0` would park a right-swiping drawer against the left
  edge in Arabic while it still slid in from the right. Both stay physical, marked.
- **Paired translates.** The nutrition log/check pill sat at `left-1` and slid with
  `translate-x-full`; the grid reverses in Arabic, so it needs `start-1` *and*
  `rtl:-translate-x-full`.

`app/components/ui/chart/*` holds no physical-direction classes (this project charts with
unovis, not recharts), so nothing there needed excluding. Charts stay LTR — Task 4.

Directional icons get `class="rtl:-scale-x-100"` — 15 sites (step nav, calendar month arrows,
carousel arrows, nutrition day nav, and the "Back"/"Continue" arrows). `ArrowLeftRightIcon` is
symmetric; skipped.

**Step 4: Verify**

`npm run lint:rtl` exits 0. Because the lint only looks for *physical* classes, a typo'd
logical class would pass it silently, so the check that actually matters is the built
stylesheet: after `npm run build`, every logical class introduced by the diff appears as a real
rule in `.output/public/_nuxt/*.css` (32 of 32, `rtl:-scale-x-100` and
`rtl:-translate-x-full` included).

What only a human at a browser can confirm: that the mirrored layout reads right in Arabic,
and that English is pixel-identical to before.

**Step 5: Commit**

```bash
git add scripts/lint-rtl.ts tests/scripts/lint-rtl.test.ts package.json <each app file>
git commit -m "feat(i18n): use logical direction classes and lint against physical ones"
```

---

### Task 4: Locale-aware numbers in inputs and LTR islands

**Files:**
- Create: `shared/lib/locale-number.ts`, `tests/shared/lib/locale-number.test.ts`
- Modify: `app/components/ui/NumberStepper.vue`, `app/components/ui/MetricInput.vue`, and every other `type="number"` input (`grep -rn 'type="number"' app`)
- Modify: `app/components/ui/chart/ChartContainer.vue`, `app/components/session/PlateCalculator.vue`

**Step 1: Write the failing tests**

```ts
// tests/shared/lib/locale-number.test.ts
import { describe, expect, it } from 'vitest'
import { normalizeDigits, parseLocaleNumber } from '~~/shared/lib/locale-number'

describe('normalizeDigits', () => {
  it('maps Arabic-Indic and Persian digits and the Arabic decimal separator', () => {
    expect(normalizeDigits('٦٢٫٥')).toBe('62.5')
    expect(normalizeDigits('۱۰۰')).toBe('100')
    expect(normalizeDigits('١٬٢٥٠')).toBe('1250')
  })
})

describe('parseLocaleNumber', () => {
  it.each([
    ['62.5', 62.5], ['٦٢٫٥', 62.5], ['62,5', 62.5], [' ١٠ ', 10], ['-٣', -3], ['8', 8],
  ])('%s -> %s', (input, expected) => {
    expect(parseLocaleNumber(input)).toBe(expected)
  })

  it.each(['', '  ', 'abc', '6.2.5', '١٢a', '.'])('rejects %j', (input) => {
    expect(parseLocaleNumber(input)).toBeNull()
  })
})
```

Run → FAIL.

**Step 2: Implement**

```ts
// shared/lib/locale-number.ts
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹'

// Arabic mobile keyboards type ٠–٩ (or Persian ۰–۹) and ٫ for the decimal point, and
// type="number" inputs reject them outright. Normalize to ASCII before parsing.
export const normalizeDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/g, d => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, d => String(PERSIAN.indexOf(d)))
    .replace(/[٬\s]/g, '')
    .replace(/[٫,]/g, '.')

export const parseLocaleNumber = (value: string): number | null => {
  const normalized = normalizeDigits(value)
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized) || normalized === '.') return null
  return Number(normalized)
}
```

Run → PASS.

**Step 3: Inputs.** In `UiNumberStepper` and `UiMetricInput`, and each remaining numeric
input:
- `type="number"` → `type="text" inputmode="decimal"` (or `inputmode="numeric"` for integers such as reps).
- Keep the component's `string` model, and don't parse on every keystroke.
- Wherever the component (or its caller) converts the model to a number (`Number(x)`), use `parseLocaleNumber(x) ?? <existing fallback>` instead. `grep -rn "Number(" app` lists the sites: the session page drafts, nutrition quantities, body metrics, hydration custom amount and builder steppers.
- Steppers' +/− handlers: `const current = parseLocaleNumber(model.value) ?? 0`.
- Display the stepped value back with `n(value, 'decimal')` from `useI18n()`.
- Wrap each stepper's root in `dir="ltr"` so − stays on the left and + on the right in both locales.

**Step 4: LTR islands.** Add `dir="ltr"` to the root element of `ChartContainer.vue` (time
axes read left-to-right) and `PlateCalculator.vue`. Chart tick and tooltip formatters use
`n(value, 'integer')` so digits follow the locale.

**Step 5: Verify.** `npm run dev`. In English, log a set with 62.5 kg. Switch to Arabic
(console `setLocale('ar')`), type `٦٥` in the weight field and log it. The set shows `٦٥`,
and the database row has `weight_kg = 65`.

**Step 6: Commit**

```bash
git add shared/lib/locale-number.ts tests/shared/lib/locale-number.test.ts app/components app/pages
git commit -m "feat(i18n): accept Arabic-Indic digits in numeric inputs and keep steppers and charts LTR"
```

---

### Task 5: Locale on the profile, switcher, server locale

**Files:**
- Modify: `server/database/schema.sql`, `shared/types/profile.types.ts`, `server/repositories/profile.repository.ts` (`mapRow`, `updatePreferences` or equivalent, `findWithRemindersEnabled`)
- Modify: `server/api/profile/preferences.post.ts`
- Create: `server/utils/request-locale.ts`, `tests/server/utils/request-locale.test.ts`
- Create: `app/plugins/locale-sync.client.ts`
- Modify: `app/pages/profile.vue`, `app/components/onboarding/FirstStep.vue`
- Test: `tests/server/repositories/profile.repository.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/server/utils/request-locale.test.ts
import { describe, expect, it } from 'vitest'
import { resolveLocale } from '~~/server/utils/request-locale'

describe('resolveLocale', () => {
  it('prefers the profile, then the cookie, then Accept-Language', () => {
    expect(resolveLocale({ profileLocale: 'ar', cookie: 'en', acceptLanguage: 'en' })).toBe('ar')
    expect(resolveLocale({ profileLocale: null, cookie: 'ar', acceptLanguage: 'en-US' })).toBe('ar')
    expect(resolveLocale({ profileLocale: null, cookie: undefined, acceptLanguage: 'ar-EG,ar;q=0.9,en;q=0.8' })).toBe('ar')
    expect(resolveLocale({ profileLocale: null, cookie: 'fr', acceptLanguage: 'fr-FR' })).toBe('en')
  })
})
```

Plus a profile repository test that `locale` defaults to `'en'` and round-trips `'ar'`
through the preferences update.

Run → FAIL.

**Step 2: Implement**

`schema.sql`: `ALTER TABLE user_profiles ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar'));`

`UserProfile.locale: AppLocale` where `shared/lib/locales.ts` exports
`export const LOCALES = ['en', 'ar'] as const; export type AppLocale = typeof LOCALES[number]`.

```ts
// server/utils/request-locale.ts
import type { H3Event } from 'h3'
import { getCookie, getHeader } from 'h3'
import { LOCALES, type AppLocale } from '~~/shared/lib/locales'

const isLocale = (value: unknown): value is AppLocale => typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

export const resolveLocale = (input: { profileLocale: string | null | undefined, cookie: string | undefined, acceptLanguage: string | undefined }): AppLocale => {
  if (isLocale(input.profileLocale)) return input.profileLocale
  if (isLocale(input.cookie)) return input.cookie
  const preferred = (input.acceptLanguage ?? '').split(',').map(part => part.split(';')[0]!.trim().slice(0, 2).toLowerCase())
  return preferred.find(isLocale) ?? 'en'
}

export const localeFromEvent = (event: H3Event, profileLocale?: string | null): AppLocale =>
  resolveLocale({ profileLocale, cookie: getCookie(event, 'i18n_locale'), acceptLanguage: getHeader(event, 'accept-language') })
```

`preferences.post.ts`: accept optional `locale` (validated with `isLocale`), persisted by the
same repository update as `unitSystem`. `findWithRemindersEnabled` also selects `locale`.

**Step 3: Client sync and switcher**

```ts
// app/plugins/locale-sync.client.ts
// The cookie decides the first paint; once the profile loads, the account's saved language wins
// so a user who picked Arabic on their phone gets Arabic on a fresh browser too.
export default defineNuxtPlugin((nuxtApp) => {
  const { data: profile } = useProfile()
  watch(() => profile.value?.profile?.locale, (saved) => {
    const i18n = nuxtApp.$i18n
    if (saved && saved !== i18n.locale.value) void i18n.setLocale(saved)
  }, { immediate: true })
})
```

`profile.vue`: a Language row with two options (English / العربية). On change:
`await setLocale(code)` (`useI18n().setLocale`, which sets the cookie) and send `locale`
through the existing preferences mutation.
`FirstStep.vue`: the same two-option toggle at the top, `setLocale` only (no account yet),
and include the chosen locale in the onboarding submit so `completeOnboarding` persists it
(add `locale` to `UpsertProfileInput`).

**Step 4: Verify**

Tests pass. Manually: switch to Arabic on Profile and reload (still Arabic); open a private
window and log in (Arabic after the profile loads).

**Step 5: Commit**

```bash
git add server shared app/plugins/locale-sync.client.ts app/pages/profile.vue app/components/onboarding/FirstStep.vue tests
git commit -m "feat(i18n): persist the chosen language on the profile and resolve it server-side"
```

---

### Task 6: Server prose → keys; translated push copy

**Files:**
- Modify: `server/services/preset-split.service.ts`, `shared/types/preset.types.ts`
- Modify: `shared/schemas/login.ts`, `shared/schemas/onboarding.ts`, `app/components/ui/field/FormField.vue`
- Create: `server/utils/push-messages.ts`
- Modify: `server/services/hydration-reminder.service.ts`
- Tests: `tests/server/services/preset-split.service.test.ts`, `tests/server/services/hydration-reminder.service.test.ts` (if present)

**Step 1: Recommendation reasons.** `SplitRecommendation.reasons: { key: string, params?: Record<string, string | number> }[]`:

| Before | After |
| --- | --- |
| `` `fits your ${n} days/week` `` | `{ key: 'fitsDays', params: { days: n } }` |
| `` `close to your ${n} days/week` `` | `{ key: 'closeDays', params: { days: n } }` |
| `` `matches your ${level} experience` `` | `{ key: 'matchesExperience', params: { level } }` |
| `` `matches your ${goal} goal` `` | `{ key: 'matchesGoal', params: { goal } }` |
| `` `works with your ${equipment} access` `` | `{ key: 'worksWithEquipment', params: { equipment } }` |
| (limitations plan) `N exercise(s) load your …` | `{ key: 'loadsLimitation', params: { count, areas: 'shoulder,knee' } }` |

Update the service tests to assert on keys, e.g.
`expect(results[0]!.reasons.map(r => r.key)).toContain('fitsDays')` and
`expect(fullBody.reasons).toContainEqual({ key: 'worksWithEquipment', params: { equipment: 'bodyweight' } })`.

Client (where reasons render: `PresetPicker.vue`): `t(`recommendation.${reason.key}`, { ...reason.params, level: t(`experience.${reason.params?.level}`) … })`.
Translate enum params (`level`, `goal`, `equipment`, `areas`) through their own
`experience.*` / `goal.*` / `equipment.*` / `jointArea.*` keys before interpolating.

**Step 2: Validation messages.** Replace each Zod message string with a key:
`'Enter a valid email address.'` → `'validation.email'`, `'Full name is required.'` →
`'validation.fullNameRequired'`, and so on (one key per distinct message). In
`FormField.vue`, render each error through
`te(message) ? t(message) : message`, so any message not yet keyed still shows.

**Step 3: Push copy**

```ts
// server/utils/push-messages.ts
import type { AppLocale } from '~~/shared/lib/locales'

export const HYDRATION_REMINDER: Record<AppLocale, { title: string, body: string }> = {
  en: { title: 'Hadeed', body: 'Time to drink some water 💧' },
  ar: { title: 'حديد', body: 'حان وقت شرب الماء 💧' },
}
```

`hydration-reminder.service.ts`: `JSON.stringify(HYDRATION_REMINDER[candidate.locale ?? 'en'])`.
Update its test fixtures with `locale`.

**Step 4: Verify.** `npx vitest run` passes.

**Step 5: Commit**

```bash
git add server shared app/components/ui/field/FormField.vue tests
git commit -m "feat(i18n): return recommendation reasons and validation messages as keys; localize push copy"
```

---

### Task 7: Translated database content

**Files:**
- Modify: `server/database/schema.sql`
- Modify: `preset_foods.json` (add `nameAr` per food), `server/database/seed.ts` (ingredient + achievement upserts)
- Modify: `server/repositories/ingredient.repository.ts`, `server/repositories/achievement.repository.ts`
- Modify: the routes/services that call them (pass the request locale via `localeFromEvent`)
- Tests: `tests/server/repositories/ingredient.repository.test.ts`, `achievement.repository.test.ts`

**Step 1: Write the failing tests**

```ts
// ingredient.repository.test.ts
  it('returns the Arabic name of a global preset food for the ar locale, falling back to English', async () => {
    await db.execute(`INSERT INTO ingredients (user_id, name, name_ar, unit_type, calories, protein_g, carbs_g, fat_g) VALUES (NULL, 'Oats', 'شوفان', 'weight_100g', 336, 14, 54, 1), (NULL, 'Tahini', NULL, 'weight_100g', 595, 17, 21, 54)`)
    const names = (await repo.findAllForUser('user-1', 'ar')).map(i => i.name)
    expect(names).toEqual(expect.arrayContaining(['شوفان', 'Tahini']))
    expect((await repo.findAllForUser('user-1', 'en')).map(i => i.name)).toContain('Oats')
  })
```

(and the same shape for `AchievementRepository.findPublished('ar')` over `name_ar`/`description_ar`).

Run → FAIL.

**Step 2: Implement**

```sql
ALTER TABLE ingredients ADD COLUMN name_ar TEXT;
ALTER TABLE achievements ADD COLUMN name_ar TEXT;
ALTER TABLE achievements ADD COLUMN description_ar TEXT;
```

- Repositories take `locale: AppLocale = 'en'` on their read methods and select
  `CASE WHEN ? = 'ar' THEN COALESCE(name_ar, name) ELSE name END AS name` (similarly
  `description`). `mapRow` is unchanged because the alias keeps the column name. User-created
  ingredients have `name_ar` NULL, so they always fall back.
- **Meal log snapshots** (`meal_log_items.ingredient_name`) store whichever name was shown at
  log time. That's intended, and matches the existing snapshot rule.
- `seed.ts`: `RawPresetFood` gains `nameAr?: string`, written to `name_ar`. Each starter
  achievement gains `nameAr` / `descriptionAr`, and `upsertByKey` writes them.
- Add `nameAr` for all 51 foods in `preset_foods.json`, and `nameAr`/`descriptionAr` for the
  13 achievements. These are drafts for Task 12's review.
- Routes: nutrition ingredient/preset listing, achievements, home (recent achievements) pass
  `localeFromEvent(event, profile?.locale)`.

**Step 3: Verify.** Tests pass; `npm run db:seed` on a dev DB fills `name_ar`.

**Step 4: Commit**

```bash
git add server shared preset_foods.json tests
git commit -m "feat(i18n): serve Arabic names for preset foods and achievements"
```

---

### Task 8: Extraction guard

**Files:**
- Modify: `package.json` (dev dependency), `eslint.config.mjs`
- Create: `tests/i18n/locale-keys.test.ts`

**Step 1: Key-parity test**

```ts
// tests/i18n/locale-keys.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const load = (code: string) => JSON.parse(readFileSync(`i18n/locales/${code}.json`, 'utf-8'))
const keys = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]))

describe('locale files', () => {
  it('have identical key sets', () => {
    expect(keys(load('ar')).sort()).toEqual(keys(load('en')).sort())
  })
})
```

**Step 2: Lint**

```bash
npm install -D @intlify/eslint-plugin-vue-i18n
```

```js
// eslint.config.mjs
// @ts-check
import vueI18n from '@intlify/eslint-plugin-vue-i18n'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  ...vueI18n.configs['flat/recommended'],
  {
    settings: { 'vue-i18n': { localeDir: './i18n/locales/*.json', messageSyntaxVersion: '^10.0.0' } },
    rules: {
      // Raised to 'error' in Task 11 once extraction is complete.
      '@intlify/vue-i18n/no-raw-text': ['warn', { ignorePattern: '^[-–—·•×/:%+()#.,↑↓=…\\s\\d]+$', ignoreText: ['Hadeed', 'kg', 'lb', 'RPE', 'e1RM', 'W'] }],
      '@intlify/vue-i18n/no-missing-keys': 'error',
    },
  },
)
```

**Step 3: Verify**

`npx vitest run tests/i18n` passes. `npx eslint app --rule '{"@intlify/vue-i18n/no-raw-text":"warn"}' | tail -3`
prints the raw-text warning count. Record it; it's the extraction backlog.

**Step 4: Commit**

```bash
git add package.json package-lock.json eslint.config.mjs tests/i18n/locale-keys.test.ts
git commit -m "chore(i18n): lint for raw template text and check locale key parity"
```

---

### Task 9: String extraction, one page group per commit

Repeat this recipe for each group below, **in order**, one commit each.

**Groups** (check the files with `grep` before starting; later plans may have added components):
1. **Shell:** `app/layouts/*`, `app/components/ui/BottomNav.vue`, `ui/Header.vue`, `ui/LoadingIndicator.vue`, `app/error.vue` (if present). Namespace `common.*` / `nav.*` / `errors.*`.
2. **Home:** `app/pages/index.vue`. Namespace `home.*`.
3. **Session:** `app/pages/workouts/session/[id].vue`, `app/components/session/*`, `shared/lib/suggestion-copy.ts` (move its English map into `session.suggestion.*` keys; keep the function returning keys + params). Namespace `session.*`.
4. **Workouts & builder:** `app/pages/workouts/index.vue`, `app/pages/builder.vue`, `app/pages/builder-edit/[blockId].vue`, `app/components/builder/*`, `app/components/exercise/*`. Namespaces `workouts.*`, `builder.*`, `exercise.*`.
5. **Nutrition:** `app/pages/nutrition.vue`, `app/components/nutrition/*`. Namespace `nutrition.*`.
6. **Profile & stats:** `app/pages/profile.vue`, `app/pages/stats.vue`, `app/components/profile/*`. Namespaces `profile.*`, `stats.*`.
7. **Onboarding & auth:** `app/pages/onboarding.vue`, `app/pages/login.vue`, `app/components/onboarding/*`, `app/components/auth/*`, `app/lib/onboarding-options.ts`. Namespaces `onboarding.*`, `auth.*`, plus shared enum labels `goal.*`, `experience.*`, `equipment.*`, `activity.*`.

**Recipe:**

**Step 1:** `npx eslint <group files> 2>&1 | grep no-raw-text` lists the raw strings.

**Step 2:** For each string, add a key to `en.json` under the group namespace, named for its
meaning (`home.streak.label`, not `home.text12`). Reuse `common.*` for repeated words
(Save, Cancel, Done, Retry, Loading…). Plurals use pipe forms. The English source is
`"{n} week | {n} weeks"`; the Arabic equivalent gets six forms in Task 12.

**Step 3:** Replace in the template/script:
- Template text: `{{ t('home.streak.label') }}`, with `const { t, n, d } = useI18n()` in `<script setup>`.
- Interpolation: `"Best {best}"` → `t('home.streak.best', { best })`.
- Plurals: `t('home.streak.weeks', streak.current)` (the count is the second argument).
- Numbers shown to users: `n(value, 'integer' | 'decimal')`, including values inside interpolations, e.g. `t('session.lastSet', { weight: n(62.5, 'decimal') })`.
- Dates: replace `useDateFormat(...)` / `toLocaleDateString` with `d(date, 'short' | 'long')`, and relative times (`useTimeAgo`) with `Intl.RelativeTimeFormat(locale.value)` via a small `app/composables/useRelativeTime.ts`.
- Attribute text (`placeholder`, `aria-label`, `title`): `:placeholder="t('…')"`.
- Strings built in `<script>` (`confirm(...)`, error refs): `t(...)` at the point of use, not at module scope, so they react to locale changes.

**Step 4:** Copy the new keys into `ar.json` **with the English values** for now, so the
parity test passes and Arabic falls back visibly. Task 12 translates.

**Step 5: Verify**
- `npx eslint <group files>` shows no `no-raw-text` warnings for the group.
- `npx vitest run tests/i18n` passes.
- `npm run dev` in English: the group's screens look exactly as before.

**Step 6: Commit**

```bash
git add i18n/locales <group files>
git commit -m "refactor(i18n): extract <group> strings"
```

---

### Task 10: Arabic draft translation

**Files:**
- Modify: `i18n/locales/ar.json`

**Step 1:** Replace every English value with Modern Standard Arabic. Rules:
- Plural keys get all six forms: `"لا أسابيع | أسبوع واحد | أسبوعان | {n} أسابيع | {n} أسبوعًا | {n} أسبوع"` (zero | one | two | few | many | other).
- Keep gym terms that Arabic-speaking lifters use in English as-is where natural: "RPE", "e1RM", unit abbreviations via their own keys (`units.kg`: "كجم", `units.lb`: "رطل").
- Interpolation placeholders (`{best}`, `{n}`) are unchanged.
- Enum labels (`goal.*`, `equipment.*`, `jointArea.*`) are short noun phrases.

**Step 2: Verify**
- `npx vitest run tests/i18n` passes.
- `npm run dev`, switch to Arabic, and walk every page. No English visible except exercise names, user-entered text, and the ignore-listed tokens. Plurals read correctly for 0, 1, 2, 3, 11 and 100 (temporarily edit a streak to check).

**Step 3: Commit**

```bash
git add i18n/locales/ar.json
git commit -m "feat(i18n): add draft Arabic translations"
```

---

### Task 11: Lock the guard

**Step 1:** In `eslint.config.mjs`, raise `no-raw-text` to `'error'`.
**Step 2:** `npx eslint .` → 0 errors, then `npm run lint:rtl` → exit 0.
**Step 3:** Add a combined script: `"lint": "eslint . && npm run lint:rtl"`.
**Step 4:** Commit: `git add eslint.config.mjs package.json && git commit -m "chore(i18n): make raw template text a lint error"`.

---

### Task 12: Native review and RTL walkthrough (release gate)

Not automatable; do it with a native Arabic speaker.

1. Review `ar.json` in full for tone, gender agreement, and terminology consistency (a
   single term each for set, rep, session, split and target).
2. Review `nameAr` in `preset_foods.json` and the achievement Arabic copy.
3. RTL walkthrough on a phone-width viewport in Arabic, checking:
   - bottom nav order
   - drawers and popovers opening on the correct side
   - steppers (− left, + right)
   - charts reading left to right with Arabic-Indic tick labels
   - no clipped Arabic glyphs in `font-heading` headings
   - no letter-spaced Arabic anywhere
   - the rest timer and elapsed time in Arabic-Indic digits
   - number entry with an Arabic keyboard on iOS and Android
4. File fixes as separate commits. Update the README: remove the "`@nuxtjs/i18n` … not currently wired up" note and add "English and Arabic (RTL)" under Platform.
