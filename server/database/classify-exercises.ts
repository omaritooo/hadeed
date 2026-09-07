import { createClient } from '@libsql/client'
import { classifyMovementPattern, classifyTierDeterministic } from '~~/server/utils/exercise-classification'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in the environment.')
  process.exit(1)
}

const db = createClient({ url, authToken })

// Hand-classified residual: every exercise where mechanic === 'compound' and
// equipment is 'dumbbell' or 'kettlebells' (95 rows in the real dataset as of
// this writing) is ambiguous for classifyTierDeterministic and returns null.
// Rather than call out to an LLM API at runtime, this table was produced once
// by direct judgment (Claude, in the authoring session for this script)
// against the actual gym_exercises.json dataset. Tier 1 = a foundational,
// primarily-bilateral lift typically used as a session's main
// strength-assessment movement for its category. Only the (shorter) Tier-1
// allowlist is enumerated; everything else in the residual set defaults to
// Tier 2 below — that includes unilateral variants ("One-Arm", "Alternating"),
// named angle/grip modifiers ("Incline", "Decline", "Close-Grip",
// "Neutral-Grip", "Palms-In"), and technical/ballistic/skill-focused
// kettlebell movements (cleans, snatches, one-arm jerks, Turkish get-ups,
// windmills, pistol squats, thrusters, swings, get-ups) that read as
// conditioning/skill work rather than primary strength work.
//
// Two names a since-superseded reference list once carried as Tier 1 —
// "Incline Dumbbell Press" and "One-Arm Dumbbell Row" — are deliberately
// classified Tier 2 here instead: both are explicitly named as Tier-2
// examples (a named angle modifier, and a "One-Arm" unilateral variant) by
// the classification rule this table is implementing, so they default below
// rather than being listed here.
const AMBIGUOUS_TIER_OVERRIDES: Record<string, 1 | 2> = {
  'Arnold Dumbbell Press': 1,
  'Bent Over Two-Dumbbell Row': 1,
  'Dumbbell Bench Press': 1,
  'Dumbbell Lunges': 1,
  'Dumbbell Rear Lunge': 1,
  'Dumbbell Shoulder Press': 1,
  'Dumbbell Squat': 1,
  'Front Squats With Two Kettlebells': 1,
  'Goblet Squat': 1,
  'Seated Dumbbell Press': 1,
  'Standing Dumbbell Press': 1,
  'Stiff-Legged Dumbbell Deadlift': 1,
  'Two-Arm Kettlebell Jerk': 1,
  'Two-Arm Kettlebell Military Press': 1,
  'Two-Arm Kettlebell Row': 1,
  'Bulgarian Split Squat': 1,
  'Split Squat with Dumbbells': 1,
  'Double Kettlebell Jerk': 1,
  'Double Kettlebell Push Press': 1,
  // Everything else in the residual set defaults to 2 (see below) — this
  // list is the Tier-1 allowlist, not an exhaustive map of all ambiguous
  // names, to keep it maintainable as the shorter of the two lists.
}

async function main() {
  const result = await db.execute('SELECT * FROM exercises')
  const rows = result.rows as unknown as Record<string, unknown>[]

  let ruleClassified = 0
  let overrideClassified = 0
  let defaultedAmbiguous = 0
  const samples: { id: string, name: string, tier: number | null, pattern: string | null }[] = []

  for (const row of rows) {
    const primaryMusclesResult = await db.execute({
      sql: `SELECT muscles.name FROM exercise_muscles JOIN muscles ON muscles.id = exercise_muscles.muscle_id WHERE exercise_muscles.exercise_id = ? AND exercise_muscles.role = 'primary'`,
      args: [row.id as string],
    })
    const primaryMuscles = primaryMusclesResult.rows.map(r => r.name as string)
    const exercise = {
      name: row.name as string,
      force: row.force as string | null,
      mechanic: row.mechanic as string | null,
      equipment: row.equipment as string | null,
      primaryMuscles,
    }

    const movementPattern = classifyMovementPattern(exercise)
    let tier = classifyTierDeterministic(exercise)

    if (tier === null) {
      if (exercise.name in AMBIGUOUS_TIER_OVERRIDES) {
        tier = AMBIGUOUS_TIER_OVERRIDES[exercise.name]!
        overrideClassified++
      } else {
        tier = 2 // safe default for anything in the residual set not explicitly listed
        defaultedAmbiguous++
      }
    } else {
      ruleClassified++
    }

    await db.execute({
      sql: 'UPDATE exercises SET movement_pattern = ?, tier = ? WHERE id = ?',
      args: [movementPattern, tier, row.id as string],
    })

    if (samples.length < 30 && Math.random() < 0.05) {
      samples.push({ id: row.id as string, name: exercise.name, tier, pattern: movementPattern })
    }
  }

  console.log(`Classified ${rows.length} exercises: ${ruleClassified} by rule, ${overrideClassified} by the hardcoded residual table, ${defaultedAmbiguous} ambiguous names defaulted to Tier 2 (not in the table — review these).`)
  console.log('Spot-check sample:')
  console.table(samples)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.close())
