import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { RoleRepository } from '~~/server/repositories/role.repository'
import { PresetSplitRepository, type CreatePresetSplitInput } from '~~/server/repositories/preset-split.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'

const __dirname = dirname(fileURLToPath(import.meta.url))

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in the environment.')
  process.exit(1)
}

const db = createClient({ url, authToken })

interface RawExercise {
  id: string
  name: string
  category: string | null
  equipment: string | null
  force: string | null
  level: string | null
  mechanic: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  images: string[]
}

async function main() {
  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8')
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    try {
      await db.execute(statement)
    } catch (err) {
      const isDuplicateColumn = err instanceof Error && /duplicate column name/i.test(err.message)
      if (!isDuplicateColumn) throw err
    }
  }

  const dataPath = resolve(__dirname, '../../gym_exercises.json')
  const { exercises } = JSON.parse(readFileSync(dataPath, 'utf-8')) as { exercises: RawExercise[] }

  const muscleIds = new Map<string, number>()
  async function getMuscleId(name: string): Promise<number> {
    const cached = muscleIds.get(name)
    if (cached) return cached
    await db.execute({ sql: 'INSERT OR IGNORE INTO muscles (name) VALUES (?)', args: [name] })
    const result = await db.execute({ sql: 'SELECT id FROM muscles WHERE name = ?', args: [name] })
    const id = result.rows[0].id as number
    muscleIds.set(name, id)
    return id
  }

  console.log(`Seeding ${exercises.length} exercises...`)

  for (const ex of exercises) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO exercises (id, name, category, equipment, force, level, mechanic, instructions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        ex.id,
        ex.name,
        ex.category,
        ex.equipment,
        ex.force,
        ex.level,
        ex.mechanic,
        JSON.stringify(ex.instructions ?? []),
      ],
    })

    await db.execute({ sql: 'DELETE FROM exercise_muscles WHERE exercise_id = ?', args: [ex.id] })
    for (const name of ex.primaryMuscles ?? []) {
      const muscleId = await getMuscleId(name)
      await db.execute({
        sql: 'INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
        args: [ex.id, muscleId, 'primary'],
      })
    }
    for (const name of ex.secondaryMuscles ?? []) {
      const muscleId = await getMuscleId(name)
      await db.execute({
        sql: 'INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, ?)',
        args: [ex.id, muscleId, 'secondary'],
      })
    }

    await db.execute({ sql: 'DELETE FROM exercise_images WHERE exercise_id = ?', args: [ex.id] })
    for (const [position, url] of (ex.images ?? []).entries()) {
      await db.execute({
        sql: 'INSERT INTO exercise_images (exercise_id, url, position) VALUES (?, ?, ?)',
        args: [ex.id, url, position],
      })
    }
  }

  console.log('Seeding roles...')
  const roles = new RoleRepository(db)
  const existingAdmin = await roles.findByKey('admin')
  if (!existingAdmin) {
    await roles.insert({ key: 'admin', name: 'Admin', permissions: ['preset:write', 'achievement:write', 'role:write'] })
    await roles.insert({ key: 'member', name: 'Member', permissions: [] })
  }

  console.log('Seeding starter achievements...')
  const achievements = new AchievementRepository(db)
  const starterAchievements = [
    { key: 'first_session', name: 'First Session Logged', description: 'Logged your first workout session.', icon: '🎉', criteriaType: 'session_count' as const, criteriaValue: { count: 1 }, isPublished: true },
    { key: 'week_streak', name: '7-Day Streak', description: 'Hit every scheduled day for a week straight.', icon: '🔥', criteriaType: 'streak_length' as const, criteriaValue: { days: 1 }, isPublished: true },
    { key: 'month_streak', name: '30-Day Streak', description: 'A full month of hitting every scheduled day.', icon: '🏆', criteriaType: 'streak_length' as const, criteriaValue: { days: 4 }, isPublished: true },
    { key: 'first_pr', name: 'First PR', description: 'Logged your first personal record.', icon: '💪', criteriaType: 'pr' as const, criteriaValue: {}, isPublished: true },
    { key: 'first_target_hit', name: 'Goal Reached', description: 'Hit one of your targets.', icon: '🎯', criteriaType: 'target_hit' as const, criteriaValue: {}, isPublished: true },
  ]
  for (const achievement of starterAchievements) {
    const existing = await db.execute({ sql: 'SELECT id FROM achievements WHERE key = ?', args: [achievement.key] })
    if (existing.rows.length === 0) {
      await achievements.create(achievement)
    }
  }

  console.log('Seeding preset splits...')
  const presetSplits = new PresetSplitRepository(db)

  const findExerciseId = async (name: string): Promise<string | undefined> => {
    const result = await db.execute({ sql: 'SELECT id FROM exercises WHERE name = ? LIMIT 1', args: [name] })
    return result.rows[0]?.id as string | undefined
  }
  const findMuscleId = async (name: string): Promise<number | undefined> => {
    const result = await db.execute({ sql: 'SELECT id FROM muscles WHERE name = ? LIMIT 1', args: [name] })
    return result.rows[0]?.id as number | undefined
  }
  const requireExerciseId = async (name: string): Promise<string> => {
    const id = await findExerciseId(name)
    if (!id) throw new Error(`Seed: expected exercise "${name}" to exist but it was not found in the exercises table.`)
    return id
  }
  const requireMuscleId = async (name: string): Promise<number> => {
    const id = await findMuscleId(name)
    if (!id) throw new Error(`Seed: expected muscle "${name}" to exist but it was not found in the muscles table.`)
    return id
  }

  const seedPresetSplit = async (input: CreatePresetSplitInput): Promise<void> => {
    const existing = await db.execute({ sql: 'SELECT id FROM preset_splits WHERE name = ? LIMIT 1', args: [input.name] })
    if (existing.rows.length > 0) return
    await presetSplits.createWithDays(input)
  }

  {
    const [squat, benchPress, row, shoulderPress, plank] = await Promise.all([
      requireExerciseId('Barbell Squat'),
      requireExerciseId('Barbell Bench Press - Medium Grip'),
      requireExerciseId('Bent Over Barbell Row'),
      requireExerciseId('Dumbbell Shoulder Press'),
      requireExerciseId('Plank'),
    ])
    const [deadlift, pullups, lunges, inclinePress, calfRaise] = await Promise.all([
      requireExerciseId('Barbell Deadlift'),
      requireExerciseId('Pullups'),
      requireExerciseId('Dumbbell Lunges'),
      requireExerciseId('Incline Dumbbell Press'),
      requireExerciseId('Standing Barbell Calf Raise'),
    ])
    const [quadriceps, chest, middleBack, shoulders, abdominals, lowerBack, lats, calves] = await Promise.all([
      requireMuscleId('quadriceps'),
      requireMuscleId('chest'),
      requireMuscleId('middle back'),
      requireMuscleId('shoulders'),
      requireMuscleId('abdominals'),
      requireMuscleId('lower back'),
      requireMuscleId('lats'),
      requireMuscleId('calves'),
    ])

    await seedPresetSplit({
      name: 'Full Body',
      description: 'A beginner-friendly full-body split hitting every major muscle group each session. Great starting point when you have 2-3 days a week and access to either a gym or home equipment.',
      frequencyMinDays: 2,
      frequencyMaxDays: 3,
      goal: 'general_fitness',
      experienceLevel: 'beginner',
      equipment: 'both',
      isPublished: true,
      days: [
        {
          name: 'Full Body A',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [quadriceps, chest, middleBack, shoulders, abdominals],
          exercises: [
            { exerciseId: squat, position: 0, targetSets: 4, targetReps: 8, targetRpe: 7 },
            { exerciseId: benchPress, position: 1, targetSets: 4, targetReps: 8, targetRpe: 7 },
            { exerciseId: row, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: shoulderPress, position: 3, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: plank, position: 4, targetSets: 3, targetReps: null, targetRpe: null },
          ],
        },
        {
          name: 'Full Body B',
          dayIndex: 1,
          location: 'gym',
          targetMuscleIds: [lowerBack, lats, quadriceps, chest, calves],
          exercises: [
            { exerciseId: deadlift, position: 0, targetSets: 3, targetReps: 6, targetRpe: 7 },
            { exerciseId: pullups, position: 1, targetSets: 3, targetReps: 8, targetRpe: 7 },
            { exerciseId: lunges, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: inclinePress, position: 3, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: calfRaise, position: 4, targetSets: 3, targetReps: 15, targetRpe: 7 },
          ],
        },
      ],
    })
  }

  {
    const [benchPress, row, shoulderPress, hammerCurl, skullcrusher] = await Promise.all([
      requireExerciseId('Barbell Bench Press - Medium Grip'),
      requireExerciseId('Bent Over Barbell Row'),
      requireExerciseId('Dumbbell Shoulder Press'),
      requireExerciseId('Hammer Curls'),
      requireExerciseId('EZ-Bar Skullcrusher'),
    ])
    const [squat, romanianDeadlift, legPress, calfRaise] = await Promise.all([
      requireExerciseId('Barbell Squat'),
      requireExerciseId('Romanian Deadlift'),
      requireExerciseId('Leg Press'),
      requireExerciseId('Standing Barbell Calf Raise'),
    ])
    const [inclinePress, latPulldown, lateralRaise, dumbbellCurl, tricepsExtension] = await Promise.all([
      requireExerciseId('Barbell Incline Bench Press - Medium Grip'),
      requireExerciseId('Wide-Grip Lat Pulldown'),
      requireExerciseId('Side Lateral Raise'),
      requireExerciseId('Dumbbell Alternate Bicep Curl'),
      requireExerciseId('Cable Rope Overhead Triceps Extension'),
    ])
    const [hipThrust, legExtension, legCurl, calfRaise2] = await Promise.all([
      requireExerciseId('Barbell Hip Thrust'),
      requireExerciseId('Leg Extensions'),
      requireExerciseId('Lying Leg Curls'),
      requireExerciseId('Standing Barbell Calf Raise'),
    ])
    const [chest, middleBack, shoulders, biceps, triceps, quadriceps, hamstrings, calves, lats, glutes] = await Promise.all([
      requireMuscleId('chest'),
      requireMuscleId('middle back'),
      requireMuscleId('shoulders'),
      requireMuscleId('biceps'),
      requireMuscleId('triceps'),
      requireMuscleId('quadriceps'),
      requireMuscleId('hamstrings'),
      requireMuscleId('calves'),
      requireMuscleId('lats'),
      requireMuscleId('glutes'),
    ])

    await seedPresetSplit({
      name: 'Upper/Lower',
      description: 'A 4-day intermediate split alternating upper- and lower-body sessions, built for steady muscle gain with full gym equipment.',
      frequencyMinDays: 4,
      frequencyMaxDays: 4,
      goal: 'muscle_gain',
      experienceLevel: 'intermediate',
      equipment: 'gym',
      isPublished: true,
      days: [
        {
          name: 'Upper A',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [chest, middleBack, shoulders, biceps, triceps],
          exercises: [
            { exerciseId: benchPress, position: 0, targetSets: 4, targetReps: 6, targetRpe: 8 },
            { exerciseId: row, position: 1, targetSets: 4, targetReps: 8, targetRpe: 8 },
            { exerciseId: shoulderPress, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: hammerCurl, position: 3, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: skullcrusher, position: 4, targetSets: 3, targetReps: 12, targetRpe: 7 },
          ],
        },
        {
          name: 'Lower A',
          dayIndex: 1,
          location: 'gym',
          targetMuscleIds: [quadriceps, hamstrings, calves],
          exercises: [
            { exerciseId: squat, position: 0, targetSets: 4, targetReps: 6, targetRpe: 8 },
            { exerciseId: romanianDeadlift, position: 1, targetSets: 3, targetReps: 8, targetRpe: 8 },
            { exerciseId: legPress, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: calfRaise, position: 3, targetSets: 4, targetReps: 15, targetRpe: 7 },
          ],
        },
        {
          name: 'Upper B',
          dayIndex: 2,
          location: 'gym',
          targetMuscleIds: [chest, lats, shoulders, biceps, triceps],
          exercises: [
            { exerciseId: inclinePress, position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 },
            { exerciseId: latPulldown, position: 1, targetSets: 4, targetReps: 10, targetRpe: 8 },
            { exerciseId: lateralRaise, position: 2, targetSets: 3, targetReps: 15, targetRpe: 7 },
            { exerciseId: dumbbellCurl, position: 3, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: tricepsExtension, position: 4, targetSets: 3, targetReps: 12, targetRpe: 7 },
          ],
        },
        {
          name: 'Lower B',
          dayIndex: 3,
          location: 'gym',
          targetMuscleIds: [glutes, quadriceps, hamstrings, calves],
          exercises: [
            { exerciseId: hipThrust, position: 0, targetSets: 4, targetReps: 10, targetRpe: 8 },
            { exerciseId: legExtension, position: 1, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: legCurl, position: 2, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: calfRaise2, position: 3, targetSets: 4, targetReps: 15, targetRpe: 7 },
          ],
        },
      ],
    })
  }

  {
    const [benchPress, inclinePress, shoulderPress, lateralRaise, tricepsExtension] = await Promise.all([
      requireExerciseId('Barbell Bench Press - Medium Grip'),
      requireExerciseId('Incline Dumbbell Press'),
      requireExerciseId('Dumbbell Shoulder Press'),
      requireExerciseId('Side Lateral Raise'),
      requireExerciseId('Cable Rope Overhead Triceps Extension'),
    ])
    const [row, latPulldown, facePull, hammerCurl] = await Promise.all([
      requireExerciseId('Bent Over Barbell Row'),
      requireExerciseId('Wide-Grip Lat Pulldown'),
      requireExerciseId('Face Pull'),
      requireExerciseId('Hammer Curls'),
    ])
    const [squat, romanianDeadlift, legPress, hipThrust, calfRaise] = await Promise.all([
      requireExerciseId('Barbell Squat'),
      requireExerciseId('Romanian Deadlift'),
      requireExerciseId('Leg Press'),
      requireExerciseId('Barbell Hip Thrust'),
      requireExerciseId('Standing Barbell Calf Raise'),
    ])
    const [chest, shoulders, triceps, lats, middleBack, biceps, quadriceps, hamstrings, glutes, calves] = await Promise.all([
      requireMuscleId('chest'),
      requireMuscleId('shoulders'),
      requireMuscleId('triceps'),
      requireMuscleId('lats'),
      requireMuscleId('middle back'),
      requireMuscleId('biceps'),
      requireMuscleId('quadriceps'),
      requireMuscleId('hamstrings'),
      requireMuscleId('glutes'),
      requireMuscleId('calves'),
    ])

    await seedPresetSplit({
      name: 'Push Pull Legs',
      description: 'A 5-6 day intermediate split for muscle gain, dividing training into pushing, pulling, and leg days so each muscle group gets focused, high-frequency volume.',
      frequencyMinDays: 5,
      frequencyMaxDays: 6,
      goal: 'muscle_gain',
      experienceLevel: 'intermediate',
      equipment: 'gym',
      isPublished: true,
      days: [
        {
          name: 'Push',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [chest, shoulders, triceps],
          exercises: [
            { exerciseId: benchPress, position: 0, targetSets: 4, targetReps: 6, targetRpe: 8 },
            { exerciseId: inclinePress, position: 1, targetSets: 3, targetReps: 10, targetRpe: 8 },
            { exerciseId: shoulderPress, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: lateralRaise, position: 3, targetSets: 3, targetReps: 15, targetRpe: 7 },
            { exerciseId: tricepsExtension, position: 4, targetSets: 3, targetReps: 12, targetRpe: 7 },
          ],
        },
        {
          name: 'Pull',
          dayIndex: 1,
          location: 'gym',
          targetMuscleIds: [lats, middleBack, biceps, shoulders],
          exercises: [
            { exerciseId: row, position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 },
            { exerciseId: latPulldown, position: 1, targetSets: 3, targetReps: 10, targetRpe: 8 },
            { exerciseId: facePull, position: 2, targetSets: 3, targetReps: 15, targetRpe: 7 },
            { exerciseId: hammerCurl, position: 3, targetSets: 3, targetReps: 12, targetRpe: 7 },
          ],
        },
        {
          name: 'Legs',
          dayIndex: 2,
          location: 'gym',
          targetMuscleIds: [quadriceps, hamstrings, glutes, calves],
          exercises: [
            { exerciseId: squat, position: 0, targetSets: 4, targetReps: 6, targetRpe: 8 },
            { exerciseId: romanianDeadlift, position: 1, targetSets: 3, targetReps: 8, targetRpe: 8 },
            { exerciseId: legPress, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: hipThrust, position: 3, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: calfRaise, position: 4, targetSets: 4, targetReps: 15, targetRpe: 7 },
          ],
        },
      ],
    })
  }

  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.close())
