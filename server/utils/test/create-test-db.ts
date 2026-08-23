import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(__dirname, '../../database/schema.sql')

export async function createTestDb(): Promise<Client> {
  // A file-backed database is required rather than ':memory:'. The local sqlite3 client's
  // transaction() hands its sole native connection to the returned Transaction and never gets
  // it back, so the client lazily opens a brand new connection on its next top-level execute().
  // For ':memory:' that new connection is a distinct, empty database (losing the schema); for a
  // real file it just reopens the same persisted database, which is what we want. Each call gets
  // its own temp directory so parallel test files/workers never share a database.
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
