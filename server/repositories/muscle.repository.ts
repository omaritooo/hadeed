import { BaseRepository } from '~~/server/repositories/base.repository'
import type { Muscle } from '~~/shared/types/exercise.types'

export class MuscleRepository extends BaseRepository<Muscle> {
  protected tableName = 'muscles'

  protected mapRow(row: Record<string, unknown>): Muscle {
    return { id: row.id as number, name: row.name as string }
  }

  async findByName(name: string): Promise<Muscle | null> {
    const muscles = await this.findMany({ name })
    return muscles[0] ?? null
  }

  async getOrCreate(name: string): Promise<Muscle> {
    const existing = await this.findByName(name)
    if (existing) return existing
    return this.insert({ name })
  }
}
