import { describe, expect, it } from 'vitest'
import { findPhysicalDirectionClasses, scanSource, themeSpacingNames } from '~~/scripts/lint-rtl'

describe('findPhysicalDirectionClasses', () => {
  it('finds physical margin, padding, inset, text-align, rounded and border classes', () => {
    const source = `<div class="ml-4 pr-2 left-1 -right-3 text-left rounded-l-lg border-r sm:pl-6 hover:mr-auto">`
    expect(findPhysicalDirectionClasses(source)).toEqual(['ml-4', 'pr-2', 'left-1', '-right-3', 'text-left', 'rounded-l-lg', 'border-r', 'sm:pl-6', 'hover:mr-auto'])
  })

  it('ignores logical classes and look-alike words', () => {
    const source = `<div class="ms-4 pe-2 inset-s-1 start-0 end-4 text-start rounded-s-lg border-e"> pr-history printer left-handed`
    expect(findPhysicalDirectionClasses(source)).toEqual([])
  })

  // Every value spelling Tailwind accepts has to match, because a missed class is a layout
  // that silently stays unmirrored -- nothing downstream catches it.
  it('finds negative, fractional, arbitrary and CSS-variable values', () => {
    const source = `-ml-4 mr-[-0.45rem] -left-12 left-1/2 right-3.5 pl-px mr-auto ps-(--gap) pe-4 pl-(--gap) right-full`
    expect(findPhysicalDirectionClasses(source)).toEqual([
      '-ml-4', 'mr-[-0.45rem]', '-left-12', 'left-1/2', 'right-3.5', 'pl-px', 'mr-auto', 'pl-(--gap)', 'right-full',
    ])
  })

  it('finds classes behind stacked, arbitrary and group/peer variants', () => {
    const source = [
      'sm:hover:ml-2',
      'group-hover:pr-2',
      'peer-focus:text-left',
      '**:data-[slot=native-select-icon]:right-1',
      '*:pl-1',
      'has-[>button]:ml-[-0.35rem]',
      "[&>svg:not([class*='size-'])]:mr-1",
      'supports-[display:grid]:pl-2',
      'data-[swipe-direction=right]:right-0',
      'max-md:group-data-[state=open]/card:rounded-tr-xl',
      '@lg:border-l-2',
    ].join(' ')
    expect(findPhysicalDirectionClasses(source)).toEqual([
      'sm:hover:ml-2',
      'group-hover:pr-2',
      'peer-focus:text-left',
      '**:data-[slot=native-select-icon]:right-1',
      '*:pl-1',
      'has-[>button]:ml-[-0.35rem]',
      "[&>svg:not([class*='size-'])]:mr-1",
      'supports-[display:grid]:pl-2',
      'data-[swipe-direction=right]:right-0',
      'max-md:group-data-[state=open]/card:rounded-tr-xl',
      '@lg:border-l-2',
    ])
  })

  it('finds classes marked important in either Tailwind spelling', () => {
    expect(findPhysicalDirectionClasses('!ml-4 pr-2! sm:!-left-2')).toEqual(['!ml-4', 'pr-2!', 'sm:!-left-2'])
  })

  it('finds every corner-radius, border-side, float, clear and scroll variant', () => {
    const source = 'rounded-tl rounded-tr-md rounded-bl-[4px] rounded-br-none rounded-l rounded-r-full '
      + 'border-l border-r-2 border-l-red-500 border-r-primary/40 '
      + 'float-left float-right clear-left clear-right scroll-ml-4 scroll-pr-6 text-right'
    expect(findPhysicalDirectionClasses(source)).toEqual([
      'rounded-tl', 'rounded-tr-md', 'rounded-bl-[4px]', 'rounded-br-none', 'rounded-l', 'rounded-r-full',
      'border-l', 'border-r-2', 'border-l-red-500', 'border-r-primary/40',
      'float-left', 'float-right', 'clear-left', 'clear-right', 'scroll-ml-4', 'scroll-pr-6', 'text-right',
    ])
  })

  // The codebase is full of `pr` (personal record) and `pl`/`left` prose. A lint that cried
  // wolf here would push someone into a wrong "fix" -- which is worse than no lint.
  it('does not match symmetric utilities, CSS properties or identifiers', () => {
    const source = [
      'rounded-lg rounded-b-lg rounded-t-md border-red-500 border-rose-400 border-b-2 text-primary',
      'mx-auto px-4 inset-x-0 space-x-2 divide-x -translate-x-1/2 origin-center',
      'padding-left: 4px; border-left-width: 1px; transform-origin: left center;',
      'const pr = prs[0]; pr.exerciseName; formatPrTypes(pr.prTypes); v-model:pl',
      'left-to-right printer plate props.placeholder profile.value preset.id progression',
    ].join('\n')
    expect(findPhysicalDirectionClasses(source)).toEqual([])
  })

  it('finds classes in bindings, object syntax, arrays and script blocks', () => {
    const source = [
      `:class="{ 'ml-2': dense, 'pr-4': wide }"`,
      `:class="[base, cond ? 'text-left' : 'text-right']"`,
      `<script setup lang="ts">const cls = cn("flex", "pl-3")</script>`,
      `<style scoped>.foo { @apply mr-2; }</style>`,
    ].join('\n')
    expect(findPhysicalDirectionClasses(source)).toEqual(['ml-2', 'pr-4', 'text-left', 'text-right', 'pl-3', 'mr-2'])
  })

  // `--spacing-*` theme keys become real spacing values, so `ps-edge-margin` is a real class
  // and `pl-edge-margin` a real bug. Without the theme list the lint would quietly miss it.
  it('finds theme-named spacing values when the theme keys are supplied', () => {
    expect(findPhysicalDirectionClasses('pl-edge-margin ml-stack-gutter')).toEqual([])
    expect(findPhysicalDirectionClasses('pl-edge-margin ml-stack-gutter', ['edge-margin', 'stack-gutter']))
      .toEqual(['pl-edge-margin', 'ml-stack-gutter'])
  })

  // Spelled like ESLint's markers so a reader never has to guess which line one covers -- an
  // escape hatch that silently swallowed the following line too would hide real bugs.
  it('honours lint-rtl-ignore-next-line and lint-rtl-ignore-line markers', () => {
    const source = [
      '<div class="ml-4">',
      '<!-- lint-rtl-ignore-next-line: centring, the paired translate mirrors it -->',
      '<div class="left-1/2 -translate-x-1/2">',
      '<div class="pr-2">',
      'const cls = "pe-2 mr-3" // lint-rtl-ignore-line: physically-keyed API',
      '<div class="pl-2">',
    ].join('\n')
    expect(findPhysicalDirectionClasses(source)).toEqual(['ml-4', 'pr-2', 'pl-2'])
  })
})

describe('scanSource', () => {
  it('reports the line each class was found on', () => {
    const source = ['<template>', '  <div class="ml-4">', '    <p class="text-right pr-2" />', '</template>'].join('\n')
    expect(scanSource(source)).toEqual([
      { line: 2, className: 'ml-4' },
      { line: 3, className: 'text-right' },
      { line: 3, className: 'pr-2' },
    ])
  })
})

describe('themeSpacingNames', () => {
  it('reads --spacing-* keys out of a Tailwind theme block', () => {
    const css = '@theme {\n  --spacing-edge-margin: 20px;\n  --spacing-stack-gutter: 12px;\n  --radius-lg: 1rem;\n}'
    expect(themeSpacingNames(css)).toEqual(['edge-margin', 'stack-gutter'])
  })
})
