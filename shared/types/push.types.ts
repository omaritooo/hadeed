export interface PushSubscriptionRecord {
  id: number
  userId: string
  endpoint: string
  p256dhKey: string
  authKey: string
  createdAt: string
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}
