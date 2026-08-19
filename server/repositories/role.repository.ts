import { BaseRepository } from '~~/server/repositories/base.repository'
import type { Role } from '~~/shared/types/rbac.types'

export class RoleRepository extends BaseRepository<Role> {
  protected tableName = 'roles'

  protected mapRow(row: Record<string, unknown>): Role {
    return {
      id: row.id as number,
      key: row.key as string,
      name: row.name as string,
      permissions: JSON.parse(row.permissions as string),
    }
  }

  override async insert(data: { key: string, name: string, permissions: string[] }): Promise<Role> {
    return super.insert({ key: data.key, name: data.name, permissions: JSON.stringify(data.permissions) })
  }

  async findByKey(key: string): Promise<Role | null> {
    const roles = await this.findMany({ key })
    return roles[0] ?? null
  }

  async assignToUser(userId: string, roleId: number): Promise<void> {
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      args: [userId, roleId],
    })
  }

  async findForUser(userId: string): Promise<Role[]> {
    const result = await this.db.execute({
      sql: `SELECT roles.* FROM roles
            JOIN user_roles ON user_roles.role_id = roles.id
            WHERE user_roles.user_id = ?`,
      args: [userId],
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }
}
