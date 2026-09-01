import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(__dirname, '../../database/schema.sql')

export const createTestDb = async (): Promise<Client> => {
  const dir = mkdtempSync(join(tmpdir(), 'hadeed-test-db-'))
  const db = createClient({ url: `file:${join(dir, 'test.db')}`, timeout: 200 })
  const schema = readFileSync(schemaPath, 'utf-8')
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    try {
      await db.execute(statement)
    } catch (err) {
      const isDuplicateColumn = err instanceof Error && /duplicate column name/i.test(err.message)
      if (!isDuplicateColumn) throw err
    }
  }
  return db
}
