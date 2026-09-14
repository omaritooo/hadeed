// Copy for preset review's "Swap flagged" action, which replaces exercises that load a limited joint.

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const nameList = new Intl.ListFormat('en', { type: 'conjunction' })

// `pending` rows still worth trying; `noAlternative` rows already found to have no clean fallback.
export const swapFlaggedButtonLabel = (pending: number, noAlternative: number): string => {
  if (pending === 0) return noAlternative === 0 ? 'No flagged exercises' : `No alternative for ${plural(noAlternative, 'flagged exercise')}`
  if (noAlternative === 0) return `Swap ${plural(pending, 'flagged exercise')}`
  return `Swap ${pending} flagged (${noAlternative} ${noAlternative === 1 ? 'has' : 'have'} no alternative)`
}

export interface SwapFlaggedOutcome {
  swapped: number
  noAlternative: string[]
  failed: number
}

// One status line for a finished run; empty when nothing happened.
export const describeSwapFlaggedOutcome = ({ swapped, noAlternative, failed }: SwapFlaggedOutcome): string => {
  const parts: string[] = []
  if (swapped > 0) parts.push(`Swapped ${plural(swapped, 'exercise')}.`)
  if (noAlternative.length > 0) parts.push(`No clean alternative for ${nameList.format(noAlternative)}, kept as-is.`)
  if (failed > 0) parts.push(`${failed} couldn't be checked; try again.`)
  return parts.join(' ')
}
