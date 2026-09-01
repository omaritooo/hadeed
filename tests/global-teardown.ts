import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
