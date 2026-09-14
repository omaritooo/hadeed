import type { Client } from '@libsql/client'
import { JOINT_AREAS, type JointArea } from '~~/shared/lib/joint-areas'

export class UserLimitationRepository {
  constructor(private db: Client) {}

  async findForUser(userId: string): Promise<JointArea[]> {
    const result = await this.db.execute({ sql: 'SELECT area FROM user_limitations WHERE user_id = ?', args: [userId] })
    const areas = new Set(result.rows.map(row => row.area as string))
    return JOINT_AREAS.filter(area => areas.has(area))
  }

  // Swaps the user's whole set in one write batch, so a failed insert never leaves it half-cleared.
  async replace(userId: string, areas: readonly JointArea[]): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM user_limitations WHERE user_id = ?', args: [userId] },
      ...areas.map(area => ({ sql: 'INSERT INTO user_limitations (user_id, area) VALUES (?, ?)', args: [userId, area] })),
    ], 'write')
  }
}
