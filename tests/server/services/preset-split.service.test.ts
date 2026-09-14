import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client'
import { createTestDb } from '~~/server/utils/test/create-test-db'
import { PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import { PresetSplitService } from '~~/server/services/preset-split.service'
import type { RequestContext } from '~~/shared/types/rbac.types'

describe('PresetSplitService.recommend', () => {
  let db: Client
  let service: PresetSplitService
  const ctx: RequestContext = { userId: 'user-1', roles: [], permissions: [] }

  beforeEach(async () => {
    db = await createTestDb()
    const repo = new PresetSplitRepository(db)
    service = new PresetSplitService(ctx, repo)

    await repo.createWithDays({
      name: 'Full Body', description: null, frequencyMinDays: 2, frequencyMaxDays: 3,
      goal: 'general_fitness', experienceLevel: 'beginner', equipment: 'both', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'Upper/Lower', description: null, frequencyMinDays: 4, frequencyMaxDays: 4,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'full_gym', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'PPL', description: null, frequencyMinDays: 5, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'full_gym', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'Unpublished Draft', description: null, frequencyMinDays: 5, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'full_gym', isPublished: false, days: [],
    })
    await repo.createWithDays({
      name: 'Minimalist Home', description: null, frequencyMinDays: 3, frequencyMaxDays: 3,
      goal: null, experienceLevel: null, equipment: 'home_dumbbell_only', isPublished: true, days: [],
    })
  })

  // The fixture presets have no days, so give a preset a day holding one exercise tagged as a
  // stressor of `area`. Called twice with the same exercise, it lands on two days.
  const addStressedExercise = async (presetName: string, exerciseId: string, tier: 1 | 2 | 3, area: string) => {
    await db.execute({ sql: 'INSERT OR IGNORE INTO exercises (id, name, tier) VALUES (?, ?, ?)', args: [exerciseId, exerciseId, tier] })
    await db.execute({ sql: `INSERT OR IGNORE INTO exercise_stressors (exercise_id, area, source) VALUES (?, ?, 'rule')`, args: [exerciseId, area] })
    const preset = (await db.execute({ sql: 'SELECT id FROM preset_splits WHERE name = ?', args: [presetName] })).rows[0]!
    const day = (await db.execute({
      sql: `INSERT INTO preset_split_days (preset_split_id, name, day_index, location) VALUES (?, 'Day', 0, 'gym') RETURNING id`,
      args: [preset.id],
    })).rows[0]!
    await db.execute({
      sql: 'INSERT INTO preset_split_exercises (preset_split_day_id, exercise_id, position) VALUES (?, ?, 0)',
      args: [day.id, exerciseId],
    })
  }

  it('ranks an exact frequency + goal + experience + equipment match highest', async () => {
    const results = await service.recommend({
      daysPerWeek: 6, experienceLevel: 'intermediate', goal: 'muscle_gain', equipment: 'full_gym',
    })
    expect(results[0]!.preset.name).toBe('PPL')
    expect(results[0]!.score).toBe(9)
  })

  it('gives partial credit for a frequency one day outside the range', async () => {
    const results = await service.recommend({
      daysPerWeek: 5, experienceLevel: 'intermediate', goal: 'muscle_gain', equipment: 'full_gym',
    })
    const upperLower = results.find(r => r.preset.name === 'Upper/Lower')!
    expect(upperLower.score).toBe(1 + 2 + 2 + 2)
  })

  it('never returns unpublished presets', async () => {
    const results = await service.recommend({ daysPerWeek: 6, experienceLevel: null, goal: null, equipment: null })
    expect(results.some(r => r.preset.name === 'Unpublished Draft')).toBe(false)
  })

  it('includes human-readable reasons for the top match', async () => {
    const results = await service.recommend({
      daysPerWeek: 3, experienceLevel: 'beginner', goal: 'general_fitness', equipment: 'home_barbell_dumbbell',
    })
    expect(results[0]!.preset.name).toBe('Full Body')
    expect(results[0]!.reasons.join(' ')).toMatch(/days/i)
  })

  it('gives equipment credit when a preset requires "both" and the user has any tier', async () => {
    const results = await service.recommend({
      daysPerWeek: 3, experienceLevel: null, goal: null, equipment: 'bodyweight',
    })
    const fullBody = results.find(r => r.preset.name === 'Full Body')!
    expect(fullBody.reasons.join(' ')).toMatch(/works with your bodyweight access/)
  })

  it('gives equipment credit when a higher user tier satisfies a lower-tier preset requirement (new hierarchy behavior)', async () => {
    const results = await service.recommend({
      daysPerWeek: 3, experienceLevel: null, goal: null, equipment: 'full_gym',
    })
    const minimalistHome = results.find(r => r.preset.name === 'Minimalist Home')!
    // frequency exact match (3) + equipment credit (2), since a full_gym user satisfies a
    // home_dumbbell_only requirement under the tier hierarchy - the old flat string
    // comparison (preset.equipment === input.equipment) could never produce this match.
    expect(minimalistHome.score).toBe(5)
    expect(minimalistHome.reasons.join(' ')).toMatch(/works with your full_gym access/)
  })

  it('does not give equipment credit when a lower user tier fails to satisfy a higher-tier preset requirement', async () => {
    const results = await service.recommend({
      daysPerWeek: 3, experienceLevel: null, goal: null, equipment: 'bodyweight',
    })
    const minimalistHome = results.find(r => r.preset.name === 'Minimalist Home')!
    // frequency exact match (3) only - bodyweight does not satisfy home_dumbbell_only.
    expect(minimalistHome.score).toBe(3)
    expect(minimalistHome.reasons.join(' ')).not.toMatch(/works with your/)
  })

  it('excludes a preset whose frequency range is more than one day off', async () => {
    const results = await service.recommend({
      daysPerWeek: 6, experienceLevel: null, goal: null, equipment: null,
    })
    // "Full Body" is (2,3) and "Minimalist Home" is (3,3) - both more than 1 day off from 6.
    expect(results.some(r => r.preset.name === 'Full Body')).toBe(false)
    expect(results.some(r => r.preset.name === 'Minimalist Home')).toBe(false)
  })

  it('still includes a preset exactly one day outside the requested frequency', async () => {
    const results = await service.recommend({
      daysPerWeek: 5, experienceLevel: null, goal: null, equipment: null,
    })
    expect(results.some(r => r.preset.name === 'Upper/Lower')).toBe(true)
  })
  it('penalises presets by tier-1 exercises that load a limited area, with a reason', async () => {
    // Same tier-1 lift on two days counts once.
    await addStressedExercise('Full Body', 'Overhead_Press', 1, 'shoulder')
    await addStressedExercise('Full Body', 'Overhead_Press', 1, 'shoulder')

    const input = { daysPerWeek: 3, experienceLevel: null, goal: null, equipment: null }
    const before = await service.recommend(input)
    const after = await service.recommend({ ...input, limitations: ['shoulder'] })
    const fullBodyBefore = before.find(r => r.preset.name === 'Full Body')!
    const fullBodyAfter = after.find(r => r.preset.name === 'Full Body')!

    expect(fullBodyAfter.score).toBe(fullBodyBefore.score - 1)
    expect(fullBodyAfter.reasons.join(' ')).toMatch(/1 exercise loads your shoulder/)
    // Presets without conflicts are untouched.
    const homeBefore = before.find(r => r.preset.name === 'Minimalist Home')!
    const homeAfter = after.find(r => r.preset.name === 'Minimalist Home')!
    expect(homeAfter).toEqual(homeBefore)
  })

  it('names every limited area and pluralises when several tier-1 exercises conflict', async () => {
    await addStressedExercise('Full Body', 'Overhead_Press', 1, 'shoulder')
    await addStressedExercise('Full Body', 'Back_Squat', 1, 'knee')

    const results = await service.recommend({
      daysPerWeek: 3, experienceLevel: null, goal: null, equipment: null, limitations: ['knee', 'shoulder'],
    })
    const fullBody = results.find(r => r.preset.name === 'Full Body')!
    expect(fullBody.score).toBe(3 - 2)
    expect(fullBody.reasons.join(' ')).toMatch(/2 exercises load your knee and shoulder/)
  })

  it('does not penalise a preset whose conflicting exercise is not tier 1', async () => {
    await addStressedExercise('Full Body', 'Lateral_Raise', 2, 'shoulder')

    const input = { daysPerWeek: 3, experienceLevel: null, goal: null, equipment: null }
    const before = (await service.recommend(input)).find(r => r.preset.name === 'Full Body')!
    const after = (await service.recommend({ ...input, limitations: ['shoulder'] })).find(r => r.preset.name === 'Full Body')!

    expect(after).toEqual(before)
  })
})
