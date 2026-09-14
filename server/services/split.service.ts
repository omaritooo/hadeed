import { BaseService } from '~~/server/services/base.service'
import type { BlockRepository, CreateSplitDayInput } from '~~/server/repositories/block.repository'
import type { PresetSplitWithDays } from '~~/server/repositories/preset-split.repository'
import type { PresetExerciseOverride } from '~~/shared/types/preset.types'
import type { RequestContext } from '~~/shared/types/rbac.types'
import type { MacroTarget } from '~~/shared/types/split.types'
import { dayBefore } from '~~/server/utils/date'

export interface CreateFromScratchInput {
  name: string
  startDate: string
  endDate: string | null
  trainingDayMacroTarget?: MacroTarget | null
  restDayMacroTarget?: MacroTarget | null
  days: CreateSplitDayInput[]
}

export class SplitService extends BaseService {
  constructor(ctx: RequestContext, private blocks: BlockRepository) {
    super(ctx)
  }

  private async retireActiveBlock(newStartDate: string): Promise<void> {
    const active = await this.blocks.findActiveForUser(this.ctx.userId, newStartDate)
    if (!active) return
    const endDate = active.startDate >= newStartDate ? active.startDate : dayBefore(newStartDate)
    await this.blocks.setEndDate(active.id, endDate)
  }

  async createFromScratch(input: CreateFromScratchInput) {
    await this.retireActiveBlock(input.startDate)
    return this.blocks.createWithDays(this.ctx.userId, {
      programId: null,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      trainingDayMacroTarget: input.trainingDayMacroTarget ?? null,
      restDayMacroTarget: input.restDayMacroTarget ?? null,
      days: input.days,
    })
  }

  async createFromPreset(
    preset: PresetSplitWithDays,
    overrides: { name: string, startDate: string, endDate: string | null },
    exerciseOverrides: PresetExerciseOverride[] = [],
  ) {
    await this.retireActiveBlock(overrides.startDate)
    return this.blocks.createWithDays(this.ctx.userId, {
      programId: null,
      name: overrides.name,
      startDate: overrides.startDate,
      endDate: overrides.endDate,
      trainingDayMacroTarget: null,
      restDayMacroTarget: null,
      days: preset.days.map(day => ({
        name: day.name,
        dayOfWeek: day.dayIndex,
        location: day.location,
        format: day.format,
        rounds: day.rounds,
        exercises: day.exercises.map((ex) => {
          const override = exerciseOverrides.find(
            o => o.dayIndex === day.dayIndex && o.position === ex.position,
          )
          return {
            exerciseId: override?.exerciseId ?? ex.exerciseId,
            position: ex.position,
            setType: 'weight_reps' as const,
            targetSets: ex.targetSets,
            targetRepsMin: ex.targetRepsMin,
            targetRepsMax: ex.targetRepsMax,
            targetRpe: ex.targetRpe,
            restSeconds: ex.restSeconds,
          }
        }),
      })),
    })
  }

  async getOwnedBlock(blockId: number) {
    const block = await this.blocks.findWithDays(blockId)
    if (!block) return null
    this.requireOwner(block.userId)
    return block
  }
}
