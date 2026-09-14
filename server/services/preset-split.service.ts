import { BaseService } from '~~/server/services/base.service'
import type { CreatePresetSplitInput, PresetSplitRepository } from '~~/server/repositories/preset-split.repository'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { PresetSplit, RecommendationInput, SplitRecommendation } from '~~/shared/types/preset.types'
import { equipmentSatisfies } from '~~/shared/lib/equipment'
import { JOINT_AREA_LABELS } from '~~/shared/lib/joint-areas'

const frequencyScore = (daysPerWeek: number, min: number, max: number): number => {
  if (daysPerWeek >= min && daysPerWeek <= max) return 3
  const distance = daysPerWeek < min ? min - daysPerWeek : daysPerWeek - max
  return distance === 1 ? 1 : 0
}

const scorePreset = (preset: PresetSplit, input: RecommendationInput): { score: number, reasons: string[] } => {
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

  if (input.equipment && equipmentSatisfies({ userTier: input.equipment, required: preset.equipment })) {
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
    const [published, stressed] = await Promise.all([
      this.presets.findPublished(),
      this.presets.countStressedTier1Exercises(input.limitations ?? []),
    ])
    return published
      .map((preset) => {
        const { score, reasons } = scorePreset(preset, input)
        const conflict = stressed.get(preset.id)
        if (!conflict) return { preset, score, reasons }
        // A soft penalty only: the frequency filter below ignores it, so a conflict re-ranks a
        // preset but never hides it.
        const areaLabel = conflict.areas.map(area => JOINT_AREA_LABELS[area].toLowerCase()).join(' and ')
        return {
          preset,
          score: score - conflict.count,
          reasons: [...reasons, `${conflict.count} exercise${conflict.count === 1 ? ' loads' : 's load'} your ${areaLabel}`],
        }
      })
      .filter(({ preset }) => frequencyScore(input.daysPerWeek, preset.frequencyMinDays, preset.frequencyMaxDays) > 0)
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
