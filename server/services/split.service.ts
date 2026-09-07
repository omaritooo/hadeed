import { BaseService } from '~~/server/services/base.service'
import type { BlockRepository, CreateSplitDayInput } from '~~/server/repositories/block.repository'
import type { PresetSplitWithDays } from '~~/server/repositories/preset-split.repository'
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
    await this.blocks.setEndDate(active.id, dayBefore(newStartDate))
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
        exercises: day.exercises.map(ex => ({
          exerciseId: ex.exerciseId,
          position: ex.position,
          setType: 'weight_reps' as const,
          targetSets: ex.targetSets,
          targetReps: ex.targetReps,
          targetRpe: ex.targetRpe,
        })),
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
