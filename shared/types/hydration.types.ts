export interface HydrationLog {
  id: number
  userId: string
  amountMl: number
  loggedAt: string
}

export interface HydrationToday {
  totalMl: number
  targetMl: number | null
  remainingMl: number | null
  logs: HydrationLog[]
}
