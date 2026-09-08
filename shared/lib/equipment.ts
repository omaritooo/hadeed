import type { Equipment } from '~~/shared/types/preset.types'

const TIER_ORDER: Record<Exclude<Equipment, 'both'>, number> = {
  bodyweight: 0,
  home_dumbbell_only: 1,
  home_barbell_dumbbell: 2,
  full_gym: 3,
}

export const equipmentSatisfies = (userTier: Equipment, required: Equipment): boolean => {
  if (required === 'both') return true
  if (userTier === 'both') return true // shouldn't occur for a real user profile, but fail open not closed
  return TIER_ORDER[userTier] >= TIER_ORDER[required]
}
