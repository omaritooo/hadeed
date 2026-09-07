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
