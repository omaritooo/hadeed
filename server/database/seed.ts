import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { RoleRepository } from '~~/server/repositories/role.repository'
import { PresetSplitRepository, type CreatePresetSplitInput } from '~~/server/repositories/preset-split.repository'
import { AchievementRepository } from '~~/server/repositories/achievement.repository'
import { migrateUserProfilesEquipmentTiers, migratePresetSplitsEquipmentTiers } from './migrations/equipment-tiers'
import { migrateUserProfilesGoalTiers } from './migrations/goal-tiers'

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

const main = async () => {
  await migrateUserProfilesEquipmentTiers(db)
  await migratePresetSplitsEquipmentTiers(db)
  await migrateUserProfilesGoalTiers(db)

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
  const getMuscleId = async (name: string): Promise<number> => {
    const cached = muscleIds.get(name)
    if (cached) return cached
    await db.execute({ sql: 'INSERT OR IGNORE INTO muscles (name) VALUES (?)', args: [name] })
    const result = await db.execute({ sql: 'SELECT id FROM muscles WHERE name = ?', args: [name] })
    const id = result.rows[0]!.id as number
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
    { key: 'week_streak', name: '7-Day Streak', description: 'Hit every scheduled day for a week straight.', icon: '🔥', criteriaType: 'streak_length' as const, criteriaValue: { days: 7 }, isPublished: true },
    { key: 'month_streak', name: '30-Day Streak', description: 'A full month of hitting every scheduled day.', icon: '🏆', criteriaType: 'streak_length' as const, criteriaValue: { days: 30 }, isPublished: true },
    { key: 'iron_will', name: '100-Day Streak', description: 'Trained every scheduled day for 100 days straight.', icon: '⚡', criteriaType: 'streak_length' as const, criteriaValue: { days: 100 }, isPublished: true },
    { key: 'first_session', name: 'First Session Logged', description: 'Logged your first workout session.', icon: '🎉', criteriaType: 'session_count' as const, criteriaValue: { count: 1 }, isPublished: true },
    { key: 'ten_sessions', name: 'Regular', description: 'Completed 10 workout sessions.', icon: '💪', criteriaType: 'session_count' as const, criteriaValue: { count: 10 }, isPublished: true },
    { key: 'fifty_sessions', name: 'Gym Rat', description: 'Completed 50 workout sessions.', icon: '🐀', criteriaType: 'session_count' as const, criteriaValue: { count: 50 }, isPublished: true },
    { key: 'hundred_sessions', name: 'Iron Veteran', description: 'Completed 100 workout sessions.', icon: '🛡️', criteriaType: 'session_count' as const, criteriaValue: { count: 100 }, isPublished: true },
    { key: 'first_pr', name: 'First PR', description: 'Logged your first personal record.', icon: '🥇', criteriaType: 'pr_count' as const, criteriaValue: { count: 1 }, isPublished: true },
    { key: 'pr_five', name: 'Personal Best Club', description: 'Set 5 personal records.', icon: '📈', criteriaType: 'pr_count' as const, criteriaValue: { count: 5 }, isPublished: true },
    { key: 'pr_twenty', name: 'Record Breaker', description: 'Set 20 personal records.', icon: '🚀', criteriaType: 'pr_count' as const, criteriaValue: { count: 20 }, isPublished: true },
    { key: 'volume_car', name: 'Lifted a Car', description: 'Lifted a cumulative 1,500 kg -- about the weight of a small car.', icon: '🚗', criteriaType: 'total_volume_kg' as const, criteriaValue: { kg: 1500 }, isPublished: true },
    { key: 'volume_elephant', name: 'Lifted an Elephant', description: 'Lifted a cumulative 5,400 kg -- about the weight of an African elephant.', icon: '🐘', criteriaType: 'total_volume_kg' as const, criteriaValue: { kg: 5400 }, isPublished: true },
    { key: 'volume_bus', name: 'Lifted a School Bus', description: 'Lifted a cumulative 12,000 kg -- about the weight of a school bus.', icon: '🚌', criteriaType: 'total_volume_kg' as const, criteriaValue: { kg: 12000 }, isPublished: true },
  ]
  for (const achievement of starterAchievements) {
    await achievements.upsertByKey(achievement)
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
      equipment: 'full_gym',
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
      equipment: 'full_gym',
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

  {
    // Bro Split: 5-day advanced split, one major muscle group focus per day.
    const [benchPress, inclinePress, declinePress, cableCrossover, butterfly] = await Promise.all([
      requireExerciseId('Barbell Bench Press - Medium Grip'),
      requireExerciseId('Barbell Incline Bench Press - Medium Grip'),
      requireExerciseId('Decline Barbell Bench Press'),
      requireExerciseId('Cable Crossover'),
      requireExerciseId('Butterfly'),
    ])
    const [row, latPulldown, tBarRow, chinUp] = await Promise.all([
      requireExerciseId('Bent Over Barbell Row'),
      requireExerciseId('Wide-Grip Lat Pulldown'),
      requireExerciseId('Lying T-Bar Row'),
      requireExerciseId('Chin-Up'),
    ])
    const [shoulderPress, lateralRaise, facePull, shrug, dumbbellShrug] = await Promise.all([
      requireExerciseId('Barbell Shoulder Press'),
      requireExerciseId('Side Lateral Raise'),
      requireExerciseId('Face Pull'),
      requireExerciseId('Barbell Shrug'),
      requireExerciseId('Dumbbell Shrug'),
    ])
    const [squat, romanianDeadlift, legPress, calfRaise, airBike] = await Promise.all([
      requireExerciseId('Barbell Squat'),
      requireExerciseId('Romanian Deadlift'),
      requireExerciseId('Leg Press'),
      requireExerciseId('Standing Barbell Calf Raise'),
      requireExerciseId('Air Bike'),
    ])
    const [barbellCurl, hammerCurl, closeGripBench, tricepsExtension, wristCurl] = await Promise.all([
      requireExerciseId('Barbell Curl'),
      requireExerciseId('Hammer Curls'),
      requireExerciseId('Close-Grip Barbell Bench Press'),
      requireExerciseId('Cable Rope Overhead Triceps Extension'),
      requireExerciseId('Cable Wrist Curl'),
    ])
    const [chest, lats, middleBack, shoulders, traps, biceps, triceps, quadriceps, hamstrings, calves, abdominals, forearms] = await Promise.all([
      requireMuscleId('chest'),
      requireMuscleId('lats'),
      requireMuscleId('middle back'),
      requireMuscleId('shoulders'),
      requireMuscleId('traps'),
      requireMuscleId('biceps'),
      requireMuscleId('triceps'),
      requireMuscleId('quadriceps'),
      requireMuscleId('hamstrings'),
      requireMuscleId('calves'),
      requireMuscleId('abdominals'),
      requireMuscleId('forearms'),
    ])

    await seedPresetSplit({
      name: 'Bro Split',
      description: 'A 5-day advanced split dedicating each session to a single muscle group -- Chest, Back, Shoulders+Traps, Legs+Abs, Arms -- for high per-muscle volume with full gym equipment.',
      frequencyMinDays: 5,
      frequencyMaxDays: 5,
      goal: 'muscle_gain',
      experienceLevel: 'advanced',
      equipment: 'full_gym',
      isPublished: true,
      days: [
        {
          name: 'Chest',
          dayIndex: 0,
          location: 'gym',
          targetMuscleIds: [chest],
          exercises: [
            { exerciseId: benchPress, position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 },
            { exerciseId: inclinePress, position: 1, targetSets: 4, targetReps: 10, targetRpe: 8 },
            { exerciseId: declinePress, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: cableCrossover, position: 3, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: butterfly, position: 4, targetSets: 3, targetReps: 15, targetRpe: 7 },
          ],
        },
        {
          name: 'Back',
          dayIndex: 1,
          location: 'gym',
          targetMuscleIds: [lats, middleBack],
          exercises: [
            { exerciseId: row, position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 },
            { exerciseId: latPulldown, position: 1, targetSets: 4, targetReps: 10, targetRpe: 8 },
            { exerciseId: tBarRow, position: 2, targetSets: 3, targetReps: 10, targetRpe: 7 },
            { exerciseId: chinUp, position: 3, targetSets: 3, targetReps: 8, targetRpe: 7 },
          ],
        },
        {
          name: 'Shoulders + Traps',
          dayIndex: 2,
          location: 'gym',
          targetMuscleIds: [shoulders, traps],
          exercises: [
            { exerciseId: shoulderPress, position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 },
            { exerciseId: lateralRaise, position: 1, targetSets: 3, targetReps: 15, targetRpe: 7 },
            { exerciseId: facePull, position: 2, targetSets: 3, targetReps: 15, targetRpe: 7 },
            { exerciseId: shrug, position: 3, targetSets: 4, targetReps: 12, targetRpe: 7 },
            { exerciseId: dumbbellShrug, position: 4, targetSets: 3, targetReps: 15, targetRpe: 7 },
          ],
        },
        {
          name: 'Legs + Abs',
          dayIndex: 3,
          location: 'gym',
          targetMuscleIds: [quadriceps, hamstrings, calves, abdominals],
          exercises: [
            { exerciseId: squat, position: 0, targetSets: 4, targetReps: 8, targetRpe: 8 },
            { exerciseId: romanianDeadlift, position: 1, targetSets: 3, targetReps: 10, targetRpe: 8 },
            { exerciseId: legPress, position: 2, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: calfRaise, position: 3, targetSets: 4, targetReps: 15, targetRpe: 7 },
            { exerciseId: airBike, position: 4, targetSets: 3, targetReps: 20, targetRpe: 7 },
          ],
        },
        {
          name: 'Arms',
          dayIndex: 4,
          location: 'gym',
          targetMuscleIds: [biceps, triceps, forearms],
          exercises: [
            { exerciseId: barbellCurl, position: 0, targetSets: 4, targetReps: 10, targetRpe: 8 },
            { exerciseId: hammerCurl, position: 1, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: closeGripBench, position: 2, targetSets: 4, targetReps: 10, targetRpe: 8 },
            { exerciseId: tricepsExtension, position: 3, targetSets: 3, targetReps: 12, targetRpe: 7 },
            { exerciseId: wristCurl, position: 4, targetSets: 3, targetReps: 15, targetRpe: 7 },
          ],
        },
      ],
    })
  }

  {
    // Mobility: 2-3 day full-body flexibility routine, no equipment, drawn from the
    // exercises catalog's `stretching` category.
    const [catStretch, childsPose, armCircles, hamstringStretch, calfStretch, ankleCircles] = await Promise.all([
      requireExerciseId('Cat Stretch'),
      requireExerciseId('Child\'s Pose'),
      requireExerciseId('Arm Circles'),
      requireExerciseId('Hamstring Stretch'),
      requireExerciseId('Calf Stretch Hands Against Wall'),
      requireExerciseId('Ankle Circles'),
    ])
    const [dynamicBack, dynamicChest, quadStretch, adductorGroin, hipCircles, elbowCircles] = await Promise.all([
      requireExerciseId('Dynamic Back Stretch'),
      requireExerciseId('Dynamic Chest Stretch'),
      requireExerciseId('All Fours Quad Stretch'),
      requireExerciseId('Adductor/Groin'),
      requireExerciseId('Hip Circles (prone)'),
      requireExerciseId('Elbow Circles'),
    ])
    const [inchworm, dancersStretch, groinBack, hugKnees, crossoverLunge, chinToChest] = await Promise.all([
      requireExerciseId('Inchworm'),
      requireExerciseId('Dancer\'s Stretch'),
      requireExerciseId('Groin and Back Stretch'),
      requireExerciseId('Hug Knees To Chest'),
      requireExerciseId('Crossover Reverse Lunge'),
      requireExerciseId('Chin To Chest Stretch'),
    ])
    const [shoulders, middleBack, quadriceps, hamstrings, calves, abdominals] = await Promise.all([
      requireMuscleId('shoulders'),
      requireMuscleId('middle back'),
      requireMuscleId('quadriceps'),
      requireMuscleId('hamstrings'),
      requireMuscleId('calves'),
      requireMuscleId('abdominals'),
    ])

    await seedPresetSplit({
      name: 'Mobility',
      description: 'A 2-3 day full-body mobility and flexibility routine using no equipment -- great for active recovery, improving range of motion, or pairing alongside a strength program.',
      frequencyMinDays: 2,
      frequencyMaxDays: 3,
      goal: 'mobility',
      experienceLevel: null,
      equipment: 'bodyweight',
      isPublished: true,
      days: [
        {
          name: 'Mobility A',
          dayIndex: 0,
          location: 'home',
          targetMuscleIds: [middleBack, shoulders, hamstrings, calves],
          exercises: [
            { exerciseId: catStretch, position: 0, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: childsPose, position: 1, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: armCircles, position: 2, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: hamstringStretch, position: 3, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: calfStretch, position: 4, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: ankleCircles, position: 5, targetSets: 2, targetReps: null, targetRpe: null },
          ],
        },
        {
          name: 'Mobility B',
          dayIndex: 1,
          location: 'home',
          targetMuscleIds: [middleBack, shoulders, quadriceps],
          exercises: [
            { exerciseId: dynamicBack, position: 0, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: dynamicChest, position: 1, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: quadStretch, position: 2, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: adductorGroin, position: 3, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: hipCircles, position: 4, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: elbowCircles, position: 5, targetSets: 2, targetReps: null, targetRpe: null },
          ],
        },
        {
          name: 'Mobility C',
          dayIndex: 2,
          location: 'home',
          targetMuscleIds: [abdominals, quadriceps, hamstrings],
          exercises: [
            { exerciseId: inchworm, position: 0, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: dancersStretch, position: 1, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: groinBack, position: 2, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: hugKnees, position: 3, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: crossoverLunge, position: 4, targetSets: 2, targetReps: null, targetRpe: null },
            { exerciseId: chinToChest, position: 5, targetSets: 2, targetReps: null, targetRpe: null },
          ],
        },
      ],
    })
  }

  {
    // Fat-Loss Circuit: 3-day full-body metabolic circuit, drawn from the exercises
    // catalog's `plyometrics`/`cardio` categories -- format: 'circuit', 4 rounds, 20s rest.
    const [mountainClimbers, starJump, splitJump, plyoPushupA, fastSkipping] = await Promise.all([
      requireExerciseId('Mountain Climbers'),
      requireExerciseId('Star Jump'),
      requireExerciseId('Split Jump'),
      requireExerciseId('Plyo Push-up'),
      requireExerciseId('Fast Skipping'),
    ])
    const [chestSqueezes, kneelingArmDrill, kneeTuckJump, lateralBound, cariocaStep, scissorsJump] = await Promise.all([
      requireExerciseId('Isometric Chest Squeezes'),
      requireExerciseId('Kneeling Arm Drill'),
      requireExerciseId('Knee Tuck Jump'),
      requireExerciseId('Lateral Bound'),
      requireExerciseId('Carioca Quick Step'),
      requireExerciseId('Scissors Jump'),
    ])
    const [standingLongJump, sideStandingLongJump, rocketJump, diagonalBound, singleLegButtKick, plyoPushupC] = await Promise.all([
      requireExerciseId('Standing Long Jump'),
      requireExerciseId('Side Standing Long Jump'),
      requireExerciseId('Rocket Jump'),
      requireExerciseId('Alternate Leg Diagonal Bound'),
      requireExerciseId('Single Leg Butt Kick'),
      requireExerciseId('Plyo Push-up'),
    ])
    const [quadriceps, hamstrings, calves, shoulders, chest, abdominals] = await Promise.all([
      requireMuscleId('quadriceps'),
      requireMuscleId('hamstrings'),
      requireMuscleId('calves'),
      requireMuscleId('shoulders'),
      requireMuscleId('chest'),
      requireMuscleId('abdominals'),
    ])

    await seedPresetSplit({
      name: 'Fat-Loss Circuit',
      description: 'A 3-day full-body metabolic conditioning circuit -- 4 rounds of back-to-back plyometric and cardio moves with short rest, built for fat loss with no equipment.',
      frequencyMinDays: 3,
      frequencyMaxDays: 3,
      goal: 'fat_loss',
      experienceLevel: null,
      equipment: 'bodyweight',
      isPublished: true,
      days: [
        {
          name: 'Circuit A',
          dayIndex: 0,
          location: 'home',
          format: 'circuit',
          rounds: 4,
          targetMuscleIds: [quadriceps, calves, chest, abdominals],
          exercises: [
            { exerciseId: mountainClimbers, position: 0, targetSets: null, targetReps: 20, targetRpe: null, restSeconds: 20 },
            { exerciseId: starJump, position: 1, targetSets: null, targetReps: 15, targetRpe: null, restSeconds: 20 },
            { exerciseId: splitJump, position: 2, targetSets: null, targetReps: 15, targetRpe: null, restSeconds: 20 },
            { exerciseId: plyoPushupA, position: 3, targetSets: null, targetReps: 10, targetRpe: null, restSeconds: 20 },
            { exerciseId: fastSkipping, position: 4, targetSets: null, targetReps: 30, targetRpe: null, restSeconds: 20 },
          ],
        },
        {
          name: 'Circuit B',
          dayIndex: 1,
          location: 'home',
          format: 'circuit',
          rounds: 4,
          targetMuscleIds: [chest, shoulders, quadriceps, abdominals],
          exercises: [
            { exerciseId: chestSqueezes, position: 0, targetSets: null, targetReps: 15, targetRpe: null, restSeconds: 20 },
            { exerciseId: kneelingArmDrill, position: 1, targetSets: null, targetReps: 20, targetRpe: null, restSeconds: 20 },
            { exerciseId: kneeTuckJump, position: 2, targetSets: null, targetReps: 12, targetRpe: null, restSeconds: 20 },
            { exerciseId: lateralBound, position: 3, targetSets: null, targetReps: 12, targetRpe: null, restSeconds: 20 },
            { exerciseId: cariocaStep, position: 4, targetSets: null, targetReps: 20, targetRpe: null, restSeconds: 20 },
            { exerciseId: scissorsJump, position: 5, targetSets: null, targetReps: 15, targetRpe: null, restSeconds: 20 },
          ],
        },
        {
          name: 'Circuit C',
          dayIndex: 2,
          location: 'home',
          format: 'circuit',
          rounds: 4,
          targetMuscleIds: [quadriceps, hamstrings, calves, chest],
          exercises: [
            { exerciseId: standingLongJump, position: 0, targetSets: null, targetReps: 10, targetRpe: null, restSeconds: 20 },
            { exerciseId: sideStandingLongJump, position: 1, targetSets: null, targetReps: 10, targetRpe: null, restSeconds: 20 },
            { exerciseId: rocketJump, position: 2, targetSets: null, targetReps: 12, targetRpe: null, restSeconds: 20 },
            { exerciseId: diagonalBound, position: 3, targetSets: null, targetReps: 10, targetRpe: null, restSeconds: 20 },
            { exerciseId: singleLegButtKick, position: 4, targetSets: null, targetReps: 20, targetRpe: null, restSeconds: 20 },
            { exerciseId: plyoPushupC, position: 5, targetSets: null, targetReps: 10, targetRpe: null, restSeconds: 20 },
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
