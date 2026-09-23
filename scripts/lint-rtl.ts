import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Physical-direction Tailwind utilities (`ml-4`, `left-0`, `text-right`, `border-l`) pin a
// layout to the visual left/right no matter what `<html dir>` says, so an Arabic page ends up
// with its gutters, badges and dividers on the wrong side. Every one of them has a logical
// twin (`ms-4`, `start-0`, `text-end`, `border-s`) that follows the writing direction. This
// script is the guard that keeps the physical ones from creeping back in.
//
// The hard part is not the utilities, it is the surrounding noise: this codebase is full of
// `pr` (personal record), `pl`, `profile`, `preset` and the words "left"/"right" in prose.
// A false positive pushes someone into a wrong conversion, and a false negative is an
// unmirrored layout no test catches -- so every value spelling is matched explicitly and
// every word-shaped value has to come from a closed list.

// One variant in a chain: `sm:`, `hover:`, `*:`, `**:`, `@lg:`, `group-hover/card:`,
// `data-[state=open]:`, `has-[>button]:`, `supports-[display:grid]:`, `[&>svg:not([class*='x'])]:`.
// Bracket groups are matched whole (one level of nesting) because they legally contain the
// `:`, `>` and quote characters that otherwise end a class token.
const BRACKETS = String.raw`\[(?:[^[\]]|\[[^\]]*\])*\]`
const VARIANT = String.raw`(?:(?:[^\s"'\`<>=:[\]]|${BRACKETS})+:)*`

// Values Tailwind accepts after a spacing or inset utility. Word-shaped values are a closed
// list on purpose: opening it up to `[a-z]+` would match `pr-history` and `left-handed`.
const NUMERIC = String.raw`\d+(?:\.\d+)?(?:\/\d+)?`
const KEYWORDS = ['px', 'auto', 'full', 'screen', 'min', 'max', 'fit']

const escapeForClass = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildPattern = (extraSpacingValues: readonly string[]) => {
  const words = [...KEYWORDS, ...extraSpacingValues].map(escapeForClass).join('|')
  // `(--gap)` is Tailwind 4's shorthand for a CSS variable; `[...]` an arbitrary value.
  const value = String.raw`(?:${BRACKETS}|\([^)]*\)|${NUMERIC}|(?:${words})(?![\w-]))`
  // A border side takes a width, an arbitrary value or a colour (`border-l-red-500`,
  // `border-r-primary/40`), so its value list has to stay open-ended -- safe here because
  // `border-l`/`border-r` must be followed by `-` or a token boundary, which already rules out
  // `border-left-width`, `border-red-500` and `border-rose-400`.
  const borderValue = String.raw`(?:${BRACKETS}|\([^)]*\)|${NUMERIC}|[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/\d+(?:\.\d+)?)?)`
  const core = [
    String.raw`(?:scroll-)?[mp][lr]-${value}`,
    String.raw`(?:left|right)-${value}`,
    String.raw`text-(?:left|right)`,
    String.raw`float-(?:left|right)`,
    String.raw`clear-(?:left|right)`,
    // Two-letter corners first: `l`/`r` would otherwise swallow the `l` of `rounded-lg`.
    String.raw`rounded-(?:tl|tr|bl|br|l|r)(?:-(?:${BRACKETS}|\([^)]*\)|[a-z0-9]+))?`,
    String.raw`border-[lr](?:-${borderValue})?`,
  ].join('|')
  // `!` is Tailwind 3's important prefix and Tailwind 4's important suffix; both still parse.
  return String.raw`(?<![\w:-])(${VARIANT}!?-?(?:${core})!?)(?![\w-])`
}

// Escape hatches, spelled like ESLint's so there is no guessing which line a marker covers.
// They exist because a few physical classes are correct: `left-1/2` paired with
// `-translate-x-1/2` centres an element, and mirroring only half of that pair moves it off
// centre. A marker is expected to carry a reason after it.
const IGNORE_NEXT_LINE = 'lint-rtl-ignore-next-line'
const IGNORE_LINE = 'lint-rtl-ignore-line'

const isIgnored = (lines: string[], index: number) =>
  lines[index]!.includes(IGNORE_LINE) || (lines[index - 1]?.includes(IGNORE_NEXT_LINE) ?? false)

export type PhysicalClassHit = { line: number, className: string }

export const scanSource = (source: string, extraSpacingValues: readonly string[] = []): PhysicalClassHit[] => {
  const pattern = new RegExp(buildPattern(extraSpacingValues), 'g')
  const lines = source.split('\n')
  return lines.flatMap((text, index) => {
    if (isIgnored(lines, index)) return []
    return [...text.matchAll(pattern)].map(match => ({ line: index + 1, className: match[1]! }))
  })
}

export const findPhysicalDirectionClasses = (source: string, extraSpacingValues: readonly string[] = []): string[] =>
  scanSource(source, extraSpacingValues).map(hit => hit.className)

// Tailwind turns every `--spacing-*` theme key into a spacing value, so `ps-edge-margin` is a
// real class and `pl-edge-margin` a real bug. Reading the keys back out of the stylesheet keeps
// the lint honest when someone adds one, rather than drifting from a hand-kept list.
export const themeSpacingNames = (css: string): string[] =>
  [...css.matchAll(/--spacing-([a-z0-9-]+)\s*:/g)].map(match => match[1]!)

// `readdirSync(..., { recursive: true })` rather than `fs.globSync`, which is still flagged
// experimental on Node 22 and prints a warning over otherwise clean lint output.
const sourceFiles = (root: string) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(vue|ts|css)$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
    .sort()

const main = () => {
  // `.ts` and `.css` are in scope alongside `.vue`: class lists live in `cva()` maps under
  // `app/components/ui/**/index.ts`, and `@apply` in a stylesheet is just as physical.
  const theme = themeSpacingNames(readFileSync('app/assets/css/index.css', 'utf-8'))
  let failures = 0
  for (const file of sourceFiles('app')) {
    for (const hit of scanSource(readFileSync(file, 'utf-8'), theme)) {
      failures += 1
      console.error(`${file}:${hit.line}: ${hit.className}`)
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} physical-direction class(es). Use ms/me, ps/pe, start/end, text-start/end, rounded-s/e (ss/se/es/ee), border-s/e.`)
    console.error(`Physical is occasionally right (centring pairs, physically-keyed APIs): mark those with a \`${IGNORE_NEXT_LINE}\` or \`${IGNORE_LINE}\` comment saying why.`)
    process.exit(1)
  }
  console.log('lint:rtl - no physical-direction classes')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
