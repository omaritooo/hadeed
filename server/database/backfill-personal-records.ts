import { fileURLToPath } from 'node:url'
import { createClient, type Client, type InStatement } from '@libsql/client'
import { detectPersonalRecords, type PrType } from '~~/shared/lib/personal-records'
import { personalRecordInsertStatements } from '~~/server/repositories/personal-record.repository'

export interface PersonalRecordBackfillSummary {
  setsReplayed: number
  series: number
  detected: Record<PrType, number>
  inserted: Record<PrType, number>
}

// Turso charges per round trip, and a full history is tens of thousands of sets, so inserts go
// out in batches rather than one statement at a time. Chunked rather than sent as one giant
// batch so a large account doesn't build an unbounded request.
const CHUNK_SIZE = 200

const emptyCounts = (): Record<PrType, number> => ({ weight: 0, reps: 0, e1rm: 0 })

/**
 * One-off: populates personal_records from existing set_logs, replaying each user's working sets
 * per exercise in logged order through the same detector that runs at log time. Existing
 * xp_ledger('pr') rows are left untouched -- this only fills the new table. Safe to re-run: every
 * insert is ON CONFLICT DO NOTHING, so a second pass reports zero inserted rows and changes
 * nothing. Run it once the personal-records build is live.
 */
export const backfillPersonalRecords = async (db: Client): Promise<PersonalRecordBackfillSummary> => {
  // Warm-ups are excluded in SQL, the same way every other PR/history query does it: they can
  // neither set a PR nor raise the baseline, so they are simply not part of the replay.
  // (logged_at, rowid) is the same ordering SessionRepository.findWorkingSetsBefore uses -- the
  // rowid tiebreak carries it, because logged_at only has second resolution and the sets of one
  // exercise routinely share a timestamp.
  const result = await db.execute(`
    SELECT sl.id, sl.weight_kg, sl.reps, sl.logged_at, ws.user_id, el.exercise_id
    FROM set_logs sl
    JOIN exercise_logs el ON el.id = sl.exercise_log_id
    JOIN workout_sessions ws ON ws.id = el.session_id
    WHERE sl.is_warmup = 0
    ORDER BY ws.user_id, el.exercise_id, sl.logged_at, sl.rowid
  `)

  const history = new Map<string, { weightKg: number | null, reps: number | null }[]>()
  const statements: InStatement[] = []
  const statementTypes: PrType[] = []
  const detected = emptyCounts()

  for (const row of result.rows) {
    const userId = row.user_id as string
    const exerciseId = row.exercise_id as string
    const key = `${userId}|${exerciseId}`
    const prior = history.get(key) ?? []

    const set = { weightKg: row.weight_kg as number | null, reps: row.reps as number | null }
    const prs = detectPersonalRecords({ ...set, isWarmup: false }, prior)
    for (const pr of prs) detected[pr.type] += 1
    statements.push(...personalRecordInsertStatements({
      userId,
      exerciseId,
      setLogId: row.id as string,
      achievedAt: row.logged_at as string,
      prs,
    }))
    statementTypes.push(...prs.map(pr => pr.type))

    prior.push(set)
    history.set(key, prior)
  }

  const inserted = emptyCounts()
  for (let offset = 0; offset < statements.length; offset += CHUNK_SIZE) {
    const chunk = statements.slice(offset, offset + CHUNK_SIZE)
    const results = await db.batch(chunk, 'write')
    // A row that already existed conflicts away to zero rowsAffected, which is what separates a
    // genuine first run from a no-op re-run in the output below.
    results.forEach((res, i) => { if (res.rowsAffected > 0) inserted[statementTypes[offset + i]!] += 1 })
  }

  const summary: PersonalRecordBackfillSummary = { setsReplayed: result.rows.length, series: history.size, detected, inserted }
  const total = (counts: Record<PrType, number>) => counts.weight + counts.reps + counts.e1rm
  console.log(`Replayed ${summary.setsReplayed} working set(s) across ${summary.series} user/exercise series.`)
  console.log(`Detected ${total(detected)} PR(s): ${detected.weight} weight, ${detected.reps} reps, ${detected.e1rm} e1rm.`)
  console.log(`Inserted ${total(inserted)} new row(s); ${total(detected) - total(inserted)} already present.`)
  return summary
}

const main = async () => {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in the environment.')
    process.exit(1)
  }

  const db = createClient({ url, authToken })
  try {
    await backfillPersonalRecords(db)
  } finally {
    db.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
