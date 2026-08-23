import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// createTestDb() (server/utils/test/create-test-db.ts) creates a fresh mkdtempSync-backed
// SQLite database under the OS temp directory for every test that needs one, because the
// local sqlite3 client requires a file-backed (not ':memory:') database to survive its
// transaction() connection-swap behavior. Nothing else ever removes these directories, so a
// full test run leaves dozens of `hadeed-test-db-*` directories behind. Sweep them all up once
// after the whole suite finishes rather than adding per-file afterEach/afterAll cleanup.
export default function () {
  return () => {
    const dir = tmpdir()
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('hadeed-test-db-')) {
        rmSync(join(dir, entry), { recursive: true, force: true })
      }
    }
  }
}
