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

// SQLite can't relax a CHECK constraint via ALTER TABLE, so a database created
// before user_profiles.equipment became a 4-tier column needs its `user_profiles`
// table rebuilt. No-ops once the CHECK already allows the new values. 'both' has
// no direct equivalent for a user profile, so it lands on the closest existing
// tier, 'home_barbell_dumbbell'.
const migrateUserProfilesEquipmentTiers = async () => {
  const info = await db.execute(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_profiles'`)
  const createSql = info.rows[0]?.sql as string | undefined
  if (!createSql || createSql.includes('full_gym')) return

  console.log('Migrating user_profiles.equipment to the 4-tier system...')
  // With foreign_keys enforcement on, DROP TABLE performs an implicit DELETE FROM
  // first, which fires any ON DELETE CASCADE rules of tables referencing this one --
  // disable enforcement for the rebuild so that implicit delete can't cascade, then
  // always restore it afterwards.
  await db.execute('PRAGMA foreign_keys = OFF')
  try {
    await db.execute(`
      CREATE TABLE user_profiles_new (
        user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        date_of_birth    TEXT NOT NULL,
        gender           TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
        height_cm        REAL NOT NULL,
        activity_level   TEXT CHECK (activity_level IN
                           ('sedentary','lightly_active','moderately_active','very_active','extremely_active')),
        experience_level TEXT CHECK (experience_level IN ('beginner','intermediate','advanced')),
        primary_goal     TEXT CHECK (primary_goal IN ('fat_loss','muscle_gain','maintenance','general_fitness')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
        training_days_per_week INTEGER,
        equipment        TEXT CHECK (equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight')),
        unit_system      TEXT NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial')),
        timezone         TEXT,
        hydration_target_ml INTEGER,
        hydration_reminders_enabled INTEGER NOT NULL DEFAULT 0,
        hydration_reminder_interval_minutes INTEGER NOT NULL DEFAULT 120,
        hydration_last_reminded_at TEXT,
        nutrition_target_calories REAL,
        nutrition_target_protein_g REAL,
        nutrition_target_carbs_g REAL,
        nutrition_target_fat_g REAL
      )
    `)
    await db.execute(`
      INSERT INTO user_profiles_new
      SELECT
        user_id, date_of_birth, gender, height_cm, activity_level, experience_level, primary_goal, updated_at,
        training_days_per_week,
        CASE equipment
          WHEN 'gym' THEN 'full_gym'
          WHEN 'home' THEN 'home_barbell_dumbbell'
          WHEN 'both' THEN 'home_barbell_dumbbell'
          ELSE equipment
        END,
        unit_system, timezone, hydration_target_ml, hydration_reminders_enabled,
        hydration_reminder_interval_minutes, hydration_last_reminded_at,
        nutrition_target_calories, nutrition_target_protein_g, nutrition_target_carbs_g, nutrition_target_fat_g
      FROM user_profiles
    `)
    await db.execute('DROP TABLE user_profiles')
    await db.execute('ALTER TABLE user_profiles_new RENAME TO user_profiles')
  } finally {
    await db.execute('PRAGMA foreign_keys = ON')
  }
}

// Same rebuild as migrateUserProfilesEquipmentTiers, but for preset_splits, whose
// equipment column keeps 'both' as a valid value -- presets can genuinely be
// equipment-agnostic even though a user's own profile now picks one concrete tier.
const migratePresetSplitsEquipmentTiers = async () => {
  const info = await db.execute(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'preset_splits'`)
  const createSql = info.rows[0]?.sql as string | undefined
  if (!createSql || createSql.includes('full_gym')) return

  console.log('Migrating preset_splits.equipment to the 4-tier system...')
  // preset_split_days.preset_split_id has ON DELETE CASCADE onto this table, so
  // (as above) foreign_keys must be off for the rebuild or DROP TABLE's implicit
  // delete wipes every preset's days/muscles/exercises along with it.
  await db.execute('PRAGMA foreign_keys = OFF')
  try {
    await db.execute(`
      CREATE TABLE preset_splits_new (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        name                TEXT NOT NULL,
        description         TEXT,
        frequency_min_days  INTEGER NOT NULL,
        frequency_max_days  INTEGER NOT NULL,
        goal                TEXT,
        experience_level    TEXT,
        equipment           TEXT NOT NULL CHECK (equipment IN ('full_gym','home_barbell_dumbbell','home_dumbbell_only','bodyweight','both')),
        is_published        INTEGER NOT NULL DEFAULT 0
      )
    `)
    await db.execute(`
      INSERT INTO preset_splits_new
      SELECT
        id, name, description, frequency_min_days, frequency_max_days, goal, experience_level,
        CASE equipment
          WHEN 'gym' THEN 'full_gym'
          WHEN 'home' THEN 'home_barbell_dumbbell'
          WHEN 'both' THEN 'both'
          ELSE equipment
        END,
        is_published
      FROM preset_splits
    `)
    await db.execute('DROP TABLE preset_splits')
    await db.execute('ALTER TABLE preset_splits_new RENAME TO preset_splits')
  } finally {
    await db.execute('PRAGMA foreign_keys = ON')
  }
}

const main = async () => {
  await migrateUserProfilesEquipmentTiers()
  await migratePresetSplitsEquipmentTiers()

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
