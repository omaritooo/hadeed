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

// Maps a user's single Equipment tier to the set of `exercises.equipment` free-text
// values (a different, unrelated vocabulary from the Equipment tiers above) that tier
// can actually train with. Values verified against the seeded dataset — see the
// comment above classifyTierDeterministic in server/utils/exercise-classification.ts:
// 'body only', 'machine', 'other', 'foam roll', 'kettlebells', 'dumbbell', 'cable',
// 'barbell', 'bands', 'medicine ball', 'exercise ball', 'e-z curl bar', and null.
//
// Each tier's list is a strict superset of the tier below it, mirroring TIER_ORDER:
// - bodyweight: nothing but the body itself, plus the two accessories (resistance
//   bands, a foam roller) cheap and common enough that a true no-equipment trainee
//   plausibly already owns them.
// - home_dumbbell_only: adds the equipment a dumbbell owner plausibly also has
//   sitting at home — kettlebells, a medicine ball, a stability/exercise ball.
// - home_barbell_dumbbell: adds a barbell and e-z curl bar, the next rung up for a
//   home setup with a rack or bench.
// - full_gym: every equipment value in the dataset, including machine, cable, and
//   the catch-all 'other'.
//
// `null` (an exercise with no stated equipment requirement) is included at every
// tier: an exercise that doesn't declare an equipment need can't be "missing" for
// any tier.
const BODYWEIGHT_EQUIPMENT: (string | null)[] = ['body only', 'bands', 'foam roll', null]
const HOME_DUMBBELL_ONLY_EQUIPMENT: (string | null)[] = [...BODYWEIGHT_EQUIPMENT, 'dumbbell', 'kettlebells', 'medicine ball', 'exercise ball']
const HOME_BARBELL_DUMBBELL_EQUIPMENT: (string | null)[] = [...HOME_DUMBBELL_ONLY_EQUIPMENT, 'barbell', 'e-z curl bar']
const FULL_GYM_EQUIPMENT: (string | null)[] = [...HOME_BARBELL_DUMBBELL_EQUIPMENT, 'machine', 'cable', 'other']

const EQUIPMENT_VALUES_BY_TIER: Record<Exclude<Equipment, 'both'>, (string | null)[]> = {
  bodyweight: BODYWEIGHT_EQUIPMENT,
  home_dumbbell_only: HOME_DUMBBELL_ONLY_EQUIPMENT,
  home_barbell_dumbbell: HOME_BARBELL_DUMBBELL_EQUIPMENT,
  full_gym: FULL_GYM_EQUIPMENT,
}

// The `exercises.equipment` values a given Equipment tier can train with. 'both'
// isn't a real user-profile tier (see equipmentSatisfies's comment above), but is
// still a reachable RecommendationInput value, so — fail open, same as
// equipmentSatisfies — it resolves to the full-gym list rather than throwing.
export const equipmentValuesForTier = (tier: Equipment): (string | null)[] => {
  if (tier === 'both') return FULL_GYM_EQUIPMENT
  return EQUIPMENT_VALUES_BY_TIER[tier]
}

// Whether an exercise's `equipment` value is trainable at the given user tier. Used
// both to decide whether a picked exercise needs a substitution offer, and (via
// equipmentValuesForTier) to build the acceptable-equipment list passed to
// ExerciseRepository.findFallbacks.
export const exerciseEquipmentSatisfiesTier = ({ equipment, tier }: { equipment: string | null, tier: Equipment }): boolean => {
  return equipmentValuesForTier(tier).includes(equipment)
}
