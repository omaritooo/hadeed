import type { Client } from '@libsql/client'

export abstract class BaseRepository<T> {
  protected abstract tableName: string

  constructor(protected db: Client) {}

  protected abstract mapRow(row: Record<string, unknown>): T

  async findById(id: string | number): Promise<T | null> {
    const result = await this.db.execute({
      sql: `SELECT * FROM ${this.tableName} WHERE id = ?`,
      args: [id],
    })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async findMany(where: Record<string, string | number> = {}): Promise<T[]> {
    const entries = Object.entries(where)
    const clause = entries.length ? `WHERE ${entries.map(([k]) => `${k} = ?`).join(' AND ')}` : ''
    const result = await this.db.execute({
      sql: `SELECT * FROM ${this.tableName} ${clause}`,
      args: entries.map(([, v]) => v),
    })
    return result.rows.map(row => this.mapRow(row as unknown as Record<string, unknown>))
  }

  async insert(data: Record<string, unknown>): Promise<T> {
    const keys = Object.keys(data)
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`
    const result = await this.db.execute({ sql, args: keys.map(k => data[k] as never) })
    return this.mapRow(result.rows[0] as unknown as Record<string, unknown>)
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<T | null> {
    const keys = Object.keys(data)
    if (!keys.length) return this.findById(id)
    const sql = `UPDATE ${this.tableName} SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? RETURNING *`
    const result = await this.db.execute({ sql, args: [...keys.map(k => data[k] as never), id] })
    const row = result.rows[0]
    return row ? this.mapRow(row as unknown as Record<string, unknown>) : null
  }

  async delete(id: string | number): Promise<void> {
    await this.db.execute({ sql: `DELETE FROM ${this.tableName} WHERE id = ?`, args: [id] })
  }
}
