export type MovementPattern =
  | 'horizontal_push' | 'vertical_push'
  | 'horizontal_pull' | 'vertical_pull'
  | 'knee_dominant' | 'hip_dominant'
  | 'elbow_flexion' | 'elbow_extension'
  | 'lateral_isolation' | 'core'

interface ClassifiableExercise {
  name: string
  force: string | null
  mechanic: string | null
  primaryMuscles: string[]
}

const nameHas = (name: string, ...keywords: string[]): boolean => {
  const lower = name.toLowerCase()
  return keywords.some(k => lower.includes(k))
}

export const classifyMovementPattern = (exercise: ClassifiableExercise): MovementPattern | null => {
  const { name, force, primaryMuscles } = exercise
  const muscle = primaryMuscles[0]

  if (muscle === 'abdominals') return 'core'

  if (nameHas(name, 'curl') && !nameHas(name, 'leg curl')) return 'elbow_flexion'

  // Knee-dominant lower-body patterns are checked before the generic "dip"
  // catch below, because names like "Jerk Dip Squat" contain "dip" but are
  // squat variants, not triceps/chest dip work.
  if (nameHas(name, 'squat', 'leg press', 'lunge', 'split squat', 'step up', 'step-up', 'leg extension')) return 'knee_dominant'
  if (nameHas(name, 'deadlift', 'rdl', 'hip thrust', 'good morning', 'hip hinge')) return 'hip_dominant'

  if (nameHas(name, 'pushdown', 'triceps extension', 'skull crusher')) return 'elbow_extension'

  // "Dip" is ambiguous: it's used for both triceps-dominant dips and
  // chest-dominant dips (the source dataset even names them "Dips - Chest
  // Version" vs "Dips - Triceps Version"). Disambiguate on the "chest"
  // keyword instead of always resolving to one side.
  if (nameHas(name, 'dip')) return nameHas(name, 'chest') ? 'horizontal_push' : 'elbow_extension'

  // Rear-delt/reverse-fly isolation work is checked before the generic
  // "fly"/"flye" horizontal-push match below, since names such as "Reverse
  // Flyes" or "Cable Rear Delt Fly" would otherwise always be shadowed by
  // the broader "fly" keyword and never reach this branch.
  if (nameHas(name, 'lateral raise', 'rear delt', 'reverse fly', 'face pull')) return 'lateral_isolation'

  if (nameHas(name, 'pulldown', 'pull-up', 'pullup', 'pull up', 'chin-up', 'chinup')) return 'vertical_pull'
  if (nameHas(name, 'row', 'bench pull')) return 'horizontal_pull'

  if (nameHas(name, 'incline', 'overhead press', 'shoulder press', 'military press')) return 'vertical_push'
  if (nameHas(name, 'bench press', 'chest press', 'push-up', 'push up', 'pushup', 'flye', 'fly')) return 'horizontal_push'

  // Coarser fallback from force + muscle when name-matching didn't hit.
  if (muscle === 'quadriceps') return 'knee_dominant'
  if (muscle === 'hamstrings' || muscle === 'glutes') return 'hip_dominant'
  if (muscle === 'biceps') return 'elbow_flexion'
  if (muscle === 'triceps') return 'elbow_extension'
  // Note: 'shoulders' is deliberately excluded from the horizontal_push
  // fallback below (unlike 'chest') so the lateral_isolation fallback that
  // follows it is reachable, rather than always being shadowed.
  if (force === 'push' && muscle === 'chest') return 'horizontal_push'
  if (force === 'pull' && (muscle === 'lats' || muscle === 'middle back' || muscle === 'traps')) return 'horizontal_pull'
  if (force === 'push' && muscle === 'shoulders') return 'lateral_isolation'

  return null
}
