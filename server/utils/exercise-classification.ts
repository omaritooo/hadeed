import { JOINT_AREAS, type JointArea } from '~~/shared/lib/joint-areas'

export type MovementPattern =
  | 'horizontal_push' | 'vertical_push'
  | 'horizontal_pull' | 'vertical_pull'
  | 'knee_dominant' | 'hip_dominant'
  | 'elbow_flexion' | 'elbow_extension'
  | 'lateral_isolation' | 'core'

interface ClassifiableExercise {
  name: string
  category?: string | null
  force: string | null
  mechanic: string | null
  primaryMuscles: string[]
}

const isLetter = (char: string): boolean => /[a-z]/i.test(char)

// Plain substring matching produces false positives on real exercise names:
// 'row' inside 'throw'/'narrow'/'Prowler', 'rdl' inside 'hurdle', 'fly'
// inside 'Butterfly'. Require that a match isn't preceded by a letter (so
// it starts at a word boundary or the start of the string), but don't
// require a trailing boundary too, since plenty of matches we DO want are
// plurals or suffixed forms of the keyword ('Curls', 'Squats', 'Rows',
// 'Flyes', 'Pushups', 'Pullups') that a full \b...\b regex would reject.
const nameHas = (name: string, ...keywords: string[]): boolean => {
  const lower = name.toLowerCase()
  return keywords.some((keyword) => {
    let fromIndex = 0
    while (fromIndex <= lower.length) {
      const index = lower.indexOf(keyword, fromIndex)
      if (index === -1) return false
      const precedingChar = index > 0 ? lower[index - 1] : undefined
      if (!precedingChar || !isLetter(precedingChar)) return true
      fromIndex = index + 1
    }
    return false
  })
}

export const classifyMovementPattern = (exercise: ClassifiableExercise): MovementPattern | null => {
  const { name, category, force, primaryMuscles } = exercise
  const muscle = primaryMuscles[0]

  // Movement patterns exist to drive exercise substitution (see
  // ExerciseRepository.findFallbacks), and cardio machines are never a valid
  // swap for a resistance lift. Without this, the name rules below assign them
  // one anyway — "Incline Treadmill Walk" matches 'incline' and comes back as
  // vertical_push, which would offer it as a fallback for an overhead press.
  if (category === 'cardio') return null

  if (muscle === 'abdominals') return 'core'

  // 'nordic' is excluded alongside 'leg curl' because both the Nordic hamstring
  // curl and the reverse Nordic are knee-flexion/extension work whose names
  // happen to contain "curl" — without this they resolve to elbow_flexion.
  if (nameHas(name, 'curl') && !nameHas(name, 'leg curl', 'nordic')) return 'elbow_flexion'

  // Knee-dominant lower-body patterns are checked before the generic "dip"
  // catch below, because names like "Jerk Dip Squat" contain "dip" but are
  // squat variants, not triceps/chest dip work.
  if (nameHas(name, 'squat', 'leg press', 'lunge', 'split squat', 'step up', 'step-up', 'leg extension')) return 'knee_dominant'
  if (nameHas(name, 'deadlift', 'rdl', 'hip thrust', 'good morning', 'hip hinge', 'rack pull')) return 'hip_dominant'

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
  // 'reverse pec deck' is listed in full rather than as 'pec deck', which would
  // also swallow the ordinary pec deck (a horizontal push).
  if (nameHas(name, 'lateral raise', 'rear delt', 'reverse fly', 'face pull', 'reverse pec deck', 'y-raise', 'y raise')) return 'lateral_isolation'

  if (nameHas(name, 'pulldown', 'pull-up', 'pullup', 'pull up', 'chin-up', 'chinup')) return 'vertical_pull'
  if (nameHas(name, 'row', 'bench pull')) return 'horizontal_pull'

  if (nameHas(name, 'incline', 'overhead press', 'shoulder press', 'military press', 'viking press')) return 'vertical_push'
  if (nameHas(name, 'bench press', 'chest press', 'push-up', 'push up', 'pushup', 'flye', 'fly')) return 'horizontal_push'

  // Any shoulder-driven press or jerk left over is overhead work. The named list above can't
  // enumerate every variant -- Push Press, Arnold Press, Bradford Press, Clean and Press, Log
  // Lift -- and without this they reach the shoulders fallback at the bottom and come back
  // lateral_isolation, which offers lateral raises as a substitute for a heavy overhead press.
  // Scoped to shoulders so a leg press or bench press keeps its own pattern; 'log lift' is spelled
  // out rather than matching 'lift', which would also catch deadlift variants.
  if (muscle === 'shoulders' && nameHas(name, 'press', 'jerk', 'log lift')) return 'vertical_push'

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

// Equipment values verified against the seeded dataset (gym_exercises.json,
// inserted into `exercises` verbatim by server/database/seed.ts): 'body only',
// 'machine', 'other', 'foam roll', 'kettlebells', 'dumbbell', 'cable',
// 'barbell', 'bands', 'medicine ball', 'exercise ball', 'e-z curl bar', and
// null (77 rows). There is no distinct 'smith machine' value in the real
// data — Smith-machine lifts are tagged equipment: 'machine' — so that check
// below never fires today; it's kept as a harmless forward-compatible guard
// in case that literal value is ever introduced (it would correctly map to
// Tier 2, same as 'machine').
export const classifyTierDeterministic = (exercise: { mechanic: string | null, equipment: string | null }): 1 | 2 | 3 | null => {
  if (exercise.mechanic === 'isolation') return 3
  if (exercise.mechanic === null) return 2
  // mechanic === 'compound' from here
  if (exercise.equipment === 'barbell' || exercise.equipment === 'body only') return 1
  if (exercise.equipment === 'machine' || exercise.equipment === 'cable' || exercise.equipment === 'smith machine') return 2
  if (exercise.equipment === 'dumbbell' || exercise.equipment === 'kettlebells') return null // ambiguous — resolved by the hardcoded table in classify-exercises.ts
  // Any other equipment value (bands, medicine ball, exercise ball, foam
  // roll, e-z curl bar, other) or null equipment (77 rows in the real data)
  // is treated as Tier 2 by default.
  return 2
}

export interface StressorClassifiableExercise {
  name: string
  category: string | null
  equipment: string | null
  movementPattern: MovementPattern | null
  tier: number | null
}

// Which joints an exercise commonly loads, for flagging against a user's limitations. Not a
// medical model: a coarse, explainable rule set over data already on the row, reviewed via the
// per-area counts classify-exercises.ts prints, and corrected through
// exercise_stressor_overrides.json rather than more rules. Call it after the tier is resolved:
// the lower-back hinge rule reads it.
export const classifyStressors = (exercise: StressorClassifiableExercise): JointArea[] => {
  const { name, category, equipment, movementPattern: pattern, tier } = exercise
  // Stretches load joints through range, not under weight; flagging them would bury real conflicts.
  if (category === 'stretching') return []

  const plyo = category === 'plyometrics'
  const barbell = equipment === 'barbell'
  // "Jerk Dip Squat" names the dip of a jerk, not a bar dip.
  const dip = nameHas(name, 'dip') && pattern !== 'knee_dominant'
  // Clean/snatch pulls, deadlifts and shrugs stop before the catch, so they skip the rack-position
  // wrist and overhead shoulder stress of the full lift.
  const olympicPull = nameHas(name, 'pull', 'deadlift', 'shrug')
  // classifyMovementPattern now classifies shoulder presses as vertical_push, but `pattern` is
  // usually the *stored* value, which stays lateral_isolation until db:classify-exercises is
  // re-run -- so keep recovering those by name rather than silently dropping the shoulder tag.
  const overheadPress = pattern === 'vertical_push' || (pattern === 'lateral_isolation' && nameHas(name, 'press', 'jerk'))
  const areas = new Set<JointArea>()

  if (overheadPress || dip
    || nameHas(name, 'upright', 'behind the neck', 'behind neck', 'jerk', 'kipping')
    || (nameHas(name, 'snatch') && !olympicPull)) areas.add('shoulder')

  if ((pattern === 'hip_dominant' && tier === 1)
    || (pattern === 'knee_dominant' && barbell)
    || (pattern === 'horizontal_pull' && barbell)
    || nameHas(name, 'deadlift', 'good morning', 'hyperextension', 'back extension', 'clean', 'snatch')) areas.add('lower_back')

  if (pattern === 'knee_dominant' || plyo || nameHas(name, 'jump', 'pistol')) areas.add('knee')

  if ((pattern === 'elbow_flexion' && barbell)
    || nameHas(name, 'push-up', 'push up', 'pushup', 'front squat', 'front barbell squat', 'handstand', 'wrist curl', 'barbell curl')
    || (nameHas(name, 'clean') && !olympicPull)) areas.add('wrist')

  if (pattern === 'elbow_extension' || dip
    || nameHas(name, 'skullcrusher', 'skull crusher')
    || (nameHas(name, 'close-grip', 'close grip') && (pattern === 'horizontal_push' || pattern === 'vertical_push'))) areas.add('elbow')

  if (plyo || nameHas(name, 'jump', 'calf raise', 'calf press', 'lunge', 'sprint', 'skipping')) areas.add('ankle')

  return JOINT_AREAS.filter(area => areas.has(area))
}
