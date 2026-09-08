import type { Equipment } from '~~/shared/types/preset.types'

const TIER_ORDER: Record<Exclude<Equipment, 'both'>, number> = {
  bodyweight: 0,
  home_dumbbell_only: 1,
  home_barbell_dumbbell: 2,
  full_gym: 3,
}

export const equipmentSatisfies = ({ userTier, required }: { userTier: Equipment, required: Equipment }): boolean => {
  if (required === 'both') return true
  // A stored user_profiles row never has equipment: 'both' (its CHECK constraint
  // resolves 'both' to a concrete tier at onboarding time), but this function's
  // one live call site (preset-split recommendations) also takes its userTier
  // straight from RecommendationInput.equipment, which recommend.get.ts's query
  // string validates and accepts 'both' for - a user can legitimately query
  // recommendations with ?equipment=both. So this is a real, reachable path, not
  // a defensive dead branch: fail open rather than closed for it.
  if (userTier === 'both') return true
  return TIER_ORDER[userTier] >= TIER_ORDER[required]
}
