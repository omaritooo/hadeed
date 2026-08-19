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
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'PPL', description: null, frequencyMinDays: 5, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: true, days: [],
    })
    await repo.createWithDays({
      name: 'Unpublished Draft', description: null, frequencyMinDays: 5, frequencyMaxDays: 6,
      goal: 'muscle_gain', experienceLevel: 'intermediate', equipment: 'gym', isPublished: false, days: [],
    })
  })

  it('ranks an exact frequency + goal + experience + equipment match highest', async () => {
    const results = await service.recommend({
      daysPerWeek: 6, experienceLevel: 'intermediate', goal: 'muscle_gain', equipment: 'gym',
    })
    expect(results[0]!.preset.name).toBe('PPL')
    expect(results[0]!.score).toBe(9) // 3 (freq exact) + 2 (experience) + 2 (goal) + 2 (equipment)
  })

  it('gives partial credit for a frequency one day outside the range', async () => {
    const results = await service.recommend({
      daysPerWeek: 5, experienceLevel: 'intermediate', goal: 'muscle_gain', equipment: 'gym',
    })
    const upperLower = results.find(r => r.preset.name === 'Upper/Lower')!
    expect(upperLower.score).toBe(1 + 2 + 2 + 2) // 5 is one day outside [4,4]
  })

  it('never returns unpublished presets', async () => {
    const results = await service.recommend({ daysPerWeek: 6, experienceLevel: null, goal: null, equipment: null })
    expect(results.some(r => r.preset.name === 'Unpublished Draft')).toBe(false)
  })

  it('includes human-readable reasons for the top match', async () => {
    const results = await service.recommend({
      daysPerWeek: 3, experienceLevel: 'beginner', goal: 'general_fitness', equipment: 'home',
    })
    expect(results[0]!.preset.name).toBe('Full Body')
    expect(results[0]!.reasons.join(' ')).toMatch(/days/i)
  })
})
