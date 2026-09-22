export const startOfWeek = (date: Date): Date => {
  const day = date.getUTCDay()
  const diff = (day + 6) % 7
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - diff)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

export const toSqliteDatetime = (date: Date): string => {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export const fromSqliteDatetime = (value: string): Date => {
  return new Date(`${value.replace(' ', 'T')}Z`)
}

export const dayBefore = (dateString: string): string => {
  const date = new Date(`${dateString}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

// An offline client sends when a set was actually logged, or a session actually finished, as an
// ISO-8601 instant. Anything unusable becomes null so the caller falls back to the server clock:
// a set queued in a basement gym is worth far more than its exact timestamp, so a bad value must
// never fail the write. The clamp against the session window happens in SQL, where `started_at`
// and `now` are readable in the same statement.
export const parseClientTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : toSqliteDatetime(date)
}
