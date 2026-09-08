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
})
