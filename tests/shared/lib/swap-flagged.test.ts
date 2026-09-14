import { describe, expect, it } from 'vitest'
import { describeSwapFlaggedOutcome, swapFlaggedButtonLabel } from '~~/shared/lib/swap-flagged'

describe('swapFlaggedButtonLabel', () => {
  it('counts the rows still worth trying, pluralised', () => {
    expect(swapFlaggedButtonLabel(1, 0)).toBe('Swap 1 flagged exercise')
    expect(swapFlaggedButtonLabel(3, 0)).toBe('Swap 3 flagged exercises')
  })

  it('notes rows already known to have no alternative', () => {
    expect(swapFlaggedButtonLabel(2, 1)).toBe('Swap 2 flagged (1 has no alternative)')
    expect(swapFlaggedButtonLabel(1, 2)).toBe('Swap 1 flagged (2 have no alternative)')
  })

  it('says why there is nothing to do', () => {
    expect(swapFlaggedButtonLabel(0, 0)).toBe('No flagged exercises')
    expect(swapFlaggedButtonLabel(0, 1)).toBe('No alternative for 1 flagged exercise')
    expect(swapFlaggedButtonLabel(0, 2)).toBe('No alternative for 2 flagged exercises')
  })
})

describe('describeSwapFlaggedOutcome', () => {
  it('announces a full success', () => {
    expect(describeSwapFlaggedOutcome({ swapped: 3, noAlternative: [], failed: 0 })).toBe('Swapped 3 exercises.')
    expect(describeSwapFlaggedOutcome({ swapped: 1, noAlternative: [], failed: 0 })).toBe('Swapped 1 exercise.')
  })

  it('names rows kept for lack of an alternative and counts failures', () => {
    expect(describeSwapFlaggedOutcome({ swapped: 2, noAlternative: ['Overhead Press', 'Dips'], failed: 1 }))
      .toBe('Swapped 2 exercises. No clean alternative for Overhead Press and Dips, kept as-is. 1 couldn\'t be checked; try again.')
    expect(describeSwapFlaggedOutcome({ swapped: 0, noAlternative: [], failed: 2 }))
      .toBe('2 couldn\'t be checked; try again.')
  })

  it('is empty when nothing ran', () => {
    expect(describeSwapFlaggedOutcome({ swapped: 0, noAlternative: [], failed: 0 })).toBe('')
  })
})
