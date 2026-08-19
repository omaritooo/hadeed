import { BaseService } from '~~/server/services/base.service'
import type { CreatePresetSplitInput, PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { PresetSplit, RecommendationInput, SplitRecommendation } from '~~/shared/types/preset.types'

function frequencyScore(daysPerWeek: number, min: number, max: number): number {
  if (daysPerWeek >= min && daysPerWeek <= max) return 3
  const distance = daysPerWeek < min ? min - daysPerWeek : daysPerWeek - max
  return distance === 1 ? 1 : 0
}

function scorePreset(preset: PresetSplit, input: RecommendationInput): { score: number, reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  const freqScore = frequencyScore(input.daysPerWeek, preset.frequencyMinDays, preset.frequencyMaxDays)
  score += freqScore
  if (freqScore === 3) reasons.push(`fits your ${input.daysPerWeek} days/week`)
  else if (freqScore === 1) reasons.push(`close to your ${input.daysPerWeek} days/week`)

  if (input.experienceLevel && preset.experienceLevel === input.experienceLevel) {
    score += 2
    reasons.push(`matches your ${input.experienceLevel} experience`)
  }

  if (input.goal && preset.goal === input.goal) {
    score += 2
    reasons.push(`matches your ${input.goal.replace('_', ' ')} goal`)
  }

  if (input.equipment && (preset.equipment === input.equipment || preset.equipment === 'both')) {
    score += 2
    reasons.push(`works with your ${input.equipment} access`)
  }

  return { score, reasons }
}

export class PresetSplitService extends BaseService {
  constructor(ctx: RequestContext, private presets: PresetSplitRepository) {
    super(ctx)
  }

  async recommend(input: RecommendationInput): Promise<SplitRecommendation[]> {
    const published = await this.presets.findPublished()
    return published
      .map((preset) => {
        const { score, reasons } = scorePreset(preset, input)
        return { preset, score, reasons }
      })
      .sort((a, b) => b.score - a.score)
  }

  create(input: CreatePresetSplitInput) {
    this.requirePermission('preset:write')
    return this.presets.createWithDays(input)
  }

  getWithDays(presetId: number) {
    return this.presets.findWithDays(presetId)
  }
}
