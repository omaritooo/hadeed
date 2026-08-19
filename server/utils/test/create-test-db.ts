import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(__dirname, '../../database/schema.sql')

export async function createTestDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' })
  const schema = readFileSync(schemaPath, 'utf-8')
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    await db.execute(statement)
  }
  return db
}
