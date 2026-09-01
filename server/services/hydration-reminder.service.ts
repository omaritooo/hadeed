import webpush from 'web-push'
import type { ProfileRepository } from '~~/server/repositories/profile.repository'
import type { PushSubscriptionRepository } from '~~/server/repositories/push-subscription.repository'
import { fromSqliteDatetime } from '~~/server/utils/date'
import { configureWebPush } from '~~/server/utils/push'

const WAKING_HOUR_START = 8
const WAKING_HOUR_END = 22

export interface DispatchResult {
  usersDue: number
  notificationsSent: number
  expiredSubscriptionsRemoved: number
}

const localHour = (timezone: string | null): number => {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone ?? 'UTC',
    hour: 'numeric',
    hour12: false,
  }).format(new Date())
  return Number(formatted) % 24
}

export class HydrationReminderService {
  constructor(
    private profiles: ProfileRepository,
    private pushSubscriptions: PushSubscriptionRepository,
  ) {}

  private isDue(candidate: { timezone: string | null, intervalMinutes: number, lastRemindedAt: string | null }): boolean {
    const hour = localHour(candidate.timezone)
    if (hour < WAKING_HOUR_START || hour >= WAKING_HOUR_END) return false
    if (!candidate.lastRemindedAt) return true
    const elapsedMinutes = (Date.now() - fromSqliteDatetime(candidate.lastRemindedAt).getTime()) / 60_000
    return elapsedMinutes >= candidate.intervalMinutes
  }

  async dispatchDue(): Promise<DispatchResult> {
    const candidates = await this.profiles.findWithRemindersEnabled()
    const due = candidates.filter(candidate => this.isDue(candidate))
    if (due.length > 0) configureWebPush()

    let notificationsSent = 0
    let expiredSubscriptionsRemoved = 0

    for (const candidate of due) {
      const subscriptions = await this.pushSubscriptions.findByUserId(candidate.userId)
      if (subscriptions.length === 0) continue

      const payload = JSON.stringify({ title: 'Hadeed', body: "Time to drink some water 💧" })
      const results = await Promise.allSettled(subscriptions.map(subscription =>
        webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey } },
          payload,
        ),
      ))

      for (const [i, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          notificationsSent++
          continue
        }
        const statusCode = (result.reason as { statusCode?: number } | undefined)?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await this.pushSubscriptions.deleteByEndpoint(subscriptions[i]!.endpoint)
          expiredSubscriptionsRemoved++
        } else {
          console.error('web-push send failed', { userId: candidate.userId, error: result.reason })
        }
      }

      await this.profiles.markReminded(candidate.userId)
    }

    return { usersDue: due.length, notificationsSent, expiredSubscriptionsRemoved }
  }
}
